from celery import Celery
import os

# İleride Docker Compose'daki Redis servisine bağlanacak, şimdilik varsayılan adresi veriyoruz.
redis_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")

celery_app = Celery(
    "nexus_osint_worker",
    broker=redis_url,
    backend=redis_url,          # <--- BURADAKİ VİRGÜL ÇOK KRİTİK!
    include=["workers.tasks"]
)

# Celery'ye görevleri (tasks) nereden bulacağını söylüyoruz
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Istanbul",
    enable_utc=True,
)