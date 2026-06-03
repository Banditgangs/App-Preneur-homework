from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID
from datetime import datetime

# Ortak özellikler
class TargetBase(BaseModel):
    target_value: str = Field(..., description="Taranacak hedef (IP, Domain, Email vb.)")
    is_monitored: bool = Field(default=False, description="Sürekli izleme modunda mı?")

import re
from pydantic import field_validator

# Kullanıcıdan API'ye gelirken istenecek veri
class TargetCreate(TargetBase):
    @field_validator("target_value")
    @classmethod
    def sanitize_and_validate_target(cls, v: str) -> str:
        # Strip whitespaces
        v = v.strip().lower()
        # Remove protocols
        v = re.sub(r"^https?://", "", v)
        # Remove trailing slashes and paths
        v = v.split("/")[0]
        
        if not v:
            raise ValueError("Hedef alanı boş olamaz.")
        
        # Basic validation for domain or IPv4
        domain_regex = r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$"
        ip_regex = r"^(?:\d{1,3}\.){3}\d{1,3}$"
        
        if not re.match(domain_regex, v) and not re.match(ip_regex, v):
            raise ValueError("Geçersiz hedef formatı. Lütfen geçerli bir IP adresi veya alan adı (Örn: example.com) girin.")
            
        return v

# API'den kullanıcıya dönerken verilecek veri
class TargetResponse(TargetBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    # SQLAlchemy modellerini Pydantic'e dönüştürmek için gerekli kural (Pydantic V2)
    model_config = ConfigDict(from_attributes=True)