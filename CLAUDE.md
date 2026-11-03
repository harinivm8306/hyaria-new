# CLAUDE.md — HY-ARIA: Smart Growth Evolution

AI-assisted aeroponic farming system (final-year B.Tech IT project, Sri Sairam Engineering College).
It reads sensors, keeps misting, nutrients, pH and light on a crop recipe, raises alerts, detects
plant problems from photos, and explains every decision on a web dashboard. Demo crop: **lettuce**.

Read these before larger work:
- `docs/PROJECT_CONTEXT.md` — who, what, hardware, source reports, decisions, history
- `docs/ROADMAP.md` — what is done, what is next (with designs for the next tasks)
- `docs/AI_MODELS.md` — model research, chosen models, datasets, what is blocked
- `docs/HARDWARE.md` — boards, wiring plan, what is real vs simulated
- `docs/ALGORITHMS.md` — how each control algorithm works (A1–A15)

## Stack

| Layer | Tech | Where |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 | `src/` |
| 3D / motion | React Three Fiber 9 + drei 10 + three 0.183 · custom GLSL · GSAP 3 (ScrollTrigger, @gsap/react) · framer-motion | `src/components/three/`, `src/components/landing/` |
| Charts | Recharts 3 | dashboard |
| Fonts | Fontsource: Bricolage Grotesque (display), Geist (body), JetBrains Mono (data) — bundled, no Google Fonts fetch | `src/app/layout.tsx` |
| Backend | Python 3.10+ · FastAPI · SQLAlchemy 2 (SQLite default) · httpx | `backend/` |
| Control engine | `backend/hyaria/` package (threaded loop) | see below |
| Plant photo model | YOLO11n-cls N/P/K classifier, ONNX via `onnxruntime` | `backend/models/npk_yolo11n_cls.onnx`, `backend/hyaria/vision.py` |
| Legacy ML (old) | `backend/main.py` vision endpoints (YOLOv8 + MobileNetV2, PlantVillage classes — **no lettuce**) | optional deps |
| Chatbot | `src/app/api/chat/route.ts` → local Ollama `llama3` at 127.0.0.1:11434 | |
| Deploy | Vercel auto-deploys GitHub `main` → https://hyaria-new.vercel.app/ | |

Repo: https://github.com/harinivm8306/hyaria-new · Owner: Harini V M (harinivm8306).
Local clone on Harini's Windows PC: `C:\Users\harin\Aeroponics\hyaria-new`.

## Run

```bash
# backend (from backend/)
python -m venv .venv && .venv\Scripts\activate        # Windows
pip install -r requirements-core.txt                  # control loop + API only
copy .env.example .env                                # set THINGSPEAK_* etc.
python -m uvicorn main:app --reload --port 8000       # API docs: http://127.0.0.1:8000/docs
python -m pytest -q                                   # 30 tests, incl. 3-day closed-loop sim + N/P/K

# frontend (repo root)
npm install
copy .env.example .env.local                          # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEVICE_ID
npm run dev                                           # http://localhost:3000 , /dashboard
npm run build
```

Fast demo without hardware: `HYARIA_DATA_SOURCE=simulator HYARIA_SIM_SPEED=60 HYARIA_TICK_SECONDS=1`.
If no backend answers, `/dashboard` shows clearly labelled **demo data** (amber banner) — intended for the public Vercel site.

## Backend layout (`backend/hyaria/`)

- `config.py` — all settings from env / `backend/.env` (`HYARIA_DATA_SOURCE` = `hybrid` | `simulator` | `thingspeak`)
- `engine.py` — tick: source.step → read → clean (A1) → store → stage (A5) → dosing (A2) / misting (A3) / lighting (A4) → safety (A12) → actuate → alerts (A6) → health (A7)
- `sensing.py` A1 · `control/dosing.py` A2 · `control/npk.py` A16 (N/P/K ions + camera) · `vision.py` (photo model, canopy %) · `control/misting.py` A3 · `control/lighting.py` A4 · `recipes.py` + `recipes/*.json` A5 · `alerts.py` A6 · `health.py` A7 · `control/safety.py` A12
- `sources/` — `simulator.py` (virtual tank that reacts to commands; hidden "true" gains K_TRUE etc.), `thingspeak.py`, `hybrid.py` (real ThingSpeak sensors + simulated rest)
- `api.py` — `/api/devices/{id}/images` (camera), `/api/images/{id}/file`, `/api/vision/npk`, `/api/status`, `/api/devices/{id}/live|history|history/all|actions|override|mode|cycle`, `/api/alerts`, `/api/alerts/{id}/ack`, `/api/recipes/{crop}`, `/api/sim/fault`
- `db.py` — tables readings, actions, alerts, crop_cycles, controller_state, images (photos saved under `backend/data/images/`, gitignored)
- `main.py` — FastAPI app, starts engine in lifespan; vision libs optional (TF/ultralytics/cv2 imported in try/except)

## Frontend layout

- `src/app/globals.css` — design system "dark bio-lab": colour tokens `--c-*` with `.light` overrides, mapped to Tailwind via `@theme inline` (`primary`=leaf green, `secondary`=grow-light violet, `accent`=amber, `mist`, `danger`, `line`, `card-2`, `faint`). Utilities: `panel`, `panel-hi`, `glass`, `eyebrow`, `num`, `chip chip-real chip-sim`, `btn btn-primary btn-ghost`, `grid-bg`, `hotspot*`.
- `src/components/three/AeroChamber.tsx` — 3D digital twin of the 3-tier chamber (tiers at y 0/0.9/1.9/2.9, W 2.0, D 1.2, 4 net pots). Props: `state {mistOn, ledPwm, growth 0..1, waterLevel, health, pumpFault}`, `focus` preset, `story` ref (landing scroll), `interactive`, `hotspots`, `fov`. `ChamberView.tsx` lazy-loads it (ssr:false) and pauses rendering off-screen. `shaders.ts` = mist, water, LED beam, spores.
- `src/components/landing/Landing.tsx` — 520vh pinned scroll story; camera stops at progress 0.232/0.458/0.685/0.911 (mist / nutrient+pH / light / plant intelligence chapters).
- `src/app/dashboard/page.tsx` — command centre (+ `NutrientCard.tsx` N/P/K, plant camera panel); `src/components/dashboard/demo.ts` demo data.
- `src/app/plants/page.tsx` — plant camera: capture/upload, auto-capture, timeline by day, canopy curve, model card.
- `src/lib/api.ts` — `API_BASE` from `NEXT_PUBLIC_API_URL` (default `http://127.0.0.1:8000`).
- Older pages (`/problem`, `/solution`, `/architecture`, `/ai`, `/prototype`, `/results`, `/research`, `/dataset`, `/impact`, `/team`, `/contact`, `/detector`, `/demo`) inherit tokens/fonts but are **not yet redesigned**.

## Rules for this project

- **Honesty in UI and docs:** every reading is tagged REAL / SIM / DEMO. Never show hard-coded "confidence" numbers or unmeasured claims (98% water saving, 90% faster growth) as facts — call them targets until measured.
- **Safety first:** every actuator command (AI or manual) must go through `control/safety.py`. New actuators get limits there.
- **Hardware the user actually has:** ESP32 + Arduino Nano + DHT11 + mist pump (via motor driver) + LED + LCD. Everything else (pH, EC, ion-selective N/P/K, light, level, CO₂, dosing pumps) is simulated until bought. See `docs/HARDWARE.md`.
- **Lightweight models only** (runs on a student laptop, offline). Prefer ONNX export so the backend needs only `onnxruntime`.
- Keep the stack (Next.js, not Vite). Don't make every page 3D; 3D is for landing, dashboard twin, Simulation Lab, plant growth.
- Tests: add/extend pytest for every backend algorithm; run `npx tsc --noEmit -p .` and `npm run build` before committing frontend work.
- Commits are pushed by Harini from Windows (`git push`); Vercel redeploys `main`.
- User-facing writing: plain, specific, no hype; Harini prefers step-by-step instructions and short answers.

## Where we left off (Nov 2026)

1. **Done 3 Nov 2026:** plant camera (`/plants` page + dashboard panel, `src/components/plants/PlantCamera.tsx`), image storage + API (`images` table, `hyaria/vision.py`), A16 N/P/K fusion dosing (`control/npk.py`, sensors `n_ppm/p_ppm/k_ppm`, actuators `dose_n/p/k`, safety limits), first AI model (YOLO11n-cls N/P/K classifier, ONNX in `backend/models/`, 93% on 42 held-out photos, experimental; script `backend/training/train_npk.py`). 30 tests.
   Original request was: (a) add a **plant camera** to the UI to track plants over time; (b) **N, P, K stored separately** (peristaltic pumps N/P/K via relay, slide block diagram), **ion-selective electrode (ISE) sensors** measure NO₃⁻ / H₂PO₄⁻ / K⁺, combined with **camera-detected deficiency**, to decide which nutrient to dose into the solution; (c) **start implementing an AI model** — plan: fine-tune YOLO11n-cls on the CC0 lettuce NPK image dataset (github.com/ramimalik782/Lettuce-NPK-dataset) and export ONNX. Designs in `docs/ROADMAP.md` §1 and `docs/AI_MODELS.md`.
2. Done 3 Nov 2026: N/P/K stock bottles + dosing pumps in the 3D twin (`ChamberState.lastDose`).
3. Next: test the model on real chamber photos; Simulation Lab page (3D), plant growth page, restyle inner pages, two-board firmware, login/PWA, DQN in simulator, grounded chatbot, resource accounting, recommendations.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost). `.graphifyignore` excludes the bundled third-party disease projects under `backend/Plant_Disease_Detection_*` and `backend/Plant_Health_Classification`.
