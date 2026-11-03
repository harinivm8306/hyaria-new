# HY-ARIA — Project context

## Who and what

- **Project:** HY-ARIA: Smart Growth Evolution (venture name **AuraVerde**). AI-driven automated nutrient and environmental management for aeroponic farming.
- **Team:** Harini V M (412520522056, repo owner), Ishwarya R (412520522059), Jamila Sherin U (412520522061). B.Tech Information Technology, Sri Sairam Engineering College (Anna University, Chennai).
- **Supervisor:** Dr S Susila Sakthy (Associate Professor). Coordinator: Ms B Renuka Devi. HoD: Dr M Suresh Kumar.
- **Courses:** Live-in-Lab II (May 2025 report), Project Phase I 20ITPJ701 (Nov 2026 report + slide deck SEC27ITTE30106).
- **SDGs:** primary 2 Zero Hunger (2.3, 2.4, 2.a); secondary 12 (12.2, 12.3, 12.5); tertiary 13 (13.1–13.3).
- **Achievements listed:** Solveathon 4.0 winner (SDG 2); IEEE HKN Genesis 2.0 final round; SIH inter-college; paper presentations (Guru Nanak College, ELYNDRA 2025 Saveetha); Yukthi portal registered.
- **Target users:** small and medium-scale farmers, urban growers (persona: Rajesh, 40, Tamil Nadu).
- **Business model in report:** SaaS tiers Basic $150 / Pro $200 / Enterprise $300 per month; free 15–30 day trial.

## Source documents (the master spec)

All features in these must exist in the product (as real or clearly simulated):

1. **Live-in-Lab II report (May 2025)** — first version: website with humidity/air temp/water temp/pump trends from ThingSpeak; architecture diagram (Fig 1.2).
2. **Project Report Phase I (Nov 2026, 59 pages)** — architecture Fig 4.1 (Data acquisition & control · Central processing & AI · Aeroponics monitor app), Fig 4.2 simplified (CNN disease detection, LSTM growth stage, RL optimal environment + automated dosing, LLM advisor), hardware list §5.2.3, workflow §4.1.3 (incl. step 6 harvest notification + cycle reset), MVP §5.4 (automated nutrient delivery, IoT monitoring, mobile app + alerts, modular chambers), tests §5.7, limitations §7.4, future scope §8.2 (multi-crop AI, crop recommendations, renewable energy, multi-farm dashboard, localisation, government schemes). Reference [10] Jung et al. 2019, *ion-specific sensing and control system for precision hydroponic macronutrient management* — basis for the ISE N/P/K design.
3. **Project Phase I slide deck** — block diagram: ESP32 + Nano with pH sensor, DHT11, DS18B20, LCD, motor driver, pump motors, water tank, relay module, wireless datalogger, buck converter, 12 V/5 A; chamber with sensors (EC, pH, CO₂, humidity, temperature, light, water level) and actuators (atomisation nozzle, ventilation fan, warm/hot air, LED, CO₂ cylinder); pressure pump; **N, K, P peristaltic pumps controlled by relay module**. AI slides: Environmental optimisation model (airflow, temperature, CO₂, light, pH sensors → state → **Deep Q-Network** → increase/decrease misting, adjust airflow, modify lighting), Disease detection model (CNN), AI user assistant (transformer LLM using user query + real-time system data + past troubleshooting log), Predictive growth & nutrient model (LSTM; adjust EC, nutrient levels, pH). Component specs: 12 V DC / solar compatible, Wi-Fi/Bluetooth, temp range 10–40 °C, pre-mixed nutrients incl. N, P, K, Ca, Mg, Fe.

A spec doc with every feature mapped to its build status (48 features, Status dropdown) exists as a Claude Docs artifact: https://claude.ai/code/artifact/f2258f9f-b102-4998-b5f3-6376fd2d19a4 (tabs: main spec + "Report feature map").

### Report vs build mismatches to fix in the report
- Report says **Node.js** backend → the build uses **Python FastAPI**.
- Fig 4.2 shows **DHT22** → hardware is **DHT11**.
- Slides show **cloud** deployment → report and build are **local-only** (no cloud required).
- "98% less water" and "90% faster growth" are **not measured** → write as targets until resource accounting produces numbers.

## Key decisions (and why)

| Decision | Reason |
| --- | --- |
| Keep building in this repo (`hyaria-new`), Next.js not Vite | Same React/TS/R3F stack; no rewrite; Vercel already deploys it |
| Software-first with a simulator | Only DHT11 + mist pump exist as hardware; every module must still work. Simulated values are always labelled SIM |
| Hybrid data source (default) | Real temp/humidity from ThingSpeak (field1 humidity, field2 air temp, field3 water temp, field4 pump on channel 2899533) + simulated pH/EC/light/level that respond to the real room |
| Feedback dosing with learned tank gains instead of the old Random Forest "dose" model | Old RF models were trained on synthetic formulas (`backend/data_generator.py`); feedback control adapts to any tank |
| Dose-response check instead of EWMA drift alert | Dosing moves pH/EC on purpose, so drift charts false-alarm |
| Rule/feedback control now; DQN trained inside the simulator later, always behind the safety layer | No real data yet |
| Pretrained lightweight models over training big ones | Harini asked for Hugging Face models that "just work" and are lightweight |
| Dark bio-lab premium UI with 3D twin, GSAP story | Harini asked for a product UI "that could cost lakhs"; 3D only where it helps (landing, dashboard twin, Simulation Lab, plant growth) |
| Demo data on the dashboard when no backend | Public Vercel site cannot reach a backend on the user's PC |

## History (what was built in the original chat)

| Date | Commit | What |
| --- | --- | --- |
| before | bb4fd84 and earlier | Original site: many info pages, ThingSpeak dashboard, FastAPI with 5 RF models + YOLOv8/MobileNetV2 disease pipeline (PlantVillage classes), green-ratio stage heuristic, Llama3 chatbot |
| 5 Oct 2026 | 885ef21 | **Phase 1 closed control loop**: `backend/hyaria` package (A1–A7, A12), ThingSpeak/simulator/hybrid sources, SQLite, `/api`, dashboard rebuilt, 20 tests (3-day closed loop: pH/EC in band 100% on 5 seeds, learned gains within ~8%). Pushed to GitHub by Harini |
| 11 Oct 2026 | (untracked) | graphify knowledge graph on Harini's PC: 490 nodes, 1,019 edges; found unused deps `@react-three/*`… (now used), `three` |
| 3 Nov 2026 | 6bcdfb9 | **Premium UI**: design system, 3D digital twin, cinematic landing, command-centre dashboard. Committed to Harini's local clone; **needs `npm install` + `git push`** |

## Environment notes (for Claude sessions)

- Cloud sandboxes could not push to GitHub (repo not in the session's authorised set). Fix: install the Claude GitHub App on the repo and start a session with the repo selected; otherwise Harini pushes from Windows.
- Hugging Face: `huggingface.co` API works, but weight files are served from `*.hf.co` CDN hosts, which were blocked; GitHub (`github.com`, `raw.githubusercontent.com`, GitHub release downloads incl. Ultralytics assets) worked. `download.pytorch.org` was blocked (torch installs from PyPI).
- On Harini's Windows PC everything has normal internet.
- Harini's local clone has untracked graphify files: `.claude/settings.json` (hooks pointing at `C:/Users/harin/.local/bin/graphify.EXE`), `.graphifyignore`, `graphify-out/`.
