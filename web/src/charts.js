import { esc, fmt, shortDate, duration, icon, empty, muscles, segments, healthTypes, feelings, options, dotMeter, thinMeter } from "./ui.js";
import { matrix } from "./display.js";
import { formatSleepMinutes } from "./apple-health-ui.js";

export function panel(id, title, annotation, body, control = "") {
  return `<section class="panel panel-${id}" id="panel-${id}"><header class="panel-head"><div><h2>${title}</h2>${annotation ? `<p>${annotation}</p>` : ""}</div>${control}</header>${body}</section>`;
}
export const metricNames = { volume: "训练容量", sets: "完成组数", workouts: "训练次数", seconds: "训练时长" };

export function weekStrip(activity, todayDate, selectedDate = "", selectedTitle = "", scheduleDays = [], selectedDetail = null) {
  const activeSet = new Set((activity ?? []).filter((cell) => cell.active).map((cell) => cell.date));
  const byDate = new Map((scheduleDays ?? []).map((item) => [item.date, item]));
  const anchor = new Date(todayDate + "T00:00:00Z");
  const weekday = (anchor.getUTCDay() + 6) % 7;
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  let futurePlannedCount = 0;
  const cells = labels.map((label, i) => {
    const day = new Date(anchor.getTime() + (i - weekday) * 86400000);
    const iso = day.toISOString().slice(0, 10);
    const active = activeSet.has(iso);
    const isToday = iso === todayDate;
    const isFuture = iso > todayDate;
    const sched = byDate.get(iso);
    const isPlanned = !active && (isToday || isFuture) && (sched?.status === "scheduled" || sched?.status === "projected");
    const isManual = !active && sched?.status === "scheduled";
    const isRest = !active && (isToday || isFuture) && sched?.source === "rest";
    if (isFuture && isPlanned) futurePlannedCount++;
    const cls = [
      "week-pill",
      active ? "is-active" : "",
      isToday ? "is-today" : "",
      isFuture ? "is-future" : "",
      isPlanned ? "is-planned" : "",
      isManual ? "is-manual-schedule" : "",
      isRest ? "is-rest-plan" : "",
    ].filter(Boolean).join(" ");
    const stateDesc = active ? " 已训练" : isPlanned ? ` 排期：${sched.title}` : isRest ? " 休息日" : isFuture ? " 可排期" : "";
    return `<button type="button" class="${cls}" data-action="week-day" data-value="${iso}" aria-pressed="${selectedDate === iso}" aria-label="${iso}${esc(stateDesc)}">
      <span>${label}</span><b>${Number(iso.slice(8))}</b><i></i></button>`;
  }).join("");
  const doneCount = labels.filter((_, i) => activeSet.has(new Date(anchor.getTime() + (i - weekday) * 86400000).toISOString().slice(0, 10))).length;
  const isWorked = selectedDate && activeSet.has(selectedDate);
  const selectedSched = selectedDate ? (selectedDetail?.day ?? byDate.get(selectedDate)) : null;
  const isPastUnworked = selectedDate && !isWorked && selectedDate < todayDate;
  const schedLabel = selectedSched?.title
    || (selectedSched?.status === "scheduled" ? "已排定" : selectedSched?.status === "projected" ? "计划顺排" : selectedSched?.source === "rest" ? "休息日" : "待安排");
  const summary = !selectedDate
    ? `<b>${doneCount} / 7 天${futurePlannedCount ? ` · 预排 ${futurePlannedCount}` : ""}</b>`
    : isWorked
      ? `<span class="week-head-actions"><button type="button" class="week-detail-btn" data-action="day-detail" data-value="${selectedDate}">${shortDate(selectedDate)} · ${esc(selectedTitle || "已打卡")} ${icon("chevron", 12)}</button><button type="button" class="week-detail-close" data-action="week-day-close" aria-label="取消选中">${icon("close", 11)}</button></span>`
      : isPastUnworked
        ? `<span class="week-head-actions"><button type="button" class="week-detail-btn is-action" data-action="edit-for-date" data-value="${selectedDate}">${shortDate(selectedDate)} · 未训练 · 补录 ${icon("chevron", 12)}</button><button type="button" class="week-detail-close" data-action="week-day-close" aria-label="取消选中">${icon("close", 11)}</button></span>`
        : `<span class="week-head-actions"><button type="button" class="week-detail-btn is-action" data-action="schedule-day" data-value="${selectedDate}">${shortDate(selectedDate)} · ${esc(schedLabel)} · 排期 ${icon("chevron", 12)}</button><button type="button" class="week-detail-close" data-action="week-day-close" aria-label="取消选中">${icon("close", 11)}</button></span>`;

  return `<div class="hero-week" aria-label="本周训练打卡与排期">
    <div class="hero-week-head"><span>本周节律</span>${summary}</div>
    <div class="hero-week-days">${cells}</div>
  </div>`;
}

export function ironDial(day, statsData, { appleHealthConnected = true } = {}) {
  if (!day && !statsData) return "";
  const todayDate = day?.date ?? statsData?.today ?? "";
  const activeSet = new Set((statsData?.activity ?? []).filter((cell) => cell.active).map((cell) => cell.date));
  const anchor = todayDate ? new Date(todayDate + "T00:00:00Z") : new Date();
  const weekday = (anchor.getUTCDay() + 6) % 7;
  let weekDoneDays = 0;
  for (let i = 0; i < 7; i++) {
    const iso = new Date(anchor.getTime() + (i - weekday) * 86400000).toISOString().slice(0, 10);
    if (activeSet.has(iso)) weekDoneDays++;
  }
  const weekGoalDays = Math.max(1, day?.daysPerWeek ?? statsData?.goals?.daysPerWeek ?? 4);

  // Outer orbit: today's workout completion or weekly cadence
  let loadRatio = 0;
  let loadVal = "";
  let loadSub = "";
  let loadAction = "route";
  let loadActionValue = "workout";
  let loadTone = "is-red";

  if (day?.active) {
    const totalSets = Math.max(1, day.active.total || 1);
    loadRatio = Math.min(1, day.active.done / totalSets);
    loadVal = `${day.active.done}/${day.active.total} 组`;
    loadSub = "进行中";
    loadAction = "workout-detail";
    loadActionValue = day.active.id;
  } else if ((day?.completed ?? 0) > 0) {
    loadRatio = 1;
    const todayRecent = statsData?.recent?.find((item) => item.date === todayDate);
    const todayApple = day?.apple?.[0];
    loadVal = todayRecent ? `${todayRecent.sets} 组` : `已完成 ${day.completed} 场`;
    loadSub = todayRecent ? `${fmt(todayRecent.volume)} kg` : "今日已打卡";
    if (todayRecent) { loadAction = "workout-detail"; loadActionValue = todayRecent.id; }
    else if (todayApple) { loadAction = "apple-activity"; loadActionValue = todayApple.id; }
  } else if (day?.restToday) {
    loadRatio = Math.min(1, Math.max(0.25, weekDoneDays / weekGoalDays));
    loadVal = "休息日";
    loadSub = `本周 ${weekDoneDays}/${weekGoalDays} 练`;
    loadAction = "schedule-day";
    loadActionValue = todayDate;
    loadTone = "is-ink";
  } else {
    loadRatio = Math.min(1, weekDoneDays / weekGoalDays);
    loadVal = `${weekDoneDays}/${weekGoalDays} 练`;
    loadSub = day?.planned?.date === todayDate ? `待练 · ${day.planned.name}` : "本周进度";
    if (day?.planned?.date === todayDate) {
      loadAction = day.planned.source === "scheduled" ? "schedule-preview" : "today-routine";
      loadActionValue = day.planned.source === "scheduled" ? day.planned.date : day.planned.id;
    } else {
      loadAction = "edit";
      loadActionValue = "workout";
    }
  }

  // Middle orbit: Fuel (Protein + Calories)
  const nut = day?.nutrition;
  const calTarget = Math.max(1, nut?.target ?? statsData?.goals?.calories ?? 2200);
  const protTarget = Math.max(1, nut?.proteinTarget ?? statsData?.goals?.protein ?? 140);
  const calLogged = nut?.calories ?? 0;
  const protLogged = nut?.protein ?? 0;
  const protRatio = Math.min(1, protLogged / protTarget);
  const calRatio = Math.min(1, calLogged / calTarget);
  const fuelRatio = nut?.count
    ? Math.min(1, protRatio * 0.65 + calRatio * 0.35)
    : 0;
  const fuelVal = nut?.count ? `蛋白 ${fmt(protLogged, 0)}/${fmt(protTarget, 0)}g` : "待记饮食";
  const calSurplus = Math.round(calLogged - calTarget);
  const fuelSub = nut?.count
    ? `${fmt(calLogged, 0)} / ${fmt(calTarget, 0)} kcal${calSurplus > calTarget * 0.1 ? ` · 超 ${fmt(calSurplus, 0)}` : ""}`
    : `目标 ${fmt(protTarget, 0)}g 蛋白`;

  // Inner orbit: Recovery (Readiness / Sleep)
  const rec = statsData?.appleDailySummary?.recoveryReport;
  const appleDaily = day?.appleDaily;
  const readinessScore = rec?.readinessScore ?? null;
  const sleepMin = appleDaily?.sleepMinutes ?? statsData?.appleDailySummary?.series?.at(-1)?.sleepMinutes ?? null;
  let recRatio = 0;
  let recVal = "待同步";
  let recSub = "Apple 健康";
  if (readinessScore != null) {
    recRatio = Math.min(1, Math.max(0.08, readinessScore / 100));
    recVal = `${readinessScore} 分`;
    recSub = sleepMin != null ? `睡眠 ${formatSleepMinutes(sleepMin)}` : (rec?.readinessLabel?.split(" · ")[0] ?? "恢复在线");
  } else if (sleepMin != null) {
    recRatio = Math.min(1, sleepMin / 450);
    recVal = formatSleepMinutes(sleepMin);
    recSub = "昨夜睡眠";
  }

  // Overall Iron Core Index (0..100)
  const hasRecovery = readinessScore != null || sleepMin != null;
  const showRecoveryRing = Boolean(appleHealthConnected || hasRecovery);
  const activeWeights = [
    { ratio: loadRatio, weight: 0.4 },
    { ratio: fuelRatio, weight: 0.3 },
    ...(showRecoveryRing && hasRecovery ? [{ ratio: recRatio, weight: 0.3 }] : []),
  ];
  const weightSum = activeWeights.reduce((s, item) => s + item.weight, 0);
  const coreIndex = Math.round(
    activeWeights.reduce((s, item) => s + item.ratio * item.weight, 0) / Math.max(0.01, weightSum) * 100,
  );
  const closedRings = [loadRatio >= 0.99, fuelRatio >= 0.95, showRecoveryRing && hasRecovery && recRatio >= 0.8].filter(Boolean).length;

  // Instrument dial geometry: 270° open-bottom telemetry gauge (135° to 405°)
  const spanDeg = 270;
  const renderOrbit = (r, ratio, segCount, cls) => {
    const circ = 2 * Math.PI * r;
    const arcLen = circ * (spanDeg / 360);
    const filledLen = Math.max(0, Math.min(1, ratio)) * arcLen;
    const pitch = arcLen / segCount;
    const tooth = Math.max(1.5, pitch - 2.1);
    const gap = Math.max(1, pitch - tooth);
    // Repeat tooth/gap pattern across arcLen, then close out remaining circumference
    const trackDash = Array.from({ length: segCount }, () => `${tooth.toFixed(2)} ${gap.toFixed(2)}`).join(" ") + ` 0 ${circ.toFixed(2)}`;
    // Active filled arc: quantized to whole or partial segments
    const activeSegs = Math.round(Math.max(0, Math.min(1, ratio)) * segCount);
    const activeDash = activeSegs > 0
      ? Array.from({ length: activeSegs }, () => `${tooth.toFixed(2)} ${gap.toFixed(2)}`).join(" ") + ` 0 ${circ.toFixed(2)}`
      : `0 ${circ.toFixed(2)}`;
    // Endpoint cursor coordinates
    const endDeg = 135 + Math.max(0, Math.min(1, ratio)) * spanDeg;
    const endRad = (endDeg * Math.PI) / 180;
    const ex = (100 + r * Math.cos(endRad)).toFixed(1);
    const ey = (100 + r * Math.sin(endRad)).toFixed(1);

    return `
      <circle class="dial-track" cx="100" cy="100" r="${r}" stroke-dasharray="${trackDash}" transform="rotate(135 100 100)"/>
      ${activeSegs > 0 ? `<circle class="dial-fill ${cls}" cx="100" cy="100" r="${r}" stroke-dasharray="${activeDash}" transform="rotate(135 100 100)"/>` : ""}
      ${ratio > 0.02 ? `<circle class="dial-pin ${cls}" cx="${ex}" cy="${ey}" r="3.4"/>` : ""}
    `;
  };

  // Outer reticle ticks (every 45° along the 270° arc)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const deg = 135 + t * spanDeg;
    const rad = (deg * Math.PI) / 180;
    const x1 = (100 + 91 * Math.cos(rad)).toFixed(1);
    const y1 = (100 + 91 * Math.sin(rad)).toFixed(1);
    const x2 = (100 + 96 * Math.cos(rad)).toFixed(1);
    const y2 = (100 + 96 * Math.sin(rad)).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="dial-tick"/>`;
  }).join("");

  return `<aside class="iron-dial" aria-label="${showRecoveryRing ? "铁记三环闭环仪" : "铁记双环闭环仪"}">
    <div class="iron-dial-stage">
      <svg class="iron-dial-svg" viewBox="0 0 200 190" role="img" aria-label="今日闭环指数 ${coreIndex}%">
        ${ticks}
        ${renderOrbit(showRecoveryRing ? 82 : 80, loadRatio, 28, loadTone)}
        ${renderOrbit(showRecoveryRing ? 66 : 62, fuelRatio, 22, "is-ink")}
        ${showRecoveryRing ? renderOrbit(50, recRatio, 16, "is-silver") : ""}
      </svg>
      <div class="iron-dial-core">
        <strong>${matrix(String(coreIndex))}<em>%</em></strong>
      </div>
    </div>
    <div class="iron-dial-legend${showRecoveryRing ? "" : " is-two-ring"}" role="group" aria-label="${showRecoveryRing ? "三环指标快捷入口" : "双环指标快捷入口"}">
      <button type="button" class="dial-pill is-load" data-action="${esc(loadAction)}" data-value="${esc(loadActionValue)}">
        <i class="dial-dot ${loadTone}"></i>
        <span class="dial-pill-copy">
          <small>训练 · <b>${Math.round(loadRatio * 100)}%</b></small>
          <strong>${esc(loadVal)}</strong>
        </span>
        <em>${esc(loadSub)}</em>
      </button>
      <button type="button" class="dial-pill is-fuel" data-action="today-diet">
        <i class="dial-dot is-ink"></i>
        <span class="dial-pill-copy">
          <small>补给 · <b>${Math.round(fuelRatio * 100)}%</b></small>
          <strong>${esc(fuelVal)}</strong>
        </span>
        <em>${esc(fuelSub)}</em>
      </button>
      ${showRecoveryRing ? `<button type="button" class="dial-pill is-rec" data-action="${appleDaily ? "apple-daily-detail" : "route"}" ${appleDaily ? `data-date="${esc(todayDate)}"` : 'data-value="analytics"'}>
        <i class="dial-dot is-silver"></i>
        <span class="dial-pill-copy">
          <small>恢复 · <b>${Math.round(recRatio * 100)}%</b></small>
          <strong>${esc(recVal)}</strong>
        </span>
        <em>${esc(recSub)}</em>
      </button>` : ""}
    </div>
  </aside>`;
}

let gradientSeq = 0;

export function miniSparkline(rows, key = "weight") {
  const pts = (rows ?? []).filter((row) => Number.isFinite(row?.[key])).slice(-8);
  if (pts.length < 2) return "";
  const vals = pts.map((row) => row[key]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(0.2, max - min);
  const x0 = 6, x1 = 114, y0 = 6, y1 = 28;
  const coords = vals.map((val, i) => [
    x0 + (i / (vals.length - 1)) * (x1 - x0),
    y1 - ((val - min) / span) * (y1 - y0),
  ]);
  const poly = `<polyline points="${coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")}" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-dasharray="2 3" stroke-linecap="round"/>`;
  const nodes = coords.map(([px, py], i) => i === coords.length - 1
    ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.8" fill="var(--ink)"/>`
    : `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5" fill="var(--bg)" stroke="var(--ink)" stroke-width="1.6"/>`
  ).join("");
  return `<svg class="mini-spark" viewBox="0 0 120 34" aria-hidden="true">${poly}${nodes}</svg>`;
}

function graph(rows, series, cfg = {}) {
  const { onlyBars = false, goal = null, from, to, axisLabel = "", compact = false, unit = "", height = 200 } = cfg;
  const width = matchMedia("(max-width: 630px)").matches ? 344 : compact ? 420 : 660;
  const left = 48, right = 14, top = 12, bottom = 32;
  const innerW = width - left - right, innerH = height - top - bottom;
  const known = rows.flatMap((row) => series.map(({ key }) => row[key]).filter(Number.isFinite));
  if (!known.length) return empty("这个区间暂无数据", "更换时间范围，或添加一条记录。");
  const yData = goal == null ? known : [...known, goal];
  const max = Math.max(...yData), min = onlyBars ? 0 : Math.min(...yData);
  const spread = Math.max(onlyBars ? 1 : Math.max(Math.abs(max) * 0.015, 0.2), max - min);
  const stepTarget = spread / 3;
  const stepUnit = 10 ** Math.floor(Math.log10(stepTarget));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * stepUnit).find((size) => size >= stepTarget) ?? 10 * stepUnit;
  const low = onlyBars ? 0 : Math.floor((min - spread * .07) / step) * step;
  const high = Math.max(low + step * 2, Math.ceil((max + spread * .05) / step) * step);
  const y = (value) => top + (high - value) / (high - low) * innerH;
  const start = Date.parse(from ?? rows[0].date), end = Date.parse(to ?? rows.at(-1).date);
  const x = (item, i) => onlyBars ? left + innerW * (i + .5) / rows.length
    : start === end ? left + innerW / 2 : left + innerW * (Date.parse(item.date) - start) / (end - start);
  const ticks = Array.from({ length: Math.round((high - low) / step) + 1 }, (_, i) => low + i * step);
  const grid = ticks.map((tick) =>
    `<line x1="${left}" y1="${y(tick)}" x2="${width - right}" y2="${y(tick)}" class="gridline"/>
     <text x="${left - 8}" y="${y(tick) + 4}" text-anchor="end">${esc(fmt(tick, 2))}</text>`).join("");
  const count = rows.length;
  const labelIndices = [...new Set([0, Math.floor((count - 1) / 3), Math.floor(2 * (count - 1) / 3), count - 1])];
  const dates = onlyBars ? labelIndices.map((i) => ({ date: rows[i].date, x: x(rows[i], i) }))
    : [...new Set([start, start + Math.floor((end - start) / 86400000 / 2) * 86400000, end])].map((point) => {
      const date = new Date(point).toISOString().slice(0, 10);
      return { date, x: x({ date }, 0) };
    });
  const labels = dates.map((item) => `<text x="${item.x}" y="${height - 8}" text-anchor="middle">${shortDate(item.date)}</text>`).join("");

  const patId = `stipple-${++gradientSeq}`;
  const defs = onlyBars ? `<defs><pattern id="${patId}" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="0.95" fill="var(--soft)" opacity="0.65"/></pattern></defs>` : "";

  const plots = series.map(({ key, css, label }, seriesIndex) => {
    if (onlyBars) {
      const colW = innerW / count;
      const barW = Math.min(24, Math.max(3, colW * 0.6));
      const latest = rows.findLastIndex((row) => row[key] > 0);
      const baseY = y(0);
      const rx = Math.min(7, barW / 2);
      return rows.map((row, i) => {
        const val = row[key];
        const cx = x(row, i);
        if (!Number.isFinite(val) || val <= 0) {
          if (count <= 31) {
            const restH = Math.min(18, innerH);
            return `<rect x="${cx - barW / 2}" y="${baseY - restH}" width="${barW}" height="${restH}" rx="${Math.min(rx, restH / 2)}" class="bar-rest" style="fill:url(#${patId})"/>`;
          }
          return "";
        }
        const topY = y(val);
        const barH = Math.max(4, baseY - topY);
        const cls = `${css}${row.complete === false ? " partial" : ""}${i === latest ? " bar-latest" : ""}`;
        const tip = `${shortDate(row.date)} · ${fmt(val, 1)}${unit ? " " + unit : ""}`;
        const fillStyle = row.complete === false ? ` style="fill:url(#${patId})"` : "";
        const graphic = `<rect x="${cx - barW / 2}" y="${baseY - barH}" width="${barW}" height="${barH}" rx="${Math.min(rx, barH / 2)}" class="${cls}"${fillStyle}/>`
          + (i === latest ? `<circle cx="${cx}" cy="${Math.max(top + 3, topY - 7)}" r="2.8" class="bar-latest-dot"/>` : "");
        return `${graphic}<rect x="${cx - Math.max(barW, 12) / 2}" y="${top}" width="${Math.max(barW, 12)}" height="${innerH}" class="chart-hit" tabindex="0" role="button" aria-label="${esc(tip)}" data-chart-tip="${esc(tip)}"><title>${esc(shortDate(row.date) + " · " + label + " " + fmt(val) + (unit ? " " + unit : ""))}</title></rect>`;
      }).join("");
    }
    const points = rows.flatMap((row, i) => Number.isFinite(row[key]) ? [[x(row, i), y(row[key]), row]] : []);
    const line = `<polyline points="${points.map(([px, py]) => px + "," + py).join(" ")}" class="trace ${css}"/>`;
    const dots = points.map(([px, py, row]) => {
      const tip = `${shortDate(row.date)} · ${label} ${fmt(row[key], 2)}${unit ? " " + unit : ""}`;
      const r = seriesIndex === 0 ? (points.length > 38 ? 2.4 : 3.6) : 2.1;
      return `<circle cx="${px}" cy="${py}" r="${r}" class="node-${css}"/>`
        + (seriesIndex === 0 ? `<circle cx="${px}" cy="${py}" r="10" class="chart-hit" tabindex="0" role="button" aria-label="${esc(tip)}" data-chart-tip="${esc(tip)}"><title>${esc(tip)}</title></circle>` : "");
    }).join("");
    return line + dots;
  }).join("");

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(axisLabel || series.map((item) => item.label).join("与"))}">${defs}${grid}${labels}${goal === null ? "" : `<path d="M${left},${y(goal)}H${width - right}" class="goal-line"><title>目标 ${fmt(goal)}</title></path>`}${plots}</svg>`;
}

export function weightChart(rows, { from, to, goal = null, showAverage = false } = {}) {
  const series = [{ key: "weight", label: "称重", css: "primary" }];
  if (showAverage) series.push({ key: "average", label: "滚动平均", css: "secondary" });
  return graph(rows, series, { from, to, goal, compact: showAverage, unit: "kg", axisLabel: showAverage ? "称重与滚动平均，单位千克" : "称重趋势，单位千克" });
}

function bucket(rows, key, length) {
  const valueOf = (row) => key === "seconds" ? row.seconds / 60 : key === "workouts" ? row.workouts + (row.addedApple ?? 0) : row[key];
  if (length <= 30) return rows.map((row) => ({ date: row.date, value: valueOf(row) }));
  const size = length > 90 ? 14 : 7;
  const groups = [];
  for (let i = 0; i < rows.length; i += size) {
    const group = rows.slice(i, i + size);
    groups.push({ date: group[0].date, value: group.reduce((sum, row) => sum + valueOf(row), 0) });
  }
  return groups;
}
const legend = (...entries) => '<div class="legend">' + entries.map(([label, color]) => `<span><i class="${color}"></i>${label}</span>`).join("") + "</div>";
const healthTypeLabel = (value) => healthTypes[value.replace(/[-_]/g, "").toLowerCase()] ?? value;

const muscleParts = ["chest", "shoulders", "arms", "core", "legs", "back"];
const MASK_W = 150, MASK_H = 135;
const maskBuffers = new Map();
let masksLoading = null;

export function preloadAtlasMasks() {
  if (masksLoading) return masksLoading;
  masksLoading = Promise.all(muscleParts.map((part) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = MASK_W;
        canvas.height = MASK_H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx?.drawImage(img, 0, 0, MASK_W, MASK_H);
        const data = ctx?.getImageData(0, 0, MASK_W, MASK_H).data;
        if (data) maskBuffers.set(part, data);
      } catch {}
      resolve();
    };
    img.onerror = () => resolve();
    img.src = `./atlas-${part}.png`;
  })));
  return masksLoading;
}

export function hitTestAtlas(atlasEl, clientX, clientY) {
  const rect = atlasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return "";
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return "";
  const x = Math.min(MASK_W - 1, Math.max(0, Math.round(u * (MASK_W - 1))));
  const y = Math.min(MASK_H - 1, Math.max(0, Math.round(v * (MASK_H - 1))));
  let bestPart = "", bestAlpha = 18;
  for (const part of muscleParts) {
    const buf = maskBuffers.get(part);
    if (!buf) continue;
    const alpha = buf[(y * MASK_W + x) * 4 + 3];
    if (alpha > bestAlpha) { bestAlpha = alpha; bestPart = part; }
  }
  if (bestPart) return bestPart;
  let bestDist = 99;
  for (let dy = -3; dy <= 3; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= MASK_H) continue;
    for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= MASK_W) continue;
      const dist = dx * dx + dy * dy;
      if (dist > 10 || dist >= bestDist) continue;
      const idx = (ny * MASK_W + nx) * 4 + 3;
      for (const part of muscleParts) {
        const buf = maskBuffers.get(part);
        if (buf && buf[idx] > 48) { bestDist = dist; bestPart = part; break; }
      }
    }
  }
  return bestPart;
}

export function formatAtlasPill(data, mode, target) {
  if (!target || !data) return "";
  if (mode === "recovery") {
    const st = (data.muscleStatus ?? []).find((item) => item.key === target);
    if (st) return `${st.name} · 恢复 ${st.recoveryPct}% · ${st.statusLabel}`;
  } else if (mode === "recency") {
    const st = (data.muscleStatus ?? []).find((item) => item.key === target);
    if (st) {
      const gapDesc = st.daysSinceLast == null ? "久未刺激" : st.daysSinceLast === 0 ? "今天刚练" : `${st.daysSinceLast} 天前`;
      return `${st.name} · ${gapDesc} · 近7天 ${fmt(st.recent7dSets)} 组`;
    }
  }
  const musclesList = Array.isArray(data.muscles) ? data.muscles : [];
  const total = musclesList.filter((item) => item.key !== "cardio").reduce((sum, item) => sum + item.sets, 0);
  const count = musclesList.find((item) => item.key === target)?.sets ?? 0;
  const share = total ? Math.round((count / total) * 100) : 0;
  return `${muscles[target] ?? target} · ${fmt(count)} 组 · ${share}%`;
}

export function muscleCard(data, state) {
  const mode = state.atlasMode || "volume";
  const setsByPart = new Map(data.muscles.map((item) => [item.key, item.sets]));
  const statusList = Array.isArray(data.muscleStatus) ? data.muscleStatus : [];
  const statusByPart = new Map(statusList.map((item) => [item.key, item]));
  const anatomical = muscleParts.map((part) => ({
    key: part, name: muscles[part] ?? part, sets: setsByPart.get(part) ?? 0,
  })).sort((a, b) => b.sets - a.sets);
  const maxMuscle = Math.max(1, ...anatomical.map((item) => item.sets));
  const totalMuscleSets = anatomical.reduce((sum, item) => sum + item.sets, 0);

  const layerToneAndHeat = (part) => {
    const count = setsByPart.get(part) ?? 0;
    const st = statusByPart.get(part);
    if (mode === "recovery" && st) {
      const heat = (st.status === "fatigued" ? Math.max(0.58, st.fatiguePct / 100)
        : st.status === "recovering" ? Math.max(0.44, st.fatiguePct / 100)
        : st.status === "ready" ? 0.28 : 0.2).toFixed(2);
      return { tone: st.status, heat, label: `${muscles[part] ?? part} 恢复度 ${st.recoveryPct}% · ${st.statusLabel}`, hot: true };
    }
    if (mode === "recency" && st) {
      const days = st.daysSinceLast;
      const tone = days == null || days >= 10 ? "detrained" : days >= 7 ? "recovering" : "ready";
      const heat = days == null ? "0.72" : days >= 10 ? "0.68" : days >= 7 ? "0.52" : days >= 3 ? "0.34" : "0.24";
      const gapDesc = days == null ? "久未刺激" : days === 0 ? "今天刚练" : `${days} 天前`;
      return { tone, heat, label: `${muscles[part] ?? part} ${gapDesc} · 近7天 ${fmt(st.recent7dSets)} 组`, hot: true };
    }
    const heat = count > 0 ? (0.38 + 0.60 * (count / maxMuscle)).toFixed(2) : "0";
    return { tone: "", heat, label: `${muscles[part] ?? part} ${count} 组`, hot: count > 0 };
  };

  const atlasLayers = muscleParts.map((part) => {
    const { tone, heat, label, hot } = layerToneAndHeat(part);
    const selected = state.muscle === part;
    const dimmed = state.muscle && state.muscle !== part;
    const cls = ["atlas-layer", mode === "volume" ? (hot ? "is-hot" : "is-cold") : "is-toned", selected ? "is-selected" : "", dimmed ? "is-dimmed" : ""].filter(Boolean).join(" ");
    return `<span class="${cls}" data-muscle="${part}"${tone ? ` data-tone="${tone}"` : ""} style="--mask:url(./atlas-${part}.png);--heat:${heat}" aria-label="${esc(label)}"></span>`;
  }).join("");

  const pillText = formatAtlasPill(data, mode, state.muscle);
  const idleHint = mode === "recovery"
    ? "红疲劳 · 黄恢复中 · 绿已就绪"
    : mode === "recency"
      ? "悬停或点击部位查看训练间隔"
      : totalMuscleSets > 0
        ? `悬停或点击部位 · 共 ${fmt(totalMuscleSets)} 组`
        : "记录训练后查看部位分布";
  const control = `<div class="atlas-head-controls">${segments({ volume: "容量", recovery: "恢复度", recency: "间隔" }, mode, "atlas-mode")}</div>`;

  let barsHtml = "";
  if (mode === "recovery" && statusList.length) {
    const sorted = [...statusList].sort((a, b) => a.recoveryPct - b.recoveryPct);
    barsHtml = sorted.map((st) => {
      const isSelected = state.muscle === st.key;
      const isDimmed = state.muscle && !isSelected;
      return `<button type="button" class="muscle-line${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}" data-tone="${st.status}" data-action="muscle" data-value="${esc(st.key)}" aria-pressed="${isSelected}">
        <span>${esc(st.name)}</span>
        ${thinMeter(st.recoveryPct / 100)}
        <strong>${st.recoveryPct}% <small>${esc(st.statusLabel)}</small></strong></button>`;
    }).join("");
  } else if (mode === "recency" && statusList.length) {
    const sorted = [...statusList].sort((a, b) => (b.daysSinceLast ?? 9999) - (a.daysSinceLast ?? 9999));
    barsHtml = sorted.map((st) => {
      const isSelected = state.muscle === st.key;
      const isDimmed = state.muscle && !isSelected;
      const gapText = st.daysSinceLast == null ? "久未练" : st.daysSinceLast === 0 ? "今天" : `${st.daysSinceLast} 天前`;
      const tone = st.daysSinceLast == null || st.daysSinceLast >= 10 ? "detrained" : st.daysSinceLast >= 7 ? "recovering" : "ready";
      return `<button type="button" class="muscle-line${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}" data-tone="${tone}" data-action="muscle" data-value="${esc(st.key)}" aria-pressed="${isSelected}">
        <span>${esc(st.name)}</span>
        ${thinMeter(Math.min(1, (st.daysSinceLast ?? 14) / 14))}
        <strong>${esc(gapText)} <small>近7天 ${fmt(st.recent7dSets)} 组</small></strong></button>`;
    }).join("");
  } else {
    barsHtml = totalMuscleSets || state.muscle ? anatomical.map((item) => {
      const share = totalMuscleSets ? Math.round((item.sets / totalMuscleSets) * 100) : 0;
      const isSelected = state.muscle === item.key;
      const isDimmed = state.muscle && !isSelected;
      return `<button type="button" class="muscle-line${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}" data-action="muscle" data-value="${esc(item.key)}" aria-pressed="${isSelected}">
        <span>${esc(item.name)}</span>
        ${thinMeter(item.sets / maxMuscle)}
        <strong>${fmt(item.sets)} 组 <small>${share}%</small></strong></button>`;
    }).join("") : '<p class="muted">记录力量训练后，查看主要训练部位。</p>';
  }

  return panel("muscle", "肌群分布", "",
    `<div class="atlas-readout-bar">
      <span class="atlas-pill" data-atlas-pill${pillText ? "" : " hidden"}>${esc(pillText)}</span>
      <span class="atlas-hint" data-atlas-hint${pillText ? " hidden" : ""}>${esc(idleHint)}</span>
      <button class="quiet atlas-clear-btn" type="button" data-action="muscle" data-value="" data-atlas-clear${state.muscle ? "" : " hidden"}>全部</button>
    </div>
    <div class="atlas-stage">
      <div class="atlas-wrap" data-atlas>${atlasLayers ? `<img class="atlas-base" src="./atlas-neutral.png" width="600" height="540" alt="人体正面和背面肌群分布">${atlasLayers}` : ""}</div>
      <div class="atlas-views" aria-hidden="true"><span>正面</span><span>背面</span></div>
    </div>
    <div class="muscle-bars">${barsHtml}</div>`,
    control);
}

// Overview shows these by default; the remaining configured panels sit behind a disclosure.
const primaryPanels = ["load", "muscle", "strength", "weight"];

export function loadPanel(data, state) {
  const key = state.metric;
  const workoutCount = data.totals.activities ?? data.totals.workouts;
  const visibleMetric = metricNames[key];
  const loadUnit = key === "volume" ? "kg" : key === "sets" ? "组" : key === "workouts" ? "次" : "分钟";
  const loadSeries = bucket(data.daily, key, data.period);
  const loadPeak = loadSeries.reduce((best, item) => (item.value > best.value ? item : best), { date: "", value: 0 });
  const loadAverage = key === "volume"
    ? (data.totals.workouts ? `${fmt(data.totals.volume / data.totals.workouts, 0)} kg` : "—")
    : key === "sets"
      ? (data.totals.workouts ? `${fmt(data.totals.sets / data.totals.workouts, 1)} 组` : "—")
      : key === "workouts"
        ? `周均 ${fmt(workoutCount / Math.max(1, data.period / 7), 1)} 次`
        : duration(data.totals.timedWorkouts ? Math.round(data.totals.seconds / data.totals.timedWorkouts) : null);
  const loadPrevious = key === "workouts" ? (data.previous.activities ?? data.previous.workouts) : data.previous[key];
  const loadCurrent = key === "workouts" ? workoutCount : data.totals[key];
  const loadDelta = loadCurrent - loadPrevious;
  const loadDeltaText = !loadPrevious && !loadCurrent ? "暂无上期对比"
    : loadDelta === 0 ? "与上期持平"
    : key === "seconds"
      ? `较上期 ${loadDelta > 0 ? "+" : "-"}${duration(Math.abs(loadDelta))}`
      : `较上期 ${loadDelta > 0 ? "+" : ""}${fmt(loadDelta, 0)} ${key === "volume" ? "kg" : key === "sets" ? "组" : "次"}`;
  const activeDays = data.totals.activeDays ?? (data.activity ?? []).slice(-84).filter((c) => c.date >= data.from && c.date <= data.through && c.active).length;

  return panel("load", "训练趋势", "",
    `<div class="chart-wrap">
      <div class="chart-info"><strong>${key === "seconds" ? duration(data.totals.timedWorkouts ? data.totals.seconds : null) : matrix(fmt(key === "workouts" ? workoutCount : data.totals[key]))}</strong>${key === "seconds" ? "" : `<span>${key === "volume" ? "kg" : key === "sets" ? "组" : "次"}</span>`}<span class="chart-readout" data-chart-readout></span></div>
      ${(key === "workouts" ? workoutCount : data.totals.workouts) ? graph(loadSeries, [{ key: "value", css: "bars", label: key === "seconds" ? "分钟" : visibleMetric }], { onlyBars: true, unit: loadUnit, height: 252 }) : empty("还没有训练记录", "补录训练后，这里会显示趋势。")}
     </div>
     ${(key === "workouts" ? workoutCount : data.totals.workouts) ? `<div class="health-metrics load-metrics">
       <div><span>${key === "workouts" ? "训练频率" : "场均表现"}</span><strong>${esc(loadAverage)}</strong></div>
       <div><span>${data.period > 90 ? "双周峰值" : data.period > 30 ? "单周峰值" : "单日峰值"}</span><strong>${key === "seconds" ? esc(duration(Math.round(loadPeak.value * 60))) : `${fmt(loadPeak.value, 0)} <small>${loadUnit}</small>`}</strong>${loadPeak.date ? `<small>${shortDate(loadPeak.date)}</small>` : ""}</div>
       <div><span>训练天数</span><strong>${fmt(activeDays)} <small>/ ${data.period} 天</small></strong></div>
     </div>
     <footer class="panel-foot">${legend([data.period > 90 ? "双周累计" : data.period > 30 ? "每周累计" : "每日", "neutral"], ["最近一次", "red"])}<span class="load-delta${loadDelta > 0 ? " is-gain" : ""}">${esc(loadDeltaText)}</span></footer>` : ""}`,
    segments({ volume: "容量", sets: "组数", workouts: "次数", seconds: "时长" }, key, "metric"));
}

export function applePanel(data, state) {
  const types = [...new Set(data.apple.map((row) => row.type))];
  const filteredApple = types.includes(state.healthType) ? data.apple.filter((row) => row.type === state.healthType) : data.apple;
  const active = filteredApple.filter((row) => row.durationKind === "workout_active" && row.durationSeconds !== null);
  const calories = filteredApple.filter((row) => row.kcal != null && row.energyKind === "workout");
  const bpm = filteredApple.filter((row) => row.heartRate?.avgBpm != null);
  const latestHeart = bpm.at(-1)?.heartRate?.avgBpm;
  const heartByDay = [...new Map(bpm.map((row) => [row.date, { date: row.date, value: row.heartRate.avgBpm }])).values()];
  const minHeart = heartByDay.length ? Math.min(...heartByDay.map((row) => row.value)) : null;
  const maxHeart = heartByDay.length ? Math.max(...heartByDay.map((row) => row.value)) : null;
  const ds = data.appleDailySummary;
  const dBody = ds?.bodyReport;
  const dRec = ds?.recoveryReport;
  const dailyPills = ds?.daysWithData > 0
    ? [
        dRec?.readinessScore != null ? `准备度 ${dRec.readinessScore}分` : null,
        dBody?.weightKg != null ? `体重 ${fmt(dBody.weightKg, 2)} kg` : null,
        dBody?.bodyFatPct != null ? `体脂 ${fmt(dBody.bodyFatPct, 1)}%` : null,
        ds.averages?.steps != null ? `${fmt(ds.averages.steps, 0)} 步` : null,
        ds.averages?.restingHeartRateBpm != null ? `RHR ${fmt(ds.averages.restingHeartRateBpm, 0)}` : null,
        ds.averages?.hrvMs != null ? `HRV ${fmt(ds.averages.hrvMs, 1)}` : null,
      ].filter(Boolean)
    : [];
  const dailyFoot = dailyPills.length
    ? `<div class="apple-overview-daily-foot"><span>${esc(dailyPills.join(" · "))}</span><button type="button" class="quiet" data-action="route" data-value="analytics">生理分析 ${icon("chevron", 13)}</button></div>`
    : "";
  const body = data.apple.length ? `<div class="health-metrics apple-telemetry">
    <div><span>${icon("workout", 14)} 上传</span><strong>${fmt(filteredApple.length)} <small>次</small></strong></div>
    <div><span>${icon("clock", 14)} 时长</span><strong>${duration(active.length ? active.reduce((sum, row) => sum + row.durationSeconds, 0) : null)}</strong></div>
    <div><span>${icon("bolt", 14)} 能量</span><strong>${fmt(calories.length ? calories.reduce((sum, row) => sum + row.kcal, 0) : null, 0)} <small>kcal</small></strong></div>
    <div class="is-heart"><span>${icon("heart", 14)} 心率</span><strong>${fmt(latestHeart, 0)} <small>bpm</small></strong></div>
  </div>${heartByDay.length ? `<div class="chart-wrap"><div class="chart-subhead"><p class="chart-caption">心率${minHeart != null ? ` · ${fmt(minHeart, 0)}–${fmt(maxHeart, 0)} bpm` : " / bpm"}</p><span class="chart-readout" data-chart-readout></span></div>${graph(heartByDay,
    [{ key: "value", css: "primary", label: "平均心率" }], { from: data.from, to: data.through, compact: true, unit: "bpm" })}</div>` : ""}
  <ul class="health-list">${filteredApple.slice(-2).reverse().map((row) =>
    `<li><button type="button" class="apple-list-btn" data-action="apple-activity" data-value="${esc(row.id ?? "")}" data-date="${esc(row.date)}" data-type="${esc(row.type)}" data-title="${esc(row.title ?? healthTypeLabel(row.type))}"><span>${icon("heart", 14)} ${esc(row.title ?? healthTypeLabel(row.type))}</span><span>${shortDate(row.date)}${row.heartRate?.avgBpm != null ? ` · ${fmt(row.heartRate.avgBpm, 0)} bpm` : ""}</span></button></li>`).join("")}</ul>${dailyFoot}`
    : (dailyPills.length ? `${dailyFoot}` : empty("暂无 Apple 健康训练", "通过快捷指令上传运动后显示在这里。"));
  return panel("apple", "Apple 健康", "", body,
    types.length ? `<select aria-label="Apple 健康训练类型" data-change="health-type">${options({ "": "全部类型", ...Object.fromEntries(types.map((type) => [type, healthTypeLabel(type)])) }, state.healthType)}</select>` :
      `<button class="quiet" type="button" data-action="settings-open" data-value="devices">设备设置 ${icon("chevron", 15)}</button>`);
}

export function statisticsPanels(data, state, energy = "", part = "all") {
  const workoutCount = data.totals.activities ?? data.totals.workouts;
  const cells = data.activity.slice(-84);
  const monday = cells.length ? (new Date(cells[0].date + "T00:00:00Z").getUTCDay() + 6) % 7 : 0;
  const activeCount = cells.filter((cell) => cell.active).length;
  const best = data.strength.points.reduce((max, point) => Math.max(max, point.weight), 0);
  const best1RM = data.strength.points.reduce((max, point) => Math.max(max, point.estimated1rm ?? 0), 0);
  const latestWeight = data.weights.at(-1);
  const completeDays = data.nutrition.filter((day) => day.complete);
  const avgCalories = completeDays.length ? completeDays.reduce((sum, day) => sum + day.calories, 0) / completeDays.length : null;
  const avgProtein = completeDays.length ? completeDays.reduce((sum, day) => sum + day.protein, 0) / completeDays.length : null;
  const nutrition = new Map(data.nutrition.map((row) => [row.date, row]));
  const nutritionSize = data.period > 90 ? 14 : data.period > 30 ? 7 : 1;
  const nutritionSeries = [];
  for (let i = 0; i < data.daily.length; i += nutritionSize) {
    const group = data.daily.slice(i, i + nutritionSize);
    const entries = group.map(({ date }) => nutrition.get(date)).filter(Boolean);
    const complete = entries.filter((row) => row.complete);
    const used = nutritionSize === 1 ? entries : complete;
    nutritionSeries.push({ date: group[0].date, complete: nutritionSize !== 1 || !!complete.length,
      calories: used.length ? used.reduce((sum, row) => sum + row.calories, 0) / used.length : null });
  }

  const feelingTagged = Math.max(0, data.totals.workouts - (data.feelings.missing ?? 0));
  const feelingTotal = Math.max(1, feelingTagged || data.totals.workouts);
  const feelingSegments = Object.entries(feelings).map(([fKey, name]) => ({
    key: fKey, name, count: data.feelings[fKey] ?? 0, pct: Math.round(((data.feelings[fKey] ?? 0) / feelingTotal) * 100),
  }));
  const dominantFeeling = [...feelingSegments].sort((a, b) => b.count - a.count)[0];
  const comfortCount = (data.feelings.easy ?? 0) + (data.feelings.balanced ?? 0);
  const comfortPct = feelingTagged ? Math.round((comfortCount / feelingTagged) * 100) : null;
  const feelingLogs = (data.recent ?? []).slice(0, 4);

  const selectedCell = cells.find((cell) => cell.date === state.heatmapDate);
  const cards = {
    load: loadPanel(data, state),
    muscle: muscleCard(data, state),
    consistency: panel("consistency", "训练日历", "",
      `<div class="consistency-matrix">
        <div class="heatmap-days" aria-hidden="true"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div>
        <div class="activity-scroll"><div class="heatmap" aria-label="训练日历">${Array.from({ length: monday }, () => '<span class="hm-pad"></span>').join("")}
        ${cells.map((cell) => `<button type="button" class="${cell.active ? "worked" : ""}" data-action="heatmap-day" data-value="${cell.date}" aria-pressed="${state.heatmapDate === cell.date}" title="${cell.date}${cell.active ? " · 点击查看训练详情" : ""}" aria-label="${cell.date}${cell.active ? " 已训练，点击查看详情" : ""}"></button>`).join("")}</div></div>
      </div>
      <footer class="panel-foot"><span class="heatmap-readout" data-heatmap-readout>${selectedCell
        ? (selectedCell.active
          ? `<button type="button" class="heatmap-open" data-action="day-detail" data-value="${selectedCell.date}">${shortDate(selectedCell.date)} · ${esc(state.heatmapSummary || "已训练")} ${icon("chevron", 13)}</button>`
          : `${shortDate(selectedCell.date)} · 未训练 <button type="button" class="heatmap-add" data-action="edit-for-date" data-value="${selectedCell.date}">补录</button>`)
        : `活跃 ${activeCount} 天`}</span>${legend(["完成训练", "red"])}</footer>`,
      `<button class="quiet" type="button" data-action="route" data-value="calendar">月历 ${icon("chevron", 15)}</button>`),
    strength: panel("strength", "动作进步", "",
      `<div class="chart-wrap">
        <div class="chart-info"><strong>${best ? matrix(fmt(best)) : "—"}</strong><span>kg</span>${best1RM ? `<small>1RM ${fmt(best1RM)}</small>` : ""}<span class="chart-readout" data-chart-readout></span></div>
        ${graph(data.strength.points, [{ key: "weight", label: "最高重量", css: "primary" }, { key: "estimated1rm", label: "估算 1RM", css: "secondary" }], { from: data.from, to: data.through, unit: "kg" })}
       </div>
       <footer class="panel-foot">${legend(["最高重量", "red"], ["估算 1RM", "neutral"])}</footer>`,
      data.strength.exercises.length ? `<select aria-label="选择动作" data-change="strength">${data.strength.exercises.map(({ id, name }) => `<option value="${esc(id)}"${id === data.strength.selectedExercise ? " selected" : ""}>${esc(name)}</option>`).join("")}</select>` : ""),
    weight: panel("weight", "体重趋势", "",
      `<div class="chart-wrap">
        <div class="chart-info"><strong>${latestWeight?.weight != null ? matrix(fmt(latestWeight.weight)) : "—"}</strong><span>kg</span>${latestWeight ? `<small>${shortDate(latestWeight.date)}</small>` : ""}<span class="chart-readout" data-chart-readout></span></div>
        ${weightChart(data.weights, { from: data.from, to: data.through, goal: data.goals.targetWeight, showAverage: true })}
       </div>
       <footer class="panel-foot">${legend(["称重", "red"], ["滚动平均", "neutral"])}${data.goals.targetWeight ? `<span>目标 ${fmt(data.goals.targetWeight)} kg</span>` : ""}</footer>`,
      `<button class="quiet" type="button" data-action="today-weight">${icon("plus", 17)} 记体重</button>`),
    nutrition: panel("nutrition", "饮食趋势", "",
      `<div class="chart-wrap">
        <div class="chart-info"><strong>${avgCalories != null ? matrix(fmt(avgCalories, 0)) : "—"}</strong><span>kcal</span><small>日均</small><span class="chart-readout" data-chart-readout></span></div>
        ${data.nutrition.length ? graph(nutritionSeries,
          [{ key: "calories", label: "已记录摄入", css: "bars" }], { onlyBars: true, goal: data.goals.calories, unit: "kcal" }) : empty("暂无饮食记录", "记录餐次后即可查看趋势。")}
       </div>
       <footer class="panel-foot">${nutritionSize === 1 ? legend(["完整", "red"], ["部分", "faded"]) : `<span>${nutritionSize} 天均值</span>`}<span>日均蛋白 ${fmt(avgProtein)} g</span></footer>`,
      `<button class="quiet" type="button" data-action="today-diet">${icon("plus", 17)} 记饮食</button>`),
    apple: applePanel(data, state),
    feeling: panel("feeling", "训练体感", "",
      data.totals.workouts ? `<div class="feeling-split" aria-hidden="true">${feelingSegments.map((seg) =>
        `<span class="seg-${seg.key}" style="flex:${Math.max(seg.count ? 0.5 : 0, seg.count)}"></span>`).join("")}</div>
        <div class="feeling-bars">${feelingSegments.map((seg) =>
          `<div class="feeling-row"><span>${seg.name}</span>${dotMeter(seg.count / feelingTotal, 10)}<strong>${seg.count} 次 <small>${seg.pct}%</small></strong></div>`).join("")}</div>
        <div class="health-metrics feeling-metrics">
          <div><span>良好反馈</span><strong>${comfortPct != null ? `${comfortPct}<small>%</small>` : "—"}</strong>${feelingTagged ? `<small>${comfortCount} / ${feelingTagged} 次</small>` : ""}</div>
          <div><span>周均节奏</span><strong>${fmt(workoutCount / Math.max(1, data.period / 7), 1)} <small>次/周</small></strong><small>${data.totals.timedWorkouts ? `均次 ${duration(Math.round(data.totals.seconds / data.totals.timedWorkouts))}` : `共 ${data.totals.workouts} 次`}</small></div>
        </div>
        ${feelingLogs.length ? `<div class="feeling-recent"><p class="chart-caption">近期状态记录</p><ul class="health-list feeling-list">${feelingLogs.map((row) =>
          `<li><button type="button" class="feeling-log-btn" data-action="workout-detail" data-value="${esc(row.id)}">
            <span><i class="feeling-dot is-${esc(row.feeling ?? "missing")}" aria-hidden="true"></i>${esc(row.title)}</span>
            <span class="feeling-log-meta">${shortDate(row.date)} · <b>${esc(row.feeling ? feelings[row.feeling] : "未标")}</b></span>
          </button></li>`).join("")}</ul></div>` : ""}
        <footer class="panel-foot"><span>已记录 ${feelingTagged} / ${data.totals.workouts} 次${data.feelings.missing ? ` · 未填 ${data.feelings.missing}` : ""}</span></footer>`
      : empty("暂无训练体感", "训练结束时可选择轻松、均衡或疲惫。"),
      dominantFeeling?.count ? `<span class="atlas-pill feeling-pill">${esc(dominantFeeling.name)}为主 · ${dominantFeeling.pct}%</span>` : ""),
  };
  const rows = [];
  let row = [];
  function finishRow() {
    if (!row.length) return;
    const split = row.length === 2 && row.includes("load") ? " feature-" + (row[0] === "load" ? "first" : "second") : "";
    rows.push(`<div class="dashboard-row${row.length === 1 ? " full" : ""}${split}">${row.map((id) => id === "energy" ? energy : cards[id]).join("")}</div>`);
    row = [];
  }
  const hideApplePanel = !state.appleHealthConnected && !(data.apple?.length > 0);
  const requested = (energy ? [...data.preferences.panels, "energy"] : data.preferences.panels)
    .filter((id) => !(hideApplePanel && id === "apple"))
    .filter((id) => part === "all" || (part === "primary") === primaryPanels.includes(id));
  for (const id of requested) {
    row.push(id);
    if (row.length === 2) finishRow();
  }
  finishRow();
  return rows.join("");
}
