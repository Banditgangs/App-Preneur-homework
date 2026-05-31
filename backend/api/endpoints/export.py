import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from api import deps
from services.export import generate_csv_report, generate_pdf_report

router = APIRouter()

@router.get("/{target_id}/csv")
async def export_target_csv(
    target_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
):
    """Hedefin tüm OSINT verilerini CSV olarak indirir."""
    try:
        csv_buffer = await generate_csv_report(target_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
        
    return StreamingResponse(
        iter([csv_buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=nexusosint_report_{target_id}.csv"}
    )


@router.get("/{target_id}/pdf")
async def export_target_pdf(
    target_id: uuid.UUID,
    db: AsyncSession = Depends(deps.get_db),
):
    """Hedefin tüm OSINT verilerini Kurumsal PDF Raporu olarak indirir."""
    try:
        pdf_buffer = await generate_pdf_report(target_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
        
    return StreamingResponse(
        iter([pdf_buffer.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=nexusosint_report_{target_id}.pdf"}
    )
