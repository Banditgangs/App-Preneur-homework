from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID
from datetime import datetime

# Ortak özellikler
class TargetBase(BaseModel):
    target_value: str = Field(..., description="Taranacak hedef (IP, Domain, Email vb.)")
    is_monitored: bool = Field(default=False, description="Sürekli izleme modunda mı?")

# Kullanıcıdan API'ye gelirken istenecek veri
class TargetCreate(TargetBase):
    pass

# API'den kullanıcıya dönerken verilecek veri
class TargetResponse(TargetBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    # SQLAlchemy modellerini Pydantic'e dönüştürmek için gerekli kural (Pydantic V2)
    model_config = ConfigDict(from_attributes=True)