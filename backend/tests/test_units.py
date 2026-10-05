import math

import pytest

from hyaria.control import safety
from hyaria.control.dosing import DosingState, MIX_WAIT_S, dosing_step
from hyaria.control.lighting import LightState, lighting_step
from hyaria.control.misting import mist_off_minutes
from hyaria.health import health_score
from hyaria.models import Command
from hyaria.physics import ec_to_25c, ph_two_point, vpd_kpa
from hyaria.recipes import list_crops, load_recipe, stage_for_day
from hyaria.sensing import SensorFilter
from hyaria.sources.thingspeak import parse_feed

STAGE = load_recipe("lettuce")["stages"][1]  # Vegetative: pH 5.8-6.2, EC 1.2-1.6


def test_physics():
    assert vpd_kpa(25, 60) == pytest.approx(1.267, abs=0.01)
    assert vpd_kpa(25, 100) == 0
    assert ec_to_25c(1.5, 25) == pytest.approx(1.5)
    assert ec_to_25c(1.32, 19) == pytest.approx(1.5, abs=0.01)
    assert ph_two_point(1.5, v4=2.0, v7=1.5) == pytest.approx(7.0)
    assert ph_two_point(2.0, v4=2.0, v7=1.5) == pytest.approx(4.0)


def test_recipes_valid():
    assert {"lettuce", "spinach", "basil"} <= set(list_crops())
    for crop in list_crops():
        r = load_recipe(crop)
        assert stage_for_day(r, 0)["name"] == "Seedling"
        assert stage_for_day(r, 500)["name"] == "Mature"


def test_hampel_removes_spike_and_flags_fault():
    f = SensorFilter("ph")
    for i in range(6):
        f.update(6.0 + 0.01 * (i % 2), i * 10)
    value, status = f.update(7.5, 70)
    assert status == "OK" and value < 6.1
    _, status = f.update(15.0, 80)
    assert status == "FAULT"


def test_stuck_sensor_detected():
    f = SensorFilter("ph")
    status = "OK"
    for i in range(200):
        _, status = f.update(6.0, i * 10)
    assert status == "STUCK"


def test_ec_low_doses_a_and_b_then_learns():
    st = DosingState()
    cmds, _ = dosing_step(st, 0, ec=1.0, ph=6.0, volume_l=40, capacity_l=40, stage=STAGE)
    assert [c.actuator for c in cmds] == ["dose_a", "dose_b"]
    ml = cmds[0].amount
    assert ml == pytest.approx(0.7 * (1.4 - 1.0) * 40 / 0.5, rel=0.01)
    # still mixing -> nothing
    cmds, notes = dosing_step(st, MIX_WAIT_S / 2, ec=1.2, ph=6.0, volume_l=40, capacity_l=40, stage=STAGE)
    assert cmds == [] and "mixing" in notes[0]
    # tank responded with true k=0.3 -> learned gain moves from 0.5 toward 0.3
    ec_after = 1.0 + 0.3 * ml / 40
    dosing_step(st, MIX_WAIT_S + 1, ec=ec_after, ph=6.0, volume_l=40, capacity_l=40, stage=STAGE)
    assert 0.3 < st.k_ec < 0.5


def test_no_response_is_flagged():
    st = DosingState()
    cmds, _ = dosing_step(st, 0, ec=1.0, ph=6.0, volume_l=40, capacity_l=40, stage=STAGE)
    dosing_step(st, MIX_WAIT_S + 1, ec=1.0, ph=6.0, volume_l=40, capacity_l=40, stage=STAGE)
    assert st.response_issue and "stock bottle" in st.response_issue


def test_high_ec_dilutes_and_ph_corrected_when_settled():
    st = DosingState()
    cmds, _ = dosing_step(st, 0, ec=2.0, ph=6.0, volume_l=30, capacity_l=40, stage=STAGE)
    assert cmds[0].actuator == "water_add" and cmds[0].amount == 10.0
    st = DosingState()
    cmds, _ = dosing_step(st, 0, ec=1.4, ph=6.8, volume_l=40, capacity_l=40, stage=STAGE)
    assert cmds[0].actuator == "ph_down"
    cmds, _ = dosing_step(DosingState(), 0, ec=1.4, ph=6.1, volume_l=40, capacity_l=40, stage=STAGE)
    assert cmds == []   # inside deadband


def test_dose_rate_limit():
    st = DosingState(cycle_times=[0, 100, 200])
    cmds, notes = dosing_step(st, 300, ec=1.0, ph=6.0, volume_l=40, capacity_l=40, stage=STAGE)
    assert cmds == [] and "limit" in notes[-1]


def test_misting_interval_follows_vpd():
    hot_dry, _ = mist_off_minutes(STAGE, 30, 40, 20, True)
    cool_humid, _ = mist_off_minutes(STAGE, 18, 85, 20, True)
    assert hot_dry < STAGE["mist_off_min"] < cool_humid
    warm_roots, _ = mist_off_minutes(STAGE, 30, 40, 26, True)
    assert warm_roots == pytest.approx(hot_dry * 0.75, rel=0.02)
    night, _ = mist_off_minutes(STAGE, 18, 85, 20, False)
    assert night > cool_humid


def test_lighting_off_at_night_on_by_day():
    import time
    recipe = load_recipe("lettuce")
    base = time.mktime((2026, 10, 5, 2, 0, 0, 0, 0, -1))   # 02:00 local
    cmds, info = lighting_step(LightState(pwm=50), base, 0, recipe, STAGE)
    assert info["pwm"] == 0 and cmds and cmds[0].amount == 0
    st = LightState()
    noon = time.mktime((2026, 10, 5, 12, 0, 0, 0, 0, -1))
    cmds, info = lighting_step(st, noon, 2000, recipe, STAGE)
    assert info["pwm"] > 0 and cmds[0].actuator == "led"


def test_safety_rules():
    mist = Command("mist", 5)
    assert safety.check(mist, 0, 50, True, False)[0]
    assert not safety.check(mist, 0, 10, True, False)[0]
    assert not safety.check(mist, 0, None, False, False)[0]
    assert not safety.check(Command("mist", 60), 0, 50, True, False)[0]
    assert not safety.check(Command("ph_down", 5), 0, 50, True, True)[0]
    assert safety.check(Command("ph_down", 5, source="manual"), 0, 50, True, True)[0]
    assert not safety.check(Command("led", 120), 0, 50, True, False)[0]
    assert not safety.check(Command("mist", 5, expires_at=1), 2, 50, True, False)[0]


def test_health_score():
    ok = {s: {"value": v, "status": "OK"} for s, v in
          {"ph": 6.0, "ec": 1.4, "water_temp": 20, "air_temp": 21, "humidity": 62}.items()}
    h = health_score(ok, STAGE)
    assert h["score"] == 100 and h["band"] == "Good"
    bad = dict(ok, ph={"value": 6.7, "status": "OK"})
    h = health_score(bad, STAGE)
    assert h["score"] < 100 and "pH is high" in h["reason"]


def test_thingspeak_parse_feed():
    feed = {"created_at": "2026-10-05T10:00:00Z", "field1": "61.5", "field2": "24.2", "field3": "21.1",
            "field4": "1", "field5": "12"}
    fm = {"humidity": "field1", "air_temp": "field2", "water_temp": "field3", "pump_state": "field4",
          "water_level": "field5"}
    ts, vals = parse_feed(feed, fm, water_level_unit="cm", tank_depth_cm=30)
    assert vals["humidity"] == 61.5 and vals["air_temp"] == 24.2
    assert vals["water_level"] == pytest.approx(60.0)
    assert math.isclose(ts, 1791194400.0)
