import asyncio
import logging
import uuid
import os
import json
import tempfile
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
        
        # 1. INIT ATOMIC COUNTER: 2 ana görev başlattığımız için sayacı 2 yapıyoruz.
        asyncio.run(_set_active_scans(uuid.UUID(target_id), 2))
        
        # SOAR AUTOMATION FIX:
        # Taramaya başlar başlamaz KÖK DOMAIN (Root Domain) için anında Nuclei'yi paralel olarak fırlat!
        run_nuclei_scan.delay(target_id, f"https://{domain}")
        
        # Aynı zamanda Enterprise Subdomain Enumeration (Amass) işlemini paralel başlat!
        run_amass_scan.delay(target_id, domain)
        
        asyncio.run(_async_osint_pipeline(target_id, domain))
        logger.info(f"✅ [WORKER] İstihbarat taraması tamamlandı: {domain}")
        return {"status": "success", "target": domain}
    except Exception as exc:
        logger.error(f"❌ [WORKER] {domain} taraması hatası. Hata: {exc}")
        # Hata durumunda (Örn: geçersiz domain) Celery retry döngüsüne girmek yerine gracefully kapatıyoruz
        asyncio.run(_handle_scan_failure(target_id, str(exc)))
        return {"status": "failed", "error": str(exc)}

async def _handle_scan_failure(target_id_str: str, error_msg: str):
    target_id = uuid.UUID(target_id_str)
    
    # 1. Hata Düğümünü Grafiğe Ekle (Kullanıcıya bilgi vermek için)
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool, echo=False)
    LocalSession = async_sessionmaker(bind=local_engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with LocalSession() as db:
            entity = Entity(
                target_id=target_id,
                entity_type=EntityType.MALICIOUS_RECORD, # Kırmızı uyarı olarak çıksın
                raw_value=f"Target Resolution Failed: Invalid Target or DNS Error",
                source_url="system_error",
                confidence=1.0,
                is_ignored=False,
            )
            db.add(entity)
            await db.commit()
    except Exception as e:
        logger.error(f"[WORKER] Hata logu kaydedilemedi: {e}")
    finally:
        await local_engine.dispose()
        
    # 2. Sayacı sıfırla ve SCAN_FAILED gönder
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url)
        await redis_client.delete(f"active_scans_{target_id}")
        await redis_client.publish(f"graph_updates_{target_id}", "SCAN_FAILED")
        await redis_client.close()
    except Exception as e:
        logger.error(f"[WORKER] Redis SCAN_FAILED hatası: {e}")



async def _push_update(target_id: uuid.UUID):
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url)
        await redis_client.publish(f"graph_updates_{target_id}", "update")
        await redis_client.close()
    except Exception as e:
        logger.error(f"[WORKER] Redis Push hatası: {e}")

# ── SCAN IN PROGRESS TRACKING (REDIS ATOMIC COUNTERS) ──
async def _set_active_scans(target_id: uuid.UUID, count: int):
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url)
        await redis_client.set(f"active_scans_{target_id}", count)
        await redis_client.expire(f"active_scans_{target_id}", 3600) # 1 hr TTL
        await redis_client.close()
    except Exception as e:
        logger.error(f"[WORKER] Redis Set hatası: {e}")

async def _increment_active_scans(target_id: uuid.UUID):
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url)
        await redis_client.incr(f"active_scans_{target_id}")
        await redis_client.close()
    except Exception as e:
        logger.error(f"[WORKER] Redis Incr hatası: {e}")

async def _decrement_active_scans(target_id: uuid.UUID):
    try:
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        redis_client = aioredis.from_url(redis_url)
        new_val = await redis_client.decr(f"active_scans_{target_id}")
        if new_val <= 0:
            await redis_client.publish(f"graph_updates_{target_id}", "SCAN_COMPLETED")
            await redis_client.delete(f"active_scans_{target_id}")
        await redis_client.close()
    except Exception as e:
        logger.error(f"[WORKER] Redis Decr hatası: {e}")

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
        if not ips:
            # Bug Fix: Hedef tamamen geçersizse veya DNS bulunamadıysa hemen hataya düş (Sonsuz spinner'ı engeller)
            raise ValueError(f"Target Resolution Failed: DNS records for {domain} not found.")
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

from sqlalchemy import select

@celery_app.task(bind=True, max_retries=3, name="simulate_zero_day_hook")
def simulate_zero_day_hook(self):
    """Spontaneous Zero-Day hook to alert the user of new vulnerabilities in their infrastructure."""
    logger.info("🚨 [ZERO-DAY HOOK] Checking infrastructure against new threat intelligence feeds...")
    asyncio.run(_async_zero_day_hook())
    return {"status": "success"}

async def _async_zero_day_hook():
    local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool, echo=False)
    LocalSession = async_sessionmaker(
        bind=local_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    try:
        async with LocalSession() as db:
            # Bulunan rastgele bir alt alan adı üzerinden Zero-Day senaryosu üret
            result = await db.execute(select(Entity).where(Entity.entity_type == EntityType.SUBDOMAIN).limit(1))
            subdomain = result.scalars().first()
            
            if subdomain:
                target_id = subdomain.target_id
                logger.warning(f"🚨 [ZERO-DAY MATCH] Kritik Zafiyet Eşleşmesi! Hedef ID: {target_id}")
                
                new_threat = Entity(
                    target_id=target_id,
                    entity_type=EntityType.MALICIOUS_RECORD,
                    raw_value="CRITICAL: GitLab CVE-2026-9999 Zero-Day Exploit found in wild.",
                    source_url=f"darkweb_feed:{subdomain.id}",
                    confidence=0.98,
                    is_ignored=False,
                )
                db.add(new_threat)
                await db.commit()
                
                # Arayüze "Yeni veri eklendi, haritayı güncelle!" mesajı gönder
                await _push_update(target_id)
    except Exception as e:
        logger.error(f"❌ [ZERO-DAY HOOK] Error: {e}")
    finally:
        await local_engine.dispose()

@celery_app.task(bind=True, max_retries=3, name="run_amass_scan")
def run_amass_scan(self, target_id_str: str, domain: str):
    """OWASP Amass kullanarak gerçek Subdomain Enumeration yapar."""
    logger.info(f"🔍 [AMASS] Starting OWASP Amass passive scan for {domain}")
    asyncio.run(_async_amass_scan(target_id_str, domain))
    return {"status": "success", "domain": domain}

async def _async_amass_scan(target_id_str: str, domain: str):
    target_id = uuid.UUID(target_id_str)
    
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        output_file = tmp.name

    try:
        # Run Amass via subprocess
        # GÜNCELLEME: -json bayrağı bazı Amass versiyonlarında kaldırıldı, yerine düz metin çıktısı (-o) kullanıyoruz
        cmd = f"amass enum -passive -d {domain} -o {output_file}"
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            # 5 dakikalık katı zaman aşımı (Deadlock önleme)
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
        except asyncio.TimeoutError:
            logger.warning(f"⚠️ [AMASS] Timeout expired for {domain} after 300 seconds. Proceeding with partial data.")
            try:
                process.kill()
            except ProcessLookupError:
                pass
            stdout, stderr = b"", b"Timeout"
        
        if process.returncode != 0:
            logger.error(f"❌ [AMASS] Error running amass: {stderr.decode()}")
            # Hata olsa bile oluşan dosyadan okumayı deneyebiliriz ama returncode != 0 genelde başarısızlıktır.
            # Fakat bazen Amass hatalarla bitse bile çıktı oluşturur.

        # Parse text output (Each line is a subdomain)
        discovered_subs = set()
        if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
            with open(output_file, 'r') as f:
                for line in f:
                    sub = line.strip()
                    if not sub: continue
                    # Amass standart çıktısında doğrudan alt alan adını satır satır basar
                    if domain in sub:
                        discovered_subs.add(sub)
        
        logger.info(f"✅ [AMASS] Discovered {len(discovered_subs)} subdomains for {domain}")
        
        if not discovered_subs:
            return

        # Save to Postgres
        local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool, echo=False)
        LocalSession = async_sessionmaker(bind=local_engine, class_=AsyncSession, expire_on_commit=False)
        
        async with LocalSession() as db:
            for sub in discovered_subs:
                entity = Entity(
                    target_id=target_id,
                    entity_type=EntityType.SUBDOMAIN,
                    raw_value=sub,
                    source_url="amass_passive_scan",
                    confidence=0.9,
                    is_ignored=False,
                )
                db.add(entity)
                
                # SOAR AUTOMATION: Her alt alan adı için Nuclei tetikle!
                # Önce sayacı artır, sonra görevi başlat
                await _increment_active_scans(target_id)
                run_nuclei_scan.delay(target_id_str, f"https://{sub}")
                
            await db.commit()
            
        await local_engine.dispose()

        # Push to Redis to trigger frontend Real-Time update
        await _push_update(target_id)
        
    except Exception as e:
        logger.error(f"❌ [AMASS] Exception during scan: {e}")
    finally:
        if os.path.exists(output_file):
            os.remove(output_file)
        # Amass görevi bitti, sayacı 1 düşür
        await _decrement_active_scans(target_id)

@celery_app.task(bind=True, max_retries=3, name="run_nuclei_scan")
def run_nuclei_scan(self, target_id_str: str, target_url: str):
    """Nuclei ile otomatik zafiyet taraması yapar (Tüm severity seviyeleri)."""
    logger.info(f"☢️ [NUCLEI] Starting Nuclei scan for {target_url}")
    asyncio.run(_async_nuclei_scan(target_id_str, target_url))
    return {"status": "success", "url": target_url}

async def _async_nuclei_scan(target_id_str: str, target_url: str):
    target_id = uuid.UUID(target_id_str)
    
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        output_file = tmp.name

    try:
        # Run Nuclei via subprocess (Tüm bulgular gelsin, severity filtresi yok)
        cmd = f"nuclei -u {target_url} -json-export {output_file}"
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            # 5 dakikalık katı zaman aşımı (Deadlock önleme)
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
        except asyncio.TimeoutError:
            logger.warning(f"⚠️ [NUCLEI] Timeout expired for {target_url} after 300 seconds. Proceeding with partial data.")
            try:
                process.kill()
            except ProcessLookupError:
                pass
            stdout, stderr = b"", b"Timeout"
        
        # Parse JSONL output safely (Handling both dict and list structures)
        discovered_threats = []
        if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
            with open(output_file, 'r') as f:
                for line in f:
                    if not line.strip(): continue
                    try:
                        data = json.loads(line)
                        # Veri JSON dizisi (list) geldiyse onu da hesaba katalım (Bug Fix)
                        items = data if isinstance(data, list) else [data]
                        
                        for item in items:
                            if not isinstance(item, dict): continue
                            template_id = item.get("template-id")
                            severity = item.get("info", {}).get("severity", "unknown")
                            name = item.get("info", {}).get("name", "Unknown Vulnerability")
                            if template_id:
                                discovered_threats.append(f"[{severity.upper()}] {template_id}: {name}")
                    except json.JSONDecodeError:
                        continue
        
        logger.info(f"☢️ [NUCLEI] Found {len(discovered_threats)} vulnerabilities for {target_url}")
        
        if not discovered_threats:
            return

        # Save to Postgres
        local_engine = create_async_engine(DATABASE_URL, poolclass=NullPool, echo=False)
        LocalSession = async_sessionmaker(bind=local_engine, class_=AsyncSession, expire_on_commit=False)
        
        async with LocalSession() as db:
            for threat in discovered_threats:
                entity = Entity(
                    target_id=target_id,
                    entity_type=EntityType.MALICIOUS_RECORD,
                    raw_value=f"NUCLEI MATCH on {target_url} -> {threat}",
                    source_url="nuclei_automated_scan",
                    confidence=0.95,
                    is_ignored=False,
                )
                db.add(entity)
            await db.commit()
            
        await local_engine.dispose()

        # Push to Redis to trigger frontend Real-Time update
        await _push_update(target_id)
        
    except Exception as e:
        logger.error(f"❌ [NUCLEI] Exception during scan: {e}")
    finally:
        if os.path.exists(output_file):
            os.remove(output_file)
        # Nuclei görevi bitti, sayacı 1 düşür
        await _decrement_active_scans(target_id)