# HY-ARIA — AI models

Goal: lightweight, offline, honest. Prefer pretrained/open models; export to ONNX so the backend needs only `onnxruntime`. Every result carries its confidence; low confidence ⇒ "retake photo". Unvalidated models are labelled experimental in the UI.

## Mapping to the report's AI modules

| Report module | Plan | Status |
| --- | --- | --- |
| CNN disease detection | Lettuce-specific classifier (below) + lettuce detector gate | old PlantVillage model in `backend/main.py` has **no lettuce classes** |
| Nutrient deficiency (nutrient module) | **YOLO11n-cls fine-tuned on CC0 lettuce NPK dataset** (training started, see ROADMAP §1c) or Verdant MobileNetV2 | in progress |
| LSTM growth stage | Verdant growth model (4 stages) or canopy-area tracking from camera | planned |
| Predictive growth & nutrient (LSTM) | amazon/chronos-bolt-tiny zero-shot forecaster (34.6 MB, Apache-2.0) | planned |
| DQN environment optimiser | Train in our simulator (stable-baselines3 or custom), behind safety layer | planned |
| LLM AI advisor | Existing Ollama route; switch to a 1–3B model for laptops; ground with live data | partly built |
| Plant identification | crop comes from the active crop cycle (CLIP was too heavy) | — |

## Candidate pretrained models found (Hugging Face, checked 3 Nov 2026)

Lightweight set (~105 MB total):
- **Lettuce detector (gate):** Space `stevelohwc/verdant-lettuce-vision`, `Code/Model/data/models/lettuce_det.pt` (YOLO, 6.3 MB).
- **Disease, 8 named classes:** Space `britttlkx/LettuceDiseaseDetection`, `efficientnetb0_finetuned.keras` (37.4 MB, Keras, input 224, scale /255). Classes: Bacterial, Downy_mildew_on_lettuce, Healthy, Powdery_mildew_on_lettuce, Septoria_blight_on_lettuce, Shepherd_purse_weeds, Viral, Wilt_and_leaf_blight_on_lettuce. No accuracy published.
- **Disease binary fallback:** Verdant `disease_best.pth` (MobileNetV2 9.1 MB, D/H, val acc 0.9545, Roboflow lettuce-disease-cge82).
- **NPK deficiency:** Verdant `npk_best.pth` (MobileNetV2 9.1 MB, –K/–N/–P/healthy, val acc 0.9268, trained on andandandand/lettuce-npk-dataset).
- **Growth stage:** Verdant `growth_best.pth` (MobileNetV2 9.1 MB, stage1_early/stage2_leafy/stage3_head/stage4_harvest, val acc 0.9706 on ~120 images).
- Verdant preprocessing: resize 224, ImageNet mean/std; checkpoint dict with `model_state` + `meta`; torchvision `mobilenet_v2` with classifier `Dropout(0.2) + Linear`.
- **Forecasting:** `amazon/chronos-bolt-tiny` (`pip install chronos-forecasting`, `BaseChronosPipeline.from_pretrained(..., device_map="cpu")`).

Licence caveat: the Verdant and britttlkx Spaces state **no licence** — fine for a college demo with credit; ask authors before commercial use.

Rejected as too heavy: `zakyazda/lettuce_leaf_disease` YOLO 156 MB (MIT, 6 classes, CLIP gate); `AbdoulayeDIOP/lettuce-npk-vit` 343 MB (Apache-2.0, –K/–N/–P/FN, 95% on ~21 images); asklany TF 93 MB (Bacterial/fungal/healthy); K4is3rrrr 264 MB; GardensOfBabylon29 (no licence); CLIP ViT-B/32 ~600 MB. PlantVillage models (incl. `K4is3rrrr/lettuce-disease-detection`, `mesabo/agri-plant-disease-resnet50`) contain **no lettuce**.

Download note: with `huggingface_hub`, set `HF_HUB_DISABLE_XET=1` if the Xet CAS host is blocked. Cloud sandboxes could not reach `*.hf.co`; Harini's PC can.

## Datasets

- **github.com/ramimalik782/Lettuce-NPK-dataset** — CC0, hydroponic lettuce: FN 12, –N 58, –P 66, –K 72 images. Primary training set for the first model.
- `andandandand/lettuce-npk-dataset` (HF, 208 images, 166 train / 42 test, labels 0-K 1-N 2-P 3FN) — likely the same images; use only as a check, not as independent test data.
- `bromleyp/lettuce_growth` (HF, 3,169 rows, 70 plants × 45 days: temp, humidity, TDS, pH, growth days; no licence) — for growth/forecast experiments.
- Other GitHub repos seen: `WinWut/Lettuce-Nutrient-Deficiency-Detection` (YOLO11n webcam, Apache-2.0), `ayberkgezer/lettuce-nutrient-deficiency` (Apache-2.0), `Mr-Engnr/hydrogrow` (Apache-2.0, Raspberry Pi dosing).
- No labelled lettuce **disease** dataset on HF; Roboflow `lettuce-iyoop/lettuce-disease-cge82` needs an API key. Harini's own chamber photos are needed for real-world testing.
