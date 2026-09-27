// S0 boot, S1 profiles, last-device search, S4 source, S3 home, S5 zones, S10 history,
// S6/S7/S8 live + pause + finish, S9 summary, S11 shutdown.
import { S, api, go, register, esc, confirmBox, overlay, closeOverlay, toast, keepAwake } from "./core.js";
import { avatar, fmtDur, fmtNum, fmtDate, fmtTime, zoneOf, envBlock, stepper, ICON, ZONE_COLORS, ZONE_NAMES,
  NO_SIGNAL, SOURCE_TEXT, SPORTS } from "./ui.js";

const hrStatus = (hr) => hr?.fresh ? `Bağlı${hr.battery != null ? ` · pil %${hr.battery}` : ""}`
  : hr?.connected ? "Nabız bekleniyor" : hr?.target ? "Sinyal yok · yeniden bağlanıyor" : "Bağlı değil";
const hrDot = (hr) => hr?.fresh ? "var(--green)" : hr?.target ? "var(--orange)" : "var(--dim)";

// ---------------- S0 boot ----------------
register("boot", {
  render: () => `<div class="col grow" style="align-items:center;justify-content:center;gap:18px">
    ${ICON.heart("#4CC07F", 84)}
    <div class="cond" style="font-size:56px;font-weight:700;line-height:1">PT Ekran</div>
    <div class="row muted" style="font-size:18px"><div class="spinner"></div>Hazırlanıyor…</div></div>`,
  live(l) {
    if (l.boot?.state !== "ready" || S.name !== "boot") return;
    if (l.session) go(l.session.finished ? "summary" : "live");
    else if (l.profile) go("home");
    else go("profiles");
  },
});

// ---------------- S1 profiles ----------------
register("profiles", {
  async enter() {
    S.params.list = await api("GET", "/api/profiles");
    S.params.edit = false;
    this.draw();
  },
  draw() {
    if (S.name !== "profiles") return;
    const g = document.querySelector("#pgrid");
    g.classList.toggle("scroll", (S.params.list?.length || 0) + (S.params.edit ? 1 : 2) > 4);
    g.innerHTML = this.cards();
  },
  cards() {
    const { list = [], edit } = S.params;
    const cards = list.map((p, i) => `<button class="pcard ${i === 0 && p.last_used_at ? "last" : ""}" data-act="pick" data-id="${p.id}">
        ${edit ? `<div class="edit-badge">${ICON.pencil}</div>` : ""}
        <div class="tag">${i === 0 && p.last_used_at ? "Son kullanan" : ""}</div>
        ${avatar(p, 112, { ring: i === 0 && p.last_used_at ? "#4CC07F" : "#2A313B", stroke: 4, gap: 3 })}
        <div class="nm">${esc(p.name)}</div>
        <div class="meta">${p.age} yaş · ${p.zone_source === "garmin" ? "Garmin" : SOURCE_TEXT[p.zone_source]}</div></button>`);
    if (!edit) cards.push(`<button class="pcard" data-act="guest"><div class="tag"></div>
        ${avatar({ name: "?" }, 112, { ring: "#2A313B", gap: 3 })}<div class="nm">Konuk</div>
        <div class="meta">Tek seferlik, kaydedilmez</div></button>`);
    cards.push(`<button class="pcard new" data-act="new">${ICON.plus}<div style="font-size:18px;font-weight:600">Yeni profil</div></button>`);
    return cards.join("");
  },
  render: (p) => `<div class="head"><div class="col" style="gap:2px"><div class="title">Kim antrenman yapıyor?</div>
      <div class="sub">Profile dokun, zone'lar o kişiye göre yüklenir</div></div>
      <button data-act="edit">${p.edit ? "Bitti" : "Düzenle"}</button></div>
    <div id="pgrid" class="pgrid"></div>`,
  mounted() { this.draw(); },
  acts: {
    edit(b) { S.params.edit = !S.params.edit; b.textContent = S.params.edit ? "Bitti" : "Düzenle"; S.screen.draw(); },
    async pick(b) {
      const id = +b.dataset.id;
      if (S.params.edit) return go("profileEdit", { id, from: "profiles" });
      await api("POST", `/api/profiles/${id}/select`);
      go("findSource");
    },
    async guest() { await api("POST", "/api/guest"); go("findSource"); },
    new() { go("profileEdit", { from: "profiles" }); },
  },
});

// ---------------- last device search (15 s) ----------------
register("findSource", {
  render: (_p, l) => {
    const last = l?.profile?.last_device;
    return `<div class="col grow" style="align-items:center;justify-content:center;gap:16px;text-align:center">
      <div class="spinner" style="width:48px;height:48px;border-width:5px"></div>
      <div class="title" style="font-size:36px">Nabız kaynağı aranıyor</div>
      <div style="font-size:18px;color:var(--soft)">${esc(last?.name || "")}</div>
      <div class="sub">Bandı tak ya da saatte nabız yayınını aç · en fazla 15 sn</div>
      <button data-act="list" style="margin-top:10px;height:48px;padding:0 22px">Listeden seç</button></div>`;
  },
  async enter() {
    const l = S.live;
    if (!l?.profile?.last_device && !l?.hr?.connected) return go("pair", { back: "profiles" });
    const token = (S.params.token = Math.random());
    const r = await api("POST", "/api/hr/find-last").catch(() => ({ found: false }));
    if (S.name !== "findSource" || S.params.token !== token) return;
    go(r.found ? "home" : "pair", { back: "profiles" });
  },
  acts: { list() { S.params.token = null; go("pair", { back: "profiles" }); } },
});

// ---------------- S4 heart rate source ----------------
register("pair", {
  async enter() { await this.scan(); },
  async scan() {
    S.params.devices = null;
    S.params.scanning = true;
    const list = await api("POST", "/api/hr/scan").catch(() => []);
    if (S.name !== "pair") return;
    S.params.devices = list;
    S.params.scanning = false;
  },
  render: (p) => `<div class="head"><div class="col" style="gap:2px"><div class="title">Nabız kaynağını seç</div>
      <div class="sub">Bluetooth ile yayın yapan cihazlar aranıyor</div></div>
      <div class="btns"><button data-act="back">Geri</button><button data-act="rescan">${ICON.refresh}Yeniden tara</button></div></div>
    <div class="list" style="height:236px" data-region="list"></div>
    <div class="row" style="flex-grow:1;gap:12px;align-items:stretch">
      <div class="card grow col" style="padding:14px 18px;gap:6px"><div class="label">Saatin listede yok mu?</div>
        <div style="font-size:15px;line-height:1.45;color:var(--soft)">Saatinde nabız yayınını (heart rate broadcast) aç, ekranı açık tut ve yeniden tara.</div></div>
      <div class="card col" style="width:250px;padding:14px 18px;gap:6px" data-region="env"></div></div>`,
  regions: {
    list(p, l) {
      if (!p.devices) return `<div class="row muted" style="height:72px;justify-content:center;font-size:16px"><div class="spinner"></div>Taranıyor…</div>`;
      if (!p.devices.length) return `<div class="card col" style="height:120px;align-items:center;justify-content:center;gap:6px">
        <div style="font-size:18px;font-weight:600">Cihaz bulunamadı</div><div class="sub">Bandı ıslat ve tak ya da saatte nabız yayınını aç, sonra yeniden tara.</div></div>`;
      const cur = l?.hr?.target?.address;
      return p.devices.map((d, i) => {
        const on = d.address === cur && l.hr.connected;
        const color = i === 0 || on ? "var(--green)" : "var(--muted)";
        const busy = p.connecting === d.address;
        return `<div class="item ${i === 0 || on ? "pick" : ""}">${d.kind === "chest" ? ICON.strap(color) : ICON.watch(color)}
          <div class="grow col" style="gap:2px"><div class="nm">${esc(d.name)}</div>
            <div class="sub">${d.kind === "chest" ? "Göğüs bandı" : "Saat / diğer"} · ${esc(d.signal)}${on && l.hr.hr ? ` · ${l.hr.hr} bpm` : ""}</div></div>
          ${i === 0 && !on ? `<div style="font-size:14px;font-weight:600;color:var(--green)">Önerilen</div>` : ""}
          ${on ? `<div style="font-size:14px;font-weight:600;color:var(--green)">Bağlı</div>`
            : `<button class="${i === 0 ? "primary" : ""}" data-act="connect" data-i="${i}" ${p.connecting ? "disabled" : ""}>${busy ? `<div class="spinner" style="width:18px;height:18px"></div>` : "Bağlan"}</button>`}</div>`;
      }).join("");
    },
    env: (_p, l) => `<div class="label">Ortam sensörü</div>
      <div class="row" style="gap:8px"><div class="dot" style="background:${l?.env?.ok ? "var(--green)" : "var(--orange)"}"></div>
      <div style="font-size:16px;font-weight:600">${l?.env?.ok ? "Sensör hazır" : "Sensör bulunamadı"}</div></div>
      <div class="sub">${l?.env?.temp != null ? `${fmtNum(l.env.temp)} °C · %${Math.round(l.env.hum)} nem` : "Ölçüm yok"}</div>`,
  },
  acts: {
    back() { go(S.params.back === "profiles" ? "profiles" : "home"); },
    async rescan() { await S.screen.scan(); },
    async connect(b) {
      const d = S.params.devices[+b.dataset.i];
      S.params.connecting = d.address;
      try {
        const r = await api("POST", "/api/hr/connect", { address: d.address, name: d.name });
        if (!r.ok) return toast(`${d.name} bağlanamadı. Yakında ve açık olduğundan emin ol.`);
        go("home");
      } finally { S.params.connecting = null; }
    },
  },
});

// ---------------- S3 home (draft: no mockup in the design) ----------------
register("home", {
  render: (_p, l) => {
    const p = l?.profile;
    if (!p) { setTimeout(() => go("profiles")); return ""; }
    return `<div class="head"><div class="row" style="gap:12px">${avatar(p, 48, { ring: "#4CC07F", stroke: 3, gap: 2 })}
        <div class="col" style="gap:2px"><div class="title">${esc(p.name)}</div>
        <div class="sub">${p.guest ? "Konuk · kaydedilmez · " : ""}${p.zone_source === "garmin" ? "Garmin zone'ları" : SOURCE_TEXT[p.zone_source]} · maks. ${p.zones.max} bpm</div></div></div>
      <div class="row" style="gap:18px"><div class="row" style="gap:18px" data-region="env"></div>
        <button class="danger" data-act="off">${ICON.power}Kapat</button></div></div>
    <div class="row" style="gap:12px;height:382px;align-items:stretch">
      <div class="card grow col" style="padding:14px 20px;gap:10px" data-region="source"></div>
      <div class="col" style="width:300px;gap:12px">
        <button class="primary" data-act="start" style="height:150px;border-radius:16px;font-size:26px;flex-direction:column;gap:10px">${ICON.play.replace('width="22" height="22"', 'width="44" height="44"')}Antrenmana başla</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;flex-grow:1">
          <button data-act="source" style="height:auto">Kaynak<br>değiştir</button>
          <button data-act="profiles" style="height:auto">Profil<br>değiştir</button>
          <button data-act="zones" style="height:auto">Zone<br>ayarları</button>
          <button data-act="history" style="height:auto" ${p.guest ? "disabled" : ""}>Geçmiş<br>seanslar</button>
        </div></div></div>`;
  },
  regions: {
    env: (_p, l) => envBlock(l?.env),
    source(_p, l) {
      const hr = l?.hr, z = l?.profile?.zones;
      const zone = zoneOf(hr?.hr, z?.floors);
      const color = hr?.fresh ? (zone ? ZONE_COLORS[zone - 1] : "#A8B0BA") : NO_SIGNAL;
      const bar = z.zones.map((zz, i) => `<div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div style="height:10px;border-radius:5px;background:${zz.color};opacity:${zone === i + 1 ? 1 : 0.35}"></div>
          <div class="row" style="gap:6px;align-items:baseline"><span class="cond" style="font-size:20px;font-weight:700;color:${zz.color}">Z${zz.n}</span>
          <span class="cond" style="font-size:17px;font-weight:600;color:var(--muted)">${zz.lo}–${zz.hi}</span></div></div>`).join("");
      return `<div class="label">Nabız kaynağı</div>
        <div class="row" style="gap:10px"><div class="dot" style="background:${hrDot(hr)}"></div>
          <div style="font-size:18px;font-weight:600">${esc(hr?.target?.name || "Kaynak seçilmedi")}</div>
          <div class="sub">${hrStatus(hr)}</div></div>
        <div class="row grow" style="gap:14px;align-items:center">
          <div class="cond" style="font-size:132px;font-weight:700;line-height:.85;color:${color};font-variant-numeric:tabular-nums">${hr?.hr ?? "––"}</div>
          <div class="col" style="gap:6px">${ICON.heart(color, 40)}<div class="cond muted" style="font-size:26px;font-weight:600">bpm</div></div>
          <div class="col grow" style="align-items:flex-end;gap:4px">
            <div class="cond" style="font-size:44px;font-weight:700;color:${color}">${zone ? `ZONE ${zone}` : hr?.fresh ? "ZONE DIŞI" : ""}</div>
            <div style="font-size:18px;font-weight:600">${zone ? ZONE_NAMES[zone - 1] : ""}</div></div></div>
        <div class="row" style="gap:8px;align-items:stretch">${bar}</div>`;
    },
  },
  acts: {
    async start() {
      if (!S.live?.hr?.connected) {
        const ok = await confirmBox({ title: "Nabız kaynağı yok", text: "Kaynak bağlanmadan başlarsan süre, nabız gelene kadar işlemez.", yes: "Yine de başla", no: "Kaynak seç" });
        if (!ok) return go("pair", { back: "home" });
      }
      await api("POST", "/api/session/start");
      go("live");
    },
    source() { go("pair", { back: "home" }); },
    profiles() { go("profiles"); },
    zones() { go("zones"); },
    history() { go("history"); },
    off() { shutdownFlow(); },
  },
});

// ---------------- S5 zone settings ----------------
function zonesFor(d) {
  const B = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  let floors;
  if (d.zone_source === "garmin" && d.gz) floors = [...d.gz.floors, d.gz.max_hr];
  else if (d.zone_source === "manual" && d.zone_method === "hrr") floors = B.map((b) => Math.round(d.rest_hr + (d.max_hr - d.rest_hr) * b));
  else if (d.zone_source === "manual") floors = B.map((b) => Math.round(d.max_hr * b));
  else floors = B.map((b) => Math.round(Math.round(208 - 0.7 * d.age) * b));
  return floors;
}

register("zones", {
  enter() {
    const p = S.live.profile;
    const gzAll = p.garmin_zones || {};
    S.params.d = {
      age: p.age, zone_source: p.zone_source, zone_method: p.zone_method || "max",
      max_hr: p.max_hr || p.tanaka_max, rest_hr: p.rest_hr || 60, garmin_sport: p.garmin_sport || "DEFAULT", gzAll,
    };
    S.params.taps = [];
    this.redraw();
  },
  redraw() {
    const d = S.params.d;
    d.gz = d.gzAll[d.garmin_sport] || d.gzAll.DEFAULT || Object.values(d.gzAll)[0] || null;
    if (S.name === "zones") document.querySelector(".screen").innerHTML = this.body(S.live.profile, d);
  },
  render: () => "",
  body(p, d) {
    const src = d.zone_source, isManual = src === "manual", isGarmin = src === "garmin";
    const floors = zonesFor(d);
    const max = isGarmin && d.gz ? d.gz.max_hr : isManual ? d.max_hr : Math.round(208 - 0.7 * d.age);
    const rest = isGarmin && d.gz?.rest_hr ? d.gz.rest_hr : d.rest_hr;
    const tag = isGarmin ? "GARMIN" : "PROFİL";
    const segBtn = (k, v, label) => `<button data-act="set" data-k="${k}" data-v="${v}" style="height:${k === "zone_source" ? 48 : 44}px;border-radius:10px;border:2px solid ${d[k] === v ? "var(--green)" : "var(--line)"};background:var(--bg);font-size:13px;padding:0 ${k === "zone_source" ? 0 : 12}px">${label}</button>`;
    const valRow = (label, key, val) => `<div class="row" style="height:52px;justify-content:space-between;gap:8px">
        <div style="font-size:14px;font-weight:600;color:var(--muted);width:86px">${label}</div>
        ${isManual ? stepper(key, val) : `<div class="cond" style="font-size:42px;font-weight:700;line-height:1">${val ?? "–"}</div>
        <div style="font-size:12px;font-weight:600;color:var(--blue);border:1px solid #2A4A68;border-radius:6px;padding:4px 8px">${tag}</div>`}</div>`;
    let srcInfo;
    if (src === "age") srcInfo = `<div class="col" style="height:44px;justify-content:center;gap:2px"><div style="font-size:14px;font-weight:600">Profildeki yaş: ${d.age}</div><div style="font-size:13px;color:var(--muted)">Maks. = 208 − 0,7 × yaş (Tanaka)</div></div>`;
    else if (isGarmin) {
      const st = p.garmin_status;
      const ok = p.garmin_synced_at && st?.ok !== false;
      srcInfo = p.guest || !p.garmin_login
        ? `<div style="font-size:13px;line-height:1.4;color:var(--orange)">${p.guest ? "Konuk için Garmin kullanılamaz." : `Garmin girişi yok. Pi'de bir kez: <b>python -m app.garmin --profile ${p.id}</b>`}</div>`
        : `<div class="row" style="justify-content:space-between;gap:10px"><div class="col" style="gap:2px">
            <div class="row" style="gap:8px"><div class="dot" style="width:9px;height:9px;background:${ok ? "var(--green)" : "var(--orange)"}"></div>
            <div style="font-size:14px;font-weight:600">${ok ? "Eşitlendi" : st?.ok === false ? "Eşitlenemedi" : "Eşitlenmedi"}</div></div>
            <div style="font-size:13px;color:var(--muted)">${p.garmin_synced_at ? `${fmtDate(p.garmin_synced_at)} ${fmtTime(p.garmin_synced_at)}` : "–"} ·
              <button data-act="sport" style="height:28px;padding:0 8px;font-size:13px;display:inline-flex">profil: ${esc(SPORTS[d.garmin_sport] || d.garmin_sport)}</button></div></div>
            <button data-act="sync" style="padding:0 14px;font-size:14px">Eşitle</button></div>`;
    } else srcInfo = `<div style="height:44px;display:flex;align-items:center;font-size:14px;color:var(--muted)">Değerleri aşağıdan elle gir.</div>`;
    const garminEmpty = isGarmin && !d.gz;
    return `<div class="head"><div class="row" style="align-items:baseline;gap:10px"><div class="title" data-act="secret">Zone ayarları</div>
        <div style="font-size:16px;color:var(--muted)">${esc(p.name)}</div></div>
        <div class="btns"><button data-act="back">Geri</button><button class="primary" data-act="save" style="padding:0 22px;font-size:16px">Kaydet</button></div></div>
      <div class="row" style="gap:12px;height:382px;align-items:stretch">
        <div class="col" style="width:300px;gap:12px">
          <div class="card col" style="padding:14px 16px;gap:10px"><div class="label">Kaynak</div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
              ${segBtn("zone_source", "age", "Yaşa göre")}${segBtn("zone_source", "garmin", "Garmin")}${segBtn("zone_source", "manual", "Elle")}</div>${srcInfo}</div>
          <div class="card col grow" style="padding:12px 16px;justify-content:center;gap:10px">
            ${valRow("Maks. nabız", "max_hr", max)}${valRow("Dinlenik nabız", "rest_hr", rest)}</div></div>
        <div class="card col grow" style="padding:14px 18px;gap:8px">
          <div class="row" style="height:44px;justify-content:space-between"><div class="label">Zone'lar</div>
            ${isManual ? `<div class="row" style="gap:6px">${segBtn("zone_method", "max", "% Maks.")}${segBtn("zone_method", "hrr", "Nabız rezervi")}</div>`
              : `<div style="font-size:13px;color:var(--muted)">${isGarmin ? "Garmin Connect'ten, saatinle aynı" : "Yaştan hesaplanan maks. nabza göre"}</div>`}</div>
          ${garminEmpty ? `<div class="grow col" style="justify-content:center;align-items:center;text-align:center;color:var(--muted);font-size:15px;gap:6px">Henüz Garmin zone'u yok.<br>Eşitlenene kadar yaşa göre zone'lar kullanılır.</div>`
            : ZONE_COLORS.map((c, i) => `<div class="row" style="height:52px;border-radius:10px;background:var(--bg);gap:14px;padding:0 14px">
              <div style="width:6px;height:32px;border-radius:3px;background:${c}"></div>
              <div class="cond" style="width:44px;font-size:26px;font-weight:700;color:${c}">Z${i + 1}</div>
              <div class="grow" style="font-size:16px;font-weight:500">${ZONE_NAMES[i]}</div>
              <div class="sub">%${[50, 60, 70, 80, 90][i]}–${[60, 70, 80, 90, 100][i]}</div>
              <div class="cond" style="width:104px;text-align:right;font-size:26px;font-weight:600;font-variant-numeric:tabular-nums">${floors[i]}–${floors[i + 1]}</div></div>`).join("")}
        </div></div>`;
  },
  acts: {
    set(b) { S.params.d[b.dataset.k] = b.dataset.v; S.screen.redraw(); },
    step(b) {
      const d = S.params.d, k = b.dataset.k, v = d[k] + +b.dataset.d;
      if (k === "max_hr") d.max_hr = Math.max(Math.max(100, d.rest_hr + 20), Math.min(230, v));
      else d.rest_hr = Math.max(30, Math.min(d.max_hr - 20, v));
      S.screen.redraw();
    },
    sport() {
      const d = S.params.d, keys = Object.keys(d.gzAll);
      if (keys.length < 2) return toast("Garmin'de tek zone profili var");
      d.garmin_sport = keys[(keys.indexOf(d.garmin_sport) + 1) % keys.length];
      S.screen.redraw();
    },
    async sync(b) {
      b.disabled = true; b.textContent = "…";
      try {
        const p = await api("POST", `/api/profiles/${S.live.profile.id}/garmin-sync`);
        S.params.d.gzAll = p.garmin_zones || {};
        toast("Garmin zone'ları eşitlendi");
      } catch (e) { toast(`Garmin: ${e.message}`); }
      S.screen.redraw();
    },
    back() { go("home"); },
    async save() {
      const p = S.live.profile, d = S.params.d;
      const body = { zone_source: d.zone_source, zone_method: d.zone_method, max_hr: d.max_hr, rest_hr: d.rest_hr, garmin_sport: d.garmin_sport };
      await api("PUT", p.guest ? "/api/guest" : `/api/profiles/${p.id}`, body);
      go("home");
    },
    secret() {
      const now = Date.now(), t = S.params.taps.filter((x) => now - x < 3000);
      t.push(now); S.params.taps = t;
      if (t.length >= 5) { S.params.taps = []; calibration(); }
    },
  },
});

// Hidden sensor calibration (docs/hardware.md): tap the "Zone ayarları" title 5 times.
async function calibration() {
  let c = await api("GET", "/api/calibration");
  const draw = () => {
    el.querySelector(".dialog").innerHTML = `<div class="title">Sensör kalibrasyonu</div>
      <p>Referans termometreyle 15 dk karşılaştır, farkı ofset olarak gir.</p>
      <div class="row" style="justify-content:space-between"><div class="col"><b>Sıcaklık ofseti</b><span class="sub">Ham ${fmtNum(c.raw_temp, 2)} °C → ${fmtNum(c.temp)} °C</span></div>
        ${stepper("temp_offset_c", fmtNum(c.temp_offset_c), "°C")}</div>
      <div class="row" style="justify-content:space-between"><div class="col"><b>Nem ofseti</b><span class="sub">Ham %${fmtNum(c.raw_hum)} → %${c.hum ?? "–"}</span></div>
        ${stepper("humidity_offset_pct", fmtNum(c.humidity_offset_pct, 0), "%")}</div>
      <div class="btns"><button class="primary" data-act="close">Tamam</button></div>`;
  };
  const el = overlay(`<div class="dialog" style="width:600px"></div>`, {
    async step(b) {
      const k = b.dataset.k, stepv = k === "temp_offset_c" ? 0.5 : 1;
      c = await api("PUT", "/api/calibration", { [k]: Math.round((c[k] + stepv * +b.dataset.d) * 10) / 10 });
      draw();
    },
    close() { closeOverlay(); },
  });
  draw();
}

// ---------------- S10 history ----------------
register("history", {
  async enter() {
    S.params.items = await api("GET", `/api/profiles/${S.live.profile.id}/sessions`);
    if (S.name === "history") document.querySelector("#hist").innerHTML = this.rows();
  },
  rows() {
    const items = S.params.items || [];
    if (!items.length) return `<div class="card col" style="height:200px;align-items:center;justify-content:center;gap:6px">
      <div style="font-size:18px;font-weight:600">Henüz kayıtlı seans yok</div><div class="sub">Antrenman bitince “Kaydet” ile buraya eklenir.</div></div>`;
    return items.map((s) => {
      const tot = s.zone_s.reduce((a, b) => a + b, 0) || 1;
      return `<button class="item" data-act="open" data-id="${s.id}" style="height:72px;width:100%;justify-content:flex-start;text-align:left;border-radius:14px">
        <div class="col" style="width:190px;gap:2px;align-items:flex-start"><div style="font-size:17px;font-weight:600">${fmtDate(s.started_at)}</div>
          <div class="sub" style="font-weight:400">${fmtTime(s.started_at)}${s.status === "interrupted" ? ` · <span style="color:var(--orange)">yarım kaldı</span>` : ""}</div></div>
        <div class="cond" style="width:110px;font-size:30px;font-weight:700">${fmtDur(s.duration_s)}</div>
        <div class="col" style="width:110px;gap:0;align-items:flex-start"><span class="sub" style="font-weight:400">Ort. / tepe</span><span class="cond" style="font-size:24px">${s.avg_hr ?? "–"} / ${s.peak_hr ?? "–"}</span></div>
        <div class="grow" style="height:14px;border-radius:5px;overflow:hidden;display:flex;gap:2px">
          ${s.zone_s.map((v, i) => v ? `<div style="height:14px;width:${(v / tot) * 100}%;background:${ZONE_COLORS[i]}"></div>` : "").join("")}</div></button>`;
    }).join("");
  },
  render: (_p, l) => `<div class="head"><div class="col" style="gap:2px"><div class="title">Geçmiş seanslar</div>
      <div class="sub">${esc(l?.profile?.name)}</div></div><button data-act="back">Geri</button></div>
    <div id="hist" class="list" style="flex-grow:1"><div class="row muted"><div class="spinner"></div>Yükleniyor…</div></div>`,
  acts: {
    back() { go("home"); },
    async open(b) { go("summary", { readonly: true, data: await api("GET", `/api/sessions/${b.dataset.id}`) }); },
  },
});

// ---------------- S6 live + S7 pause + S8 finish confirm ----------------
register("live", {
  cls: "live",
  enter() { keepAwake(true); },
  leave() { keepAwake(false); },
  render: () => `
    <div class="head" style="height:44px">
      <div class="row" style="gap:10px"><div class="dot" id="lk-dot"></div><div style="font-size:16px;font-weight:500" id="lk-name"></div>
        <div class="sub" id="lk-text"></div></div>
      <div class="row" style="gap:18px"><div class="row" style="gap:18px" id="env"></div>
        <button aria-label="Duraklat" data-act="pause" style="width:48px;padding:0">${ICON.pause}</button>
        <button data-act="finish">Bitir</button></div></div>
    <div class="row" style="gap:12px;height:246px;align-items:stretch">
      <div class="card grow row" style="border-radius:16px;padding:14px 18px 14px 22px;gap:12px;align-items:stretch">
        <div class="col grow" style="justify-content:space-between">
          <div class="label" style="font-size:14px">Nabız</div>
          <div class="row" style="align-items:flex-end;gap:8px">
            <div class="cond" id="hr" style="font-size:160px;font-weight:700;line-height:.85;font-variant-numeric:tabular-nums">––</div>
            <div class="col" style="align-items:center;gap:6px;padding-bottom:4px">${ICON.heart("#6B7480", 42, "heart")}
              <div class="cond muted" style="font-size:28px;font-weight:600;line-height:1">bpm</div></div></div>
          <div class="row" style="gap:16px;font-size:14px;color:var(--soft)">
            <div><b id="pct" style="color:var(--text)">%–</b> maks.</div><div>Ort. <b id="avg" style="color:var(--text)">–</b></div>
            <div>Tepe <b id="peak" style="color:var(--text)">–</b></div></div></div>
        <div class="col" style="width:112px;align-items:center;justify-content:center;gap:6px">
          <div id="av"></div><div style="font-size:16px;font-weight:600;max-width:112px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="pname"></div></div></div>
      <div class="col" style="width:290px;gap:12px">
        <div class="card col grow" id="zcard" style="border-radius:16px;border-top:6px solid;padding:12px 20px;justify-content:center;gap:2px">
          <div class="cond" id="zt" style="font-size:58px;font-weight:700;line-height:1"></div>
          <div id="zn" style="font-size:22px;font-weight:600"></div><div id="zr" class="sub" style="font-size:15px"></div></div>
        <div class="card col" style="height:88px;border-radius:16px;padding:10px 20px;justify-content:center">
          <div class="label">Süre</div><div class="cond" id="dur" style="font-size:50px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums">00:00</div></div></div></div>
    <div id="zones" style="flex-grow:1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px"></div>
    <div class="banner" id="banner" style="display:none">${ICON.warn}<div id="btext"></div></div>`,
  mounted() {
    S.params.avatarKey = null;
    document.getElementById("zones").innerHTML = ZONE_COLORS.map((c, i) => `<div class="zonebox" id="zb${i}">
      <div class="row" style="justify-content:space-between;align-items:baseline"><div class="cond" style="font-size:22px;font-weight:700;color:${c}">Z${i + 1}</div>
      <div style="font-size:12px;color:var(--muted)">${ZONE_NAMES[i]}</div></div>
      <div class="bar"><div id="zbar${i}" style="width:0;background:${c}"></div></div>
      <div class="cond" id="ztime${i}" style="font-size:30px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums">00:00</div></div>`).join("");
    if (S.live) this.live(S.live);
  },
  live(l) {
    if (S.name !== "live") return;
    const s = l.session;
    if (!s) return go("home");
    if (s.finished) return go("summary");
    const $ = (id) => document.getElementById(id);
    const hr = l.hr, p = l.profile, z = p.zones;
    const zone = zoneOf(hr.hr, z.floors);
    const lost = !hr.fresh;
    const color = lost ? NO_SIGNAL : zone ? ZONE_COLORS[zone - 1] : "#A8B0BA";
    $("lk-dot").style.background = hrDot(hr);
    $("lk-name").textContent = hr.target?.name || "Kaynak yok";
    $("lk-text").textContent = hrStatus(hr);
    $("env").innerHTML = envBlock(l.env);
    $("hr").textContent = lost ? (hr.last_hr ?? "––") : hr.hr;
    $("hr").style.color = color;
    const heart = $("heart");
    heart.querySelector("path").setAttribute("fill", color);
    heart.style.animation = lost || s.paused ? "none" : `hb ${(60 / hr.hr).toFixed(2)}s ease-in-out infinite`;
    const frac = hr.hr ? hr.hr / z.max : 0;
    $("pct").textContent = hr.hr ? `%${Math.round(frac * 100)}` : "%–";
    $("avg").textContent = s.avg_hr ?? "–";
    $("peak").textContent = s.peak_hr ?? "–";
    const key = `${p.photo_url}|${color}|${Math.round(frac * 50)}`;
    if (S.params.avatarKey !== key) {
      S.params.avatarKey = key;
      $("av").innerHTML = avatar(p, 108, { ring: color, frac: lost ? 0 : frac, stroke: 6, gap: 2 });
    }
    $("pname").textContent = p.name;
    $("zcard").style.borderTopColor = color;
    $("zt").style.color = color;
    // Signal lost: keep the last zone in grey (design/Main.dc.html, lost=true)
    const shown = lost ? zoneOf(hr.last_hr, z.floors) : zone;
    $("zt").textContent = shown ? `ZONE ${shown}` : hr.last_hr || !lost ? "ZONE DIŞI" : "ZONE –";
    $("zn").textContent = shown ? ZONE_NAMES[shown - 1] : hr.last_hr || !lost ? "Isınma altı" : "Nabız bekleniyor";
    $("zr").textContent = shown ? `${z.floors[shown - 1]}–${z.floors[shown]} bpm` : hr.last_hr || !lost ? `${z.floors[0]} bpm altı` : "";
    $("dur").textContent = fmtDur(s.duration_s);
    const maxT = Math.max(1, ...s.zone_s);
    s.zone_s.forEach((t, i) => {
      $(`zb${i}`).style.borderColor = zone === i + 1 && !lost ? ZONE_COLORS[i] : "var(--card)";
      $(`zbar${i}`).style.width = `${(t / maxT) * 100}%`;
      $(`ztime${i}`).textContent = fmtDur(t);
    });
    const banner = $("banner");
    const showLost = lost && !s.paused && (hr.target || hr.last_hr);
    banner.style.display = showLost ? "flex" : "none";
    if (showLost) $("btext").textContent = hr.since_s != null
      ? `Nabız sinyali kesildi · son değer ${hr.since_s} sn önce · yeniden bağlanıyor`
      : "Nabız bekleniyor · bant takılı ve ıslak mı?";
    this.pauseOverlay(s.paused);
  },
  pauseOverlay(paused) {
    const el = document.querySelector(".overlay.pause");
    if (paused && !el && !document.querySelector(".overlay")) {
      const o = overlay(`<div class="dialog" style="align-items:center;text-align:center">
        <div class="title" style="font-size:44px">Duraklatıldı</div>
        <p>Süre durdu, zone'lara yazılmıyor.</p>
        <div class="btns" style="justify-content:center"><button data-act="finish">Bitir</button>
        <button class="primary" data-act="resume" style="padding:0 34px">Devam</button></div></div>`, {
        async resume() { await api("POST", "/api/session/resume"); closeOverlay(); },
        finish() { closeOverlay(); finishFlow(); },
      });
      o.classList.add("pause");
    } else if (!paused && el) el.remove();
  },
  acts: {
    async pause() { await api("POST", "/api/session/pause"); },
    finish() { finishFlow(); },
  },
});

async function finishFlow() {
  const ok = await confirmBox({ title: "Antrenmanı bitir?", text: "Süre durur ve seans özetine geçilir.", yes: "Evet, bitir" });
  if (!ok) { if (S.live?.session?.paused) S.screen.pauseOverlay?.(true); return; }
  await api("POST", "/api/session/finish");
  go("summary");
}

// ---------------- S9 summary ----------------
register("summary", {
  render: (p, l) => {
    const s = p.readonly ? p.data : l?.session;
    const prof = l?.profile;
    if (!s) { setTimeout(() => go("home")); return ""; }
    const tot = s.zone_s.reduce((a, b) => a + b, 0) + (s.out_zone_s || 0);
    const pct = (v) => (tot ? Math.round((v / tot) * 100) : 0);
    const maxZ = Math.max(1, ...s.zone_s);
    const card = (label, val, color = "") => `<div class="card col" style="padding:12px 16px;gap:4px"><div class="label" style="font-size:12px">${label}</div>
      <div class="cond" style="font-size:40px;font-weight:700;line-height:1;${color ? `color:${color}` : ""}">${val}</div></div>`;
    return `<div class="head"><div class="row" style="gap:12px">${avatar(prof, 48, { ring: "#4CC07F", stroke: 3, gap: 2 })}
        <div class="col" style="gap:2px"><div class="title">${esc(prof?.name)} · Seans özeti</div>
        <div class="sub">${fmtDate(s.started_at)} · ${fmtTime(s.started_at)}${s.source ? ` · ${esc(s.source)}` : ""}${s.status === "interrupted" ? " · yarım kaldı" : ""}</div></div></div>
        <div class="btns">${p.readonly ? `<button data-act="back">Geri</button>` : `<button class="danger" data-act="off">Kapat</button>
          <button data-act="again">Yeni seans</button><button class="primary" data-act="save" style="padding:0 18px">Kaydet</button>`}</div></div>
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px">
        ${card("Süre", fmtDur(s.duration_s))}${card("Ort. nabız", s.avg_hr ?? "–")}${card("En yüksek", s.peak_hr ?? "–", "var(--red)")}
        ${card("Ort. sıcaklık", s.avg_temp != null ? `${fmtNum(s.avg_temp)}°` : "–")}${card("Ort. nem", s.avg_hum != null ? `%${Math.round(s.avg_hum)}` : "–")}</div>
      <div class="card col grow" style="padding:14px 18px;gap:10px">
        <div class="row" style="justify-content:space-between"><div class="label">Zone'larda geçen süre</div>
          ${s.out_zone_s ? `<div class="sub">Zone dışı (%50 altı): ${fmtDur(s.out_zone_s)}</div>` : ""}</div>
        <div style="height:22px;border-radius:6px;overflow:hidden;display:flex;gap:2px;background:var(--track)">
          ${s.zone_s.map((v, i) => v ? `<div style="height:22px;width:${pct(v)}%;background:${ZONE_COLORS[i]}"></div>` : "").join("")}</div>
        <div class="col" style="gap:6px">${s.zone_s.map((v, i) => `<div class="row" style="height:28px;gap:12px">
          <div class="cond" style="width:34px;font-size:22px;font-weight:700;color:${ZONE_COLORS[i]}">Z${i + 1}</div>
          <div style="width:90px;font-size:15px">${ZONE_NAMES[i]}</div>
          <div class="bar grow"><div style="width:${(v / maxZ) * 100}%;background:${ZONE_COLORS[i]}"></div></div>
          <div class="cond" style="width:74px;text-align:right;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums">${fmtDur(v)}</div>
          <div class="sub" style="width:44px;text-align:right">%${pct(v)}</div></div>`).join("")}</div></div>`;
  },
  acts: {
    back() { go("history"); },
    async save() {
      const r = await api("POST", "/api/session/save");
      toast(r.id ? "Seans kaydedildi" : S.live?.profile?.guest ? "Konuk seansı kaydedilmez" : "Boş seans kaydedilmedi");
      go("home");
    },
    async again() {
      await api("POST", "/api/session/save");
      await api("POST", "/api/session/start");
      go("live");
    },
    off() { shutdownFlow(); },
  },
});

// ---------------- S11 shutdown ----------------
async function shutdownFlow() {
  const sess = S.live?.session;
  const ok = await confirmBox({
    title: "Cihaz kapatılsın mı?",
    text: sess ? "Açık seans kaydedilir, sonra cihaz güvenle kapanır." : "Cihaz güvenle kapanır. Ekran karardıktan sonra fişi çekebilirsin.",
    yes: "Kapat", danger: true,
  });
  if (!ok) return;
  await api("POST", "/api/system/shutdown");
  go("off");
}

register("off", {
  render: () => `<div class="col grow" style="align-items:center;justify-content:center;gap:16px;text-align:center">
    <div class="spinner" style="width:44px;height:44px;border-width:5px"></div>
    <div class="title" style="font-size:44px">Kapanıyor…</div>
    <div style="font-size:18px;color:var(--soft)" id="offtext">Veriler kaydediliyor, fişi henüz çekme.</div></div>`,
  enter() {
    setTimeout(() => {
      const t = document.getElementById("offtext");
      if (t) { t.textContent = "Ekran karardıktan sonra fişi çekebilirsin."; document.querySelector(".spinner")?.remove(); }
    }, 6000);
  },
  live() {},
});
