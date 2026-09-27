// Phone pages P0–P4: pick or take a photo, crop to a circle, send a 512×512 JPEG to the device.
import { Cropper } from "/static/shared/cropper.js";

const token = location.pathname.split("/").pop();
const m = document.getElementById("m");
const HEART = `<svg viewBox="0 0 24 24" style="width:20px;height:20px"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 2.8 4.5 6.4 4.1c2.1-.2 3.9 1 5.6 3 1.7-2 3.5-3.2 5.6-3 3.6.4 5.5 4.2 4 7.6C19.5 16.4 12 21 12 21z" fill="#4CC07F"/></svg>`;
const brand = `<div class="brand">${HEART}PT Ekran</div>`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let info = null, deadline = 0, timer = null, cropper = null, lastBlob = null;

const icon = (color, inner) => `<svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>${inner}</svg>`;

function invalid() {  // P0
  clearInterval(timer);
  m.innerHTML = `${brand}<div class="center">${icon("#F59A3C", '<polyline points="12 6 12 12 16 14"/>')}
    <h1>Bağlantı geçersiz</h1><p>Süresi dolmuş, kullanılmış ya da iptal edilmiş. Cihazdan yeni QR kod al.</p></div>`;
}

function upload() {  // P1
  m.innerHTML = `${brand}
    <div style="margin-top:24px;display:flex;flex-direction:column;gap:6px"><h1>${esc(info.profile_name)} için profil fotoğrafı</h1>
      <div class="muted" style="font-size:15px">Bağlantı <span id="left"></span> sonra geçersiz olur</div></div>
    <div style="display:flex;justify-content:center;margin:28px 0 12px">
      <svg width="170" height="170" viewBox="0 0 170 170"><circle cx="85" cy="85" r="80" fill="none" stroke="#3A424D" stroke-width="3" stroke-dasharray="8 6"/><circle cx="85" cy="68" r="24" fill="#2A313B"/><path d="M40,138 C40,100 130,100 130,138" fill="#2A313B"/></svg></div>
    <label class="btn primary"><svg class="ic" width="20" height="20" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      Fotoğraf çek<input type="file" accept="image/*" capture="user" id="cam"></label>
    <label class="btn">Galeriden seç<input type="file" accept="image/*" id="gal"></label>
    <div class="card" style="margin-top:auto;padding:16px;display:flex;flex-direction:column;gap:8px">
      <div style="font-size:14px;font-weight:600">Gizlilik</div>
      <div style="font-size:14px;line-height:1.5;color:var(--soft)">Fotoğraf yalnızca bu cihaza gönderilir, internete yüklenmez. Konum ve dosya bilgileri gönderilmeden silinir.</div></div>`;
  for (const id of ["cam", "gal"]) document.getElementById(id).addEventListener("change", (e) => e.target.files[0] && crop(e.target.files[0]));
  tick();
}

function tick() {
  const el = document.getElementById("left");
  const s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s <= 0) invalid();
}

async function crop(file) {  // P2
  m.innerHTML = `${brand}<h1 style="font-size:32px">Yüzü daireye ortala</h1>
    <canvas id="crop"></canvas>
    <div class="muted" style="font-size:14px;text-align:center">İki parmakla yakınlaştır, sürükleyerek kaydır</div>
    <button class="btn" id="rot">90° döndür</button>
    <div class="bottom"><button class="btn primary" id="send">Gönder</button><button class="btn" id="other">Başka fotoğraf</button></div>`;
  cropper = new Cropper(document.getElementById("crop"), { radiusRatio: 0.435 });
  const url = URL.createObjectURL(file);
  try { await cropper.load(url); } catch { return fail("Bu fotoğraf açılamadı. Başka bir fotoğraf seç."); }
  document.getElementById("rot").onclick = () => cropper.rotate();
  document.getElementById("other").onclick = upload;
  document.getElementById("send").onclick = async () => { lastBlob = await cropper.toBlob(512); send(lastBlob); };
}

function send(blob) {
  m.innerHTML = `${brand}<div class="center"><h1>Gönderiliyor…</h1><div class="progress" style="width:100%"><div id="bar"></div></div></div>`;
  const xhr = new XMLHttpRequest();
  xhr.open("POST", `/api/m/${token}/upload`);
  xhr.setRequestHeader("Content-Type", "image/jpeg");
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) document.getElementById("bar").style.width = `${(e.loaded / e.total) * 100}%`; };
  xhr.onload = () => {
    if (xhr.status === 200) return done();
    if (xhr.status === 410) return invalid();
    fail("Fotoğraf cihazda açılamadı. Başka bir fotoğraf dene.", false);
  };
  xhr.onerror = () => fail("Telefon cihazın ağından ayrılmış olabilir. Wi-Fi'yi kontrol et, sonra tekrar dene.", true);
  xhr.send(blob);
}

function done() {  // P3
  clearInterval(timer);
  m.innerHTML = `${brand}<div class="center">${icon("#4CC07F", '<polyline points="7 12.5 10.5 16 17 9"/>')}
    <h1>Gönderildi</h1><p>Cihaz ekranında “Kullan”a dokunarak onayla. Bu sayfayı kapatabilirsin.</p></div>`;
}

function fail(msg, retry = false) {  // P4
  m.innerHTML = `${brand}<div class="center">${icon("#F0605A", '<line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>')}
    <h1>Gönderilemedi</h1><p>${esc(msg)}</p>
    ${retry ? `<button class="btn primary" id="retry">Tekrar dene</button>` : `<button class="btn primary" id="retry">Başka fotoğraf</button>`}</div>`;
  document.getElementById("retry").onclick = () => (retry && lastBlob ? send(lastBlob) : upload());
}

async function init() {
  try {
    const r = await fetch(`/api/m/${encodeURIComponent(token)}`);
    if (!r.ok) return invalid();
    info = await r.json();
    deadline = Date.now() + info.expires_in * 1000;
    timer = setInterval(tick, 1000);
    upload();
  } catch { fail("Cihaza ulaşılamadı. Telefonun cihazla aynı Wi-Fi ağında olduğundan emin ol.", false); }
}
init();
