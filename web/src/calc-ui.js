import { $, $$, esc, estimated1RM, fmt, icon, plateBreakdown } from "./ui.js";

const barPreference = "ironlog-web-bar-weight";
const platesPreference = "ironlog-web-plates";
const ALL_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];
const BAR_PRESETS = [
  [20, "20kg标杆"],
  [15, "15kg女杆"],
  [10, "10kg曲杆"],
  [25, "25kg六角"],
  [0, "0kg纯挂片"],
];
const KG_TO_LB = 2.20462262;
const PCT_ZONES = [
  [100, "1 次", 1.0],
  [95, "2 次", 0.95],
  [90, "3–4 次", 0.9],
  [85, "5–6 次", 0.85],
  [80, "8 次", 0.8],
  [75, "10 次", 0.75],
  [70, "12 次", 0.7],
  [65, "15 次", 0.65],
  [60, "热身", 0.6],
];

function readBarWeight() {
  try {
    const raw = Number(localStorage.getItem(barPreference));
    return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 20;
  } catch {
    return 20;
  }
}

function readEnabledPlates() {
  try {
    const raw = JSON.parse(localStorage.getItem(platesPreference) ?? "null");
    if (Array.isArray(raw)) {
      const valid = raw.map(Number).filter((p) => ALL_PLATES.includes(p));
      if (valid.length) return valid;
    }
  } catch {}
  return [25, 20, 15, 10, 5, 2.5, 1.25];
}

/**
 * Standalone 1RM estimator (%1RM training load matrix) paired with an interactive visual barbell loader.
 */
export function openStrengthCalculator({ open, dialog }) {
  let unit = "kg";
  let barWeight = readBarWeight();
  let enabledPlates = readEnabledPlates();
  let activePct = null;

  open("1RM 与杠铃配片计算器", `<div class="dialog-form calc-modal">
    <section class="calc-card" aria-label="1RM 估算与百分比负荷">
      <header class="calc-card-head">
        <div>
          <h3>估算 1RM 与百分比训练表</h3>
          <small>Epley + RIR 储备次修正 · 点击任意百分比自动带入下方配片</small>
        </div>
        <div class="segments calc-unit-seg" role="group" aria-label="重量单位">
          <button type="button" data-calc-unit="kg" aria-pressed="true">kg</button>
          <button type="button" data-calc-unit="lb" aria-pressed="false">lb</button>
        </div>
      </header>
      <div class="calc-inputs">
        <label class="field"><span>训练重量 (<em data-unit-label>kg</em>)</span><input id="calc-weight" type="number" inputmode="decimal" min="1" max="2000" step="0.5" value="80"></label>
        <label class="field"><span>完成次数</span><input id="calc-reps" type="number" inputmode="numeric" min="1" max="15" step="1" value="5"></label>
        <label class="field"><span>RIR 余力</span><select id="calc-rir">
          <option value="0" selected>0（力竭）</option>
          <option value="1">1 次余力</option>
          <option value="2">2 次余力</option>
          <option value="3">3 次余力</option>
          <option value="4">4 次余力</option>
        </select></label>
      </div>
      <div class="calc-1rm-hero" data-calc-1rm></div>
      <div class="calc-pct-grid" data-calc-pcts></div>
    </section>

    <section class="calc-card" aria-label="杠铃可视化配片模拟器">
      <header class="calc-card-head">
        <div>
          <h3>杠铃可视化配片</h3>
          <small>与训练编辑器共享杠重与可用杠片库存设置</small>
        </div>
        <div class="calc-target-steppers">
          ${[-10, -5, -2.5, 2.5, 5, 10].map((d) =>
            `<button type="button" class="stepper-pill" data-bar-step="${d}">${d > 0 ? `+${d}` : d}</button>`).join("")}
        </div>
      </header>
      <div class="calc-bar-controls">
        <label class="field"><span>目标总重 (kg)</span><input id="calc-bar-target" type="number" inputmode="decimal" min="0" max="1000" step="0.5" value="80"></label>
        <div class="calc-bar-presets" role="group" aria-label="杠铃杆规格">
          ${BAR_PRESETS.map(([w, lbl]) =>
            `<button type="button" class="stepper-pill" data-calc-bar="${w}" aria-pressed="${barWeight === w}">${esc(lbl)}</button>`).join("")}
        </div>
      </div>
      <div class="calc-barbell-viz" data-calc-viz></div>
      <div class="calc-plate-summary" data-calc-summary></div>
      <div class="calc-plate-inv">
        <span>可用单侧杠片 (kg)</span>
        <div class="plate-inv-pills" role="group" aria-label="可用杠片规格">
          ${ALL_PLATES.map((p) =>
            `<button type="button" class="stepper-pill" data-calc-plate="${p}" aria-pressed="${enabledPlates.includes(p)}">${p}</button>`).join("")}
        </div>
      </div>
    </section>

    <footer>
      <button type="button" class="primary-button" data-action="close">完成</button>
    </footer>
  </div>`, true, "report");

  const modal = $(".calc-modal", dialog);
  const weightInput = $("#calc-weight", modal);
  const repsInput = $("#calc-reps", modal);
  const rirSelect = $("#calc-rir", modal);
  const targetInput = $("#calc-bar-target", modal);
  const unitLabel = $("[data-unit-label]", modal);
  const heroEl = $("[data-calc-1rm]", modal);
  const pctsEl = $("[data-calc-pcts]", modal);
  const vizEl = $("[data-calc-viz]", modal);
  const summaryEl = $("[data-calc-summary]", modal);

  function saveInventory() {
    try {
      localStorage.setItem(barPreference, String(barWeight));
      localStorage.setItem(platesPreference, JSON.stringify(enabledPlates));
    } catch {}
  }

  function render1Rm() {
    const rawW = Math.max(0, Number(weightInput.value) || 0);
    const wKg = unit === "lb" ? rawW / KG_TO_LB : rawW;
    const reps = Math.max(1, Math.min(15, Math.round(Number(repsInput.value) || 1)));
    const rir = Math.max(0, Math.min(4, Number(rirSelect.value) || 0));
    const effReps = Math.max(1, Math.min(15, reps + rir));
    const rmKg = estimated1RM(wKg, effReps);
    const rmRoundedKg = Math.round(rmKg * 10) / 10;
    const rmLb = Math.round(rmKg * KG_TO_LB * 10) / 10;

    if (rmRoundedKg > 0) {
      heroEl.innerHTML = `<div class="calc-1rm-main"><span>估算极限 1RM</span><strong>${fmt(rmRoundedKg)} <small>kg</small></strong></div>
        <div class="calc-1rm-sub"><span>≈ ${fmt(rmLb)} lb</span>${rir > 0 ? `<span>按有效次数 ${effReps} 次折算</span>` : ""}</div>`;
      pctsEl.innerHTML = PCT_ZONES.map(([pct, repTxt, ratio]) => {
        const loadKg = Math.max(2.5, Math.round((rmKg * ratio) / 2.5) * 2.5);
        return `<button type="button" class="calc-pct-btn${activePct === pct ? " is-active" : ""}" data-calc-pct="${pct}" data-calc-load="${loadKg}">
          <span class="calc-pct-top"><b>${pct}%</b><small>${repTxt}</small></span>
          <strong>${fmt(loadKg)} kg</strong>
        </button>`;
      }).join("");
    } else {
      heroEl.innerHTML = '<small class="muted">请输入有效重量与次数计算估算 1RM</small>';
      pctsEl.innerHTML = "";
    }
  }

  function renderBarbell() {
    const targetKg = Math.min(2000, Math.max(0, Number(targetInput.value) || 0));
    const bd = plateBreakdown(targetKg, barWeight, enabledPlates);
    if (!bd.valid) {
      const hint = targetKg > 0 && targetKg <= barWeight
        ? `目标重 (${fmt(targetKg)} kg) 不高于当前杠重 (${barWeight} kg)，空杆或无需额外配片`
        : "输入高于杠重的目标重量后，将在此展示两侧杠片装配图";
      vizEl.innerHTML = `<div class="calc-barbell-empty">${icon("workout", 18)}<span>${esc(hint)}</span></div>`;
      summaryEl.innerHTML = "";
      return;
    }

    const plateNodes = (reverse = false) => {
      const arr = reverse ? [...bd.plates].reverse() : bd.plates;
      return arr.map((p) => `<i class="calc-plate" data-plate="${p}" title="${p} kg"><span>${p}</span></i>`).join("");
    };
    const counts = new Map();
    for (const p of bd.plates) counts.set(p, (counts.get(p) ?? 0) + 1);
    const breakdownText = bd.plates.length
      ? [...counts.entries()].map(([p, c]) => `${p}kg×${c}`).join(" + ")
      : "无需挂片（差额小于最小片）";
    const actualKg = Math.round((barWeight + bd.plates.reduce((s, p) => s + p * 2, 0)) * 100) / 100;
    const actualLb = Math.round(actualKg * KG_TO_LB * 10) / 10;

    vizEl.innerHTML = `<div class="calc-barbell-stage" role="img" aria-label="双侧配片示意图：每侧 ${esc(breakdownText)}">
      <div class="calc-sleeve left">${plateNodes(true)}<span class="calc-collar"></span></div>
      <div class="calc-bar-shaft"><span>${barWeight > 0 ? `${barWeight}kg杆` : "纯挂片"}</span></div>
      <div class="calc-sleeve right"><span class="calc-collar"></span>${plateNodes(false)}</div>
    </div>`;

    summaryEl.innerHTML = `<div class="calc-summary-row">
      <span>每侧装配：<b>${esc(breakdownText)}</b>（共 ${fmt(bd.perSide, 2)} kg/侧）</span>
      <span>实得总重：<b>${fmt(actualKg, 2)} kg</b> <small>(${fmt(actualLb)} lb)</small></span>
    </div>${!bd.achievable ? `<p class="calc-remainder-warn">受当前可用杠片最小规格限制，每侧差 ${fmt(bd.remainder, 2)} kg（可勾选 0.5kg / 1.25kg 小片）</p>` : ""}`;
  }

  weightInput.addEventListener("input", () => { activePct = null; render1Rm(); });
  repsInput.addEventListener("input", () => { activePct = null; render1Rm(); });
  rirSelect.addEventListener("change", () => { activePct = null; render1Rm(); });
  targetInput.addEventListener("input", () => { activePct = null; render1Rm(); renderBarbell(); });

  modal.addEventListener("click", (event) => {
    const unitBtn = event.target.closest("[data-calc-unit]");
    if (unitBtn) {
      const next = unitBtn.dataset.calcUnit;
      if (next !== unit) {
        const cur = Number(weightInput.value) || 0;
        weightInput.value = String(next === "lb" ? Math.round(cur * KG_TO_LB * 2) / 2 : Math.round((cur / KG_TO_LB) * 2) / 2);
        unit = next;
        unitLabel.textContent = unit;
        $$("[data-calc-unit]", modal).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.calcUnit === unit)));
        render1Rm();
      }
      return;
    }
    const pctBtn = event.target.closest("[data-calc-load]");
    if (pctBtn) {
      activePct = Number(pctBtn.dataset.calcPct);
      targetInput.value = pctBtn.dataset.calcLoad;
      render1Rm();
      renderBarbell();
      return;
    }
    const stepBtn = event.target.closest("[data-bar-step]");
    if (stepBtn) {
      const cur = Number(targetInput.value) || 0;
      targetInput.value = String(Math.max(0, Math.round((cur + Number(stepBtn.dataset.barStep)) * 100) / 100));
      activePct = null;
      render1Rm();
      renderBarbell();
      return;
    }
    const barBtn = event.target.closest("[data-calc-bar]");
    if (barBtn) {
      barWeight = Number(barBtn.dataset.calcBar);
      saveInventory();
      $$("[data-calc-bar]", modal).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.calcBar) === barWeight)));
      renderBarbell();
      return;
    }
    const plateBtn = event.target.closest("[data-calc-plate]");
    if (plateBtn) {
      const val = Number(plateBtn.dataset.calcPlate);
      if (enabledPlates.includes(val)) {
        if (enabledPlates.length > 1) enabledPlates = enabledPlates.filter((p) => p !== val);
      } else {
        enabledPlates = [...enabledPlates, val].sort((a, b) => b - a);
      }
      saveInventory();
      $$("[data-calc-plate]", modal).forEach((b) => b.setAttribute("aria-pressed", String(enabledPlates.includes(Number(b.dataset.calcPlate)))));
      renderBarbell();
    }
  });

  render1Rm();
  renderBarbell();
}
