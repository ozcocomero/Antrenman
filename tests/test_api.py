import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, db, main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "pt.db")
    monkeypatch.setattr(config, "PHOTO_DIR", tmp_path / "photos")
    monkeypatch.setattr(main.system, "lan_ip", lambda: "192.168.1.22")
    main.A.__init__()
    db._conn = None
    with TestClient(main.app) as c:
        yield c


def jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (10, 120, 200)).save(buf, "JPEG")
    return buf.getvalue()


def make_profile(c, **kw):
    r = c.post("/api/profiles", json={"name": "İzzet", "age": 45, "consent": True, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_profile_requires_consent_and_name(client):
    assert client.post("/api/profiles", json={"name": "A"}).status_code == 400
    assert client.post("/api/profiles", json={"name": " ", "consent": True}).status_code == 400
    p = make_profile(client)
    assert p["zones"]["max"] == 177 and p["consent_at"]


def test_session_saved_and_listed(client):
    p = make_profile(client)
    client.post(f"/api/profiles/{p['id']}/select")
    s = client.post("/api/session/start").json()
    main.A.session.tick(1.0, 130, [], 24.0, 50.0, True)
    main.A.session.tick(2.0, 131, [], 24.0, 50.0, True)
    client.post("/api/session/finish")
    assert client.post("/api/session/save").json()["id"] == s["id"]
    hist = client.get(f"/api/profiles/{p['id']}/sessions").json()
    assert hist[0]["duration_s"] == 2
    assert db.count_samples(s["id"]) == 2


def test_guest_session_not_saved(client):
    client.post("/api/guest")
    client.post("/api/session/start")
    main.A.session.tick(1.0, 130, [], None, None, True)
    assert client.post("/api/session/save").json()["id"] is None


def test_interrupted_session_recovered(client):
    p = make_profile(client)
    client.post(f"/api/profiles/{p['id']}/select")
    client.post("/api/session/start")
    main.A.session.tick(1.0, 130, [], None, None, True)
    main.A.flush()
    db.mark_interrupted()                     # what startup does after a power cut
    hist = client.get(f"/api/profiles/{p['id']}/sessions").json()
    assert hist[0]["status"] == "interrupted" and hist[0]["duration_s"] == 1


def test_photo_upload_flow_and_late_upload_rejected(client):
    p = make_profile(client)
    tok = client.post("/api/photo/token", json={"profile_name": "İzzet"}).json()
    assert tok["url"].startswith("http://192.168.1.22:8080/m/")
    assert client.get(f"/api/m/{tok['token']}").status_code == 200
    r = client.post(f"/api/m/{tok['token']}/upload", content=jpeg(), headers={"Content-Type": "image/jpeg"})
    assert r.status_code == 200
    tmp = main.A.photo["tmp"]
    # single use
    assert client.post(f"/api/m/{tok['token']}/upload", content=jpeg()).status_code == 410
    # cancelled code
    tok2 = client.post("/api/photo/token", json={}).json()["token"]
    client.post("/api/photo/cancel")
    assert client.post(f"/api/m/{tok2}/upload", content=jpeg()).status_code == 410
    # use the photo
    p = client.put(f"/api/profiles/{p['id']}", json={"photo": {"tmp": tmp}}).json()
    assert p["has_photo"] == 1 and p["photo_url"]
    img = Image.open(io.BytesIO(client.get(p["photo_url"]).content))
    assert img.size == (512, 512)


def test_upload_rejects_garbage_and_large(client):
    tok = client.post("/api/photo/token", json={}).json()["token"]
    assert client.post(f"/api/m/{tok}/upload", content=b"not an image").status_code == 400
    tok = client.post("/api/photo/token", json={}).json()["token"]
    big = b"x" * (config.MAX_UPLOAD_BYTES + 1)
    assert client.post(f"/api/m/{tok}/upload", content=big).status_code == 413


def test_delete_profile_removes_everything(client):
    p = make_profile(client)
    client.post(f"/api/profiles/{p['id']}/select")
    s = client.post("/api/session/start").json()
    main.A.session.tick(1.0, 130, [], None, None, True)
    client.post("/api/session/save")
    assert client.delete(f"/api/profiles/{p['id']}").status_code == 200
    assert db.get_session(s["id"]) is None
    assert db.count_samples(s["id"]) == 0


def test_usb_path_traversal_blocked(client):
    assert client.get("/api/usb/thumb", params={"path": "/etc/passwd"}).status_code == 404


def test_remote_clients_only_reach_phone_pages(client, monkeypatch):
    monkeypatch.setattr(config, "REMOTE_UI", False)
    assert main.is_allowed("/api/system/shutdown", "192.168.1.50") is False
    assert main.is_allowed("/api/profiles", "10.42.0.23") is False
    assert main.is_allowed("/api/system/shutdown", "127.0.0.1") is True
    assert main.is_allowed("/api/m/abc/upload", "10.42.0.23") is True
    assert main.is_allowed("/m/abc", "192.168.1.50") is True
    assert client.post("/api/system/shutdown").status_code == 403    # TestClient host is "testclient"
