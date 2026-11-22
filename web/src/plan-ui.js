import { $, $$, thinMeter, equipment, esc, fmt, icon, muscles, options, progressionNames, shortDate, supersetBadges } from "./ui.js";

const weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function formatWeekdayZh(date) {
  const idx = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
  return weekdayNames[idx] ?? "";
}

export function addDaysIso(date, offset) {
  return new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}

const builtinDetailCache = new Map();

export async function resolveCatalogueMap(api, ids, existingMap = null) {
  const map = existingMap ?? new Map();
  const needed = new Set();
  for (const id of ids) {
    if (!id || map.has(id)) continue;
    const cached = builtinDetailCache.get(id);
    if (cached) map.set(id, cached);
    else needed.add(id);
  }
  const missing = [...needed];
  for (let i = 0; i < missing.length; i += 100) {
    const { items } = await api("/api/catalogue/exercises/details", {
      method: "POST",
      body: { ids: missing.slice(i, i + 100) },
    });
    for (const item of items) {
      builtinDetailCache.set(item.id, item);
      map.set(item.id, item);
    }
  }
  if (missing.some((id) => !map.has(id))) {
    const custom = await api("/api/records/exercise").catch(() => []);
    for (const { data } of custom) map.set(data.id, data);
  }
  return map;
}

function defaultPlannedExercise(exercise) {
  const timed = exercise?.mode === "timed";
  return {
    exerciseId: exercise.id,
    sets: 3,
    repsMin: timed ? 1 : 8,
    repsMax: timed ? 1 : 12,
    weight: null,
    seconds: timed ? 45 : 0,
    restSeconds: 90,
    targetRir: 2,
    progression: timed ? "manual" : "double",
    increment: 2.5,
    backupExerciseId: null,
    supersetGroup: null,
  };
}

function buildMuscleSummaryHtml(routinesList, activeIdx, activeSanitized, catalogueMap, opts = {}) {
  const { title = "全周肌群分布平衡", subNote = "推荐 10–20 组/部位", emptyHint = "", highlightRange = true } = opts;
  const tracked = new Set(["chest", "back", "legs", "shoulders", "arms", "core"]);
  const totalMap = new Map();
  let totalSets = 0;
  routinesList.forEach((r, idx) => {
    const exList = idx === activeIdx && activeSanitized ? activeSanitized : (r.exercises ?? []);
    for (const row of exList) {
      const ex = catalogueMap.get(row.exerciseId);
      if (!ex) continue;
      const sets = row.sets || 0;
      if (tracked.has(ex.muscle)) {
        totalMap.set(ex.muscle, (totalMap.get(ex.muscle) ?? 0) + sets);
        totalSets += sets;
      }
      for (const sec of ex.secondaryMuscles ?? []) {
        if (sec !== ex.muscle && tracked.has(sec)) {
          totalMap.set(sec, (totalMap.get(sec) ?? 0) + sets * 0.5);
        }
      }
    }
  });
  const chips = [...totalMap.entries()]
    .map(([k, v]) => [k, Math.round(v * 10) / 10])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!chips.length) {
    return `<small class="muted">${esc(emptyHint)}</small>`;
  }
  return `<div class="builder-muscle-head"><span>${esc(title)}（约 ${totalSets} 主项组）</span>${subNote ? `<small>${esc(subNote)}</small>` : ""}</div>
    <div class="builder-muscle-chips">${chips.map(([k, v]) => {
      const cls = highlightRange ? (v > 20 ? " is-high" : v >= 10 ? " is-opt" : "") : "";
      return `<span class="${cls}">${esc(muscles[k] ?? k)} <b>${fmt(v)}</b> 组</span>`;
    }).join("")}</div>`;
}

/**
 * Shared editable list of planned exercises with progression rules, PR baseline hints,
 * backup exercise selection, and inline catalogue search.
 */
function mountPlannedExerciseList({ api, host, items, catalogueMap, prMap, onChange }) {
  const ac = new AbortController();
  let activeSearchTimer = 0;
  let backupTargetIndex = -1;
  let pickerMuscle = "";
  let pickerEquipment = "";

  function sanitizeItems() {
    return items.map((row) => {
      const ex = catalogueMap.get(row.exerciseId);
      const timed = ex?.mode === "timed";
      const min = timed ? 1 : Math.max(1, Math.min(1000, Math.round(Number(row.repsMin) || 8)));
      const max = timed ? 1 : Math.max(min, Math.min(1000, Math.round(Number(row.repsMax) || min)));
      const rawRest = row.restSeconds === "" || row.restSeconds == null ? 90 : Number(row.restSeconds);
      return {
        exerciseId: row.exerciseId,
        sets: Math.max(1, Math.min(100, Math.round(Number(row.sets) || 3))),
        repsMin: min,
        repsMax: max,
        weight: row.weight === "" || row.weight == null ? null : Math.max(0, Number(row.weight)),
        seconds: timed ? Math.max(1, Math.min(86400, Math.round(Number(row.seconds) || 45))) : 0,
        restSeconds: Math.max(0, Math.min(900, Math.round(Number.isFinite(rawRest) ? rawRest : 90))),
        targetRir: Math.max(0, Math.min(10, Math.round(Number(row.targetRir ?? 2)))),
        progression: ["double", "linear", "greyskull", "manual"].includes(row.progression) ? row.progression : "double",
        increment: Math.max(0, Math.min(20, Number(row.increment ?? 2.5))),
        backupExerciseId: row.backupExerciseId && row.backupExerciseId !== row.exerciseId ? row.backupExerciseId : null,
        supersetGroup: row.supersetGroup ? String(row.supersetGroup).trim().slice(0, 16) : null,
      };
    });
  }

  function cleanPlanSupersetOrphans() {
    const counts = new Map();
    for (const r of items) {
      if (r.supersetGroup) counts.set(r.supersetGroup, (counts.get(r.supersetGroup) ?? 0) + 1);
    }
    for (const r of items) {
      if (r.supersetGroup && (counts.get(r.supersetGroup) ?? 0) < 2) r.supersetGroup = null;
    }
  }

  function togglePlanSupersetAt(index) {
    const row = items[index];
    if (!row) return;
    if (row.supersetGroup) {
      row.supersetGroup = null;
      cleanPlanSupersetOrphans();
      return;
    }
    if (items.length < 2) return;
    const prev = index > 0 ? items[index - 1] : null;
    if (prev?.supersetGroup) {
      row.supersetGroup = prev.supersetGroup;
      return;
    }
    const used = new Set(items.map((r) => r.supersetGroup).filter(Boolean));
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const nextCode = letters.find((ch) => !used.has(ch)) ?? `S${used.size + 1}`;
    row.supersetGroup = nextCode;
    const partner = items[index + 1] ?? items[index - 1];
    if (partner) partner.supersetGroup = nextCode;
    cleanPlanSupersetOrphans();
  }

  function prText(exerciseId) {
    const b = prMap?.get(exerciseId);
    if (!b) return "暂无 PR 基准";
    if (b.mode === "timed" && b.hold != null) return `最佳时长 ${b.hold} 秒`;
    if (b.mode === "assisted" && b.assistance != null) return `最低辅助 ${fmt(b.assistance)} kg`;
    if (b.weight != null) return `最佳 ${fmt(b.weight)} kg${b.oneRepMax ? ` · 1RM ${fmt(b.oneRepMax)} kg` : ""}`;
    return "暂无 PR 基准";
  }

  function render() {
    const ssBadges = supersetBadges(items);
    const rowsHtml = items.length ? items.map((row, index) => {
      const ex = catalogueMap.get(row.exerciseId);
      const mode = ex?.mode ?? "reps";
      const timed = mode === "timed";
      const backupEx = row.backupExerciseId ? catalogueMap.get(row.backupExerciseId) : null;
      const manual = row.progression === "manual" || timed;
      const ssBadge = ssBadges[index];
      return `<div class="plan-ex-row${ssBadge ? " has-superset" : ""}" data-ex-row="${index}">
        <div class="plan-ex-head">
          <div class="plan-ex-title">
            <span class="preview-index">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <div class="plan-ex-name-line">${ssBadge ? `<span class="superset-pill">超级组 ${esc(ssBadge)}</span>` : ""}<strong>${esc(ex?.name ?? row.exerciseId)}</strong></div>
              <small>${esc(muscles[ex?.muscle] ?? ex?.muscle ?? "")}${ex?.equipment ? ` · ${esc(equipment[ex.equipment] ?? ex.equipment)}` : ""} · ${icon("trophy", 11)} ${esc(prText(row.exerciseId))}</small>
            </div>
          </div>
          <div class="plan-ex-order">
            ${items.length > 1 || row.supersetGroup ? `<button type="button" class="quiet plan-ss-btn${row.supersetGroup ? " is-superset" : ""}" data-ex-act="toggle-superset" data-idx="${index}" title="串联超级组，训练时自动连续切换搭档">${row.supersetGroup ? `超级组 ${esc(ssBadge)} · 取消` : "超级组"}</button>` : ""}
            <button type="button" class="icon-button" data-ex-act="up" data-idx="${index}" aria-label="上移"${index === 0 ? " disabled" : ""}>${icon("arrowUp", 15)}</button>
            <button type="button" class="icon-button" data-ex-act="down" data-idx="${index}" aria-label="下移"${index === items.length - 1 ? " disabled" : ""}>${icon("arrowDown", 15)}</button>
            <button type="button" class="icon-button danger" data-ex-act="remove" data-idx="${index}" aria-label="删除动作">${icon("close", 15)}</button>
          </div>
        </div>
        <div class="plan-ex-grid">
          <label><span>组数</span><input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="50" step="1" data-ex-field="sets" data-idx="${index}" value="${row.sets}"></label>
          ${timed
            ? `<label><span>目标时长 (秒)</span><input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="3600" step="5" data-ex-field="seconds" data-idx="${index}" value="${row.seconds || 45}"></label>`
            : `<label><span>最低次</span><input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="200" step="1" data-ex-field="repsMin" data-idx="${index}" value="${row.repsMin}"></label>
               <label><span>上限次</span><input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="200" step="1" data-ex-field="repsMax" data-idx="${index}" value="${row.repsMax}"></label>
               <label><span>目标 kg</span><input type="number" inputmode="decimal" min="0" max="1000" step="0.5" placeholder="自动" data-ex-field="weight" data-idx="${index}" value="${row.weight ?? ""}"></label>`}
          <label><span>休息秒</span><input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="600" step="15" data-ex-field="restSeconds" data-idx="${index}" value="${row.restSeconds}"></label>
        </div>
        ${timed ? "" : `<div class="plan-prog-bar">
          <label><span>渐进规则</span>
            <select data-ex-field="progression" data-idx="${index}">${options(progressionNames, row.progression ?? "double")}</select>
          </label>
          <label><span>每次增量 kg</span>
            <input type="number" inputmode="decimal" min="0" max="20" step="0.25" data-ex-field="increment" data-idx="${index}" value="${row.increment ?? 2.5}"${manual ? " disabled" : ""}>
          </label>
          <label><span>目标 RIR</span>
            <input type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="10" step="1" data-ex-field="targetRir" data-idx="${index}" value="${row.targetRir ?? 2}"${manual ? " disabled" : ""}>
          </label>
          <div class="plan-backup-slot">
            <span>替补动作</span>
            <div class="plan-backup-actions">
              <button type="button" class="quiet" data-ex-act="pick-backup" data-idx="${index}">${icon("swap", 13)} ${backupEx ? esc(backupEx.name) : "设置替补"}</button>
              ${backupEx ? `<button type="button" class="icon-button" data-ex-act="clear-backup" data-idx="${index}" aria-label="清除替补">${icon("close", 13)}</button>` : ""}
            </div>
          </div>
        </div>`}
      </div>`;
    }).join("") : '<p class="muted plan-ex-empty">尚未添加动作，可从下方检索添加，或上方直接套用模板/计划日。</p>';

    const musclePills = { "": "全部", chest: "胸", back: "背", legs: "腿", shoulders: "肩", arms: "臂", core: "核心" };
    const equipPills = { "": "全部器械", barbell: "杠铃", dumbbell: "哑铃", machine: "器械", cable: "绳索", bodyweight: "自重", kettlebell: "壶铃", band: "弹力带" };
    host.innerHTML = `<div class="plan-ex-list">${rowsHtml}</div>
      <div class="plan-picker-box${backupTargetIndex >= 0 ? " is-backup-mode" : ""}">
        <div class="plan-picker-head">
          <strong>${backupTargetIndex >= 0 ? `为「${esc(catalogueMap.get(items[backupTargetIndex]?.exerciseId)?.name ?? "")}」选择替补动作` : "添加训练动作"}</strong>
          ${backupTargetIndex >= 0 ? `<button type="button" class="quiet" data-ex-act="cancel-backup">取消选择替补</button>` : ""}
        </div>
        <div class="muscle-pills picker-muscles" role="group" aria-label="按肌群筛选">${Object.entries(musclePills).map(([val, label]) =>
          `<button type="button" data-picker-m="${val}" aria-pressed="${pickerMuscle === val}">${label}</button>`).join("")}</div>
        <div class="muscle-pills picker-equipment" role="group" aria-label="按器械筛选">${Object.entries(equipPills).map(([val, label]) =>
          `<button type="button" data-picker-eq="${val}" aria-pressed="${pickerEquipment === val}">${label}</button>`).join("")}</div>
        <label class="search">${icon("search", 16)}<input type="search" enterkeyhint="search" maxlength="120" data-ex-query placeholder="搜索动作名，例如 卧推 / 深蹲 / 划船" aria-label="搜索训练动作"></label>
        <div class="picker-results" data-ex-results></div>
      </div>`;
  }

  let customCache = null;
  async function searchCatalogue(query) {
    const resultsEl = $("[data-ex-results]", host);
    if (!resultsEl) return;
    const trimmed = query.trim();
    const qs = new URLSearchParams({ q: trimmed, limit: "12" });
    if (pickerMuscle) qs.set("muscle", pickerMuscle);
    if (pickerEquipment) qs.set("equipment", pickerEquipment);
    try {
      const [data, customRows] = await Promise.all([
        api("/api/catalogue/exercises?" + qs, { token: "" }),
        customCache ?? api("/api/records/exercise").then((r) => { customCache = r; return r; }).catch(() => []),
      ]);
      const customMatches = customRows
        .filter((r) => !r.deleted && r.data)
        .map((r) => r.data)
        .filter((ex) => (!pickerMuscle || ex.muscle === pickerMuscle) && (!pickerEquipment || ex.equipment === pickerEquipment) &&
          (!trimmed || [ex.name, ex.englishName, ...(ex.aliases ?? [])].some((t) => String(t ?? "").toLowerCase().includes(trimmed.toLowerCase()))));
      const customIds = new Set(customMatches.map((ex) => ex.id));
      const combined = [...customMatches, ...data.items.filter((ex) => !customIds.has(ex.id))];
      for (const item of combined) catalogueMap.set(item.id, item);
      resultsEl.innerHTML = combined.length ? combined.map((item) => `
        <button type="button" class="pick-item" data-pick-id="${esc(item.id)}">
          <span><strong>${esc(item.name)}${item.custom ? ' <em class="custom-badge">自定义</em>' : ""}</strong><small>${esc(muscles[item.muscle] ?? item.muscle)} · ${esc(equipment[item.equipment] ?? item.equipment)}</small></span>
          <span class="pick-add">${backupTargetIndex >= 0 ? "设为替补" : "添加"}</span>
        </button>`).join("") : '<p class="muted">没有找到匹配的动作。</p>';
    } catch {
      resultsEl.innerHTML = '<p class="muted">暂时无法检索动作库。</p>';
    }
  }

  function currentQuery() {
    return $("[data-ex-query]", host)?.value ?? "";
  }

  function renderAndKeepSearch() {
    const query = currentQuery();
    render();
    const inputEl = $("[data-ex-query]", host);
    if (inputEl && query) inputEl.value = query;
    void searchCatalogue(query);
  }

  host.addEventListener("input", ({ target }) => {
    if (target.matches("[data-ex-query]")) {
      clearTimeout(activeSearchTimer);
      activeSearchTimer = setTimeout(() => void searchCatalogue(target.value), 160);
      return;
    }
    if (!target.dataset.exField) return;
    const idx = Number(target.dataset.idx);
    const field = target.dataset.exField;
    const row = items[idx];
    if (!row) return;
    if (field === "weight") {
      row.weight = target.value === "" ? null : Number(target.value);
    } else if (field === "progression") {
      row.progression = target.value;
      renderAndKeepSearch();
    } else {
      row[field] = Number(target.value);
    }
    onChange?.(sanitizeItems());
  }, { signal: ac.signal });

  host.addEventListener("change", ({ target }) => {
    if (!target.dataset.exField) return;
    const idx = Number(target.dataset.idx);
    const field = target.dataset.exField;
    const row = items[idx];
    if (!row) return;
    if (field === "progression") {
      row.progression = target.value;
      renderAndKeepSearch();
      onChange?.(sanitizeItems());
    }
  }, { signal: ac.signal });

  host.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target.matches?.("input")) {
      event.preventDefault();
    }
  }, { signal: ac.signal });

  host.addEventListener("click", async ({ target }) => {
    const muscleBtn = target.closest("[data-picker-m]");
    if (muscleBtn) {
      pickerMuscle = muscleBtn.dataset.pickerM;
      $$("[data-picker-m]", host).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pickerM === pickerMuscle)));
      void searchCatalogue(currentQuery());
      return;
    }
    const equipBtn = target.closest("[data-picker-eq]");
    if (equipBtn) {
      pickerEquipment = equipBtn.dataset.pickerEq;
      $$("[data-picker-eq]", host).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pickerEq === pickerEquipment)));
      void searchCatalogue(currentQuery());
      return;
    }
    const pickBtn = target.closest("[data-pick-id]");
    if (pickBtn) {
      const id = pickBtn.dataset.pickId;
      const ex = catalogueMap.get(id);
      if (!ex) return;
      if (backupTargetIndex >= 0 && items[backupTargetIndex]) {
        if (items[backupTargetIndex].exerciseId !== ex.id) {
          items[backupTargetIndex].backupExerciseId = ex.id;
        }
        backupTargetIndex = -1;
      } else {
        items.push(defaultPlannedExercise(ex));
        if (prMap && !prMap.has(ex.id)) {
          api("/api/web/exercise-prs", {
            method: "POST",
            body: { date: addDaysIso("2099-12-31", 0), startedAt: "2099-12-31T23:59:59Z", exercises: [{ id: ex.id, mode: ex.mode }] },
          }).then((reply) => {
            reply.forEach((b) => prMap.set(b.exerciseId, b));
            renderAndKeepSearch();
          }).catch(() => {});
        }
      }
      renderAndKeepSearch();
      onChange?.(sanitizeItems());
      return;
    }
    const actBtn = target.closest("[data-ex-act]");
    if (!actBtn) return;
    const idx = Number(actBtn.dataset.idx);
    const act = actBtn.dataset.exAct;
    if (act === "up" && idx > 0) [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
    if (act === "down" && idx < items.length - 1) [items[idx + 1], items[idx]] = [items[idx], items[idx + 1]];
    if (act === "remove") {
      items.splice(idx, 1);
      cleanPlanSupersetOrphans();
    }
    if (act === "toggle-superset") togglePlanSupersetAt(idx);
    if (act === "pick-backup") backupTargetIndex = idx;
    if (act === "clear-backup" && items[idx]) items[idx].backupExerciseId = null;
    if (act === "cancel-backup") backupTargetIndex = -1;
    renderAndKeepSearch();
    onChange?.(sanitizeItems());
  }, { signal: ac.signal });

  render();
  void searchCatalogue("");

  return {
    replaceItems(nextItems) {
      items.splice(0, items.length, ...nextItems.map((row) => ({ ...row })));
      backupTargetIndex = -1;
      renderAndKeepSearch();
      onChange?.(sanitizeItems());
    },
    getSanitized: sanitizeItems,
    destroy() {
      clearTimeout(activeSearchTimer);
      ac.abort();
    },
  };
}

/**
 * Render the 14-day Schedule Horizon and Weekly Muscle Forecast inside #plan.
 */
export function renderScheduleHorizon({ scheduleData, todayDate }) {
  if (!scheduleData) return '<p class="muted">暂时无法加载排期数据。</p>';
  const { days, weekForecast } = scheduleData;
  const upcoming = days.filter((d) => d.date >= todayDate);
  const maxMuscle = Math.max(12, ...(weekForecast?.muscles ?? []).map((m) => m.total));

  const muscleForecastHtml = weekForecast ? `<section class="panel forecast-card">
    <header class="panel-head">
      <div><h2>本周肌群负荷预测</h2><p>${shortDate(weekForecast.weekStart)} – ${shortDate(weekForecast.weekEnd)} · 已完成 + 未来排期</p></div>
      <span class="status-pill">${upcoming.filter((d) => d.status === "scheduled" || d.status === "projected").length} 场待练</span>
    </header>
    <div class="forecast-grid">${weekForecast.muscles.map((m) => `<div class="forecast-row">
      <span class="forecast-name">${esc(muscles[m.key] ?? m.key)}</span>
      <div class="forecast-bar">${thinMeter(m.total / maxMuscle)}</div>
      <span class="forecast-num">${m.completed}${m.planned ? `<i>+${m.planned}</i>` : ""} 组</span>
    </div>`).join("")}</div>
    ${weekForecast.conflicts?.length ? `<p class="forecast-conflict">${icon("bolt", 14)} ${esc(weekForecast.conflicts.join("；"))}</p>` : ""}
  </section>` : "";

  const timelineHtml = `<section class="panel horizon-card">
    <header class="panel-head">
      <div><h2>未来 14 天排期日程</h2><p>点击任意日期可直接调整训练日、设为休息或顺延安排</p></div>
    </header>
    <div class="horizon-list">${upcoming.map((day) => {
      const isToday = day.date === todayDate;
      const badgeCls = day.status === "completed" ? "is-done" : day.status === "scheduled" ? "is-manual" : day.status === "projected" ? "is-plan" : "is-rest";
      const badgeLabel = day.status === "completed" ? "已完成" : day.status === "scheduled" ? "手动排期" : day.status === "projected" ? "计划顺排" : day.source === "rest" ? "休息日" : "待安排";
      const hasRoutine = day.status === "scheduled" || day.status === "projected";
      const meta = hasRoutine
        ? `${day.exercisesCount} 动作 · 约 ${day.estimatedMinutes} 分钟${day.muscles.length ? ` · ${day.muscles.map((m) => muscles[m] ?? m).join("/")}` : ""}`
        : day.notes || (day.status === "completed" ? "已计入本周完成" : "可点击排训练或保持恢复");
      return `<div class="horizon-row${isToday ? " is-today" : ""}${day.status === "scheduled" ? " is-manual-row" : ""}">
        <div class="horizon-date">
          <strong>${shortDate(day.date)}</strong>
          <span>${isToday ? "今天" : formatWeekdayZh(day.date)}</span>
        </div>
        <div class="horizon-main">
          <div class="horizon-title"><span class="drawer-badge ${badgeCls}">${badgeLabel}</span><strong>${esc(day.title)}</strong></div>
          <small>${esc(meta)}</small>
        </div>
        <div class="horizon-actions">
          ${day.status !== "completed" ? `<button type="button" class="secondary-button" data-action="schedule-day" data-value="${esc(day.date)}">${hasRoutine ? "调整" : "排训练"}</button>` : ""}
          ${hasRoutine ? `<button type="button" class="quiet" data-action="schedule-preview" data-value="${esc(day.date)}">动作/PR</button>
            <button type="button" class="quiet" data-action="schedule-shift" data-value="${esc(day.date)}">顺延</button>` : ""}
        </div>
      </div>`;
    }).join("")}</div>
  </section>`;

  return `<div class="horizon-layout">${muscleForecastHtml}${timelineHtml}</div>`;
}

/**
 * Open interactive Day Scheduler Sheet for any date (future or unworked today).
 */
export async function openDayScheduler({ api, date, todayDate, open, dialog, notify, onSaved, onStartPreview }) {
  open(`${shortDate(date)} · ${formatWeekdayZh(date)} 排期安排`, '<div class="empty loading" role="status">正在读取当日排期与 PR 基准…</div>', true, "report");
  try {
    const rangeFrom = addDaysIso(date, -6);
    const rangeThrough = addDaysIso(date, 13);
    const [detail, schedule, workouts] = await Promise.all([
      api(`/api/web/schedule/${encodeURIComponent(date)}`),
      api(`/api/web/schedule?${new URLSearchParams({ from: rangeFrom, through: rangeThrough })}`),
      api("/api/records/workout").catch(() => []),
    ]);
    if (!dialog.open) return;

    const initialExercises = detail.override?.data?.mode === "workout"
      ? detail.override.data.exercises
      : detail.day?.routine?.exercises ?? [];
    const allIds = [
      ...initialExercises.flatMap((e) => [e.exerciseId, e.backupExerciseId].filter(Boolean)),
      ...(schedule.activePlan?.routines ?? []).flatMap((r) => r.exercises.map((e) => e.exerciseId)),
    ];
    const catalogueMap = await resolveCatalogueMap(api, allIds);
    const prList = allIds.length ? await api("/api/web/exercise-prs", {
      method: "POST",
      body: { date: addDaysIso(todayDate, 1), startedAt: `${addDaysIso(todayDate, 1)}T23:59:59Z`, exercises: [...new Set(allIds)].map((id) => ({ id })) },
    }).catch(() => []) : [];
    const prMap = new Map(prList.map((b) => [b.exerciseId, b]));
    if (!dialog.open) return;

    const currentDay = detail.day;
    const isRest = detail.override?.data?.mode === "rest" || (!currentDay?.routine && currentDay?.source === "rest");
    let currentTitle = detail.override?.data?.title || (currentDay?.routine ? currentDay.title : "");
    let currentPlanId = detail.override?.data?.planId ?? currentDay?.planId ?? null;
    let currentRoutineId = detail.override?.data?.routineId ?? currentDay?.routineId ?? null;
    let currentTemplateId = detail.override?.data?.templateId ?? null;
    const baseVersion = detail.override?.version ?? 0;

    const completedRecent = workouts
      .filter((w) => w.data.status === "completed" && w.data.exercises?.length)
      .sort((a, b) => b.data.date.localeCompare(a.data.date))
      .slice(0, 5);

    const planChips = (schedule.activePlan?.routines ?? []).map((r, i) =>
      `<button type="button" class="ai-chip" data-sched-preset="plan" data-idx="${i}">${esc(r.name)}</button>`).join("");
    const tplChips = (schedule.templates ?? []).map((t, i) =>
      `<button type="button" class="ai-chip" data-sched-preset="template" data-idx="${i}">模板 · ${esc(t.name)}</button>`).join("");
    const recentChips = completedRecent.map((w, i) =>
      `<button type="button" class="ai-chip" data-sched-preset="history" data-idx="${i}">${shortDate(w.data.date)} ${esc(w.data.title)}</button>`).join("");

    const conflicts = detail.weekForecast?.conflicts ?? [];
    const telemetry = detail.telemetry;

    open(`${shortDate(date)} · ${formatWeekdayZh(date)} 排期安排`, `<form id="day-scheduler-form" class="dialog-form scheduler-form">
      <div class="scheduler-telemetry">
        <div class="preview-meta">
          <span class="meta-accent">${currentDay.status === "scheduled" ? "当前：手动排期" : currentDay.status === "projected" ? "当前：计划顺排" : isRest ? "当前：休息日" : "当前：未安排"}</span>
          ${detail.adjacent?.previous ? `<span>前一日：${esc(detail.adjacent.previous.title)}</span>` : ""}
          ${detail.adjacent?.next ? `<span>次日：${esc(detail.adjacent.next.title)}</span>` : ""}
          ${telemetry?.summary?.prOpportunityCount ? `<span class="meta-pr">${icon("trophy", 12)} 预计 ${telemetry.summary.prOpportunityCount} 个 PR 突破点</span>` : ""}
          ${telemetry?.summary?.deloadCount ? `<span class="meta-warn">${icon("bolt", 12)} 含 ${telemetry.summary.deloadCount} 个减载提示</span>` : ""}
        </div>
        ${conflicts.length ? `<p class="forecast-conflict">${icon("bolt", 14)} ${esc(conflicts[0])}（可下方更换分化或顺延至后天）</p>` : ""}
      </div>

      ${(planChips || tplChips || recentChips) ? `<section class="scheduler-presets">
        <span>快速排入</span>
        <div class="ai-presets">${planChips}${tplChips}${recentChips}</div>
      </section>` : ""}

      <div class="scheduler-mode-bar">
        <div class="fields scheduler-meta-fields">
          <label class="field"><span>训练日标题</span><input name="title" maxlength="120" value="${esc(currentTitle)}" placeholder="例如：推 · 胸肩三头 / 弱项补充"></label>
          <label class="field"><span>备注 / 重点提示（可选）</span><input name="notes" maxlength="1000" value="${esc(detail.override?.data?.notes ?? "")}" placeholder="例如：卧推重点冲击 75kg · 注意肩胛下沉"></label>
        </div>
        <div class="scheduler-quick-ops">
          <button type="button" class="secondary-button" data-sched-op="rest">${icon("rest", 15)} 设为休息日</button>
          ${currentDay?.routine ? `<button type="button" class="secondary-button" data-sched-op="shift">${icon("chevron", 15)} 顺延+1天</button>` : ""}
          ${detail.override ? `<button type="button" class="quiet" data-sched-op="clear">恢复按计划自动</button>` : ""}
          ${currentDay?.routine && onStartPreview ? `<button type="button" class="quiet" data-sched-op="preview">${icon("trending", 14)} 渐进与 PR 预览</button>` : ""}
        </div>
      </div>

      <section class="form-section">
        <h3 class="form-section-title">动作处方与渐进规则</h3>
        <div id="sched-ex-host"></div>
      </section>

      <p class="form-error" role="alert" hidden></p>
      <footer class="dialog-foot">
        <button type="button" class="secondary-button" data-action="close">取消</button>
        <button type="submit" class="primary-button">保存排期</button>
      </footer>
    </form>`, true, "report");

    const form = $("#day-scheduler-form", dialog);
    const listApi = mountPlannedExerciseList({
      api,
      host: $("#sched-ex-host", form),
      items: initialExercises.map((e) => ({ ...e })),
      catalogueMap,
      prMap,
    });

    form.addEventListener("click", async ({ target }) => {
      const preset = target.closest("[data-sched-preset]");
      if (preset) {
        const err = $(".form-error", form);
        if (err) err.hidden = true;
        try {
          const kind = preset.dataset.schedPreset;
          const idx = Number(preset.dataset.idx);
          const collectIds = (list) => list.flatMap((e) => [e.exerciseId, e.backupExerciseId].filter(Boolean));
          if (kind === "plan") {
            const r = schedule.activePlan.routines[idx];
            if (r) {
              currentTitle = r.name;
              currentPlanId = schedule.activePlan.id;
              currentRoutineId = r.id;
              currentTemplateId = null;
              form.elements.title.value = r.name;
              await resolveCatalogueMap(api, collectIds(r.exercises), catalogueMap);
              listApi.replaceItems(r.exercises);
            }
          } else if (kind === "template") {
            const t = schedule.templates[idx];
            if (t) {
              currentTitle = t.name;
              currentPlanId = null;
              currentRoutineId = null;
              currentTemplateId = t.id;
              form.elements.title.value = t.name;
              await resolveCatalogueMap(api, collectIds(t.exercises), catalogueMap);
              listApi.replaceItems(t.exercises);
            }
          } else if (kind === "history") {
            const w = completedRecent[idx];
            if (w) {
              currentTitle = w.data.title;
              currentPlanId = w.data.planId ?? null;
              currentRoutineId = w.data.routineId ?? null;
              currentTemplateId = null;
              form.elements.title.value = w.data.title;
              const ids = w.data.exercises.map((e) => e.exerciseId);
              await resolveCatalogueMap(api, ids, catalogueMap);
              const copied = w.data.exercises.map((exRow) => {
                const info = catalogueMap.get(exRow.exerciseId);
                const timed = info?.mode === "timed";
                const work = exRow.sets.filter((s) => s.completed && s.type !== "warmup");
                const topWeight = work.length ? Math.max(...work.map((s) => s.weight)) : null;
                const reps = work.length ? Math.max(...work.map((s) => s.reps)) : 8;
                return {
                  exerciseId: exRow.exerciseId,
                  sets: Math.max(1, work.length || exRow.sets.length || 3),
                  repsMin: timed ? 1 : Math.max(1, Math.min(reps, 12)),
                  repsMax: timed ? 1 : Math.max(Math.min(reps + 2, 15), reps, 10),
                  weight: timed ? null : topWeight,
                  seconds: timed ? Math.max(15, ...exRow.sets.map((s) => s.seconds || 0)) : 0,
                  restSeconds: exRow.restSeconds ?? 90,
                  targetRir: 2,
                  progression: timed ? "manual" : "double",
                  increment: 2.5,
                  backupExerciseId: null,
                  supersetGroup: exRow.supersetGroup ?? null,
                };
              });
              listApi.replaceItems(copied);
            }
          }
        } catch (problem) {
          if (err) {
            err.textContent = problem.message;
            err.hidden = false;
          }
        }
        return;
      }

      const op = target.closest("[data-sched-op]")?.dataset.schedOp;
      if (!op) return;
      const err = $(".form-error", form);
      err.hidden = true;
      try {
        if (op === "rest") {
          await api(`/api/web/schedule/${encodeURIComponent(date)}`, {
            method: "PUT",
            body: {
              mode: "rest",
              title: "休息日",
              notes: form.elements.notes.value.trim(),
              exercises: [],
              baseVersion,
            },
          });
          dialog.close();
          await onSaved?.(date);
          notify(`${shortDate(date)} 已设为休息日`);
        } else if (op === "shift") {
          const nextDate = addDaysIso(date, 1);
          await api("/api/web/schedule/shift", { method: "POST", body: { fromDate: date, toDate: nextDate } });
          dialog.close();
          await onSaved?.(nextDate);
          notify(`已顺延至 ${shortDate(nextDate)}`);
        } else if (op === "clear") {
          await api(`/api/web/schedule/${encodeURIComponent(date)}`, { method: "DELETE" });
          dialog.close();
          await onSaved?.(date);
          notify(`${shortDate(date)} 已恢复默认顺排`);
        } else if (op === "preview") {
          onStartPreview?.(date);
        }
      } catch (problem) {
        err.textContent = problem.message;
        err.hidden = false;
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const err = $(".form-error", form);
      err.hidden = true;
      const exercises = listApi.getSanitized();
      const title = form.elements.title.value.trim() || "自定义排期训练";
      if (!exercises.length) {
        err.textContent = "请添加至少一个训练动作";
        err.hidden = false;
        return;
      }
      const submitBtn = $('button[type="submit"]', form);
      submitBtn.disabled = true;
      try {
        await api(`/api/web/schedule/${encodeURIComponent(date)}`, {
          method: "PUT",
          body: {
            mode: "workout",
            title,
            planId: currentPlanId,
            routineId: currentRoutineId,
            templateId: currentTemplateId,
            notes: form.elements.notes.value.trim(),
            exercises,
            baseVersion,
          },
        });
        dialog.close();
        await onSaved?.(date);
        notify(`${shortDate(date)} 训练排期已保存`);
      } catch (problem) {
        err.textContent = problem.message;
        err.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
  } catch (error) {
    if (dialog.open) dialog.close();
    notify(error.message);
  }
}

/**
 * Manual Multi-Week Plan Builder & Editor (creates draft and optionally applies immediately).
 */
export async function openPlanBuilder({ api, existingPlan, catalogueMap: initialMap, open, dialog, notify, onSaved }) {
  const isEdit = Boolean(existingPlan?.data);
  const src = existingPlan?.data;
  const catalogueMap = new Map(initialMap ?? []);

  const planDraft = {
    name: src?.name ? src.name : "自定义力量分化",
    weeks: src?.weeks ?? 6,
    schedule: src?.schedule ?? "rotation",
    weekdays: src?.weekdays?.length ? [...src.weekdays] : [1],
    rationale: src?.rationale || "按动作渐进规则推进负荷，完成全组上限次数与目标 RIR 后自动加重。",
    parentId: existingPlan?.id ?? null,
    routines: src?.routines?.length
      ? src.routines.map((r) => ({ id: r.id, name: r.name, exercises: r.exercises.map((e) => ({ ...e })) }))
      : [{ id: "routine_0", name: "训练日 A", exercises: [] }],
  };
  let activeRoutineIdx = 0;
  let listApi = null;

  const ids = planDraft.routines.flatMap((r) => r.exercises.flatMap((e) => [e.exerciseId, e.backupExerciseId].filter(Boolean)));
  await resolveCatalogueMap(api, ids, catalogueMap);
  const prList = ids.length ? await api("/api/web/exercise-prs", {
    method: "POST",
    body: { date: "2099-12-31", startedAt: "2099-12-31T23:59:59Z", exercises: [...new Set(ids)].map((id) => ({ id })) },
  }).catch(() => []) : [];
  const prMap = new Map(prList.map((b) => [b.exerciseId, b]));

  open(isEdit ? "编辑训练计划" : "新建训练计划", `<form id="plan-builder-form" class="dialog-form scheduler-form">
    <div class="plan-builder-top">
      <label class="field"><span>计划名称</span><input name="name" maxlength="120" required value="${esc(planDraft.name)}"></label>
      <label class="field"><span>周期周数</span><input name="weeks" type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="52" required value="${planDraft.weeks}"></label>
      <label class="field"><span>排期模式</span><select name="schedule">${options({ rotation: "按顺序轮换", weekdays: "按固定星期" }, planDraft.schedule)}</select></label>
    </div>
    <label class="field"><span>计划说明 / 渐进思路</span><textarea name="rationale" rows="2" maxlength="8000" required>${esc(planDraft.rationale)}</textarea></label>

    <div class="plan-routine-bar">
      <div class="plan-routine-tabs" data-routine-tabs role="tablist" aria-label="训练日列表"></div>
      <button type="button" class="secondary-button" data-builder="add-routine">${icon("plus", 15)} 加训练日</button>
    </div>
    <div class="builder-muscle-summary" data-builder-muscles></div>

    <div class="plan-routine-meta">
      <label class="field"><span>当前训练日名称</span><input name="routineName" maxlength="120" required></label>
      <label class="field" data-weekday-wrap${planDraft.schedule === "weekdays" ? "" : " hidden"}><span>安排星期</span>
        <select name="routineWeekday">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}">${weekdayNames[d - 1]}</option>`).join("")}</select>
      </label>
      <div class="plan-routine-ops">
        <button type="button" class="quiet" data-builder="move-routine" data-dir="-1" aria-label="前移此训练日">← 前移</button>
        <button type="button" class="quiet" data-builder="move-routine" data-dir="1" aria-label="后移此训练日">后移 →</button>
        <button type="button" class="quiet" data-builder="dup-routine">${icon("copy", 13)} 复制训练日</button>
        <button type="button" class="quiet danger" data-builder="del-routine">删除此训练日</button>
      </div>
    </div>

    <section class="form-section">
      <h3 class="form-section-title">当日动作与渐进配置</h3>
      <div id="builder-ex-host"></div>
    </section>

    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot">
      <button type="submit" class="secondary-button" value="draft">仅存草稿</button>
      <button type="submit" class="primary-button" value="apply">保存并立即启用</button>
    </footer>
  </form>`, true, "report");

  const form = $("#plan-builder-form", dialog);
  const tabsHost = $("[data-routine-tabs]", form);
  const routineNameInput = form.elements.routineName;
  const weekdayWrap = $("[data-weekday-wrap]", form);
  const weekdaySelect = form.elements.routineWeekday;
  const delRoutineBtn = $('[data-builder="del-routine"]', form);
  const dupRoutineBtn = $('[data-builder="dup-routine"]', form);
  const movePrevBtn = $('[data-builder="move-routine"][data-dir="-1"]', form);
  const moveNextBtn = $('[data-builder="move-routine"][data-dir="1"]', form);
  const muscleSummaryEl = $("[data-builder-muscles]", form);

  function renderWeeklyMuscleSummary() {
    if (!muscleSummaryEl) return;
    muscleSummaryEl.innerHTML = buildMuscleSummaryHtml(
      planDraft.routines,
      activeRoutineIdx,
      listApi ? listApi.getSanitized() : null,
      catalogueMap,
      {
        title: "全周肌群分布平衡",
        subNote: "推荐 10–20 组/部位",
        emptyHint: "每周肌群分布平衡：添加动作后实时计算各部位有效组数（推荐每部位 10–20 组/周）",
        highlightRange: true,
      },
    );
  }

  function syncCurrentRoutineToState() {
    const r = planDraft.routines[activeRoutineIdx];
    if (!r) return;
    r.name = routineNameInput.value.trim() || `训练日 ${activeRoutineIdx + 1}`;
    if (listApi) r.exercises = listApi.getSanitized();
    if (planDraft.schedule === "weekdays") {
      planDraft.weekdays[activeRoutineIdx] = Number(weekdaySelect.value);
    }
  }

  function renderTabs() {
    tabsHost.innerHTML = planDraft.routines.map((r, i) => `<button type="button" class="routine-tab" data-routine-idx="${i}" aria-selected="${i === activeRoutineIdx}">
      <span>${esc(r.name)}</span>${planDraft.schedule === "weekdays" ? `<small>${weekdayNames[(planDraft.weekdays[i] || (i % 7) + 1) - 1]}</small>` : ""}
    </button>`).join("");
    const active = planDraft.routines[activeRoutineIdx];
    routineNameInput.value = active.name;
    weekdayWrap.hidden = planDraft.schedule !== "weekdays";
    if (planDraft.schedule === "weekdays") {
      if (!planDraft.weekdays[activeRoutineIdx]) {
        const used = new Set(planDraft.weekdays);
        planDraft.weekdays[activeRoutineIdx] = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? ((activeRoutineIdx % 7) + 1);
      }
      weekdaySelect.value = String(planDraft.weekdays[activeRoutineIdx]);
    }
    delRoutineBtn.disabled = planDraft.routines.length <= 1;
    if (dupRoutineBtn) dupRoutineBtn.disabled = planDraft.routines.length >= 7;
    if (movePrevBtn) movePrevBtn.disabled = activeRoutineIdx <= 0;
    if (moveNextBtn) moveNextBtn.disabled = activeRoutineIdx >= planDraft.routines.length - 1;
  }

  function mountCurrentExercises() {
    listApi?.destroy?.();
    const active = planDraft.routines[activeRoutineIdx];
    listApi = mountPlannedExerciseList({
      api,
      host: $("#builder-ex-host", form),
      items: active.exercises.map((e) => ({ ...e })),
      catalogueMap,
      prMap,
      onChange: (next) => { active.exercises = next; renderWeeklyMuscleSummary(); },
    });
    renderWeeklyMuscleSummary();
  }

  form.elements.schedule.addEventListener("change", () => {
    planDraft.schedule = form.elements.schedule.value;
    if (planDraft.schedule === "weekdays") {
      const used = new Set();
      planDraft.weekdays = planDraft.routines.map((_, idx) => {
        const cur = planDraft.weekdays[idx];
        if (cur && !used.has(cur)) { used.add(cur); return cur; }
        const pick = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? ((idx % 7) + 1);
        used.add(pick);
        return pick;
      });
    }
    renderTabs();
  });

  routineNameInput.addEventListener("input", () => {
    planDraft.routines[activeRoutineIdx].name = routineNameInput.value.trim() || `训练日 ${activeRoutineIdx + 1}`;
    const btn = $(`[data-routine-idx="${activeRoutineIdx}"] span`, tabsHost);
    if (btn) btn.textContent = planDraft.routines[activeRoutineIdx].name;
  });

  weekdaySelect.addEventListener("change", () => {
    planDraft.weekdays[activeRoutineIdx] = Number(weekdaySelect.value);
    renderTabs();
  });

  form.addEventListener("click", ({ target }) => {
    const tab = target.closest("[data-routine-idx]");
    if (tab) {
      syncCurrentRoutineToState();
      activeRoutineIdx = Number(tab.dataset.routineIdx);
      renderTabs();
      mountCurrentExercises();
      return;
    }
    const actBtn = target.closest("[data-builder]");
    const act = actBtn?.dataset.builder;
    if (act === "add-routine" && planDraft.routines.length < 7) {
      syncCurrentRoutineToState();
      const idx = planDraft.routines.length;
      const used = new Set(planDraft.weekdays);
      const nextWd = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? 1;
      planDraft.routines.push({
        id: `routine_${Date.now().toString(36)}_${idx}`,
        name: `训练日 ${String.fromCharCode(65 + idx)}`,
        exercises: [],
      });
      if (planDraft.schedule === "weekdays") planDraft.weekdays.push(nextWd);
      activeRoutineIdx = planDraft.routines.length - 1;
      renderTabs();
      mountCurrentExercises();
    } else if (act === "dup-routine" && planDraft.routines.length < 7) {
      syncCurrentRoutineToState();
      const srcRoutine = planDraft.routines[activeRoutineIdx];
      if (!srcRoutine) return;
      const idx = planDraft.routines.length;
      const used = new Set(planDraft.weekdays);
      const nextWd = [1, 2, 3, 4, 5, 6, 7].find((w) => !used.has(w)) ?? 1;
      planDraft.routines.push({
        id: `routine_${Date.now().toString(36)}_${idx}`,
        name: `${srcRoutine.name} (副本)`.slice(0, 120),
        exercises: srcRoutine.exercises.map((e) => ({ ...e })),
      });
      if (planDraft.schedule === "weekdays") planDraft.weekdays.push(nextWd);
      activeRoutineIdx = planDraft.routines.length - 1;
      renderTabs();
      mountCurrentExercises();
    } else if (act === "move-routine") {
      syncCurrentRoutineToState();
      const dir = Number(actBtn.dataset.dir);
      const nextIdx = activeRoutineIdx + dir;
      if (nextIdx < 0 || nextIdx >= planDraft.routines.length) return;
      [planDraft.routines[activeRoutineIdx], planDraft.routines[nextIdx]] = [planDraft.routines[nextIdx], planDraft.routines[activeRoutineIdx]];
      if (planDraft.schedule === "weekdays") {
        [planDraft.weekdays[activeRoutineIdx], planDraft.weekdays[nextIdx]] = [planDraft.weekdays[nextIdx], planDraft.weekdays[activeRoutineIdx]];
      }
      activeRoutineIdx = nextIdx;
      renderTabs();
      mountCurrentExercises();
    } else if (act === "del-routine" && planDraft.routines.length > 1) {
      planDraft.routines.splice(activeRoutineIdx, 1);
      planDraft.weekdays.splice(activeRoutineIdx, 1);
      activeRoutineIdx = Math.max(0, activeRoutineIdx - 1);
      renderTabs();
      mountCurrentExercises();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncCurrentRoutineToState();
    const err = $(".form-error", form);
    err.hidden = true;
    const mode = event.submitter?.value || "apply";

    const emptyRoutine = planDraft.routines.find((r) => !r.exercises.length);
    if (emptyRoutine) {
      err.textContent = `「${emptyRoutine.name}」至少需要添加 1 个动作`;
      err.hidden = false;
      return;
    }
    if (planDraft.schedule === "weekdays" && new Set(planDraft.weekdays).size !== planDraft.routines.length) {
      err.textContent = "按固定星期执行时，每个训练日需要对应不同的星期";
      err.hidden = false;
      return;
    }

    const buttons = $$('button[type="submit"]', form);
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const payload = {
        name: form.elements.name.value.trim(),
        weeks: Number(form.elements.weeks.value),
        schedule: planDraft.schedule,
        weekdays: planDraft.schedule === "weekdays" ? planDraft.weekdays.slice(0, planDraft.routines.length) : [],
        routines: planDraft.routines,
        rationale: form.elements.rationale.value.trim() || "手动规划训练分化与渐进参数。",
        source: "manual",
        parentId: planDraft.parentId,
      };
      const draftRes = await api("/api/plans/drafts", { method: "POST", body: payload });
      if (mode === "apply" && draftRes?.record) {
        const active = await api("/api/plans/active").catch(() => null);
        await api("/api/plans/apply", {
          method: "POST",
          body: {
            id: draftRes.record.id,
            version: draftRes.record.version,
            expectedRevision: active?.revision ?? 0,
          },
        });
      }
      dialog.close();
      await onSaved?.(mode === "apply" ? "current" : "drafts");
      notify(mode === "apply" ? "训练计划已保存并启用" : "训练计划已存为草稿");
    } catch (problem) {
      err.textContent = problem.message;
      err.hidden = false;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  });

  renderTabs();
  mountCurrentExercises();
}

/**
 * Standalone Workout Template Editor (creates or edits saved templates with progression & supersets).
 */
export async function openTemplateEditor({ api, existingTemplate, catalogueMap: initialMap, open, dialog, notify, onSaved }) {
  const isEdit = Boolean(existingTemplate?.data);
  const src = existingTemplate?.data;
  const tplId = existingTemplate?.id ?? ("tpl_" + crypto.randomUUID().slice(0, 12));
  const baseVersion = existingTemplate?.version ?? 0;
  const catalogueMap = new Map(initialMap ?? []);
  const items = (src?.exercises ?? []).map((e) => ({ ...e }));

  const ids = items.flatMap((e) => [e.exerciseId, e.backupExerciseId].filter(Boolean));
  await resolveCatalogueMap(api, ids, catalogueMap);
  const prList = ids.length ? await api("/api/web/exercise-prs", {
    method: "POST",
    body: { date: "2099-12-31", startedAt: "2099-12-31T23:59:59Z", exercises: [...new Set(ids)].map((id) => ({ id })) },
  }).catch(() => []) : [];
  const prMap = new Map(prList.map((b) => [b.exerciseId, b]));

  open(isEdit ? "编辑训练模板" : "新建训练模板", `<form id="template-editor-form" class="dialog-form scheduler-form">
    <label class="field"><span>模板名称</span><input name="name" maxlength="120" required value="${esc(src?.name ?? "")}" placeholder="例如：推 · 胸肩三头、居家哑铃全身"></label>
    <div class="builder-muscle-summary" data-template-muscles></div>
    <section class="form-section">
      <h3 class="form-section-title">模板动作、渐进规则与超级组</h3>
      <div id="template-ex-host"></div>
    </section>
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot">
      <button type="button" class="secondary-button" data-action="close">取消</button>
      <button type="submit" class="primary-button">保存模板</button>
    </footer>
  </form>`, true, "report");

  const form = $("#template-editor-form", dialog);
  const muscleEl = $("[data-template-muscles]", form);
  let listApi = null;

  function renderTemplateMuscles(sanitized) {
    if (!muscleEl) return;
    muscleEl.innerHTML = buildMuscleSummaryHtml(
      [{ exercises: sanitized ?? items }],
      0,
      sanitized ?? items,
      catalogueMap,
      {
        title: "本模板肌群有效组数",
        subNote: "",
        emptyHint: "添加动作后将实时汇总本模板各部位工作组分布",
        highlightRange: false,
      },
    );
  }

  listApi = mountPlannedExerciseList({
    api,
    host: $("#template-ex-host", form),
    items,
    catalogueMap,
    prMap,
    onChange: (next) => renderTemplateMuscles(next),
  });
  renderTemplateMuscles(listApi.getSanitized());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const err = $(".form-error", form);
    err.hidden = true;
    const exercises = listApi.getSanitized();
    const name = form.elements.name.value.trim();
    if (!name) {
      err.textContent = "请填写模板名称";
      err.hidden = false;
      return;
    }
    if (!exercises.length) {
      err.textContent = "请至少添加 1 个训练动作";
      err.hidden = false;
      return;
    }
    const submitBtn = $('button[type="submit"]', form);
    submitBtn.disabled = true;
    try {
      await api("/api/records", {
        method: "POST",
        body: {
          opId: crypto.randomUUID(),
          id: tplId,
          kind: "template",
          baseVersion,
          deleted: false,
          data: { id: tplId, name, exercises },
        },
      });
      dialog.close();
      await onSaved?.();
      notify(isEdit ? `已更新模板「${name}」` : `已保存模板「${name}」`);
    } catch (problem) {
      err.textContent = problem.message;
      err.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
