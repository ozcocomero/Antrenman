"""PT Ekran server: device UI, phone upload pages (/m/...), REST API and /ws/live."""
import asyncio
import io
import logging
import time
from contextlib import asynccontextmanager

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config, db, garmin, photos, system, zones
from .env import EnvSensor
from .hr import HeartRateMonitor, MockMonitor
from .session import Session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("pt")

GUEST = {"id": None, "guest": True, "name": "Konuk", "age": 35, "zone_source": "age", "zone_method": "max",
         "max_hr": None, "rest_hr": None, "has_photo": 0, "photo_version": 0, "garmin_zones": None,
         "garmin_sport": "DEFAULT", "last_device": None}


class App:
    def __init__(self):
        self.hr = MockMonitor() if config.MOCK else HeartRateMonitor()
        self.env = EnvSensor()
        self.profile: dict | None = None
        self.session: Session | None = None
        self.tokens = photos.UploadTokens()
        self.hotspot = system.Hotspot()
        self.photo = {"state": "idle"}     # idle | waiting | receiving | received | error
        self.boot = {"state": "starting"}  # starting | ready
        self.garmin: dict[int, dict] = {}
        self.clients: set[WebSocket] = set()

    def profile_out(self, p: dict | None) -> dict | None:
        if p is None:
            return None
        out = {**p, "zones": zones.describe(p), "tanaka_max": zones.tanaka_max(int(p.get("age") or 35))}
        out["photo_url"] = f"/photos/{p['id']}.jpg?v={p.get('photo_version', 0)}" if p.get("has_photo") else None
        if p.get("id"):
            out["garmin_login"] = garmin.has_login(p["id"])
            out["garmin_status"] = self.garmin.get(p["id"])
        return out

    def snapshot(self) -> dict:
        photo = dict(self.photo)
        if self.tokens.token:
            photo["expires_in"] = self.tokens.info()["expires_in"]
        return {
            "t": time.time(),
            "boot": self.boot,
            "hr": self.hr.snapshot(),
            "env": self.env.snapshot(),
            "profile": self.profile_out(self.profile),
            "session": self.session.snapshot() if self.session else None,
            "photo": photo,
            "hotspot": {k: v for k, v in self.hotspot.info().items() if k != "password"},
            "mock": config.MOCK,
        }

    async def broadcast(self):
        if not self.clients:
            return
        msg = self.snapshot()
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                self.clients.discard(ws)

    def flush(self):
        s = self.session
        if s and s.db_id and s.pending:
            db.write_samples(s.db_id, s.take_pending(), s.summary())


A = App()


async def ticker():
    n = 0
    while True:
        await asyncio.sleep(1)
        n += 1
        now = time.time()
        if n % 5 == 1:
            await asyncio.to_thread(A.env.read)
        if A.session:
            fresh = A.hr.fresh(now)
            A.session.tick(now, A.hr.hr if fresh else None, A.hr.take_rr(), A.env.temp, A.env.hum,
                           A.hr.connected)
            if n % config.SAMPLE_FLUSH_S == 0:
                await asyncio.to_thread(A.flush)
        else:
            A.hr.take_rr()
        if n % 600 == 0:
            photos.cleanup_tmp(6 * 3600)   # unsaved drafts; startup clears the rest
        await A.broadcast()


async def garmin_sync_all():
    if A.hotspot.active:
        return   # no internet while the hotspot is up; spec §6
    for p in db.list_profiles():
        if p["zone_source"] == "garmin" and garmin.has_login(p["id"]):
            await garmin_sync_one(p["id"])


async def garmin_sync_one(pid: int) -> bool:
    try:
        p = await asyncio.to_thread(garmin.sync, pid)
        A.garmin[pid] = {"ok": True, "at": time.time()}
        if A.profile and A.profile.get("id") == pid:
            A.profile = p
        return True
    except Exception as e:
        log.warning("Garmin sync failed for profile %s: %s", pid, e)
        A.garmin[pid] = {"ok": False, "error": str(e), "at": time.time()}
        return False


async def boot():
    if not config.MOCK:
        await garmin_sync_all()
    else:
        await asyncio.sleep(1.2)
    A.boot = {"state": "ready"}
    await A.broadcast()


@asynccontextmanager
async def lifespan(_app):
    config.ensure_dirs()
    db.open_db()
    db.mark_interrupted()
    photos.cleanup_tmp(0)
    tasks = [asyncio.create_task(ticker()), asyncio.create_task(boot())]
    yield
    for t in tasks:
        t.cancel()
    A.flush()
    await A.hr.disconnect()
    A.hotspot.stop()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=config.WEB_DIR), name="static")

LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
PUBLIC_PREFIXES = ("/m/", "/api/m/", "/static/")


def is_allowed(path: str, host: str | None) -> bool:
    return config.REMOTE_UI or host in LOCAL_HOSTS or path.startswith(PUBLIC_PREFIXES)


@app.middleware("http")
async def local_only(request: Request, call_next):
    if not is_allowed(request.url.path, request.client.host if request.client else None):
        return JSONResponse({"error": "Yalnızca cihaz ekranından"}, status_code=403)
    return await call_next(request)
NO_STORE = {"Cache-Control": "no-store"}


# ---------- pages ----------
@app.get("/")
def device_page():
    return FileResponse(config.WEB_DIR / "device" / "index.html", headers=NO_STORE)


@app.get("/m/{token}")
def phone_page(token: str):
    return FileResponse(config.WEB_DIR / "phone" / "index.html", headers=NO_STORE)


@app.get("/photos/{pid}.jpg")
def photo_file(pid: int):
    p = photos.profile_path(pid)
    if not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/photos/tmp/{name}")
def photo_tmp(name: str):
    p = photos.tmp_path(f"tmp/{name}")
    if not p:
        raise HTTPException(404)
    return FileResponse(p, headers=NO_STORE)


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    if not is_allowed("/ws/live", websocket.client.host if websocket.client else None):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    A.clients.add(websocket)
    await websocket.send_json(A.snapshot())
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        A.clients.discard(websocket)


@app.get("/api/state")
def state():
    return A.snapshot()


# ---------- profiles ----------
def _clean(d: dict) -> dict:
    out = {}
    if "name" in d:
        name = str(d["name"]).strip()[:40]
        if not name:
            raise HTTPException(400, "Ad gerekli")
        out["name"] = name
    for k, lo, hi in (("age", 10, 99), ("height_cm", 100, 230), ("weight_kg", 25, 250),
                      ("max_hr", 100, 230), ("rest_hr", 30, 120)):
        if k in d and d[k] is not None:
            out[k] = max(lo, min(hi, int(d[k])))
    if d.get("zone_source") in ("age", "garmin", "manual"):
        out["zone_source"] = d["zone_source"]
    if d.get("zone_method") in ("max", "hrr"):
        out["zone_method"] = d["zone_method"]
    if isinstance(d.get("garmin_sport"), str):
        out["garmin_sport"] = d["garmin_sport"][:40]
    return out


def _apply_photo(pid: int, d: dict) -> dict:
    """photo: {"tmp": "tmp/<x>.jpg"} sets a new photo, photo: null removes it."""
    if "photo" not in d:
        return {}
    ph = d["photo"]
    if ph is None:
        photos.remove(pid)
        return {"has_photo": 0}
    if isinstance(ph, dict) and ph.get("tmp") and photos.commit(ph["tmp"], pid):
        p = db.get_profile(pid)
        return {"has_photo": 1, "photo_version": (p.get("photo_version") or 0) + 1}
    return {}


@app.get("/api/profiles")
def list_profiles():
    return [A.profile_out(p) for p in db.list_profiles()]


@app.get("/api/profiles/{pid}")
def get_profile(pid: int):
    p = db.get_profile(pid)
    if not p:
        raise HTTPException(404)
    return A.profile_out(p)


@app.post("/api/profiles")
async def create_profile(req: Request):
    d = await req.json()
    if not d.get("consent"):
        raise HTTPException(400, "Onay gerekli")
    vals = _clean(d)
    if "name" not in vals:
        raise HTTPException(400, "Ad gerekli")
    vals["consent_at"] = time.time()
    p = db.create_profile(vals)
    upd = _apply_photo(p["id"], d)
    if upd:
        p = db.update_profile(p["id"], upd)
    return A.profile_out(p)


@app.put("/api/profiles/{pid}")
async def update_profile(pid: int, req: Request):
    if not db.get_profile(pid):
        raise HTTPException(404)
    d = await req.json()
    p = db.update_profile(pid, {**_clean(d), **_apply_photo(pid, d)})
    if A.profile and A.profile.get("id") == pid:
        A.profile = p
    await A.broadcast()
    return A.profile_out(p)


@app.delete("/api/profiles/{pid}")
async def delete_profile(pid: int):
    if A.session and A.session.profile.get("id") == pid:
        raise HTTPException(409, "Seans sürerken silinemez")
    db.delete_profile(pid)
    photos.remove(pid)
    if A.profile and A.profile.get("id") == pid:
        A.profile = None
    await A.broadcast()
    return {"ok": True}


@app.post("/api/profiles/{pid}/select")
async def select_profile(pid: int):
    p = db.get_profile(pid)
    if not p:
        raise HTTPException(404)
    A.profile = db.update_profile(pid, {"last_used_at": time.time()})
    await A.broadcast()
    return A.profile_out(A.profile)


@app.post("/api/guest")
async def select_guest():
    A.profile = dict(GUEST)
    await A.broadcast()
    return A.profile_out(A.profile)


@app.put("/api/guest")
async def update_guest(req: Request):
    if not (A.profile and A.profile.get("guest")):
        raise HTTPException(400)
    A.profile.update(_clean(await req.json()))
    A.profile["zone_source"] = A.profile["zone_source"] if A.profile["zone_source"] != "garmin" else "age"
    await A.broadcast()
    return A.profile_out(A.profile)


@app.post("/api/profiles/{pid}/garmin-sync")
async def garmin_sync(pid: int):
    if A.hotspot.active:
        raise HTTPException(409, "Cihaz ağı açıkken internet yok")
    ok = await garmin_sync_one(pid)
    await A.broadcast()
    if not ok:
        raise HTTPException(502, A.garmin[pid]["error"])
    return A.profile_out(db.get_profile(pid))


@app.get("/api/profiles/{pid}/sessions")
def profile_sessions(pid: int):
    return db.list_sessions(pid)


@app.get("/api/sessions/{sid}")
def session_detail(sid: int):
    s = db.get_session(sid)
    if not s:
        raise HTTPException(404)
    return s


# ---------- heart rate source ----------
@app.post("/api/hr/scan")
async def hr_scan():
    await A.hr.scan(6.0)
    return A.hr.device_list()


@app.post("/api/hr/connect")
async def hr_connect(req: Request):
    d = await req.json()
    ok = await A.hr.connect(d["address"], d.get("name"))
    if ok and A.profile and A.profile.get("id"):
        A.profile = db.update_profile(A.profile["id"], {"last_device": A.hr.target})
    await A.broadcast()
    return {"ok": ok}


@app.post("/api/hr/disconnect")
async def hr_disconnect():
    await A.hr.disconnect()
    await A.broadcast()
    return {"ok": True}


@app.post("/api/hr/find-last")
async def hr_find_last():
    """After picking a profile: look for that profile's last device for 15 s."""
    last = (A.profile or {}).get("last_device")
    if A.hr.connected and (not last or A.hr.target.get("address") == last.get("address")):
        return {"found": True, "device": A.hr.target}
    if not last:
        return {"found": False}
    ok = await A.hr.connect(last["address"], last.get("name"), timeout=config.LAST_DEVICE_TIMEOUT_S)
    await A.broadcast()
    return {"found": ok, "device": last}


# ---------- session ----------
@app.post("/api/session/start")
async def session_start():
    if not A.profile:
        raise HTTPException(400, "Profil seçilmedi")
    if A.session and not A.session.finished:
        return A.session.snapshot()
    s = Session(A.profile, (A.hr.target or {}).get("name"))
    if A.profile.get("id"):
        s.db_id = db.start_session(A.profile["id"], s.started_at, s.source)
    A.session = s
    await A.broadcast()
    return s.snapshot()


def _session() -> Session:
    if not A.session:
        raise HTTPException(400, "Seans yok")
    return A.session


@app.post("/api/session/pause")
async def session_pause():
    _session().paused = True
    await A.broadcast()
    return {"ok": True}


@app.post("/api/session/resume")
async def session_resume():
    _session().paused = False
    await A.broadcast()
    return {"ok": True}


@app.post("/api/session/finish")
async def session_finish():
    s = _session()
    s.finished = True
    await asyncio.to_thread(A.flush)
    await A.broadcast()
    return s.snapshot()


@app.post("/api/session/save")
async def session_save():
    """Save and close. Guest sessions and empty sessions are not kept."""
    s = _session()
    s.finished = True
    await asyncio.to_thread(A.flush)
    if s.db_id:
        if s.duration_s > 0:
            db.finish_session(s.db_id, "saved", s.summary())
        else:
            db.delete_session(s.db_id)
    A.session = None
    await A.broadcast()
    return {"id": s.db_id if s.duration_s > 0 else None}


@app.post("/api/session/discard")
async def session_discard():
    s = _session()
    if s.db_id:
        db.delete_session(s.db_id)
    A.session = None
    await A.broadcast()
    return {"ok": True}


# ---------- calibration (hidden: tap the Zone settings title 5 times) ----------
@app.get("/api/calibration")
def calibration():
    return A.env.snapshot()


@app.put("/api/calibration")
async def set_calibration(req: Request):
    d = await req.json()
    upd = {}
    if "temp_offset_c" in d:
        upd["temp_offset_c"] = round(max(-15.0, min(15.0, float(d["temp_offset_c"]))), 1)
    if "humidity_offset_pct" in d:
        upd["humidity_offset_pct"] = round(max(-30.0, min(30.0, float(d["humidity_offset_pct"]))), 1)
    config.save(upd)
    A.env.reload_config()
    await asyncio.to_thread(A.env.read)
    return A.env.snapshot()


# ---------- photos ----------
def qr_svg(text: str) -> str:
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=1)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


def base_url() -> str | None:
    ip = system.HOTSPOT_IP if A.hotspot.active else system.lan_ip()
    return f"http://{ip}:{config.PORT}" if ip else None


@app.get("/api/net")
def net():
    return {"ip": system.lan_ip(), "ssid": None if A.hotspot.active else system.wifi_ssid(),
            "hotspot": A.hotspot.active}


@app.post("/api/photo/token")
async def photo_token(req: Request):
    d = await req.json()
    base = base_url()
    if not base:
        raise HTTPException(409, "Cihaz bir ağa bağlı değil")
    info = A.tokens.new(str(d.get("profile_name") or "Profil")[:40])
    url = f"{base}/m/{info['token']}"
    A.photo = {"state": "waiting"}
    await A.broadcast()
    return {**info, "url": url, "qr": qr_svg(url),
            "network": config.HOTSPOT_SSID if A.hotspot.active else system.wifi_ssid()}


@app.post("/api/photo/cancel")
async def photo_cancel():
    A.tokens.cancel()
    A.photo = {"state": "idle"}
    await A.broadcast()
    return {"ok": True}


@app.get("/api/m/{token}")
def phone_check(token: str):
    if not A.tokens.valid(token):
        return JSONResponse({"valid": False}, status_code=410)
    return {"valid": True, **A.tokens.info()}


async def read_body(req: Request, report=None) -> bytes:
    total = int(req.headers.get("content-length") or 0)
    if total > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Dosya çok büyük")
    buf = bytearray()
    last = -1
    async for chunk in req.stream():
        buf += chunk
        if len(buf) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Dosya çok büyük")
        if report and total:
            step = len(buf) * 10 // total
            if step != last:
                last = step
                await report(min(99, len(buf) * 100 // total))
    return bytes(buf)


def device_name(ua: str) -> str:
    for key, name in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android telefon")):
        if key in ua:
            return name
    return "Telefon"


@app.post("/api/m/{token}/upload")
async def phone_upload(token: str, req: Request):
    if not A.tokens.consume(token):
        return JSONResponse({"error": "Bağlantı geçersiz"}, status_code=410)
    dev = device_name(req.headers.get("user-agent", ""))

    async def report(pct):
        A.photo = {"state": "receiving", "progress": pct, "device": dev}
        await A.broadcast()

    await report(0)
    try:
        data = await read_body(req, report)
        img = await asyncio.to_thread(photos.process, data)
        tmp = await asyncio.to_thread(photos.save_tmp, img)
    except HTTPException as e:
        A.tokens.cancel()
        A.photo = {"state": "error", "device": dev}
        await A.broadcast()
        return JSONResponse({"error": e.detail}, status_code=e.status_code)
    except Exception as e:
        log.warning("photo rejected: %s", e)
        A.tokens.cancel()
        A.photo = {"state": "error", "device": dev}
        await A.broadcast()
        return JSONResponse({"error": "Fotoğraf açılamadı"}, status_code=400)
    if A.tokens.token != token:          # cancelled on the device while uploading
        (config.PHOTO_DIR / tmp).unlink(missing_ok=True)
        return JSONResponse({"error": "Bağlantı geçersiz"}, status_code=410)
    A.tokens.cancel()
    A.photo = {"state": "received", "tmp": tmp, "device": dev}
    await A.broadcast()
    return {"ok": True}


@app.post("/api/photo/usb")
async def photo_usb(req: Request):
    d = await req.json()
    p = photos.safe_usb_path(d.get("path", ""))
    if not p:
        raise HTTPException(404, "Dosya bulunamadı")
    try:
        img = await asyncio.to_thread(photos.process, p.read_bytes(), d.get("crop"))
    except Exception:
        raise HTTPException(400, "Fotoğraf açılamadı")
    return {"tmp": await asyncio.to_thread(photos.save_tmp, img)}


@app.get("/api/usb")
def usb_list():
    mounts = photos.usb_mounts()
    return {"mounted": bool(mounts), "images": photos.usb_images(mounts=mounts)}


@app.get("/api/usb/thumb")
def usb_thumb(path: str):
    p = photos.safe_usb_path(path)
    if not p:
        raise HTTPException(404)
    try:
        return Response(photos.thumbnail(p), media_type="image/jpeg")
    except Exception:
        raise HTTPException(400)


@app.get("/api/usb/preview")
def usb_preview(path: str):
    p = photos.safe_usb_path(path)
    if not p:
        raise HTTPException(404)
    try:
        return Response(photos.preview(p), media_type="image/jpeg")
    except Exception:
        raise HTTPException(400)


# ---------- network / system ----------
@app.post("/api/hotspot/start")
async def hotspot_start():
    try:
        info = await asyncio.to_thread(A.hotspot.start)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    await A.broadcast()
    return {**info, "qr": qr_svg(info["wifi_qr"])}


@app.post("/api/hotspot/stop")
async def hotspot_stop():
    await asyncio.to_thread(A.hotspot.stop)
    await A.broadcast()
    return {"ok": True}


@app.post("/api/system/shutdown")
async def shutdown():
    if A.session:
        s = A.session
        s.finished = True
        await asyncio.to_thread(A.flush)
        if s.db_id and s.duration_s > 0:
            db.finish_session(s.db_id, "saved", s.summary())
        A.session = None
    await A.hr.disconnect()
    await asyncio.to_thread(A.hotspot.stop)
    system.shutdown()
    return {"ok": True}


@app.post("/api/mock/lost")
async def mock_lost(req: Request):
    if not config.MOCK:
        raise HTTPException(404)
    A.hr.lost = bool((await req.json()).get("lost"))
    return {"lost": A.hr.lost}
