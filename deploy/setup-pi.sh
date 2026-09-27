#!/usr/bin/env bash
# One-time Raspberry Pi setup. Run ON THE PI from a clone of this repo:
#   ./deploy/setup-pi.sh
# Installs system packages, copies the app to /opt/pt-ekran, creates the venv, installs the
# systemd service, the sudoers rule (poweroff only), the NetworkManager polkit rule and
# the kiosk autostart. Safe to run again. Hardware settings (config.txt display overlay)
# are NOT changed: verify them first with deploy/check-hardware.sh (docs/hardware.md).
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/pt-ekran
USER_NAME="${SUDO_USER:-$USER}"
[ "$USER_NAME" = root ] && { echo "Run as your normal user (not root); sudo is used where needed."; exit 1; }

echo "→ Packages"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-dev i2c-tools bluez rsync curl >/dev/null
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || sudo apt-get install -y -qq chromium >/dev/null

echo "→ I2C and groups"
sudo raspi-config nonint do_i2c 0 || true
sudo usermod -aG bluetooth,i2c,netdev "$USER_NAME"

echo "→ App to $DEST"
sudo mkdir -p "$DEST"
sudo chown "$USER_NAME": "$DEST"
rsync -a --delete --exclude '.git/' --exclude '.venv/' --exclude '__pycache__/' --exclude 'data/' \
  --exclude 'design/' --exclude '.claude/' "$SRC/" "$DEST/"
cd "$DEST"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt
./deploy/fetch-fonts.sh || echo "fonts not downloaded; system fonts will be used"
mkdir -p "$HOME/.config/pt-ekran" && chmod 700 "$HOME/.config/pt-ekran"

echo "→ Service"
sed "s/REPLACE_USER/$USER_NAME/" deploy/pt-ekran.service | sudo tee /etc/systemd/system/pt-ekran.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable pt-ekran.service >/dev/null

echo "→ sudoers: only 'systemctl poweroff'"
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff" | sudo tee /etc/sudoers.d/pt-ekran >/dev/null
sudo chmod 440 /etc/sudoers.d/pt-ekran
sudo visudo -cf /etc/sudoers.d/pt-ekran >/dev/null

echo "→ polkit: NetworkManager for the hotspot"
sudo tee /etc/polkit-1/rules.d/50-pt-ekran.rules >/dev/null <<RULES
polkit.addRule(function(action, subject) {
  if (action.id.indexOf("org.freedesktop.NetworkManager.") === 0 && subject.user === "$USER_NAME") {
    return polkit.Result.YES;
  }
});
RULES

echo "→ Kiosk autostart"
LINE="$DEST/deploy/kiosk.sh &"
mkdir -p "$HOME/.config/labwc"
touch "$HOME/.config/labwc/autostart"
grep -qF "$DEST/deploy/kiosk.sh" "$HOME/.config/labwc/autostart" || echo "$LINE" >> "$HOME/.config/labwc/autostart"
if [ -f "$HOME/.config/wayfire.ini" ] && ! grep -qF "kiosk.sh" "$HOME/.config/wayfire.ini"; then
  grep -q "^\[autostart\]" "$HOME/.config/wayfire.ini" || printf "\n[autostart]\n" >> "$HOME/.config/wayfire.ini"
  sed -i "/^\[autostart\]/a pt_ekran = $DEST/deploy/kiosk.sh" "$HOME/.config/wayfire.ini"
fi
# log rotation: journald is size-capped so the SD card does not fill up
sudo mkdir -p /etc/systemd/journald.conf.d
printf "[Journal]\nSystemMaxUse=100M\n" | sudo tee /etc/systemd/journald.conf.d/pt-ekran.conf >/dev/null

sudo systemctl restart pt-ekran.service
sleep 3
if systemctl is-active --quiet pt-ekran.service; then
  echo "✓ Service running: http://$(hostname -I | awk '{print $1}'):8080"
else
  journalctl -u pt-ekran -n 40 --no-pager; exit 1
fi
echo "Reboot once so group changes and the kiosk take effect: sudo reboot"
