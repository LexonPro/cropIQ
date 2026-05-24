from fastapi import FastAPI, HTTPException, Depends, Request
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
    allow_credentials=True,
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
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_token(credentials.credentials)

def require_admin(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(credentials.credentials)
    if not payload.get("admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload

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
    N:           float = Field(..., ge=0, le=150)
    P:           float = Field(..., ge=0, le=150)
    K:           float = Field(..., ge=0, le=150)
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
    return JSONResponse(
        status_code=422,
        content={"status": "error", "message": "Invalid input. Please check values."}
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

        return {"top_predictions": top3, "status": "success"}

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
# 🚀 RUN
# =========================
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("app:app", host="0.0.0.0", port=port)
