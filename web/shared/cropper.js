// Circle cropper on a <canvas>: drag to move, pinch or zoom() to scale, rotate() by 90°.
// Used by the phone page (exports a 512×512 JPEG) and the device USB flow (exports crop params).
export class Cropper {
  constructor(canvas, { radiusRatio = 0.42, onChange = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.radiusRatio = radiusRatio;
    this.onChange = onChange;
    this.rotation = 0;
    this.src = null;        // rotated source canvas
    this.pointers = new Map();
    this._resize();
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    for (const t of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(t, (e) => this._up(e));
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.R = Math.min(this.w, this.h) * this.radiusRatio;
  }

  async load(url) {
    const img = new Image();
    img.decoding = "async";
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    this.image = img;
    this.rotation = 0;
    this._prepare();
  }

  _prepare() {
    const img = this.image, rot = this.rotation % 360;
    const swap = rot === 90 || rot === 270;
    const c = document.createElement("canvas");
    c.width = swap ? img.naturalHeight : img.naturalWidth;
    c.height = swap ? img.naturalWidth : img.naturalHeight;
    const g = c.getContext("2d");
    g.translate(c.width / 2, c.height / 2);
    g.rotate((rot * Math.PI) / 180);
    g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    this.src = c;
    this.minScale = (2 * this.R) / Math.min(c.width, c.height);
    this.maxScale = this.minScale * 5;
    this.scale = this.minScale;
    this.x = this.w / 2 - (c.width * this.scale) / 2;
    this.y = this.h / 2 - (c.height * this.scale) / 2;
    this._clamp();
    this.draw();
  }

  rotate() { if (this.image) { this.rotation = (this.rotation + 90) % 360; this._prepare(); } }

  zoom(f, px = this.w / 2, py = this.h / 2) {
    if (!this.src) return;
    const s = Math.min(this.maxScale, Math.max(this.minScale, this.scale * f));
    this.x = px - ((px - this.x) * s) / this.scale;
    this.y = py - ((py - this.y) * s) / this.scale;
    this.scale = s;
    this._clamp();
    this.draw();
  }

  zoomFraction() { return this.src ? (this.scale - this.minScale) / (this.maxScale - this.minScale) : 0; }

  _clamp() {
    // the crop circle must stay inside the image
    const cw = this.src.width * this.scale, ch = this.src.height * this.scale;
    const cx = this.w / 2, cy = this.h / 2, R = this.R;
    this.x = Math.min(cx - R, Math.max(cx + R - cw, this.x));
    this.y = Math.min(cy - R, Math.max(cy + R - ch, this.y));
  }

  _down(e) { this.canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); this._pinch = null; }
  _up(e) { this.pointers.delete(e.pointerId); this._pinch = null; }
  _move(e) {
    if (!this.pointers.has(e.pointerId) || !this.src) return;
    const prev = this.pointers.get(e.pointerId);
    const cur = { x: e.offsetX, y: e.offsetY };
    this.pointers.set(e.pointerId, cur);
    if (this.pointers.size === 1) {
      this.x += cur.x - prev.x; this.y += cur.y - prev.y;
      this._clamp(); this.draw();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinch) this.zoom(d / this._pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this._pinch = d;
    }
  }

  draw() {
    const g = this.ctx, { w, h, R } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#3A424D"; g.fillRect(0, 0, w, h);
    if (this.src) g.drawImage(this.src, this.x, this.y, this.src.width * this.scale, this.src.height * this.scale);
    g.save();
    g.beginPath(); g.rect(0, 0, w, h); g.arc(w / 2, h / 2, R, 0, Math.PI * 2, true);
    g.fillStyle = "rgba(11,14,18,0.72)"; g.fill("evenodd");
    g.restore();
    g.beginPath(); g.arc(w / 2, h / 2, R, 0, Math.PI * 2);
    g.setLineDash([8, 6]); g.lineWidth = 2; g.strokeStyle = "#E8ECF1"; g.stroke(); g.setLineDash([]);
    this.onChange(this);
  }

  // Crop in terms of the rotated source: centre as fractions, side as fraction of the short edge.
  params() {
    const sw = this.src.width, sh = this.src.height;
    return {
      rotate: this.rotation,
      cx: (this.w / 2 - this.x) / this.scale / sw,
      cy: (this.h / 2 - this.y) / this.scale / sh,
      size: (2 * this.R) / this.scale / Math.min(sw, sh),
    };
  }

  toBlob(size = 512, quality = 0.88) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const side = (2 * this.R) / this.scale;
    const sx = (this.w / 2 - this.R - this.x) / this.scale, sy = (this.h / 2 - this.R - this.y) / this.scale;
    c.getContext("2d").drawImage(this.src, sx, sy, side, side, 0, 0, size, size);
    return new Promise((ok) => c.toBlob(ok, "image/jpeg", quality));
  }
}
