import uuid
from datetime import datetime, UTC
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import DateTime

class Base(DeclarativeBase):
    __abstract__ = True

    # Tüm tablolarda standart olarak bulunacak kolonlar
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), 
        default=lambda: datetime.now(UTC), 
        onupdate=lambda: datetime.now(UTC)
    )