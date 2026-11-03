"""Virtual aeroponic tank. Reacts to every actuator command so the full control loop
can run without hardware. Real sensor values (from ThingSpeak) can be fed in as the
environment so the simulated pH/EC/roots respond to the real room."""
from __future__ import annotations

import math
import random
import time

from ..models import Ack, Command, Reading
from ..physics import clamp, vpd_kpa
from .base import DataSource

# "True" tank constants the controllers do NOT know; they must learn them.
K_TRUE = 0.45        # EC rise (mS/cm) per ml of EACH of A and B per litre
B_DOWN_TRUE = 1.2    # pH drop per ml pH-down per litre
B_UP_TRUE = 1.0      # pH rise per ml pH-up per litre
FRESH_WATER_PH = 7.2
LED_MAX_LUX = 20000.0
# Ions (ppm) carried by the base A/B mix per 1 mS/cm of EC it adds: nitrate-N, P, K.
ION_PER_EC = {"n": 105.0, "p": 30.0, "k": 145.0}
# True gain of each single-nutrient stock: ppm rise per ml per litre (learned by A16).
NPK_GAIN_TRUE = {"n": 7.0, "p": 3.0, "k": 9.0}
# Uptake per day at full plant size, as a fraction of the ion present. N and K go fastest.
ION_UPTAKE = {"n": 0.11, "p": 0.06, "k": 0.10}
PPM_PER_EC = 700.0          # EC rise from single-nutrient doses


class TankSimulator(DataSource):
    name = "simulator"
    can_actuate = True

    def __init__(self, capacity_l: float = 40.0, planted_at: float | None = None, seed: int | None = None,
                 start: float | None = None):
        self.rng = random.Random(seed)
        self.capacity_l = capacity_l
        self.volume_l = capacity_l * 0.85
        self.ec = 1.05
        self.ph = 6.45
        self.ions = {n: r * self.ec for n, r in ION_PER_EC.items()}
        self.water_temp = 21.0
        self.air_temp = 23.0
        self.humidity = 66.0
        self.led_pwm = 0.0
        self.root_moisture = 1.0
        self.last_mist_at = start or time.time()
        self.last_mist_s = 0.0
        self.planted_at = planted_at or (start or time.time()) - 12 * 86400
        self.faults: set[str] = set()
        self._stuck_ph: float | None = None
        # Real environment values injected by the hybrid source (None = simulate)
        self.env_air_temp: float | None = None
        self.env_humidity: float | None = None
        self.env_water_temp: float | None = None

    # ---------------- dynamics ----------------
    def _hour(self, now: float) -> float:
        lt = time.localtime(now)
        return lt.tm_hour + lt.tm_min / 60.0

    def sun_lux(self, now: float) -> float:
        h = self._hour(now)
        if 6.0 <= h <= 18.0:
            return 6000.0 * math.sin(math.pi * (h - 6.0) / 12.0)
        return 0.0

    def plant_factor(self, now: float) -> float:
        days = max(0.0, (now - self.planted_at) / 86400.0)
        return 0.3 + 0.7 * min(1.0, days / 30.0)

    def step(self, now: float, dt: float) -> None:
        if dt <= 0:
            return
        h = self._hour(now)
        heat = 8.0 if "heatwave" in self.faults else 0.0
        if self.env_air_temp is not None:
            self.air_temp = self.env_air_temp + heat
        else:
            target = 23.0 + 4.0 * math.sin(2 * math.pi * (h - 9.0) / 24.0) + heat
            self.air_temp += (target - self.air_temp) * min(1.0, dt / 900.0)
        if self.env_humidity is not None:
            self.humidity = self.env_humidity
        else:
            target = 68.0 - 10.0 * math.sin(2 * math.pi * (h - 9.0) / 24.0) - heat
            self.humidity += (target - self.humidity) * min(1.0, dt / 900.0)
        if self.env_water_temp is not None:
            self.water_temp = self.env_water_temp
        else:
            self.water_temp += (self.air_temp - 1.0 - self.water_temp) * min(1.0, dt / (3 * 3600.0))

        vpd = vpd_kpa(self.air_temp, self.humidity)
        pf = self.plant_factor(now)
        # Water: transpiration (L/h) grows with plant size and VPD; optional leak.
        # Transpired water leaves the salts behind (concentrates); leaked solution takes them along.
        loss_l = 0.08 * pf * max(vpd, 0.1) / 0.9 * dt / 3600.0
        leak_l = 2.0 * dt / 3600.0 if "leak" in self.faults else 0.0
        self.volume_l = max(0.0, self.volume_l - leak_l)
        old_v = self.volume_l
        self.volume_l = max(0.0, self.volume_l - loss_l)
        if self.volume_l > 0.5:
            self.ec *= old_v / self.volume_l                    # concentration as water leaves
            for n in self.ions:
                self.ions[n] *= old_v / self.volume_l
        for n, rate in ION_UPTAKE.items():
            boost = 6.0 if f"low_{n}" in self.faults else 1.0  # fault: plants strip one ion fast
            self.ions[n] = max(0.0, self.ions[n] * (1 - rate * boost * pf * dt / 86400.0))
        self.ec -= 0.12 * pf * (self.ec / 1.4) * dt / 86400.0  # nutrient uptake
        self.ec = clamp(self.ec, 0.0, 5.0)
        self.ph += 0.18 * pf * dt / 86400.0                     # nitrate uptake pushes pH up
        self.ph = clamp(self.ph, 3.5, 9.0)
        # Roots dry faster in high VPD.
        self.root_moisture *= math.exp(-dt / 360.0 * max(vpd, 0.2) / 0.9)

    # ---------------- sensors ----------------
    def _noise(self, sd: float) -> float:
        return self.rng.gauss(0.0, sd)

    def read(self, now: float) -> dict[str, Reading]:
        ph = self.ph + self._noise(0.02)
        if "ph_stuck" in self.faults:
            if self._stuck_ph is None:
                self._stuck_ph = round(ph, 2)
            ph = self._stuck_ph
        elif self.rng.random() < 0.01:          # occasional electrical spike
            ph += self.rng.choice([-1.5, 1.5])
        lux = self.sun_lux(now) + LED_MAX_LUX * self.led_pwm / 100.0
        pump_on = 1.0 if (now - self.last_mist_at) <= max(self.last_mist_s, 1.0) else 0.0
        vals = {
            "ph": ph,
            "ec": self.ec + self._noise(0.015),
            "water_temp": self.water_temp + self._noise(0.05),
            "air_temp": self.air_temp + self._noise(0.1),
            "humidity": clamp(self.humidity + self._noise(0.4), 0, 100),
            "light_lux": max(0.0, lux + self._noise(50)),
            "water_level": clamp(100.0 * self.volume_l / self.capacity_l, 0, 100),
            "pump_state": pump_on,
            "n_ppm": max(0.0, self.ions["n"] + self._noise(2.0)),
            "p_ppm": max(0.0, self.ions["p"] + self._noise(1.0)),
            "k_ppm": max(0.0, self.ions["k"] + self._noise(3.0)),
        }
        return {k: Reading(round(v, 3), "sim", now) for k, v in vals.items()}

    # ---------------- actuators ----------------
    def apply(self, cmd: Command, now: float) -> Ack:
        a, x = cmd.actuator, float(cmd.amount)
        if a == "mist":
            if "pump_fail" in self.faults:
                return Ack(False, "no pressure rise: pump or nozzle failure")
            self.root_moisture = 1.0
            self.last_mist_at, self.last_mist_s = now, x
            return Ack(True, f"misted {x:.0f} s")
        if a in ("dose_a", "dose_b"):
            delta = 0.5 * K_TRUE * x / max(self.volume_l, 1.0)
            self.ec += delta
            self.ph -= 0.05 * delta
            for n, r in ION_PER_EC.items():
                self.ions[n] += 0.5 * r * K_TRUE * x / max(self.volume_l, 1.0)
            return Ack(True)
        if a in ("dose_n", "dose_p", "dose_k"):
            n = a[-1]
            if f"empty_{n}" in self.faults:
                return Ack(True, "pump ran")            # bottle empty: nothing changes, A16 must notice
            ppm = NPK_GAIN_TRUE[n] * x / max(self.volume_l, 1.0)
            self.ions[n] += ppm
            self.ec += ppm / PPM_PER_EC
            return Ack(True)
        if a == "ph_down":
            self.ph -= B_DOWN_TRUE * x / max(self.volume_l, 1.0)
            return Ack(True)
        if a == "ph_up":
            self.ph += B_UP_TRUE * x / max(self.volume_l, 1.0)
            return Ack(True)
        if a == "water_add":
            add = max(0.0, min(x, self.capacity_l - self.volume_l))
            if add <= 0:
                return Ack(False, "tank full")
            new_v = self.volume_l + add
            self.ec = self.ec * self.volume_l / new_v
            for n in self.ions:
                self.ions[n] *= self.volume_l / new_v
            self.ph = (self.ph * self.volume_l + FRESH_WATER_PH * add) / new_v
            self.volume_l = new_v
            return Ack(True, f"added {add:.1f} L")
        if a == "led":
            self.led_pwm = clamp(x, 0, 100)
            return Ack(True)
        return Ack(False, f"unknown actuator {a}")

    def set_fault(self, fault: str, on: bool) -> None:
        if on:
            self.faults.add(fault)
        else:
            self.faults.discard(fault)
            if fault == "ph_stuck":
                self._stuck_ph = None

    def info(self) -> dict:
        return {"name": self.name, "can_actuate": True, "faults": sorted(self.faults),
                "volume_l": round(self.volume_l, 2), "root_moisture": round(self.root_moisture, 3),
                "ions_ppm": {n: round(v, 1) for n, v in self.ions.items()}}
