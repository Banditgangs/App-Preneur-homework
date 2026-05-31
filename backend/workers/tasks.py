import asyncio
import logging
import uuid
import os
from workers.celery_app import celery_app

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool
from models.osint import EntityType, Entity
from services.scanner import (
    resolve_domain_to_ips,
    find_subdomains,
    get_ip_location,
    get_open_ports,
    check_virustotal,
)
import os
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# ── İZOLE VERİTABANI URL'Sİ ──
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:supersecretpassword@db:5432/nexusosint")

@celery_app.task(bind=True, max_retries=3, name="run_full_osint_scan")
def run_full_osint_scan(self, target_id: str, domain: str):
    """Kuyrukta çalışan, çökme korumalı ana tarama motoru."""
    try:
        logger.info(f"🚀 [WORKER] İstihbarat taraması başladı! Hedef: {domain}")
        asyncio.run(_async_osint_pipeline(target_id, domain))
        logger.info(f"✅ [WORKER] İstihbarat taraması tamamlandı: {domain}")
        return {"status": "success", "target": domain}
    except Exception as exc:
        logger.error(f"❌ [WORKER] {domain} taraması hatası. Hata: {exc}")
        raise self.retry(exc=exc, countdown=60)


async def _push_update(target_id: uuid.UUID):
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url)
        await redis_client.publish(f"graph_updates_{target_id}", "update")
        await redis_client.close()
    except Exception as e:
        logger.error(f"[WORKER] Redis Push hatası: {e}")

async def _async_osint_pipeline(target_id_str: str, domain: str):
    """
    İzole veritabanı bağlantısıyla asenkron tarama işlemlerinin yapıldığı yer.
    Gerçek zamanlı (Real-Time) WebSocket hissini verebilmek için veriler bulundukça DB'ye yazılır ve Redis'e PUSH edilir.
    """
    target_id = uuid.UUID(target_id_str)
    
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool, echo=False)
    LocalSession = async_sessionmaker(
        bind=local_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    try:
        loop = asyncio.get_running_loop()
        ips = await loop.run_in_executor(None, resolve_domain_to_ips, domain)
        logger.info(f"[WORKER] {domain} → IP'ler: {ips}")

        # 1. IP'leri anında DB'ye yaz ve PUSH et (Edge'lerin bağlanabilmesi için ID'ler lazım)
        ip_entity_ids = {}
        async with LocalSession() as db:
            for ip in ips:
                try:
                    entity = Entity(
                        target_id=target_id,
                        entity_type=EntityType.IP,
                        raw_value=ip,
                        source_url="dns_resolver",
                        confidence=1.0,
                        is_ignored=False,
                    )
                    db.add(entity)
                    await db.flush()
                    ip_entity_ids[ip] = str(entity.id)
                except Exception as e:
                    logger.error(f"[WORKER] IP ekleme hatası: {e}")
            await db.commit()
        await _push_update(target_id) # Anında UI'a fırlat!

        # ─── PARALEL VE GERÇEK ZAMANLI İŞÇİLER (WORKERS) ───
        async def fetch_and_save_subdomains():
            subs = await find_subdomains(domain)
            if not subs: return
            async with LocalSession() as db:
                for sub in subs:
                    db.add(Entity(
                        target_id=target_id,
                        entity_type=EntityType.SUBDOMAIN,
                        raw_value=sub,
                        source_url="crt_sh",
                        confidence=0.9,
                        is_ignored=False,
                    ))
                await db.commit()
            await _push_update(target_id)

        async def fetch_and_save_location(ip: str, eid: str):
            loc = await get_ip_location(ip)
            if not loc: return
            async with LocalSession() as db:
                db.add(Entity(
                    target_id=target_id,
                    entity_type=EntityType.LOCATION,
                    raw_value=loc,
                    source_url=f"ip_geolocation:{eid}",
                    confidence=1.0,
                    is_ignored=False,
                ))
                await db.commit()
            await _push_update(target_id)

        async def fetch_and_save_ports(ip: str, eid: str):
            ports = await get_open_ports(ip)
            if not ports: return
            async with LocalSession() as db:
                for port in ports:
                    db.add(Entity(
                        target_id=target_id,
                        entity_type=EntityType.PORT,
                        raw_value=port,
                        source_url=f"port_scanner:{eid}",
                        confidence=1.0,
                        is_ignored=False,
                    ))
                await db.commit()
            await _push_update(target_id)

        async def fetch_and_save_threat(target_value: str, is_ip: bool, eid: str):
            threat = await check_virustotal(target_value, "ip" if is_ip else "domain")
            if not threat: return
            async with LocalSession() as db:
                db.add(Entity(
                    target_id=target_id,
                    entity_type=EntityType.MALICIOUS_RECORD,
                    raw_value=threat,
                    source_url=f"vt_scanner:{eid}",
                    confidence=1.0,
                    is_ignored=False,
                ))
                await db.commit()
            await _push_update(target_id)

        # İşçileri (Tasks) kuyruğa al
        tasks = [fetch_and_save_subdomains(), fetch_and_save_threat(domain, False, target_id_str)]

        vt_ips = ips[:2]
        for ip in ips:
            eid = ip_entity_ids.get(ip)
            if not eid: continue
            tasks.append(fetch_and_save_location(ip, eid))
            tasks.append(fetch_and_save_ports(ip, eid))
            if ip in vt_ips:
                tasks.append(fetch_and_save_threat(ip, True, eid))

        # Görevler çalıştıkça bağımsız olarak UI'ı günceller (Real-Time Popping effect)
        await asyncio.gather(*tasks, return_exceptions=True)
        
        logger.info("[WORKER] Tüm gerçek zamanlı görevler bitti ve Frontend'e iletildi.")

    finally:
        await local_engine.dispose()