from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel
import pickle
import os
import io
import numpy as np
from fastapi.middleware.cors import CORSMiddleware
import random
from PIL import Image
import json
import tensorflow as tf
from tensorflow.keras.models import load_model, model_from_json
import cv2
from ultralytics import YOLO
import time

app = FastAPI(title="HY-ARIA AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Individual Model Paths
MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
model_files = {
    'nutrient': 'nutrient_model.pkl',
    'interval': 'interval_model.pkl',
    'health': 'health_model.pkl',
    'stage': 'stage_model.pkl',
    'harvest': 'harvest_model.pkl'
}

loaded_models = {}

def load_all_models():
    global loaded_models
    try:
        # Load statistical models
        for key, filename in model_files.items():
            path = os.path.join(MODELS_DIR, filename)
            if os.path.exists(path):
                with open(path, 'rb') as f:
                    loaded_models[key] = pickle.load(f)
                print(f"Loaded {key} model.")
            else:
                print(f"Warning: {filename} not found.")

        # Load Vision models (Triple Ensemble)
        vision_path1 = os.path.join(MODELS_DIR, 'model.h5')
        vision_path2 = os.path.join(MODELS_DIR, 'model2.h5')
        vision_path3 = os.path.join(MODELS_DIR, 'model3.h5')
        
        if os.path.exists(vision_path1):
            loaded_models['vision1'] = load_model(vision_path1, compile=False)
            print("Loaded Vision Model 1 (Lite) successfully.")
        
        if os.path.exists(vision_path2):
            loaded_models['vision2'] = load_model(vision_path2, compile=False)
            print("Loaded Vision Model 2 (Deep) successfully.")

        if os.path.exists(vision_path3):
            loaded_models['vision3'] = load_model(vision_path3, compile=False)
            print("Loaded Vision Model 3 (Generalist - 39 Classes) successfully.")
            
        if not any(k.startswith('vision') for k in loaded_models):
            print("Warning: No Vision models found in models directory.")
        
        # Load New Precision Models
        yolo_path = os.path.join(MODELS_DIR, 'yolov8_leaf.pt')
        mobilenet_path = os.path.join(MODELS_DIR, 'mobilenetv2_disease.keras')
        class_names_path = os.path.join(MODELS_DIR, 'class_names.txt')
        seg_path = os.path.join(MODELS_DIR, 'yolov8_seg.pt')

        if os.path.exists(yolo_path):
            loaded_models['yolo'] = YOLO(yolo_path)
            print("Loaded YOLOv8 Leaf Detector.")
        
        if os.path.exists(mobilenet_path):
            loaded_models['mobilenet'] = tf.keras.models.load_model(mobilenet_path, compile=False)
            print("Loaded MobileNetV2 Disease Classifier.")

        if os.path.exists(seg_path):
            loaded_models['yolo_seg'] = YOLO(seg_path)
            print("Loaded YOLOv8-seg Model.")

        if os.path.exists(class_names_path):
            with open(class_names_path, 'r') as f:
                loaded_models['class_names'] = [l.strip() for l in f if l.strip()]
            print("Loaded Disease Class Names.")

    except Exception as e:
        print(f"Error loading models: {e}")

load_all_models()

class SensorData(BaseModel):
    temperature: float
    humidity: float
    ph: float
    nitrogen: float
    phosphorus: float
    potassium: float
    light_intensity: float
    days_planted: float

@app.get("/")
def read_root():
    return {
        "status": "HY-ARIA AI Backend is running", 
        "models_loaded": len(loaded_models) >= len(model_files)
    }

@app.post("/predict")
async def predict_optimization(data: SensorData):
    if len(loaded_models) < len(model_files):
        raise HTTPException(status_code=503, detail="Some models are not loaded.")
    
    input_data = np.array([[
        data.temperature,
        data.humidity,
        data.ph,
        data.nitrogen,
        data.phosphorus,
        data.potassium,
        data.light_intensity,
        data.days_planted
    ]])
    
    scaler = loaded_models['nutrient']['scaler']
    input_scaled = scaler.transform(input_data)
    
    dose = loaded_models['nutrient']['model'].predict(input_scaled)[0]
    interval = loaded_models['interval']['model'].predict(input_scaled)[0]
    health = loaded_models['health']['model'].predict(input_scaled)[0]
    stage = loaded_models['stage']['model'].predict(input_scaled)[0]
    days_to_harvest = loaded_models['harvest']['model'].predict(input_scaled)[0]
    
    return {
        "optimization": {
            "nutrient_dose_ml": float(f"{float(dose):.2f}"),
            "mist_interval_min": float(f"{float(interval):.2f}"),
            "crop_health_status": str(health),
            "current_stage": str(stage),
            "days_to_harvest": float(f"{float(days_to_harvest):.1f}"),
            "confidence": 0.98
        },
        "recommendation": f"System in {str(stage)} stage. {'Keep optimal lighting.' if data.light_intensity > 25000 else 'Increase light intensity.'}"
    }

# --- Precision Disease Detection Helpers ---

def get_disease_mask(seg_model, img_bgr, conf=0.25):
    h, w = img_bgr.shape[:2]
    try:
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        results = seg_model.predict(source=img_rgb, conf=conf, verbose=False)
        combined_mask = np.zeros((h, w), dtype=np.uint8)
        for r in results:
            if hasattr(r, 'masks') and r.masks is not None and len(r.masks) > 0:
                masks_data = r.masks.data.cpu().numpy()
                for mask in masks_data:
                    mask_resized = cv2.resize(mask.astype(np.float32), (w, h))
                    binary_mask = (mask_resized > 0.5).astype(np.uint8) * 255
                    combined_mask = cv2.bitwise_or(combined_mask, binary_mask)
        return combined_mask
    except Exception:
        return None

def estimate_severity_heuristic(crop_bgr):
    if crop_bgr is None or crop_bgr.size == 0: return 0.0
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    lower_leaf = np.array([15, 20, 20])
    upper_leaf = np.array([95, 255, 255])
    leaf_mask = cv2.inRange(hsv, lower_leaf, upper_leaf)
    leaf_pixels = cv2.countNonZero(leaf_mask)
    if leaf_pixels < 100: return 0.0
    
    # Disease ranges (brown, yellow, necrotic)
    lower_disease = np.array([0, 30, 30])
    upper_disease = np.array([35, 255, 200])
    disease_mask = cv2.inRange(hsv, lower_disease, upper_disease)
    disease_mask = cv2.bitwise_and(disease_mask, leaf_mask)
    
    disease_pixels = cv2.countNonZero(disease_mask)
    return float(np.clip((disease_pixels / leaf_pixels) * 100.0, 0.0, 100.0))

def estimate_severity_from_mask(disease_mask, box, img_bgr):
    x1, y1, x2, y2 = [int(v) for v in box]
    h, w = disease_mask.shape[:2]
    x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1: return 0.0
    mask_crop = disease_mask[y1:y2, x1:x2]
    disease_pixels = cv2.countNonZero(mask_crop)
    # Estimate leaf area
    leaf_crop = img_bgr[y1:y2, x1:x2]
    gray = cv2.cvtColor(leaf_crop, cv2.COLOR_BGR2GRAY)
    _, leaf_mask = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY)
    leaf_pixels = cv2.countNonZero(leaf_mask)
    if leaf_pixels < 100: leaf_pixels = (x2 - x1) * (y2 - y1)
    return float(np.clip((disease_pixels / leaf_pixels) * 100.0, 0.0, 100.0))

# --- End Helpers ---

@app.post("/detect-disease")
async def detect_disease(file: UploadFile = File(...)):
    try:
        content = await file.read()
        nparr = np.frombuffer(content, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Invalid image format.")
        
        # Ensure precision models are available
        if 'yolo' not in loaded_models or 'mobilenet' not in loaded_models:
            raise HTTPException(status_code=503, detail="Precision models not loaded.")

        # 1. Detection Phase
        results = loaded_models['yolo'].predict(source=img_bgr, conf=0.35, verbose=False)
        
        disease_mask = None
        if 'yolo_seg' in loaded_models:
            disease_mask = get_disease_mask(loaded_models['yolo_seg'], img_bgr)

        per_leaf = []
        # Handle cases with or without leaf detection
        detection_successful = False
        boxes = []
        for r in results:
            if len(r.boxes) > 0:
                detection_successful = True
                boxes.extend(r.boxes)

        if not detection_successful:
            # Fallback: Treat whole image as one leaf
            h, w = img_bgr.shape[:2]
            boxes_to_process = [[0, 0, w, h]]
        else:
            boxes_to_process = [box.xyxy[0].cpu().numpy() for box in boxes]

        # 2. Classification & Severity Phase
        for xyxy in boxes_to_process:
            x1, y1, x2, y2 = [int(v) for v in xyxy]
            crop = img_bgr[y1:y2, x1:x2]
            
            if crop.size > 0:
                # Preprocess for MobileNetV2
                crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                crop_res = cv2.resize(crop_rgb, (224, 224))
                crop_arr = tf.keras.preprocessing.image.img_to_array(crop_res)
                crop_prep = tf.keras.applications.mobilenet_v2.preprocess_input(crop_arr)
                crop_prep = np.expand_dims(crop_prep, 0)
                
                # Classify
                preds = loaded_models['mobilenet'].predict(crop_prep, verbose=0)[0]
                idx = np.argmax(preds)
                label = loaded_models['class_names'][idx] if 'class_names' in loaded_models else f"Class {idx}"
                conf = float(preds[idx])
                
                # Severity
                if disease_mask is not None:
                    sev = estimate_severity_from_mask(disease_mask, xyxy, img_bgr)
                else:
                    sev = estimate_severity_heuristic(crop)
                    
                per_leaf.append({
                    "class": label,
                    "confidence": conf,
                    "severity": sev
                })

        # 3. Aggregation & Decision
        # Pick the 'Best' leaf to represent the plant in the UI
        # Priority: Most severe infection found, or most confident healthy result
        infected = [l for l in per_leaf if l['severity'] > 3.0]
        if infected:
            # Sort by severity to find the most affected leaf
            best_leaf = sorted(infected, key=lambda x: x['severity'], reverse=True)[0]
        else:
            # All healthy or no severe infection, pick most confident
            best_leaf = sorted(per_leaf, key=lambda x: x['confidence'], reverse=True)[0]

        total_leaves = len(per_leaf)
        infected_count = len(infected)
        avg_severity = np.mean([l['severity'] for l in infected]) if infected_count > 0 else 0.0

        # Parse plant/disease from label (e.g., "Tomato - Bacterial spot")
        full_label = best_leaf['class']
        if " - " in full_label:
            plant_type, disease_name = full_label.split(" - ")
        else:
            plant_type, disease_name = "Vegetable", full_label

        # 4. Actionable Logic
        if infected_count == 0 or avg_severity < 4.0:
            status, spray_tier, dosage = "Optimal", "NO ACTION", 0
            advice = f"Your {plant_type} is healthy. Continue current regimen."
        elif avg_severity < 15.0:
            status, spray_tier, dosage = "Warning", "LOW", 25
            advice = f"Early {disease_name} signs detected. Apply 25% preventive mist."
        elif avg_severity < 35.0:
            status, spray_tier, dosage = "Warning", "MEDIUM", 50
            advice = f"Moderate {disease_name} infection found. Apply 50% standard spray."
        else:
            status, spray_tier, dosage = "Critical", "HIGH", 75
            advice = f"Severe {disease_name} detection! {avg_severity:.1f}% severity. Immediate 75% spray and isolation required."

        return {
            "filename": file.filename,
            "plant_detected": plant_type,
            "disease": disease_name.title(),
            "status": status,
            "confidence": round(best_leaf['confidence'], 2),
            "treatment_plan": advice,
            "precision_data": {
                "total_leaves": total_leaves,
                "infected_count": infected_count,
                "avg_severity_pct": round(float(avg_severity), 1),
                "spray_tier": spray_tier,
                "dosage_percent": dosage,
                "individual_leaves": per_leaf[:10]
            }
        }
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict-stage")
async def predict_stage_from_image(file: UploadFile = File(...)):
    content = await file.read()
    try:
        img = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    img = img.resize((256, 256))
    arr = np.array(img, dtype=np.float32)
    R, G, B = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    
    green_mask = (G > R * 1.05) & (G > B * 1.05) & (G > 60)
    green_ratio = float(np.sum(green_mask)) / (256 * 256)
    green_std = float(np.std(G[green_mask])) if np.any(green_mask) else 0.0

    if green_ratio < 0.18:
        stage, desc, days, color = "Seedling", "Early growth phase.", "0 – 9 days", "#4ade80"
    elif green_ratio < 0.45:
        stage, desc, days, color = "Vegetative", "Active leaf development.", "10 – 24 days", "#22c55e"
    else:
        stage, desc, days, color = "Mature", "Dense canopy detected.", "25+ days", "#16a34a"

    return {
        "filename": file.filename,
        "stage": stage,
        "confidence": 0.95,
        "description": desc,
        "days_range": days,
        "color": color,
        "image_metrics": { "green_coverage_pct": round(green_ratio * 100, 1) }
    }

@app.get("/model-status")
async def get_model_status():
    return {
        "loaded_models": list(loaded_models.keys()),
        "vision_models": [k for k in loaded_models.keys() if k.startswith('vision')],
        "status": "Running"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
