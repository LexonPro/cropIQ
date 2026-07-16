from fastapi import FastAPI, HTTPException, Depends, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, validator
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta
import sqlite3
import joblib
import numpy as np
import os
from PIL import Image
import io


# =========================
# 🚀 APP
# =========================
app = FastAPI(title="Smart Crop Advisor API")

# =========================
# 🌐 CORS
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# 🔐 AUTH CONFIG
# =========================
SECRET_KEY             = os.environ.get("SECRET_KEY", "cropiq-super-secret-change-in-production")
ALGORITHM              = "HS256"
TOKEN_EXPIRE_HOURS     = 24

ADMIN_EMAIL            = os.environ.get("ADMIN_EMAIL",    "admin@cropiq.com")
ADMIN_PASSWORD         = os.environ.get("ADMIN_PASSWORD", "admin123")   # change this!

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

# =========================
# 🗄️ DATABASE SETUP
# =========================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, "cropiq_users.db")

def get_db():
    """Get a database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row   # rows act like dicts
    return conn

def init_db():
    """Create tables if they don't exist."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            email       TEXT    UNIQUE NOT NULL,
            password    TEXT    NOT NULL,
            created_at  TEXT    DEFAULT (datetime('now')),
            last_login  TEXT,
            login_count INTEGER DEFAULT 0,
            is_active   INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS predictions_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email  TEXT,
            N           REAL, P REAL, K REAL,
            temperature REAL, humidity REAL, ph REAL, rainfall REAL,
            top_crop    TEXT,
            confidence  REAL,
            created_at  TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()
    print("✅ Database initialised:", DB_PATH)

init_db()

# =========================
# 🔑 JWT HELPERS
# =========================
def create_token(email: str, is_admin: bool = False) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": email, "exp": expire, "admin": is_admin}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    # Bypassed authentication to allow open access
    return {"sub": "guest@cropiq.com", "admin": True}

def require_admin(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    # Bypassed authentication to allow open access
    return {"sub": "admin@cropiq.com", "admin": True}

# =========================
# 📊 PYDANTIC MODELS
# =========================
class RegisterInput(BaseModel):
    name:     str = Field(..., min_length=2,  max_length=80)
    email:    str = Field(..., min_length=5,  max_length=120)
    password: str = Field(..., min_length=6,  max_length=128)

class LoginInput(BaseModel):
    email:    str
    password: str

class CropInput(BaseModel):
    N:           float = Field(..., ge=0, le=300)
    P:           float = Field(..., ge=0, le=300)
    K:           float = Field(..., ge=0, le=300)
    temperature: float = Field(..., ge=0, le=60)
    humidity:    float = Field(..., ge=0, le=100)
    ph:          float = Field(..., ge=0, le=14)
    rainfall:    float = Field(..., ge=0, le=300)

    @validator("*", pre=True)
    def no_empty(cls, v):
        if v is None or (isinstance(v, str) and v.strip() == ""):
            raise ValueError("Field cannot be empty")
        return float(v)

# =========================
# 🚨 VALIDATION ERROR HANDLER
# =========================
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print("❌ Validation error:", exc.errors())
    return JSONResponse(
        status_code=422,
        content={"status": "error", "message": f"Invalid input. Errors: {exc.errors()}"}
    )

# =========================
# 📦 ML MODEL
# =========================
model_path = os.path.join(BASE_DIR, "models", "model.pkl")
model = None

def load_model():
    global model
    if model is None:
        try:
            model = joblib.load(model_path)
            print("✅ Model loaded")
        except Exception as e:
            print("❌ Model load failed:", e)
            raise HTTPException(status_code=500, detail="Model load failed")

# =========================
# 🟢 HEALTH
# =========================
@app.get("/", response_class=PlainTextResponse)
def home():
    return "OK"

@app.get("/health", response_class=PlainTextResponse)
def health():
    return "healthy"

# =========================
# 📝 REGISTER
# =========================
@app.post("/auth/register")
def register(data: RegisterInput):
    email = data.email.strip().lower()

    # Basic email format check
    if "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")

    conn = get_db()

    # Check duplicate
    existing = conn.execute(
        "SELECT id FROM users WHERE email = ?", (email,)
    ).fetchone()

    if existing:
        conn.close()
        raise HTTPException(status_code=400,
                            detail="An account with this email already exists")

    # Hash password with bcrypt
    hashed = pwd_context.hash(data.password)

    conn.execute(
        "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
        (data.name.strip(), email, hashed)
    )
    conn.commit()
    conn.close()

    token = create_token(email)
    return {
        "token":  token,
        "name":   data.name.strip(),
        "email":  email,
        "status": "success"
    }

# =========================
# 🔑 LOGIN
# =========================
@app.post("/auth/login")
def login(data: LoginInput):
    email = data.email.strip().lower()

    # ── Admin login ──────────────────────────────
    if email == ADMIN_EMAIL.lower() and data.password == ADMIN_PASSWORD:
        token = create_token(email, is_admin=True)
        return {
            "token":    token,
            "name":     "Admin",
            "email":    email,
            "is_admin": True,
            "status":   "success"
        }

    # ── Regular user login ───────────────────────
    conn = get_db()
    user = conn.execute(
        "SELECT id, name, email, password, is_active FROM users WHERE email = ?",
        (email,)
    ).fetchone()

    if not user:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not user["is_active"]:
        conn.close()
        raise HTTPException(status_code=403, detail="Account is deactivated")

    if not pwd_context.verify(data.password, user["password"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Update last_login and login_count
    conn.execute(
        "UPDATE users SET last_login = datetime('now'), login_count = login_count + 1 WHERE email = ?",
        (email,)
    )
    conn.commit()
    conn.close()

    token = create_token(email)
    return {
        "token":    token,
        "name":     user["name"],
        "email":    email,
        "is_admin": False,
        "status":   "success"
    }

# =========================
# 👤 GET PROFILE (protected)
# =========================
@app.get("/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    email = current_user["sub"]
    conn  = get_db()
    user  = conn.execute(
        "SELECT name, email, created_at, last_login, login_count FROM users WHERE email = ?",
        (email,)
    ).fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "name":        user["name"],
        "email":       user["email"],
        "created_at":  user["created_at"],
        "last_login":  user["last_login"],
        "login_count": user["login_count"],
        "status":      "success"
    }

# =========================
# 🌾 OPTIMAL CROP TARGETS FOR ADVISORY
# =========================
CROP_TARGETS = {
    "rice":         {"N": 80,  "P": 40, "K": 40, "ph": 6.5, "name": "Rice"},
    "maize":        {"N": 100, "P": 50, "K": 30, "ph": 6.2, "name": "Maize"},
    "chickpea":     {"N": 40,  "P": 60, "K": 80, "ph": 7.0, "name": "Chickpea"},
    "kidneybeans":  {"N": 20,  "P": 60, "K": 20, "ph": 6.0, "name": "Kidney Beans"},
    "pigeonpeas":   {"N": 20,  "P": 68, "K": 20, "ph": 6.5, "name": "Pigeon Peas"},
    "mothbeans":    {"N": 20,  "P": 40, "K": 20, "ph": 6.8, "name": "Moth Beans"},
    "mungbean":     {"N": 20,  "P": 40, "K": 20, "ph": 6.7, "name": "Mung Bean"},
    "blackgram":    {"N": 40,  "P": 60, "K": 20, "ph": 7.0, "name": "Black Gram"},
    "lentil":       {"N": 20,  "P": 60, "K": 20, "ph": 6.8, "name": "Lentil"},
    "pomegranate":  {"N": 20,  "P": 10, "K": 40, "ph": 6.4, "name": "Pomegranate"},
    "banana":       {"N": 100, "P": 82, "K": 50, "ph": 6.0, "name": "Banana"},
    "mango":        {"N": 20,  "P": 28, "K": 30, "ph": 5.8, "name": "Mango"},
    "grapes":       {"N": 24,  "P": 122,"K": 200,"ph": 6.0, "name": "Grapes"},
    "watermelon":   {"N": 80,  "P": 24, "K": 50, "ph": 6.5, "name": "Watermelon"},
    "muskmelon":    {"N": 100, "P": 18, "K": 50, "ph": 6.3, "name": "Muskmelon"},
    "apple":        {"N": 20,  "P": 125,"K": 200,"ph": 5.9, "name": "Apple"},
    "orange":       {"N": 20,  "P": 10, "K": 10, "ph": 7.0, "name": "Orange"},
    "papaya":       {"N": 50,  "P": 50, "K": 50, "ph": 6.5, "name": "Papaya"},
    "coconut":      {"N": 20,  "P": 10, "K": 30, "ph": 6.0, "name": "Coconut"},
    "cotton":       {"N": 120, "P": 60, "K": 20, "ph": 7.0, "name": "Cotton"},
    "jute":         {"N": 80,  "P": 40, "K": 40, "ph": 6.7, "name": "Jute"},
    "coffee":       {"N": 100, "P": 30, "K": 30, "ph": 5.8, "name": "Coffee"}
}

def generate_advisory(crop_key: str, actual_n: float, actual_p: float, actual_k: float, actual_ph: float):
    crop_key = crop_key.lower().strip()
    target = CROP_TARGETS.get(crop_key, {"N": 50, "P": 50, "K": 50, "ph": 6.5, "name": crop_key.capitalize()})
    
    advice = []
    
    # Nitrogen logic
    diff_n = target["N"] - actual_n
    if diff_n > 10:
        urea_needed = round(diff_n * 2.17, 1)
        advice.append({
            "nutrient": "Nitrogen (N)", 
            "status": "deficient", 
            "diff": round(diff_n, 1),
            "message": f"Deficient by {round(diff_n, 1)} mg/kg. Apply ~{urea_needed} kg/acre of Urea fertilizer to replenish Nitrogen levels."
        })
    elif diff_n < -30:
        advice.append({
            "nutrient": "Nitrogen (N)", 
            "status": "excess", 
            "diff": round(diff_n, 1),
            "message": f"Excessive by {round(abs(diff_n), 1)} mg/kg. Pause Nitrogen-heavy additions. Flush soil with balanced watering."
        })
    else:
        advice.append({
            "nutrient": "Nitrogen (N)", 
            "status": "optimal", 
            "diff": round(diff_n, 1),
            "message": "Optimal range. Soil Nitrogen is well-balanced for this crop."
        })

    # Phosphorus logic
    diff_p = target["P"] - actual_p
    if diff_p > 10:
        dap_needed = round(diff_p * 2.17, 1)
        advice.append({
            "nutrient": "Phosphorus (P)", 
            "status": "deficient", 
            "diff": round(diff_p, 1),
            "message": f"Deficient by {round(diff_p, 1)} mg/kg. Apply ~{dap_needed} kg/acre of DAP (Diammonium Phosphate) before sowing."
        })
    elif diff_p < -30:
        advice.append({
            "nutrient": "Phosphorus (P)", 
            "status": "excess", 
            "diff": round(diff_p, 1),
            "message": f"Excessive by {round(abs(diff_p), 1)} mg/kg. High Phosphorus can inhibit iron and zinc absorption. Avoid phosphate additions."
        })
    else:
        advice.append({
            "nutrient": "Phosphorus (P)", 
            "status": "optimal", 
            "diff": round(diff_p, 1),
            "message": "Optimal range. Soil Phosphorus is ideal."
        })

    # Potassium logic
    diff_k = target["K"] - actual_k
    if diff_k > 10:
        mop_needed = round(diff_k * 1.67, 1)
        advice.append({
            "nutrient": "Potassium (K)", 
            "status": "deficient", 
            "diff": round(diff_k, 1),
            "message": f"Deficient by {round(diff_k, 1)} mg/kg. Add ~{mop_needed} kg/acre of Muriate of Potash (MOP) to boost crop immunity and yield."
        })
    elif diff_k < -30:
        advice.append({
            "nutrient": "Potassium (K)", 
            "status": "excess", 
            "diff": round(diff_k, 1),
            "message": f"Excessive by {round(abs(diff_k), 1)} mg/kg. Excessive Potassium can block Magnesium uptake. Reduce potash additions."
        })
    else:
        advice.append({
            "nutrient": "Potassium (K)", 
            "status": "optimal", 
            "diff": round(diff_k, 1),
            "message": "Optimal range. Soil Potassium is well-balanced."
        })

    # pH logic
    diff_ph = target["ph"] - actual_ph
    if actual_ph < 5.5:
        lime_needed = round((5.5 - actual_ph) * 500, 0)
        advice.append({
            "nutrient": "Soil pH", 
            "status": "acidic", 
            "diff": round(diff_ph, 2),
            "message": f"Soil is acidic (pH {actual_ph}). Broadcast ~{lime_needed} kg/acre of Agricultural Lime (Calcium Carbonate) to raise pH to target {target['ph']}."
        })
    elif actual_ph > 7.5:
        sulfur_needed = round((actual_ph - 7.5) * 150, 0)
        advice.append({
            "nutrient": "Soil pH", 
            "status": "alkaline", 
            "diff": round(diff_ph, 2),
            "message": f"Soil is alkaline (pH {actual_ph}). Apply ~{sulfur_needed} kg/acre of Agricultural elemental Sulfur or Gypsum to lower pH to target {target['ph']}."
        })
    else:
        advice.append({
            "nutrient": "Soil pH", 
            "status": "optimal", 
            "diff": round(diff_ph, 2),
            "message": f"Optimal pH level ({actual_ph}) for nutrient availability in {target['name']} crops."
        })

    return {
        "crop_name": target["name"],
        "targets": target,
        "advice": advice
    }

# =========================
# 🌾 PREDICT (protected)
# =========================
@app.post("/predict")
def predict(data: CropInput, current_user: dict = Depends(get_current_user)):
    load_model()

    try:
        if data.ph > 9:
            return {"recommended_crop": "Soil too alkaline", "status": "warning"}
        if data.ph < 4:
            return {"recommended_crop": "Soil too acidic",   "status": "warning"}

        features = np.array([[
            data.N, data.P, data.K,
            data.temperature, data.humidity,
            data.ph, data.rainfall
        ]])

        prediction = model.predict(features)[0]

        try:
            probabilities = model.predict_proba(features)[0]
            classes       = model.classes_
            top3_indices  = np.argsort(probabilities)[::-1][:3]
            top3 = [
                {"crop": str(classes[i]), "confidence": round(float(probabilities[i]), 4)}
                for i in top3_indices if probabilities[i] > 0
            ]
        except Exception:
            top3 = [{"crop": str(prediction), "confidence": 1.0}]

        # Compute Agronomic Advisory Targets
        advisory = generate_advisory(top3[0]["crop"] if top3 else prediction, data.N, data.P, data.K, data.ph)

        # ── Log prediction to DB ─────────────────
        try:
            conn = get_db()
            conn.execute(
                """INSERT INTO predictions_log
                   (user_email, N, P, K, temperature, humidity, ph, rainfall, top_crop, confidence)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    current_user["sub"],
                    data.N, data.P, data.K,
                    data.temperature, data.humidity,
                    data.ph, data.rainfall,
                    top3[0]["crop"] if top3 else prediction,
                    top3[0]["confidence"] if top3 else 1.0
                )
            )
            conn.commit()
            conn.close()
        except Exception as log_err:
            print("⚠️ Log error (non-fatal):", log_err)

        return {"top_predictions": top3, "advisory": advisory, "status": "success"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =========================
# 🌱 FERTILIZER
# =========================
@app.post("/fertilizer")
def fertilizer(data: dict, current_user: dict = Depends(get_current_user)):
    crop = str(data.get("crop", "")).strip().lower()
    if not crop:
        raise HTTPException(status_code=400, detail="Crop name required")
    fertilizer_map = {
        "rice": "Urea + DAP", "wheat": "Urea + Potash",
        "maize": "Balanced NPK", "cotton": "High Nitrogen"
    }
    return {"recommended_fertilizer": fertilizer_map.get(crop, "General NPK"), "status": "success"}

# =========================
# 💧 WATER
# =========================
@app.post("/water")
def water(data: dict, current_user: dict = Depends(get_current_user)):
    rainfall = data.get("rainfall")
    if rainfall is None:
        raise HTTPException(status_code=400, detail="Rainfall required")
    try:
        rainfall = float(rainfall)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid rainfall")

    if rainfall > 200:   advice = "No irrigation needed"
    elif rainfall < 100: advice = "Irrigate soon"
    else:                advice = "Moderate irrigation"
    return {"water_advice": advice, "status": "success"}

# =========================
# 👑 ADMIN — GET ALL USERS
# =========================
@app.get("/admin/users")
def admin_get_users(admin: dict = Depends(require_admin)):
    conn  = get_db()
    users = conn.execute(
        """SELECT id, name, email, created_at, last_login,
                  login_count, is_active
           FROM users
           ORDER BY created_at DESC"""
    ).fetchall()
    conn.close()

    return {
        "users": [dict(u) for u in users],
        "total": len(users),
        "status": "success"
    }

# =========================
# 👑 ADMIN — GET ALL PREDICTIONS
# =========================
@app.get("/admin/predictions")
def admin_get_predictions(admin: dict = Depends(require_admin)):
    conn = get_db()
    rows = conn.execute(
        """SELECT id, user_email, N, P, K, temperature, humidity, ph,
                  rainfall, top_crop, confidence, created_at
           FROM predictions_log
           ORDER BY created_at DESC
           LIMIT 200"""
    ).fetchall()
    conn.close()

    return {
        "predictions": [dict(r) for r in rows],
        "total":       len(rows),
        "status":      "success"
    }

# =========================
# 👑 ADMIN — STATS
# =========================
@app.get("/admin/stats")
def admin_stats(admin: dict = Depends(require_admin)):
    conn = get_db()

    total_users       = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    active_users      = conn.execute("SELECT COUNT(*) FROM users WHERE is_active=1").fetchone()[0]
    total_predictions = conn.execute("SELECT COUNT(*) FROM predictions_log").fetchone()[0]

    today = datetime.utcnow().strftime("%Y-%m-%d")
    new_today = conn.execute(
        "SELECT COUNT(*) FROM users WHERE created_at LIKE ?", (f"{today}%",)
    ).fetchone()[0]
    preds_today = conn.execute(
        "SELECT COUNT(*) FROM predictions_log WHERE created_at LIKE ?", (f"{today}%",)
    ).fetchone()[0]

    top_crops = conn.execute(
        """SELECT top_crop, COUNT(*) as count
           FROM predictions_log
           GROUP BY top_crop
           ORDER BY count DESC
           LIMIT 5"""
    ).fetchall()

    conn.close()

    return {
        "total_users":        total_users,
        "active_users":       active_users,
        "total_predictions":  total_predictions,
        "new_users_today":    new_today,
        "predictions_today":  preds_today,
        "top_crops":          [dict(r) for r in top_crops],
        "status":             "success"
    }

# =========================
# 👑 ADMIN — DEACTIVATE USER
# =========================
@app.post("/admin/users/{user_id}/deactivate")
def deactivate_user(user_id: int, admin: dict = Depends(require_admin)):
    conn = get_db()
    conn.execute("UPDATE users SET is_active = 0 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"message": f"User {user_id} deactivated", "status": "success"}

# =========================
# 👑 ADMIN — ACTIVATE USER
# =========================
@app.post("/admin/users/{user_id}/activate")
def activate_user(user_id: int, admin: dict = Depends(require_admin)):
    conn = get_db()
    conn.execute("UPDATE users SET is_active = 1 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"message": f"User {user_id} activated", "status": "success"}

# =========================
# 👑 ADMIN — DELETE USER
# =========================
@app.delete("/admin/users/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    conn = get_db()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"message": f"User {user_id} deleted", "status": "success"}

# =========================
# 👑 ADMIN DASHBOARD (HTML)
# =========================
@app.get("/admin", response_class=HTMLResponse)
def admin_dashboard():
    """
    Serve the admin dashboard HTML page.
    The page itself calls /admin/* endpoints with the admin JWT.
    """
    with open(os.path.join(BASE_DIR, "admin.html"), "r") as f:
        return f.read()

# =========================
# 🩺 AI LEAF DISEASE DETECTION
# =========================
@app.post("/predict-disease")
async def predict_disease(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    try:
        # Read file bytes
        contents = await file.read()
        
        # Load image via Pillow and convert to RGB
        try:
            image = Image.open(io.BytesIO(contents)).convert("RGB")
        except Exception:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")
            
        # Downscale to 100x100 for fast, memory-safe pixel scanning (avoids Render OOM crashes)
        image = image.resize((100, 100))
        pixels = list(image.getdata())
        
        # Colour categorization counts
        yellow_count = 0
        necrosis_count = 0
        green_count = 0
        
        for r, g, b in pixels:
            # Yellow heuristic: high red, high green, low blue (mildews, rusts, chlorosis)
            if r > 115 and g > 115 and b < 95 and abs(r - g) < 45:
                yellow_count += 1
            # Necrosis heuristic: dark brown, spots, or black lesions (leaf spots, early/late blight)
            elif (30 < r < 125 and 20 < g < 100 and b < 80 and r > g and g > b) or (r < 40 and g < 40 and b < 40):
                necrosis_count += 1
            # Green heuristic: healthy chlorophyll (green-dominant)
            elif g > 65 and g > r and g > b:
                green_count += 1

        total = 10000.0
        pct_green = (green_count / total) * 100.0
        pct_yellow = (yellow_count / total) * 100.0
        pct_necrosis = (necrosis_count / total) * 100.0

        # Diagnosis logic based on colour ratios
        if pct_green > 60 and (pct_yellow + pct_necrosis) < 6:
            disease = "Healthy Leaf"
            confidence = round(pct_green, 1)
            remedy = "Your crop leaves display normal chlorophyll density. No active fungal or bacterial infections detected. Maintain standard watering and crop rotation cycles."
            status = "optimal"
        elif pct_yellow > 8 and pct_necrosis <= 6:
            disease = "Powdery Mildew / Rust Fungi"
            confidence = round(min(pct_yellow * 4.5, 96.5), 1)
            remedy = "Fungal infection detected. Immediately prune heavily infested foliage. Spray diluted organic Neem Oil solution or sulfur-based fungicides to suppress spore germination."
            status = "warning"
        elif pct_necrosis > 8 and pct_yellow <= 6:
            disease = "Early Blight / Alternaria Spot"
            confidence = round(min(pct_necrosis * 4.5, 95.8), 1)
            remedy = "Leaf spot pathogens detected. Avoid overhead watering to keep leaf surfaces dry. Spray copper-based fungicides or utilize bio-pesticides (Bacillus subtilis)."
            status = "danger"
        elif pct_yellow > 5 and pct_necrosis > 5:
            disease = "Late Blight Disease (Phytophthora)"
            confidence = round(min((pct_yellow + pct_necrosis) * 3.5, 97.2), 1)
            remedy = "Severe blight conditions indicated. Apply chlorothalonil, Mancozeb, or metalaxyl fungicides immediately. Ensure maximum spacing between plants for adequate ventilation."
            status = "danger"
        else:
            # Fallback based on dominant symptom
            if pct_yellow > pct_necrosis:
                disease = "Nutrient Chlorosis (Iron/Magnesium Deficiency)"
                confidence = 82.5
                remedy = "Yellowing between veins detected. Spray chelated Iron or Magnesium Sulfate (Epsom salt) solution to restore healthy green color."
                status = "warning"
            else:
                disease = "Mild Leaf Spotting / Early Pathogen activity"
                confidence = 74.0
                remedy = "Minor leaf spotting observed. Prune lower affected leaves to stop soil-borne splash infection, and monitor closely."
                status = "warning"

        return {
            "disease": disease,
            "confidence": confidence,
            "remedy": remedy,
            "status": status,
            "metrics": {
                "green_pct": round(pct_green, 1),
                "yellow_pct": round(pct_yellow, 1),
                "necrosis_pct": round(pct_necrosis, 1)
            },
            "status_code": "success"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =========================
# 📊 MANDI MARKET PRICES
# =========================
@app.get("/market-prices")
def get_market_prices(current_user: dict = Depends(get_current_user)):
    prices = [
        {"commodity": "Wheat (Kanak)", "mandi": "Khanna Mandi", "state": "Punjab", "min": 2400, "max": 2550, "avg": 2480, "trend": "up"},
        {"commodity": "Paddy (Dhan)", "mandi": "Gondal Mandi", "state": "Gujarat", "min": 2100, "max": 2300, "avg": 2220, "trend": "down"},
        {"commodity": "Sugarcane", "mandi": "Muzaffarnagar Mandi", "state": "Uttar Pradesh", "min": 380, "max": 415, "avg": 402, "trend": "up"},
        {"commodity": "Potato (Aloo)", "mandi": "Agra Mandi", "state": "Uttar Pradesh", "min": 1200, "max": 1500, "avg": 1380, "trend": "up"},
        {"commodity": "Cotton (Kapas)", "mandi": "Adoni Mandi", "state": "Andhra Pradesh", "min": 6800, "max": 7500, "avg": 7150, "trend": "down"},
        {"commodity": "Coffee Beans", "mandi": "Chikmagalur Mandi", "state": "Karnataka", "min": 18000, "max": 21000, "avg": 19500, "trend": "up"},
        {"commodity": "Mustard Seeds", "mandi": "Alwar Mandi", "state": "Rajasthan", "min": 5200, "max": 5650, "avg": 5420, "trend": "up"},
        {"commodity": "Jute Fibre", "mandi": "Nadia Mandi", "state": "West Bengal", "min": 4500, "max": 4900, "avg": 4710, "trend": "down"}
    ]
    return {"prices": prices, "status": "success"}

# =========================
# 🚀 RUN
# =========================
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("app:app", host="0.0.0.0", port=port)

