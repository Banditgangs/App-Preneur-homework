from sqlalchemy import String, Boolean, Float, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator
import uuid
import enum
from .base import Base
from core.security import encrypt_data, decrypt_data

# Otomatik Şifreleme/Çözme yapan özel SQLAlchemy Veri Tipi
class EncryptedString(TypeDecorator):
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None:
            return encrypt_data(value)
        return value

    def process_result_value(self, value, dialect):
        if value is not None:
            return decrypt_data(value)
        return value

# PRD'de belirtilen Varlık Tipleri
class EntityType(str, enum.Enum):
    EMAIL    = "EMAIL"
    PWD_HASH = "PWD_HASH"
    API_KEY  = "API_KEY"
    SUBDOMAIN= "SUBDOMAIN"
    COMMIT   = "COMMIT"
    IP       = "IP"        # DNS çözümlemesi sonucu bulunan IP adresleri
    LOCATION = "LOCATION"  # IP Geolocation: ülke + şehir bilgisi
    PORT     = "PORT"      # Açık port ve servis (Örn: "80/HTTP")
    MALICIOUS_RECORD = "MALICIOUS_RECORD" # VirusTotal'dan gelen tehdit bulguları

class Target(Base):
    __tablename__ = "targets"
    
    target_value: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    is_monitored: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # İlişkiler (Bir hedefin silinmesi, ona ait tüm varlıkları otomatik siler - CASCADE)
    entities = relationship("Entity", back_populates="target", cascade="all, delete-orphan")

class Entity(Base):
    __tablename__ = "entities"
    
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("targets.id", ondelete="CASCADE"))
    entity_type: Mapped[EntityType] = mapped_column(SQLEnum(EntityType), nullable=False)
    
    # Gerçek (hassas) veri veritabanına şifreli yazılacak
    raw_value: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    source_url: Mapped[str] = mapped_column(String, nullable=False)
    is_ignored: Mapped[bool] = mapped_column(Boolean, default=False)
    
    # İlişkiler
    target = relationship("Target", back_populates="entities")