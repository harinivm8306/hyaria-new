"""A6 - anomaly detection and alerts: hard limits, comfort bands, rate of change,
dose-response checks, sensor faults and actuator failures. Hysteresis + cooldown avoid spam."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from . import db

LIMIT_MARGIN = {"ph": 0.05, "ec": 0.05, "water_temp": 0.5, "air_temp": 0.5, "humidity": 2.0, "water_level": 2.0}
LABEL = {"ph": "pH", "ec": "EC", "water_temp": "Water temp", "air_temp": "Air temp",
         "humidity": "Humidity", "water_level": "Tank level", "light_lux": "Light"}
UNIT = {"ph": "", "ec": " mS/cm", "water_temp": " C", "air_temp": " C", "humidity": "%", "water_level": "%"}
COMFORT_SENSORS = ("air_temp", "humidity", "water_temp")
COMFORT_PERSIST_S = 30 * 60
COOLDOWN_S = 30 * 60
@dataclass
class AlertManager:
    device_id: str
    open: dict = field(default_factory=dict)          # key -> alert id
    cleared_at: dict = field(default_factory=dict)    # key -> ts
    comfort_since: dict = field(default_factory=dict)
    hist: dict = field(default_factory=lambda: {"water_temp": deque(), "water_level": deque()})
    dose_issue: str | None = None                     # set by the engine from dosing feedback
    actuator_fail: dict = field(default_factory=dict)  # actuator -> message

    def note_ack(self, actuator: str, ok: bool, detail: str) -> None:
        if ok:
            self.actuator_fail.pop(actuator, None)
        else:
            self.actuator_fail[actuator] = detail

    def evaluate(self, now: float, latest: dict, recipe: dict, stage: dict) -> list[dict]:
        """latest: sensor -> {value, status}. Returns the list of currently active conditions."""
        conds: dict[str, tuple[str, str]] = {}

        def val(s):
            r = latest.get(s)
            return r["value"] if r and r["status"] == "OK" else None

        # 1. hard limits (critical) with hysteresis
        for s, (lo, hi) in recipe["hard_limits"].items():
            v = val(s)
            if v is None:
                continue
            key = f"limit:{s}"
            m = LIMIT_MARGIN.get(s, 0.0) if key in self.open else 0.0
            if v < lo + m or v > hi - m:
                if v < lo or v > hi or key in self.open:
                    side = "below" if v < (lo + hi) / 2 else "above"
                    edge = lo if side == "below" else hi
                    conds[key] = ("critical", f"{LABEL.get(s, s)} {v:.2f}{UNIT.get(s, '')} {side} safe limit {edge}")

        # 2. comfort bands for things we cannot actuate yet (warning after 30 min)
        for s in COMFORT_SENSORS:
            v = val(s)
            if v is None:
                self.comfort_since.pop(s, None)
                continue
            lo, hi = stage[s]
            if v < lo or v > hi:
                start = self.comfort_since.setdefault(s, now)
                if now - start >= COMFORT_PERSIST_S:
                    conds[f"band:{s}"] = ("warning", f"{LABEL[s]} {v:.1f}{UNIT[s]} outside {stage['name']} range {lo}-{hi} for 30+ min")
            else:
                self.comfort_since.pop(s, None)

        # 3. rate of change
        for s, window_s, limit, msg in (("water_temp", 1800, 1.0, "Root-zone water warming fast: +{d:.1f} C in 30 min"),
                                        ("water_level", 600, -5.0, "Tank level dropped {d:.1f}% in 10 min: possible leak")):
            v = val(s)
            if v is None:
                continue
            h = self.hist[s]
            h.append((now, v))
            while h and now - h[0][0] > window_s:
                h.popleft()
            if len(h) >= 2 and now - h[0][0] >= window_s * 0.5:
                d = v - h[0][1]
                if (limit > 0 and d > limit) or (limit < 0 and d < limit):
                    conds[f"rate:{s}"] = ("warning", msg.format(d=abs(d)))

        # 4. dose had no effect -> probe drift, empty stock bottle or blocked pump
        if self.dose_issue:
            conds["dosing:no_response"] = ("warning", self.dose_issue)

        # 5. sensor health
        for s, r in latest.items():
            if r["status"] in ("FAULT", "STUCK"):
                conds[f"sensor:{s}"] = ("warning", f"{LABEL.get(s, s)} sensor {r['status'].lower()}: readings ignored by controllers")

        # 6. actuator failures
        for a, detail in self.actuator_fail.items():
            conds[f"actuator:{a}"] = ("critical", f"{a} failed: {detail}")

        self._sync(now, conds)
        return [{"key": k, "severity": s, "message": m} for k, (s, m) in conds.items()]

    def _sync(self, now: float, conds: dict) -> None:
        for key, (sev, msg) in conds.items():
            if key in self.open:
                continue
            last = self.cleared_at.get(key)
            if sev == "warning" and last and now - last < COOLDOWN_S:
                continue
            self.open[key] = db.open_alert(self.device_id, key, sev, msg, now)
        for key in list(self.open):
            if key not in conds:
                db.clear_alert(self.open.pop(key), now)
                self.cleared_at[key] = now
