import csv
import io
import datetime
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from crud.osint import get_target_with_entities
from models.osint import EntityType

# ReportLab imports for PDF Generation
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER

async def generate_csv_report(target_id: uuid.UUID, db: AsyncSession) -> io.StringIO:
    """Hedefe ait tüm istihbarat düğümlerini temiz bir CSV formatına çevirir."""
    target = await get_target_with_entities(db=db, target_id=target_id)
    if not target:
        raise ValueError("Hedef bulunamadı.")

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header
    writer.writerow(["Root Domain", "Entity Type", "Raw Value", "Source / TTP", "Confidence", "Discovered At"])
    
    # Rows
    for entity in target.entities:
        if not entity.is_ignored:
            writer.writerow([
                target.target_value,
                entity.entity_type.value,
                entity.raw_value,
                entity.source_url,
                f"{entity.confidence * 100:.0f}%",
                entity.created_at.isoformat() if entity.created_at else ""
            ])
            
    output.seek(0)
    return output


async def generate_pdf_report(target_id: uuid.UUID, db: AsyncSession) -> io.BytesIO:
    """Hedefe ait tüm OSINT verilerini kapsayan Kurumsal Siber İstihbarat PDF'i oluşturur."""
    target = await get_target_with_entities(db=db, target_id=target_id)
    if not target:
        raise ValueError("Hedef bulunamadı.")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=18)
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        name='TitleStyle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=24,
        textColor=colors.HexColor("#0f172a"), # Dark Slate
        alignment=TA_CENTER,
        spaceAfter=20
    )
    
    subtitle_style = ParagraphStyle(
        name='Subtitle',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.gray,
        alignment=TA_CENTER,
        spaceAfter=30
    )
    
    elements = []
    
    # --- 1. COVER PAGE (Kapak) ---
    elements.append(Spacer(1, 150))
    elements.append(Paragraph("NEXUS OSINT", title_style))
    elements.append(Paragraph("SİBER İSTİHBARAT VE TEHDİT ANALİZ RAPORU", title_style))
    
    elements.append(Spacer(1, 50))
    elements.append(Paragraph(f"Hedef Sistem: <b>{target.target_value}</b>", subtitle_style))
    elements.append(Paragraph(f"Rapor Tarihi: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", subtitle_style))
    
    elements.append(PageBreak())
    
    # --- 2. DATA TABLES (Tablolar) ---
    elements.append(Paragraph("İstihbarat Bulguları", styles['Heading2']))
    elements.append(Spacer(1, 10))
    
    # Table Header
    data = [["Tür", "Bulgu (Değer)", "Kaynak Tespiti", "Keşif Tarihi"]]
    
    threat_rows = [] # Kırmızı işaretlenecek kritik tehdit satırlarının endeksi
    
    for i, entity in enumerate(target.entities):
        if entity.is_ignored:
            continue
            
        row = [
            entity.entity_type.value,
            (entity.raw_value[:45] + '...') if len(entity.raw_value) > 45 else entity.raw_value,
            (entity.source_url[:30] + '...') if len(entity.source_url) > 30 else entity.source_url,
            entity.created_at.strftime("%Y-%m-%d %H:%M") if entity.created_at else ""
        ]
        data.append(row)
        
        # Kritik Tehdit (VirusTotal vb.) ise PDF tablosunda arkaplanı Kan Kırmızısı yap
        if entity.entity_type.value == "MALICIOUS_RECORD":
            threat_rows.append(i + 1)
            
    # Table Styling
    t = Table(data, colWidths=[90, 180, 170, 90])
    
    style_commands = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0f172a")), # Slate 900 (Koyu Siyah/Lacivert)
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#f8fafc")), # Açık gri
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.black),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor("#cbd5e1")), # Slate 300 kenarlıklar
    ]
    
    # Zararlı bağlantılar için kırmızı (Crimson) uyarı satırı
    for row_idx in threat_rows:
        style_commands.append(('BACKGROUND', (0, row_idx), (-1, row_idx), colors.HexColor("#fee2e2"))) # Red 100
        style_commands.append(('TEXTCOLOR', (0, row_idx), (-1, row_idx), colors.HexColor("#991b1b"))) # Red 800
        style_commands.append(('FONTNAME', (0, row_idx), (-1, row_idx), 'Helvetica-Bold'))
        
    t.setStyle(TableStyle(style_commands))
    
    elements.append(t)
    
    # PDF'i derle
    doc.build(elements)
    buffer.seek(0)
    
    return buffer
