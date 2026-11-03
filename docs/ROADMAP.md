# HY-ARIA — Roadmap

Status as of 3 Nov 2026. 48 features from the Phase I report + slides: 7 built, 9 built on simulator, 10 partly built, 22 to build (full table in the spec doc's "Report feature map" tab).

## Done

- **Phase 1 control loop** (885ef21): sensor cleaning, EC/pH dosing with learned gains, VPD misting, DLI lighting, crop recipes (lettuce/spinach/basil), alerts, health score, safety interlocks, simulator/ThingSpeak/hybrid, REST API, 20 tests.
- **Premium UI** (6bcdfb9): design system, 3D digital twin, cinematic landing, command-centre dashboard with demo fallback.

## 1. Current task — camera, ion-selective N/P/K dosing, first AI model

Harini's request (verbatim intent): the UI should have a **camera to keep track of the plants**; **N, P, K nutrients are stored separately outside**; **ion-selective sensors** tell which ion is low, combined with the **deficiency seen in the plants**; the missing nutrient is **fed and mixed into the nutrient solution** (the three nutrients are in the slide block diagram: N₂, K, P peristaltic pumps controlled by a relay module); and **start implementing an AI model**.

### 1a. Plant camera
- Frontend: a Plant Camera panel (dashboard + its own `/plants` page) that uses the browser camera (`getUserMedia`) or a phone/USB webcam, plus file upload as fallback; later an ESP32-CAM snapshot URL.
- "Capture" → `POST /api/devices/{id}/images` (multipart) → backend stores the image (`backend/data/images/YYYY-MM-DD/…`) + row in new `images` table (ts, path, model results, canopy_cm2).
- Optional scheduled capture (every N hours while the page is open) to build a growth timeline.
- Timeline view: photos by day, canopy-area curve, stage and deficiency results per photo.
- 3D twin: show a camera icon/hotspot above the canopy; latest photo thumbnail in the dashboard.

### 1b. Separate N/P/K stocks + ion-selective sensing
- New simulated sensors in `sources/simulator.py`: `no3_ppm` (nitrate, N), `h2po4_ppm` (phosphate, P), `k_ppm` (potassium); plant uptake depletes them at different rates by stage; EC derived from total ions.
- New actuators: `dose_n`, `dose_p`, `dose_k` (ml) — peristaltic pumps via relay; each raises its own ion (learned gain per ion, like `k_ec`). Keep `dose_a/dose_b` or replace with N/P/K (decide; N/P/K matches the slides).
- Recipe: per stage target bands for each ion (lettuce starting values, to tune; e.g. N ~150–200 ppm, P ~40–60, K ~200–250 — verify against literature before using).
- **Fusion decision** (new `control/npk.py`): for each nutrient, combine (i) ISE reading vs target band, (ii) vision deficiency probability from the camera model (–N / –P / –K / healthy), (iii) trend. Dose a nutrient when ISE says low; if ISE is in band but vision says deficient with high confidence for 2+ photos, raise an alert "possible uptake problem: check pH / root temperature" rather than overdosing (deficiency symptoms can come from pH lockout, not low ions). Then wait to mix, re-measure, learn gain — same pattern as A2.
- Safety: per-pump max ml per dose and per hour; no N/P/K dosing while pH is being corrected; total EC cap.
- UI: N/P/K bars (current vs target band), which pump ran and why, combined "nutrient status" card; 3D twin shows three small stock bottles + peristaltic pumps beside the reservoir (like the slide).
- Tests: depletion → correct ion dosed; vision-only deficiency → alert not overdose; caps respected.

### 1c. First AI model — lettuce NPK deficiency classifier (in progress)
- Data: **github.com/ramimalik782/Lettuce-NPK-dataset** (CC0, ~337 MB, hydroponic lettuce photos: FN 12, –N 58, –P 66, –K 72). Clone with `git clone --depth 1`.
- Model: fine-tune **Ultralytics YOLO11n-cls** (ImageNet-pretrained weights download from the Ultralytics GitHub release, which worked) at 224 px; stratified train/val split; class weights or oversampling for FN (only 12 images); heavy augmentation.
- Export: ONNX (~5–6 MB) → `backend/models/npk_yolo11n_cls.onnx` + `npk_classes.json` + a `MODEL_CARD.md` with real val metrics (accuracy, per-class recall, confusion matrix). Report honest numbers; small dataset ⇒ label results "experimental".
- Serve: `backend/hyaria/vision.py` with `onnxruntime` (no torch at runtime) → endpoint `POST /api/vision/npk` and used by the image pipeline in 1a; low confidence (<0.6) ⇒ "retake photo".
- Alternative ready-made models (if Hugging Face CDN is reachable from the machine): see `docs/AI_MODELS.md`.

## 2. Next

- **Simulation Lab page** (3D): scenarios (normal, heatwave, dry air, pH drift, low N/P/K, low tank, dark day), sensor overrides, actuator buttons, fault injection, time speed 1×/60×/600×, event log; add simulated CO₂, airflow, fan, heater.
- **Plant growth page**: 3D plant + growth timeline from camera photos; harvest-due alert from growing degree days (A10).
- **Disease Lab**: replace PlantVillage model with a lettuce disease model (see AI_MODELS.md); add "not a lettuce leaf" gate.
- **Restyle inner pages** to the new design.
- **Two-board firmware**: Arduino Nano reads DHT11 → UART → ESP32 → HTTP/MQTT to backend; ESP32 drives the mist pump via the motor driver with a failsafe; LCD on the Nano. Needs from Harini: ESP32 pin for the pump, pump voltage, confirm motor driver.
- **Forecasting** (A11): Chronos-Bolt-tiny or a small LightGBM on logged data.
- **DQN** environment optimiser trained in the simulator, compared with the rule controller, behind safety.
- **Grounded AI advisor**: chatbot context = live readings + recipe + alerts + troubleshooting log; smaller Ollama model.
- **Resource accounting** (A13): water, nutrient, energy per cycle → measured water-saving number.
- **Login, PWA, Tamil/English**, recommendations (location, indoor/outdoor, companion plants), multi-farm later.

## Open questions for Harini
- Spray pump wiring: motor driver from ESP32? which GPIO? pump voltage?
- Which ThingSpeak field (if any) carries water level, and in % or cm?
- 10–20 real lettuce photos from the chamber (healthy + unhealthy) to test models.
- Ion-selective sensors: buy real ISEs (NO₃⁻, K⁺; phosphate ISEs are rare/expensive) or keep simulated for the demo?
