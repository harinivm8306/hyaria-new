"""Crop recipes (A5): per-crop, per-stage target bands loaded from JSON files."""
from __future__ import annotations

import json
from pathlib import Path

RECIPE_DIR = Path(__file__).resolve().parent / "recipes"
REQUIRED_STAGE_KEYS = {"name", "from_day", "to_day", "ph", "ec", "air_temp", "humidity",
                       "water_temp", "dli", "mist_on_s", "mist_off_min"}


def list_crops() -> list[str]:
    return sorted(p.stem for p in RECIPE_DIR.glob("*.json"))


def load_recipe(crop: str) -> dict:
    path = RECIPE_DIR / f"{crop}.json"
    if not path.exists():
        raise KeyError(f"No recipe for crop '{crop}'. Available: {', '.join(list_crops())}")
    recipe = json.loads(path.read_text())
    validate_recipe(recipe)
    return recipe


def validate_recipe(recipe: dict) -> None:
    for key in ("crop", "stages", "hard_limits", "photoperiod", "t_base_c"):
        if key not in recipe:
            raise ValueError(f"recipe missing '{key}'")
    for stage in recipe["stages"]:
        missing = REQUIRED_STAGE_KEYS - stage.keys()
        if missing:
            raise ValueError(f"stage {stage.get('name')} missing {sorted(missing)}")
        for band in ("ph", "ec", "air_temp", "humidity", "water_temp"):
            lo, hi = stage[band]
            if lo >= hi:
                raise ValueError(f"stage {stage['name']}: {band} low must be below high")
        for ion, (lo, hi) in stage.get("npk", {}).items():   # optional ion targets (ppm)
            if ion not in ("n", "p", "k") or lo >= hi:
                raise ValueError(f"stage {stage['name']}: bad npk band '{ion}'")


def save_recipe(recipe: dict) -> None:
    validate_recipe(recipe)
    name = recipe["crop"]
    if not name.replace("_", "").isalnum():
        raise ValueError("crop name must be letters, digits or _")
    (RECIPE_DIR / f"{name}.json").write_text(json.dumps(recipe, indent=2))


def stage_for_day(recipe: dict, day: float) -> dict:
    """Stage switching by days since planting (image-based switching comes in Phase 2)."""
    for stage in recipe["stages"]:
        if stage["from_day"] <= day < stage["to_day"]:
            return stage
    return recipe["stages"][-1]


def band_mid(band: list[float]) -> float:
    return (band[0] + band[1]) / 2.0
