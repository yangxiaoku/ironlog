if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = /** @type {any} */ (() =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)));
}
/** @param {string} selector @param {ParentNode} [root] @returns {any} */
export const $ = (selector, root = document) => root.querySelector(selector);
/** @param {string} selector @param {ParentNode} [root] @returns {any[]} */
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
export const fmt = (value, digits = 1) => Number.isFinite(value)
  ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value) : "—";
export const prioritizeExact = (items, query) => {
  const normalize = (value) => value.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
  const target = normalize(query);
  if (!target) return items;
  const rank = (item) => Number(normalize(item.name) === target || normalize(item.englishName) === target);
  return [...items].sort((a, b) => rank(b) - rank(a));
};
export const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const shortDate = (date) => Number(date.slice(5, 7)) + "/" + Number(date.slice(8));
export const duration = (seconds) => !Number.isFinite(seconds) ? "—" : seconds < 60 ? fmt(seconds) + " 秒"
  : seconds < 3600 ? fmt(Math.round(seconds / 60)) + " 分钟" : fmt(seconds / 3600, 1) + " 小时";
export const workoutSeconds = (data) => {
  if (data.durationUnknown && data.status === "completed") return null;
  const end = Date.parse(data.endedAt ?? "");
  if (data.timing) {
    const since = data.timing.runningSince ? Date.parse(data.timing.runningSince) : NaN;
    return data.timing.elapsedSeconds + (Number.isFinite(since) && Number.isFinite(end)
      ? Math.max(0, Math.floor((end - since) / 1000)) : 0);
  }
  const start = Date.parse(data.startedAt ?? "");
  return Number.isFinite(end) && Number.isFinite(start) && data.source !== "ai" ? Math.max(0, (end - start) / 1000) : null;
};
export const estimated1RM = (weight, reps) => {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
};
export function plateBreakdown(totalWeight, barWeight = 20, availablePlates = [25, 20, 15, 10, 5, 2.5, 1.25]) {
  const weight = Number(totalWeight);
  const rawBar = Number(barWeight);
  const bar = Number.isFinite(rawBar) && rawBar >= 0 ? rawBar : 20;
  if (!Number.isFinite(weight) || weight <= bar || weight > 5000) {
    return { valid: false, bar, perSide: 0, plates: [], remainder: 0, achievable: true };
  }
  const perSide = Math.round(((weight - bar) / 2) * 100) / 100;
  let remaining = perSide;
  const sortedPlates = [...new Set(
    (Array.isArray(availablePlates) && availablePlates.length ? availablePlates : [25, 20, 15, 10, 5, 2.5, 1.25])
      .map(Number)
      .filter((p) => Number.isFinite(p) && p > 0),
  )].sort((a, b) => b - a);
  const plates = [];
  for (const plate of sortedPlates) {
    while (plates.length < 64 && remaining + 1e-6 >= plate) {
      plates.push(plate);
      remaining = Math.round((remaining - plate) * 100) / 100;
    }
    if (plates.length >= 64) break;
  }
  return { valid: true, bar, perSide, plates, remainder: remaining, achievable: remaining <= 0.01 };
}
export function dotMeter(ratio, count = 16, label = "") {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const lit = clamped > 0 ? Math.max(1, Math.round(clamped * count)) : 0;
  return `<span class="dot-meter"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}>${
    Array.from({ length: count }, (_, i) => `<i${i < lit ? ' class="lit"' : ""}></i>`).join("")
  }</span>`;
}
export function thinMeter(ratio, label = "") {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const pct = clamped > 0 ? Math.max(4, Math.round(clamped * 1000) / 10) : 0;
  return `<span class="thin-meter"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}><i style="width:${pct}%"></i></span>`;
}
export function dotPlayIcon(size = 24) {
  const dots = [
    [7.7, 5.6], [7.7, 8.8], [7.7, 12.0], [7.7, 15.2], [7.7, 18.4],
    [10.7, 7.2], [10.7, 10.4], [10.7, 13.6], [10.7, 16.8],
    [13.7, 8.8], [13.7, 12.0], [13.7, 15.2],
    [16.7, 10.4], [16.7, 13.6],
    [19.7, 12.0],
  ].map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.08"/>`).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${dots}</svg>`;
}
export function dotCheckIcon(size = 24) {
  const dots = [
    [5.2, 12.5], [7.4, 14.7], [9.6, 16.9],
    [11.8, 14.7], [14.0, 12.5], [16.2, 10.3], [18.4, 8.1],
  ].map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.1"/>`).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${dots}</svg>`;
}
export const muscles = { chest: "胸部", back: "背部", legs: "腿部", shoulders: "肩部", arms: "手臂", core: "核心", cardio: "有氧" };
export const equipment = { barbell: "杠铃", dumbbell: "哑铃", cable: "绳索", machine: "器械", bodyweight: "自重", kettlebell: "壶铃", band: "弹力带", weighted: "额外负重" };
export const feelings = { easy: "轻松", balanced: "均衡", fatigued: "疲惫" };
export const meals = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
export const panelNames = { load: "训练趋势", muscle: "肌群分布", consistency: "训练日历", strength: "动作进步", weight: "体重趋势", nutrition: "饮食趋势", apple: "Apple 健康", feeling: "训练体感" };
export const healthTypes = {
  traditionalstrengthtraining: "传统力量训练",
  functionalstrengthtraining: "功能性力量",
  coretraining: "核心训练",
  running: "跑步",
  walking: "步行",
  cycling: "骑行",
  hiking: "徒步",
  stairclimbing: "爬楼机 / 踏步机",
  stairstepper: "踏步机",
  stairs: "爬楼梯",
  elliptical: "椭圆机",
  rowing: "划船机",
  swimming: "游泳",
  highintensityintervaltraining: "高强度间歇",
  jumprope: "跳绳",
  mixedcardio: "混合有氧",
  yoga: "瑜伽",
  badminton: "羽毛球",
};
const paths = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/>',
  workout: '<path d="m6 18 12-12M4 10l10 10m-4-16 10 10M2 12l4-4m2-2 4-4m0 20 4-4m2-2 4-4"/>',
  plan: '<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M3 8h4m-4 4h4m-4 4h4m4-7h5m-5 4h5m-5 4h4"/>',
  diet: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M17 21V3s-3 3-3 8h3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4m-8 7h2m4 0h2m-8 3h2"/>',
  exercises: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 15h10m-7-8v4m4 2v4"/>',
  weight: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 10a5 5 0 0 1 10 0m-5 1 2-3"/>',
  badges: '<circle cx="12" cy="9" r="6"/><path d="M9.5 14.5 8 22l4-2.2L16 22l-1.5-7.5"/>',
  settings: '<path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h5m4 0h9"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  arrowUp: '<path d="m6 14 6-6 6 6"/>',
  arrowDown: '<path d="m6 10 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  dial: '<circle cx="12" cy="12" r="9"/><path d="M12 5v2m0 10v2M5 12h2m10 0h2m-7-2v2l2 2"/>',
  heart: '<path d="M20.7 5.8a4.5 4.5 0 0 0-6.4 0L12 8.1 9.7 5.8a4.5 4.5 0 1 0-6.4 6.4L12 21l8.7-8.8a4.5 4.5 0 0 0 0-6.4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 11-2l3 6M4 12l3 6a7 7 0 0 0 11-2"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  trophy: '<path d="M6 4h12v4a6 6 0 0 1-12 0V4ZM6 6H3v2a3 3 0 0 0 3 3m12-5h3v2a3 3 0 0 1-3 3m-6 3v5m-4 3h8"/>',
  trending: '<path d="m3 17 6-6 4 4 8-8m0 0h-5m5 0v5"/>',
  analytics: '<path d="M3 3v18h18"/><path d="m7 15 4-4 4 3 5-7"/>',
  swap: '<path d="M7 16V4m0 0-3 3m3-3 3 3m7-1v12m0 0-3-3m3 3 3-3"/>',
  rest: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starFilled: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
};
export const progressionNames = { double: "双重渐进", linear: "线性渐进", greyskull: "Greyskull AMRAP", manual: "固定负荷" };
export function progressionShortLabel(row) {
  if (!row) return "";
  if (row.seconds > 0) return `计时 ${row.seconds} 秒`;
  const range = row.repsMin === row.repsMax ? `${row.repsMin} 次` : `${row.repsMin}–${row.repsMax} 次`;
  if (row.progression === "manual") return `固定 · ${range}`;
  const mode = row.progression === "greyskull" ? "AMRAP" : row.progression === "linear" ? "线性" : "双渐进";
  return `${mode} +${fmt(row.increment ?? 2.5)}kg · RIR ${row.targetRir ?? 2}`;
}
export const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ""}</svg>`;
export const empty = (title, description, action = "") => `<div class="empty"><strong>${esc(title)}</strong><p>${esc(description)}</p>${action}</div>`;
export const options = (values, selected) => Object.entries(values).map(([key, name]) =>
  `<option value="${esc(key)}"${String(key) === String(selected) ? " selected" : ""}>${esc(name)}</option>`).join("");
export const segments = (values, selected, action) => `<div class="segments">${Object.entries(values).map(([value, label]) =>
  `<button type="button" data-action="${action}" data-value="${esc(value)}" aria-pressed="${String(value) === String(selected)}">${esc(label)}</button>`).join("")}</div>`;
export const copyText = async (value) => {
  const text = String(value ?? "");
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const host = document.querySelector("dialog[open]") || document.body;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px";
    host.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
};
export const field = (label, input) => `<label class="field"><span>${esc(label)}</span>${input}</label>`;
export const input = (name, value, attributes = "") => `<input name="${esc(name)}" value="${esc(value)}" ${attributes}>`;
export const inputGroup = (name, value, unit, attributes = "") => `<div class="input-unit">${input(name, value, attributes)}<span>${esc(unit)}</span></div>`;
export const switchField = (name, title, checked, note = "") => `<label class="toggle-row"><span><strong>${esc(title)}</strong>${note ? `<small>${esc(note)}</small>` : ""}</span><input class="switch" type="checkbox" name="${esc(name)}"${checked ? " checked" : ""}></label>`;
export function supersetBadges(items) {
  const counters = new Map();
  return (items ?? []).map((row) => {
    const code = row?.supersetGroup;
    if (!code) return "";
    const n = (counters.get(code) ?? 0) + 1;
    counters.set(code, n);
    return `${code}${n}`;
  });
}
