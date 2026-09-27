// S2 profile edit and the photo flow C1–C6 (design/PhotoFlow.dc.html).
import { S, api, go, register, esc, confirmBox, toast, keyboard } from "./core.js";
import { avatar, fmtDur, ICON, stepper } from "./ui.js";
import { Cropper } from "/static/shared/cropper.js";

const LIMITS = { age: [10, 99], height_cm: [100, 230], weight_kg: [25, 250] };

// ---------------- S2 profile edit ----------------
register("profileEdit", {
  async enter(params) {
    if (params.keep && S.draft) return this.redraw();
    if (params.id) {
      const p = await api("GET", `/api/profiles/${params.id}`);
      S.draft = { id: p.id, name: p.name, age: p.age, height_cm: p.height_cm || 175, weight_kg: p.weight_kg || 75,
        photo_url: p.photo_url, photo: undefined };
    } else {
      S.draft = { id: null, name: "", age: 35, height_cm: 175, weight_kg: 75, photo_url: null, photo: undefined };
    }
    S.draft.from = params.from || "profiles";
    this.redraw();
  },
  redraw() { if (S.name === "profileEdit" && S.draft) document.querySelector(".screen").innerHTML = this.body(S.draft); },
  render: () => `<div class="row muted"><div class="spinner"></div></div>`,
  body: (d) => {
    const row = (label, key, unit) => `<div class="row" style="height:56px;gap:12px">
      <div style="width:70px;font-size:15px;font-weight:600;color:var(--muted)">${label}</div>${stepper(key, d[key], unit, true)}</div>`;
    return `<div class="head"><div class="title">${d.id ? "Profil" : "Yeni profil"}</div>
        <div class="btns">${d.id ? `<button class="danger" data-act="del">Sil</button>` : ""}
        <button data-act="back">Geri</button><button class="primary" data-act="save" style="padding:0 22px;font-size:16px">Kaydet</button></div></div>
      <div class="row" style="gap:12px;height:382px;align-items:stretch">
        <div class="card col" style="width:230px;padding:18px;align-items:center;justify-content:center;gap:14px">
          ${avatar({ name: d.name || "?", photo_url: d.photo_url }, 164, { ring: "#4CC07F", stroke: 4, gap: 6 })}
          <div class="sub" style="font-size:12px;margin-top:-6px">${d.photo === null ? "Fotoğraf kaldırılacak" : d.photo ? "Yeni fotoğraf · kaydedince geçerli" : d.photo_url ? "Profil fotoğrafı" : "Fotoğraf yok"}</div>
          <button data-act="photo" style="height:48px;width:100%">${ICON.camera}Fotoğraf değiştir</button></div>
        <div class="card col grow" style="padding:12px 18px;gap:8px">
          <div class="row" style="height:56px;gap:12px"><div style="width:70px;font-size:15px;font-weight:600;color:var(--muted)">Ad</div>
            <button data-act="name" style="flex-grow:1;height:50px;justify-content:flex-start;border-radius:10px;background:var(--bg);font-size:20px;font-weight:500;padding:0 14px">
            ${d.name ? esc(d.name) : `<span class="muted">Ad yazmak için dokun</span>`}</button></div>
          ${row("Yaş", "age", "yaş")}${row("Boy", "height_cm", "cm")}${row("Kilo", "weight_kg", "kg")}
          <div class="row" style="margin-top:auto;height:60px;border-radius:10px;background:var(--bg);justify-content:space-between;padding:0 16px">
            <div class="col" style="gap:2px"><div style="font-size:13px;color:var(--muted)">Yaşa göre maks. nabız</div>
              <div style="font-size:12px;color:var(--dim)">208 − 0,7 × yaş · Garmin bağlıysa onunki geçerli</div></div>
            <div class="cond" style="font-size:34px;font-weight:700;color:var(--red)">${Math.round(208 - 0.7 * d.age)} <span style="font-size:18px;color:var(--muted)">bpm</span></div></div></div></div>`;
  },
  acts: {
    step(b) {
      const k = b.dataset.k, [lo, hi] = LIMITS[k];
      S.draft[k] = Math.max(lo, Math.min(hi, S.draft[k] + +b.dataset.d));
      S.screen.redraw();
    },
    async name() {
      const v = await keyboard(S.draft.name, { label: "Ad" });
      if (v !== null) { S.draft.name = v; S.screen.redraw(); }
    },
    async photo() {
      const net = await api("GET", "/api/net");
      go(net.ip ? "photoQR" : "hotspot", { autoHotspot: !net.ip });
    },
    async back() {
      S.draft = null;
      go(S.params.from === "home" ? "home" : "profiles");
    },
    async del() {
      const ok = await confirmBox({ title: `${S.draft.name} silinsin mi?`, text: "Fotoğraf, tüm seanslar ve kayıtlı nabız örnekleri kalıcı olarak silinir.", yes: "Sil", danger: true });
      if (!ok) return;
      await api("DELETE", `/api/profiles/${S.draft.id}`);
      S.draft = null;
      go("profiles");
    },
    async save() {
      const d = S.draft;
      if (!d.name) return toast("Ad gerekli");
      const body = { name: d.name, age: d.age, height_cm: d.height_cm, weight_kg: d.weight_kg };
      if (d.photo !== undefined) body.photo = d.photo;
      if (d.id) await api("PUT", `/api/profiles/${d.id}`, body);
      else {
        // spec §7: explicit consent, heart rate is health data
        const ok = await confirmBox({ title: "Onay", yes: "Onaylıyorum",
          text: `Nabız sağlık verisidir. <b>${esc(d.name)}</b> kişisinin nabız ve seans verilerinin yalnızca bu cihazda saklanmasına açıkça izin verdiğini onaylıyor musun?` });
        if (!ok) return;
        await api("POST", "/api/profiles", { ...body, consent: true });
      }
      S.draft = null;
      go("profiles");
    },
  },
});

async function leavePhotoFlow() {
  await api("POST", "/api/photo/cancel").catch(() => {});
  if (S.live?.hotspot?.active) await api("POST", "/api/hotspot/stop").catch(() => {});
  go("profileEdit", { keep: true });
}

const steps = (items) => items.map((t, i) => `<div class="row" style="gap:12px"><div style="width:30px;height:30px;border-radius:15px;background:var(--line);font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i + 1}</div>
  <div style="font-size:15px;line-height:1.35">${t}</div></div>`).join("");

// ---------------- C1 QR upload (+ C3 states) ----------------
register("photoQR", {
  async enter() { await this.newCode(); },
  async newCode() {
    S.params.code = null;
    S.params.err = null;
    try {
      S.params.code = await api("POST", "/api/photo/token", { profile_name: S.draft.name || "Yeni profil" });
      S.params.code.t0 = Date.now();
    } catch (e) {
      if (e.status === 409) return go("hotspot", { autoHotspot: true });
      S.params.err = e.message;
    }
    if (S.name === "photoQR") document.querySelector(".screen").innerHTML = this.render(S.params, S.live);
  },
  remaining() {
    const c = S.params.code;
    return c ? Math.max(0, c.expires_in - Math.floor((Date.now() - c.t0) / 1000)) : 0;
  },
  render(p, l) {
    const d = S.draft;
    return `<div class="head"><div class="col" style="gap:3px"><div class="title">Profil fotoğrafı</div>
        <div class="sub">${esc(d?.name || "Yeni profil")} · telefondan yükle</div></div>
        <div class="btns"><button data-act="cancel" style="height:48px;padding:0 18px">İptal</button></div></div>
      <div data-region="body" style="height:382px"></div>`;
  },
  regions: {
    body(p, l) {
      const ph = l?.photo || {};
      const left = S.screen.remaining();
      if (ph.state === "received" && ph.tmp) {
        if (!p.leaving) { p.leaving = true; setTimeout(() => go("photoPreview", { tmp: ph.tmp, from: "phone" })); }
        return "";
      }
      const status = (inner) => `<div class="card col" style="height:382px;align-items:center;justify-content:center;gap:18px;padding:0 60px;text-align:center">${inner}</div>`;
      const again = `<div class="row" style="gap:10px"><button data-act="cancel" style="height:48px">İptal</button><button class="primary" data-act="renew" style="height:48px;padding:0 22px">${ph.state === "error" ? "Tekrar dene" : "Yeni kod"}</button></div>`;
      if (ph.state === "receiving") {
        const c = 2 * Math.PI * 36;
        return status(`<svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="36" fill="none" stroke="#232A33" stroke-width="7"/>
          <circle cx="42" cy="42" r="36" fill="none" stroke="#5AA0E0" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * (ph.progress || 0) / 100).toFixed(0)} ${c.toFixed(0)}" transform="rotate(-90 42 42)"/></svg>
          <div class="title">Fotoğraf alınıyor</div><div style="font-size:16px;color:var(--soft)">${esc(ph.device || "Telefon")} gönderiyor · %${ph.progress || 0}</div>
          <div class="sub">Telefondaki sayfayı kapatma</div>`);
      }
      if (ph.state === "error") return status(`<div class="title">Fotoğraf açılamadı</div>
          <div style="font-size:16px;color:var(--soft)">Dosya bozuk, çok büyük ya da desteklenmeyen bir biçimde. Mevcut fotoğraf değişmedi.</div>${again}`);
      if (p.err) return status(`<div class="title">Kod oluşturulamadı</div><div style="font-size:16px;color:var(--soft)">${esc(p.err)}</div>${again}`);
      if (!p.code) return status(`<div class="spinner"></div>`);
      if (left <= 0) return status(`<div class="title">Kodun süresi doldu</div>
          <div style="font-size:16px;color:var(--soft)">Güvenlik için her kod 5 dakika ve tek yükleme için geçerli.</div>${again}`);
      const hasPhoto = S.draft?.photo_url && S.draft.photo !== null;
      return `<div class="row" style="gap:12px;height:382px;align-items:stretch">
        <div class="col" style="width:240px;background:#F4F6F8;border-radius:14px;align-items:center;justify-content:center;gap:10px;padding:14px">
          <div class="qr" style="width:200px;height:200px;padding:0">${p.code.qr}</div>
          <div style="font-size:13px;font-weight:600;color:#1C232C">Kod ${fmtDur(left)} sonra geçersiz olur</div>
          <div style="font-size:11px;color:#4A525C">Tek kullanımlık</div></div>
        <div class="card col grow" style="padding:16px 20px;gap:12px"><div class="label">Telefonla yükle</div>
          ${steps(["Telefon kamerasıyla QR kodu okut", "Fotoğraf çek ya da galeriden seç", "Yüzü daireye ortala, Gönder'e dokun"])}
          <div class="row" style="height:56px;border-radius:10px;background:var(--bg);gap:12px;padding:0 14px">
            <div class="spinner" style="border-top-color:var(--muted2);width:30px;height:30px"></div>
            <div class="col" style="gap:1px"><div style="font-size:15px;font-weight:600">Fotoğraf bekleniyor…</div>
            <div style="font-size:12px;color:var(--muted)">Cihaz ağı: ${esc(p.code.network || "kablolu ağ")}</div></div></div>
          <div class="row" style="margin-top:auto;gap:8px">
            ${l?.hotspot?.active ? "" : `<button data-act="hotspot" class="grow" style="height:48px;font-size:14px">Telefon bağlanamıyor mu?</button>`}
            <button data-act="usb" style="height:48px;font-size:14px;${l?.hotspot?.active ? "flex-grow:1" : ""}">USB bellek</button>
            ${hasPhoto ? `<button class="danger" data-act="remove" style="height:48px;font-size:14px">Kaldır</button>` : ""}</div></div></div>`;
    },
  },
  acts: {
    cancel() { leavePhotoFlow(); },
    async renew() { await api("POST", "/api/photo/cancel"); await S.screen.newCode(); },
    async hotspot() { await api("POST", "/api/photo/cancel"); go("hotspot", {}); },
    async usb() { await api("POST", "/api/photo/cancel"); go("usbPick"); },
    async remove() {
      const ok = await confirmBox({ title: "Fotoğraf kaldırılsın mı?", text: "Baş harfe döner. Profil kaydedilince kesinleşir.", yes: "Kaldır", danger: true });
      if (!ok) return;
      S.draft.photo = null;
      S.draft.photo_url = null;
      leavePhotoFlow();
    },
  },
});

// ---------------- C2 device hotspot ----------------
register("hotspot", {
  async enter() {
    try { S.params.hs = await api("POST", "/api/hotspot/start"); } catch (e) { S.params.err = e.message; }
    if (S.name === "hotspot") document.querySelector(".screen").innerHTML = this.render(S.params);
  },
  render: (p) => `<div class="head"><div class="col" style="gap:3px"><div class="title">Önce cihazın ağına katıl</div>
      <div class="sub">Telefon ile cihaz aynı ağda değilse</div></div>
      <div class="btns"><button data-act="back" style="height:48px;padding:0 18px">Geri</button></div></div>
    <div class="row" style="gap:12px;height:382px;align-items:stretch">
      <div class="col" style="width:240px;background:#F4F6F8;border-radius:14px;align-items:center;justify-content:center;gap:10px;padding:14px">
        ${p.hs ? `<div class="qr" style="width:200px;height:200px;padding:0">${p.hs.qr}</div>` : p.err ? "" : `<div class="spinner"></div>`}
        <div style="font-size:13px;font-weight:600;color:#1C232C">Wi-Fi QR · ağa otomatik katılır</div></div>
      <div class="card col grow" style="padding:16px 20px;gap:12px"><div class="label">Cihazın kendi ağı</div>
        ${p.err ? `<div style="color:var(--orange);font-size:15px">Ağ açılamadı: ${esc(p.err)}</div>` : `
        <div class="row" style="gap:24px"><div class="col" style="gap:2px"><div style="font-size:12px;color:var(--muted)">Ağ adı</div><div style="font-size:18px;font-weight:600">${esc(p.hs?.ssid || "PT-Ekran")}</div></div>
          <div class="col" style="gap:2px"><div style="font-size:12px;color:var(--muted)">Şifre</div><div style="font-size:18px;font-weight:600;letter-spacing:.04em">${esc(p.hs?.password || "…")}</div></div></div>`}
        ${steps(["QR'ı okut, “PT-Ekran” ağına katıl", "“İnternet yok” uyarısında bağlı kal", "İleri'ye dokun, yeni QR'ı okut"])}
        <div style="font-size:13px;line-height:1.4;color:var(--orange)">Bu ağ açıkken cihaz internete çıkamaz; Garmin eşitlemesi bekler.</div>
        <div class="row" style="margin-top:auto;justify-content:flex-end"><button class="primary" data-act="next" style="height:48px;padding:0 22px;font-size:16px" ${p.hs ? "" : "disabled"}>İleri</button></div></div></div>`,
  acts: {
    async back() {
      await api("POST", "/api/hotspot/stop").catch(() => {});
      if (S.params.autoHotspot) go("profileEdit", { keep: true }); else go("photoQR");
    },
    next() { go("photoQR"); },
  },
});

// ---------------- C4 preview & confirm ----------------
register("photoPreview", {
  render: (p) => {
    const url = `/photos/${p.tmp}`;
    const face = (size, stroke) => avatar({ name: S.draft?.name, photo_url: url }, size, { ring: "#4CC07F", stroke, gap: 2 });
    return `<div class="head"><div class="col" style="gap:3px"><div class="title">Bu fotoğraf olsun mu?</div>
        <div class="sub">${esc(S.draft?.name || "Yeni profil")} · ${p.from === "usb" ? "USB bellekten" : "telefondan geldi"}</div></div></div>
      <div class="row" style="gap:12px;height:382px;align-items:stretch">
        <div class="card col" style="width:300px;align-items:center;justify-content:center;gap:12px">${face(230, 4)}
          <div class="sub">Profil ekranında böyle görünecek</div></div>
        <div class="card col grow" style="padding:16px 20px;gap:12px"><div class="label">Canlı ekranda</div>
          <div class="row" style="height:120px;border-radius:12px;background:var(--bg);justify-content:space-between;padding:0 20px">
            <div class="row" style="align-items:flex-end;gap:8px"><div class="cond" style="font-size:84px;font-weight:700;line-height:.85;color:var(--green)">135</div>${ICON.heart("#4CC07F", 26)}</div>
            ${face(92, 4)}</div>
          <div style="font-size:14px;line-height:1.45;color:var(--soft)">Eski fotoğraf “Kullan”a dokunana kadar korunur. Profil kaydedilmeden fotoğraf da kaydedilmez.</div>
          <div class="row" style="margin-top:auto;gap:8px;justify-content:flex-end">
            <button data-act="discard" style="height:48px;padding:0 18px">Vazgeç</button>
            <button data-act="again" style="height:48px;padding:0 18px">${p.from === "usb" ? "Başka fotoğraf" : "Tekrar gönder"}</button>
            <button class="primary" data-act="use" style="height:48px;padding:0 22px;font-size:16px">Kullan</button></div></div></div>`;
  },
  acts: {
    use() {
      S.draft.photo = { tmp: S.params.tmp };
      S.draft.photo_url = `/photos/${S.params.tmp}`;
      leavePhotoFlow();
    },
    discard() { leavePhotoFlow(); },
    again() { go(S.params.from === "usb" ? "usbPick" : "photoQR"); },
  },
});

// ---------------- C5 USB list ----------------
register("usbPick", {
  enter() { S.params.sel = null; this.poll(); S.params.timer = setInterval(() => this.poll(), 2000); },
  leave() { clearInterval(S.params.timer); },
  async poll() {
    const r = await api("GET", "/api/usb").catch(() => ({ mounted: false, images: [] }));
    const key = JSON.stringify(r);
    if (S.name !== "usbPick" || key === S.params.key) return;
    S.params.key = key; S.params.usb = r;
    document.querySelector(".screen").innerHTML = this.render(S.params);
  },
  render: (p) => {
    const u = p.usb;
    const body = !u ? `<div class="row muted"><div class="spinner"></div>USB aranıyor…</div>`
      : !u.mounted ? `<div class="card col grow" style="align-items:center;justify-content:center;gap:14px">${ICON.usb}
          <div class="title">USB bellek tak</div><div class="sub">Takılınca liste kendiliğinden açılır.</div></div>`
      : !u.images.length ? `<div class="card col grow" style="align-items:center;justify-content:center;gap:10px">
          <div class="title">Fotoğraf bulunamadı</div><div class="sub">USB bellekte JPG ya da PNG dosyası yok.</div></div>`
      : `<div class="thumbs grow">${u.images.map((im, i) => `<button class="thumb ${p.sel === i ? "on" : ""}" data-act="sel" data-i="${i}">
          <img src="/api/usb/thumb?path=${encodeURIComponent(im.path)}" loading="lazy" alt=""><span>${esc(im.name)}</span></button>`).join("")}</div>`;
    return `<div class="head"><div class="col" style="gap:3px"><div class="title">USB bellek</div>
        <div class="sub">${u?.mounted ? `${u.images.length} fotoğraf · JPG, PNG` : "JPG, PNG"}</div></div>
        <div class="btns"><button data-act="back" style="height:48px;padding:0 18px">Geri</button>
        <button class="primary" data-act="pick" style="height:48px;padding:0 22px" ${p.sel == null ? "disabled" : ""}>Seç</button></div></div>${body}`;
  },
  acts: {
    sel(b) {
      S.params.sel = +b.dataset.i;
      document.querySelectorAll(".thumb").forEach((t) => t.classList.toggle("on", +t.dataset.i === S.params.sel));
      document.querySelector('[data-act="pick"]').disabled = false;
    },
    pick() { go("usbCrop", { path: S.params.usb.images[S.params.sel].path }); },
    back() { go("photoQR"); },
  },
});

// ---------------- C6 crop on device ----------------
register("usbCrop", {
  render: () => `<div class="head"><div class="col" style="gap:3px"><div class="title">Kırp</div>
      <div class="sub">Parmağınla kaydır, yüzü daireye ortala</div></div>
      <div class="btns"><button data-act="back" style="height:48px;padding:0 18px">Geri</button>
      <button class="primary" data-act="ok" style="height:48px;padding:0 22px">Tamam</button></div></div>
    <div class="row" style="gap:12px;height:382px;align-items:stretch">
      <canvas id="crop" class="cropper" style="width:460px;height:382px"></canvas>
      <div class="card col grow" style="padding:16px 18px;gap:14px"><div class="label">Yakınlaştır</div>
        <div class="row" style="gap:10px"><button data-act="zoom" data-f="0.8" aria-label="Uzaklaştır" style="width:52px;height:52px;padding:0;font-size:26px">−</button>
          <div class="bar grow"><div id="zbar" style="width:0;background:var(--blue)"></div></div>
          <button data-act="zoom" data-f="1.25" aria-label="Yakınlaştır" style="width:52px;height:52px;padding:0;font-size:26px">+</button></div>
        <button data-act="rotate" style="height:52px">90° döndür</button>
        <div style="margin-top:auto;font-size:13px;line-height:1.45;color:var(--muted)">Kırpılan alan 512×512 kaydedilir. Konum ve diğer dosya bilgileri silinir.</div></div></div>`,
  async mounted() {
    const c = new Cropper(document.getElementById("crop"), { radiusRatio: 160 / 382,
      onChange: (cr) => { const z = document.getElementById("zbar"); if (z) z.style.width = `${cr.zoomFraction() * 100}%`; } });
    S.params.cropper = c;
    try { await c.load(`/api/usb/preview?path=${encodeURIComponent(S.params.path)}`); } catch { toast("Fotoğraf açılamadı"); }
  },
  acts: {
    zoom(b) { S.params.cropper.zoom(+b.dataset.f); },
    rotate() { S.params.cropper.rotate(); },
    back() { go("usbPick"); },
    async ok(b) {
      b.disabled = true;
      try {
        const r = await api("POST", "/api/photo/usb", { path: S.params.path, crop: S.params.cropper.params() });
        go("photoPreview", { tmp: r.tmp, from: "usb" });
      } finally { b.disabled = false; }
    },
  },
});
