import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from typing import AsyncGenerator

# Veritabanı URL'sini al (Alembic'te kullandığımızın aynısı)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:supersecretpassword@db:5432/nexusosint")

# Asenkron Motor ve Oturum Yöneticisi
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Her API isteği için yeni bir asenkron veritabanı oturumu açar."""
    async with AsyncSessionLocal() as session:
        yield session