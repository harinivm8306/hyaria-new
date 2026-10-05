from fastapi import FastAPI
from fastapi.testclient import TestClient

from hyaria import api
from hyaria.engine import Engine
from hyaria.sources.simulator import TankSimulator


def make_client(sim_settings, clock):
    sim = TankSimulator(capacity_l=40, planted_at=clock() - 12 * 86400, seed=3, start=clock())
    engine = Engine(sim_settings, source=sim, clock=clock)
    for _ in range(10):
        clock.advance(300)
        engine.tick()
    api.bind_engine(engine)
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app), engine


def test_live_history_override_alerts(sim_settings, clock):
    c, engine = make_client(sim_settings, clock)
    dev = sim_settings.device_id
    live = c.get(f"/api/devices/{dev}/live").json()
    assert live["stage"]["name"] == "Vegetative"
    assert set(live["readings"]) >= {"ph", "ec", "air_temp", "water_level"}
    assert live["health"]["score"] is not None

    hist = c.get(f"/api/devices/{dev}/history", params={"sensor": "ec", "hours": 6}).json()
    assert len(hist["points"]) >= 5
    assert c.get(f"/api/devices/{dev}/history", params={"sensor": "nope"}).status_code == 400

    r = c.post(f"/api/devices/{dev}/override", json={"actuator": "mist", "amount": 5}).json()
    assert r["status"] == "done" and r["source"] == "manual"
    r = c.post(f"/api/devices/{dev}/override", json={"actuator": "mist", "amount": 90}).json()
    assert r["status"] == "blocked"
    assert c.post(f"/api/devices/{dev}/override", json={"actuator": "laser", "amount": 1}).status_code == 400

    assert c.post(f"/api/devices/{dev}/mode", json={"auto": False}).json() == {"auto": False}
    assert c.get("/api/devices/nope/live").status_code == 404

    c.post("/api/sim/fault", json={"fault": "pump_fail", "on": True})
    c.post(f"/api/devices/{dev}/override", json={"actuator": "mist", "amount": 5})
    clock.advance(60)
    engine.tick()
    alerts = c.get("/api/alerts").json()
    a = next(a for a in alerts if a["type"] == "actuator:mist")
    assert c.post(f"/api/alerts/{a['id']}/ack").json() == {"acknowledged": a["id"]}


def test_recipes_and_cycle(sim_settings, clock):
    c, engine = make_client(sim_settings, clock)
    assert "basil" in c.get("/api/recipes").json()
    rec = c.get("/api/recipes/lettuce").json()
    assert rec["crop"] == "lettuce"
    assert c.get("/api/recipes/mango").status_code == 404
    cyc = c.post(f"/api/devices/{sim_settings.device_id}/cycle", json={"crop": "basil", "planted_days_ago": 2}).json()
    assert cyc["crop"] == "basil"
    assert c.get(f"/api/devices/{sim_settings.device_id}/live").json()["stage"]["name"] == "Seedling"
