"""Shared small types."""
from __future__ import annotations

from dataclasses import dataclass, field

SENSORS = ("ph", "ec", "water_temp", "air_temp", "humidity", "light_lux", "water_level", "pump_state")
ACTUATORS = {
    "mist": "s",        # run misting pump for N seconds
    "dose_a": "ml",     # nutrient stock A
    "dose_b": "ml",     # nutrient stock B
    "ph_down": "ml",
    "ph_up": "ml",
    "water_add": "L",   # top up / dilute with fresh water
    "led": "%",         # LED PWM duty
}


@dataclass
class Command:
    actuator: str
    amount: float
    reason: str = ""
    source: str = "ai"          # ai | manual | safety
    expires_at: float | None = None

    @property
    def unit(self) -> str:
        return ACTUATORS.get(self.actuator, "")


@dataclass
class Ack:
    ok: bool
    detail: str = ""


@dataclass
class Reading:
    value: float | None
    source: str                 # real | sim
    ts: float
    raw: float | None = None
    extra: dict = field(default_factory=dict)
