from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.endpoints import target, export

app = FastAPI(title="NexusOSINT API", version="0.1.0")

# Frontend'in API'ye erişebilmesi için CORS ayarları
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Canlıda spesifik bir domaine kısıtlanmalı (örn: localhost:3000)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Yazdığımız Router'ları sisteme dahil ediyoruz
app.include_router(target.router, prefix="/api/targets", tags=["Targets"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])

@app.get("/")
async def root():
    return {"message": "NexusOSINT API is running. Check /docs for documentation."}