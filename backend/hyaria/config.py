"""All runtime settings come from environment variables (or backend/.env)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

# Default ThingSpeak field mapping = what the existing prototype publishes.
DEFAULT_FIELD_MAP = {
    "humidity": "field1",
    "air_temp": "field2",
    "water_temp": "field3",
    "pump_state": "field4",
}


@dataclass
class Settings:
    # "hybrid" = real ThingSpeak sensors + simulated missing sensors (default)
    # "simulator" = everything simulated, "thingspeak" = real sensors only, no actuation
    data_source: str = os.getenv("HYARIA_DATA_SOURCE", "hybrid")
    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'hyaria.db'}")
    device_id: str = os.getenv("HYARIA_DEVICE_ID", "tower-1")
    crop: str = os.getenv("HYARIA_CROP", "lettuce")
    planted_days_ago: float = float(os.getenv("HYARIA_PLANTED_DAYS_AGO", "12"))
    tank_capacity_l: float = float(os.getenv("HYARIA_TANK_CAPACITY_L", "40"))
    tick_seconds: float = float(os.getenv("HYARIA_TICK_SECONDS", "5"))
    # Time multiplier when data_source == "simulator" (1 = real time, 60 = one simulated minute per second)
    sim_speed: float = float(os.getenv("HYARIA_SIM_SPEED", "1"))
    store_every_seconds: float = float(os.getenv("HYARIA_STORE_EVERY_SECONDS", "60"))
    start_engine: bool = os.getenv("HYARIA_START_ENGINE", "1") == "1"

    thingspeak_channel_id: str = os.getenv("THINGSPEAK_CHANNEL_ID", "")
    thingspeak_read_key: str = os.getenv("THINGSPEAK_READ_KEY", "")
    thingspeak_poll_seconds: float = float(os.getenv("THINGSPEAK_POLL_SECONDS", "20"))
    # Readings older than this are treated as missing and the simulator fills in.
    thingspeak_stale_seconds: float = float(os.getenv("THINGSPEAK_STALE_SECONDS", "900"))
    thingspeak_field_map: dict = field(
        default_factory=lambda: json.loads(os.getenv("THINGSPEAK_FIELD_MAP", "")) if os.getenv("THINGSPEAK_FIELD_MAP") else dict(DEFAULT_FIELD_MAP)
    )
    # Water level from the prototype: "percent" (0-100) or "cm" (distance from sensor to water)
    water_level_unit: str = os.getenv("THINGSPEAK_WATER_LEVEL_UNIT", "percent")
    tank_depth_cm: float = float(os.getenv("HYARIA_TANK_DEPTH_CM", "30"))

    cors_origins: list = field(default_factory=lambda: os.getenv("HYARIA_CORS_ORIGINS", "*").split(","))


settings = Settings()
