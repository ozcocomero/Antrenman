import pytest

from app import env


def test_crc8_datasheet_vector():
    assert env.crc8(bytes([0xBE, 0xEF])) == 0x92      # Sensirion example


def _pack(v):
    b = v.to_bytes(2, "big")
    return b + bytes([env.crc8(b)])


def test_decode():
    t, h = env.decode(_pack(0x6666) + _pack(0x8000))
    assert round(t, 2) == round(-45 + 175 * 0x6666 / 65536, 2)
    assert h == 50.0


def test_decode_bad_crc():
    raw = bytearray(_pack(0x6666) + _pack(0x8000))
    raw[2] ^= 0xFF
    with pytest.raises(ValueError):
        env.decode(bytes(raw))
