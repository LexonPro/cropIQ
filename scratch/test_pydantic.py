from pydantic import BaseModel, Field, validator
import json

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

try:
    data = json.loads('{"N": 90, "P": 42, "K": 43, "temperature": 27.4, "humidity": 72, "ph": 6.5, "rainfall": 200}')
    input_obj = CropInput(**data)
    print("✅ Validation Succeeded:", input_obj)
except Exception as e:
    print("❌ Validation Failed:", e)
