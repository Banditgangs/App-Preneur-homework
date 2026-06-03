"""
api/endpoints/target.py — NexusOSINT Hedef & Graf API

Tarama zinciri (POST /):
  Domain kaydı -> Celery Worker'a Gönderim (Arka Plan)
"""
import asyncio
import logging
import os
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from api import deps
from workers.tasks import run_full_osint_scan
from schemas import osint as schemas
from crud import osint as crud
from models.osint import EntityType
from services.scanner import (
    resolve_domain_to_ips,
    find_subdomains,
    get_ip_location,
)
from pydantic import BaseModel
import uuid

logger = logging.getLogger(__name__)
router = APIRouter()


# ── POST /api/targets/ ────────────────────────────────────────────────────────
@router.post("/", response_model=schemas.TargetResponse, status_code=status.HTTP_201_CREATED)
async def create_target_endpoint(
    target_in: schemas.TargetCreate,
    db: AsyncSession = Depends(deps.get_db),
):
    """
    Yeni hedef ekler ve zincir OSINT taramasını Celery kuyruğuna (arka plana) gönderir.
    Kullanıcı arayüzü asla beklemez (Timeout yemez), anında yanıt alır.
    """
    domain = target_in.target_value

    from sqlalchemy.future import select
    from models.osint import Target
    
    # Hedef zaten var mı kontrol et (Duplicate/Race Condition Önlemi)
    result = await db.execute(select(Target).where(Target.target_value == domain))
    existing_target = result.scalars().first()
    
    if existing_target:
        logger.info(f"[API] Hedef zaten sistemde mevcut. Çift tarama başlatılmıyor: {domain} ({existing_target.id})")
        return existing_target

    # ── 1. Domain kaydet ─────────────────────────────────────────────────────
    target = await crud.create_target(db=db, target_in=target_in)
    logger.info(f"[API] Hedef veritabanına kaydedildi: {target.target_value} ({target.id})")

    # ── 2. AĞIR İŞİ ARKA PLANA (CELERY'E) GÖNDER! ────────────────────────────
    # .delay() komutu bu görevi anında Redis kuyruğuna atar ve API'yi serbest bırakır.
    run_full_osint_scan.delay(str(target.id), domain)
    logger.info(f"[API] OSINT Taraması Celery kuyruğuna iletildi: {domain}")

    # NOT: Aşağıdaki senkron tarama kodları Celery Worker'ın (tasks.py) içine taşınacak 
    # olduğu için API'yi kilitlememesi adına geçici olarak yorum satırına alınmıştır.
    
    """
    # ── Eski DNS / IP çözümleme (blocking) ──
    loop = asyncio.get_event_loop()
    ips: list[str] = await loop.run_in_executor(None, resolve_domain_to_ips, domain)
    
    ip_entity_ids: dict[str, str] = {}
    for ip in ips:
        entity = await crud.create_entity(db=db, target_id=target.id, entity_type=EntityType.IP, raw_value=ip, source_url="dns_resolver", confidence=1.0)
        ip_entity_ids[ip] = str(entity.id)

    # ── Eski Subdomain keşfi (crt.sh) ──
    subdomains: list[str] = await find_subdomains(domain)
    for sub in subdomains:
        await crud.create_entity(db=db, target_id=target.id, entity_type=EntityType.SUBDOMAIN, raw_value=sub, source_url="crt_sh", confidence=0.9)

    # ── Eski Geolocation ──
    async def _save_location(ip: str, ip_entity_id: str) -> None:
        location = await get_ip_location(ip)
        if location:
            await crud.create_entity(db=db, target_id=target.id, entity_type=EntityType.LOCATION, raw_value=location, source_url=f"ip_geolocation:{ip_entity_id}", confidence=1.0)

    await asyncio.gather(*[_save_location(ip, eid) for ip, eid in ip_entity_ids.items()])
    """

    # ── 3. KULLANICIYA ANINDA CEVAP DÖN ──────────────────────────────────────
    # Kullanıcı hedefini kaydettiğimiz an hızlıca geri dönüyoruz ki frontend kilitlenmesin.
    return target


# ── GET /api/targets/ ─────────────────────────────────────────────────────────
@router.get("/", response_model=list[schemas.TargetResponse])
async def read_targets_endpoint(db: AsyncSession = Depends(deps.get_db)):
    """Sistemdeki tüm kayıtlı hedefleri getirir."""
    return await crud.get_targets(db=db)


# ── Graph Payload Schemas ─────────────────────────────────────────────────────
class GraphNode(BaseModel):
    id: str
    label: str
    group: str
    parentNode: str | None = None
    discovery_date: str | None = None

class GraphEdge(BaseModel):
    source: str
    target: str
    label: str

class GraphPayloadResponse(BaseModel):
    nodes: list[GraphNode]
    links: list[GraphEdge]

# EntityType.value → frontend graph group
GROUP_MAP = {
    "EMAIL":    "email",
    "SUBDOMAIN":"subdomain",
    "API_KEY":  "api_key",
    "PWD_HASH": "hash",
    "COMMIT":   "commit",
    "IP":       "ip",
    "LOCATION": "location",
    "PORT":     "port",
    "MALICIOUS_RECORD": "threat",
}


async def _generate_graph_payload(target_id: uuid.UUID, db: AsyncSession) -> GraphPayloadResponse:
    """Merkezi Graf oluşturma motoru (Hem REST hem WS için)"""
    target = await crud.get_target_with_entities(db=db, target_id=target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Hedef bulunamadı.")

    center_id = str(target.id)
    root_date = target.created_at.isoformat()
    nodes: list[GraphNode] = [
        GraphNode(id=center_id, label=target.target_value, group="domain", discovery_date=root_date)
    ]
    links: list[GraphEdge] = []
    
    # Kapsayıcı Düğümlerin varlığını tespit et
    has_ports = False
    has_infra = False
    has_threats = False
    has_locations = False
    
    for entity in target.entities:
        if entity.is_ignored: continue
        if entity.entity_type == EntityType.PORT: has_ports = True
        if entity.entity_type in (EntityType.IP, EntityType.SUBDOMAIN): has_infra = True
        if entity.entity_type == EntityType.MALICIOUS_RECORD: has_threats = True
        if entity.entity_type == EntityType.LOCATION: has_locations = True

    # Kapsayıcı Düğümleri (Parent Nodes) oluştur
    if has_ports:
        nodes.append(GraphNode(id=f"group_ports", label="Açık Servisler", group="parent_node", discovery_date=root_date))
        links.append(GraphEdge(source=center_id, target=f"group_ports", label="HAS_PORTS"))
    if has_infra:
        nodes.append(GraphNode(id=f"group_infra", label="Bulut Altyapısı", group="parent_node", discovery_date=root_date))
        links.append(GraphEdge(source=center_id, target=f"group_infra", label="HAS_INFRA"))
    if has_threats:
        nodes.append(GraphNode(id=f"group_threats", label="Kritik Tehditler", group="parent_node", discovery_date=root_date))
        links.append(GraphEdge(source=center_id, target=f"group_threats", label="HAS_THREATS"))
    if has_locations:
        nodes.append(GraphNode(id=f"group_locations", label="Fiziksel Ayak İzi", group="parent_node", discovery_date=root_date))
        links.append(GraphEdge(source=center_id, target=f"group_locations", label="HAS_LOCATIONS"))

    # Çocuk düğümleri ve bağlantılarını ekle
    for entity in target.entities:
        if entity.is_ignored:
            continue

        node_id = str(entity.id)
        group   = GROUP_MAP.get(entity.entity_type.value, "unknown")
        
        parent_node = None
        if entity.entity_type == EntityType.PORT:
            parent_node = "group_ports"
        elif entity.entity_type in (EntityType.IP, EntityType.SUBDOMAIN):
            parent_node = "group_infra"
        elif entity.entity_type == EntityType.MALICIOUS_RECORD:
            parent_node = "group_threats"
        elif entity.entity_type == EntityType.LOCATION:
            parent_node = "group_locations"
            
        nodes.append(GraphNode(
            id=node_id, 
            label=entity.raw_value, 
            group=group, 
            parentNode=parent_node, 
            discovery_date=entity.created_at.isoformat()
        ))

        if entity.entity_type == EntityType.LOCATION and entity.source_url.startswith("ip_geolocation:"):
            ip_entity_id = entity.source_url.split(":", 1)[1]
            links.append(GraphEdge(source=ip_entity_id, target=node_id, label="LOCATION"))
        elif entity.entity_type == EntityType.PORT and entity.source_url.startswith("port_scanner:"):
            ip_entity_id = entity.source_url.split(":", 1)[1]
            links.append(GraphEdge(source=ip_entity_id, target=node_id, label="PORT"))
        elif entity.entity_type == EntityType.MALICIOUS_RECORD and entity.source_url.startswith("vt_scanner:"):
            source_id = entity.source_url.split(":", 1)[1]
            links.append(GraphEdge(source=source_id, target=node_id, label="THREAT"))
        else:
            # Sadece doğrudan kapsayıcısı OLMAYANLARI merkeze bağla
            if not parent_node:
                links.append(GraphEdge(source=center_id, target=node_id, label=entity.entity_type.value))

    return GraphPayloadResponse(nodes=nodes, links=links)


# ── GET /api/targets/{target_id}/graph ───────────────────────────────────────
@router.get("/{target_id}/graph", response_model=GraphPayloadResponse)
async def get_target_graph(
    target_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
):
    """(Eski) REST tabanlı OSINT graf verisi."""
    return await _generate_graph_payload(target_id, db)

# ── GET /api/targets/{target_id}/status ──────────────────────────────────────
@router.get("/{target_id}/status")
async def get_target_status(target_id: uuid.UUID):
    """
    Fallback polling endpoint for frontend.
    Returns 'COMPLETED' if active scans are 0, else 'RUNNING'.
    """
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    redis_client = aioredis.from_url(redis_url)
    try:
        val = await redis_client.get(f"active_scans_{target_id}")
        if val is None or int(val) <= 0:
            return {"status": "COMPLETED"}
        return {"status": "RUNNING"}
    except Exception as e:
        logger.error(f"[API] Fallback status error: {e}")
        return {"status": "COMPLETED"} # fallback
    finally:
        await redis_client.close()


# ── WS /api/targets/ws/{target_id} ───────────────────────────────────────────
@router.websocket("/ws/{target_id}")
async def websocket_target_graph(websocket: WebSocket, target_id: uuid.UUID):
    """
    (YENİ) Real-Time WebSocket Bağlantısı.
    Redis Pub/Sub üzerinden Celery Worker'ı dinler ve anında Frontend'e push yapar.
    """
    await websocket.accept()
    logger.info(f"[WS] İstemci bağlandı: {target_id}")

    # 1. Bağlanılan an mevcut durumu gönder
    async with deps.AsyncSessionLocal() as db:
        try:
            initial_payload = await _generate_graph_payload(target_id, db)
            await websocket.send_json(initial_payload.model_dump())
        except HTTPException:
            await websocket.close(code=1008)
            return

    # 2. Redis Pub/Sub ile Canlı Dinlemeye Başla
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    redis_client = aioredis.from_url(redis_url)
    pubsub = redis_client.pubsub()
    channel = f"graph_updates_{target_id}"
    await pubsub.subscribe(channel)

    try:
        # Worker'dan her 'update', 'SCAN_COMPLETED' veya 'SCAN_FAILED' sinyali geldiğinde taze DB oturumuyla veriyi fırlat
        async for message in pubsub.listen():
            if message["type"] == "message":
                data_str = message["data"].decode("utf-8")
                
                if data_str == "SCAN_COMPLETED":
                    await websocket.send_json({"is_scan_completed": True, "has_error": False})
                    logger.info(f"[WS] Tarama Bitti Sinyali Frontend'e Pushlandı -> {target_id}")
                
                elif data_str == "SCAN_FAILED":
                    # Önce hata düğümünü göndermek için güncel grafiği çekelim
                    async with deps.AsyncSessionLocal() as db:
                        payload = await _generate_graph_payload(target_id, db)
                        await websocket.send_json(payload.model_dump())
                    # Ardından başarısız bittiğini haber verelim
                    await websocket.send_json({"is_scan_completed": True, "has_error": True})
                    logger.info(f"[WS] Tarama Hata Sinyali Frontend'e Pushlandı -> {target_id}")
                    
                else:
                    async with deps.AsyncSessionLocal() as db:
                        payload = await _generate_graph_payload(target_id, db)
                        await websocket.send_json(payload.model_dump())
                        logger.info(f"[WS] Anlık veri Frontend'e Pushlandı -> {target_id}")

    except WebSocketDisconnect:
        logger.info(f"[WS] İstemci bağlantıyı kopardı: {target_id}")
    except Exception as e:
        logger.error(f"[WS] Beklenmeyen Hata: {e}")
    finally:
        await pubsub.unsubscribe(channel)
        await redis_client.close()