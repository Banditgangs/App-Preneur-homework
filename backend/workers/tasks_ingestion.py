"""
workers/tasks_ingestion.py — NexusOSINT OSINT Tarama Celery Task'ları

─── Neden bu yapı? ────────────────────────────────────────────────────────────
Celery worker'lar senkron süreçlerde çalışır. Her `asyncio.run()` çağrısı
YENİ bir event loop oluşturur. Eğer SQLAlchemy async engine modül yüklenirken
(import zamanında) oluşturulursa, bu engine eski / kapalı bir event loop'a
bağlı kalır ve sonraki `asyncio.run()` çağrısında:

    IllegalStateChangeError("Method 'commit()' can't be called here...")

hatasını üretir. asyncpg bağlantı havuzu loop-bound'dur.

─── Çözüm ────────────────────────────────────────────────────────────────────
1. Engine, her task çağrısında RUNTIME'da `NullPool` ile TAZE oluşturulur.
   NullPool = bağlantı havuzu yok; her işlem fresh connection alır, bitirir.
   Bu Celery ortamları için en güvenli strateji.

2. Tüm DB yazımları TEK bir session içinde SIRAYLA yapılır.
   (gather ile paylaşılan session → transaction kilitleniyor — önlendi)

3. Dış API çağrıları (crt.sh, ip-api) yazımlardan ÖNCE toplanır,
   ardından DB işlemleri sıralı ve tek commit'le tamamlanır.

4. `create_entity` CRUD fonksiyonu artık commit yapmıyor (flush yeterli);
   commit session kapanırken context manager tarafından yapılır.
"""
import asyncio
import logging
import os
import uuid as uuid_lib

import httpx
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool

from workers.celery_app import app as celery_app
from models.osint import EntityType, Entity
from services.scanner import (
    resolve_domain_to_ips,
    find_subdomains,
    get_ip_location,
)

logger = logging.getLogger(__name__)

# ── Sabitler ─────────────────────────────────────────────────────────────────
MAX_RETRIES    = 3
BASE_COUNTDOWN = 60    # saniye — exponential backoff: 60 → 120 → 240
DATABASE_URL   = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:supersecretpassword@db:5432/nexusosint",
)


# ═══════════════════════════════════════════════════════════════════════════════
# Yardımcı: Task-izole DB session factory (runtime'da oluşturulur)
# ═══════════════════════════════════════════════════════════════════════════════

def _make_session_factory():
    """
    Her task çağrısında taze bir async engine + session factory döner.

    NullPool: bağlantı havuzlamaz → her asyncio.run() için yeni loop ile uyumlu.
    Bu, Celery worker'larında asyncpg kullanmanın TEK güvenli yoludur.
    """
    engine = create_async_engine(
        DATABASE_URL,
        poolclass=NullPool,
        echo=False,
    )
    factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    return engine, factory


# ═══════════════════════════════════════════════════════════════════════════════
# Async tarama + DB yazım zinciri (asyncio.run() ile çağrılır)
# ═══════════════════════════════════════════════════════════════════════════════

async def _run_scan_chain(target_id: str, domain: str) -> dict:
    """
    Tüm OSINT tarama zincirini yürütür ve sonuçları veritabanına yazar.

    Strateji:
      A) Önce TÜM dış API çağrılarını paralel çalıştır (I/O-bound).
      B) Sonra TEK session açıp SIRAYLA yaz ve tek commit'le bitir.

    Bu yaklaşım:
      - Session'ı async gather ile paylaşmaz → transaction çakışması yok.
      - Tek commit → yarım yazım riski yok.
    """
    target_uuid = uuid_lib.UUID(target_id)
    summary = {"ips": 0, "subdomains": 0, "locations": 0, "errors": []}

    # ── A. Veri toplama aşaması (DB'ye dokunmadan) ────────────────────────────

    # A1: DNS — sync fonksiyon, executor'da çalıştır
    loop = asyncio.get_running_loop()
    ips: list[str] = await loop.run_in_executor(None, resolve_domain_to_ips, domain)
    logger.info(f"[Task] {domain} → IP'ler: {ips}")

    # A2: Subdomain + IP konumları paralel al (her ikisi de pure-async)
    subdomain_result, *location_results = await asyncio.gather(
        find_subdomains(domain),
        *[get_ip_location(ip) for ip in ips],
        return_exceptions=True,   # Birinin patlaması diğerini durdurmaz
    )

    subdomains: list[str] = (
        subdomain_result if isinstance(subdomain_result, list) else []
    )
    if isinstance(subdomain_result, Exception):
        logger.warning(f"[Task] Subdomain hatası: {subdomain_result}")
        summary["errors"].append(str(subdomain_result))

    # ip → location eşlemesi (None veya Exception olabilir)
    ip_locations: dict[str, str | None] = {}
    for ip, loc in zip(ips, location_results):
        if isinstance(loc, Exception):
            logger.warning(f"[Task] GeoIP hatası ({ip}): {loc}")
            summary["errors"].append(str(loc))
            ip_locations[ip] = None
        else:
            ip_locations[ip] = loc   # str veya None

    logger.info(f"[Task] Subdomain'ler: {subdomains}")
    logger.info(f"[Task] Konumlar: {ip_locations}")

    # ── B. DB yazım aşaması (TEK session, SIRAYLA, TEK commit) ───────────────
    engine, SessionFactory = _make_session_factory()

    try:
        async with SessionFactory() as session:
            async with session.begin():   # ← begin() → hata olursa otomatik rollback
                ip_entity_ids: dict[str, str] = {}

                # B1: IP entity'leri
                for ip in ips:
                    try:
                        entity = Entity(
                            target_id=target_uuid,
                            entity_type=EntityType.IP,
                            raw_value=ip,
                            source_url="dns_resolver",
                            confidence=1.0,
                            is_ignored=False,
                        )
                        session.add(entity)
                        await session.flush()          # ID üret, commit etme
                        ip_entity_ids[ip] = str(entity.id)
                        summary["ips"] += 1
                        logger.info(f"[Task] IP flush: {ip} → {entity.id}")
                    except Exception as e:
                        logger.error(f"[Task] IP flush hatası ({ip}): {e}")
                        summary["errors"].append(f"ip:{ip}:{e}")

                # B2: Subdomain entity'leri
                for sub in subdomains:
                    try:
                        entity = Entity(
                            target_id=target_uuid,
                            entity_type=EntityType.SUBDOMAIN,
                            raw_value=sub,
                            source_url="crt_sh",
                            confidence=0.9,
                            is_ignored=False,
                        )
                        session.add(entity)
                        await session.flush()
                        summary["subdomains"] += 1
                        logger.info(f"[Task] Subdomain flush: {sub}")
                    except Exception as e:
                        logger.error(f"[Task] Subdomain flush hatası ({sub}): {e}")
                        summary["errors"].append(f"sub:{sub}:{e}")

                # B3: Location entity'leri (parent IP entity ID'sine bağlı)
                for ip, location in ip_locations.items():
                    if not location:
                        continue
                    ip_entity_id = ip_entity_ids.get(ip)
                    if not ip_entity_id:
                        continue
                    try:
                        entity = Entity(
                            target_id=target_uuid,
                            entity_type=EntityType.LOCATION,
                            raw_value=location,
                            source_url=f"ip_geolocation:{ip_entity_id}",
                            confidence=1.0,
                            is_ignored=False,
                        )
                        session.add(entity)
                        await session.flush()
                        summary["locations"] += 1
                        logger.info(f"[Task] Location flush: {ip} → {location}")
                    except Exception as e:
                        logger.error(f"[Task] Location flush hatası ({ip}): {e}")
                        summary["errors"].append(f"loc:{ip}:{e}")

                # ← session.begin() context'i burada tek commit + kapanış yapar
    finally:
        await engine.dispose()   # Her task sonunda engine'i temizle

    logger.info(f"[Task] ✅ Tamamlandı: {domain} → {summary}")
    return summary


# ═══════════════════════════════════════════════════════════════════════════════
# Ana Celery Task
# ═══════════════════════════════════════════════════════════════════════════════

@celery_app.task(
    bind=True,
    name="workers.tasks_ingestion.run_full_osint_scan",
    max_retries=MAX_RETRIES,
    acks_late=True,             # Task başarısız olursa kuyrukta kalsın
    reject_on_worker_lost=True, # Worker ölürse mesajı kuyruğa iade et
)
def run_full_osint_scan(self, target_id: str, domain: str) -> dict:
    """
    Celery worker tarafından çalıştırılan ana OSINT tarama görevi.

    Args:
        target_id : Target.id UUID string (örn: "5dd3f200-107c-...")
        domain    : Taranacak domain (örn: "tesla.com")

    Returns:
        {"ips": N, "subdomains": N, "locations": N, "errors": [...]}

    Retry politikası (exponential backoff):
        Deneme 1 → hata → 60s bekle
        Deneme 2 → hata → 120s bekle
        Deneme 3 → hata → 240s bekle
        Deneme 4 → kalıcı başarısız
    """
    logger.info(
        f"[Task] ▶ Başlatıldı: {domain} | target={target_id} "
        f"| Deneme {self.request.retries + 1}/{MAX_RETRIES + 1}"
    )

    try:
        result = asyncio.run(
            _run_scan_chain(target_id=target_id, domain=domain)
        )
        logger.info(f"[Task] ✅ Başarılı: {domain} → {result}")
        return result

    except httpx.TimeoutException as exc:
        countdown = BASE_COUNTDOWN * (2 ** self.request.retries)
        logger.warning(
            f"[Task] ⏱ Timeout ({domain}) → {countdown}s sonra retry "
            f"[{self.request.retries + 1}/{MAX_RETRIES}]"
        )
        raise self.retry(exc=exc, countdown=countdown)

    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code in (429, 503):
            countdown = BASE_COUNTDOWN * (2 ** self.request.retries)
            logger.warning(f"[Task] ⚠ HTTP {code} ({domain}) → {countdown}s retry")
            raise self.retry(exc=exc, countdown=countdown)
        logger.error(f"[Task] ✗ HTTP {code} ({domain}) — retry yok")
        raise

    except Exception as exc:
        logger.exception(f"[Task] ✗ Beklenmedik hata ({domain}): {exc}")
        raise
