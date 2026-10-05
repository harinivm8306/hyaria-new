"""A3 - adaptive misting interval driven by vapour pressure deficit (VPD)."""
from __future__ import annotations

from ..models import Command
from ..physics import clamp, vpd_kpa

VPD_REF = 0.9
ROOT_HOT_C = 24.0
NIGHT_FACTOR = 1.3


def mist_off_minutes(stage: dict, air_temp: float | None, humidity: float | None,
                     water_temp: float | None, lights_on: bool) -> tuple[float, str]:
    base = float(stage["mist_off_min"])
    why = [f"base {base:g} min"]
    factor = 1.0
    if air_temp is not None and humidity is not None:
        vpd = vpd_kpa(air_temp, humidity)
        factor = clamp(VPD_REF / max(vpd, 0.05), 0.5, 1.5)
        why.append(f"VPD {vpd:.2f} kPa x{factor:.2f}")
    off = base * factor
    if water_temp is not None and water_temp > ROOT_HOT_C:
        off *= 0.75
        why.append(f"root zone {water_temp:.1f} C x0.75")
    if not lights_on:
        off *= NIGHT_FACTOR
        why.append(f"night x{NIGHT_FACTOR}")
    return round(off, 2), ", ".join(why)


def misting_step(now: float, last_mist_at: float | None, stage: dict, air_temp, humidity,
                 water_temp, lights_on: bool) -> tuple[list[Command], float, str]:
    off_min, why = mist_off_minutes(stage, air_temp, humidity, water_temp, lights_on)
    due_at = (last_mist_at or 0.0) + off_min * 60.0
    if now >= due_at:
        return [Command("mist", float(stage["mist_on_s"]), f"interval {off_min:.1f} min ({why})")], now + off_min * 60.0, why
    return [], due_at, why
