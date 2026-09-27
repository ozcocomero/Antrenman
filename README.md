# PT Ekran

Antrenman sırasında nabız, zone, süre ve ortamı gösteren Raspberry Pi 5 cihazı
(5" 800×480 DSI dokunmatik ekran, Waveshare Sense HAT (B), Bluetooth LE nabız bandı/saat).
Şartname: `docs/spec.md` · Tasarım: `design/` ve [canlı kanvas](https://claude.ai/artifact/CCi2oNBtfniyqyGb4KG5rk).

## Pi'ye kurulum (ilk sefer)

Pi'de bir terminalde (VSCode Remote terminali olur):

```bash
git clone -b claude/raspberry-project-implementation-9czg9n https://github.com/ozcocomero/Antrenman.git ~/pt-ekran-src
cd ~/pt-ekran-src
./deploy/setup-pi.sh          # paketler, /opt/pt-ekran, servis, sudoers, kiosk
sudo reboot
```

Açılışta servis (`pt-ekran`) başlar, Chromium ekranda tam ekran açılır.
Güvenlik için cihaz arayüzü ve API yalnızca cihazın kendi ekranına (localhost) açıktır; ağdaki
telefonlar sadece fotoğraf yükleme sayfasına (`/m/...`) ulaşır. Bilgisayardan bakmak için
`/etc/systemd/system/pt-ekran.service` içindeki `PT_REMOTE_UI=1` satırını aç,
`sudo systemctl daemon-reload && sudo systemctl restart pt-ekran`, sonra `http://192.168.1.22:8080/?dev`.

### Donanım doğrulama (M0)

```bash
/opt/pt-ekran/deploy/check-hardware.sh
```

Ekran bağlantısı, I2C (SHTC3 adresi, beklenen 0x70), sensör okuması ve BLE taraması çıktısını
`docs/hardware.md`'ye işle. SHTC3 başka adresteyse `~/.config/pt-ekran/config.toml` içine
`shtc3_address = 0x..` yaz ve `sudo systemctl restart pt-ekran`.

### Güncelleme

Pi'de: `cd ~/pt-ekran-src && git pull && ./deploy/setup-pi.sh`
Mac'ten: `PT_HOST=kullanici@192.168.1.22 ./deploy/deploy.sh` (ya da Claude Code'da `/deploy`).

### Garmin zone'ları (isteğe bağlı)

Profil cihazda oluşturulduktan sonra, profil numarasıyla bir kez:

```bash
cd /opt/pt-ekran && .venv/bin/python -m app.garmin --profile 1
```

Şifre saklanmaz; oturum anahtarları `~/.config/pt-ekran/garmin/` altında (600 izin).
Zone ayarlarında kaynak "Garmin" seçilir; açılışta ve "Eşitle" ile güncellenir.

### Sensör kalibrasyonu

Zone ayarları ekranında başlığa 5 kez dokun → sıcaklık/nem ofseti. Referans termometreyle
15 dk karşılaştır. Değerler `~/.config/pt-ekran/config.toml`'a yazılır.

## Geliştirme (donanımsız)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
./deploy/fetch-fonts.sh
PT_MOCK=1 .venv/bin/uvicorn app.main:app --reload --port 8080   # tarayıcıda 800×480: http://localhost:8080/?dev
.venv/bin/pytest
```

`PT_MOCK=1` sahte bant (sinyal kesintisi: `POST /api/mock/lost {"lost":true}`), sahte sensör
üretir; kapatma/hotspot komutları çalıştırılmaz, yalnızca loglanır.

## Yapı

| Yol | İçerik |
|---|---|
| `app/main.py` | FastAPI: sayfalar, REST API, `/ws/live` (1 Hz) |
| `app/hr.py` | BLE Heart Rate Service (bleak), RR, pil, üstel yeniden bağlanma |
| `app/env.py` | SHTC3 (I2C, smbus2) + ofset |
| `app/zones.py`, `app/session.py` | Zone hesabı (§4), seans kuralları (§5) |
| `app/db.py` | SQLite + migration; 1 Hz örnekler 5 sn'de bir toplu yazılır |
| `app/photos.py` | Tek kullanımlık yükleme kodu, Pillow ile yeniden kodlama, USB |
| `app/garmin.py` | Garmin Connect zone eşitleme |
| `app/system.py` | Kapatma, hotspot (NetworkManager) |
| `web/device/` | Cihaz arayüzü (800×480, vanilla JS modülleri) |
| `web/phone/` | Telefon yükleme sayfası (`/m/<kod>`) |
| `deploy/` | Pi kurulumu, deploy, kiosk, donanım kontrolü |

## Yedekleme

Mac'ten: `rsync -az $PT_HOST:/opt/pt-ekran/data/ ./yedek/pt-ekran-data/`
(veritabanı WAL modunda; tutarlı kopya için önce `ssh $PT_HOST sudo systemctl stop pt-ekran`).
