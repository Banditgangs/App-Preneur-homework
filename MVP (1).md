NexusOSINT (MVP Sürümü) 
1. Ürün Vizyonu ve Stratejisi 
Problem: Sızma testi uzmanları ve güvenlik araştırmacılarının, hedefin dijital ayak izini 
çıkarırken zamanlarının %70'ini manuel veri toplama ve gürültü (yanlış pozitif) ayıklama 
ile geçirmesi. Çözüm: GitHub, sızıntı veritabanları ve arama motorlarından gelen verileri 
NLP/NER algoritmalarıyla asenkron olarak eşleştiren, sonuçları etkileşimli bir bilgi 
grafiğinde (Knowledge Graph) sunan ve hedefin saldırı yüzeyindeki günlük değişimleri 
takip eden otomatik OSINT platformu. Değer Önerisi (MVP): "Manuel keşif ameleliğini 
bitirin. Hedefinizin saldırı yüzeyini dakikalar içinde görselleştirin ve altyapıdaki günlük 
değişimlerden herkesten önce haberdar olun." 
2. Günlük Kullanım Döngüsü (Daily Habit Loop - Hook 
Model) 
Kullanıcının uygulamaya her gün girmesini sağlayacak ana mekanizma: 
• Tetikleyici (Trigger): Her sabah 08:30'da gelen kısa e-posta: "İzlediğiniz 
'hedef_sirket' profilinde 3 yeni kritik değişiklik tespit edildi (1 Yeni Subdomain, 2 
Yeni GitHub Commit)." 
• Eylem (Action): Kullanıcı e-postadaki linke tıklar ve doğrudan NexusOSINT 
dashboard'una düşer. 
• Ödül (Reward): D3.js grafiğinde dünkü taramadan farklı olarak sadece yeni 
eklenen düğümlerin (nodes) kırmızı renkte/parlayarak gösterilmesi. Kullanıcı 
zafiyet potansiyelini anında görür. 
• Yatırım (Investment): Kullanıcı yeni veriyi inceler, rapora ekler veya gereksizse 
"Yoksay" (Ignore) diyerek yapay zeka modelini kendi tercihine göre eğitir. Sistemi 
ne kadar kullanırsa, algoritma o kadar "Can'ın zihni" gibi çalışmaya başlar. 
3. Kapsam İçindeki Özellikler (In-Scope - MVP) 
A. Veri Toplama & Entegrasyon 
1. GitHub Hedefli Tarama: Hedef domain veya e-posta ile ilişkili commit, repo ve 
gist'lerin REST API ile toplanması. 
2. Dorking Otomasyonu: SerpApi üzerinden genel web ve Pastebin türevi açık 
metin sitelerinde hedefin taranması. 
3. Hafif Sürekli İzleme (Daily Delta Check): Kullanıcının "İzlemeye Al" dediği 1 
hedef için her 24 saatte bir arka planda hafif tarama yapıp, yeni keşifleri 
veritabanına kaydetmesi. 
B. NLP & Analiz Motoru 
4. Varlık Ayrıştırma (Entity Resolution): Ham veriden e-posta, şifre hash'i, API 
anahtarı formatlarının ayrıştırılması ve hedef ile ilişkilendirilip "Güven Skoru" 
hesaplanması. 
5. Otomatik Maskeleme: Bulunan hassas verilerin/şifrelerin arayüzde ve raporda 
maskelenmesi (Örn: 1A******). 
C. Arayüz & Görselleştirme (Next.js Dashboard) 
6. İnteraktif Bilgi Grafiği: Varlıkların (Düğüm) ve aralarındaki bağlantıların (İlişki) 
D3.js ile etkileşimli olarak ekranda haritalandırılması. 
7. Değişim Vurgusu (Delta View): Grafikte son 24 saatte eklenen yeni verilerin 
görsel olarak (renk/animasyon ile) ayrıştırılması. 
8. Kaynak Doğrulama Paneli: Herhangi bir düğüme tıklandığında, o verinin 
çekildiği orijinal kaynağın (URL) ve meta verinin yan panelde gösterilmesi. 
D. Raporlama & Gelir Modeli 
9. Kredi Bazlı Cüzdan Sistemi: Kullanıcının hesap açtığında 10 kredi hediye 
alması; her "Yeni Tarama" (1 kredi) ve "İzlemeye Alma" (Günde 0.5 kredi) 
işlemlerinde bakiyenin düşmesi (Stripe entegrasyonu). 
10. Tek Tıkla MD/PDF Çıktı: Oluşan haritanın ve zafiyet kaynaklarının anında 
Markdown veya PDF olarak dışa aktarılması. 
4. Teknik Mimari (MVP) 
• Frontend: Next.js (Tailwind CSS, Zustand for State Management, D3.js for 
Graph). 
• Backend / API: FastAPI (Asenkron veri işleme, NLP model sunumu). 
• Veritabanı: PostgreSQL (JSONB desteği ile esnek şema, Varlık-İlişki tabloları). 
• Görev Kuyruğu (Task Queue): Celery + Redis (Uzun süren OSINT taramalarını ve 
günlük cron job'ları yönetmek için). 
• Auth & Ödeme: Supabase veya NextAuth, Stripe. 
5. Kapsam Dışı (Out-of-Scope - MVP Sonrasına 
Ertelenenler) 
• Dark Web ve Tor ağı taramaları. 
• Görüntü (OCR) veya dosya (APK/PDF) analizi. 
• Neo4j gibi native Graf Veritabanı entegrasyonu (PostgreSQL ilk aşamada 
kullanılacak). 
• Takım (Team/Collaboration) özellikleri. 
6. Başarı Metrikleri (MVP KPIs) 
1. Günlük Aktif Kullanıcı Oranı (DAU/MAU): "Sürekli İzleme" uyarıları sayesinde 
kullanıcıların haftada en az 4 gün uygulamaya giriş yapması. 
2. Time-to-Value (TTV): Yeni üye olan bir kullanıcının ilk bilgi grafiğini görme 
süresinin 3 dakikanın altında olması. 
3. Kredi Tüketim Hızı: Kullanıcıların ücretsiz kredilerini bitirip ilk cüzdan 
yüklemesini (Top-up) yapma oranı.