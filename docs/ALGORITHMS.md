# HY-ARIA — Algorithms

Loop: clean the reading → compare to the crop recipe → compute an action → safety check → act → measure the result and learn. Built = in `backend/hyaria/`. Parameter values are starting values for lettuce.

| ID | Algorithm | Status | Code |
| --- | --- | --- | --- |
| A1 | Sensor cleaning | Built | `sensing.py` |
| A2 | Nutrient (EC) + pH dosing | Built (A+B two-part; N/P/K version planned) | `control/dosing.py` |
| A3 | Adaptive misting | Built | `control/misting.py` |
| A4 | DLI lighting | Built | `control/lighting.py` |
| A5 | Crop recipes + stage | Built (days-based) | `recipes.py`, `recipes/*.json` |
| A6 | Alerts | Built | `alerts.py` |
| A7 | Health score | Built (environment part) | `health.py` |
| A8 | Disease detection | Old PlantVillage pipeline; lettuce model planned | `main.py` |
| A9 | Growth stage / canopy | Planned (camera) | — |
| A10 | Harvest forecast (GDD) | Planned | — |
| A11 | Short-term forecasting | Planned (Chronos-Bolt-tiny) | — |
| A12 | Safety interlocks | Built | `control/safety.py` |
| A13 | Resource accounting | Planned | — |
| A14 | Grounded AI advisor | Planned | `src/app/api/chat` |
| A15 | Crop recommender | Planned | — |
| A16 | Ion-selective N/P/K fusion dosing | Planned (ROADMAP §1b) | — |

## A1 Sensor cleaning
Window of 5 → Hampel filter (|x − median| > 3·1.4826·MAD ⇒ replace with median) → EMA α = 0.3 → range check (pH 0–14, etc. ⇒ `FAULT`) → stuck check (std over 30 min < noise floor, pH 0.005 ⇒ `STUCK`). Helpers: pH two-point calibration (`pH = 7 + (V − V7)·3/(V7 − V4)`), EC temperature compensation `EC25 = EC_T / (1 + 0.02(T − 25))`.

## A2 Dosing
If EC < band: `V = clamp(0.7 · (EC_target − EC)·V_tank / k, 1, 60 ml)`, dose A and B equally, wait 10 min, re-measure, learn `k ← k + 0.2·(observed − k)` (start k = 0.5 mS/cm per ml/L each). EC > band ⇒ add fresh water `V_tank·(EC/EC_target − 1)`. pH only after EC settles, dead band ±0.2, learned gains `b_down`, `b_up`, max 20 ml. Max 3 dose cycles/hour. Dose changed reading < 20 % of expected ⇒ "no response" alert (empty bottle / blocked pump / probe drift). Simulator hidden truth: K_TRUE 0.45, B_DOWN 1.2, B_UP 1.0.

## A3 Misting
`SVP = 0.6108·e^(17.27T/(T+237.3))`, `VPD = SVP·(1 − RH/100)`. `t_off = base(stage) · clamp(0.9/VPD, 0.5, 1.5)`; root zone > 24 °C ⇒ × 0.75; night ⇒ × 1.3. Lettuce base: seedling 5 min, vegetative 4, mature 3; on-time 4–5 s.

## A4 Lighting
PPFD ≈ lux/54. Accumulate DLI; every 15 min `PPFD_needed = (DLI_target − DLI_so_far)·10⁶ / (3600·h_left)`; LED PWM = (needed − sunlight)/370·100, clamped; off outside photoperiod (06:00 + 16 h for lettuce).

## A5 Recipes
JSON per crop: hard limits + stages (from/to day, pH, EC, air temp, RH, water temp, DLI, mist on/off). Lettuce vegetative: pH 5.8–6.2, EC 1.2–1.6, air 18–24 °C, RH 55–70 %, DLI 14.

## A6 Alerts
Hard limits (critical, hysteresis margins), comfort bands for 30 min (warning), rate of change (water temp +1 °C/30 min; tank −5 %/10 min = leak), dose-response, sensor FAULT/STUCK, actuator failure (pump no pressure). 30-min cooldown for warnings.

## A7 Health score
Per-parameter desirability 1 inside band, linear to 0 at tolerance (pH 0.5, EC 0.5, temps 5 °C, RH 15 %); weights pH .25, EC .25, root temp .2, air .15, RH .15. Bands ≥ 80 Good, 60–79 Watch, < 60 Act. Reason = worst parameter. Planned: 0.6·env + 0.4·(100 − vision severity).

## A9–A11 (planned)
Canopy: fixed top camera, ExG = 2G − R − B + Otsu, cm² via marker, logistic fit `A(t) = K/(1+e^(−r(t−t0)))`, stage by fraction of K. Harvest: GDD = Σ max(0, T_mean − 4 °C). Forecast: Chronos-Bolt-tiny or Holt/LightGBM; act early if forecast crosses a limit.

## A12 Safety
Tank < 15 % ⇒ pumps locked; level unknown ⇒ locked; mist ≤ 30 s; nutrient dose ≤ 60 ml; pH dose ≤ 20 ml and blocked while nutrients mix (except manual); water add ≤ 20 L; LED 0–100 %; expired commands rejected. ESP32 firmware must repeat the critical limits.

## A16 Ion-selective N/P/K fusion (planned)
See `docs/ROADMAP.md` §1b: ISE reading vs target band decides dosing; camera deficiency confirms; vision-only deficiency raises an uptake-problem alert instead of overdosing.
