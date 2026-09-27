"""Profile photos: single-use upload tokens, re-encoding, USB stick browsing."""
import io
import secrets
import time
import uuid
from pathlib import Path

from PIL import Image, ImageOps

from . import config

SIZE = 512
IMAGE_EXT = {".jpg", ".jpeg", ".png"}
Image.MAX_IMAGE_PIXELS = 40_000_000   # refuse decompression bombs


class UploadTokens:
    """At most one live token. A new token or a cancel invalidates the previous one."""

    def __init__(self):
        self.token: str | None = None
        self.expires_at = 0.0
        self.used = False
        self.profile_name = ""

    def new(self, profile_name: str, now=None) -> dict:
        self.token = secrets.token_urlsafe(16)
        self.expires_at = (time.time() if now is None else now) + config.UPLOAD_TOKEN_TTL_S
        self.used = False
        self.profile_name = profile_name
        return self.info(now)

    def cancel(self):
        self.token = None

    def valid(self, token: str, now=None) -> bool:
        return (self.token is not None and secrets.compare_digest(token, self.token)
                and not self.used and (time.time() if now is None else now) < self.expires_at)

    def consume(self, token: str, now=None) -> bool:
        if not self.valid(token, now):
            return False
        self.used = True
        return True

    def info(self, now=None) -> dict:
        return {"token": self.token, "expires_in": max(0, round(self.expires_at - (time.time() if now is None else now))),
                "profile_name": self.profile_name}


def process(data: bytes, crop: dict | None = None) -> Image.Image:
    """Decode, apply EXIF orientation, optionally crop, return a 512×512 RGB image.

    crop (device-side USB crop): {"rotate": 0|90|180|270, "cx", "cy", "size"} where
    cx, cy are the crop centre as fractions of the rotated image and size is the
    crop side as a fraction of its short edge. Metadata is never carried over.
    """
    img = Image.open(io.BytesIO(data))
    img.load()
    img = ImageOps.exif_transpose(img).convert("RGB")
    if crop:
        rot = int(crop.get("rotate", 0)) % 360
        if rot:
            img = img.rotate(-rot, expand=True)
        w, h = img.size
        side = max(16.0, min(w, h) * min(1.0, float(crop.get("size", 1.0))))
        cx, cy = float(crop.get("cx", 0.5)) * w, float(crop.get("cy", 0.5)) * h
        left = min(max(cx - side / 2, 0), w - side)
        top = min(max(cy - side / 2, 0), h - side)
        img = img.crop((round(left), round(top), round(left + side), round(top + side)))
    else:
        img = ImageOps.fit(img, (min(img.size),) * 2)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def save_tmp(img: Image.Image) -> str:
    name = f"tmp/{uuid.uuid4().hex}.jpg"
    img.save(config.PHOTO_DIR / name, "JPEG", quality=88)
    return name


def tmp_path(name: str) -> Path | None:
    p = (config.PHOTO_DIR / name).resolve()
    if (config.PHOTO_DIR / "tmp").resolve() == p.parent and p.is_file():
        return p
    return None


def profile_path(pid: int) -> Path:
    return config.PHOTO_DIR / f"{int(pid)}.jpg"


def commit(tmp_name: str, pid: int) -> bool:
    src = tmp_path(tmp_name)
    if not src:
        return False
    src.replace(profile_path(pid))
    return True


def remove(pid: int):
    profile_path(pid).unlink(missing_ok=True)


def cleanup_tmp(max_age_s=3600):
    for f in (config.PHOTO_DIR / "tmp").glob("*.jpg"):
        if time.time() - f.stat().st_mtime > max_age_s:
            f.unlink(missing_ok=True)


# ---------- USB stick ----------
def usb_mounts() -> list[Path]:
    """Raspberry Pi OS automounts to /media/<user>/<label>."""
    root = config.USB_ROOT
    if not root.is_dir():
        return []
    is_mount = (lambda p: True) if config.MOCK else (lambda p: p.is_mount())   # mock: plain folders
    out = []
    for user_dir in root.iterdir():
        if user_dir.is_dir():
            out.extend(p for p in user_dir.iterdir() if p.is_dir() and is_mount(p))
            if not config.MOCK and user_dir.is_mount():
                out.append(user_dir)
    return out


def usb_images(limit=200, mounts=None) -> list[dict]:
    out = []
    for m in (mounts if mounts is not None else usb_mounts()):
        for f in sorted(m.rglob("*")):
            if len(out) >= limit:
                return out
            rel = f.relative_to(m).parts
            if f.suffix.lower() in IMAGE_EXT and f.is_file() and not any(p.startswith(".") for p in rel):
                out.append({"path": str(f), "name": f.name})
    return out


def safe_usb_path(path: str) -> Path | None:
    p = Path(path).resolve()
    if config.USB_ROOT.resolve() in p.parents and p.suffix.lower() in IMAGE_EXT and p.is_file():
        return p
    return None


def _jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def thumbnail(path: Path, size=160) -> bytes:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return _jpeg(ImageOps.fit(img, (size, size)), 75)


def preview(path: Path, max_side=1200) -> bytes:
    """Downscaled, orientation-corrected copy for cropping on the device."""
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((max_side, max_side))
    return _jpeg(img, 85)
