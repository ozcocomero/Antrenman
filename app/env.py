"""Ambient temperature / humidity from the SHTC3 on the Waveshare Sense HAT (B), over I2C.

The I2C address comes from config (default 0x70) and must be verified with
`i2cdetect -y 1` on the Pi (docs/hardware.md). Offsets are applied from config.toml.
"""
import logging
import random
import time

from . import config

log = logging.getLogger("pt.env")

CMD_WAKEUP = (0x35, 0x17)
CMD_SLEEP = (0xB0, 0x98)
CMD_MEASURE_T_FIRST = (0x78, 0x66)   # normal mode, no clock stretching


def crc8(data: bytes) -> int:
    crc = 0xFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x31) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


def decode(raw: bytes) -> tuple[float, float]:
    """6 bytes: T msb, T lsb, crc, RH msb, RH lsb, crc -> (°C, %RH)."""
    if crc8(raw[0:2]) != raw[2] or crc8(raw[3:5]) != raw[5]:
        raise ValueError("SHTC3 CRC mismatch")
    t_raw = int.from_bytes(raw[0:2], "big")
    h_raw = int.from_bytes(raw[3:5], "big")
    return -45 + 175 * t_raw / 65536, 100 * h_raw / 65536


class SHTC3:
    def __init__(self, bus: int, address: int):
        from smbus2 import SMBus
        self.bus = SMBus(bus)
        self.addr = address

    def _cmd(self, cmd):
        from smbus2 import i2c_msg
        self.bus.i2c_rdwr(i2c_msg.write(self.addr, list(cmd)))

    def read(self) -> tuple[float, float]:
        from smbus2 import i2c_msg
        self._cmd(CMD_WAKEUP)
        time.sleep(0.001)
        self._cmd(CMD_MEASURE_T_FIRST)
        time.sleep(0.015)
        msg = i2c_msg.read(self.addr, 6)
        self.bus.i2c_rdwr(msg)
        self._cmd(CMD_SLEEP)
        return decode(bytes(msg))


class EnvSensor:
    def __init__(self):
        self.ok = False
        self.temp: float | None = None
        self.hum: float | None = None
        self.raw_temp: float | None = None
        self.raw_hum: float | None = None
        self._dev = None
        self._failures = 0
        self.reload_config()
        if config.MOCK:
            self.ok = True
            return
        try:
            self._dev = SHTC3(self.cfg["i2c_bus"], int(self.cfg["shtc3_address"]))
            self.ok = True
        except Exception as e:
            log.warning("SHTC3 not available: %s", e)

    def reload_config(self):
        self.cfg = config.load()

    def read(self):
        try:
            if config.MOCK:
                t, h = 24.5 + random.uniform(-0.2, 0.2), 58 + random.uniform(-1, 1)
            elif self._dev:
                t, h = self._dev.read()
            else:
                return
        except Exception as e:
            self._failures += 1
            if self._failures in (1, 10, 100):
                log.warning("SHTC3 read failed (%d): %s", self._failures, e)
            if self._failures >= 3:
                self.ok = False
            return
        self._failures = 0
        self.ok = True
        self.raw_temp, self.raw_hum = t, h
        self.temp = round(t + float(self.cfg["temp_offset_c"]), 1)
        self.hum = round(min(100.0, max(0.0, h + float(self.cfg["humidity_offset_pct"]))))

    def snapshot(self) -> dict:
        return {"ok": self.ok, "temp": self.temp, "hum": self.hum,
                "raw_temp": round(self.raw_temp, 2) if self.raw_temp is not None else None,
                "raw_hum": round(self.raw_hum, 1) if self.raw_hum is not None else None,
                "temp_offset_c": self.cfg["temp_offset_c"], "humidity_offset_pct": self.cfg["humidity_offset_pct"]}
