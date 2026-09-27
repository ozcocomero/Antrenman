import itertools

from app import hr


def test_parse_8bit():
    assert hr.parse_measurement(bytes([0x00, 72])) == {"hr": 72, "rr": [], "contact": None}


def test_parse_16bit_contact_energy_rr():
    data = bytes([0x01 | 0x02 | 0x04 | 0x08 | 0x10]) + (150).to_bytes(2, "little") + (10).to_bytes(2, "little") \
        + (1024).to_bytes(2, "little") + (512).to_bytes(2, "little")
    m = hr.parse_measurement(data)
    assert m["hr"] == 150
    assert m["contact"] is True
    assert m["rr"] == [1000, 500]


def test_contact_lost():
    assert hr.parse_measurement(bytes([0x04, 80]))["contact"] is False


def test_backoff_capped_at_5s():
    assert list(itertools.islice(hr.backoff_delays(), 6)) == [1, 2, 4, 5, 5, 5]


def test_kind_and_signal():
    assert hr.kind_of("Suunto Smart Sensor") == "chest"
    assert hr.kind_of("Forerunner 265") == "watch"
    assert hr.signal_text(-50) == "sinyal güçlü"
    assert hr.signal_text(-90) == "sinyal zayıf"
