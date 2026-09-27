# PT Ekran — Claude Code proje talimatı

Bu repo, Raspberry Pi 5 üzerinde çalışan, antrenman sırasında nabız, zone, süre ve ortam
sıcaklığı/nemini gösteren dokunmatik bir cihazın yazılımıdır. Tasarım claude.ai'de yapıldı;
bu repodaki `docs/` ve `design/` klasörleri tek doğru kaynaktır.

Önce şunları oku: `docs/spec.md` (ne yapılacak), `docs/design-tokens.md` (nasıl görünecek),
`docs/hardware.md` (donanım gerçekleri), `docs/plan.md` (hangi sırayla).

## Kullanıcı ve çalışma şekli
- Kullanıcı: İzzet. Arayüz metinleri Türkçe; kod, değişken ve commit mesajları İngilizce.
- Geliştirme makinesi: M1 MacBook. Hedef: Raspberry Pi 5 (4GB), SSH ile erişilir.
- Her kilometre taşından (`docs/plan.md`) sonra dur, ne yaptığını ve nasıl test edileceğini özetle,
  onay bekle. Donanımla ilgili bir varsayımı doğrulamadan (ör. I2C adresi, fan yönü) koda gömme.

## Mimari (karar verildi, değiştirmeden önce sor)
- **Backend:** Python 3, FastAPI + uvicorn, tek süreç, systemd servisi olarak çalışır.
  - BLE nabız: `bleak` (standart Heart Rate Service 0x180D, ölçüm karakteristiği 0x2A37, notify).
  - Ortam sensörü: Sense HAT (B) üzerindeki SHTC3, I2C (`smbus2`). Yazılımda kalibrasyon ofseti.
  - Depolama: SQLite (`data/pt.db`), fotoğraflar `data/photos/<profile_id>.jpg`.
  - Garmin zone'ları: `garminconnect` kütüphanesi (`get_heart_rate_zones()`), gayriresmi; hata
    olursa sessizce son kayıtlı değerlerle devam et.
  - Canlı veri: WebSocket (`/ws/live`), 1 Hz.
- **Frontend:** Tek sayfa web uygulaması, derleme adımı yok (vanilla JS + ES modülleri, CSS).
  Chromium kiosk modunda, DSI ekranda 800×480 tam ekran açılır.
- **Telefon sayfaları** (fotoğraf yükleme) aynı sunucudan, ayrı rotada (`/m/...`) sunulur.
- **Mock modu zorunlu:** `PT_MOCK=1` ile BLE ve sensör sahte veri üretir; tüm arayüz Mac'te
  donanımsız geliştirilebilmeli ve test edilebilmeli.

## Komutlar (oluşturunca güncel tut)
- Geliştirme (Mac): `PT_MOCK=1 uvicorn app.main:app --reload --port 8080` → tarayıcıda `http://localhost:8080/?dev`, 800×480 pencere.
  Sinyal kesintisi denemesi: `curl -X POST localhost:8080/api/mock/lost -H 'Content-Type: application/json' -d '{"lost":true}'`.
- Test: `pytest`
- İlk Pi kurulumu (Pi'de): `./deploy/setup-pi.sh`; donanım doğrulama: `deploy/check-hardware.sh`.
- Deploy: `./deploy/deploy.sh` (ya da `/deploy` komutu). Pi adresi `PT_HOST` ortam değişkeninden.
- Garmin girişi (Pi'de, profil başına bir kez): `.venv/bin/python -m app.garmin --profile <id>`.

## Kesin kurallar
- Şifre, token, Garmin kimlik bilgisi repoya ya da bu dosyaya asla yazılmaz. Garmin token'ları
  Pi'de `~/.config/pt-ekran/` altında, 600 izinle. SSH yalnızca anahtarla.
- Fotoğraf yükleme bağlantısı tek kullanımlık ve 5 dk geçerli; iptal sonrası gelen yükleme reddedilir.
- Sunucu tarafında yüklenen her görsel Pillow ile yeniden kodlanır (512×512 JPEG, meta veri yok, ≤2 MB giriş).
- SD kart güvenliği: kapatma yalnızca uygulama içi "Kapat" akışıyla (`systemctl poweroff`,
  sudoers'ta yalnızca bu komuta izin). Sık yazmaları toplu yap (örnekleri 5 sn'de bir commit et).
- Sinyal kesintisi ve duraklatma süreleri hiçbir zone'a yazılmaz.
- Tasarım tokenlarının (renk, font, ölçü) dışına çıkma; yeni bir bileşen gerekiyorsa önce sor.
