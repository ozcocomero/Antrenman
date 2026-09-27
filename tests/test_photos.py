import io

from PIL import Image

from app import photos


def jpeg_with_exif(w=800, h=600):
    img = Image.new("RGB", (w, h), (200, 50, 50))
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"         # Make
    exif[0x0112] = 6                   # Orientation: rotate 90
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def test_process_is_512_square_without_metadata():
    img = photos.process(jpeg_with_exif())
    assert img.size == (512, 512)
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    out = Image.open(io.BytesIO(buf.getvalue()))
    assert not out.getexif()


def test_process_crop_params():
    img = photos.process(jpeg_with_exif(1000, 500), {"rotate": 90, "cx": 0.5, "cy": 0.25, "size": 0.5})
    assert img.size == (512, 512)


def test_tokens_single_use_expiry_cancel():
    t = photos.UploadTokens()
    tok = t.new("İzzet", now=0)["token"]
    assert t.valid(tok, now=10)
    assert not t.valid(tok, now=301)          # 5 minutes
    assert t.consume(tok, now=10)
    assert not t.consume(tok, now=11)         # single use
    tok2 = t.new("İzzet", now=0)["token"]
    assert not t.valid(tok, now=1)            # new code invalidates the old one
    t.cancel()
    assert not t.valid(tok2, now=1)
