import os
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession
from api import deps
from models.osint import Entity

router = APIRouter()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY or "dummy",
)

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    target_id: Optional[str] = None
    messages: List[ChatMessage]

class ChatResponse(BaseModel):
    reply: str

@router.post("/", response_model=ChatResponse)
async def chat_with_copilot(request: ChatRequest, db: AsyncSession = Depends(deps.get_db)):
    if not OPENROUTER_API_KEY:
        return {"reply": "AI Asistan şu anda kullanılamıyor: OPENROUTER_API_KEY eksik. Lütfen yapılandırmayı kontrol edin."}

    # Hedef belirtildiyse, bağlam (context) olarak graph verilerini çek
    context_text = ""
    if request.target_id:
        try:
            target_uuid = uuid.UUID(request.target_id)
            from sqlalchemy.future import select
            result = await db.execute(select(Entity).where(Entity.target_id == target_uuid))
            entities = result.scalars().all()
            
            if entities:
                from collections import defaultdict
                grouped = defaultdict(list)
                for e in entities:
                    grouped[e.entity_type.value].append(e)

                summary = []
                # Ensure all offensive / sensitive types are fully injected
                critical_types = ["malicious_record", "threat", "vulnerability", "port", "api_key", "pwd_hash", "email"]
                
                for t_type, items in grouped.items():
                    if t_type.lower() in critical_types:
                        for item in items:
                            summary.append(f"- [{t_type.upper()}] {item.raw_value} (Kaynak: {item.source_url})")
                    else:
                        count = len(items)
                        for item in items[:5]:
                            summary.append(f"- [{t_type}] {item.raw_value} (Güven: {item.confidence})")
                        if count > 5:
                            summary.append(f"- [... ve {count - 5} adet daha {t_type} kaydı bağlam sınırını korumak için gizlendi]")

                context_text = "Şu anda kullanıcının incelediği hedefe ait keşfedilen veriler (OSINT Graph Data):\n" + "\n".join(summary)
            else:
                context_text = "Şu anda incelenen hedef için henüz veri bulunamadı."
        except Exception as e:
            context_text = "Bağlam verisi alınırken bir hata oluştu."

    # System prompt oluştur
    system_prompt = (
        "Sen NexusOSINT platformunun entegre yapay zeka asistanı olan 'SOC Copilot'sun. "
        "Aşağıda verilen bağlamdaki GERÇEK zafiyetleri (MALICIOUS_RECORD/THREAT) dikkatlice incele. "
        "SADECE bu hedefe özgü bulunan spesifik açıkları (Nuclei bulgularını) baz alarak analiz et. Jenerik/Genel tanımlar yapma. "
        "Hangi açıktan nasıl faydalanılabileceğini ve nasıl yamalanacağını adım adım açıkla. "
        "Kısa, net ve eyleme geçirilebilir (actionable) tavsiyeler ver. Cevaplarını okunaklı Markdown formatında yaz."
    )

    if context_text:
        system_prompt += f"\n\n{context_text}"

    # OpenAI formatına dönüştür
    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in request.messages:
        api_messages.append({"role": msg.role, "content": msg.content})

    try:
        response = await client.chat.completions.create(
            model="openai/gpt-4o-mini", # Hızlı ve uygun maliyetli model
            messages=api_messages,
            temperature=0.3,
            max_tokens=1500,
        )
        reply_text = response.choices[0].message.content
        return {"reply": reply_text}
    except Exception as e:
        import logging
        logging.error(f"Chat API Hatası: {e}")
        return {"reply": f"Üzgünüm, API ile iletişim kurarken bir hata oluştu: {str(e)}"}
