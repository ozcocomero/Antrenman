# Uygulama planı

Her adımın sonunda dur, özet ver, onay bekle.

**M0 · Pi hazırlığı (İzzet + Claude Code birlikte)**
SSH anahtarla giriş, `PT_HOST` ayarı, I2C/ekran/BLE doğrulamaları (`docs/hardware.md`), sonuçları dokümana yaz.
Kabul: Mac'ten `ssh $PT_HOST 'i2cdetect -y 1'` çalışıyor; ekran görüntü veriyor; bant taramada görünüyor.

**M1 · İskelet ve mock**
FastAPI, statik frontend, WebSocket, `PT_MOCK=1` sahte nabız/sensör, SQLite şeması ve migration, pytest.
Kabul: Mac'te 800×480 pencerede S6 sahte veriyle akıyor.

**M2 · Canlı ekran (S6) ve seans mantığı**
Zone hesabı, süre/duraklatma/kesinti kuralları, atan kalp, profil halkası, S7, S8, S9.
Kabul: birim testleri §4–§5 kurallarını kapsıyor; ekran `design/Main.dc.html` ile görsel olarak eşleşiyor.

**M3 · Donanım sürücüleri**
bleak ile HR bağlantısı ve yeniden bağlanma, SHTC3 okuma ve ofset.
Kabul: Pi'de gerçek bantla 10 dk kesintisiz seans; bant çıkarılıp takılınca otomatik dönüş.

**M4 · Profiller ve zone ayarları**
S1, S2, S5, Konuk, profil bazlı zone kaynağı; Garmin eşitleme (token Pi'de, repoda değil).

**M5 · Fotoğraf akışı**
C1–C6, P1–P4, token kuralları, hotspot, USB.

**M6 · Ana ekran, geçmiş, açılış, kapanış**
S0, S3, S10, S11; sudoers kuralı; kiosk otomatik başlatma; ekran kararmasını seans sırasında engelleme.

**M7 · Sağlamlaştırma**
Güç kesintisinde veri kaybı testi, log döndürme, SD yazma yükü, yedekleme (Mac'e `rsync` komutu).

## Durum
- M1, M2, M4, M5, M6 yazılım tarafı yazıldı ve mock modda test edildi (`pytest`, 800×480 tarayıcı gezintisi).
- S3 Ana ekran tasarımda yoktu; tasarım dilinden **taslak** olarak türetildi, onay bekliyor.
- Profil oluştururken rıza, onay kutusu yerine açık onay diyaloğu ("Onaylıyorum") olarak uygulandı (ekrana sığması için).
- M0 ve M3 (gerçek donanım: ekran overlay'i, SHTC3 adresi, bant ile 10 dk seans, fan yönü) Pi'de doğrulanacak.
- M7: SQLite WAL + 5 sn toplu yazma + açılışta yarım kalan seansı "interrupted" olarak kurtarma yapıldı;
  güç kesintisi testi ve ekran kararması (wake lock) Pi'de denenecek.
