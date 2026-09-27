"""OS integration: shutdown, IP / Wi-Fi info, the device's own hotspot (NetworkManager).

Privileges (installed by deploy/setup-pi.sh): sudoers allows only `systemctl poweroff`;
a polkit rule lets the service user drive NetworkManager for the hotspot.
"""
import logging
import secrets
import socket
import subprocess

from . import config

log = logging.getLogger("pt.system")

HOTSPOT_CON = "PT-Ekran"
HOTSPOT_IP = "10.42.0.1"   # NetworkManager "shared" default


def _run(cmd: list[str], sudo=False, timeout=30):
    if sudo:
        cmd = ["sudo", "-n", *cmd]
    if config.DRY_RUN:
        log.info("[dry-run] %s", " ".join(cmd))
        return None
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def shutdown():
    # sudoers allows exactly this command (deploy/setup-pi.sh)
    _run(["/usr/bin/systemctl", "poweroff"], sudo=True)


def lan_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))   # no packet is sent; just picks the outgoing interface
        ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None
    finally:
        s.close()


def wifi_ssid() -> str | None:
    if config.MOCK:
        return "Ev Wi-Fi"
    try:
        r = subprocess.run(["nmcli", "-t", "-f", "ACTIVE,SSID", "dev", "wifi"],
                           capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            if line.startswith("yes:"):
                return line[4:].replace("\\:", ":") or None
    except Exception:
        pass
    return None


def active_connection() -> str | None:
    """NetworkManager connection currently active on the Wi-Fi interface."""
    if config.DRY_RUN:
        return None
    try:
        r = subprocess.run(["nmcli", "-t", "-f", "NAME,DEVICE", "connection", "show", "--active"],
                           capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            name, _, dev = line.rpartition(":")
            if dev == config.WIFI_IFACE:
                return name.replace("\\:", ":")
    except Exception:
        pass
    return None


class Hotspot:
    def __init__(self):
        self.active = False
        self.password: str | None = None
        self.previous: str | None = None

    def start(self) -> dict:
        if self.active:
            return self.info()
        self.previous = active_connection()
        alphabet = "abcdefghjkmnpqrstuvwxyz23456789"          # no look-alike characters
        self.password = "".join(secrets.choice(alphabet) for _ in range(10))
        r = _run(["/usr/bin/nmcli", "device", "wifi", "hotspot", "ifname", config.WIFI_IFACE,
                  "con-name", HOTSPOT_CON, "ssid", config.HOTSPOT_SSID, "password", self.password])
        if r is not None and r.returncode != 0:
            self.password = None
            raise RuntimeError(r.stderr.strip() or "hotspot failed")
        self.active = True
        return self.info()

    def stop(self):
        if not self.active:
            return
        _run(["/usr/bin/nmcli", "connection", "delete", HOTSPOT_CON])
        if self.previous:
            _run(["/usr/bin/nmcli", "connection", "up", "id", self.previous])
        else:
            _run(["/usr/bin/nmcli", "device", "connect", config.WIFI_IFACE])
        self.active = False
        self.password = None

    def info(self) -> dict:
        pw = self.password
        return {"active": self.active, "ssid": config.HOTSPOT_SSID, "password": pw, "ip": HOTSPOT_IP,
                "wifi_qr": f"WIFI:T:WPA;S:{config.HOTSPOT_SSID};P:{pw};;" if pw else None}
