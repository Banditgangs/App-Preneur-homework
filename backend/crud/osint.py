from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from models.osint import Target, Entity, EntityType
from schemas.osint import TargetCreate
import uuid


async def create_target(db: AsyncSession, target_in: TargetCreate) -> Target:
    """Yeni bir hedefi veritabanına kaydeder."""
    db_obj = Target(**target_in.model_dump())
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj


async def get_targets(db: AsyncSession) -> list[Target]:
    """Veritabanındaki tüm hedefleri listeler."""
    result = await db.execute(select(Target))
    return list(result.scalars().all())


async def get_target(db: AsyncSession, target_id: uuid.UUID) -> Target | None:
    """Tek bir hedefi ID'ye göre getirir."""
    result = await db.execute(select(Target).where(Target.id == target_id))
    return result.scalar_one_or_none()


async def get_target_with_entities(db: AsyncSession, target_id: uuid.UUID) -> Target | None:
    """Hedefi, ilişkili Entity'leriyle birlikte tek sorguda getirir."""
    result = await db.execute(
        select(Target)
        .options(selectinload(Target.entities))
        .where(Target.id == target_id)
    )
    return result.scalar_one_or_none()


async def create_entity(
    db: AsyncSession,
    *,
    target_id: uuid.UUID,
    entity_type: EntityType,
    raw_value: str,
    source_url: str,
    confidence: float = 1.0,
) -> Entity:
    """
    Bir hedef için yeni bir Entity (bulgu) kaydeder.

    Args:
        target_id:   Bağlı olduğu Target'ın UUID'si
        entity_type: EntityType enum değeri (EMAIL, IP, SUBDOMAIN vs.)
        raw_value:   Asıl veri (IP adresi, email adresi vs.) — EncryptedString ile şifrelenir
        source_url:  Verinin kaynağı (örn: "dns_resolver", "github_api")
        confidence:  Güven skoru (0.0 - 1.0), varsayılan 1.0
    """
    entity = Entity(
        target_id=target_id,
        entity_type=entity_type,
        raw_value=raw_value,
        source_url=source_url,
        confidence=confidence,
        is_ignored=False,
    )
    db.add(entity)
    await db.commit()
    await db.refresh(entity)
    return entity