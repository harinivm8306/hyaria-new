"""Hybrid source: real sensors from ThingSpeak where the prototype has them
(temperature, humidity, water level...), simulated sensors for the rest (pH, EC, light).
The simulator uses the real room values as its environment, and executes commands
virtually until a real actuator link (ESP32 over MQTT) is added."""
from __future__ import annotations

from ..models import Ack, Command, Reading
from .base import DataSource
from .simulator import TankSimulator
from .thingspeak import ThingSpeakSource


class HybridSource(DataSource):
    name = "hybrid"
    can_actuate = True

    def __init__(self, sim: TankSimulator, ts: ThingSpeakSource):
        self.sim = sim
        self.ts = ts
        self.real_sensors: set[str] = set()

    def step(self, now: float, dt: float) -> None:
        real = self.ts.read(now)
        self.real_sensors = set(real)
        self.sim.env_air_temp = real["air_temp"].value if "air_temp" in real else None
        self.sim.env_humidity = real["humidity"].value if "humidity" in real else None
        self.sim.env_water_temp = real["water_temp"].value if "water_temp" in real else None
        if "water_level" in real and real["water_level"].value is not None:
            self.sim.volume_l = self.sim.capacity_l * real["water_level"].value / 100.0
        self.sim.step(now, dt)
        self._real = real

    def read(self, now: float) -> dict[str, Reading]:
        out = self.sim.read(now)
        out.update(getattr(self, "_real", {}))
        return out

    def apply(self, cmd: Command, now: float) -> Ack:
        ack = self.sim.apply(cmd, now)
        if ack.ok:
            ack.detail = (ack.detail + " " if ack.detail else "") + "(simulated actuator)"
        return ack

    def info(self) -> dict:
        return {"name": self.name, "can_actuate": True, "real_sensors": sorted(self.real_sensors),
                "thingspeak": self.ts.info(), "simulator": self.sim.info()}
