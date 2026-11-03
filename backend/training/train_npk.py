"""Train the lettuce N/P/K deficiency classifier and export it to ONNX.

Data: github.com/ramimalik782/Lettuce-NPK-dataset (CC0), hydroponic lettuce photos in four folders.
Model: Ultralytics YOLO11n-cls (ImageNet-pretrained) fine-tuned at 224 px on CPU.
Output (backend/models/): npk_yolo11n_cls.onnx, npk_classes.json, npk_metrics.json, NPK_MODEL_CARD.md

Usage (from backend/):
    pip install ultralytics onnx onnxslim            # training only; the API needs just onnxruntime
    git clone --depth 1 https://github.com/ramimalik782/Lettuce-NPK-dataset ../../datasets/Lettuce-NPK-dataset
    python training/train_npk.py --data ../../datasets/Lettuce-NPK-dataset

Metrics are measured with the exported ONNX file on a held-out split the model never saw,
using the same preprocessing as hyaria/vision.py.
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# dataset folder -> class key used everywhere in HY-ARIA
FOLDERS = {
    "Fully Nutritional": "healthy",
    "Nitrogen Deficient": "n_deficient",
    "Phosphorus Deficient": "p_deficient",
    "Potassium Deficient": "k_deficient",
}
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def split_dataset(src: Path, dst: Path, val_frac: float, min_val: int, oversample_to: int, seed: int) -> dict:
    """Stratified train/val split. Small classes are oversampled in train only (copies), never in val."""
    rng = random.Random(seed)
    if dst.exists():
        shutil.rmtree(dst)
    counts = {}
    for folder, key in FOLDERS.items():
        files = sorted(p for p in (src / folder).iterdir() if p.suffix.lower() in IMG_EXT)
        if not files:
            raise SystemExit(f"no images in {src / folder}")
        rng.shuffle(files)
        n_val = max(min_val, round(len(files) * val_frac))
        val, train = files[:n_val], files[n_val:]
        for split, items in (("val", val), ("train", train)):
            (dst / split / key).mkdir(parents=True, exist_ok=True)
            for i, f in enumerate(items):
                shutil.copy2(f, dst / split / key / f"{i:03d}{f.suffix.lower()}")
        # oversample tiny classes so the loss is not dominated by the big ones
        copies = 0
        while len(train) + copies < oversample_to:
            f = train[copies % len(train)]
            shutil.copy2(f, dst / "train" / key / f"dup{copies:03d}{f.suffix.lower()}")
            copies += 1
        counts[key] = {"total": len(files), "train": len(train), "train_with_oversampling": len(train) + copies,
                       "val": len(val)}
    return counts


def evaluate_onnx(onnx_path: Path, val_dir: Path, classes: list[str]) -> dict:
    from hyaria.vision import NpkClassifier

    clf = NpkClassifier(onnx_path, classes)
    n = len(classes)
    cm = [[0] * n for _ in range(n)]
    for ti, key in enumerate(classes):
        for f in sorted((val_dir / key).iterdir()):
            res = clf.predict(f.read_bytes())
            cm[ti][classes.index(res["label"])] += 1
    total = sum(map(sum, cm))
    correct = sum(cm[i][i] for i in range(n))
    recall = {c: (cm[i][i] / sum(cm[i]) if sum(cm[i]) else None) for i, c in enumerate(classes)}
    precision = {}
    for i, c in enumerate(classes):
        col = sum(cm[r][i] for r in range(n))
        precision[c] = cm[i][i] / col if col else None
    return {"val_images": total, "accuracy": correct / total, "recall": recall, "precision": precision,
            "confusion_matrix": {"rows_true_cols_pred": classes, "matrix": cm}}


def model_card(m: dict) -> str:
    def pct(x):
        return "n/a" if x is None else f"{100 * x:.0f}%"

    classes = m["classes"]
    rows = "\n".join(f"| {c} | {m['split'][c]['total']} | {m['split'][c]['train']} | {m['split'][c]['val']} | "
                     f"{pct(m['eval']['recall'][c])} | {pct(m['eval']['precision'][c])} |" for c in classes)
    cm = m["eval"]["confusion_matrix"]["matrix"]
    cm_rows = "\n".join(f"| **{c}** | " + " | ".join(str(v) for v in cm[i]) + " |" for i, c in enumerate(classes))
    return f"""# Lettuce N/P/K deficiency classifier — model card

**Status: experimental.** Trained on a small public dataset; not yet tested on photos from the HY-ARIA chamber.

| | |
| --- | --- |
| File | `npk_yolo11n_cls.onnx` ({m['onnx_mb']:.1f} MB) + `npk_classes.json` |
| Architecture | Ultralytics YOLO11n-cls, ImageNet-pretrained, fine-tuned |
| Input | RGB, resize short side to {m['imgsz']} px, centre crop {m['imgsz']}x{m['imgsz']}, scale 0-1 |
| Output | softmax over {', '.join(classes)} |
| Runtime | `onnxruntime` on CPU (`backend/hyaria/vision.py`) |
| Trained | {m['trained_at']} · up to {m['epochs']} epochs (early stop, patience 15) · seed {m['seed']} · CPU · {m['train_minutes']:.0f} min |
| Data | [Lettuce-NPK-dataset](https://github.com/ramimalik782/Lettuce-NPK-dataset) (CC0), hydroponic lettuce |

## Held-out results (measured with the ONNX file)

Accuracy **{pct(m['eval']['accuracy'])}** on {m['eval']['val_images']} validation images.

| Class | Images | Train | Val | Recall | Precision |
| --- | --- | --- | --- | --- | --- |
{rows}

Confusion matrix (rows = true, columns = predicted):

| | {' | '.join(classes)} |
| --- | {' | '.join('---' for _ in classes)} |
{cm_rows}

## Limits — read before trusting a prediction

- The validation set is tiny (healthy has only {m['split']['healthy']['val']} val images), so these numbers can move a lot with a different split.
- The best epoch was chosen on this same validation split (no separate test set: too few photos), so the figure is slightly optimistic.
- Healthy plants are rare in the data (12 photos); they were oversampled during training only.
- All photos come from one grower's setup; lighting, camera and variety differ from ours. Expect lower accuracy on chamber photos until we fine-tune on our own.
- A deficiency look-alike (pH lock-out, cold roots, disease) will still be labelled as a deficiency. The controller therefore never doses on the camera alone; it needs the ion sensor to agree (see `control/npk.py`).
- Predictions below {m['min_confidence']:.0%} confidence are reported as "retake photo".
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True, help="folder with the four class folders")
    ap.add_argument("--work", type=Path, default=BACKEND / "training" / "runs")
    ap.add_argument("--out", type=Path, default=BACKEND / "models")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--imgsz", type=int, default=224)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--val-frac", type=float, default=0.2)
    args = ap.parse_args()

    from ultralytics import YOLO
    from hyaria.vision import MIN_CONFIDENCE

    split_dir = args.work / "npk_split"
    counts = split_dataset(args.data, split_dir, args.val_frac, min_val=3, oversample_to=40, seed=args.seed)
    print(json.dumps(counts, indent=2))

    t0 = time.time()
    model = YOLO("yolo11n-cls.pt")
    model.train(data=str(split_dir), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, device="cpu",
                seed=args.seed, deterministic=True, workers=0, project=str(args.work), name="npk", exist_ok=True,
                patience=15, fliplr=0.5, flipud=0.5, degrees=15, hsv_h=0.01, hsv_s=0.3, hsv_v=0.3,
                erasing=0.2, plots=False, verbose=False)
    train_min = (time.time() - t0) / 60

    best = Path(model.trainer.best)
    onnx_tmp = Path(YOLO(str(best)).export(format="onnx", imgsz=args.imgsz, simplify=True, dynamic=False))
    classes = [YOLO(str(best)).names[i] for i in range(len(FOLDERS))]

    args.out.mkdir(parents=True, exist_ok=True)
    onnx_path = args.out / "npk_yolo11n_cls.onnx"
    shutil.copy2(onnx_tmp, onnx_path)
    (args.out / "npk_classes.json").write_text(json.dumps(classes), newline="\n")

    ev = evaluate_onnx(onnx_path, split_dir / "val", classes)
    metrics = {"classes": classes, "split": counts, "eval": ev, "epochs": args.epochs, "imgsz": args.imgsz,
               "seed": args.seed, "train_minutes": train_min, "onnx_mb": onnx_path.stat().st_size / 1e6,
               "trained_at": time.strftime("%Y-%m-%d"), "min_confidence": MIN_CONFIDENCE}
    (args.out / "npk_metrics.json").write_text(json.dumps(metrics, indent=2), newline="\n")
    (args.out / "NPK_MODEL_CARD.md").write_text(model_card(metrics), encoding="utf-8", newline="\n")
    print(json.dumps(ev, indent=2))


if __name__ == "__main__":
    main()
