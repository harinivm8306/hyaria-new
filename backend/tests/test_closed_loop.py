"""Run the whole engine against the simulator for several simulated days."""
import httpx
import pytest

from hyaria import db
from hyaria.engine import Engine
from hyaria.sources.hybrid import HybridSource
from hyaria.sources.simulator import K_TRUE, TankSimulator
from hyaria.sources.thingspeak import ThingSpeakSource

STEP = 60  # seconds per tick


def run(engine, clock, seconds):
    for _ in range(int(seconds / STEP)):
        clock.advance(STEP)
        engine.tick()


def make(sim_settings, clock, seed=1):
    now = clock()
    sim = TankSimulator(capacity_l=40, planted_at=now - 12 * 86400, seed=seed, start=now)
    return Engine(sim_settings, source=sim, clock=clock), sim


def test_three_days_keeps_ph_and_ec_in_band(sim_settings, clock):
    engine, sim = make(sim_settings, clock)
    run(engine, clock, 86400)            # day 1: settle + learn
    in_band = total = 0
    for _ in range(2 * 86400 // STEP):
        clock.advance(STEP)
        engine.tick()
        stage = engine.stage(clock())
        total += 1
        ph_ok = stage["ph"][0] - 0.15 <= sim.ph <= stage["ph"][1] + 0.15
        ec_ok = stage["ec"][0] - 0.1 <= sim.ec <= stage["ec"][1] + 0.1
        in_band += ph_ok and ec_ok
    assert in_band / total > 0.9, f"only {in_band / total:.0%} of time in band"
    # learned nutrient gain close to the hidden true value
    assert engine.dosing.k_ec == pytest.approx(K_TRUE, rel=0.25)
    acts = db.recent_actions(sim_settings.device_id, 500)
    assert any(a["actuator"] == "mist" and a["status"] == "done" for a in acts)
    assert any(a["actuator"] in ("dose_a", "ph_down") for a in acts)
    assert engine.health["score"] >= 80


def test_pump_failure_raises_critical_alert(sim_settings, clock):
    engine, sim = make(sim_settings, clock)
    run(engine, clock, 1800)
    sim.set_fault("pump_fail", True)
    run(engine, clock, 1800)
    types = {a["type"] for a in db.list_alerts(sim_settings.device_id)}
    assert "actuator:mist" in types
    failed = [a for a in db.recent_actions(sim_settings.device_id, 500) if a["status"] == "failed"]
    assert 3 <= len(failed) <= 10, "a broken pump should be retried once per interval, not every tick"
    sim.set_fault("pump_fail", False)
    run(engine, clock, 1800)
    types = {a["type"] for a in db.list_alerts(sim_settings.device_id)}
    assert "actuator:mist" not in types


def test_leak_locks_pumps(sim_settings, clock):
    engine, sim = make(sim_settings, clock)
    sim.volume_l = 8.0
    sim.set_fault("leak", True)
    run(engine, clock, 3 * 3600)
    acts = db.recent_actions(sim_settings.device_id, 200)
    blocked = [a for a in acts if a["status"] == "blocked"]
    assert blocked and "pumps locked" in blocked[0]["reason"]
    types = {a["type"] for a in db.list_alerts(sim_settings.device_id)}
    assert "limit:water_level" in types


def test_stuck_ph_probe_stops_ph_dosing(sim_settings, clock):
    engine, sim = make(sim_settings, clock)
    run(engine, clock, 3600)
    sim.set_fault("ph_stuck", True)
    run(engine, clock, 2 * 3600)
    assert engine.latest["ph"]["status"] == "STUCK"
    types = {a["type"] for a in db.list_alerts(sim_settings.device_id)}
    assert "sensor:ph" in types


def test_hybrid_uses_real_thingspeak_values(sim_settings, clock):
    def handler(request):
        return httpx.Response(200, json={"feeds": [{"created_at": "2025-10-09T08:53:20Z",
                                                    "field1": "58.0", "field2": "27.5", "field3": "22.0", "field4": "0"}]})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    ts = ThingSpeakSource("123", "", {"humidity": "field1", "air_temp": "field2", "water_temp": "field3",
                                      "pump_state": "field4"}, poll_seconds=0, stale_seconds=10 ** 9, client=client)
    now = clock()
    sim = TankSimulator(capacity_l=40, planted_at=now - 5 * 86400, seed=2, start=now)
    engine = Engine(sim_settings, source=HybridSource(sim, ts), clock=clock)
    run(engine, clock, 600)
    r = engine.latest
    assert r["air_temp"]["source"] == "real" and r["air_temp"]["value"] == pytest.approx(27.5, abs=0.01)
    assert r["ph"]["source"] == "sim"
    assert sim.air_temp == pytest.approx(27.5)   # simulator follows the real room
