"""
CropIQ - Plant Disease Detection Service
=========================================
Deep learning inference pipeline powered by PyTorch ResNet-18 trained on 
the PlantVillage dataset (38 classes).

Attribution:
- Architecture & Weights: ResNet-18 modified for 38-class plant pathology
- Reference implementation: Aditya Dorwal (plant-disease-detection)
- Dataset: PlantVillage (Penn State / EPFL, CC BY-SA)
"""

import os
import io
import logging
from typing import Dict, Any, List, Optional, Tuple
from PIL import Image, UnidentifiedImageError
import numpy as np
import torch
import torch.nn as nn
from torchvision import models, transforms

logger = logging.getLogger("cropiq.disease_detection")

# ==============================================================================
# 1. 38 PLANTVILLAGE CLASSES & METADATA
# ==============================================================================
CLASS_NAMES = [
    "Apple___Apple_scab",
    "Apple___Black_rot",
    "Apple___Cedar_apple_rust",
    "Apple___healthy",
    "Blueberry___healthy",
    "Cherry_(including_sour)___Powdery_mildew",
    "Cherry_(including_sour)___healthy",
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "Corn_(maize)___Common_rust_",
    "Corn_(maize)___Northern_Leaf_Blight",
    "Corn_(maize)___healthy",
    "Grape___Black_rot",
    "Grape___Esca_(Black_Measles)",
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)",
    "Grape___healthy",
    "Orange___Haunglongbing_(Citrus_greening)",
    "Peach___Bacterial_spot",
    "Peach___healthy",
    "Pepper,_bell___Bacterial_spot",
    "Pepper,_bell___healthy",
    "Potato___Early_blight",
    "Potato___Late_blight",
    "Potato___healthy",
    "Raspberry___healthy",
    "Soybean___healthy",
    "Squash___Powdery_mildew",
    "Strawberry___Leaf_scorch",
    "Strawberry___healthy",
    "Tomato___Bacterial_spot",
    "Tomato___Early_blight",
    "Tomato___Late_blight",
    "Tomato___Leaf_Mold",
    "Tomato___Septoria_leaf_spot",
    "Tomato___Spider_mites Two-spotted_spider_mite",
    "Tomato___Target_Spot",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
    "Tomato___Tomato_mosaic_virus",
    "Tomato___healthy"
]

CROP_DISPLAY_MAP = {
    "Apple": "Apple",
    "Blueberry": "Blueberry",
    "Cherry_(including_sour)": "Cherry",
    "Corn_(maize)": "Corn (Maize)",
    "Grape": "Grape",
    "Orange": "Orange",
    "Peach": "Peach",
    "Pepper,_bell": "Bell Pepper",
    "Potato": "Potato",
    "Raspberry": "Raspberry",
    "Soybean": "Soybean",
    "Squash": "Squash",
    "Strawberry": "Strawberry",
    "Tomato": "Tomato"
}

DISEASE_DISPLAY_MAP = {
    "Apple_scab": "Apple Scab",
    "Black_rot": "Black Rot",
    "Cedar_apple_rust": "Cedar Apple Rust",
    "healthy": "Healthy Leaf",
    "Powdery_mildew": "Powdery Mildew",
    "Cercospora_leaf_spot Gray_leaf_spot": "Cercospora / Gray Leaf Spot",
    "Common_rust_": "Common Rust",
    "Northern_Leaf_Blight": "Northern Leaf Blight",
    "Esca_(Black_Measles)": "Esca (Black Measles)",
    "Leaf_blight_(Isariopsis_Leaf_Spot)": "Leaf Blight (Isariopsis Leaf Spot)",
    "Haunglongbing_(Citrus_greening)": "Huanglongbing (Citrus Greening)",
    "Bacterial_spot": "Bacterial Spot",
    "Early_blight": "Early Blight",
    "Late_blight": "Late Blight",
    "Leaf_Mold": "Leaf Mold",
    "Septoria_leaf_spot": "Septoria Leaf Spot",
    "Spider_mites Two-spotted_spider_mite": "Spider Mites (Two-Spotted Spider Mite)",
    "Target_Spot": "Target Spot",
    "Tomato_Yellow_Leaf_Curl_Virus": "Tomato Yellow Leaf Curl Virus",
    "Tomato_mosaic_virus": "Tomato Mosaic Virus"
}

REMEDIES = {
    "Apple___Apple_scab": (
        "Apple Scab detected. Apply protective Captan, Mancozeb, or Myclobutanil fungicides "
        "from bud break until petal fall. Prune dense canopy branches to improve sunlight penetration "
        "and airflow. Rake and destroy fallen leaves in autumn to eliminate overwintering spores."
    ),
    "Apple___Black_rot": (
        "Black Rot (Frogeye leaf spot) detected. Prune out dead twigs, cankers, and mummified fruits "
        "during winter dormancy. Apply Captan or sulfur-based protective sprays during early spring. "
        "Avoid overhead irrigation to keep foliage dry."
    ),
    "Apple___Cedar_apple_rust": (
        "Cedar Apple Rust detected. Apply Myclobutanil or sulfur fungicides when orange cedar galls "
        "become gelatinous after spring rains. Remove nearby wild cedar and juniper trees within a 1-mile "
        "radius if practical to break the fungal lifecycle."
    ),
    "Apple___healthy": (
        "Apple foliage is vibrant, vigorous, and free of pathogen lesions. Maintain standard orchard "
        "sanitation, balanced seasonal nutrition, and regular scouting for early pest activity."
    ),
    "Blueberry___healthy": (
        "Blueberry leaves display optimal chlorophyll pigmentation. Maintain soil pH between 4.5 and 5.2, "
        "apply pine bark mulch to preserve root moisture, and irrigate consistently with non-alkaline water."
    ),
    "Cherry_(including_sour)___Powdery_mildew": (
        "Powdery Mildew detected. Prune infected terminal shoots and water sprouts. Spray wettable sulfur, "
        "Myclobutanil, or horticultural oils during early leaf expansion. Avoid excessive nitrogen applications "
        "which promote vulnerable tender foliage."
    ),
    "Cherry_(including_sour)___healthy": (
        "Cherry leaves appear completely healthy and disease-free. Maintain balanced watering, ensure open "
        "canopy pruning for good ventilation, and scout regularly for aphids and fruit fly activity."
    ),
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": (
        "Gray Leaf Spot (Cercospora) detected. Apply strobilurin or triazole fungicides (e.g. Azoxystrobin, "
        "Pyraclostrobin) at first lesion detection between VT and R1 stages. Rotate fields with non-host crops "
        "and plow crop residues to reduce fungal carryover."
    ),
    "Corn_(maize)___Common_rust_": (
        "Common Rust detected. Apply foliar triazole fungicides if rust pustules appear before tasseling on "
        "susceptible corn varieties. Plant resistant hybrids in upcoming seasons and practice early planting."
    ),
    "Corn_(maize)___Northern_Leaf_Blight": (
        "Northern Leaf Blight detected. Cigar-shaped lesions observed. Apply Chlorothalonil, Propiconazole, "
        "or Mancozeb if lesions develop on lower leaves prior to silking. Rotate with soybeans or legumes "
        "to break pathogen accumulation."
    ),
    "Corn_(maize)___healthy": (
        "Corn leaves show strong chlorophyll development with clean leaf blades. Ensure adequate nitrogen "
        "side-dressing during active vegetative growth and maintain uniform irrigation during tasseling."
    ),
    "Grape___Black_rot": (
        "Grape Black Rot detected. Apply Mancozeb or Myclobutanil sprays starting at 1-3 inch new shoot growth "
        "through 4 weeks post-bloom. Prune out mummified berry clusters and dead canes before bud break."
    ),
    "Grape___Esca_(Black_Measles)": (
        "Esca (Black Measles) complex detected. Prune strictly in dry weather to minimize wound infection. "
        "Coat major pruning wounds with wound sealants or Trichoderma biocontrol formulations. "
        "Remove and burn dead cordon vines."
    ),
    "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)": (
        "Isariopsis Leaf Blight detected. Apply copper hydroxide or Mancozeb sprays post-bloom. "
        "Thin excessive vine shoots to facilitate fast drying after rain events."
    ),
    "Grape___healthy": (
        "Grape foliage is vigorous and free from fungal or bacterial infection. Maintain canopy shoot "
        "positioning, balanced potassium fertigation, and monitor grape clusters regularly."
    ),
    "Orange___Haunglongbing_(Citrus_greening)": (
        "Citrus Greening (Huanglongbing) detected. HLB is a devastating bacterial infection spread by Asian "
        "citrus psyllids. Immediately control psyllid vectors with targeted systemic insecticides (Imidacloprid). "
        "Severely declining trees should be rogued to protect surrounding groves."
    ),
    "Peach___Bacterial_spot": (
        "Peach Bacterial Spot detected. Apply protective copper sprays during late dormancy and Oxytetracycline "
        "sprays from shuck split through cover sprays. Avoid overhead irrigation and maintain tree vigor."
    ),
    "Peach___healthy": (
        "Peach foliage shows clean, healthy blade expansion. Maintain standard stone fruit pest protection "
        "and balanced nitrogen feeding to avoid over-luxuriant vegetative growth."
    ),
    "Pepper,_bell___Bacterial_spot": (
        "Bacterial Spot detected on Bell Pepper. Apply copper bactericides mixed with Mancozeb to enhance "
        "bactericidal activity. Never work in wet fields to prevent mechanical transmission. Rotate with non-solanaceous crops."
    ),
    "Pepper,_bell___healthy": (
        "Bell Pepper foliage is vibrant green and free of leaf lesions. Maintain regular calcium feeding "
        "to prevent blossom end rot, and use drip irrigation to keep foliage completely dry."
    ),
    "Potato___Early_blight": (
        "Potato Early Blight (Alternaria) detected. Apply Chlorothalonil or Mancozeb sprays at 7-10 day intervals "
        "starting when foliage begins to close rows. Prune lower diseased foliage and ensure adequate nitrogen/potassium."
    ),
    "Potato___Late_blight": (
        "Potato Late Blight (Phytophthora infestans) detected. High urgency! Apply systemic fungicides such as "
        "Metalaxyl, Cymoxanil, or Mandipropamid immediately. Destroy infected volunteer plants, maintain proper "
        "ridge hilling, and never dig tubers while foliage is wet."
    ),
    "Potato___healthy": (
        "Potato foliage is healthy with uniform chlorophyll density. Maintain consistent soil moisture to prevent "
        "tuber cracking, and scout weekly for Colorado potato beetles and blight spots."
    ),
    "Raspberry___healthy": (
        "Raspberry foliage appears healthy and vigorous. Prune old fruited canes after harvest, ensure good "
        "trellis airflow, and maintain acidic, organic-rich soil moisture."
    ),
    "Soybean___healthy": (
        "Soybean leaves are clean and healthy. Maintain balanced soil phosphorus and potassium, scout regularly "
        "for defoliating caterpillars or stink bugs, and practice seasonal crop rotation."
    ),
    "Squash___Powdery_mildew": (
        "Squash Powdery Mildew detected. Spray Potassium Bicarbonate, diluted Neem Oil, or Azoxystrobin at the first "
        "white powdery patches. Space plants adequately for rapid morning dew evaporation."
    ),
    "Strawberry___Leaf_scorch": (
        "Strawberry Leaf Scorch detected. Apply Captan, Thiram, or copper-based sprays during early spring crown "
        "emergence. Mow and destroy old infected leaves immediately after final berry harvest."
    ),
    "Strawberry___healthy": (
        "Strawberry foliage is lush and disease-free. Maintain clean straw mulch beneath plants, avoid overhead "
        "sprinklers, and inspect runners regularly."
    ),
    "Tomato___Bacterial_spot": (
        "Tomato Bacterial Spot detected. Spray copper hydroxide combined with Mancozeb. Avoid handling plants when wet. "
        "Disinfect pruning tools between plants and mulch heavily to eliminate splash contamination from soil."
    ),
    "Tomato___Early_blight": (
        "Tomato Early Blight detected with characteristic concentric ring lesions. Prune off lower infected leaves. "
        "Apply Chlorothalonil, Mancozeb, or copper-based fungicides weekly. Stake vines and apply mulch at plant base."
    ),
    "Tomato___Late_blight": (
        "Tomato Late Blight detected. Extremely aggressive fungal pathogen. Apply Chlorothalonil, Mancozeb, or "
        "Metalaxyl immediately. Remove and bag severely diseased plants; do not compost them. Keep foliage dry."
    ),
    "Tomato___Leaf_Mold": (
        "Tomato Leaf Mold (Passalora fulva) detected. Improve greenhouse ventilation and reduce humidity below 85%. "
        "Apply copper-based fungicides or Chlorothalonil and remove lower heavily infected foliage."
    ),
    "Tomato___Septoria_leaf_spot": (
        "Septoria Leaf Spot detected with dark brown bordered circular spots. Prune bottom 12 inches of foliage "
        "after fruit set. Spray Chlorothalonil or Mancozeb. Apply ground mulch to block soil-borne spore splashing."
    ),
    "Tomato___Spider_mites Two-spotted_spider_mite": (
        "Spider Mite infestation detected. Fine stippling and webbing on leaf undersides. Spray insecticidal soap, "
        "horticultural neem oil, or Abamectin targeting leaf undersides. Wash dusty borders as dry conditions favor mites."
    ),
    "Tomato___Target_Spot": (
        "Tomato Target Spot (Corynespora cassiicola) detected. Apply strobilurin or chlorothalonil fungicides. "
        "Prune suckers to enhance interior canopy airflow and rotate with non-host crops."
    ),
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus": (
        "Tomato Yellow Leaf Curl Virus (TYLCV) detected. Transmitted by silverleaf whiteflies. Deploy yellow sticky "
        "traps and apply insecticidal soap or Imidacloprid to suppress vector populations. Remove infected plants."
    ),
    "Tomato___Tomato_mosaic_virus": (
        "Tomato Mosaic Virus (ToMV) detected. Systemic viral disease with mottled foliage. Rogue and destroy infected "
        "plants immediately. Disinfect stakes and tools in 20% nonfat milk. Strictly prohibit tobacco use near crops."
    ),
    "Tomato___healthy": (
        "Tomato leaves are vigorous, dark green, and free of foliar pathogens. Continue balanced fertigation, "
        "ensure sturdy vine trellising, and maintain steady root-zone hydration."
    )
}

# ==============================================================================
# 2. IMAGE PREPROCESSING & NORMALIZATION
# ==============================================================================
TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

# ==============================================================================
# 3. SINGLETON MODEL HOLDER
# ==============================================================================
_MODEL: Optional[nn.Module] = None
_DEVICE = torch.device("cpu")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "models", "resnet18_plant_disease.pth")

# Fallback path if model is in plant-disease-detection
FALLBACK_MODEL_PATH = os.path.join(os.path.dirname(BASE_DIR), "plant-disease-detection", "resnet18_plant_disease.pth")

def build_architecture() -> nn.Module:
    """Build ResNet18 with 38 output classes."""
    model = models.resnet18(weights=None)
    num_ftrs = model.fc.in_features
    model.fc = nn.Sequential(
        nn.Dropout(p=0.5),
        nn.Linear(num_ftrs, len(CLASS_NAMES))
    )
    return model

def get_disease_model() -> nn.Module:
    """
    Load and cache the PyTorch ResNet-18 model into memory once (Singleton).
    """
    global _MODEL
    if _MODEL is None:
        target_path = MODEL_PATH if os.path.exists(MODEL_PATH) else FALLBACK_MODEL_PATH
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Model file not found at {MODEL_PATH} or {FALLBACK_MODEL_PATH}")
            
        logger.info(f"Loading ResNet-18 plant disease model from: {target_path}")
        model = build_architecture()
        state_dict = torch.load(target_path, map_location=_DEVICE)
        model.load_state_dict(state_dict)
        model.to(_DEVICE)
        model.eval()
        _MODEL = model
        logger.info("Plant disease detection model loaded successfully into memory.")
    return _MODEL

# ==============================================================================
# 4. COLOR DISTRIBUTION COMPUTATION
# ==============================================================================
def compute_color_metrics(image: Image.Image) -> Dict[str, float]:
    """
    Computes real leaf pixel distribution for chlorophyll green, 
    chlorosis/mildew yellow, and necrotic lesion/blight tones.
    """
    thumb = image.resize((100, 100)).convert("RGB")
    pixels = list(thumb.getdata())
    total = float(len(pixels))
    
    yellow_count = 0
    necrosis_count = 0
    green_count = 0
    
    for r, g, b in pixels:
        if r > 115 and g > 115 and b < 95 and abs(r - g) < 45:
            yellow_count += 1
        elif (30 < r < 125 and 20 < g < 100 and b < 80 and r > g and g > b) or (r < 40 and g < 40 and b < 40):
            necrosis_count += 1
        elif g > 65 and g > r and g > b:
            green_count += 1
            
    return {
        "green_pct": round((green_count / total) * 100.0, 1),
        "yellow_pct": round((yellow_count / total) * 100.0, 1),
        "necrosis_pct": round((necrosis_count / total) * 100.0, 1)
    }

# ==============================================================================
# 5. CLASS PARSER & SEVERITY
# ==============================================================================
def parse_class_label(raw_class: str) -> Tuple[str, str, bool, str]:
    """
    Parses a raw class name like 'Tomato___Early_blight' into:
    (crop_name, disease_name, is_healthy, severity_status)
    """
    parts = raw_class.split("___")
    raw_crop = parts[0]
    raw_disease = parts[1] if len(parts) > 1 else "Unknown"
    
    crop_name = CROP_DISPLAY_MAP.get(raw_crop, raw_crop.replace("_", " "))
    disease_name = DISEASE_DISPLAY_MAP.get(raw_disease, raw_disease.replace("_", " "))
    
    is_healthy = "healthy" in raw_disease.lower()
    
    if is_healthy:
        status = "optimal"
    elif any(term in raw_disease.lower() for term in ["late_blight", "mosaic", "greening", "bacterial_spot", "yellow_leaf_curl"]):
        status = "danger"
    else:
        status = "warning"
        
    return crop_name, disease_name, is_healthy, status

# ==============================================================================
# 6. FULL INFERENCE PIPELINE
# ==============================================================================
CONFIDENCE_THRESHOLD = 35.0  # Alert if top prediction is below this confidence

def predict_leaf_disease(image_bytes: bytes) -> Dict[str, Any]:
    """
    Runs end-to-end leaf disease prediction on raw image bytes.
    Validates, preprocesses, runs PyTorch inference, and returns structured diagnosis.
    """
    if not image_bytes or len(image_bytes) == 0:
        raise ValueError("Image file is empty.")
        
    if len(image_bytes) > 10 * 1024 * 1024:
        raise ValueError("Image file exceeds 10MB limit.")
        
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.verify()  # Validate image integrity
        # Re-open after verify() because verify() exhausts file pointer
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except (UnidentifiedImageError, Exception) as e:
        raise ValueError("Uploaded file is not a valid or readable image.") from e

    # Compute genuine visual leaf metrics
    metrics = compute_color_metrics(image)
    
    # Preprocess image for ResNet18
    input_tensor = TRANSFORM(image).unsqueeze(0).to(_DEVICE)
    
    # Load model and run inference
    model = get_disease_model()
    with torch.no_grad():
        logits = model(input_tensor)
        probs = torch.nn.functional.softmax(logits, dim=1).squeeze(0)
        
    # Top 3 predictions
    top_probs, top_indices = torch.topk(probs, k=min(3, len(CLASS_NAMES)))
    
    top3_list = []
    for p, idx in zip(top_probs, top_indices):
        cls_name = CLASS_NAMES[idx.item()]
        c_name, d_name, _, _ = parse_class_label(cls_name)
        top3_list.append({
            "raw_class": cls_name,
            "crop": c_name,
            "disease": d_name,
            "confidence": round(float(p.item()) * 100.0, 2)
        })
        
    top_pred = top3_list[0]
    raw_class = top_pred["raw_class"]
    crop_name = top_pred["crop"]
    disease_name = top_pred["disease"]
    confidence = top_pred["confidence"]
    
    _, _, is_healthy, status = parse_class_label(raw_class)
    remedy = REMEDIES.get(raw_class, "Maintain balanced watering, monitor plant vigor, and consult local extension services.")
    
    is_uncertain = confidence < CONFIDENCE_THRESHOLD
    if is_uncertain:
        remedy = (
            f"Low confidence diagnosis ({confidence}%). The leaf symptoms are ambiguous or the image "
            f"may be out of focus. Please capture a clear, well-lit close-up of an individual affected leaf. "
            f"Preliminary match: {remedy}"
        )
        if status == "optimal":
            status = "warning"

    # Display label formatted for CropIQ frontend
    if is_healthy:
        formatted_disease_title = f"{crop_name} — Healthy Leaf"
    else:
        formatted_disease_title = f"{crop_name} — {disease_name}"

    return {
        "success": True,
        "crop": crop_name,
        "disease": formatted_disease_title,
        "confidence": confidence,
        "remedy": remedy,
        "status": status,
        "metrics": metrics,
        "status_code": "success",
        "prediction": {
            "crop": crop_name,
            "disease": disease_name,
            "raw_class": raw_class,
            "confidence": confidence,
            "is_healthy": is_healthy,
            "is_uncertain": is_uncertain
        },
        "top_predictions": top3_list
    }
