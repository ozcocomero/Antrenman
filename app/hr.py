"""BLE heart rate source (chest strap or a watch in HR broadcast mode), spec §3."""
import asyncio
import logging
import math
import random
import time

from . import config

log = logging.getLogger("pt.hr")

HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"
BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"

CHEST_HINTS = ("smart sensor", "hrm", "polar h", "tickr", "h10", "h9", "strap", "movesense", "belt")


def parse_measurement(data: bytes) -> dict:
    """Heart Rate Measurement (0x2A37).

    flags bit0: 16-bit HR; bits1-2: sensor contact; bit3: energy field present;
    bit4: RR intervals present (1/1024 s).
    """
    flags = data[0]
    i = 1
    if flags & 0x01:
        hr = int.from_bytes(data[i:i + 2], "little")
        i += 2
    else:
        hr = data[i]
        i += 1
    contact = None
    if flags & 0x04:                      # contact detection supported
        contact = bool(flags & 0x02)
    if flags & 0x08:
        i += 2                            # energy expended, ignored
    rr = []
    if flags & 0x10:
        while i + 1 < len(data):
            rr.append(round(int.from_bytes(data[i:i + 2], "little") * 1000 / 1024))
            i += 2
    return {"hr": hr, "rr": rr, "contact": contact}


def kind_of(name: str) -> str:
    n = (name or "").lower()
    return "chest" if any(h in n for h in CHEST_HINTS) else "watch"


def signal_text(rssi) -> str:
    if rssi is None:
        return "sinyal bilinmiyor"
    if rssi >= -65:
        return "sinyal güçlü"
    if rssi >= -80:
        return "sinyal orta"
    return "sinyal zayıf"


def backoff_delays():
    """1, 2, 4, 5, 5, ... seconds (capped at RECONNECT_MAX_S)."""
    d = 1.0
    while True:
        yield d
        d = min(d * 2, config.RECONNECT_MAX_S)


class HeartRateMonitor:
    def __init__(self):
        self.devices: dict[str, dict] = {}
        self.scanning = False
        self.target: dict | None = None      # {"address", "name"}
        self.connected = False
        self.connecting = False
        self.hr: int | None = None
        self.last_at = 0.0
        self.contact: bool | None = None
        self.battery: int | None = None
        self._rr: list[int] = []
        self._client = None
        self._loop_task: asyncio.Task | None = None

    # ----- state -----
    def fresh(self, now=None) -> bool:
        now = now or time.time()
        return self.connected and self.last_at > 0 and now - self.last_at <= config.HR_LOSS_GRACE_S

    def take_rr(self) -> list[int]:
        rr, self._rr = self._rr, []
        return rr

    def snapshot(self) -> dict:
        now = time.time()
        return {
            "target": self.target,
            "connected": self.connected,
            "connecting": self.connecting,
            "fresh": self.fresh(now),
            "hr": self.hr if self.fresh(now) else None,
            "last_hr": self.hr,
            "since_s": round(now - self.last_at) if self.last_at else None,
            "battery": self.battery,
            "scanning": self.scanning,
        }

    def device_list(self) -> list[dict]:
        items = sorted(self.devices.values(), key=lambda d: (d["kind"] != "chest", -(d["rssi"] or -999)))
        return [{**d, "signal": signal_text(d["rssi"])} for d in items]

    def _on_data(self, data: bytes):
        m = parse_measurement(data)
        if m["hr"] <= 0:
            return
        self.hr = m["hr"]
        self.contact = m["contact"]
        self.last_at = time.time()
        self._rr.extend(m["rr"])

    # ----- scanning -----
    async def scan(self, seconds: float = 6.0):
        if self.scanning:
            return
        from bleak import BleakScanner
        self.scanning = True
        found = {}

        def cb(dev, adv):
            name = adv.local_name or dev.name or dev.address
            found[dev.address] = {"address": dev.address, "name": name, "rssi": adv.rssi, "kind": kind_of(name)}

        try:
            async with BleakScanner(detection_callback=cb, service_uuids=[HR_SERVICE]):
                await asyncio.sleep(seconds)
        except Exception as e:
            log.warning("scan failed: %s", e)
        finally:
            self.devices = found
            self.scanning = False

    # ----- connection -----
    async def connect(self, address: str, name: str | None = None, timeout: float = 10.0) -> bool:
        await self.disconnect()
        self.target = {"address": address, "name": name or self.devices.get(address, {}).get("name") or address}
        ok = await self._connect_once(timeout)
        if ok:
            self._start_keepalive()
        else:
            self.target = None
        return ok

    async def _connect_once(self, timeout: float) -> bool:
        from bleak import BleakClient, BleakScanner
        self.connecting = True
        try:
            dev = await BleakScanner.find_device_by_address(self.target["address"], timeout=timeout)
            if dev is None:
                return False
            client = BleakClient(dev, disconnected_callback=self._on_disconnect)
            await client.connect()
            await client.start_notify(HR_MEASUREMENT, lambda _c, data: self._on_data(bytes(data)))
            try:
                self.battery = (await client.read_gatt_char(BATTERY_LEVEL))[0]
            except Exception:
                self.battery = None
            self._client = client
            self.connected = True
            log.info("connected: %s", self.target)
            return True
        except Exception as e:
            log.warning("connect failed: %s", e)
            return False
        finally:
            self.connecting = False

    def _on_disconnect(self, _client):
        log.info("disconnected: %s", self.target)
        self.connected = False
        self._client = None

    def _start_keepalive(self):
        if self._loop_task is None or self._loop_task.done():
            self._loop_task = asyncio.create_task(self._keepalive())

    async def _keepalive(self):
        """Reconnect with exponential backoff while a target is set."""
        delays = backoff_delays()
        while self.target:
            if self.connected:
                delays = backoff_delays()
                await asyncio.sleep(1)
                continue
            await asyncio.sleep(next(delays))
            if self.target and not self.connected and not self.connecting:
                await self._connect_once(timeout=config.RECONNECT_MAX_S)

    async def disconnect(self):
        self.target = None
        if self._loop_task:
            self._loop_task.cancel()
            self._loop_task = None
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
        self._client = None
        self.connected = False
        self.hr = None
        self.last_at = 0.0
        self.battery = None


class MockMonitor(HeartRateMonitor):
    """PT_MOCK=1: fake devices and a slowly varying heart rate with RR intervals."""

    FAKE = [
        {"address": "MOCK:01", "name": "Suunto Smart Sensor", "rssi": -55, "kind": "chest"},
        {"address": "MOCK:02", "name": "Garmin Forerunner", "rssi": -72, "kind": "watch"},
        {"address": "MOCK:03", "name": "Suunto Race", "rssi": -84, "kind": "watch"},
    ]

    def __init__(self):
        super().__init__()
        self.lost = False            # toggled via /api/mock/lost to test the signal-lost banner
        self._feed_task = None
        self._t0 = time.time()

    async def scan(self, seconds: float = 6.0):
        self.scanning = True
        await asyncio.sleep(min(seconds, 1.5))
        self.devices = {d["address"]: dict(d) for d in self.FAKE}
        self.scanning = False

    async def _connect_once(self, timeout: float) -> bool:
        await asyncio.sleep(0.3)
        self.connected = True
        self.battery = 80
        if self._feed_task is None:
            self._feed_task = asyncio.create_task(self._feed())
        return True

    def _start_keepalive(self):
        pass

    async def _feed(self):
        while True:
            await asyncio.sleep(1)
            if self.connected and self.target and not self.lost:
                t = time.time() - self._t0
                hr = int(128 + 35 * math.sin(t / 45) + random.uniform(-3, 3))
                rr = round(60000 / hr)
                self._on_data(bytes([0x16, hr & 0xFF]) + int(rr * 1024 / 1000).to_bytes(2, "little"))
