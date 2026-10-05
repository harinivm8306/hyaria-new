# HY-ARIA — Smart Growth Evolution

AI + IoT controller for small aeroponic farms. It reads sensors, keeps pH, EC, misting and lighting
on the crop recipe, raises alerts, and shows everything on a live dashboard.

## What runs today (Phase 1: closed control loop)

| Part | Where | Algorithm (spec ref) |
| --- | --- | --- |
| Sensor cleaning: spike filter, smoothing, range and stuck-probe checks | `backend/hyaria/sensing.py` | A1 |
| Nutrient + pH dosing with learned tank gains | `backend/hyaria/control/dosing.py` | A2 |
| Misting interval from VPD, root-zone temperature and day/night | `backend/hyaria/control/misting.py` | A3 |
| LED dimming to a daily light integral | `backend/hyaria/control/lighting.py` | A4 |
| Crop recipes (lettuce, spinach, basil) | `backend/hyaria/recipes/*.json` | A5 |
| Alerts: limits, comfort bands, rate of change, dose response, sensor and pump faults | `backend/hyaria/alerts.py` | A6 |
| Plant health score with reason | `backend/hyaria/health.py` | A7 |
| Safety interlocks on every command | `backend/hyaria/control/safety.py` | A12 |
| Data sources: ThingSpeak, simulator, hybrid | `backend/hyaria/sources/` | — |
| Control engine loop | `backend/hyaria/engine.py` | — |
| REST API | `backend/hyaria/api.py` | — |
| Dashboard: charts, alerts, manual control, fault demo | `src/app/dashboard/page.tsx` | F18 |

Disease detection (`/detect-disease`) and the image stage check (`/predict-stage`) from earlier work are kept.

## Data sources

The prototype has temperature, humidity and water level sensors only. The default **hybrid** mode
uses those real readings from ThingSpeak and simulates pH, EC and light in a virtual tank that reacts
to the real room temperature. Every reading is tagged `real` or `sim` on the dashboard.
Actuators are simulated until the ESP32 command link (MQTT) is added.

| `HYARIA_DATA_SOURCE` | Sensors | Actuators |
| --- | --- | --- |
| `hybrid` (default) | ThingSpeak where available, simulator for the rest | simulated |
| `simulator` | all simulated (works offline; `HYARIA_SIM_SPEED=60` for a fast demo) | simulated |
| `thingspeak` | ThingSpeak only | none: actions are logged as advice |

## Run it

Backend (Python 3.10+):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate                 # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements-core.txt   # control loop + API
# pip install -r requirements.txt      # optional: + disease detection models
copy .env.example .env                 # then set ThingSpeak channel, key and field map
python -m uvicorn main:app --reload --port 8000
```

API docs: http://127.0.0.1:8000/docs

Frontend:

```bash
npm install
copy .env.example .env.local
npm run dev
```

Dashboard: http://localhost:3000/dashboard

Tests: `cd backend && python -m pytest -q`. They include a 3-day closed-loop simulation that must keep
pH and EC in band more than 90% of the time and learn the tank's dosing gains.

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/status` | engine and data-source status |
| GET | `/api/devices/{id}/live` | readings, stage, health, alerts, controller state |
| GET | `/api/devices/{id}/history?sensor=ph&hours=24` | one sensor's history |
| GET | `/api/devices/{id}/history/all?hours=24` | all sensors |
| GET | `/api/devices/{id}/actions` | what the system did and why |
| POST | `/api/devices/{id}/override` | `{actuator, amount}`: mist, dose_a, dose_b, ph_down, ph_up, water_add, led |
| POST | `/api/devices/{id}/mode` | `{auto: true/false}` |
| POST | `/api/devices/{id}/cycle` | start a new crop cycle `{crop, planted_days_ago}` |
| GET / POST | `/api/alerts`, `/api/alerts/{id}/ack` | list and acknowledge alerts |
| GET / PUT | `/api/recipes/{crop}` | crop recipes |
| POST | `/api/sim/fault` | demo faults: `pump_fail`, `ph_stuck`, `leak`, `heatwave` |

## Roadmap

1. **Phase 1 – closed loop** (this release)
2. Phase 2 – real data + vision: retrain disease model on public leafy-green datasets, canopy tracking, harvest forecast, resource accounting
3. Phase 3 – product: login, mobile PWA (Tamil/English), grounded assistant, ESP32 MQTT link and OTA
4. Phase 4 – scale: forecasting, multi-farm dashboard, crop recommender
