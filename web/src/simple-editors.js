import { $, $$, esc, fmt, today, icon, field, input, meals } from "./ui.js";
import { haptic } from "./workout-clock.js";

const uuid = () => crypto.randomUUID();

export function shiftDateStr(base, delta) {
  try {
    const d = new Date(base + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  } catch {
    return base;
  }
}

export function commonFields(kind, data, record, appDate = today) {
  return field("日期", input("date", data.date ?? appDate(), `type="date" min="1902-01-01" max="${today()}" required ${kind === "weight" && record ? "readonly" : ""}`));
}

export function openSimpleRecordEditor({
  kind,
  record,
  settings = {},
  seed,
  api,
  open,
  appDate,
  getLatestWeight,
  getRecentFoods,
  commit,
  deleteRecord,
  onSwitchDate,
}) {
  const data = record?.data ?? seed ?? {};
  const weight = kind === "weight";
  const title = (record ? "编辑" : "添加") + (weight ? "体重" : "饮食");
  const activeWeightDate = weight ? (data.date ?? appDate()) : "";

  if (weight) {
    const curDate = activeWeightDate;
    const fallbackWeight = !record && (data.weight == null || data.weight === "") ? (getLatestWeight?.() ?? null) : null;
    const initialWeight = data.weight ?? (fallbackWeight ?? "");
    open(title, `<form id="editor-form" class="dialog-form modern-weight-form">
      <div class="date-quick-strip weight-date-strip">
        <div class="date-pill-group">
          <button type="button" class="date-pill" data-set-date="${today()}" aria-pressed="${curDate === today()}">今天</button>
          <button type="button" class="date-pill" data-set-date="${shiftDateStr(today(), -1)}" aria-pressed="${curDate === shiftDateStr(today(), -1)}">昨天</button>
          <button type="button" class="date-pill" data-set-date="${shiftDateStr(today(), -2)}" aria-pressed="${curDate === shiftDateStr(today(), -2)}">前天</button>
        </div>
        <input class="date-input-inline" type="date" name="date" value="${esc(curDate)}" min="1902-01-01" max="${today()}" required>
      </div>

      <div class="scale-hero-card">
        <div class="scale-head">
          <span class="scale-label">${icon("weight", 16)} 晨起空腹体重</span>
          <span class="scale-mode-pill">KG</span>
        </div>
        <div class="scale-display">
          <input name="weight" type="number" inputmode="decimal" min="1" max="500" step="0.01" required autofocus value="${initialWeight}" placeholder="00.00">
          <span class="scale-unit">kg</span>
        </div>
        ${fallbackWeight ? `<small class="scale-prev-hint">已记忆上次记录：${fmt(fallbackWeight, 2)} kg · 可直接点下方微调</small>` : ""}
        <div class="scale-stepper-row">
          <button type="button" class="scale-stepper-btn" data-scale-bump="-1.0">-1.0</button>
          <button type="button" class="scale-stepper-btn" data-scale-bump="-0.5">-0.5</button>
          <button type="button" class="scale-stepper-btn" data-scale-bump="-0.1">-0.1</button>
          <button type="button" class="scale-stepper-btn" data-scale-bump="+0.1">+0.1</button>
          <button type="button" class="scale-stepper-btn" data-scale-bump="+0.5">+0.5</button>
          <button type="button" class="scale-stepper-btn" data-scale-bump="+1.0">+1.0</button>
        </div>
      </div>

      <div class="bodyfat-card">
        <div class="bodyfat-head">
          <span>体脂率（可选）</span>
          <span class="bodyfat-unit">%</span>
        </div>
        <div class="bodyfat-body">
          <input name="bodyFat" type="number" inputmode="decimal" min="1" max="99" step="0.1" value="${data.bodyFat ?? ""}" placeholder="15.0">
          <div class="bodyfat-steppers">
            <button type="button" class="micro-chip" data-bf-bump="-0.5">-0.5%</button>
            <button type="button" class="micro-chip" data-bf-bump="+0.5">+0.5%</button>
          </div>
        </div>
      </div>

      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-foot${record ? " has-remove" : ""}">
        ${record ? '<button type="button" class="danger" id="remove-record">删除记录</button>' : ""}
        <button class="primary-button" type="submit">保存体重记录</button>
      </footer>
    </form>`);
  } else {
    const curMeal = data.meal ?? "lunch";
    const curDate = data.date ?? appDate();
    const builtinPresets = [
      { short: "蛋白粉", name: "乳清蛋白粉 (1勺)", protein: 24, carbs: 3, fat: 1.5, calories: 120, hint: "24P·120k" },
      { short: "鸡蛋2颗", name: "水煮蛋 (2颗)", protein: 12, carbs: 1.2, fat: 10, calories: 140, hint: "12P·140k" },
      { short: "鸡胸150g", name: "香煎鸡胸肉 (150g)", protein: 34, carbs: 0, fat: 3.5, calories: 165, hint: "34P·165k" },
      { short: "白米饭 200g", name: "蒸白米饭 (200g)", protein: 5, carbs: 52, fat: 0.6, calories: 230, hint: "52C·230k" },
      { short: "燕麦50g", name: "纯燕麦片 (50g)", protein: 6.5, carbs: 33, fat: 3.5, calories: 190, hint: "33C·190k" },
      { short: "香蕉1根", name: "香蕉 (中等1根)", protein: 1.3, carbs: 27, fat: 0.4, calories: 105, hint: "27C·105k" },
    ];
    const builtinNames = new Set(builtinPresets.map((p) => p.name));
    const recentFoods = (getRecentFoods?.() ?? []).filter((f) => f.name && !builtinNames.has(f.name)).slice(0, 6);
    const presetChip = (item, isRecent = false) => `<button type="button" class="preset-chip${isRecent ? " is-recent" : ""}" data-diet-preset="${esc(JSON.stringify([item.name, item.protein, item.carbs, item.fat, item.calories]))}">${isRecent ? '<span class="preset-tag">常吃</span>' : ""}${esc(item.short ?? item.name)} <small>${esc(item.hint ?? `${Math.round(item.calories)}k`)}</small></button>`;
    open(title, `<form id="editor-form" class="dialog-form modern-diet-form">
      <div class="diet-top-bar">
        <div class="meal-segmented-control" role="group" aria-label="选择餐次">
          ${Object.entries(meals).map(([val, label]) => `
            <button type="button" class="meal-pill" data-meal-choice="${val}" aria-pressed="${curMeal === val}">${label}</button>
          `).join("")}
          <input type="hidden" name="meal" value="${esc(curMeal)}">
        </div>
        <div class="date-quick-strip">
          <button type="button" class="date-pill" data-set-date="${today()}" aria-pressed="${curDate === today()}">今天</button>
          <button type="button" class="date-pill" data-set-date="${shiftDateStr(today(), -1)}" aria-pressed="${curDate === shiftDateStr(today(), -1)}">昨天</button>
          <input class="date-input-inline" type="date" name="date" value="${esc(curDate)}" min="1902-01-01" max="${today()}" required>
        </div>
      </div>

      <label class="field food-name-field">
        <span>食物名称</span>
        <div class="food-input-group">
          <span class="food-icon" aria-hidden="true">${icon("diet", 17)}</span>
          <input name="name" maxlength="120" required autofocus value="${esc(data.name ?? "")}" placeholder="例如：香煎鸡胸肉糙米饭 / 蛋白粉燕麦">
        </div>
      </label>

      <div class="diet-quick-presets" role="group" aria-label="常见健身餐快捷填入">
        <span class="preset-label">${recentFoods.length ? "近期常吃与预设：" : "快捷预设："}</span>
        <div class="preset-chips">
          ${recentFoods.map((f) => presetChip(f, true)).join("")}${builtinPresets.map((p) => presetChip(p, false)).join("")}
        </div>
      </div>

      <div class="macro-deck" aria-label="四大营养宏量">
        <div class="macro-card macro-calories">
          <div class="macro-card-head">
            <span class="macro-badge badge-kcal"><i class="macro-dot"></i> 热量</span>
            <span class="macro-unit">kcal</span>
          </div>
          <div class="macro-card-value">
            <input type="number" inputmode="decimal" name="calories" min="0" max="100000" step="1" value="${data.calories ?? ""}" placeholder="0" required>
          </div>
          <div class="macro-steppers">
            <button type="button" class="micro-chip" data-macro-bump="calories" data-val="50">+50</button>
            <button type="button" class="micro-chip" data-macro-bump="calories" data-val="100">+100</button>
            <button type="button" class="micro-chip" data-macro-bump="calories" data-val="200">+200</button>
          </div>
        </div>

        <div class="macro-card macro-protein">
          <div class="macro-card-head">
            <span class="macro-badge badge-protein"><i class="macro-dot"></i> 蛋白质</span>
            <span class="macro-unit">g</span>
          </div>
          <div class="macro-card-value">
            <input type="number" inputmode="decimal" name="protein" min="0" max="1000" step="0.1" value="${data.protein ?? (record ? 0 : "")}" placeholder="0">
          </div>
          <div class="macro-steppers">
            <button type="button" class="micro-chip" data-macro-bump="protein" data-val="10">+10</button>
            <button type="button" class="micro-chip" data-macro-bump="protein" data-val="20">+20</button>
            <button type="button" class="micro-chip" data-macro-bump="protein" data-val="30">+30</button>
          </div>
        </div>

        <div class="macro-card macro-carbs">
          <div class="macro-card-head">
            <span class="macro-badge badge-carbs"><i class="macro-dot"></i> 碳水化合物</span>
            <span class="macro-unit">g</span>
          </div>
          <div class="macro-card-value">
            <input type="number" inputmode="decimal" name="carbs" min="0" max="1000" step="0.1" value="${data.carbs ?? (record ? 0 : "")}" placeholder="0">
          </div>
          <div class="macro-steppers">
            <button type="button" class="micro-chip" data-macro-bump="carbs" data-val="10">+10</button>
            <button type="button" class="micro-chip" data-macro-bump="carbs" data-val="25">+25</button>
            <button type="button" class="micro-chip" data-macro-bump="carbs" data-val="50">+50</button>
          </div>
        </div>

        <div class="macro-card macro-fat">
          <div class="macro-card-head">
            <span class="macro-badge badge-fat"><i class="macro-dot"></i> 优质脂肪</span>
            <span class="macro-unit">g</span>
          </div>
          <div class="macro-card-value">
            <input type="number" inputmode="decimal" name="fat" min="0" max="1000" step="0.1" value="${data.fat ?? (record ? 0 : "")}" placeholder="0">
          </div>
          <div class="macro-steppers">
            <button type="button" class="micro-chip" data-macro-bump="fat" data-val="5">+5</button>
            <button type="button" class="micro-chip" data-macro-bump="fat" data-val="10">+10</button>
            <button type="button" class="micro-chip" data-macro-bump="fat" data-val="15">+15</button>
          </div>
        </div>
      </div>

      <div class="macro-calc-bar">
        <div class="macro-calc-hint">
          <span>宏量折算：<strong data-macro-sum>0</strong> kcal <small>(4P + 4C + 9F)</small></span>
        </div>
        <button type="button" class="quiet macro-calc-apply" data-apply-macro-calc>按折算填入热量</button>
      </div>

      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-foot${record ? " has-remove" : ""}">
        ${record ? '<button type="button" class="danger" id="remove-record">删除记录</button>' : '<button type="button" class="secondary-button" data-save-continue>保存并继续</button>'}
        <button class="primary-button" type="submit">保存饮食记录</button>
      </footer>
    </form>`);
  }

  /** @type {HTMLFormElement} */
  const form = /** @type {HTMLFormElement} */ ($("#editor-form"));
  let keepOpenAfterSave = false;
  let dateSwitchSeq = 0;

  function syncDatePills() {
    const cur = /** @type {HTMLInputElement | null} */ ($('[name="date"]', form))?.value ?? "";
    $$(".date-pill", form).forEach((pill) => {
      pill.setAttribute("aria-pressed", String(/** @type {HTMLElement} */ (pill).dataset.setDate === cur));
    });
  }
  syncDatePills();

  async function switchWeightDate(nextDate) {
    if (!weight || !nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate === activeWeightDate) return;
    const seq = ++dateSwitchSeq;
    const dateControls = /** @type {Array<HTMLButtonElement | HTMLInputElement>} */ ([...$$(".date-pill", form), $('[name="date"]', form)].filter(Boolean));
    dateControls.forEach((el) => { el.disabled = true; });
    try {
      const existing = await api("/api/web/records/weight/weight_" + encodeURIComponent(nextDate) + "?includeDeleted=1").catch(() => null);
      if (!form.isConnected || seq !== dateSwitchSeq) return;
      const alive = existing && !existing.deleted ? existing : undefined;
      onSwitchDate("weight", alive, settings, alive ? undefined : { date: nextDate });
    } finally {
      if (form.isConnected) dateControls.forEach((el) => { el.disabled = false; });
    }
  }

  function updateMacroSum() {
    if (weight) return;
    const p = Number(/** @type {HTMLInputElement | null} */ ($('[name="protein"]', form))?.value) || 0;
    const c = Number(/** @type {HTMLInputElement | null} */ ($('[name="carbs"]', form))?.value) || 0;
    const f = Number(/** @type {HTMLInputElement | null} */ ($('[name="fat"]', form))?.value) || 0;
    const sumEl = $("[data-macro-sum]", form);
    if (sumEl) sumEl.textContent = String(Math.round(p * 4 + c * 4 + f * 9));
  }
  updateMacroSum();
  form.addEventListener("input", updateMacroSum);
  form.addEventListener("change", ({ target }) => {
    const inputEl = /** @type {HTMLInputElement} */ (target);
    if (inputEl.name !== "date") return;
    if (weight) void switchWeightDate(inputEl.value);
    else syncDatePills();
  });

  form.addEventListener("click", ({ target }) => {
    const el = /** @type {HTMLElement} */ (target);
    const mealChoice = /** @type {HTMLElement | null} */ (el.closest("[data-meal-choice]"));
    if (mealChoice) {
      const mealVal = mealChoice.dataset.mealChoice ?? "";
      const hidden = /** @type {HTMLInputElement | null} */ ($('[name="meal"]', form));
      if (hidden) hidden.value = mealVal;
      $$(".meal-pill", form).forEach((p) => p.setAttribute("aria-pressed", String(p === mealChoice)));
      haptic("light");
      return;
    }
    const presetBtn = /** @type {HTMLElement | null} */ (el.closest("[data-diet-preset]"));
    if (presetBtn) {
      const raw = presetBtn.dataset.dietPreset ?? "";
      const [pName, pP, pC, pF, pCal] = raw.startsWith("[") ? JSON.parse(raw) : raw.split(",");
      const nameInput = /** @type {HTMLInputElement | null} */ ($('[name="name"]', form));
      const pInput = /** @type {HTMLInputElement | null} */ ($('[name="protein"]', form));
      const cInput = /** @type {HTMLInputElement | null} */ ($('[name="carbs"]', form));
      const fInput = /** @type {HTMLInputElement | null} */ ($('[name="fat"]', form));
      const calInput = /** @type {HTMLInputElement | null} */ ($('[name="calories"]', form));
      if (nameInput) nameInput.value = pName;
      if (pInput) pInput.value = pP;
      if (cInput) cInput.value = pC;
      if (fInput) fInput.value = pF;
      if (calInput) calInput.value = pCal;
      updateMacroSum();
      haptic("light");
      return;
    }
    const dateBtn = /** @type {HTMLElement | null} */ (el.closest("[data-set-date]"));
    if (dateBtn) {
      if (weight) {
        haptic("light");
        void switchWeightDate(dateBtn.dataset.setDate);
        return;
      }
      const dateInput = /** @type {HTMLInputElement | null} */ ($('[name="date"]', form));
      if (dateInput) {
        dateInput.value = dateBtn.dataset.setDate ?? "";
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));
        syncDatePills();
      }
      haptic("light");
      return;
    }
    if (el.closest("[data-save-continue]") && !record && !weight) {
      if (!form.reportValidity()) { keepOpenAfterSave = false; return; }
      keepOpenAfterSave = true;
      form.requestSubmit();
      return;
    }
    const macroBump = /** @type {HTMLElement | null} */ (el.closest("[data-macro-bump]"));
    if (macroBump) {
      const key = macroBump.dataset.macroBump;
      const delta = Number(macroBump.dataset.val);
      const inputEl = /** @type {HTMLInputElement | null} */ ($(`[name="${key}"]`, form));
      if (inputEl) {
        const cur = Number(inputEl.value) || 0;
        inputEl.value = String(Math.max(0, Math.round((cur + delta) * 10) / 10));
        updateMacroSum();
      }
      haptic("light");
      return;
    }
    if (el.closest("[data-apply-macro-calc]")) {
      const sumEl = $("[data-macro-sum]", form);
      const calInput = /** @type {HTMLInputElement | null} */ ($('[name="calories"]', form));
      if (sumEl && calInput) {
        calInput.value = sumEl.textContent ?? "0";
      }
      haptic("light");
      return;
    }
    const scaleBump = /** @type {HTMLElement | null} */ (el.closest("[data-scale-bump]"));
    if (scaleBump) {
      const delta = Number(scaleBump.dataset.scaleBump);
      const wtInput = /** @type {HTMLInputElement | null} */ ($('[name="weight"]', form));
      if (wtInput) {
        const cur = Number(wtInput.value) || 70;
        wtInput.value = String(Math.max(1, Math.round((cur + delta) * 100) / 100));
      }
      haptic("light");
      return;
    }
    const bfBump = /** @type {HTMLElement | null} */ (el.closest("[data-bf-bump]"));
    if (bfBump) {
      const delta = Number(bfBump.dataset.bfBump);
      const bfInput = /** @type {HTMLInputElement | null} */ ($('[name="bodyFat"]', form));
      if (bfInput) {
        const cur = Number(bfInput.value) || 15;
        bfInput.value = String(Math.max(1, Math.min(99, Math.round((cur + delta) * 10) / 10)));
      }
      haptic("light");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const keepOpen = keepOpenAfterSave && !record && !weight;
    keepOpenAfterSave = false;
    const values = new FormData(form);
    const date = String(values.get("date") ?? "");
    const updated = weight ? {
      date,
      weight: Number(values.get("weight")),
      bodyFat: values.get("bodyFat") === "" ? null : Number(values.get("bodyFat")),
    } : {
      ...data,
      date,
      name: String(values.get("name") ?? "").trim(),
      meal: String(values.get("meal") ?? "lunch"),
      calories: Number(values.get("calories")),
      protein: Number(values.get("protein")) || 0,
      carbs: Number(values.get("carbs")) || 0,
      fat: Number(values.get("fat")) || 0,
    };
    let baseVersion = record?.version ?? 0;
    if (!record && weight) {
      const prevWeight = await api("/api/web/records/weight/weight_" + encodeURIComponent(date) + "?includeDeleted=1").catch(() => null);
      if (!form.isConnected) return;
      if (prevWeight?.version > 0) baseVersion = prevWeight.version;
    }
    commit(form, { kind, id: record?.id ?? (weight ? `weight_${date}` : uuid()), baseVersion, data: updated }, kind, date, undefined, false, keepOpen);
  });
  $("#remove-record")?.addEventListener("click", () => deleteRecord(form, record));
}
