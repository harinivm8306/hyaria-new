"""A16 N/P/K dosing with ion sensors + camera, its safety limits, and the plant camera API."""
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from hyaria import api, db, vision
from hyaria.control import safety
from hyaria.control.npk import MIX_WAIT_S, NpkState, npk_step
from hyaria.engine import Engine
from hyaria.models import Command
from hyaria.recipes import load_recipe
from hyaria.sources.simulator import NPK_GAIN_TRUE, TankSimulator

STAGE = load_recipe("lettuce")["stages"][1]  # Vegetative: N 140-190, P 35-55, K 180-240
OK_IONS = {"n": 165.0, "p": 45.0, "k": 210.0}


def cam(label, conf=0.9):
    return {"available": True, "label": label, "confidence": conf, "low_confidence": conf < 0.6}


def test_low_ion_doses_that_nutrient_then_learns_gain():
    st = NpkState()
    cmds, status, issues = npk_step(st, 0, {**OK_IONS, "k": 150.0}, 40, STAGE, ph_in_band=True)
    assert [c.actuator for c in cmds] == ["dose_k"]
    assert status["k"]["state"] == "low" and status["n"]["state"] == "ok" and not issues
    ml = cmds[0].amount
    # still mixing: nothing new
    cmds, status, _ = npk_step(st, 60, {**OK_IONS, "k": 150.0}, 40, STAGE, True)
    assert not cmds and "mixing" in status["note"]
    # after mixing, K rose by 4 ppm per ml/L -> gain moves from 5 toward 4
    after = 150.0 + 4.0 * ml / 40
    npk_step(st, MIX_WAIT_S + 1, {**OK_IONS, "k": after}, 40, STAGE, True)
    assert st.gain_k == pytest.approx(5.0 + 0.2 * (4.0 - 5.0), rel=0.01)


def test_most_short_nutrient_first_one_at_a_time():
    st = NpkState()
    cmds, _, _ = npk_step(st, 0, {"n": 130.0, "p": 20.0, "k": 210.0}, 40, STAGE, True)
    assert [c.actuator for c in cmds] == ["dose_p"]       # P is 43% short, N only 7%


def test_camera_alone_never_doses():
    st = NpkState()
    st.note_vision(cam("k_deficient"), 0)
    st.note_vision(cam("k_deficient"), 1)
    cmds, status, issues = npk_step(st, 10, OK_IONS, 40, STAGE, True)
    assert not cmds
    assert status["k"]["camera_deficient"]
    assert any(i["key"] == "npk:uptake_k" and "uptake problem" in i["message"] for i in issues)
    # probe missing + camera deficiency -> ask for a manual check, still no dose
    cmds, status, issues = npk_step(st, 20, {**OK_IONS, "k": None}, 40, STAGE, True)
    assert not cmds and status["k"]["state"] == "unknown"
    assert any(i["key"] == "npk:check_k" for i in issues)


def test_camera_needs_two_confident_photos():
    st = NpkState()
    st.note_vision(cam("n_deficient"), 0)
    assert not st.camera_says("n")
    st.note_vision(cam("n_deficient", conf=0.4), 1)        # low confidence ignored
    assert not st.camera_says("n")
    st.note_vision(cam("n_deficient"), 2)
    assert st.camera_says("n")
    st.note_vision(cam("healthy"), 3)
    assert not st.camera_says("n")


def test_waits_for_ph_and_hourly_cap():
    st = NpkState()
    low = {**OK_IONS, "n": 100.0}
    cmds, status, _ = npk_step(st, 0, low, 40, STAGE, ph_in_band=False)
    assert not cmds and "pH" in status["note"]
    t = 0
    doses = 0
    for _ in range(4):                                     # 45 min
        cmds, _, _ = npk_step(st, t, low, 40, STAGE, True)
        doses += len(cmds)
        t += MIX_WAIT_S + 1
    assert doses == 2                                       # MAX_DOSES_PER_HOUR


def test_empty_bottle_flagged():
    st = NpkState()
    npk_step(st, 0, {**OK_IONS, "n": 100.0}, 40, STAGE, True)
    _, _, issues = npk_step(st, MIX_WAIT_S + 1, {**OK_IONS, "n": 100.0}, 40, STAGE, True)
    assert any(i["key"] == "npk:no_response" for i in issues)


def test_safety_limits_for_npk_pumps():
    ok, _ = safety.check(Command("dose_n", 10), 0, 50, True, mixing=False)
    assert ok
    assert not safety.check(Command("dose_n", 40), 0, 50, True, False)[0]
    assert "locked" in safety.check(Command("dose_k", 5), 0, 10, True, False)[1]
    assert "mixing" in safety.check(Command("dose_p", 5), 0, 50, True, False, ph_mixing=True)[1]
    assert "EC" in safety.check(Command("dose_p", 5), 0, 50, True, False, ec=2.3)[1]
    assert safety.check(Command("dose_p", 5, source="manual"), 0, 50, True, True)[0]


def test_engine_restores_depleted_potassium(sim_settings, clock):
    now = clock()
    sim = TankSimulator(capacity_l=40, planted_at=now - 12 * 86400, seed=4, start=now)
    engine = Engine(sim_settings, source=sim, clock=clock)
    sim.set_fault("low_k", True)
    for _ in range(int(2 * 86400 / 60)):
        clock.advance(60)
        engine.tick()
    acts = db.recent_actions(sim_settings.device_id, 2000)
    k_doses = [a for a in acts if a["actuator"] == "dose_k" and a["status"] == "done"]
    assert k_doses, "K was stripped fast but never dosed"
    lo, hi = engine.stage(clock())["npk"]["k"]
    assert sim.ions["k"] >= lo * 0.9
    assert engine.npk.gain_k == pytest.approx(NPK_GAIN_TRUE["k"], rel=0.35)
    # dosing K must not push EC past the safety cap
    assert sim.ec < safety.MAX_EC_FOR_NPK


def _jpeg(color=(40, 160, 50)):
    img = Image.new("RGB", (320, 240), (90, 70, 50))
    for x in range(80, 240):
        for y in range(60, 180):
            img.putpixel((x, y), color)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def test_canopy_cover_counts_green():
    pct = vision.canopy_cover_pct(vision.load_rgb(_jpeg()))
    assert 20 <= pct <= 30                                 # 160x120 of 320x240 = 25%


def test_camera_upload_list_and_file(sim_settings, clock, tmp_path):
    sim_settings.images_dir = str(tmp_path / "imgs")
    sim = TankSimulator(capacity_l=40, planted_at=clock() - 12 * 86400, seed=3, start=clock())
    engine = Engine(sim_settings, source=sim, clock=clock)
    clock.advance(60)
    engine.tick()
    api.bind_engine(engine)
    app = FastAPI()
    app.include_router(api.router)
    c = TestClient(app)
    dev = sim_settings.device_id

    r = c.post(f"/api/devices/{dev}/images", files={"file": ("p.jpg", _jpeg(), "image/jpeg")}, data={"note": "tier 2"})
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["stage"] == "Vegetative" and row["note"] == "tier 2" and 20 <= row["canopy_pct"] <= 30
    assert "npk" in row["result"]                            # model result, or why it is unavailable
    lst = c.get(f"/api/devices/{dev}/images").json()
    assert [i["id"] for i in lst] == [row["id"]] and "path" not in lst[0]
    f = c.get(lst[0]["url"])
    assert f.status_code == 200 and f.headers["content-type"] == "image/jpeg"
    assert c.post(f"/api/devices/{dev}/images", files={"file": ("x.jpg", b"not an image", "image/jpeg")}).status_code == 400
    assert c.delete(f"/api/images/{row['id']}").json() == {"deleted": row["id"]}
    assert c.get(f"/api/devices/{dev}/images").json() == []
    assert "npk" in c.get(f"/api/devices/{dev}/live").json()["controllers"]
