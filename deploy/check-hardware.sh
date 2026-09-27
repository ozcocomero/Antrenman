#!/usr/bin/env bash
# M0 hardware checks (docs/hardware.md). Run on the Pi; paste the output into docs/hardware.md.
set -uo pipefail
echo "## $(date -Iseconds) · $(tr -d '\0' </proc/device-tree/model)"
echo; echo "### OS"; grep PRETTY_NAME /etc/os-release; uname -r
echo; echo "### Display (config.txt overlays and connected outputs)"
grep -nE '^\s*(dtoverlay|display_auto_detect)' /boot/firmware/config.txt 2>/dev/null
for s in /sys/class/drm/card*-*/status; do echo "$(basename "$(dirname "$s")"): $(cat "$s")"; done
echo; echo "### I2C bus 1 (expected SHTC3 at 0x70)"
if [ -e /dev/i2c-1 ]; then i2cdetect -y 1; else echo "/dev/i2c-1 missing: sudo raspi-config nonint do_i2c 0 && reboot"; fi
echo; echo "### SHTC3 reading"
if [ -x /opt/pt-ekran/.venv/bin/python ]; then
  (cd /opt/pt-ekran && .venv/bin/python -c "
from app import config
from app.env import SHTC3
c = config.load()
t, h = SHTC3(c['i2c_bus'], int(c['shtc3_address'])).read()
print(f'address 0x{int(c[\"shtc3_address\"]):02x}: {t:.2f} °C, {h:.1f} %RH')") || echo "read failed"
else echo "app not installed yet (run deploy/setup-pi.sh)"; fi
echo; echo "### Bluetooth (10 s scan for Heart Rate Service 0x180D)"
bluetoothctl show | grep -E "Powered|Name"
if [ -x /opt/pt-ekran/.venv/bin/python ]; then
  (cd /opt/pt-ekran && .venv/bin/python -c "
import asyncio
from app.hr import HeartRateMonitor
async def main():
    m = HeartRateMonitor(); await m.scan(10)
    for d in m.device_list(): print(f\"{d['name']:30} {d['address']}  RSSI {d['rssi']}  ({d['kind']})\")
    if not m.devices: print('no heart rate devices found: wet and wear the strap / enable HR broadcast')
asyncio.run(main())")
fi
echo; echo "### CPU temperature (fan direction check: compare with SHTC3 over 15 min)"
vcgencmd measure_temp 2>/dev/null
