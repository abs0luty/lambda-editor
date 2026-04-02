from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.config import settings
from pathlib import Path

engine = create_async_engine(settings.DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS path VARCHAR NOT NULL DEFAULT 'Untitled Document'"))
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS kind VARCHAR NOT NULL DEFAULT 'latex'"))
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_filename VARCHAR"))
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type VARCHAR"))
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_path TEXT"))
        await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_size INTEGER"))
