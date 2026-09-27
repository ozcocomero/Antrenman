# Donanım

| Parça | Not |
|---|---|
| Raspberry Pi 5, 4GB | Dahili Bluetooth LE kullanılır (ANT+ yok) |
| SanDisk Ultra 64GB microSD | |
| Fanlı alüminyum kasa (H) | Sense HAT kasanın üstüne takılı |
| Raspberry Pi 27W USB-C adaptör | |
| Waveshare 5" DSI kapasitif dokunmatik, 800×480 (Rev2.2) | Pi 5 uyumlu DSI kablosu ile bağlı |
| Waveshare Sense HAT (B) | SHTC3 sıcaklık/nem, LPS22HB basınç, ICM20948 IMU, TCS34725 renk, ADS1015 ADC |

## Kurulum doğrulamaları (koda gömmeden önce Pi'de çalıştır)
`deploy/check-hardware.sh` hepsini tek seferde çalıştırır; çıktıyı aşağıdaki "Sonuçlar" bölümüne ekle.
Kodda doğrulanmamış varsayım olarak yalnızca SHTC3 adresi var (varsayılan 0x70, `config.toml` ile değişir).

- **Ekran:** Waveshare wiki'ye göre 800×480 DSI ekran için `config.txt`'de
  `dtoverlay=vc4-kms-dsi-7inch` (DSI1 önerilen). Kullanılan porta göre wiki'den doğrula.
- **I2C:** `raspi-config` ile aç, `i2cdetect -y 1` çıktısını kaydet; SHTC3 adresini buradan al
  (beklenen 0x70, doğrula).
- **BLE:** `bluetoothctl scan on` ile bandın göründüğünü doğrula.
- **Fan yönü:** Fan havayı HAT tarafından emiyorsa sensör ortam havasını ölçer; tersiyse ölçüm ısınır.
  Kontrol edip sonucu buraya yaz.

## Sıcaklık kalibrasyonu
HAT, Pi ve ekran ısısından etkilenir. Referans termometreyle 15 dk karşılaştırıp ofseti
`~/.config/pt-ekran/config.toml` içine yaz (`temp_offset_c`, `humidity_offset_pct`). Ayarlar ekranına
gizli bir kalibrasyon girişi ekle (ör. başlığa 5 kez dokun).

## Kutu (3D baskı) — bu repoda kapsam dışı, referans
Eğik masaüstü konsol, ≈20°, üç parça (ön çerçeve, arka gövde, taban kaması), PETG.
Pi ekrana paralel, HAT arka ızgaraya bakar, üst yarıklardan sıcak hava çıkar.
Kaba ölçü ≈13 × 10 × 12 cm. Baskı dosyası üretmeden önce kumpasla ölçülecekler: ekran dış ölçüsü
ve ayak delikleri, kasa boyutu, HAT dahil toplam yükseklik, port konumları, yazıcı tabla boyutu.
Görseller: `design/Box.dc.html`, `design/Final.dc.html`.

## Sonuçlar
_Henüz doğrulanmadı. `deploy/check-hardware.sh` çıktısı buraya._
