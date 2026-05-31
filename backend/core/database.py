"""
core/database.py — NexusOSINT Veritabanı Bağlantı Yöneticisi

Bu modül hem FastAPI (deps.py üzerinden) hem de Celery worker'lar
tarafından paylaşılan async engine / session factory'yi sağlar.
"""
import os
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from typing import AsyncGenerator

# ── Bağlantı URL'si ───────────────────────────────────────────────────────────
DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:supersecretpassword@db:5432/nexusosint",
)

# ── Async Engine (pool_pre_ping: kopuk bağlantıları otomatik yeniler) ─────────
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

# ── Session Factory ───────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency injection için async DB session üreteci."""
    async with AsyncSessionLocal() as session:
        yield session
