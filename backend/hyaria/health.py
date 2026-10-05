"""A7 - plant health score 0-100 with the main reason."""
from __future__ import annotations

TOLERANCE = {"ph": 0.5, "ec": 0.5, "water_temp": 5.0, "air_temp": 5.0, "humidity": 15.0}
WEIGHTS = {"ph": 0.25, "ec": 0.25, "water_temp": 0.20, "air_temp": 0.15, "humidity": 0.15}
LABEL = {"ph": "pH", "ec": "EC", "water_temp": "root-zone temperature", "air_temp": "air temperature", "humidity": "humidity"}


def desirability(value: float, lo: float, hi: float, tol: float) -> float:
    if lo <= value <= hi:
        return 1.0
    dist = lo - value if value < lo else value - hi
    return max(0.0, 1.0 - dist / tol)


def health_score(latest: dict, stage: dict, vision_severity_pct: float | None = None) -> dict:
    parts = {}
    for s, w in WEIGHTS.items():
        r = latest.get(s)
        if not r or r["status"] != "OK" or r["value"] is None:
            continue
        lo, hi = stage[s]
        parts[s] = desirability(r["value"], lo, hi, TOLERANCE[s])
    if not parts:
        return {"score": None, "band": "Unknown", "reason": "no valid sensor data", "parts": {}}
    total_w = sum(WEIGHTS[s] for s in parts)
    env = 100.0 * sum(WEIGHTS[s] * d for s, d in parts.items()) / total_w
    score = env if vision_severity_pct is None else 0.6 * env + 0.4 * (100.0 - vision_severity_pct)
    band = "Good" if score >= 80 else "Watch" if score >= 60 else "Act"
    worst = min(parts, key=parts.get)
    if parts[worst] >= 1.0:
        reason = "all parameters inside the recipe range"
    else:
        r = latest[worst]["value"]
        lo, hi = stage[worst]
        reason = f"{LABEL[worst]} is {'low' if r < lo else 'high'} ({r:.2f}, target {lo}-{hi})"
    return {"score": round(score, 1), "env_score": round(env, 1), "band": band, "reason": reason,
            "parts": {k: round(v, 3) for k, v in parts.items()}}
