"""The control engine: one loop per device.

tick: advance source -> read -> clean (A1) -> store -> stage (A5) -> controllers
(A2 dosing, A3 misting, A4 lighting) -> safety (A12) -> actuate -> log -> alerts (A6) -> health (A7)
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import asdict
from typing import Callable

from . import db
from .alerts import AlertManager
from .config import Settings
from .control import safety
from .control.dosing import DosingState, dosing_step
from .control.lighting import LightState, lighting_step, photoperiod_hours_left
from .control.misting import misting_step
from .control.npk import NUTRIENTS, SENSOR as NPK_SENSOR, NpkState, npk_step
from .control.safety import NPK
from .health import health_score
from .models import ACTUATORS, SENSORS, Command
from .physics import vpd_kpa
from .recipes import load_recipe, stage_for_day
from .sensing import SensorBank
from .sources.base import DataSource
from .sources.hybrid import HybridSource
from .sources.simulator import TankSimulator
from .sources.thingspeak import ThingSpeakSource

log = logging.getLogger("hyaria.engine")


class Clock:
    """Real time, or accelerated time for simulator demos."""

    def __init__(self, speed: float = 1.0, start: float | None = None):
        self.speed = max(speed, 0.0)
        self.real0 = time.time()
        self.sim0 = start or self.real0

    def __call__(self) -> float:
        return self.sim0 + (time.time() - self.real0) * self.speed


def build_source(s: Settings, planted_at: float, start: float) -> DataSource:
    sim = TankSimulator(capacity_l=s.tank_capacity_l, planted_at=planted_at, start=start)
    ts = ThingSpeakSource(s.thingspeak_channel_id, s.thingspeak_read_key, s.thingspeak_field_map,
                          s.thingspeak_poll_seconds, s.thingspeak_stale_seconds, s.water_level_unit, s.tank_depth_cm)
    if s.data_source == "simulator":
        return sim
    if s.data_source == "thingspeak":
        return ts
    return HybridSource(sim, ts)


class Engine:
    def __init__(self, s: Settings, source: DataSource | None = None, clock: Callable[[], float] | None = None):
        self.s = s
        speed = s.sim_speed if s.data_source == "simulator" else 1.0
        self.clock = clock or Clock(speed)
        now = self.clock()
        cycle = db.active_cycle(s.device_id)
        if not cycle:
            cycle = db.start_cycle(s.device_id, s.crop, now - s.planted_days_ago * 86400)
        self.cycle = cycle
        self.recipe = load_recipe(cycle["crop"])
        self.source = source or build_source(s, cycle["planted_at"], now)
        self.bank = SensorBank()
        saved = db.load_controller_state(s.device_id)
        self.dosing = DosingState.from_dict(saved.get("dosing", {}))
        self.npk = NpkState.from_dict(saved.get("npk", {}))
        self.npk_status: dict = {}
        self.light = LightState(**saved.get("light", {})) if saved.get("light") else LightState()
        self.last_mist_at: float | None = saved.get("last_mist_at")
        self.next_mist_at: float | None = None
        self.mist_why = ""
        self.light_info: dict = {}
        self.auto = saved.get("auto", True)
        self.alerts = AlertManager(s.device_id)
        self.latest: dict[str, dict] = {}
        self.active_conditions: list[dict] = []
        self.health: dict = {}
        self.notes: list[str] = []
        self.last_tick: float | None = None
        self.last_store: float = 0.0
        self.tick_count = 0
        self.lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    # ------------------------------------------------------------------ helpers
    def day(self, now: float) -> float:
        return max(0.0, (now - self.cycle["planted_at"]) / 86400.0)

    def stage(self, now: float) -> dict:
        return stage_for_day(self.recipe, self.day(now))

    def _v(self, sensor: str):
        r = self.latest.get(sensor)
        return r["value"] if r and r["status"] == "OK" else None

    def _ok(self, sensor: str) -> bool:
        r = self.latest.get(sensor)
        return bool(r) and r["status"] == "OK"

    def _volume_l(self) -> float:
        lvl = self._v("water_level")
        return self.s.tank_capacity_l * (lvl if lvl is not None else 80.0) / 100.0

    def _mixing(self, now: float) -> bool:
        """True while a nutrient (EC) dose or dilution is still mixing in the tank."""
        return self.dosing.pending in ("ec", "dilute") and now < self.dosing.wait_until

    def _ph_mixing(self, now: float) -> bool:
        return self.dosing.pending in ("ph_down", "ph_up") and now < self.dosing.wait_until

    # ------------------------------------------------------------------ actuation
    def execute(self, cmd: Command, now: float) -> dict:
        row = {"ts": now, "device_id": self.s.device_id, "actuator": cmd.actuator, "amount": cmd.amount,
               "unit": cmd.unit, "reason": cmd.reason, "source": cmd.source}
        if cmd.actuator in NPK:
            mixing = self._mixing(now)
        else:
            mixing = self._mixing(now) or self.npk.mixing(now)
        ok, why = safety.check(cmd, now, self._v("water_level"), self._ok("water_level"), mixing,
                               self._ph_mixing(now), self._v("ec"))
        if not self.source.can_actuate:
            row.update(status="advisory", reason=f"{cmd.reason} | no actuator link: do this manually")
        elif not ok:
            row.update(status="blocked", reason=f"{cmd.reason} | blocked: {why}")
        else:
            ack = self.source.apply(cmd, now)
            self.alerts.note_ack(cmd.actuator, ack.ok, ack.detail)
            row.update(status="done" if ack.ok else "failed",
                       reason=f"{cmd.reason}" + (f" | {ack.detail}" if ack.detail else ""))
            if cmd.actuator == "mist":
                # count failed attempts too, so a broken pump is retried once per interval, not every tick
                self.last_mist_at = now
            if ack.ok and cmd.actuator == "led":
                self.light.pwm = cmd.amount
        row["id"] = db.insert_action(row)
        return row

    # ------------------------------------------------------------------ main tick
    def tick(self, now: float | None = None) -> None:
        with self.lock:
            now = self.clock() if now is None else now
            dt = 0.0 if self.last_tick is None else now - self.last_tick
            self.last_tick = now
            self.tick_count += 1
            self.source.step(now, dt)
            raw = self.source.read(now)

            # A1 clean
            store_now = now - self.last_store >= self.s.store_every_seconds
            rows = []
            for sensor in SENSORS:
                r = raw.get(sensor)
                if r is None:
                    if sensor in self.latest:
                        self.latest[sensor]["status"] = "MISSING"
                    continue
                value, status = self.bank.update(sensor, r.value, now) if sensor != "pump_state" else (r.value, "OK")
                self.latest[sensor] = {"value": None if value is None else round(value, 3), "raw": r.value,
                                       "status": status, "source": r.source, "ts": r.ts}
                if store_now:
                    rows.append({"ts": now, "device_id": self.s.device_id, "sensor": sensor,
                                 "value": self.latest[sensor]["value"], "raw": r.value, "status": status, "source": r.source})
            if store_now:
                db.insert_readings(rows)
                self.last_store = now

            stage = self.stage(now)
            pp = self.recipe["photoperiod"]
            lights_on = photoperiod_hours_left(now, pp["start_hour"], pp["hours"]) > 0
            self.notes = []

            if self.auto:
                cmds: list[Command] = []
                # A2 dosing (base A/B mix + pH); waits while an N/P/K dose mixes
                dcmds, dnotes = [], []
                if not self.npk.mixing(now):
                    dcmds, dnotes = dosing_step(self.dosing, now, self._v("ec"), self._v("ph"), self._volume_l(),
                                                self.s.tank_capacity_l, stage, self._ok("ec"), self._ok("ph"))
                self.notes += dnotes
                dosing_done = [self.execute(c, now)["status"] == "done" for c in dcmds]
                if dcmds and not all(dosing_done):
                    # never learn from a dose that did not happen
                    self.dosing.pending = None
                # A16 N/P/K balance: only when A2 is idle
                if not dcmds and not self.dosing.pending:
                    ncmds, self.npk_status, npk_issues = self._npk(now, stage)
                    if ncmds and self.execute(ncmds[0], now)["status"] != "done":
                        self.npk.pending = None
                        self.npk.dose_times.pop()
                else:   # show the status anyway, decide nothing
                    _, self.npk_status, npk_issues = self._npk(now, stage, observe_only=True)
                    self.npk_status["note"] = "waiting for the EC / pH dose to finish mixing"
                # A3 misting
                mcmds, self.next_mist_at, self.mist_why = misting_step(
                    now, self.last_mist_at, stage, self._v("air_temp"), self._v("humidity"), self._v("water_temp"), lights_on)
                cmds += mcmds
                # A4 lighting
                lcmds, self.light_info = lighting_step(self.light, now, self._v("light_lux"), self.recipe, stage)
                cmds += lcmds
                for c in cmds:
                    self.execute(c, now)
            else:
                self.notes.append("automatic control paused (manual mode)")
                _, self.npk_status, npk_issues = self._npk(now, stage, observe_only=True)

            self.alerts.extra = npk_issues

            # A6 alerts
            self.alerts.dose_issue = self.dosing.response_issue
            self.active_conditions = self.alerts.evaluate(now, self.latest, self.recipe, stage)
            # A7 health
            self.health = health_score(self.latest, stage)
            self._save_state()

    def _save_state(self) -> None:
        db.save_controller_state(self.s.device_id, {
            "dosing": self.dosing.to_dict(), "light": asdict(self.light),
            "last_mist_at": self.last_mist_at, "auto": self.auto, "npk": self.npk.to_dict()})

    def _npk(self, now: float, stage: dict, observe_only: bool = False):
        ions = {n: self._v(NPK_SENSOR[n]) for n in NUTRIENTS}
        ph, (lo, hi) = self._v("ph"), stage["ph"]
        ph_in_band = ph is not None and lo <= ph <= hi
        if observe_only:   # status for the UI without touching dose state
            probe = NpkState.from_dict(self.npk.to_dict())
            probe.dose_times = [now] * 99
            _, status, issues = npk_step(probe, now, ions, self._volume_l(), stage, ph_in_band)
            status["note"] = "automatic control paused (manual mode)"
            return [], status, issues
        return npk_step(self.npk, now, ions, self._volume_l(), stage, ph_in_band)

    def note_vision(self, npk_result: dict, ts: float | None = None) -> None:
        """A new plant photo was analysed: let A16 use the camera's opinion."""
        with self.lock:
            self.npk.note_vision(npk_result, ts if ts is not None else (self.last_tick or self.clock()))
            self._save_state()

    # ------------------------------------------------------------------ API helpers
    def override(self, actuator: str, amount: float, reason: str = "manual override") -> dict:
        if actuator not in ACTUATORS:
            raise ValueError(f"unknown actuator '{actuator}'. Use one of {sorted(ACTUATORS)}")
        with self.lock:
            now = self.clock()
            return self.execute(Command(actuator, float(amount), reason, source="manual"), now)

    def set_auto(self, auto: bool) -> None:
        with self.lock:
            self.auto = auto
            self._save_state()

    def new_cycle(self, crop: str, planted_at: float) -> dict:
        with self.lock:
            recipe = load_recipe(crop)
            self.cycle = db.start_cycle(self.s.device_id, crop, planted_at)
            self.recipe = recipe
            if isinstance(self.source, TankSimulator):
                self.source.planted_at = planted_at
            elif isinstance(self.source, HybridSource):
                self.source.sim.planted_at = planted_at
            return self.cycle

    def reload_recipe(self) -> None:
        with self.lock:
            self.recipe = load_recipe(self.cycle["crop"])

    def simulator(self) -> TankSimulator | None:
        if isinstance(self.source, TankSimulator):
            return self.source
        if isinstance(self.source, HybridSource):
            return self.source.sim
        return None

    def snapshot(self) -> dict:
        with self.lock:
            now = self.last_tick or self.clock()
            stage = self.stage(now)
            at, rh = self._v("air_temp"), self._v("humidity")
            return {
                "device_id": self.s.device_id,
                "time": now,
                "data_source": self.source.info(),
                "auto": self.auto,
                "crop": self.cycle["crop"],
                "crop_name": self.recipe.get("display_name", self.cycle["crop"]),
                "day": round(self.day(now), 2),
                "stage": stage,
                "readings": self.latest,
                "vpd_kpa": round(vpd_kpa(at, rh), 3) if at is not None and rh is not None else None,
                "health": self.health,
                "alerts": db.list_alerts(self.s.device_id, active_only=True, limit=20),
                "controllers": {
                    "dosing": {"k_ec": round(self.dosing.k_ec, 3), "b_down": round(self.dosing.b_down, 3),
                               "b_up": round(self.dosing.b_up, 3), "pending": self.dosing.pending,
                               "mixing_until": self.dosing.wait_until
                               if self.dosing.pending and now < self.dosing.wait_until else None},
                    "misting": {"last_mist_at": self.last_mist_at, "next_mist_at": self.next_mist_at, "why": self.mist_why},
                    "lighting": self.light_info,
                    "npk": {"status": self.npk_status, "pending": self.npk.pending,
                            "mixing_until": self.npk.wait_until if self.npk.mixing(now) else None,
                            "gains": {n: round(self.npk.gain(n), 2) for n in NUTRIENTS},
                            "camera": {"label": self.npk.vision_label, "confidence": self.npk.vision_conf,
                                       "streak": self.npk.vision_streak, "ts": self.npk.vision_ts}},
                },
                "notes": self.notes,
            }

    # ------------------------------------------------------------------ thread
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="hyaria-engine", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        last_prune = 0.0
        while not self._stop.is_set():
            try:
                self.tick()
                if time.time() - last_prune > 3600:
                    db.prune_readings(self.clock() - 90 * 86400)
                    last_prune = time.time()
            except Exception:
                log.exception("engine tick failed")
            self._stop.wait(self.s.tick_seconds)
