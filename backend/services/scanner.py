"""
services/scanner.py — NexusOSINT Çok Modüllü OSINT Tarayıcı

Modüller:
  1. DNS / IP Çözümleyici   — socket (sync, executor'da çalışır)
  2. Subdomain Keşfi        — crt.sh API (async httpx)
  3. IP Geolocation         — ip-api.com (async httpx)
"""
import socket
import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── Sabitler ────────────────────────────────────────────────────────────────
MAX_SUBDOMAINS   = 8      # Grafın patlamasını önlemek için üst sınır
HTTP_TIMEOUT     = 8.0    # Saniye — tüm dış API istekleri için
CRTSH_URL        = "https://crt.sh/"
IPAPI_URL        = "http://ip-api.com/json/{ip}"


# ═══════════════════════════════════════════════════════════════════════════
# 1. DNS / IP Çözümleyici
# ═══════════════════════════════════════════════════════════════════════════

def _clean_domain(domain: str) -> str:
    """http://, https://, path vs. temizler."""
    return (
        domain.strip().lower()
        .removeprefix("https://")
        .removeprefix("http://")
        .split("/")[0]
        .split("?")[0]
    )


def resolve_domain_to_ips(domain: str) -> list[str]:
    """
    DNS A kaydını çözerek IPv4 adreslerini döndürür (sync).
    asyncio.run_in_executor ile async bağlamda çalıştırılmalıdır.
    """
    domain = _clean_domain(domain)
    if not domain:
        return []
    try:
        results = socket.getaddrinfo(domain, None, socket.AF_INET)
        ips = list({r[4][0] for r in results})
        logger.info(f"[DNS] {domain} → {ips}")
        return ips
    except socket.gaierror as e:
        logger.warning(f"[DNS] Çözümleme başarısız ({domain}): {e}")
        return []
    except Exception as e:
        logger.error(f"[DNS] Beklenmeyen hata ({domain}): {e}")
        return []


def resolve_domain_to_ip(domain: str) -> Optional[str]:
    """İlk bulunan IPv4'ü döndürür; yoksa None."""
    ips = resolve_domain_to_ips(domain)
    return ips[0] if ips else None


# ═══════════════════════════════════════════════════════════════════════════
# 2. Subdomain Keşfi — crt.sh
# ═══════════════════════════════════════════════════════════════════════════

async def find_subdomains(domain: str) -> list[str]:
    """
    crt.sh Certificate Transparency log API'sini kullanarak
    verilen domain'e ait alt alan adlarını (subdomain) bulur.

    - Wildcard (*.) girdileri temizlenir.
    - Kök domain ile aynı olanlar hariç tutulur.
    - Maksimum MAX_SUBDOMAINS kadar benzersiz sonuç döner.

    Args:
        domain: Taranacak kök domain (örn: "tesla.com")

    Returns:
        Benzersiz subdomain listesi (örn: ["api.tesla.com", "shop.tesla.com"])
    """
    domain = _clean_domain(domain)
    if not domain:
        return []

    url = f"{CRTSH_URL}?q=%.{domain}&output=json"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        seen: set[str] = set()
        results: list[str] = []

        for entry in data:
            # Her entry'de "name_value" alanı; birden fazla \n ile ayrılmış olabilir
            name_value: str = entry.get("name_value", "")
            for name in name_value.splitlines():
                name = name.strip().lower().lstrip("*.")
                # Kök domain değil, geçerli subdomain, daha önce görülmemiş
                if (
                    name
                    and name != domain
                    and name.endswith(f".{domain}")
                    and name not in seen
                ):
                    seen.add(name)
                    results.append(name)
                    if len(results) >= MAX_SUBDOMAINS:
                        break
            if len(results) >= MAX_SUBDOMAINS:
                break

        logger.info(f"[crt.sh] {domain} → {len(results)} subdomain bulundu: {results}")
        return results

    except httpx.TimeoutException:
        logger.warning(f"[crt.sh] Timeout ({domain})")
        return []
    except httpx.HTTPStatusError as e:
        logger.warning(f"[crt.sh] HTTP hata ({domain}): {e.response.status_code}")
        return []
    except Exception as e:
        logger.error(f"[crt.sh] Beklenmeyen hata ({domain}): {e}")
        return []


# ═══════════════════════════════════════════════════════════════════════════
# 3. IP Geolocation — ip-api.com
# ═══════════════════════════════════════════════════════════════════════════

async def get_ip_location(ip: str) -> Optional[str]:
    """
    ip-api.com kullanarak IP adresinin ülke ve şehir bilgisini döndürür.

    Args:
        ip: IPv4 adresi (örn: "140.82.121.3")

    Returns:
        "🇺🇸 United States, San Francisco" formatında string;
        bilgi alınamazsa None.
    """
    if not ip or ip.startswith(("10.", "192.168.", "172.")):
        # Private IP'ler için geolocation anlamsız
        logger.debug(f"[GeoIP] Private IP atlandı: {ip}")
        return None

    url = IPAPI_URL.format(ip=ip)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()

        if data.get("status") != "success":
            logger.warning(f"[GeoIP] Başarısız yanıt ({ip}): {data.get('message')}")
            return None

        country = data.get("country", "?")
        city    = data.get("city", "?")
        region  = data.get("regionName", "")

        location_str = f"{country}, {city}"
        if region and region != city:
            location_str = f"{country}, {region}, {city}"

        logger.info(f"[GeoIP] {ip} → {location_str}")
        return location_str

    except httpx.TimeoutException:
        logger.warning(f"[GeoIP] Timeout ({ip})")
        return None
    except httpx.HTTPStatusError as e:
        logger.warning(f"[GeoIP] HTTP hata ({ip}): {e.response.status_code}")
        return None
    except Exception as e:
        logger.error(f"[GeoIP] Beklenmeyen hata ({ip}): {e}")
        return None

# ═══════════════════════════════════════════════════════════════════════════
# 4. Port & Servis Taraması — Shodan InternetDB
# ═══════════════════════════════════════════════════════════════════════════

INTERNETDB_URL = "https://internetdb.shodan.io/{ip}"

async def get_open_ports(ip: str) -> list[str]:
    """
    Shodan InternetDB (ücretsiz) API'sini kullanarak IP'nin açık portlarını getirir.
    Sıfır sahte veri kuralı: Rate-Limit veya Timeout olursa boş liste döner.

    Args:
        ip: IPv4 adresi (örn: "140.82.121.3")

    Returns:
        Açık port listesi string formatında (örn: ["80/HTTP", "443/HTTPS"])
    """
    if not ip or ip.startswith(("10.", "192.168.", "172.")):
        return []

    url = INTERNETDB_URL.format(ip=ip)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url)
            # Eğer IP Shodan veritabanında yoksa (404) veya Rate-Limit (429) varsa patlamasın
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            data = resp.json()

        ports = data.get("ports", [])
        
        # Kapsamlı Port İmzası Sözlüğü (CDN, Web Hosting, DB vs.)
        COMMON_PORTS = {
            # Temel Servisler
            20: "FTP-DATA", 21: "FTP", 22: "SSH", 23: "TELNET", 25: "SMTP",
            53: "DNS", 80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS",
            # Veritabanları
            3306: "MySQL", 5432: "PostgreSQL", 27017: "MongoDB", 6379: "Redis", 1433: "MSSQL",
            # Cloudflare / CDN ve WAF Portları (Kritik OSINT Verisi)
            2052: "CF-HTTP", 2053: "CF-HTTPS", 2082: "cPanel-HTTP", 2083: "cPanel-HTTPS",
            2086: "WHM-HTTP", 2087: "WHM-HTTPS", 2095: "Webmail-HTTP", 2096: "Webmail-HTTPS",
            8080: "HTTP-Proxy", 8443: "HTTPS-Alt", 8880: "cPanel-SOAP"
        }
        
        results = []
        for port in ports:
            service = COMMON_PORTS.get(port, "UNKNOWN")
            results.append(f"{port}/{service}")

        if results:
            logger.info(f"[PORT] {ip} → {len(results)} port bulundu: {results}")
        return results

    except httpx.TimeoutException:
        logger.warning(f"[PORT] Timeout ({ip}) - Port taraması atlandı.")
        return []
    except httpx.HTTPStatusError as e:
        logger.warning(f"[PORT] HTTP hata ({ip}): {e.response.status_code} - Port taraması atlandı.")
        return []
    except Exception as e:
        logger.warning(f"[PORT] Beklenmeyen hata ({ip}): {e} - Port taraması atlandı.")
        return []

# ═══════════════════════════════════════════════════════════════════════════
# 5. Tehdit İstihbaratı — VirusTotal API
# ═══════════════════════════════════════════════════════════════════════════

import os

VIRUSTOTAL_URL = "https://www.virustotal.com/api/v3"

async def check_virustotal(entity_value: str, entity_type: str) -> Optional[str]:
    """
    VirusTotal API'sini kullanarak Domain veya IP'nin zararlı olup olmadığını kontrol eder.
    Sıfır Çökme Koruması: API Key yoksa, Rate Limit (429) veya Timeout yenirse sessizce atlar.

    Args:
        entity_value: Domain (örn: "tesla.com") veya IP (örn: "1.1.1.1")
        entity_type: "domain" veya "ip"

    Returns:
        Zararlıysa "Malicious: 5/94" gibi bir string, temizse veya hata varsa None
    """
    api_key = os.getenv("VIRUSTOTAL_API_KEY")
    if not api_key:
        logger.warning(f"[VT] VIRUSTOTAL_API_KEY bulunamadı. Tehdit taraması ({entity_value}) atlandı.")
        return None

    if entity_type == "domain":
        url = f"{VIRUSTOTAL_URL}/domains/{entity_value}"
    elif entity_type == "ip":
        url = f"{VIRUSTOTAL_URL}/ip_addresses/{entity_value}"
    else:
        return None

    headers = {"x-apikey": api_key}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
            
            # Rate limit veya hedef VT'de yoksa çökme (Graceful Degradation)
            if resp.status_code in (404, 429, 401, 403):
                if resp.status_code == 429:
                    logger.warning(f"[VT] Rate Limit aşıldı! ({entity_value}) atlanıyor.")
                return None
                
            resp.raise_for_status()
            data = resp.json()

        stats = data.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
        malicious = stats.get("malicious", 0)
        undetected = stats.get("undetected", 0)
        harmless = stats.get("harmless", 0)
        total_engines = malicious + undetected + harmless

        if malicious > 0:
            result_str = f"Malicious: {malicious}/{total_engines}"
            logger.warning(f"[VT] ☠️ KRİTİK TEHDİT BULUNDU: {entity_value} -> {result_str}")
            return result_str
            
        logger.info(f"[VT] Temiz: {entity_value}")
        return None

    except httpx.TimeoutException:
        logger.warning(f"[VT] Timeout ({entity_value}) - Tehdit taraması atlandı.")
        return None
    except Exception as e:
        logger.warning(f"[VT] Beklenmeyen hata ({entity_value}): {e} - Tehdit taraması atlandı.")
        return None
