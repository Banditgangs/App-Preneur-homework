import os
import logging
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

# .env dosyasından anahtarı okuruz ve yanlışlıkla konulmuş tırnak işaretlerini (.strip) temizleriz.
raw_key = os.getenv("ENCRYPTION_KEY", "").strip("\"'")

# Sabit yedek (fallback) anahtar. (Docker gibi multi-container ortamlarda API ve Worker'ın farklı 
# rastgele anahtar üretip InvalidToken hatası vermesini engellemek için sabittir.)
FALLBACK_KEY = b'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI='

try:
    if not raw_key:
        raise ValueError("ENCRYPTION_KEY is empty.")
    # Okunan anahtarın geçerli, 32-byte url-safe base64 olup olmadığını test ediyoruz.
    cipher_suite = Fernet(raw_key.encode('utf-8'))
except Exception as e:
    logger.warning(
        f"Geçersiz veya eksik ENCRYPTION_KEY algılandı (Hata: {e}). "
        f"API ve Worker'ın senkron çalışabilmesi için geçici deterministik (sabit) yedek anahtar kullanılıyor.\n"
        f"Lütfen üretime (production) geçerken .env dosyanıza geçerli bir anahtar ekleyin."
    )
    cipher_suite = Fernet(FALLBACK_KEY)

def encrypt_data(text: str) -> str:
    if not text:
        return text
    return cipher_suite.encrypt(text.encode()).decode()

def decrypt_data(encrypted_text: str) -> str:
    if not encrypted_text:
        return encrypted_text
    return cipher_suite.decrypt(encrypted_text.encode()).decode()