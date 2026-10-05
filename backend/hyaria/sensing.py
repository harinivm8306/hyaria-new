"""A1 - sensor cleaning: Hampel spike filter -> EMA smoothing -> range check -> stuck check."""
from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass, field

# Physically possible ranges; outside = FAULT
VALID_RANGE = {
    "ph": (0.0, 14.0), "ec": (0.0, 10.0), "water_temp": (0.0, 50.0), "air_temp": (-10.0, 60.0),
    "humidity": (0.0, 100.0), "light_lux": (0.0, 200000.0), "water_level": (0.0, 100.0), "pump_state": (0.0, 1.0),
}
# Below this std over STUCK_WINDOW_S the probe is considered frozen
NOISE_FLOOR = {"ph": 0.005, "ec": 0.003, "water_temp": 0.02, "air_temp": 0.02, "humidity": 0.05}
STUCK_WINDOW_S = 30 * 60
HAMPEL_WINDOW = 5
HAMPEL_K = 3.0
EMA_ALPHA = 0.3


@dataclass
class SensorFilter:
    sensor: str
    window: deque = field(default_factory=lambda: deque(maxlen=HAMPEL_WINDOW))
    history: deque = field(default_factory=deque)  # (ts, raw) for stuck detection
    ema: float | None = None
    status: str = "OK"

    def update(self, raw: float | None, ts: float) -> tuple[float | None, str]:
        if raw is None:
            self.status = "MISSING"
            return self.ema, self.status
        lo, hi = VALID_RANGE.get(self.sensor, (float("-inf"), float("inf")))
        if not (lo <= raw <= hi):
            self.status = "FAULT"
            return self.ema, self.status

        x = raw
        if len(self.window) >= 3:
            med = statistics.median(self.window)
            mad = statistics.median(abs(v - med) for v in self.window)
            scaled = 1.4826 * mad
            if scaled > 0 and abs(raw - med) > HAMPEL_K * scaled:
                x = med                      # spike -> replace with median
            elif scaled == 0 and self.sensor in NOISE_FLOOR and abs(raw - med) > 20 * NOISE_FLOOR[self.sensor]:
                x = med
        self.window.append(raw)
        self.ema = x if self.ema is None else EMA_ALPHA * x + (1 - EMA_ALPHA) * self.ema

        self.history.append((ts, raw))
        while self.history and ts - self.history[0][0] > STUCK_WINDOW_S:
            self.history.popleft()
        self.status = "OK"
        floor = NOISE_FLOOR.get(self.sensor)
        span = ts - self.history[0][0] if self.history else 0
        if floor and len(self.history) >= 10 and span >= STUCK_WINDOW_S * 0.9:
            if statistics.pstdev(v for _, v in self.history) < floor:
                self.status = "STUCK"
        return self.ema, self.status


class SensorBank:
    def __init__(self):
        self.filters: dict[str, SensorFilter] = {}

    def update(self, sensor: str, raw: float | None, ts: float) -> tuple[float | None, str]:
        f = self.filters.setdefault(sensor, SensorFilter(sensor))
        return f.update(raw, ts)
