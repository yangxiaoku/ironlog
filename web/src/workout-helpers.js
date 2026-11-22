import { plateBreakdown } from "./ui.js";

export function round2(v) {
  return Math.round(v * 100) / 100;
}

export const numeric = 'type="number" inputmode="decimal" step="0.1" min="0" max="100000" required';
export const soundPreference = "ironlog-web-rest-sound";
export const screenPreference = "ironlog-web-workout-screen";
export const rirPreference = "ironlog-web-show-rir";
export const dialPreference = "ironlog-web-auto-rest-dial";
export const notifyPreference = "ironlog-web-rest-notify";
export const barPreference = "ironlog-web-bar-weight";
export const platesPreference = "ironlog-web-plates";
export const ALL_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];
export const BAR_PRESETS = [[20, "20kg杆"], [15, "15kg杆"], [10, "10kg曲杆"], [25, "25kg六角"], [0, "0kg纯挂片"]];

export function forgetDraft(key) {
  if (!key) return;
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

export function renderDialTicks(fraction, { count = 48, cx = 130, r1 = 104, r2 = 120, r1Major = 99 } = {}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const activeCount = clamped <= 0 ? 0 : Math.max(1, Math.round(clamped * count));
  const lines = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const major = i % (count / 12) === 0;
    const inner = major ? r1Major : r1;
    const x1 = (cx + Math.cos(angle) * inner).toFixed(1);
    const y1 = (cx + Math.sin(angle) * inner).toFixed(1);
    const x2 = (cx + Math.cos(angle) * r2).toFixed(1);
    const y2 = (cx + Math.sin(angle) * r2).toFixed(1);
    const lit = i < activeCount;
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dial-tick${major ? " is-major" : ""}${lit ? " is-lit" : ""}"/>`);
  }
  return lines.join("");
}

export function syncDialTicks(svg, fraction) {
  const ticks = svg?.children;
  if (!ticks?.length) return;
  const clamped = Math.max(0, Math.min(1, fraction));
  const activeCount = clamped <= 0 ? 0 : Math.max(1, Math.round(clamped * ticks.length));
  for (let i = 0; i < ticks.length; i++) ticks[i].classList.toggle("is-lit", i < activeCount);
}

export function exerciseLabel(row) {
  return row.snapshot?.name ?? row.exerciseId;
}

export function plateDeltaLabel(prevWeight, curWeight, barWeight = 20, enabledPlates = ALL_PLATES) {
  if (!(prevWeight > barWeight) || !(curWeight > barWeight) || prevWeight === curWeight) return "";
  const prevCalc = plateBreakdown(prevWeight, barWeight, enabledPlates);
  const curCalc = plateBreakdown(curWeight, barWeight, enabledPlates);
  if (!prevCalc.valid || !curCalc.valid) return "";
  const counts = new Map();
  for (const p of curCalc.plates) counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const p of prevCalc.plates) counts.set(p, (counts.get(p) ?? 0) - 1);
  const parts = [];
  for (const w of [...counts.keys()].sort((a, b) => a - b)) {
    const diff = counts.get(w) ?? 0;
    for (let k = 0; k < Math.abs(diff); k++) parts.push(`${diff < 0 ? "-" : "+"}${w}`);
  }
  return parts.join(" ");
}

export function snapWarmupWeight(target, isBarbell, barWeight = 20, enabledPlates = ALL_PLATES) {
  if (isBarbell) {
    if (target <= barWeight) return barWeight;
    const calc = plateBreakdown(target, barWeight, enabledPlates);
    if (!calc.valid) return barWeight;
    return Math.max(barWeight, round2(calc.bar + 2 * (calc.perSide - calc.remainder)));
  }
  const step = target < 15 ? 1 : 2.5;
  return Math.max(step, Math.round(target / step) * step);
}
