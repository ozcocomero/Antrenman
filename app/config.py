"""Paths, environment flags and the per-device config file (~/.config/pt-ekran/config.toml)."""
import os
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DATA_DIR = Path(os.environ.get("PT_DATA_DIR", ROOT / "data"))
PHOTO_DIR = DATA_DIR / "photos"
DB_PATH = DATA_DIR / "pt.db"
CONFIG_DIR = Path(os.environ.get("PT_CONFIG_DIR", Path.home() / ".config" / "pt-ekran"))
CONFIG_FILE = CONFIG_DIR / "config.toml"
GARMIN_DIR = CONFIG_DIR / "garmin"

PORT = int(os.environ.get("PT_PORT", "8080"))
# PT_MOCK=1: fake BLE heart rate + fake sensor, no system commands (Mac development, tests).
MOCK = os.environ.get("PT_MOCK", "0") == "1"
# The device UI and its API answer only the kiosk (localhost); phones reach just /m/ and /static/.
# PT_REMOTE_UI=1 opens the whole UI to the LAN (debugging from a laptop).
REMOTE_UI = MOCK or os.environ.get("PT_REMOTE_UI", "0") == "1"
DRY_RUN = MOCK or os.environ.get("PT_DRY_RUN", "0") == "1"
USB_ROOT = Path(os.environ.get("PT_USB_ROOT", "/media"))
WIFI_IFACE = os.environ.get("PT_WIFI_IFACE", "wlan0")
HOTSPOT_SSID = "PT-Ekran"

HR_LOSS_GRACE_S = 3          # spec §5: gaps longer than this are excluded from time and zones
LAST_DEVICE_TIMEOUT_S = 15   # spec §3: search for the profile's last device on start
RECONNECT_MAX_S = 5          # spec §3: exponential backoff, capped
SAMPLE_FLUSH_S = 5           # CLAUDE.md: batch SD writes
UPLOAD_TOKEN_TTL_S = 300     # CLAUDE.md: single use, 5 minutes
MAX_UPLOAD_BYTES = 2 * 1024 * 1024  # CLAUDE.md: <= 2 MB input

DEFAULTS = {
    "temp_offset_c": 0.0,
    "humidity_offset_pct": 0.0,
    # SHTC3 on the Waveshare Sense HAT (B). Expected 0x70: verify with `i2cdetect -y 1` (docs/hardware.md).
    "i2c_bus": 1,
    "shtc3_address": 0x70,
}


def ensure_dirs():
    for d in (DATA_DIR, PHOTO_DIR, PHOTO_DIR / "tmp"):
        d.mkdir(parents=True, exist_ok=True)
    CONFIG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)


def load() -> dict:
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, "rb") as f:
            cfg.update(tomllib.load(f))
    except FileNotFoundError:
        pass
    return cfg


def save(updates: dict) -> dict:
    """Write known keys back to config.toml (flat key = value file)."""
    cfg = load()
    cfg.update({k: v for k, v in updates.items() if k in DEFAULTS})
    CONFIG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    lines = []
    for k in DEFAULTS:
        v = cfg[k]
        if k == "shtc3_address":
            lines.append(f"{k} = 0x{int(v):02x}")
        else:
            lines.append(f"{k} = {v!r}")
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(lines) + "\n")
    tmp.replace(CONFIG_FILE)
    return cfg
