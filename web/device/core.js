// Device UI core: live state over WebSocket, screen router, dialogs, on-screen keyboard.
export const S = { live: null, screen: null, name: null, params: {}, draft: null };
const app = () => document.getElementById("app");
const screens = {};
export const register = (name, def) => { screens[name] = def; };

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function api(method, path, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : null;
  if (!r.ok) {
    const err = new Error((data && (data.detail || data.error)) || `Hata ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// ---------- router ----------
export function go(name, params = {}) {
  const prev = S.screen;
  prev?.leave?.();
  S.name = name; S.params = params; S.screen = screens[name];
  closeOverlay();
  render();
  S.screen.enter?.(params);
}

export function render() {
  const sc = S.screen;
  if (!sc) return;
  app().innerHTML = `<div class="screen ${sc.cls || ""}">${sc.render(S.params, S.live)}</div>`;
  patchRegions(true);
  sc.mounted?.(app());
}

// Elements with data-region="x" are re-rendered from screen.regions.x(live) on every live update.
function patchRegions(force) {
  const sc = S.screen;
  if (!sc?.regions) return;
  for (const el of app().querySelectorAll("[data-region]")) {
    const fn = sc.regions[el.dataset.region];
    if (!fn) continue;
    const html = fn(S.params, S.live);
    if (force || el._html !== html) { el.innerHTML = html; el._html = html; }
  }
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const sc = S.screen;
  const fn = (el.closest(".overlay") && S.overlayActs?.[el.dataset.act]) || sc?.acts?.[el.dataset.act] || S.globalActs?.[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (err) { toast(err.message); console.error(err); }
});

// ---------- live state ----------
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws/live`);
  ws.onmessage = (m) => {
    S.live = JSON.parse(m.data);
    S.screen?.live?.(S.live);
    patchRegions(false);
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

// ---------- dialogs ----------
export function overlay(html, acts = {}) {
  closeOverlay();
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = html;
  S.overlayActs = acts;
  app().appendChild(el);
  return el;
}
export function closeOverlay() { app().querySelectorAll(".overlay").forEach((o) => o.remove()); S.overlayActs = null; }

export function confirmBox({ title, text, yes, no = "Vazgeç", danger = false }) {
  return new Promise((resolve) => {
    overlay(`<div class="dialog"><div class="title">${esc(title)}</div>${text ? `<p>${text}</p>` : ""}
      <div class="btns"><button data-act="no">${esc(no)}</button>
      <button class="${danger ? "danger" : "primary"}" data-act="yes">${esc(yes)}</button></div></div>`,
      { yes: () => { closeOverlay(); resolve(true); }, no: () => { closeOverlay(); resolve(false); } });
  });
}

let toastTimer;
export function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  app().appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

// ---------- Turkish on-screen keyboard ----------
const ROWS = [["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "Ğ", "Ü"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ş", "İ"],
  ["Z", "X", "C", "V", "B", "N", "M", "Ö", "Ç", "-"]];

export function keyboard(initial, { max = 40, label = "" } = {}) {
  return new Promise((resolve) => {
    let val = initial || "";
    let upper = !val;
    const draw = () => {
      el.innerHTML = `<div class="kb">
        <div class="field"><span class="muted">${esc(label)}</span><div class="val">${esc(val)}<span style="color:var(--green)">|</span></div>
          <button data-act="cancel">Vazgeç</button><button class="primary" data-act="ok">Tamam</button></div>
        ${ROWS.map((r) => `<div class="krow">${r.map((k) => `<button data-act="key" data-k="${k}">${upper ? k : k.toLocaleLowerCase("tr")}</button>`).join("")}</div>`).join("")}
        <div class="krow"><button data-act="shift" style="min-width:110px">${upper ? "abc" : "ABC"}</button>
          <button data-act="space" style="min-width:360px">boşluk</button>
          <button data-act="back" style="min-width:110px" aria-label="Sil">⌫</button></div></div>`;
    };
    const el = overlay("", {
      key: (b) => { if (val.length < max) { const k = b.dataset.k; val += upper ? k : k.toLocaleLowerCase("tr"); upper = false; draw(); } },
      space: () => { if (val.length < max) { val += " "; upper = true; draw(); } },
      back: () => { val = val.slice(0, -1); upper = !val || val.endsWith(" "); draw(); },
      shift: () => { upper = !upper; draw(); },
      ok: () => { closeOverlay(); resolve(val.trim()); },
      cancel: () => { closeOverlay(); resolve(null); },
    });
    el.style.alignItems = "flex-end";
    draw();
  });
}

// ---------- screen wake lock during a session ----------
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { console.warn("wake lock", e); }
}

export function start(first) {
  if (new URLSearchParams(location.search).has("dev")) document.body.classList.add("dev");
  connect();
  go(first);
}
