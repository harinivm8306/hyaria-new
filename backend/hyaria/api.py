"""REST API for the farmer app. Mounted under /api by main.py."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db
from .models import ACTUATORS, SENSORS
from .recipes import list_crops, load_recipe, save_recipe
from . import vision

router = APIRouter(prefix="/api", tags=["hyaria"])
MAX_IMAGE_BYTES = 12 * 1024 * 1024
SIM_FAULTS = ("pump_fail", "ph_stuck", "leak", "heatwave", "low_n", "low_p", "low_k", "empty_n", "empty_p", "empty_k")
_engine = None


def bind_engine(engine) -> None:
    global _engine
    _engine = engine


def eng():
    if _engine is None:
        raise HTTPException(503, "control engine not running")
    return _engine


def _check_device(device_id: str):
    e = eng()
    if device_id != e.s.device_id:
        raise HTTPException(404, f"unknown device '{device_id}'")
    return e


class OverrideIn(BaseModel):
    actuator: str = Field(..., description=f"one of {sorted(ACTUATORS)}")
    amount: float
    reason: Optional[str] = None


class ModeIn(BaseModel):
    auto: bool


class CycleIn(BaseModel):
    crop: str
    planted_days_ago: float = 0.0


class FaultIn(BaseModel):
    fault: str = Field(..., description="pump_fail | ph_stuck | leak | heatwave | low_n | low_p | low_k | empty_n | empty_p | empty_k")
    on: bool = True


@router.get("/status")
def status():
    e = eng()
    return {"ok": True, "engine_ticks": e.tick_count, "last_tick": e.last_tick, "data_source": e.source.info(),
            "devices": [e.s.device_id], "time": time.time()}


@router.get("/devices")
def devices():
    e = eng()
    snap = e.snapshot()
    return [{"device_id": e.s.device_id, "crop": snap["crop"], "stage": snap["stage"]["name"],
             "health": snap["health"], "active_alerts": len(snap["alerts"])}]


@router.get("/devices/{device_id}/live")
def live(device_id: str):
    return _check_device(device_id).snapshot()


@router.get("/devices/{device_id}/history")
def history(device_id: str, sensor: str = Query("ph"), hours: float = Query(24, gt=0, le=24 * 90)):
    e = _check_device(device_id)
    if sensor not in SENSORS:
        raise HTTPException(400, f"sensor must be one of {SENSORS}")
    now = e.last_tick or time.time()
    return {"sensor": sensor, "points": db.history(device_id, sensor, now - hours * 3600)}


@router.get("/devices/{device_id}/history/all")
def history_all(device_id: str, hours: float = Query(24, gt=0, le=24 * 90)):
    e = _check_device(device_id)
    now = e.last_tick or time.time()
    return {s: db.history(device_id, s, now - hours * 3600, limit=1000) for s in SENSORS}


@router.get("/devices/{device_id}/actions")
def actions(device_id: str, limit: int = Query(50, ge=1, le=500)):
    _check_device(device_id)
    return db.recent_actions(device_id, limit)


@router.post("/devices/{device_id}/override")
def override(device_id: str, body: OverrideIn):
    e = _check_device(device_id)
    try:
        return e.override(body.actuator, body.amount, body.reason or "manual override")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/devices/{device_id}/mode")
def mode(device_id: str, body: ModeIn):
    e = _check_device(device_id)
    e.set_auto(body.auto)
    return {"auto": e.auto}


@router.post("/devices/{device_id}/cycle")
def new_cycle(device_id: str, body: CycleIn):
    e = _check_device(device_id)
    try:
        return e.new_cycle(body.crop, (e.last_tick or time.time()) - body.planted_days_ago * 86400)
    except KeyError as exc:
        raise HTTPException(404, str(exc))


@router.get("/alerts")
def alerts(active: bool = True, limit: int = Query(100, ge=1, le=1000)):
    return db.list_alerts(None, active_only=active, limit=limit)


@router.post("/alerts/{alert_id}/ack")
def ack(alert_id: int):
    if not db.ack_alert(alert_id):
        raise HTTPException(404, "alert not found")
    return {"acknowledged": alert_id}


@router.get("/recipes")
def recipes():
    return list_crops()


@router.get("/recipes/{crop}")
def recipe(crop: str):
    try:
        return load_recipe(crop)
    except KeyError as exc:
        raise HTTPException(404, str(exc))


@router.put("/recipes/{crop}")
def put_recipe(crop: str, body: dict):
    if body.get("crop") != crop:
        raise HTTPException(400, "body.crop must match the URL")
    try:
        save_recipe(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    e = eng()
    if e.cycle["crop"] == crop:
        e.reload_recipe()
    return body


@router.post("/sim/fault")
def sim_fault(body: FaultIn):
    """Demo helper: inject a fault into the simulator to show alerts and safety."""
    sim = eng().simulator()
    if sim is None:
        raise HTTPException(400, "no simulator in this data source")
    if body.fault not in SIM_FAULTS:
        raise HTTPException(400, "unknown fault")
    sim.set_fault(body.fault, body.on)
    return sim.info()


# ---------------------------------------------------------------- plant camera (1a) + N/P/K model (1c)

async def _read_image(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "photo larger than 12 MB")
    return data


def _analyse(data: bytes) -> dict:
    try:
        return vision.analyse(data)
    except Exception:
        raise HTTPException(400, "not a readable image (use JPG or PNG)")


def _image_out(row: dict) -> dict:
    row = dict(row)
    row.pop("path", None)
    row["url"] = f"/api/images/{row['id']}/file"
    return row


@router.post("/devices/{device_id}/images")
async def upload_image(device_id: str, file: UploadFile = File(...), note: Optional[str] = Form(None)):
    """Store one plant photo, measure canopy cover, run the N/P/K model, and tell A16 what the camera saw."""
    e = _check_device(device_id)
    data = await _read_image(file)
    result = _analyse(data)
    now = e.last_tick or time.time()
    rel = Path(time.strftime("%Y-%m-%d", time.localtime(now))) / f"{device_id}_{int(now * 1000)}.jpg"
    full = Path(e.s.images_dir) / rel
    full.parent.mkdir(parents=True, exist_ok=True)
    img = vision.load_rgb(data)
    img.thumbnail((1600, 1600))
    img.save(full, "JPEG", quality=88)
    npk = result["npk"]
    row = {"ts": now, "device_id": device_id, "path": rel.as_posix(), "width": result["width"],
           "height": result["height"], "day": round(e.day(now), 2), "stage": e.stage(now)["name"],
           "canopy_pct": result["canopy_pct"], "npk_label": npk.get("label"), "npk_confidence": npk.get("confidence"),
           "result_json": json.dumps(result), "note": note}
    row["id"] = db.insert_image(row)
    e.note_vision(npk, now)
    row.pop("result_json")
    row["result"] = result
    return _image_out(row)


@router.get("/devices/{device_id}/images")
def list_images(device_id: str, limit: int = Query(200, ge=1, le=2000)):
    _check_device(device_id)
    return [_image_out(r) for r in db.list_images(device_id, limit)]


@router.get("/images/{image_id}/file")
def image_file(image_id: int):
    row = db.get_image(image_id)
    if not row:
        raise HTTPException(404, "image not found")
    root = Path(eng().s.images_dir).resolve()
    full = (root / row["path"]).resolve()
    if root not in full.parents or not full.exists():
        raise HTTPException(404, "image file missing")
    return FileResponse(full, media_type="image/jpeg")


@router.delete("/images/{image_id}")
def remove_image(image_id: int):
    row = db.get_image(image_id)
    if not row:
        raise HTTPException(404, "image not found")
    full = Path(eng().s.images_dir) / row["path"]
    full.unlink(missing_ok=True)
    db.delete_image(image_id)
    return {"deleted": image_id}


@router.get("/vision/npk")
def npk_model_info():
    clf = vision.get_classifier()
    card = vision.MODEL_DIR / "npk_metrics.json"
    return {"available": clf is not None, "reason": None if clf else vision._clf_error,
            "classes": clf.classes if clf else None, "min_confidence": vision.MIN_CONFIDENCE,
            "metrics": json.loads(card.read_text()) if card.exists() else None}


@router.post("/vision/npk")
async def npk_predict(file: UploadFile = File(...)):
    """Try the N/P/K model on a photo without saving it or affecting control."""
    return _analyse(await _read_image(file))
