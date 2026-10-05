"""Reads the prototype's real sensors from a ThingSpeak channel."""
from __future__ import annotations

import logging
import time
from datetime import datetime

import httpx

from ..models import Reading
from .base import DataSource

log = logging.getLogger("hyaria.thingspeak")


def parse_feed(feed: dict, field_map: dict, water_level_unit: str = "percent",
               tank_depth_cm: float = 30.0) -> tuple[float, dict[str, float]]:
    """Turn one ThingSpeak feed entry into (timestamp, {sensor: value})."""
    ts = datetime.fromisoformat(feed["created_at"].replace("Z", "+00:00")).timestamp()
    out: dict[str, float] = {}
    for sensor, fld in field_map.items():
        raw = feed.get(fld)
        if raw in (None, ""):
            continue
        try:
            val = float(raw)
        except ValueError:
            continue
        if sensor == "water_level" and water_level_unit == "cm":
            # ultrasonic distance from sensor to water surface -> percent full
            val = max(0.0, min(100.0, 100.0 * (tank_depth_cm - val) / tank_depth_cm))
        out[sensor] = val
    return ts, out


class ThingSpeakSource(DataSource):
    name = "thingspeak"
    can_actuate = False

    def __init__(self, channel_id: str, read_key: str, field_map: dict, poll_seconds: float = 20,
                 stale_seconds: float = 900, water_level_unit: str = "percent", tank_depth_cm: float = 30.0,
                 client: httpx.Client | None = None):
        self.channel_id = channel_id
        self.read_key = read_key
        self.field_map = field_map
        self.poll_seconds = poll_seconds
        self.stale_seconds = stale_seconds
        self.water_level_unit = water_level_unit
        self.tank_depth_cm = tank_depth_cm
        self.client = client or httpx.Client(timeout=8.0)
        self._last_poll = 0.0
        self._latest: dict[str, Reading] = {}
        self.last_error: str | None = None
        self.last_entry_at: float | None = None

    @property
    def configured(self) -> bool:
        return bool(self.channel_id)

    def poll(self, now: float | None = None) -> None:
        now = now or time.time()
        if not self.configured or now - self._last_poll < self.poll_seconds:
            return
        self._last_poll = now
        url = f"https://api.thingspeak.com/channels/{self.channel_id}/feeds.json"
        params = {"results": 2}
        if self.read_key:
            params["api_key"] = self.read_key
        try:
            res = self.client.get(url, params=params)
            res.raise_for_status()
            feeds = res.json().get("feeds") or []
            if not feeds:
                self.last_error = "channel has no entries"
                return
            ts, vals = parse_feed(feeds[-1], self.field_map, self.water_level_unit, self.tank_depth_cm)
            self.last_entry_at = ts
            self._latest = {k: Reading(v, "real", ts, raw=v) for k, v in vals.items()}
            self.last_error = None
        except Exception as exc:  # network errors must never stop the control loop
            self.last_error = str(exc)[:200]
            log.warning("ThingSpeak poll failed: %s", self.last_error)

    def read(self, now: float) -> dict[str, Reading]:
        self.poll(now)
        return {k: r for k, r in self._latest.items() if now - r.ts <= self.stale_seconds}

    def info(self) -> dict:
        return {"name": self.name, "can_actuate": False, "channel_id": self.channel_id,
                "field_map": self.field_map, "last_entry_at": self.last_entry_at, "last_error": self.last_error}
