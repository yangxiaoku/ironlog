import { dotMeter, duration, esc, feelings, fmt, icon, meals, muscles, shortDate, workoutSeconds } from "./ui.js";
import { matrix } from "./display.js";
import { appleLine, renderAppleDailyStrip } from "./apple-health-ui.js";
import { formatWeekdayZh } from "./plan-ui.js";

/**
 * Format a full workout title cleanly for desktop/wide calendar cells.
 */
export function fullWorkoutTag(title) {
  if (!title) return "";
  return title
    .replace(/\s*等\s*\d+\s*项$/, "")
    .trim()
    .replace(/\s*·\s*/g, "·")
    .replace(/传统力量训练/, "力量训练")
    .replace(/高强度间歇/, "HIIT");
}

/**
 * Compress a workout title to fit cleanly inside a narrow 7-column mobile calendar cell.
 */
export function compactWorkoutTag(title) {
  if (!title) return "";
  let clean = title.replace(/\s*等\s*\d+\s*项$/, "").trim();
  const parts = clean.split(/\s*[·\-/]\s*/);
  if (parts.length >= 2 && parts[0].length <= 2 && parts[1].length >= 2) {
    // e.g. "拉 · 背和二头" -> "拉·背二", "推 · 胸肩三头" -> "推·胸肩", "腿 · 下肢力量" -> "腿·下肢"
    const sub = parts[1].replace(/[与和及]/g, "").slice(0, 2);
    return `${parts[0]}·${sub}`;
  }
  clean = clean.replace(/\s*·\s*/g, "·");
  if (clean.length > 4) {
    clean = clean.replace(/传统力量训练/, "力量").replace(/混合有氧/, "有氧").replace(/高强度间歇/, "HIIT").replace(/功能性力量/, "功能");
  }
  return clean;
}

function groupByDate(items, getDate) {
  const map = new Map();
  for (const item of items ?? []) {
    const d = getDate(item);
    if (!d) continue;
    let list = map.get(d);
    if (!list) { list = []; map.set(d, list); }
    list.push(item);
  }
  return map;
}

function workoutStats(data, catalogueMap) {
  let volume = 0;
  let completedSets = 0;
  const exercises = [];
  for (const row of data.exercises ?? []) {
    const exInfo = row.snapshot ?? catalogueMap?.get(row.exerciseId);
    const name = exInfo?.name ?? row.exerciseId;
    const mode = exInfo?.mode ?? "reps";
    const mult = exInfo?.volumeMultiplier ?? 1;
    const work = (row.sets ?? []).filter((s) => s.completed && s.type !== "warmup");
    const done = (row.sets ?? []).filter((s) => s.completed);
    completedSets += work.length;
    if (mode === "reps") {
      for (const s of work) {
        if (s.weight > 0 && s.reps > 0) volume += s.weight * s.reps * mult;
      }
    }
    let best = `${done.length} 组`;
    if (work.length) {
      if (mode === "timed") {
        best = `${Math.max(...work.map((s) => s.seconds || 0))}s`;
      } else {
        let top = work[0];
        for (let i = 1; i < work.length; i++) {
          const s = work[i];
          const w = s.weight || 0;
          const tw = top.weight || 0;
          const r = s.reps || 0;
          const tr = top.reps || 0;
          const better = mode === "assisted"
            ? (w < tw || (w === tw && r > tr))
            : (w > tw || (w === tw && r > tr));
          if (better) top = s;
        }
        const topW = top.weight || 0;
        const topR = top.reps || 0;
        best = topW > 0
          ? `${mode === "assisted" ? "助" : ""}${fmt(topW)}kg×${topR}`
          : topR > 0 ? `${topR}次` : `${work.length} 组`;
      }
    }
    exercises.push({ name, sets: done.length || row.sets?.length || 0, best });
  }
  return {
    volume: Math.round(volume * 10) / 10,
    completedSets,
    seconds: workoutSeconds(data),
    exercises,
  };
}

/**
 * Compute aggregate monthly telemetry for workouts, calories, full-nutrition days, and planned sessions.
 */
export function computeMonthSummary({
  month,
  days,
  workouts,
  diets,
  appleEntries,
  nutritionDays,
  schedByDate,
  todayKey,
  workoutsByDate,
  appleByDate,
  dietsByDate,
}) {
  let workoutDays = 0;
  let totalWorkouts = 0;
  let totalSeconds = 0;
  let calorieDays = 0;
  let totalCalories = 0;
  let completeDietDays = 0;
  let futurePlannedCount = 0;

  const wMap = workoutsByDate ?? groupByDate(workouts, (r) => r.data?.date);
  const aMap = appleByDate ?? groupByDate((appleEntries ?? []).filter((a) => !a.manualWorkoutId), (a) => a.date);
  const dMap = dietsByDate ?? groupByDate(diets, (r) => r.data?.date);

  const completeMarkerSet = new Set(
    (nutritionDays ?? [])
      .filter((r) => !r.deleted && r.data?.complete)
      .map((r) => r.data.date),
  );

  for (let i = 0; i < days; i++) {
    const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
    const wList = wMap.get(iso) ?? [];
    const aList = aMap.get(iso) ?? [];
    const dList = dMap.get(iso) ?? [];
    const sched = schedByDate.get(iso);

    if (wList.length || aList.length) {
      workoutDays++;
      totalWorkouts += wList.length + aList.length;
      for (const w of wList) totalSeconds += workoutSeconds(w.data) ?? 0;
      for (const a of aList) totalSeconds += a.durationSeconds ?? 0;
    }
    if (dList.length) {
      calorieDays++;
      totalCalories += dList.reduce((sum, r) => sum + (r.data.calories || 0), 0);
      if (completeMarkerSet.has(iso)) completeDietDays++;
    }
    if (iso >= todayKey && !wList.length && !aList.length && (sched?.status === "scheduled" || sched?.status === "projected")) {
      futurePlannedCount++;
    }
  }

  return {
    workoutDays,
    totalWorkouts,
    totalSeconds,
    calorieDays,
    avgCalories: calorieDays ? Math.round(totalCalories / calorieDays) : 0,
    completeDietDays,
    futurePlannedCount,
  };
}

const APPLE_DAILY_TELEMETRY_KEYS = [
  "sleepMinutes", "weightKg", "bodyFatPct", "waistCm", "steps",
  "activeEnergyKcal", "totalEnergyKcal", "restingHeartRateBpm",
  "hrvMs", "bloodOxygenPct", "respiratoryRate", "vo2Max",
];
const hasAppleTelemetry = (daily) => Boolean(daily && APPLE_DAILY_TELEMETRY_KEYS.some((k) => daily[k] != null));

/**
 * Render the Full-Day Dossier card body (used both inside desktop .calendar-detail and mobile modal sheet).
 */
export function renderDayDossier({
  date,
  todayKey,
  workouts,
  appleEntries,
  appleDaily = null,
  appleHealthConnected = true,
  diets,
  weightRecord,
  nutritionComplete,
  goals,
  daySched,
  schedSummary,
  catalogueMap,
  inModal = false,
}) {
  const isFuture = date > todayKey;
  const totalKcal = Math.round(diets.reduce((sum, r) => sum + (r.data.calories || 0), 0));
  const totalP = Math.round(diets.reduce((sum, r) => sum + (r.data.protein || 0), 0));
  const totalC = Math.round(diets.reduce((sum, r) => sum + (r.data.carbs || 0), 0));
  const totalF = Math.round(diets.reduce((sum, r) => sum + (r.data.fat || 0), 0));
  const targetKcal = goals?.calories ?? 2200;

  let dayVolume = 0;
  let daySeconds = 0;
  const workoutStatsList = workouts.map((rec) => {
    const st = workoutStats(rec.data, catalogueMap);
    dayVolume += st.volume;
    daySeconds += st.seconds ?? 0;
    return { rec, st };
  });
  for (const ap of appleEntries) daySeconds += ap.durationSeconds ?? 0;

  const hasTrained = workouts.length > 0 || appleEntries.length > 0;
  const hasPlanned = !hasTrained && date >= todayKey && (schedSummary?.status === "scheduled" || schedSummary?.status === "projected");
  const isRest = !hasTrained && !hasPlanned && schedSummary?.source === "rest";

  const kpiTrainVal = hasTrained
    ? `${workouts.length + appleEntries.length} 场`
    : hasPlanned ? "已排期"
    : isRest ? "休息" : "—";
  const kpiTrainSub = hasTrained
    ? (dayVolume > 0 ? `${fmt(dayVolume)} kg` : daySeconds > 0 ? duration(daySeconds) : "已打卡")
    : hasPlanned ? `${schedSummary.exercisesCount} 个动作` : isRest ? "主动恢复" : "未训练";
  const kpiKcalVal = diets.length ? fmt(totalKcal, 0) : "—";
  const kpiKcalSub = diets.length ? `目标 ${fmt(targetKcal, 0)}` : isFuture ? "未来日期" : "未记录饮食";
  const kpiWeightVal = weightRecord
    ? `${fmt(weightRecord.data.weight, 2)}`
    : appleDaily?.weightKg != null ? `${fmt(appleDaily.weightKg, 2)}` : "—";
  const kpiWeightSub = weightRecord
    ? (weightRecord.data.bodyFat != null ? `体脂 ${fmt(weightRecord.data.bodyFat)}%` : "kg · 点击修改")
    : appleDaily?.weightKg != null
      ? `Apple 同步${appleDaily.bodyFatPct != null ? ` · ${fmt(appleDaily.bodyFatPct, 1)}%` : ""}`
      : "未称重";

  // Section 1: Training / Schedule details
  let trainingSection = "";
  if (hasTrained) {
    const manualCards = workoutStatsList.map(({ rec, st }) => `<article class="dossier-workout-card">
      <header>
        <div>
          <strong>${esc(rec.data.title)}</strong>
          <small>${rec.data.status === "active" ? "进行中" : duration(st.seconds)}${rec.data.feeling ? ` · ${feelings[rec.data.feeling]}` : ""}${st.volume > 0 ? ` · ${fmt(st.volume)} kg` : ""}</small>
        </div>
        <button type="button" class="quiet" data-action="edit-record" data-kind="workout" data-value="${esc(rec.id)}">查看详情 ${icon("chevron", 13)}</button>
      </header>
      ${st.exercises.length ? `<ul class="dossier-ex-list">${st.exercises.map((ex) => `<li>
        <span>${esc(ex.name)}</span>
        <small>${ex.sets} 组 · ${esc(ex.best)}</small>
      </li>`).join("")}</ul>` : ""}
    </article>`).join("");
    const appleCards = appleEntries.map((ap) => appleLine(ap)).join("");
    trainingSection = `<section class="dossier-block">
      <header class="dossier-head">
        <h3>${icon("workout", 15)} 训练明细</h3>
        ${!isFuture ? `<button type="button" class="quiet" data-action="edit-for-date" data-value="${esc(date)}">${icon("plus", 14)} 补录训练</button>` : ""}
      </header>
      <div class="dossier-cards">${manualCards}${appleCards}</div>
    </section>`;
  } else if (date >= todayKey) {
    if (hasPlanned) {
      const tel = daySched?.telemetry;
      const conflicts = daySched?.weekForecast?.conflicts ?? [];
      trainingSection = `<section class="dossier-block">
        <header class="dossier-head">
          <h3>${icon("plan", 15)} 排期训练</h3>
          <span class="drawer-badge${schedSummary.status === "scheduled" ? " is-manual" : " is-plan"}">${schedSummary.status === "scheduled" ? "手动排期" : "计划顺排"}</span>
        </header>
        <div class="cal-schedule-preview">
          <div class="hero-drawer-title"><strong>${esc(schedSummary.title)}</strong></div>
          <div class="hero-drawer-tags"><span>${schedSummary.exercisesCount} 个动作</span><span>约 ${schedSummary.estimatedMinutes} 分钟</span>${tel?.summary?.progressionCount ? `<span>${tel.summary.progressionCount} 项渐进</span>` : ""}${tel?.summary?.prOpportunityCount ? `<span>${tel.summary.prOpportunityCount} 个 PR 机会</span>` : ""}</div>
          ${conflicts.length ? `<p class="forecast-conflict">${icon("bolt", 13)} ${esc(conflicts[0])}</p>` : ""}
          ${tel?.exercises?.length ? `<ol class="cal-ex-preview">${tel.exercises.map((ex, idx) => `<li>
            <span><b>${String(idx + 1).padStart(2, "0")}</b> ${esc(ex.exercise?.name ?? ex.item.exerciseId)}</span>
            <small>${ex.item.sets}组 · ${ex.exercise?.mode === "timed" ? `${ex.seconds}秒` : `${ex.weight ? fmt(ex.weight) + "kg × " : ""}${ex.reps}次`} · ${esc(ex.progression.statusLabel)}</small>
          </li>`).join("")}</ol>` : ""}
          <div class="hero-drawer-actions">
            <button type="button" class="primary-button" data-action="schedule-day" data-value="${esc(date)}">调整排期</button>
            <button type="button" class="secondary-button" data-action="schedule-preview" data-value="${esc(date)}">${date === todayKey ? "开始训练" : "动作与 PR"}</button>
            <button type="button" class="quiet" data-action="schedule-shift" data-value="${esc(date)}">顺延+1</button>
            <button type="button" class="quiet" data-action="schedule-rest" data-value="${esc(date)}">设休息</button>
          </div>
        </div>
      </section>`;
    } else {
      trainingSection = `<section class="dossier-block">
        <header class="dossier-head">
          <h3>${icon("plan", 15)} ${isRest ? "休息日 · 主动恢复" : "训练排期"}</h3>
          <button type="button" class="secondary-button" data-action="schedule-day" data-value="${esc(date)}">${icon("plus", 14)} 排训练</button>
        </header>
        <p class="muted dossier-empty-note">${esc(schedSummary?.notes || "当天暂未安排训练，可一键排入计划日或训练模板。")}</p>
        ${daySched?.override ? `<div class="hero-drawer-actions"><button type="button" class="quiet" data-action="schedule-clear" data-value="${esc(date)}">恢复默认顺排</button></div>` : ""}
      </section>`;
    }
  } else {
    trainingSection = `<section class="dossier-block">
      <header class="dossier-head">
        <h3>${icon("workout", 15)} 训练记录</h3>
        <button type="button" class="quiet" data-action="edit-for-date" data-value="${esc(date)}">${icon("plus", 14)} 补录训练</button>
      </header>
      <p class="muted dossier-empty-note">这一天暂无训练记录，可随时补录。</p>
    </section>`;
  }

  // Section 2: Nutrition & Calories details
  let dietSection = "";
  if (diets.length) {
    const ratio = targetKcal > 0 ? totalKcal / targetKcal : 0;
    const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
    const sortedDiets = [...diets].sort((a, b) => (mealOrder[a.data.meal] ?? 9) - (mealOrder[b.data.meal] ?? 9));
    const mealRows = sortedDiets.map((rec) => `<button type="button" class="dossier-meal-row" data-action="edit-record" data-kind="diet" data-value="${esc(rec.id)}">
      <span class="dossier-meal-tag">${esc(meals[rec.data.meal] ?? rec.data.meal)}</span>
      <span class="dossier-meal-copy"><strong>${esc(rec.data.name)}</strong><small>蛋 ${fmt(rec.data.protein, 0)}g · 碳 ${fmt(rec.data.carbs, 0)}g · 脂 ${fmt(rec.data.fat, 0)}g</small></span>
      <span class="dossier-meal-kcal">${fmt(rec.data.calories, 0)} <small>kcal</small></span>
    </button>`).join("");

    dietSection = `<section class="dossier-block">
      <header class="dossier-head">
        <h3>${icon("diet", 15)} 饮食与热量</h3>
        <div class="dossier-head-right">
          ${nutritionComplete ? '<span class="tile-badge">全天完整</span>' : (!isFuture ? `<button type="button" class="quiet" data-action="complete-diet" data-date="${esc(date)}">标记完整</button>` : "")}
          ${!isFuture ? `<button type="button" class="quiet" data-action="record-meal" data-value="snack">${icon("plus", 14)} 记饮食</button>` : ""}
        </div>
      </header>
      <div class="dossier-kcal-summary">
        <div class="dossier-kcal-main">
          <strong>${fmt(totalKcal, 0)} <small>kcal</small></strong>
          <span>目标 ${fmt(targetKcal, 0)} kcal</span>
        </div>
        ${dotMeter(ratio, 14)}
        <div class="dossier-macros">
          <span>蛋白 <b>${fmt(totalP, 0)}g</b></span>
          <span>碳水 <b>${fmt(totalC, 0)}g</b></span>
          <span>脂肪 <b>${fmt(totalF, 0)}g</b></span>
        </div>
      </div>
      <div class="dossier-meal-list">${mealRows}</div>
    </section>`;
  } else if (!isFuture) {
    dietSection = `<section class="dossier-block">
      <header class="dossier-head">
        <h3>${icon("diet", 15)} 饮食与热量</h3>
        <button type="button" class="quiet" data-action="record-meal" data-value="lunch">${icon("plus", 14)} 记饮食</button>
      </header>
      <p class="muted dossier-empty-note">当天暂无饮食记录。</p>
    </section>`;
  }

  // Section 3: Weight strip
  const weightSection = !isFuture ? `<section class="dossier-block dossier-weight-row">
    <span class="dossier-weight-label">${icon("weight", 15)} 当日体重</span>
    ${weightRecord
      ? `<button type="button" class="quiet" data-action="edit-record" data-kind="weight" data-value="${esc(weightRecord.id)}"><b>${fmt(weightRecord.data.weight, 2)} kg</b>${weightRecord.data.bodyFat != null ? ` · 体脂 ${fmt(weightRecord.data.bodyFat)}%` : ""} ${icon("chevron", 13)}</button>`
      : appleDaily?.weightKg != null
        ? `<button type="button" class="quiet" data-action="edit-weight-date" data-value="${esc(date)}" data-weight="${esc(appleDaily.weightKg)}"${appleDaily.bodyFatPct != null ? ` data-bodyfat="${esc(appleDaily.bodyFatPct)}"` : ""}>${icon("heart", 14)} 转入 Apple ${fmt(appleDaily.weightKg, 2)} kg</button>`
        : `<button type="button" class="quiet" data-action="edit-weight-date" data-value="${esc(date)}">${icon("plus", 14)} 记体重</button>`}
  </section>` : "";

  // Section 4: Apple Health Daily Metrics
  const showDailyStrip = Boolean(appleDaily && hasAppleTelemetry(appleDaily) && (appleHealthConnected || hasAppleTelemetry(appleDaily)));
  const appleDailySection = !isFuture && showDailyStrip ? renderAppleDailyStrip(appleDaily, { compact: true }) : "";

  const diffDays = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(todayKey + "T00:00:00Z")) / 86400000);
  const relLabel = diffDays === 0 ? "今天" : diffDays === -1 ? "昨天" : diffDays === 1 ? "明天"
    : diffDays < 0 ? `${Math.abs(diffDays)} 天前` : `${diffDays} 天后`;
  const stepperBar = inModal ? `<div class="dossier-day-stepper">
    <button type="button" class="quiet day-step-btn" data-action="dossier-step" data-step="-1" data-date="${esc(date)}">${icon("back", 14)} 前一天</button>
    <span class="dossier-step-date"><strong>${esc(relLabel)}</strong>${diffDays !== 0 ? `<button type="button" class="dossier-today-chip" data-action="dossier-step" data-step="0" data-date="${esc(todayKey)}">回今天</button>` : ""}</span>
    <button type="button" class="quiet day-step-btn" data-action="dossier-step" data-step="1" data-date="${esc(date)}">后一天 ${icon("chevron", 14)}</button>
  </div>` : "";

  const modalShareFoot = inModal && !isFuture
    ? `<div class="dossier-share-foot"><button type="button" class="secondary-button" data-action="share-day-record" data-value="${esc(date)}">${icon("download", 15)} 分享记录</button></div>`
    : "";

  return `<div class="cal-dossier${inModal ? " in-modal" : ""}" data-dossier-date="${esc(date)}">
    ${stepperBar}
    <div class="dossier-kpis">
      <div><span>训练</span><strong>${esc(kpiTrainVal)}</strong><small>${esc(kpiTrainSub)}</small></div>
      <div><span>摄入热量</span><strong>${esc(kpiKcalVal)}</strong><small>${esc(kpiKcalSub)}</small></div>
      <div><span>体重</span><strong>${esc(kpiWeightVal)}</strong><small>${esc(kpiWeightSub)}</small></div>
    </div>
    ${trainingSection}
    ${dietSection}
    ${weightSection}
    ${appleDailySection}
    ${modalShareFoot}
  </div>`;
}

export function renderCalendarDetailPanel({ date, todayKey, dossierHtml }) {
  const detailHeaderAction = date <= todayKey
    ? `<div class="dossier-head-right"><button type="button" class="secondary-button" data-action="share-day-record" data-value="${esc(date)}">${icon("download", 14)} 分享记录</button><button type="button" class="quiet" data-action="open-day-dossier" data-value="${esc(date)}">当日详情</button></div>`
    : `<button type="button" class="secondary-button" data-action="schedule-day" data-value="${esc(date)}">${icon("plus", 16)} 排训练</button>`;

  return `<section class="panel calendar-detail">
    <header class="panel-head">
      <div>
        <h2>${shortDate(date)} <small>${formatWeekdayZh(date)}</small></h2>
      </div>
      ${detailHeaderAction}
    </header>
    ${dossierHtml}
  </section>`;
}

/**
 * Render the complete stylized Calendar View HTML.
 */
export function renderCalendarView({
  month,
  beginning,
  days,
  date,
  todayKey,
  maxMonth,
  lens,
  workouts,
  diets,
  weights,
  nutritionDays,
  appleEntries,
  appleDailyMap = null,
  appleHealthConnected = true,
  schedByDate,
  daySched,
  goals,
  catalogueMap,
  segmentsHtml,
}) {
  const standalone = appleEntries.filter((row) => !row.manualWorkoutId);
  const showApple = Boolean(appleHealthConnected || standalone.length > 0 || [...(appleDailyMap?.values() ?? [])].some(hasAppleTelemetry));
  const workoutsByDate = groupByDate(workouts, (r) => r.data?.date);
  const appleByDate = groupByDate(standalone, (r) => r.date);
  const dietsByDate = groupByDate(diets, (r) => r.data?.date);
  const completeSet = new Set((nutritionDays ?? []).filter((r) => !r.deleted && r.data?.complete).map((r) => r.data.date));

  const monthStats = computeMonthSummary({
    month,
    days,
    workouts,
    diets,
    appleEntries,
    nutritionDays,
    schedByDate,
    todayKey,
    workoutsByDate,
    appleByDate,
    dietsByDate,
  });

  const cells = Array.from({ length: days }, (_, i) => {
    const cell = `${month}-${String(i + 1).padStart(2, "0")}`;
    const cellWorkouts = workoutsByDate.get(cell) ?? [];
    const cellApple = appleByDate.get(cell) ?? [];
    const cellDiets = dietsByDate.get(cell) ?? [];
    const sched = schedByDate.get(cell);

    const workoutCount = cellWorkouts.length + cellApple.length;
    const rawTrainTitle = cellWorkouts[0]?.data.title ?? cellApple[0]?.plan?.name ?? cellApple[0]?.title ?? "";
    const isFuture = cell > todayKey;
    const hasPlanned = !workoutCount && cell >= todayKey && (sched?.status === "scheduled" || sched?.status === "projected");
    const isManualPlan = hasPlanned && sched?.status === "scheduled";
    const isRestSched = !workoutCount && !hasPlanned && cell >= todayKey && sched?.source === "rest";

    const kcal = Math.round(cellDiets.reduce((sum, r) => sum + (r.data.calories || 0), 0));
    const dietDone = completeSet.has(cell);
    const hasAppleDaily = showApple && hasAppleTelemetry(appleDailyMap?.get(cell));

    const countSuffix = workoutCount > 1 ? `×${workoutCount}` : "";
    const fullTrainLabel = workoutCount
      ? `${fullWorkoutTag(rawTrainTitle || "训练")}${countSuffix}`
      : hasPlanned
        ? fullWorkoutTag(sched.title)
        : isRestSched ? "休息" : "";
    const shortTrainLabel = workoutCount
      ? `${compactWorkoutTag(rawTrainTitle || "训练")}${countSuffix}`
      : hasPlanned
        ? compactWorkoutTag(sched.title)
        : isRestSched ? "休息" : "";

    const kcalLabel = kcal > 0 ? fmt(kcal, 0) : "";

    const cls = [
      "cal-cell",
      cell === todayKey ? "is-today" : "",
      workoutCount ? "has-entries has-workout" : "",
      hasPlanned ? "has-planned" : "",
      isManualPlan ? "has-manual-plan" : "",
      isRestSched ? "is-rest-cell" : "",
      kcal > 0 ? "has-diet" : "",
      dietDone ? "has-diet-complete" : "",
      hasAppleDaily ? "has-apple-daily" : "",
      isFuture ? "is-future-cell" : "",
    ].filter(Boolean).join(" ");

    const ariaParts = [cell];
    if (workoutCount) ariaParts.push(`训练 ${rawTrainTitle}`);
    else if (hasPlanned) ariaParts.push(`排期 ${sched.title}`);
    if (kcal > 0) ariaParts.push(`摄入 ${kcal} 千卡`);
    if (hasAppleDaily) ariaParts.push("体征已同步");

    return `<button data-action="calendar-date" data-value="${cell}" type="button" aria-label="${esc(ariaParts.join(" · "))}" aria-pressed="${date === cell}" class="${cls}">
      <span class="cal-cell-head">
        <span class="cal-day-num">${i + 1}</span>
        <span class="cal-cell-leds" aria-hidden="true">
          ${workoutCount ? '<i class="led-work"></i>' : hasPlanned ? '<i class="led-plan"></i>' : ""}
          ${kcal > 0 ? `<i class="led-diet${dietDone ? " is-full" : ""}"></i>` : ""}
          ${hasAppleDaily ? '<i class="led-apple"></i>' : ""}
        </span>
      </span>
      <span class="cal-cell-body">
        ${fullTrainLabel ? `<span class="cal-cell-work${hasPlanned ? " is-planned" : isRestSched ? " is-rest" : ""}" title="${esc(rawTrainTitle || sched?.title || "")}"><span class="cal-work-full">${esc(fullTrainLabel)}</span><span class="cal-work-short">${esc(shortTrainLabel)}</span></span>` : '<span class="cal-cell-work is-empty" aria-hidden="true"></span>'}
        ${kcalLabel ? `<span class="cal-cell-kcal${dietDone ? " is-full" : ""}">${esc(kcalLabel)}<small>卡</small></span>` : '<span class="cal-cell-kcal is-empty" aria-hidden="true"></span>'}
      </span>
    </button>`;
  }).join("");

  const selWorkouts = workoutsByDate.get(date) ?? [];
  const selApple = appleByDate.get(date) ?? [];
  const selDiets = dietsByDate.get(date) ?? [];
  const selWeight = weights.find((r) => !r.deleted && r.data.date === date) ?? null;
  const selDietComplete = completeSet.has(date);
  const selSchedSummary = schedByDate.get(date);
  const selDaySched = daySched?.date === date ? daySched : null;

  const dossierHtml = renderDayDossier({
    date,
    todayKey,
    workouts: selWorkouts,
    appleEntries: selApple,
    appleDaily: appleDailyMap?.get(date) ?? null,
    appleHealthConnected: showApple,
    diets: selDiets,
    weightRecord: selWeight,
    nutritionComplete: selDietComplete,
    goals,
    daySched: selDaySched,
    schedSummary: selSchedSummary,
    catalogueMap,
  });

  const head = `<div class="page-heading masthead-calendar">
    <span class="vf-c tl" aria-hidden="true"></span><span class="vf-c tr" aria-hidden="true"></span><span class="vf-c bl" aria-hidden="true"></span><span class="vf-c br" aria-hidden="true"></span>
    <div class="cal-mast-copy">
      <div class="cal-mast-title"><h1>日历</h1><span class="cal-mast-matrix">${matrix(month.replace("-", "."))}</span></div>
      <p>${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月 · 训练记录、热量与排期</p>
    </div>
    ${segmentsHtml}
  </div>`;

  const monthBand = `<div class="calendar-month-band" aria-label="本月概览">
    <div><span>完成训练</span><strong>${monthStats.totalWorkouts} <small>场</small></strong></div>
    <div><span>月均摄入</span><strong>${monthStats.avgCalories ? fmt(monthStats.avgCalories, 0) : "—"} <small>${monthStats.avgCalories ? "kcal" : ""}</small></strong></div>
    <div><span>完整饮食</span><strong>${monthStats.completeDietDays} <small>天</small></strong></div>
    <div><span>后续排期</span><strong>${monthStats.futurePlannedCount} <small>场</small></strong></div>
  </div>`;

  return `${head}<div class="calendar-layout lens-${esc(lens)}">
    <section class="panel calendar">
      <header class="calendar-header">
        <div class="calendar-month">
          <button class="icon-button" data-action="month" data-value="-1" aria-label="上个月">${icon("back")}</button>
          <h2>${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月</h2>
          <button class="icon-button" data-action="month" data-value="1" aria-label="下个月"${month >= maxMonth ? " disabled" : ""}>${icon("chevron")}</button>
        </div>
        <button class="quiet" type="button" data-action="calendar-today"${date === todayKey ? " disabled" : ""}>今天</button>
      </header>
      ${monthBand}
      <div class="calendar-grid">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>周${day}</span>`).join("")}
        ${"<div></div>".repeat(beginning)}${cells}
      </div>
      <footer class="calendar-legend">
        <span><i class="led-work"></i> 已练</span>
        <span><i class="led-plan"></i> 排期</span>
        <span><i class="led-diet is-full"></i> 饮食完整</span>
        ${showApple ? '<span><i class="led-apple"></i> 体征已同步</span>' : ""}
        <span class="cal-legend-hint">点击日期查看当天动作与热量明细</span>
      </footer>
    </section>
    ${renderCalendarDetailPanel({ date, todayKey, dossierHtml })}
  </div>`;
}
