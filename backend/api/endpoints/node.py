from fastapi import APIRouter, Depends, HTTPException
import uuid
import os
import logging
from api import deps
from crud import osint as crud_osint
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()
logger = logging.getLogger(__name__)

# LLM İstemcisi
# OPENROUTER_API_KEY .env dosyasından çekilecek
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

async def get_openai_client():
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="OPENROUTER_API_KEY is not configured.")
    return AsyncOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=OPENROUTER_API_KEY,
    )

@router.get("/{node_id}/ai-rationale")
async def get_ai_rationale(
    node_id: str,
    db: AsyncSession = Depends(deps.AsyncSessionLocal),
):
    """
    Kullanıcı arayüzünde bir düğüme (node) tıklandığında, 
    OpenRouter üzerinden on-demand AI analizi döndürür.
    """
    try:
        try:
            parsed_id = uuid.UUID(node_id)
        except ValueError:
            # If the node_id is a group node like 'group_ports' or 'group_threats', or invalid
            return {"rationale": "Bu bir gruplama düğümüdür veya ana hedeftir. Lütfen yapay zeka analizi için somut bir istihbarat bulgusu (IP, Subdomain, Zafiyet vb.) seçin."}

        # Düğümü DB'den çek (Entity id'si graph'daki node id ile aynıdır)
        entity = await crud_osint.get_entity(db, parsed_id)
        if not entity:
            # Maybe it's a Target ID instead of Entity ID?
            return {"rationale": "Bu düğüm bir ana hedef olabilir. Detaylı yapay zeka analizi için lütfen etrafındaki istihbarat bulgularından birine tıklayın."}
            
        if not OPENROUTER_API_KEY:
            # Fallback
            return {"rationale": "AI Analysis unavailable: OPENROUTER_API_KEY is missing."}

        client = await get_openai_client()

        # Prompt hazırlığı
        if entity.entity_type.value in ["MALICIOUS_RECORD", "THREAT", "VULNERABILITY"]:
            prompt = f"""Act as an expert SOC Analyst and Penetration Tester. You are analyzing a critical vulnerability (THREAT).
Vulnerability Details (Name, URL, Payload): {entity.raw_value}
Source: {entity.source_url}

Explain what this specific vulnerability is, how a hacker could exploit it, and how to patch it. 
Keep it concise, under 3 sentences, professional, and entirely in Turkish. Do not use Markdown headings."""
        else:
            prompt = f"""Act as an expert SOC Analyst. Analyze this OSINT data point:
- Node Type: {entity.entity_type.value}
- Data/Label: {entity.raw_value}
- Source: {entity.source_url}

Explain the security context, potential risks, and why it is reliable. 
Keep it concise, under 3 sentences, professional, and entirely in Turkish. Do not use Markdown headings."""

        response = await client.chat.completions.create(
            model="openai/gpt-4o-mini", # Hızlı ve ucuz model
            messages=[
                {"role": "system", "content": "You are a Principal DevSecOps and SOC Analyst."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=150
        )
        
        rationale_text = response.choices[0].message.content.strip()
        
        return {"rationale": rationale_text}

    except Exception as e:
        logger.error(f"❌ [AI_RATIONALE] Error: {e}")
        return {"rationale": f"Yapay zeka analizi sırasında hata oluştu: {str(e)}"}
