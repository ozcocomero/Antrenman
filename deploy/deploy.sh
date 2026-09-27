#!/usr/bin/env bash
# Mac'ten Pi'ye kodu gönderir ve servisi yeniden başlatır.
# Kullanım: PT_HOST=kullanici@pi-adresi ./deploy/deploy.sh
# İlk kurulum (paketler, sudoers, kiosk) için Pi'de bir kez deploy/setup-pi.sh çalıştırılmalı.
set -euo pipefail

: "${PT_HOST:?PT_HOST tanımlı değil (ör. export PT_HOST=izzet@pt-ekran.local)}"
REMOTE_DIR="${PT_REMOTE_DIR:-/opt/pt-ekran}"

echo "→ Bağlantı kontrolü: $PT_HOST"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$PT_HOST" true

echo "→ Dosyalar gönderiliyor"
rsync -az --delete \
  --exclude '.git/' --exclude '.venv/' --exclude '__pycache__/' \
  --exclude 'data/' --exclude 'design/' --exclude '.claude/' \
  ./ "$PT_HOST:$REMOTE_DIR/"

echo "→ Bağımlılıklar ve servis"
ssh "$PT_HOST" bash -s <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
[ -d .venv ] || python3 -m venv .venv
if [ -f requirements.txt ]; then
  .venv/bin/pip install -q -r requirements.txt
fi
./deploy/fetch-fonts.sh >/dev/null || true
if [ -f deploy/pt-ekran.service ]; then
  sed "s/REPLACE_USER/\$(id -un)/" deploy/pt-ekran.service | sudo tee /etc/systemd/system/pt-ekran.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable pt-ekran.service >/dev/null
  sudo systemctl restart pt-ekran.service
  sleep 2
  systemctl is-active --quiet pt-ekran.service && echo "servis çalışıyor" || { journalctl -u pt-ekran -n 40 --no-pager; exit 1; }
fi
REMOTE
echo "✓ Deploy tamam"
