import { $, $$, esc, fmt, today, shortDate, icon, field, input, inputGroup, meals } from "./ui.js";

/** Ordered body-measurement specs `[fieldKey, label, minCm, maxCm]`. */
export const measurementSpecs = [
  ["waistCm", "腰围", 30, 250],
  ["chestCm", "胸围", 40, 250],
  ["armCm", "臂围", 15, 100],
  ["thighCm", "大腿围", 25, 150],
  ["hipCm", "臀围", 40, 250],
];

/** Render a compact inline SVG sparkline for a body measurement series. */
export function measureSparkSvg(values) {
  if (values.length < 2) return "";
  const w = 72;
  const h = 22;
  const p = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.2, max - min);
  const pts = values.map((v, i) => {
    const x = p + (i / (values.length - 1)) * (w - p * 2);
    const y = h - p - ((v - min) / span) * (h - p * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts.at(-1).split(",");
  return `<svg class="measure-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polyline fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}"/>
    <circle cx="${lx}" cy="${ly}" r="2.2" fill="currentColor"/>
  </svg>`;
}

/** Render the body measurements archive card with WHR/WHtR chips and trend tiles. */
export function renderMeasurementsSection(measurements = [], heightCm = null) {
  const asc = [...measurements].reverse();
  let latestWaist = null;
  let latestHip = null;
  for (const row of asc) {
    if (row.waistCm != null) latestWaist = row.waistCm;
    if (row.hipCm != null) latestHip = row.hipCm;
  }
  const whr = latestWaist && latestHip ? (latestWaist / latestHip) : null;
  const whtr = latestWaist && heightCm ? (latestWaist / heightCm) : null;
  const ratiosHtml = (whr || whtr) ? `<div class="measure-ratios">
    ${whr ? `<span class="measure-ratio-chip">腰臀比 WHR <b>${whr.toFixed(2)}</b></span>` : ""}
    ${whtr ? `<span class="measure-ratio-chip${whtr < 0.5 ? " is-good" : " is-warn"}">腰高比 WHtR <b>${whtr.toFixed(2)}</b><small>${whtr < 0.5 ? "健康区间" : "偏高"}</small></span>` : ""}
  </div>` : "";
  const tiles = measurementSpecs.map(([key, label]) => {
    const vals = asc.map((r) => r[String(key)]).filter((v) => v != null);
    const firstVal = vals[0] ?? null;
    const latestVal = vals.at(-1) ?? null;
    const diff = latestVal != null && firstVal != null && vals.length > 1
      ? Math.round((latestVal - firstVal) * 10) / 10
      : null;
    const diffCls = diff == null ? "" : key === "waistCm" ? (diff < 0 ? " is-good" : diff > 0 ? " is-warn" : "") : (diff > 0 ? " is-up" : diff < 0 ? " is-down" : "");
    return `<div class="measure-tile">
      <span>${label}</span>
      <strong>${latestVal != null ? `${fmt(latestVal, 1)} <small>cm</small>` : "—"}</strong>
      ${measureSparkSvg(vals)}
      ${diff != null ? `<small class="measure-diff${diffCls}">${diff > 0 ? "+" : ""}${fmt(diff, 1)} cm</small>` : "<small class='measure-diff'>暂无对比</small>"}
    </div>`;
  }).join("");

  return `<section class="panel measurements-panel" aria-label="身体围度档案">
    <header class="panel-head">
      <div><h2>身体围度档案</h2><p>${measurements.length ? `已记 ${measurements.length} 次围度 · 追踪腰围/维度重塑变化` : "记录腰围、胸围、臂围、大腿围、臀围（cm），观察减脂增肌真实变化"}</p></div>
      <button type="button" class="secondary-button" data-action="add-measurement">${icon("plus", 15)} 记录围度</button>
    </header>
    ${measurements.length ? `${ratiosHtml}<div class="measure-tiles">${tiles}</div>
      <div class="measure-history-list">${measurements.slice(0, 8).map((m) => {
        const parts = measurementSpecs
          .filter(([k]) => m[String(k)] != null)
          .map(([k, lbl]) => `${lbl} ${fmt(m[String(k)], 1)}`);
        return `<button type="button" class="record-line measure-line" data-action="edit-measurement" data-value="${esc(m.date)}">
          <time datetime="${esc(m.date)}">${shortDate(m.date)}</time>
          <span><strong>${esc(parts.join(" · "))}</strong>${m.notes ? `<small>${esc(m.notes)}</small>` : ""}</span>
          ${icon("chevron", 15)}
        </button>`;
      }).join("")}</div>` : ""}
  </section>`;
}

/** Create dialog modal handlers for saved meal templates and body-measurement records. */
export function createDietWeightModals({
  api,
  open,
  dialog,
  notify,
  openConfirmDialog,
  onMealTemplateSaved,
  onMeasurementChanged,
}) {
  function openSaveMealTemplateModal(meal, entries) {
    const totalCal = Math.round(entries.reduce((s, r) => s + r.data.calories, 0));
    const defaultName = entries.length === 1 ? entries[0].data.name : `${meals[meal]}搭配 · ${entries[0].data.name}`.slice(0, 48);
    open("存为常用餐单", `<form id="meal-tpl-form" class="dialog-form">
      ${field("餐单名称", input("name", defaultName, 'maxlength="120" required autofocus'))}
      <div class="meal-tpl-preview">
        <small>包含 ${entries.length} 项食材 · 共 ${fmt(totalCal, 0)} kcal</small>
        <ul>${entries.map((r) => `<li><span>${esc(r.data.name)}</span><span>${fmt(r.data.calories, 0)} kcal</span></li>`).join("")}</ul>
      </div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-foot">
        <button type="button" class="quiet" data-action="close">取消</button>
        <button type="submit" class="primary-button">保存餐单模板</button>
      </footer>
    </form>`);
    const form = /** @type {HTMLFormElement} */ ($("#meal-tpl-form", dialog));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = String(new FormData(form).get("name") ?? "").trim();
      if (!name) return;
      const btn = /** @type {HTMLButtonElement} */ ($('button[type="submit"]', form));
      const err = /** @type {HTMLElement} */ ($(".form-error", form));
      btn.disabled = true;
      err.hidden = true;
      try {
        const foods = entries.slice(0, 30).map((r) => ({
          name: r.data.name,
          calories: r.data.calories,
          protein: r.data.protein,
          carbs: r.data.carbs,
          fat: r.data.fat,
          source: "manual",
          rawPrompt: "",
        }));
        const id = "mealTpl_" + crypto.randomUUID().slice(0, 12);
        const res = await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id, kind: "mealTemplate", baseVersion: 0, deleted: false, data: { name, foods } } });
        dialog.close();
        onMealTemplateSaved?.("create", res.record ?? null);
        notify(`已存为常用餐单「${name}」`);
      } catch (error) {
        err.textContent = error.message;
        err.hidden = false;
      } finally { btn.disabled = false; }
    });
  }

  function openEditMealTemplateModal(tpl) {
    let foods = (tpl.data.foods ?? []).map((f) => ({
      name: f.name ?? "",
      calories: Number(f.calories) || 0,
      protein: Number(f.protein) || 0,
      carbs: Number(f.carbs) || 0,
      fat: Number(f.fat) || 0,
    }));
    if (!foods.length) foods = [{ name: "", calories: 0, protein: 0, carbs: 0, fat: 0 }];

    open("编辑常用餐单", `<form id="edit-meal-tpl-form" class="dialog-form">
      ${field("餐单名称", input("name", tpl.data.name ?? "", 'maxlength="120" required'))}
      <div class="meal-tpl-edit-head">
        <small data-tpl-totals></small>
        <button type="button" class="quiet" id="meal-tpl-add-item">${icon("plus", 14)} 添加一项</button>
      </div>
      <div class="meal-tpl-edit-list" id="meal-tpl-edit-rows"></div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-foot">
        <button type="button" class="quiet" data-action="close">取消</button>
        <button type="submit" class="primary-button">保存修改</button>
      </footer>
    </form>`, true);

    const form = /** @type {HTMLFormElement} */ ($("#edit-meal-tpl-form", dialog));
    const rowsHost = $("#meal-tpl-edit-rows", form);
    const totalsEl = $("[data-tpl-totals]", form);
    const err = /** @type {HTMLElement} */ ($(".form-error", form));

    function syncDomToFoods() {
      foods = $$("[data-tpl-food-row]", rowsHost).map((el) => ({
        name: String(/** @type {HTMLInputElement | null} */ ($('[data-f="name"]', el))?.value ?? "").trim(),
        calories: Math.max(0, Number(/** @type {HTMLInputElement | null} */ ($('[data-f="calories"]', el))?.value) || 0),
        protein: Math.max(0, Number(/** @type {HTMLInputElement | null} */ ($('[data-f="protein"]', el))?.value) || 0),
        carbs: Math.max(0, Number(/** @type {HTMLInputElement | null} */ ($('[data-f="carbs"]', el))?.value) || 0),
        fat: Math.max(0, Number(/** @type {HTMLInputElement | null} */ ($('[data-f="fat"]', el))?.value) || 0),
      }));
    }

    function updateTotals() {
      const kcal = Math.round(foods.reduce((s, f) => s + (Number(f.calories) || 0), 0));
      const prot = Math.round(foods.reduce((s, f) => s + (Number(f.protein) || 0), 0) * 10) / 10;
      if (totalsEl) totalsEl.textContent = `共 ${foods.length} 项 · 约 ${fmt(kcal, 0)} kcal · 蛋白 ${fmt(prot, 1)} g`;
    }

    function drawFoodRows() {
      rowsHost.innerHTML = foods.map((f, idx) => `<div class="meal-tpl-edit-row" data-tpl-food-row="${idx}">
        <label class="tpl-food-name"><span>食物名称</span><input data-f="name" maxlength="120" required value="${esc(f.name)}" placeholder="例如：鸡胸肉 150g"></label>
        <label><span>千卡</span><input data-f="calories" type="number" inputmode="decimal" min="0" max="50000" step="1" required value="${f.calories}"></label>
        <label><span>蛋白g</span><input data-f="protein" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required value="${f.protein}"></label>
        <label><span>碳水g</span><input data-f="carbs" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required value="${f.carbs}"></label>
        <label><span>脂肪g</span><input data-f="fat" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required value="${f.fat}"></label>
        <button type="button" class="quiet icon-button tpl-food-del" data-tpl-del="${idx}" aria-label="删除第 ${idx + 1} 项"${foods.length <= 1 ? " disabled" : ""}>${icon("close", 15)}</button>
      </div>`).join("");
      updateTotals();
    }

    rowsHost.addEventListener("input", () => { syncDomToFoods(); updateTotals(); });
    rowsHost.addEventListener("click", ({ target }) => {
      const delBtn = /** @type {HTMLElement | null} */ (/** @type {Element} */ (target).closest("[data-tpl-del]"));
      if (!delBtn || foods.length <= 1) return;
      syncDomToFoods();
      foods.splice(Number(delBtn.dataset.tplDel), 1);
      drawFoodRows();
    });
    $("#meal-tpl-add-item", form)?.addEventListener("click", () => {
      if (foods.length >= 30) { notify("每个常用餐单最多保存 30 项食物"); return; }
      syncDomToFoods();
      foods.push({ name: "", calories: 0, protein: 0, carbs: 0, fat: 0 });
      drawFoodRows();
      /** @type {HTMLElement | undefined} */ ($$('[data-f="name"]', rowsHost).at(-1))?.focus({ preventScroll: true });
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      syncDomToFoods();
      err.hidden = true;
      const nameInput = /** @type {HTMLInputElement | null} */ (form.elements.namedItem("name"));
      const name = String(nameInput?.value ?? "").trim();
      const cleaned = foods.filter((f) => f.name.length > 0).slice(0, 30).map((f) => ({
        ...f, source: "manual", rawPrompt: "",
      }));
      if (!name || !cleaned.length) {
        err.textContent = "请填写餐单名称并保留至少 1 项有效食物。";
        err.hidden = false;
        return;
      }
      const submitBtn = /** @type {HTMLButtonElement} */ ($('button[type="submit"]', form));
      submitBtn.disabled = true;
      try {
        const res = await api("/api/records", {
          method: "POST",
          body: { opId: crypto.randomUUID(), id: tpl.id, kind: "mealTemplate", baseVersion: tpl.version, deleted: false, data: { name, foods: cleaned } },
        });
        dialog.close();
        onMealTemplateSaved?.("update", res.record ?? null, tpl.id);
        notify(`已更新常用餐单「${name}」`);
      } catch (error) {
        err.textContent = error.message;
        err.hidden = false;
      } finally { submitBtn.disabled = false; }
    });

    drawFoodRows();
  }

  function openMeasurementModal(existing = null) {
    const initialDate = existing?.date ?? today();
    open(existing ? `编辑 ${shortDate(initialDate)} 围度` : "记录身体围度", `<form id="measurement-form" class="dialog-form">
      ${field("测量日期", `<input type="date" name="date" value="${esc(initialDate)}" min="1902-01-01" max="${today()}" required ${existing ? "readonly" : ""}>`)}
      <div class="fields">${measurementSpecs.map(([k, lbl, minVal, maxVal]) =>
        field(lbl, inputGroup(k, existing?.[String(k)] ?? "", "cm", `type="number" inputmode="decimal" step="0.1" min="${minVal}" max="${maxVal}"`))).join("")}</div>
      ${field("测量备注（可选）", input("notes", existing?.notes ?? "", 'maxlength="300" placeholder="例如：晨起空腹、冷态测量"'))}
      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-foot${existing ? " has-remove" : ""}">
        ${existing ? `<button type="button" class="danger" id="delete-measurement">删除记录</button>` : ""}
        <button type="submit" class="primary-button">保存围度</button>
      </footer>
    </form>`);
    const form = /** @type {HTMLFormElement} */ ($("#measurement-form", dialog));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const vals = new FormData(form);
      const num = (key) => {
        const raw = String(vals.get(key) ?? "").trim();
        return raw === "" ? null : Number(raw);
      };
      const payload = {
        date: String(vals.get("date")),
        waistCm: num("waistCm"),
        chestCm: num("chestCm"),
        armCm: num("armCm"),
        thighCm: num("thighCm"),
        hipCm: num("hipCm"),
        notes: String(vals.get("notes") ?? "").trim(),
      };
      const btn = /** @type {HTMLButtonElement} */ ($('button[type="submit"]', form));
      const err = /** @type {HTMLElement} */ ($(".form-error", form));
      btn.disabled = true;
      err.hidden = true;
      try {
        await api("/api/web/measurements", { method: "PUT", body: payload });
        dialog.close();
        await onMeasurementChanged?.();
        notify("身体围度已保存");
      } catch (problem) {
        err.textContent = problem.message;
        err.hidden = false;
      } finally { btn.disabled = false; }
    });
    $("#delete-measurement", form)?.addEventListener("click", () => {
      openConfirmDialog({
        title: "删除围度记录",
        message: `确定要删除 ${shortDate(existing.date)} 的身体围度记录吗？`,
        confirmLabel: "删除记录",
        onConfirm: async () => {
          await api("/api/web/measurements/" + encodeURIComponent(existing.date), { method: "DELETE" });
          dialog.close();
          await onMeasurementChanged?.();
          notify("已删除围度记录");
        },
      });
    });
  }

  return {
    openSaveMealTemplateModal,
    openEditMealTemplateModal,
    openMeasurementModal,
  };
}
