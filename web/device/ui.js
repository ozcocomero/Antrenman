// Small render helpers shared by device screens (tokens from docs/design-tokens.md).
import { esc } from "./core.js";

export const ZONE_COLORS = ["#A8B0BA", "#5AA0E0", "#4CC07F", "#F59A3C", "#F0605A"];
export const ZONE_NAMES = ["Isınma", "Kolay", "Aerobik", "Eşik", "Maksimum"];
export const NO_SIGNAL = "#6B7480";

export const initial = (name) => (String(name || "?").trim()[0] || "?").toLocaleUpperCase("tr");

// Circular avatar: photo or initial, with an optional ring (colour + fill fraction).
export function avatar(p, size, { ring = null, frac = 1, stroke = 4, gap = 4, id = "" } = {}) {
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const inner = size - 2 * (stroke + gap);
  const face = p?.photo_url
    ? `<img src="${esc(p.photo_url)}" alt="">`
    : `<span style="font-size:${Math.round(inner * 0.42)}px">${esc(initial(p?.name))}</span>`;
  const ringSvg = ring ? `<svg width="${size}" height="${size}" style="position:absolute;inset:0">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#232A33" stroke-width="${stroke}"/>
      <circle ${id ? `id="${id}"` : ""} cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${ring}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${(c * Math.max(0, Math.min(1, frac))).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>` : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0">${ringSvg}
    <div class="avatar" style="position:absolute;left:${stroke + gap}px;top:${stroke + gap}px;width:${inner}px;height:${inner}px">${face}</div></div>`;
}

export function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const fmtNum = (v, digits = 1) => (v == null ? "–" : Number(v).toLocaleString("tr-TR", { maximumFractionDigits: digits, minimumFractionDigits: digits }));

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
export function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export const fmtTime = (ts) => { const d = new Date(ts * 1000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function zoneOf(hr, floors) {
  if (hr == null || !floors) return null;
  if (hr < floors[0]) return 0;
  for (let z = 5; z >= 1; z--) if (hr >= floors[z - 1]) return z;
  return 0;
}

export const SOURCE_TEXT = { age: "Yaşa göre zone", garmin: "Garmin", manual: "Elle ayarlı zone" };
export const SPORTS = { DEFAULT: "Genel", RUNNING: "Koşu", CYCLING: "Bisiklet", SWIMMING: "Yüzme", STRENGTH_TRAINING: "Kuvvet", CARDIO_TRAINING: "Kardiyo", FITNESS_EQUIPMENT: "Fitness" };

export const ICON = {
  temp: `<svg class="ic" width="20" height="20" viewBox="0 0 24 24" style="color:var(--muted)"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>`,
  drop: `<svg class="ic" width="20" height="20" viewBox="0 0 24 24" style="color:var(--muted)"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  pause: `<svg class="ic" width="20" height="20" viewBox="0 0 24 24" style="stroke-width:2.2"><line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/></svg>`,
  play: `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>`,
  heart: (color, size = 42, id = "") => `<svg ${id ? `id="${id}"` : ""} viewBox="0 0 24 24" style="width:${size}px;height:${size}px;transform-origin:50% 55%"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 2.8 4.5 6.4 4.1c2.1-.2 3.9 1 5.6 3 1.7-2 3.5-3.2 5.6-3 3.6.4 5.5 4.2 4 7.6C19.5 16.4 12 21 12 21z" fill="${color}"/></svg>`,
  warn: `<svg class="ic" width="22" height="22" viewBox="0 0 24 24" style="color:var(--orange)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  refresh: `<svg class="ic" width="18" height="18" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  strap: (c) => `<svg class="ic" width="30" height="30" viewBox="0 0 24 24" style="color:${c}"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  watch: (c) => `<svg class="ic" width="30" height="30" viewBox="0 0 24 24" style="color:${c}"><circle cx="12" cy="12" r="7"/><polyline points="12 9 12 12 13.5 13.5"/><path d="M16.51 17.35l-.35 3.83a2 2 0 0 1-2 1.82H9.83a2 2 0 0 1-2-1.82l-.35-3.83m.01-10.7l.35-3.83A2 2 0 0 1 9.83 1h4.35a2 2 0 0 1 2 1.82l.35 3.83"/></svg>`,
  camera: `<svg class="ic" width="18" height="18" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  pencil: `<svg class="ic" width="18" height="18" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  plus: `<svg class="ic" width="56" height="56" viewBox="0 0 24 24" style="color:var(--muted);stroke-width:1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  power: `<svg class="ic" width="18" height="18" viewBox="0 0 24 24"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
  usb: `<svg class="ic" width="56" height="56" viewBox="0 0 24 24" style="color:var(--muted);stroke-width:1.6"><rect x="7" y="2" width="10" height="8" rx="1"/><path d="M5 10h14v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><line x1="10" y1="5" x2="10" y2="6"/><line x1="14" y1="5" x2="14" y2="6"/></svg>`,
};

// Header block of the environment readings (Main.dc.html).
export function envBlock(env) {
  const t = env?.temp != null ? `${fmtNum(env.temp)} °C` : "– °C";
  const h = env?.hum != null ? `%${Math.round(env.hum)} nem` : "– nem";
  return `<div class="row" style="gap:6px">${ICON.temp}<div class="cond" style="font-size:26px;font-weight:600">${t}</div></div>
    <div class="row" style="gap:6px">${ICON.drop}<div class="cond" style="font-size:26px;font-weight:600">${h}</div></div>`;
}

export function stepper(key, value, unit = "", big = false) {
  const sz = big ? 52 : 48;
  return `<div class="stepper">
    <button data-act="step" data-k="${key}" data-d="-1" aria-label="azalt" style="width:${sz}px;height:${sz}px">−</button>
    <div class="v" style="min-width:${big ? 76 : 64}px;font-size:${big ? 42 : 34}px">${esc(value)}</div>
    ${unit ? `<div class="u">${esc(unit)}</div>` : ""}
    <button data-act="step" data-k="${key}" data-d="1" aria-label="artır" style="width:${sz}px;height:${sz}px">+</button></div>`;
}
