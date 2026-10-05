"""Plant-environment formulas shared by controllers and the simulator."""
from __future__ import annotations

import math


def svp_kpa(temp_c: float) -> float:
    """Saturation vapour pressure (Tetens equation), kPa."""
    return 0.6108 * math.exp(17.27 * temp_c / (temp_c + 237.3))


def vpd_kpa(temp_c: float, rh_pct: float) -> float:
    """Vapour pressure deficit, kPa."""
    return max(0.0, svp_kpa(temp_c) * (1.0 - rh_pct / 100.0))


def lux_to_ppfd(lux: float) -> float:
    """Approximate PPFD (umol/m2/s) for white LED / daylight. Calibrate with a PAR meter if available."""
    return max(0.0, lux) / 54.0


def ec_to_25c(ec_measured: float, water_temp_c: float) -> float:
    """Temperature-compensate EC to 25 C (2%/C)."""
    return ec_measured / (1.0 + 0.02 * (water_temp_c - 25.0))


def ph_two_point(voltage: float, v4: float, v7: float) -> float:
    """Two-point pH calibration with pH 4.00 and 7.00 buffers."""
    if v7 == v4:
        raise ValueError("calibration voltages must differ")
    return 7.00 + (voltage - v7) * (7.00 - 4.00) / (v7 - v4)


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))
