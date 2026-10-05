"""A4 - LED dimming to reach the recipe's daily light integral (DLI)."""
from __future__ import annotations

import time
from dataclasses import dataclass

from ..models import Command
from ..physics import clamp, lux_to_ppfd

LED_MAX_PPFD = 370.0   # what the LED panel gives at 100% at canopy height; measure yours
UPDATE_EVERY_S = 15 * 60


@dataclass
class LightState:
    day_key: str = ""
    dli_so_far: float = 0.0
    last_ts: float = 0.0
    last_update: float = 0.0
    pwm: float = 0.0


def _local(now: float):
    return time.localtime(now)


def photoperiod_hours_left(now: float, start_hour: float, hours: float) -> float:
    lt = _local(now)
    h = lt.tm_hour + lt.tm_min / 60.0 + lt.tm_sec / 3600.0
    end = start_hour + hours
    if start_hour <= h < end:
        return end - h
    return 0.0


def lighting_step(state: LightState, now: float, lux: float | None, recipe: dict, stage: dict) -> tuple[list[Command], dict]:
    lt = _local(now)
    key = f"{lt.tm_year}-{lt.tm_yday}"
    if key != state.day_key:
        state.day_key, state.dli_so_far, state.last_ts = key, 0.0, now
    ppfd = lux_to_ppfd(lux or 0.0)
    if state.last_ts:
        state.dli_so_far += ppfd * max(0.0, now - state.last_ts) / 1e6
    state.last_ts = now

    pp = recipe["photoperiod"]
    left_h = photoperiod_hours_left(now, pp["start_hour"], pp["hours"])
    target = float(stage["dli"])
    info = {"dli_so_far": round(state.dli_so_far, 2), "dli_target": target, "hours_left": round(left_h, 2)}
    if left_h <= 0:
        new_pwm = 0.0
        reason = "outside photoperiod"
    else:
        needed = max(0.0, target - state.dli_so_far) * 1e6 / (3600.0 * left_h)
        sun_ppfd = max(0.0, ppfd - LED_MAX_PPFD * state.pwm / 100.0)   # light not coming from the LED
        new_pwm = round(clamp((needed - sun_ppfd) / LED_MAX_PPFD * 100.0, 0.0, 100.0), 0)
        reason = f"need {needed:.0f} umol/m2/s for {left_h:.1f} h to reach DLI {target:g}"
        info["ppfd_needed"] = round(needed, 1)
    info["pwm"] = new_pwm
    changed = abs(new_pwm - state.pwm) >= 5 or (new_pwm == 0) != (state.pwm == 0)
    if changed and (now - state.last_update >= UPDATE_EVERY_S or new_pwm == 0 or state.pwm == 0):
        state.pwm, state.last_update = new_pwm, now
        return [Command("led", new_pwm, reason)], info
    return [], info
