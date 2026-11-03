# Lettuce N/P/K deficiency classifier — model card

**Status: experimental.** Trained on a small public dataset; not yet tested on photos from the HY-ARIA chamber.

| | |
| --- | --- |
| File | `npk_yolo11n_cls.onnx` (6.2 MB) + `npk_classes.json` |
| Architecture | Ultralytics YOLO11n-cls, ImageNet-pretrained, fine-tuned |
| Input | RGB, resize short side to 224 px, centre crop 224x224, scale 0-1 |
| Output | softmax over healthy, k_deficient, n_deficient, p_deficient |
| Runtime | `onnxruntime` on CPU (`backend/hyaria/vision.py`) |
| Trained | 2026-11-03 · up to 40 epochs (early stop, patience 15) · seed 0 · CPU · 7 min |
| Data | [Lettuce-NPK-dataset](https://github.com/ramimalik782/Lettuce-NPK-dataset) (CC0), hydroponic lettuce |

## Held-out results (measured with the ONNX file)

Accuracy **93%** on 42 validation images.

| Class | Images | Train | Val | Recall | Precision |
| --- | --- | --- | --- | --- | --- |
| healthy | 12 | 9 | 3 | 100% | 75% |
| k_deficient | 72 | 58 | 14 | 93% | 93% |
| n_deficient | 58 | 46 | 12 | 83% | 100% |
| p_deficient | 66 | 53 | 13 | 100% | 93% |

Confusion matrix (rows = true, columns = predicted):

| | healthy | k_deficient | n_deficient | p_deficient |
| --- | --- | --- | --- | --- |
| **healthy** | 3 | 0 | 0 | 0 |
| **k_deficient** | 0 | 13 | 0 | 1 |
| **n_deficient** | 1 | 1 | 10 | 0 |
| **p_deficient** | 0 | 0 | 0 | 13 |

## Limits — read before trusting a prediction

- The validation set is tiny (healthy has only 3 val images), so these numbers can move a lot with a different split.
- The best epoch was chosen on this same validation split (no separate test set: too few photos), so the figure is slightly optimistic.
- Healthy plants are rare in the data (12 photos); they were oversampled during training only.
- All photos come from one grower's setup; lighting, camera and variety differ from ours. Expect lower accuracy on chamber photos until we fine-tune on our own.
- A deficiency look-alike (pH lock-out, cold roots, disease) will still be labelled as a deficiency. The controller therefore never doses on the camera alone; it needs the ion sensor to agree (see `control/npk.py`).
- Predictions below 60% confidence are reported as "retake photo".
