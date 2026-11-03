"""Plant photos: N/P/K deficiency classifier (ONNX, CPU) and canopy cover.

The model is optional. If backend/models/npk_yolo11n_cls.onnx or onnxruntime is missing,
photos are still stored and canopy cover is measured; the deficiency result says why it is unavailable.
Train/export it with training/train_npk.py.
"""
from __future__ import annotations

import io
import json
import logging
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

log = logging.getLogger("hyaria.vision")

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
NPK_MODEL = MODEL_DIR / "npk_yolo11n_cls.onnx"
NPK_CLASSES = MODEL_DIR / "npk_classes.json"
MIN_CONFIDENCE = 0.6           # below this: "retake photo"
EXG_THRESHOLD = 0.08           # excess-green index above this counts as leaf

# class key -> nutrient the controller understands
CLASS_TO_NUTRIENT = {"n_deficient": "n", "p_deficient": "p", "k_deficient": "k"}
LABELS = {"healthy": "Healthy", "n_deficient": "Nitrogen deficient", "p_deficient": "Phosphorus deficient",
          "k_deficient": "Potassium deficient"}


def load_rgb(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    return ImageOps.exif_transpose(img).convert("RGB")


def canopy_cover_pct(img: Image.Image) -> float:
    """Share of the photo that is green leaf (excess-green index). A relative growth signal,
    not an area in cm2: it depends on camera height, so keep the camera fixed."""
    small = img.copy()
    small.thumbnail((256, 256))
    a = np.asarray(small, dtype=np.float32)
    s = a.sum(axis=2) + 1e-6
    r, g, b = a[..., 0] / s, a[..., 1] / s, a[..., 2] / s
    exg = 2 * g - r - b
    leaf = (exg > EXG_THRESHOLD) & (a.max(axis=2) > 30)
    return round(100.0 * float(leaf.mean()), 1)


class NpkClassifier:
    def __init__(self, model_path: Path = NPK_MODEL, classes: list[str] | None = None):
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0]
        self.size = int(self.input.shape[-1])
        self.classes = classes or json.loads(NPK_CLASSES.read_text())

    def preprocess(self, img: Image.Image) -> np.ndarray:
        # same as Ultralytics classify_transforms: short side -> size, centre crop, 0-1, no mean/std
        w, h = img.size
        scale = self.size / min(w, h)
        img = img.resize((max(self.size, round(w * scale)), max(self.size, round(h * scale))), Image.BILINEAR)
        w, h = img.size
        left, top = (w - self.size) // 2, (h - self.size) // 2
        img = img.crop((left, top, left + self.size, top + self.size))
        x = np.asarray(img, dtype=np.float32) / 255.0
        return x.transpose(2, 0, 1)[None]

    def predict(self, data: bytes | Image.Image) -> dict:
        img = data if isinstance(data, Image.Image) else load_rgb(data)
        out = self.session.run(None, {self.input.name: self.preprocess(img)})[0][0].astype(np.float64)
        if abs(out.sum() - 1.0) > 1e-3 or out.min() < 0:      # logits -> softmax
            out = np.exp(out - out.max())
            out /= out.sum()
        probs = {c: round(float(p), 4) for c, p in zip(self.classes, out)}
        label = max(probs, key=probs.get)
        return {"label": label, "label_text": LABELS.get(label, label), "confidence": probs[label],
                "probs": probs, "nutrient": CLASS_TO_NUTRIENT.get(label),
                "low_confidence": probs[label] < MIN_CONFIDENCE}


_clf: NpkClassifier | None = None
_clf_error: str | None = None


def get_classifier() -> NpkClassifier | None:
    """Load the model once; remember why it failed so the API can say so."""
    global _clf, _clf_error
    if _clf is None and _clf_error is None:
        if not NPK_MODEL.exists():
            _clf_error = f"model file missing: run training/train_npk.py to create {NPK_MODEL.name}"
        else:
            try:
                _clf = NpkClassifier()
            except Exception as exc:  # onnxruntime not installed, bad file...
                _clf_error = f"model could not load: {exc}"
                log.warning(_clf_error)
    return _clf


def analyse(data: bytes) -> dict:
    """Everything we can say about one plant photo."""
    img = load_rgb(data)
    result = {"width": img.size[0], "height": img.size[1], "canopy_pct": canopy_cover_pct(img)}
    clf = get_classifier()
    if clf is None:
        result["npk"] = {"available": False, "reason": _clf_error}
    else:
        result["npk"] = {"available": True, "model": NPK_MODEL.name, **clf.predict(img)}
    return result
