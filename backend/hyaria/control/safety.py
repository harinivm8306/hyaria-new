"""A12 - safety interlocks. Every command (AI or manual) passes through here.
On real hardware the same rules also run on the ESP32 so they hold if the cloud is down."""
from __future__ import annotations

from ..models import Command

MIN_LEVEL_PCT = 15.0
MAX_MIST_S = 30.0
MAX_DOSE_ML = 60.0
MAX_PH_ML = 20.0
MAX_WATER_L = 20.0
MAX_NPK_ML = 30.0
MAX_EC_FOR_NPK = 2.2        # mS/cm: never add single nutrients above this total salt level
NPK = ("dose_n", "dose_p", "dose_k")


def check(cmd: Command, now: float, level_pct: float | None, level_ok: bool, mixing: bool,
          ph_mixing: bool = False, ec: float | None = None) -> tuple[bool, str]:
    """mixing: a nutrient dose or dilution is still mixing; ph_mixing: a pH dose is still mixing."""
    if cmd.expires_at is not None and now > cmd.expires_at:
        return False, "command expired"
    if cmd.amount < 0:
        return False, "negative amount"
    if cmd.actuator in ("mist", "dose_a", "dose_b", "ph_down", "ph_up") + NPK:
        if level_pct is None or not level_ok:
            return False, "water level unknown: pumps locked"
        if level_pct < MIN_LEVEL_PCT:
            return False, f"tank at {level_pct:.0f}% (< {MIN_LEVEL_PCT:.0f}%): pumps locked"
    if cmd.actuator == "mist" and cmd.amount > MAX_MIST_S:
        return False, f"mist longer than {MAX_MIST_S:.0f} s refused"
    if cmd.actuator in ("dose_a", "dose_b") and cmd.amount > MAX_DOSE_ML:
        return False, f"dose above {MAX_DOSE_ML:.0f} ml refused"
    if cmd.actuator in ("ph_down", "ph_up"):
        if cmd.amount > MAX_PH_ML:
            return False, f"pH dose above {MAX_PH_ML:.0f} ml refused"
        if mixing and cmd.source != "manual":
            return False, "nutrient still mixing"
    if cmd.actuator in NPK:
        if cmd.amount > MAX_NPK_ML:
            return False, f"N/P/K dose above {MAX_NPK_ML:.0f} ml refused"
        if ec is not None and ec >= MAX_EC_FOR_NPK:
            return False, f"EC {ec:.2f} at or above {MAX_EC_FOR_NPK} mS/cm: N/P/K dosing locked"
        if (mixing or ph_mixing) and cmd.source != "manual":
            return False, "previous dose still mixing"
    if cmd.actuator == "water_add" and cmd.amount > MAX_WATER_L:
        return False, f"water add above {MAX_WATER_L:.0f} L refused"
    if cmd.actuator == "led" and not (0 <= cmd.amount <= 100):
        return False, "LED duty must be 0-100%"
    return True, ""
