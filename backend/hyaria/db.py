"""Database tables. SQLite by default; set DATABASE_URL for PostgreSQL/TimescaleDB."""
from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import (Boolean, Column, Float, Integer, MetaData, String, Table, Text,
                        create_engine, delete, insert, select, update, Index)

from .config import settings

metadata = MetaData()

readings = Table(
    "readings", metadata,
    Column("id", Integer, primary_key=True),
    Column("ts", Float, nullable=False),
    Column("device_id", String(64), nullable=False),
    Column("sensor", String(32), nullable=False),
    Column("value", Float),
    Column("raw", Float),
    Column("status", String(16), nullable=False, default="OK"),
    Column("source", String(16), nullable=False, default="sim"),
)
Index("ix_readings_dev_sensor_ts", readings.c.device_id, readings.c.sensor, readings.c.ts)

actions = Table(
    "actions", metadata,
    Column("id", Integer, primary_key=True),
    Column("ts", Float, nullable=False),
    Column("device_id", String(64), nullable=False),
    Column("actuator", String(32), nullable=False),
    Column("amount", Float),
    Column("unit", String(16)),
    Column("reason", Text),
    Column("source", String(16), nullable=False),  # ai | manual | safety
    Column("status", String(16), nullable=False, default="done"),  # done | blocked | failed
)
Index("ix_actions_dev_ts", actions.c.device_id, actions.c.ts)

alerts = Table(
    "alerts", metadata,
    Column("id", Integer, primary_key=True),
    Column("ts", Float, nullable=False),
    Column("device_id", String(64), nullable=False),
    Column("type", String(48), nullable=False),
    Column("severity", String(16), nullable=False),  # warning | critical
    Column("message", Text),
    Column("active", Boolean, nullable=False, default=True),
    Column("acknowledged", Boolean, nullable=False, default=False),
    Column("cleared_at", Float),
)

crop_cycles = Table(
    "crop_cycles", metadata,
    Column("id", Integer, primary_key=True),
    Column("device_id", String(64), nullable=False),
    Column("crop", String(32), nullable=False),
    Column("planted_at", Float, nullable=False),
    Column("harvested_at", Float),
    Column("yield_g", Float),
)

controller_state = Table(
    "controller_state", metadata,
    Column("device_id", String(64), primary_key=True),
    Column("state_json", Text, nullable=False),
    Column("updated_at", Float, nullable=False),
)

images = Table(
    "images", metadata,
    Column("id", Integer, primary_key=True),
    Column("ts", Float, nullable=False),
    Column("device_id", String(64), nullable=False),
    Column("path", Text, nullable=False),          # relative to settings.images_dir
    Column("width", Integer),
    Column("height", Integer),
    Column("day", Float),                          # days since planting
    Column("stage", String(32)),
    Column("canopy_pct", Float),                   # green leaf share of the photo
    Column("npk_label", String(32)),               # healthy | n_deficient | ... | None if no model
    Column("npk_confidence", Float),
    Column("result_json", Text),
    Column("note", Text),
)
Index("ix_images_dev_ts", images.c.device_id, images.c.ts)

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        kwargs: dict[str, Any] = {"future": True}
        if settings.database_url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        _engine = create_engine(settings.database_url, **kwargs)
        metadata.create_all(_engine)
    return _engine


def reset_engine(url: str | None = None):
    """Used by tests to point at a fresh database."""
    global _engine
    if url:
        settings.database_url = url
    _engine = None
    return get_engine()


# ---------- small helpers used by the engine and API ----------

def insert_readings(rows: list[dict]) -> None:
    if rows:
        with get_engine().begin() as conn:
            conn.execute(insert(readings), rows)


def insert_action(row: dict) -> int:
    with get_engine().begin() as conn:
        return conn.execute(insert(actions), row).inserted_primary_key[0]


def history(device_id: str, sensor: str, since: float, limit: int = 2000) -> list[dict]:
    q = (select(readings.c.ts, readings.c.value, readings.c.status, readings.c.source)
         .where(readings.c.device_id == device_id, readings.c.sensor == sensor, readings.c.ts >= since)
         .order_by(readings.c.ts.desc()).limit(limit))
    with get_engine().connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(q)]
    rows.reverse()
    return rows


def recent_actions(device_id: str, limit: int = 50) -> list[dict]:
    q = select(actions).where(actions.c.device_id == device_id).order_by(actions.c.ts.desc()).limit(limit)
    with get_engine().connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


def list_alerts(device_id: str | None = None, active_only: bool = True, limit: int = 100) -> list[dict]:
    q = select(alerts)
    if device_id:
        q = q.where(alerts.c.device_id == device_id)
    if active_only:
        q = q.where(alerts.c.active.is_(True))
    q = q.order_by(alerts.c.ts.desc()).limit(limit)
    with get_engine().connect() as conn:
        return [dict(r._mapping) for r in conn.execute(q)]


def open_alert(device_id: str, type_: str, severity: str, message: str, ts: float) -> int:
    with get_engine().begin() as conn:
        return conn.execute(insert(alerts), {
            "ts": ts, "device_id": device_id, "type": type_, "severity": severity,
            "message": message, "active": True, "acknowledged": False,
        }).inserted_primary_key[0]


def clear_alert(alert_id: int, ts: float) -> None:
    with get_engine().begin() as conn:
        conn.execute(update(alerts).where(alerts.c.id == alert_id).values(active=False, cleared_at=ts))


def ack_alert(alert_id: int) -> bool:
    with get_engine().begin() as conn:
        res = conn.execute(update(alerts).where(alerts.c.id == alert_id).values(acknowledged=True))
        return res.rowcount > 0


def load_controller_state(device_id: str) -> dict:
    with get_engine().connect() as conn:
        row = conn.execute(select(controller_state.c.state_json).where(controller_state.c.device_id == device_id)).first()
    return json.loads(row[0]) if row else {}


def save_controller_state(device_id: str, state: dict) -> None:
    payload = json.dumps(state)
    with get_engine().begin() as conn:
        conn.execute(delete(controller_state).where(controller_state.c.device_id == device_id))
        conn.execute(insert(controller_state), {"device_id": device_id, "state_json": payload, "updated_at": time.time()})


def active_cycle(device_id: str) -> dict | None:
    q = (select(crop_cycles).where(crop_cycles.c.device_id == device_id, crop_cycles.c.harvested_at.is_(None))
         .order_by(crop_cycles.c.planted_at.desc()))
    with get_engine().connect() as conn:
        row = conn.execute(q).first()
    return dict(row._mapping) if row else None


def start_cycle(device_id: str, crop: str, planted_at: float) -> dict:
    with get_engine().begin() as conn:
        conn.execute(update(crop_cycles).where(crop_cycles.c.device_id == device_id,
                                               crop_cycles.c.harvested_at.is_(None)).values(harvested_at=planted_at))
        conn.execute(insert(crop_cycles), {"device_id": device_id, "crop": crop, "planted_at": planted_at})
    return active_cycle(device_id)


def insert_image(row: dict) -> int:
    with get_engine().begin() as conn:
        return conn.execute(insert(images), row).inserted_primary_key[0]


def _image_row(r) -> dict:
    d = dict(r._mapping)
    d["result"] = json.loads(d.pop("result_json") or "{}")
    return d


def list_images(device_id: str, limit: int = 200) -> list[dict]:
    q = select(images).where(images.c.device_id == device_id).order_by(images.c.ts.desc()).limit(limit)
    with get_engine().connect() as conn:
        return [_image_row(r) for r in conn.execute(q)]


def get_image(image_id: int) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(select(images).where(images.c.id == image_id)).first()
    return _image_row(row) if row else None


def delete_image(image_id: int) -> None:
    with get_engine().begin() as conn:
        conn.execute(delete(images).where(images.c.id == image_id))


def prune_readings(older_than: float) -> None:
    with get_engine().begin() as conn:
        conn.execute(delete(readings).where(readings.c.ts < older_than))
