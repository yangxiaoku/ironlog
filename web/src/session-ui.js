import { duration, esc, fmt, feelings, icon, muscles, shortDate, supersetBadges } from "./ui.js";
import { matrix } from "./display.js";
import { appleLine } from "./apple-health-ui.js";

const groupTypes = { normal: "常规", warmup: "热身", failure: "力竭", drop: "递减", rest_pause: "休停" };
const metrics = {
  weight: ["最高重量", "kg"], oneRepMax: ["估算 1RM", "kg"], hold: ["最长时长", "秒"], assistance: ["最低辅助重量", "kg"],
};

function groupValue(set, mode) {
  if (mode === "timed") return fmt(set.seconds) + " 秒";
  if (mode === "assisted") return `辅助 ${fmt(set.weight)} kg × ${fmt(set.reps)}`;
  return set.weight ? `${fmt(set.weight)} kg × ${fmt(set.reps)}` : `${fmt(set.reps)} 次`;
}

export function routinePreview(result, opts = {}) {
  const { date = "", todayDate = "", allowEditSchedule = false, muscleStatus = [] } = opts;
  const isFuture = date && todayDate && date > todayDate;
  const totalSets = result.exercises.reduce((total, row) => total + row.sets, 0);
  const progCount = result.summary?.progressionCount ?? 0;
  const prCount = result.summary?.prOpportunityCount ?? 0;
  const deloadCount = result.summary?.deloadCount ?? 0;
  const estMinutes = result.summary?.estimatedMinutes ?? 0;
  const targetMuscles = new Set(result.exercises.map((row) => row.snapshot?.muscle).filter(Boolean));
  const recoveryAlerts = (Array.isArray(muscleStatus) ? muscleStatus : []).filter(
    (st) => targetMuscles.has(st.key) && Number.isFinite(st.recoveryPct) && st.recoveryPct < 60,
  );

  return `<div class="routine-preview dialog-form">
    <div class="preview-meta">
      ${date ? `<span>${shortDate(date)}${isFuture ? " 排期" : ""}</span>` : ""}
      <span>${result.exercises.length} 个动作</span>
      <span>${totalSets} 个计划组</span>
      ${estMinutes ? `<span>约 ${estMinutes} 分钟</span>` : ""}
      ${progCount ? `<span class="meta-accent">${icon("trending", 12)} ${progCount} 项渐进</span>` : ""}
      ${prCount ? `<span class="meta-pr">${icon("trophy", 12)} ${prCount} 个 PR 机会</span>` : ""}
      ${deloadCount ? `<span class="meta-warn">${icon("bolt", 12)} ${deloadCount} 项建议减载</span>` : ""}
    </div>
    ${recoveryAlerts.length ? `<div class="preview-recovery-alert" role="status">${icon("bolt", 14)}<span><b>目标肌群恢复提醒：</b>${recoveryAlerts.map((st) => `${esc(st.name)} 当前恢复 ${st.recoveryPct}%（${esc(st.statusLabel)}）`).join(" · ")}</span></div>` : ""}
    <ol class="preview-list">${(() => {
      const ssBadges = supersetBadges(result.exercises);
      return result.exercises.map(({ snapshot, sets, weight, reps, seconds, restSeconds, progression, pr, backup }, index) => {
        const hasPrAlert = pr && pr.kind !== "baseline";
        const isProg = progression?.status === "progress_weight" || progression?.status === "progress_reps";
        const isDeload = progression?.status === "plateau_deload";
        const ssBadge = ssBadges[index];
        return `<li class="preview-row-card${ssBadge ? " has-superset" : ""}">
        <div class="preview-row-main">
          <span class="preview-index">${String(index + 1).padStart(2, "0")}</span>
          <div>
            ${ssBadge ? `<span class="superset-pill">超级组 ${esc(ssBadge)}</span> ` : ""}<strong>${esc(snapshot.name)}</strong>
            <small>组间休息 ${restSeconds} 秒${progression?.ruleLabel ? ` · ${esc(progression.ruleLabel)}` : ""}${backup ? ` · 备选 ${esc(backup.name)}` : ""}</small>
          </div>
          <span class="preview-target">${sets} 组 <i>·</i> ${groupValue({ weight, reps, seconds }, snapshot.mode)}</span>
        </div>
        ${progression || pr ? `<div class="preview-signals">
          ${progression ? `<span class="sig-pill${isProg ? " is-up" : isDeload ? " is-warn" : ""}" title="${esc(progression.forecast)}">${icon("trending", 12)} ${esc(progression.statusLabel)}</span>` : ""}
          ${pr ? `<span class="sig-pill${hasPrAlert ? " is-pr" : ""}" title="${esc(pr.detail)}">${icon("trophy", 12)} ${esc(pr.label)}</span>` : ""}
          ${progression?.reason ? `<span class="sig-note">${esc(progression.reason)}</span>` : ""}
        </div>` : ""}
      </li>`;
      }).join("");
    })()}</ol>
    <footer class="dialog-foot">
      ${allowEditSchedule && date ? `<button type="button" class="secondary-button" id="edit-scheduled-day">调整当日排期</button>` : ""}
      <button type="button" class="primary-button" id="launch-routine">${isFuture ? "提前至今日开练" : "开始训练"} ${icon("chevron", 17)}</button>
    </footer>
  </div>`;
}

export function workoutReport(report, health = null) {
  const stats = [
    ["训练时长", duration(report.duration), ""],
    ["有效工作组", fmt(report.sets), "组"],
    ["训练容量", fmt(report.volume, 2), "kg"],
  ];
  const breakthroughs = report.records.length ? `<section class="report-records">
    <h3><i aria-hidden="true"></i>个人新纪录</h3>
    ${report.records.map(({ name, improvements }) => `<div class="report-pr">
      <strong>${esc(name)}</strong><ul>${improvements.map(({ metric, previous, current }) => {
        const [label, unit] = metrics[metric];
        return `<li><span>${label}</span><span>${fmt(previous, 2)} → <b>${fmt(current, 2)} ${unit}</b></span></li>`;
      }).join("")}</ul></div>`).join("")}
  </section>` : "";
  const cmp = report.previousComparison;
  const cmpHtml = cmp ? `<div class="report-comparison-bar">
    <span>较上次 ${shortDate(cmp.date)}</span>
    <b class="${cmp.volumeDelta > 0 ? "is-up" : cmp.volumeDelta < 0 ? "is-down" : ""}">容量 ${cmp.volumeDelta >= 0 ? "+" : ""}${fmt(cmp.volumeDelta, 1)} kg${cmp.volumePct != null ? ` (${cmp.volumePct >= 0 ? "+" : ""}${cmp.volumePct}%)` : ""}</b>
    ${cmp.setsDelta ? `<small>工作组 ${cmp.setsDelta > 0 ? "+" : ""}${cmp.setsDelta}</small>` : ""}
  </div>` : "";
  const muscleStripHtml = report.muscleSets?.length ? `<div class="report-muscles" aria-label="本场肌群有效组数">
    <span class="report-muscles-label">肌群刺激</span>
    <div class="report-muscles-chips">${report.muscleSets.map((m) => `<span>${esc(muscles[m.key] ?? m.key)} <b>${fmt(m.sets)}</b> 组</span>`).join("")}</div>
    <small class="report-recovery-tip">单场 ≥6 组肌群建议休整 48–72h，&lt;6 组约 24–48h</small>
  </div>` : "";
  return `<div class="workout-report dialog-form"><div class="report-meta"><time datetime="${report.date}">${report.date}</time>
    ${report.feeling ? `<span>体感 ${feelings[report.feeling]}</span>` : ""}<span>训练已完成</span></div>
    <div class="report-stats">${stats.map(([label, value, unit], index) => `<div><span>${label}</span>
      <strong>${index === 1 ? matrix(value) : value} ${unit ? `<small>${unit}</small>` : ""}</strong></div>`).join("")}</div>
    ${cmpHtml}${muscleStripHtml}${breakthroughs}${health ? `<section class="report-health">${appleLine(health)}</section>` : ""}<section class="report-exercises">
      <h3>动作明细</h3>
      ${report.exercises.length ? report.exercises.map((row) => `<article><h4>${row.supersetGroup ? `<span class="superset-pill">超级组 ${esc(row.supersetGroup)}</span>` : ""}${esc(row.name)} <small>${row.completed.length} 组${row.volume > 0 ? ` · ${fmt(row.volume, 0)} kg` : ""}</small></h4>
        <ul>${row.completed.map((set, i) => `<li><span class="set-index">${i + 1}</span><span>${groupValue(set, row.mode)}</span>
          ${set.rir != null ? `<small class="set-rir-tag">RIR ${set.rir}</small>` : ""}
          ${set.type !== "normal" ? `<small>${groupTypes[set.type] ?? set.type}</small>` : ""}</li>`).join("")}</ul>
      </article>`).join("") : '<p class="muted">暂无已完成的有效组。</p>'}
    </section>
    ${report.notes ? `<section class="report-notes"><h3>训练备注</h3><p>${esc(report.notes)}</p></section>` : ""}
    <footer class="report-foot-actions">
      <div class="report-foot-secondary">
        <button type="button" class="secondary-button" id="edit-workout-from-report">编辑</button>
        ${report.canSyncToActivePlan && report.exercises.length ? `<button type="button" class="secondary-button" id="sync-workout-to-plan">${icon("refresh", 15)} 同步回计划</button>` : ""}
        ${report.exercises.length ? `<button type="button" class="secondary-button" id="save-workout-template">${icon("bookmark", 15)} 存为模板</button>` : ""}
        <button type="button" class="secondary-button" id="share-workout-card">${icon("download", 15)} 分享记录</button>
        <button type="button" class="quiet" id="copy-workout-report">${icon("copy", 15)} 复制摘要</button>
      </div>
      ${report.exercises.length ? `<button type="button" class="primary-button" id="repeat-workout-from-report">${icon("refresh", 15)} 再练一次</button>` : ""}
    </footer></div>`;
}

export function workoutReportText(report) {
  return [
    report.title + " · " + report.date,
    `${duration(report.duration)} / ${fmt(report.sets)} 有效工作组 / ${fmt(report.volume, 2)} kg`,
    ...report.exercises.map((row) => `${row.supersetGroup ? `[超级组${row.supersetGroup}] ` : ""}${row.name}　${row.completed.map((set) =>
      groupValue(set, row.mode) + (set.rir != null ? ` RIR${set.rir}` : "") + (set.type !== "normal" ? `（${groupTypes[set.type] ?? set.type}）` : "")).join("、")}`),
  ].join("\n");
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
  const raw = String(text ?? "");
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let cut = raw;
  while (cut.length > 1 && ctx.measureText(cut + "…").width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut + "…";
}

function workSetsOf(row) {
  const completed = row.completed ?? [];
  const work = completed.filter((s) => s.type !== "warmup");
  return work.length ? work : completed;
}

function bestSetObject(pool, mode) {
  if (!pool.length) return null;
  if (mode === "timed") {
    return pool.reduce((a, b) => ((b.seconds || 0) > (a.seconds || 0) ? b : a));
  }
  if (mode === "assisted") {
    return pool.reduce((a, b) => ((b.weight || 0) < (a.weight || 0) ? b : a));
  }
  return pool.reduce((a, b) => {
    if ((a.weight || 0) === 0 && (b.weight || 0) === 0) return (b.reps || 0) > (a.reps || 0) ? b : a;
    const scoreA = (a.weight || 0) * (1 + (a.reps || 0) / 30);
    const scoreB = (b.weight || 0) * (1 + (b.reps || 0) / 30);
    return scoreB > scoreA ? b : a;
  });
}

function bestSetLabel(row) {
  const pool = workSetsOf(row);
  const best = bestSetObject(pool, row.mode);
  if (!best) return "已完成";
  if (row.mode === "timed") return `最长 ${best.seconds || 0} 秒`;
  if (row.mode === "assisted") return `辅助 ${fmt(best.weight)} kg × ${best.reps}`;
  return best.weight > 0 ? `${fmt(best.weight)} kg × ${best.reps}` : `${best.reps} 次`;
}

function posterExerciseSetSummary(pool, mode) {
  const count = pool.length;
  if (!count) return "已完成";
  const best = bestSetObject(pool, mode);
  if (!best) return `${count} 组`;
  if (mode === "timed") return `${best.seconds || 0} 秒 × ${count} 组`;
  if (mode === "assisted") return `辅助 ${fmt(best.weight)} kg × ${best.reps || 0} × ${count} 组`;
  if ((best.weight || 0) > 0) return `${fmt(best.weight)} kg × ${best.reps || 0} × ${count} 组`;
  return `徒手 × ${best.reps || 0} × ${count} 组`;
}

export const SHARE_CARD_STYLES = [
  { id: "paper", label: "纸质点阵", desc: "特种棉纸 · 盲压浮雕" },
  { id: "ring", label: "深海圆环", desc: "午夜深蓝 · 时长占比" },
  { id: "mono", label: "黑白纪实", desc: "纪实影像 · 荧光绿标" },
  { id: "poster", label: "赤红海报", desc: "赤红铸铁 · 双栏排版" },
  { id: "obsidian", label: "暗夜精工", desc: "炭黑半调 · 信号红标" },
];

const APPLE_ACTIVITY_TITLES = {
  elliptical: "椭圆机",
  running: "跑步",
  walking: "健走",
  cycling: "骑行",
  swimming: "游泳",
  rowing: "划船机",
  stair_climbing: "爬楼机",
  hiit: "HIIT",
  yoga: "瑜伽",
  hiking: "徒步",
  jump_rope: "跳绳",
  functional_strength: "功能性力量",
  traditional_strength: "力量训练",
  strength_training: "力量训练",
  core_training: "核心训练",
};

function cleanCardioTitle(rawTitle, activityType) {
  if (activityType && APPLE_ACTIVITY_TITLES[activityType]) {
    return APPLE_ACTIVITY_TITLES[activityType];
  }
  const t = String(rawTitle || "").trim();
  if (!t) return "有氧训练";
  if (/elliptical/i.test(t)) return "椭圆机";
  if (/run/i.test(t)) return "跑步";
  if (/walk/i.test(t)) return "健走";
  if (/cycl|bike/i.test(t)) return "骑行";
  if (/swim/i.test(t)) return "游泳";
  if (/row/i.test(t)) return "划船机";
  if (/stair/i.test(t)) return "爬楼机";
  if (/hiit/i.test(t)) return "HIIT";
  return t.replace(/^Apple\s*Watch\s*·?\s*/i, "").trim() || "有氧训练";
}

function isStrengthAppleEntry(entry) {
  const type = String(entry?.activityType || "").toLowerCase();
  const title = String(entry?.title || "").toLowerCase();
  return (
    type.includes("strength") ||
    type === "traditional_strength_training" ||
    type === "functional_strength_training" ||
    title.includes("力量") ||
    title.includes("strength")
  );
}

export function buildDailySharePayload({
  date = "",
  todayKey = "",
  workouts = [],
  appleEntries = [],
  diets = [],
  nutrition = null,
  catalogueMap = null,
  username = "",
  isDemo = false,
  singleReport = null,
  singleHealth = null,
} = {}) {
  const targetDate = date || singleReport?.date || todayKey || new Date().toISOString().slice(0, 10);
  const dateDot = String(targetDate).replace(/-/g, ".");
  const headline = "今日记录";
  const authorLabel = username ? `铁记 · ${username}` : "铁记 · IRONLOG";

  let strengthSeconds = 0;
  let totalSets = 0;
  let totalVolumeKg = 0;
  const exercises = [];
  const cardioItems = [];

  if (singleReport && (!workouts || !workouts.length)) {
    strengthSeconds += Number(singleReport.duration) || 0;
    totalSets += Number(singleReport.sets) || 0;
    totalVolumeKg += Number(singleReport.volume) || 0;
    for (const row of singleReport.exercises ?? []) {
      const pool = workSetsOf(row);
      if (!pool.length) continue;
      exercises.push({
        name: row.name,
        setsCount: pool.length,
        summary: posterExerciseSetSummary(pool, row.mode || "reps"),
      });
    }
  } else {
    for (const rec of workouts ?? []) {
      const w = rec?.data ?? rec;
      if (!w) continue;
      const dur =
        typeof w.elapsedSeconds === "number" && w.elapsedSeconds > 0
          ? w.elapsedSeconds
          : w.endedAt && w.startedAt
            ? Math.max(0, Math.round((Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 1000))
            : 0;
      let workoutHasStrength = false;
      for (const row of w.exercises ?? []) {
        const meta = row.snapshot ?? (catalogueMap && typeof catalogueMap.get === "function" ? catalogueMap.get(row.exerciseId) : null);
        const name = meta?.name ?? row.name ?? row.exerciseId;
        const mode = meta?.mode ?? row.mode ?? "reps";
        const mult = meta?.volumeMultiplier ?? 1;
        const category = meta?.category ?? (mode === "timed" && meta?.muscle === "cardio" ? "cardio" : "strength");
        const completedSets = (row.sets ?? row.completed ?? []).filter((s) => s.completed !== false);
        const work = completedSets.filter((s) => s.type !== "warmup");
        const pool = work.length ? work : completedSets;
        if (!pool.length) continue;
        if (category === "cardio" || meta?.muscle === "cardio") {
          const secSum = pool.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
          cardioItems.push({
            title: name,
            minutes: Math.max(1, Math.round((secSum || dur || 900) / 60)),
            avgBpm: null,
            caloriesKcal: null,
          });
          continue;
        }
        workoutHasStrength = true;
        totalSets += work.length;
        for (const s of work) {
          if (mode === "reps" && (s.weight || 0) > 0 && (s.reps || 0) > 0) {
            totalVolumeKg += s.weight * s.reps * mult;
          }
        }
        exercises.push({
          name,
          setsCount: pool.length,
          summary: posterExerciseSetSummary(pool, mode),
        });
      }
      if (workoutHasStrength && dur > 0) {
        strengthSeconds += dur;
      }
    }
  }

  const allApple = [...(appleEntries ?? [])];
  if (singleHealth && !allApple.some((a) => a && a.id === singleHealth.id)) {
    allApple.push(singleHealth);
  }

  for (const ap of allApple) {
    if (!ap) continue;
    const mins = Math.max(1, Math.round((Number(ap.durationSeconds) || 0) / 60));
    const avgBpm = ap.heartRate?.avgBpm ?? ap.avgHeartRate ?? null;
    const kcal = ap.activeEnergyKcal ?? ap.energyKcal ?? null;
    if (isStrengthAppleEntry(ap)) {
      if (strengthSeconds === 0 && (Number(ap.durationSeconds) || 0) > 0) {
        strengthSeconds += Number(ap.durationSeconds) || 0;
      }
      if (!exercises.length) {
        exercises.push({
          name: cleanCardioTitle(ap.title, ap.activityType),
          setsCount: 0,
          summary: [
            `${mins} 分钟`,
            kcal != null ? `${Math.round(kcal)} kcal` : "",
            avgBpm != null ? `${Math.round(avgBpm)} bpm` : "",
          ].filter(Boolean).join(" · "),
        });
      }
    } else {
      cardioItems.push({
        title: cleanCardioTitle(ap.title, ap.activityType),
        minutes: mins,
        avgBpm: avgBpm != null ? Math.round(avgBpm) : null,
        caloriesKcal: kcal != null ? Math.round(kcal) : null,
        distanceMeters: ap.distanceMeters ?? null,
      });
    }
  }

  const strengthMinutes = strengthSeconds > 0
    ? Math.max(1, Math.round(strengthSeconds / 60))
    : exercises.length > 0
      ? Math.max(15, totalSets * 4)
      : 0;

  const cardioMinutes = cardioItems.reduce((sum, c) => sum + (c.minutes || 0), 0);
  const primaryCardio = cardioItems[0] ?? null;
  const bpmItems = cardioItems.filter((c) => c.avgBpm != null && c.avgBpm > 0);
  const avgCardioBpm = bpmItems.length
    ? Math.round(bpmItems.reduce((sum, c) => sum + c.avgBpm, 0) / bpmItems.length)
    : null;
  const totalCardioKcal = cardioItems.reduce((sum, c) => sum + (c.caloriesKcal || 0), 0);

  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  if (Array.isArray(diets) && diets.length > 0) {
    for (const r of diets) {
      const d = r?.data ?? r;
      if (!d) continue;
      calories += Number(d.calories) || 0;
      protein += Number(d.protein) || 0;
      carbs += Number(d.carbs) || 0;
      fat += Number(d.fat) || 0;
    }
  } else if (nutrition && typeof nutrition === "object") {
    calories = Number(nutrition.calories) || 0;
    protein = Number(nutrition.protein) || 0;
    carbs = Number(nutrition.carbs) || 0;
    fat = Number(nutrition.fat) || 0;
  }

  const totalMinutes = strengthMinutes + cardioMinutes;

  return {
    date: targetDate,
    dateDot,
    headline,
    authorLabel,
    totalMinutes,
    strength: {
      hasData: exercises.length > 0 || strengthMinutes > 0,
      minutes: strengthMinutes,
      totalSets: Math.round(totalSets),
      totalVolumeKg: Math.round(totalVolumeKg),
      exercises,
    },
    cardio: {
      hasData: cardioItems.length > 0 && cardioMinutes > 0,
      minutes: cardioMinutes,
      title: cardioItems.length > 1
        ? `${primaryCardio.title}等 ${cardioItems.length} 项`
        : (primaryCardio?.title ?? "未记录"),
      avgBpm: avgCardioBpm != null ? Math.round(avgCardioBpm) : null,
      caloriesKcal: totalCardioKcal > 0 ? Math.round(totalCardioKcal) : null,
    },
    diet: {
      hasData: calories > 0 || protein > 0 || carbs > 0 || fat > 0,
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
    },
  };
}

const bgImageCache = new Map();
function loadShareBgImage(src) {
  if (typeof Image === "undefined") return Promise.resolve(null);
  if (bgImageCache.has(src)) return bgImageCache.get(src);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  bgImageCache.set(src, promise);
  return promise;
}

function drawCoverImage(ctx, img, x, y, w, h) {
  if (!img || !img.width || !img.height) return false;
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  return true;
}

function drawSlantedMarker(ctx, x, y, w, h, slant, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + slant, y);
  ctx.lineTo(x + w + slant, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}

function drawCrosshair(ctx, cx, cy, arm, color, lineWidth = 1.6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();
}

function drawTickRuler(ctx, x, y, count, spacing, height, color, lineWidth = 1.6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (let i = 0; i < count; i++) {
    const tx = x + i * spacing;
    ctx.beginPath();
    ctx.moveTo(tx, y);
    ctx.lineTo(tx, y + height);
    ctx.stroke();
  }
}

/**
 * Render high-density circular dot-matrix digits (like the "76" in Style 1 Paper),
 * sampling from the exact ink bounding box so no edge can ever be clipped.
 */
function drawCircularDotMatrixText(ctx, text, x, y, targetH, dotPitch, dotRadius, color, fontFamily) {
  const str = String(text || "0");
  const offW = Math.max(220, str.length * 110);
  const offH = 140;
  const off = document.createElement("canvas");
  off.width = offW;
  off.height = offH;
  const octx = off.getContext("2d");
  if (!octx) return 0;

  octx.clearRect(0, 0, offW, offH);
  octx.fillStyle = "#000";
  octx.textBaseline = "alphabetic";
  octx.font = `900 84px ${fontFamily}`;
  octx.fillText(str, 24, 106);

  const imgData = octx.getImageData(0, 0, offW, offH).data;
  let minCol = offW;
  let maxCol = -1;
  let minRow = offH;
  let maxRow = -1;
  for (let r = 0; r < offH; r++) {
    for (let c = 0; c < offW; c++) {
      if (imgData[(r * offW + c) * 4 + 3] > 110) {
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
      }
    }
  }
  if (maxCol < minCol || maxRow < minRow) return 0;

  const boxW = maxCol - minCol + 1;
  const boxH = maxRow - minRow + 1;
  const gridRows = Math.max(18, Math.round(targetH / dotPitch));
  const gridCols = Math.max(8, Math.round(gridRows * (boxW / boxH) * 0.92));

  ctx.fillStyle = color;
  for (let gr = 0; gr < gridRows; gr++) {
    const sy = Math.min(maxRow, Math.max(minRow, Math.floor(minRow + ((gr + 0.5) / gridRows) * boxH)));
    for (let gc = 0; gc < gridCols; gc++) {
      const sx = Math.min(maxCol, Math.max(minCol, Math.floor(minCol + ((gc + 0.5) / gridCols) * boxW)));
      const alpha = imgData[(sy * offW + sx) * 4 + 3];
      if (alpha > 110) {
        const cx = x + gc * dotPitch + dotRadius;
        const cy = y + gr * dotPitch + dotRadius;
        ctx.beginPath();
        ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return gridCols * dotPitch;
}

function drawInlinePipeSegments(ctx, segments, startX, baselineY, opts) {
  const {
    numFont,
    textFont,
    color,
    pipeColor,
    pipeGap = 24,
    pipeTopOffset = -34,
    pipeHeight = 40,
  } = opts;
  let curX = startX;
  segments.forEach((seg, idx) => {
    if (idx > 0) {
      ctx.strokeStyle = pipeColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(curX, baselineY + pipeTopOffset);
      ctx.lineTo(curX, baselineY + pipeTopOffset + pipeHeight);
      ctx.stroke();
      curX += pipeGap;
    }
    ctx.fillStyle = color;
    for (const part of seg) {
      ctx.font = part.bold ? numFont : textFont;
      ctx.fillText(part.text, curX, baselineY);
      curX += ctx.measureText(part.text).width;
    }
    curX += pipeGap;
  });
}

async function renderStylePaper(ctx, W, H, payload, sans, mono) {
  const bg = await loadShareBgImage("./share-bg-paper.jpg");
  if (!drawCoverImage(ctx, bg, 0, 0, W, H)) {
    ctx.fillStyle = "#f3ede1";
    ctx.fillRect(0, 0, W, H);
  }

  const ink = "#171614";
  const rule = "rgba(23, 22, 20, 0.55)";
  const padX = 48;

  // Header
  ctx.fillStyle = ink;
  ctx.font = `800 42px ${sans}`;
  ctx.fillText("IRONLOG", padX, 82);

  ctx.font = `600 32px ${mono}`;
  const dateW = ctx.measureText(payload.dateDot).width;
  const dateX = W - padX - dateW;
  ctx.fillText(payload.dateDot, dateX, 80);

  ctx.fillStyle = "#b8332a";
  ctx.beginPath();
  ctx.arc(dateX - 24, 69, 8.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rule;
  ctx.fillRect(padX, 112, W - padX * 2, 1.8);

  // Title
  ctx.fillStyle = ink;
  ctx.font = `900 108px ${sans}`;
  ctx.fillText(payload.headline, padX - 4, 244);

  // Registration crosshair + ruler
  drawCrosshair(ctx, 52, 292, 12, rule, 1.6);
  drawTickRuler(ctx, 106, 285, 7, 19, 15, rule, 1.6);

  // Giant circular dot-matrix hero duration
  const heroStr = String(payload.totalMinutes || 0);
  const dotPitch = heroStr.length >= 3 ? 10 : 12;
  const dotRadius = heroStr.length >= 3 ? 3.7 : 4.4;
  const matrixW = drawCircularDotMatrixText(ctx, heroStr, 52, 342, 250, dotPitch, dotRadius, ink, sans);

  const unitX = 52 + matrixW + 32;
  ctx.fillStyle = ink;
  ctx.font = `900 72px ${sans}`;
  ctx.fillText("分钟", unitX, 520);
  ctx.font = `500 35px ${sans}`;
  ctx.fillText("总训练时长", unitX, 580);

  drawCrosshair(ctx, W - padX, 592, 12, rule, 1.6);

  // Section 1: 力量训练
  ctx.fillStyle = rule;
  ctx.fillRect(padX, 638, W - padX * 2, 1.8);

  ctx.fillStyle = ink;
  ctx.fillRect(padX, 672, 13, 48);
  ctx.font = `800 46px ${sans}`;
  ctx.fillText("力量训练", padX + 34, 712);

  drawInlinePipeSegments(
    ctx,
    [
      [{ text: String(payload.strength.minutes), bold: true }, { text: " 分钟", bold: false }],
      [{ text: String(payload.strength.totalSets), bold: true }, { text: " 组", bold: false }],
      [{ text: fmt(payload.strength.totalVolumeKg, 0), bold: true }, { text: " kg", bold: false }],
    ],
    382,
    712,
    {
      numFont: `800 42px ${sans}`,
      textFont: `600 31px ${sans}`,
      color: ink,
      pipeColor: rule,
      pipeGap: 28,
      pipeTopOffset: -35,
      pipeHeight: 42,
    },
  );

  ctx.fillStyle = rule;
  ctx.fillRect(padX, 756, W - padX * 2, 1.6);

  const hasCardio = Boolean(payload.cardio.hasData);
  const hasDiet = Boolean(payload.diet.hasData);
  const maxEx = (!hasCardio && !hasDiet) ? 8 : (!hasCardio || !hasDiet) ? 6 : 4;
  const exRows = (payload.strength.exercises.length
    ? payload.strength.exercises
    : [{ name: "今日未记录力量动作", summary: "—" }]
  ).slice(0, maxEx);

  const tableTop = 756;
  const availForTable = (!hasCardio && !hasDiet)
    ? 620
    : (!hasCardio && hasDiet)
      ? 360
      : (hasCardio && !hasDiet)
        ? 480
        : 248;
  const rowH = Math.max(58, Math.min(88, Math.floor(availForTable / Math.max(1, exRows.length))));
  const tableBottom = tableTop + exRows.length * rowH;

  exRows.forEach((ex, i) => {
    const ry = tableTop + i * rowH;
    const textY = ry + Math.round(rowH * 0.64);
    ctx.fillStyle = ink;
    ctx.font = `700 33px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.name, 410), padX + 28, textY);

    ctx.font = `600 35px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.summary, 420), 548, textY);

    ctx.fillStyle = rule;
    ctx.fillRect(padX, ry + rowH, W - padX * 2, 1.5);
  });

  // Vertical center divider in exercise table
  ctx.fillStyle = rule;
  ctx.fillRect(504, tableTop, 1.6, tableBottom - tableTop);

  let curY = tableBottom + 36;

  // Section 2: 有氧训练 (only rendered when cardio data exists)
  if (hasCardio) {
    const cardioTop = curY;
    ctx.fillStyle = rule;
    ctx.fillRect(padX, cardioTop, W - padX * 2, 1.8);

    ctx.fillStyle = ink;
    ctx.fillRect(padX, cardioTop + 30, 13, 48);
    ctx.font = `800 46px ${sans}`;
    ctx.fillText("有氧训练", padX + 34, cardioTop + 70);

    const cardioSegs = [
      [{ text: payload.cardio.title, bold: false }],
      [{ text: String(payload.cardio.minutes), bold: true }, { text: " 分钟", bold: false }],
      ...(payload.cardio.avgBpm
        ? [[{ text: "平均心率 ", bold: false }, { text: String(payload.cardio.avgBpm), bold: true }, { text: " bpm", bold: false }]]
        : payload.cardio.caloriesKcal
          ? [[{ text: "消耗 ", bold: false }, { text: String(payload.cardio.caloriesKcal), bold: true }, { text: " kcal", bold: false }]]
          : []),
    ];

    drawInlinePipeSegments(ctx, cardioSegs, 340, cardioTop + 70, {
      numFont: `800 40px ${sans}`,
      textFont: `600 31px ${sans}`,
      color: ink,
      pipeColor: rule,
      pipeGap: 26,
      pipeTopOffset: -34,
      pipeHeight: 42,
    });

    ctx.fillStyle = rule;
    ctx.fillRect(padX, cardioTop + 104, W - padX * 2, 1.8);
    curY = cardioTop + 142;
  }

  // Section 3: 饮食记录 (only rendered when diet data exists)
  if (hasDiet) {
    const dietTop = hasCardio ? Math.max(curY, 1178) : Math.max(curY, 1136);
    ctx.fillStyle = rule;
    ctx.fillRect(padX, dietTop, W - padX * 2, 1.8);

    ctx.fillStyle = ink;
    ctx.fillRect(padX, dietTop + 30, 13, 48);
    ctx.font = `800 46px ${sans}`;
    ctx.fillText("饮食记录", padX + 34, dietTop + 70);

    const divTop = dietTop + 106;
    const macroY = dietTop + 194;
    ctx.fillStyle = ink;
    ctx.font = `800 58px ${sans}`;
    const kcalNum = fmt(payload.diet.calories, 0);
    ctx.fillText(kcalNum, padX + 4, macroY);
    const kcalW = ctx.measureText(kcalNum).width;
    ctx.font = `600 36px ${sans}`;
    ctx.fillText(" kcal", padX + 4 + kcalW, macroY);

    const cols = [
      [342, "蛋白质", payload.diet.protein],
      [578, "碳水", payload.diet.carbs],
      [796, "脂肪", payload.diet.fat],
    ];
    for (const [divX, label, grams] of cols) {
      ctx.fillStyle = rule;
      ctx.fillRect(divX, divTop, 1.6, 102);
      ctx.fillStyle = ink;
      ctx.font = `600 29px ${sans}`;
      ctx.fillText(label, divX + 32, divTop + 28);
      ctx.font = `800 54px ${sans}`;
      const gStr = fmt(grams, 0);
      ctx.fillText(gStr, divX + 32, macroY);
      const gW = ctx.measureText(gStr).width;
      ctx.font = `600 36px ${sans}`;
      ctx.fillText(" g", divX + 32 + gW, macroY);
    }
  }

  // Footer
  ctx.fillStyle = rule;
  ctx.fillRect(padX, 1434, W - padX * 2, 1.8);
  ctx.fillStyle = ink;
  ctx.font = `600 30px ${sans}`;
  ctx.fillText(payload.authorLabel, padX, 1486);
  drawTickRuler(ctx, W - padX - 116, 1470, 7, 19, 15, rule, 1.6);
}

async function renderStyleRing(ctx, W, H, payload, sans, mono) {
  const bg = await loadShareBgImage("./share-bg-ring.jpg");
  if (!drawCoverImage(ctx, bg, 0, 0, W, H)) {
    ctx.fillStyle = "#030a28";
    ctx.fillRect(0, 0, W, H);
  }

  const white = "#ffffff";
  const cobalt = "#004cff";
  const sky = "#73b8ff";
  const lineBlue = "rgba(110, 148, 224, 0.55)";
  const padX = 48;

  // Header
  ctx.fillStyle = white;
  ctx.font = `800 42px ${sans}`;
  ctx.fillText("IRONLOG", padX + 8, 66);

  ctx.font = `600 34px ${mono}`;
  const dateW = ctx.measureText(payload.dateDot).width;
  ctx.fillText(payload.dateDot, W - padX - dateW, 66);

  ctx.fillStyle = lineBlue;
  ctx.fillRect(padX, 90, W - padX * 2, 2);

  // Title
  ctx.fillStyle = white;
  ctx.font = `900 108px ${sans}`;
  ctx.fillText(payload.headline, padX + 4, 218);

  // Donut Ring Chart
  const cx = 305;
  const cy = 460;
  const r = 164;
  const ringW = 32;

  // 4 Cardinal ticks
  ctx.strokeStyle = "rgba(220, 232, 255, 0.85)";
  ctx.lineWidth = 2.2;
  for (const [x1, y1, x2, y2] of [
    [cx, cy - r - 30, cx, cy - r - 45],
    [cx, cy + r + 30, cx, cy + r + 45],
    [cx - r - 30, cy, cx - r - 45, cy],
    [cx + r + 30, cy, cx + r + 45, cy],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  const hasCardio = Boolean(payload.cardio.hasData);
  const hasDiet = Boolean(payload.diet.hasData);
  const totalM = Math.max(1, payload.totalMinutes || 1);
  const strM = payload.strength.minutes || 0;
  const carM = hasCardio ? (payload.cardio.minutes || 0) : 0;
  const strPct = hasCardio && payload.totalMinutes > 0 ? Math.round((strM / totalM) * 100) : 100;
  const carPct = hasCardio && payload.totalMinutes > 0 ? Math.max(0, 100 - strPct) : 0;
  const strAngle = (strPct / 100) * Math.PI * 2;
  const startAng = -Math.PI / 2;

  // Base track
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = ringW;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Cardio arc (sky blue)
  if (hasCardio && carPct > 0) {
    ctx.strokeStyle = sky;
    ctx.lineWidth = ringW;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng + strAngle, startAng + Math.PI * 2);
    ctx.stroke();
  }

  // Strength arc (cobalt blue)
  if (strPct > 0) {
    ctx.strokeStyle = cobalt;
    ctx.lineWidth = ringW;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, startAng + strAngle);
    ctx.stroke();
  }

  // Accent white dot on upper-right ring
  const dotAng = -Math.PI / 4;
  ctx.fillStyle = white;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(dotAng) * r, cy + Math.sin(dotAng) * r, 5.5, 0, Math.PI * 2);
  ctx.fill();

  // Center text inside ring
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = white;
  ctx.font = `800 112px ${sans}`;
  ctx.fillText(String(payload.totalMinutes || 0), cx, cy - 2);
  ctx.font = `600 38px ${sans}`;
  ctx.fillText("分钟", cx, cy + 48);
  ctx.fillStyle = lineBlue;
  ctx.fillRect(cx - 74, cy + 68, 148, 2);
  ctx.fillStyle = "#dbe7ff";
  ctx.font = `500 28px ${sans}`;
  ctx.fillText("总训练时长", cx, cy + 105);
  ctx.restore();

  // Right Legend (adapts when there is no cardio!)
  const legX = 570;
  ctx.fillStyle = cobalt;
  drawRoundedRect(ctx, legX, 312, 38, 38, 8);
  ctx.fill();
  ctx.fillStyle = white;
  ctx.font = `800 40px ${sans}`;
  ctx.fillText("力量训练", legX + 60, 346);
  ctx.font = `800 72px ${sans}`;
  const sMinStr = String(strM);
  ctx.fillText(sMinStr, legX + 60, 422);
  const sMinW = ctx.measureText(sMinStr).width;
  ctx.font = `600 35px ${sans}`;
  ctx.fillText(hasCardio ? ` 分钟 (${strPct}%)` : ` 分钟 · ${payload.strength.totalSets} 组`, legX + 60 + sMinW, 422);

  ctx.fillStyle = sky;
  drawRoundedRect(ctx, legX, 486, 38, 38, 8);
  ctx.fill();
  ctx.fillStyle = white;
  ctx.font = `800 40px ${sans}`;
  if (hasCardio) {
    ctx.fillText("有氧训练", legX + 60, 520);
    ctx.font = `800 72px ${sans}`;
    const cMinStr = String(carM);
    ctx.fillText(cMinStr, legX + 60, 596);
    const cMinW = ctx.measureText(cMinStr).width;
    ctx.font = `600 35px ${sans}`;
    ctx.fillText(` 分钟 (${carPct}%)`, legX + 60 + cMinW, 596);
  } else {
    ctx.fillText("训练总容量", legX + 60, 520);
    ctx.font = `800 66px ${sans}`;
    const volStr = fmt(payload.strength.totalVolumeKg, 0);
    ctx.fillText(volStr, legX + 60, 596);
    const volW = ctx.measureText(volStr).width;
    ctx.font = `600 35px ${sans}`;
    ctx.fillText(" kg", legX + 60 + volW, 596);
  }

  // Section 1: 力量训练
  ctx.fillStyle = lineBlue;
  ctx.fillRect(padX, 686, W - padX * 2, 2);

  drawSlantedMarker(ctx, padX, 720, 28, 46, 14, cobalt);
  ctx.fillStyle = white;
  ctx.font = `800 46px ${sans}`;
  ctx.fillText("力量训练", padX + 62, 760);

  drawInlinePipeSegments(
    ctx,
    [
      [{ text: String(payload.strength.minutes), bold: true }, { text: " 分钟", bold: false }],
      [{ text: String(payload.strength.totalSets), bold: true }, { text: " 组", bold: false }],
      [{ text: fmt(payload.strength.totalVolumeKg, 0), bold: true }, { text: " kg", bold: false }],
    ],
    376,
    760,
    {
      numFont: `800 40px ${sans}`,
      textFont: `600 30px ${sans}`,
      color: white,
      pipeColor: lineBlue,
      pipeGap: 26,
      pipeTopOffset: -33,
      pipeHeight: 38,
    },
  );

  ctx.fillStyle = lineBlue;
  ctx.fillRect(padX, 796, W - padX * 2, 1.6);

  const maxEx = (!hasCardio && !hasDiet) ? 8 : (!hasCardio || !hasDiet) ? 6 : 4;
  const exRows = (payload.strength.exercises.length
    ? payload.strength.exercises
    : [{ name: "今日未记录力量动作", summary: "—" }]
  ).slice(0, maxEx);
  const availForTable = (!hasCardio && !hasDiet) ? 580 : (!hasCardio && hasDiet) ? 350 : (hasCardio && !hasDiet) ? 440 : 236;
  const rowH = Math.max(54, Math.min(82, Math.floor(availForTable / Math.max(1, exRows.length))));
  exRows.forEach((ex, i) => {
    const ry = 796 + i * rowH;
    const ty = ry + Math.round(rowH * 0.65);
    ctx.fillStyle = white;
    ctx.font = `600 34px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.name, 460), padX + 40, ty);
    const sumStr = truncateText(ctx, ex.summary, 420);
    const sumW = ctx.measureText(sumStr).width;
    ctx.fillText(sumStr, W - padX - 24 - sumW, ty);

    ctx.fillStyle = lineBlue;
    ctx.fillRect(padX, ry + rowH, W - padX * 2, 1.5);
  });

  let curY = 796 + exRows.length * rowH + 34;

  // Section 2: 有氧训练 (only when cardio data exists)
  if (hasCardio) {
    const cardioTop = curY;
    ctx.fillStyle = lineBlue;
    ctx.fillRect(padX, cardioTop, W - padX * 2, 2);

    drawSlantedMarker(ctx, padX, cardioTop + 34, 28, 46, 14, sky);
    ctx.fillStyle = white;
    ctx.font = `800 46px ${sans}`;
    ctx.fillText("有氧训练", padX + 62, cardioTop + 74);

    const cardioSegs = [
      [{ text: payload.cardio.title, bold: false }],
      [{ text: String(payload.cardio.minutes), bold: true }, { text: " 分钟", bold: false }],
      ...(payload.cardio.avgBpm
        ? [[{ text: "平均心率 ", bold: false }, { text: String(payload.cardio.avgBpm), bold: true }, { text: " bpm", bold: false }]]
        : payload.cardio.caloriesKcal
          ? [[{ text: "消耗 ", bold: false }, { text: String(payload.cardio.caloriesKcal), bold: true }, { text: " kcal", bold: false }]]
          : []),
    ];

    drawInlinePipeSegments(ctx, cardioSegs, 352, cardioTop + 74, {
      numFont: `800 38px ${sans}`,
      textFont: `600 30px ${sans}`,
      color: white,
      pipeColor: lineBlue,
      pipeGap: 24,
      pipeTopOffset: -33,
      pipeHeight: 38,
    });

    ctx.fillStyle = lineBlue;
    ctx.fillRect(padX, cardioTop + 110, W - padX * 2, 2);
    curY = cardioTop + 138;
  }

  // Section 3: 饮食记录 (only when diet data exists)
  if (hasDiet) {
    const dietTop = hasCardio ? Math.max(curY, 1196) : Math.max(curY, 1164);
    if (!hasCardio) {
      ctx.fillStyle = lineBlue;
      ctx.fillRect(padX, dietTop - 24, W - padX * 2, 2);
    }
    drawSlantedMarker(ctx, padX, dietTop + 12, 28, 46, 14, cobalt);
    ctx.fillStyle = white;
    ctx.font = `800 46px ${sans}`;
    ctx.fillText("饮食记录", padX + 62, dietTop + 52);

    const divTop = dietTop + 80;
    const macroY = dietTop + 170;
    ctx.font = `800 58px ${sans}`;
    const kcalStr = fmt(payload.diet.calories, 0);
    ctx.fillText(kcalStr, padX + 10, macroY);
    const kcalW = ctx.measureText(kcalStr).width;
    ctx.font = `600 35px ${sans}`;
    ctx.fillText(" kcal", padX + 10 + kcalW, macroY);

    for (const [divX, label, grams] of [
      [344, "蛋白质", payload.diet.protein],
      [570, "碳水", payload.diet.carbs],
      [796, "脂肪", payload.diet.fat],
    ]) {
      ctx.fillStyle = lineBlue;
      ctx.fillRect(divX, divTop, 1.8, 104);
      ctx.fillStyle = "#d9e6ff";
      ctx.font = `500 29px ${sans}`;
      ctx.fillText(label, divX + 30, divTop + 28);
      ctx.fillStyle = white;
      ctx.font = `800 54px ${sans}`;
      const gStr = fmt(grams, 0);
      ctx.fillText(gStr, divX + 30, macroY);
      const gW = ctx.measureText(gStr).width;
      ctx.font = `600 35px ${sans}`;
      ctx.fillText(" g", divX + 30 + gW, macroY);
    }
  }

  ctx.fillStyle = lineBlue;
  ctx.fillRect(padX, 1428, W - padX * 2, 2);

  ctx.fillStyle = "#e0ebff";
  ctx.font = `500 30px ${sans}`;
  const authW = ctx.measureText(payload.authorLabel).width;
  ctx.fillText(payload.authorLabel, W - padX - authW, 1484);
}

async function renderStyleMono(ctx, W, H, payload, sans, mono) {
  const bg = await loadShareBgImage("./share-bg-mono.jpg");
  if (!drawCoverImage(ctx, bg, 0, 0, W, H)) {
    ctx.fillStyle = "#121312";
    ctx.fillRect(0, 0, W, H);
  }

  const lime = "#84cc16";
  const white = "#ffffff";
  const darkInk = "#101010";
  const rule = "rgba(255, 255, 255, 0.22)";
  const padX = 56;

  // Top Header on Concrete Wall
  ctx.fillStyle = darkInk;
  ctx.font = `800 38px ${sans}`;
  ctx.fillText("IRONLOG", padX, 86);

  ctx.fillStyle = lime;
  ctx.beginPath();
  ctx.arc(260, 74, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = darkInk;
  ctx.font = `600 31px ${mono}`;
  ctx.fillText(payload.dateDot, 282, 85);

  ctx.font = `900 100px ${sans}`;
  ctx.fillText(payload.headline, padX - 4, 228);

  // Mid-Left Hero Duration inside Diagonal Shadow
  ctx.fillStyle = lime;
  ctx.fillRect(padX + 4, 434, 64, 9);

  ctx.fillStyle = white;
  ctx.font = `800 134px ${sans}`;
  const durStr = String(payload.totalMinutes || 0);
  ctx.fillText(durStr, padX - 2, 582);
  const durW = ctx.measureText(durStr).width;
  ctx.font = `800 54px ${sans}`;
  ctx.fillText(" 分钟", padX - 2 + durW, 582);

  ctx.fillStyle = "#e2e4e1";
  ctx.font = `500 34px ${sans}`;
  ctx.fillText("总训练时长", padX + 2, 642);

  // Section 1: 力量训练
  ctx.fillStyle = lime;
  ctx.fillRect(padX, 790, 7, 44);
  ctx.fillStyle = white;
  ctx.font = `800 44px ${sans}`;
  ctx.fillText("力量训练", padX + 30, 828);

  drawInlinePipeSegments(
    ctx,
    [
      [{ text: String(payload.strength.minutes), bold: true }, { text: " 分钟", bold: false }],
      [{ text: String(payload.strength.totalSets), bold: true }, { text: " 组", bold: false }],
      [{ text: fmt(payload.strength.totalVolumeKg, 0), bold: true }, { text: " kg", bold: false }],
    ],
    376,
    826,
    {
      numFont: `800 40px ${sans}`,
      textFont: `500 30px ${sans}`,
      color: white,
      pipeColor: "rgba(255,255,255,0.35)",
      pipeGap: 34,
      pipeTopOffset: -32,
      pipeHeight: 38,
    },
  );

  const hasCardio = Boolean(payload.cardio.hasData);
  const hasDiet = Boolean(payload.diet.hasData);
  const maxEx = (!hasCardio && !hasDiet) ? 8 : (!hasCardio || !hasDiet) ? 6 : 4;
  const exRows = (payload.strength.exercises.length
    ? payload.strength.exercises
    : [{ name: "今日未记录力量动作", summary: "—" }]
  ).slice(0, maxEx);
  const availForTable = (!hasCardio && !hasDiet) ? 500 : (!hasCardio && hasDiet) ? 330 : (hasCardio && !hasDiet) ? 380 : 200;
  const rowH = Math.max(48, Math.min(76, Math.floor(availForTable / Math.max(1, exRows.length))));
  const exStartY = 860;
  exRows.forEach((ex, i) => {
    const ry = exStartY + i * rowH;
    const ty = ry + Math.round(rowH * 0.68);
    ctx.fillStyle = "#f2f4f0";
    ctx.font = `600 32px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.name, 460), padX + 14, ty);

    ctx.font = `500 32px ${sans}`;
    const sumStr = truncateText(ctx, ex.summary, 420);
    const sumW = ctx.measureText(sumStr).width;
    ctx.fillText(sumStr, W - padX - 10 - sumW, ty);

    if (i < exRows.length - 1) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
      ctx.fillRect(padX, ry + rowH, W - padX * 2, 1.2);
    }
  });

  let curY = exStartY + exRows.length * rowH + 28;

  // Section 2: 有氧训练 (only when cardio data exists)
  if (hasCardio) {
    const cardioTop = curY;
    ctx.fillStyle = rule;
    ctx.fillRect(padX, cardioTop, W - padX * 2, 1.5);

    ctx.fillStyle = lime;
    ctx.fillRect(padX, cardioTop + 40, 7, 44);
    ctx.fillStyle = white;
    ctx.font = `800 44px ${sans}`;
    ctx.fillText("有氧训练", padX + 30, cardioTop + 78);

    const cardioSegs = [
      [{ text: payload.cardio.title, bold: false }],
      [{ text: String(payload.cardio.minutes), bold: true }, { text: " 分钟", bold: false }],
      ...(payload.cardio.avgBpm
        ? [[{ text: "平均心率 ", bold: false }, { text: String(payload.cardio.avgBpm), bold: true }, { text: " bpm", bold: false }]]
        : payload.cardio.caloriesKcal
          ? [[{ text: "消耗 ", bold: false }, { text: String(payload.cardio.caloriesKcal), bold: true }, { text: " kcal", bold: false }]]
          : []),
    ];

    drawInlinePipeSegments(ctx, cardioSegs, 364, cardioTop + 76, {
      numFont: `800 38px ${sans}`,
      textFont: `500 30px ${sans}`,
      color: white,
      pipeColor: "rgba(255,255,255,0.35)",
      pipeGap: 28,
      pipeTopOffset: -32,
      pipeHeight: 38,
    });

    ctx.fillStyle = rule;
    ctx.fillRect(padX, cardioTop + 118, W - padX * 2, 1.5);
    curY = cardioTop + 156;
  }

  // Section 3: 饮食记录 (only when diet data exists)
  if (hasDiet) {
    const dietTop = hasCardio ? Math.max(curY, 1236) : Math.max(curY, 1210);
    if (!hasCardio) {
      ctx.fillStyle = rule;
      ctx.fillRect(padX, dietTop - 32, W - padX * 2, 1.5);
    }
    ctx.fillStyle = lime;
    ctx.fillRect(padX, dietTop, 7, 44);
    ctx.fillStyle = white;
    ctx.font = `800 44px ${sans}`;
    ctx.fillText("饮食记录", padX + 30, dietTop + 38);

    drawInlinePipeSegments(
      ctx,
      [
        [{ text: fmt(payload.diet.calories, 0), bold: true }, { text: " kcal", bold: false }],
        [{ text: "蛋白质 ", bold: false }, { text: fmt(payload.diet.protein, 0), bold: true }, { text: " g", bold: false }],
        [{ text: "碳水 ", bold: false }, { text: fmt(payload.diet.carbs, 0), bold: true }, { text: " g", bold: false }],
        [{ text: "脂肪 ", bold: false }, { text: fmt(payload.diet.fat, 0), bold: true }, { text: " g", bold: false }],
      ],
      padX + 12,
      dietTop + 116,
      {
        numFont: `800 44px ${sans}`,
        textFont: `500 30px ${sans}`,
        color: white,
        pipeColor: "rgba(255,255,255,0.35)",
        pipeGap: 26,
        pipeTopOffset: -34,
        pipeHeight: 40,
      },
    );
  }

  ctx.fillStyle = rule;
  ctx.fillRect(padX, 1404, W - padX * 2, 1.5);

  // Footer with lime dot
  const parts = payload.authorLabel.split("·").map((s) => s.trim());
  ctx.fillStyle = "#e6e8e5";
  ctx.font = `600 28px ${sans}`;
  ctx.fillText(parts[0] || "铁记", padX, 1468);
  const p0w = ctx.measureText(parts[0] || "铁记").width;
  ctx.fillStyle = lime;
  ctx.beginPath();
  ctx.arc(padX + p0w + 20, 1458, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e6e8e5";
  ctx.fillText(parts[1] || "训练日志", padX + p0w + 40, 1468);
}

async function renderStylePoster(ctx, W, H, payload, sans, mono) {
  const bg = await loadShareBgImage("./share-bg-poster.jpg");
  if (!drawCoverImage(ctx, bg, 0, 0, W, H)) {
    ctx.fillStyle = "#c81d18";
    ctx.fillRect(0, 0, W, 622);
    ctx.fillStyle = "#f6f3ec";
    ctx.fillRect(0, 622, W, H - 622);
  }

  const cream = "#f7f4ee";
  const crimson = "#cf231b";
  const ink = "#171614";
  const grayRule = "rgba(23, 22, 20, 0.25)";
  const padX = 44;

  // Top Crimson Hero Typography
  ctx.fillStyle = cream;
  ctx.font = `800 40px ${sans}`;
  ctx.fillText("IRONLOG", 64, 88);

  ctx.fillStyle = "rgba(247, 244, 238, 0.75)";
  ctx.fillRect(342, 54, 2.2, 40);

  ctx.fillStyle = cream;
  ctx.font = `600 34px ${mono}`;
  ctx.fillText(payload.dateDot, 372, 87);

  ctx.font = `900 108px ${sans}`;
  ctx.fillText(payload.headline, 58, 232);

  // Giant Hero Duration on Crimson (condensed athletic display proportion so it never overlaps 分钟)
  const heroStr = String(payload.totalMinutes || 0);
  const heroFontPx = heroStr.length >= 3 ? 215 : 272;
  const scaleX = heroStr.length >= 3 ? 0.70 : 0.76;
  ctx.font = `900 ${heroFontPx}px ${sans}`;
  const rawHeroW = ctx.measureText(heroStr).width;
  const renderedHeroW = Math.round(rawHeroW * scaleX);
  ctx.save();
  ctx.translate(50, 562);
  ctx.scale(scaleX, 1);
  ctx.fillText(heroStr, 0, 0);
  ctx.restore();

  const unitX = 50 + renderedHeroW + 22;
  ctx.font = `800 62px ${sans}`;
  ctx.fillText("分钟", unitX, 466);
  ctx.font = `600 30px ${sans}`;
  ctx.fillText("总训练时长", unitX - 2, 524);

  // Section 1: 力量训练 on Warm Paper Sheet
  drawSlantedMarker(ctx, padX, 686, 30, 50, 16, crimson);
  ctx.fillStyle = ink;
  ctx.font = `900 50px ${sans}`;
  ctx.fillText("力量训练", padX + 66, 730);

  drawInlinePipeSegments(
    ctx,
    [
      [{ text: String(payload.strength.minutes), bold: true }, { text: " 分钟", bold: false }],
      [{ text: String(payload.strength.totalSets), bold: true }, { text: " 组", bold: false }],
      [{ text: fmt(payload.strength.totalVolumeKg, 0), bold: true }, { text: " kg", bold: false }],
    ],
    442,
    728,
    {
      numFont: `800 42px ${sans}`,
      textFont: `700 30px ${sans}`,
      color: ink,
      pipeColor: "rgba(23,22,20,0.45)",
      pipeGap: 26,
      pipeTopOffset: -34,
      pipeHeight: 40,
    },
  );

  ctx.fillStyle = crimson;
  ctx.fillRect(padX, 764, W - padX * 2, 2.4);

  const hasCardio = Boolean(payload.cardio.hasData);
  const hasDiet = Boolean(payload.diet.hasData);
  const maxEx = (!hasCardio && !hasDiet) ? 8 : (!hasCardio || !hasDiet) ? 6 : 4;
  const exRows = (payload.strength.exercises.length
    ? payload.strength.exercises
    : [{ name: "今日未记录力量动作", summary: "—" }]
  ).slice(0, maxEx);
  const availForTable = (!hasCardio && !hasDiet) ? 620 : (!hasCardio && hasDiet) ? 380 : (hasCardio && !hasDiet) ? 400 : 252;
  const rowH = Math.max(58, Math.min(86, Math.floor(availForTable / Math.max(1, exRows.length))));
  exRows.forEach((ex, i) => {
    const ry = 764 + i * rowH;
    const ty = ry + Math.round(rowH * 0.65);
    ctx.fillStyle = ink;
    ctx.font = `700 34px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.name, 460), padX + 24, ty);

    ctx.font = `600 36px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.summary, 410), 600, ty);

    ctx.fillStyle = grayRule;
    ctx.fillRect(padX, ry + rowH, W - padX * 2, 1.4);
  });

  const afterStrengthY = 764 + exRows.length * rowH + 46;

  if (hasCardio && hasDiet) {
    // Bottom 2-Column Split: Left 有氧训练 | Right 饮食记录
    const splitTop = Math.max(1074, afterStrengthY);
    ctx.fillStyle = "rgba(23, 22, 20, 0.55)";
    ctx.fillRect(468, splitTop, 1.6, 366);

    // Left Column: 有氧训练
    drawSlantedMarker(ctx, padX, splitTop + 4, 28, 46, 15, crimson);
    ctx.fillStyle = ink;
    ctx.font = `900 46px ${sans}`;
    ctx.fillText("有氧训练", padX + 60, splitTop + 44);
    ctx.fillStyle = crimson;
    ctx.fillRect(padX, splitTop + 76, 390, 2.4);

    ctx.fillStyle = ink;
    ctx.font = `700 42px ${sans}`;
    ctx.fillText(truncateText(ctx, payload.cardio.title, 380), padX + 10, splitTop + 152);

    ctx.font = `900 112px ${sans}`;
    const cMinStr = String(payload.cardio.minutes || 0);
    ctx.fillText(cMinStr, padX + 6, splitTop + 276);
    const cMinW = ctx.measureText(cMinStr).width;
    ctx.font = `800 44px ${sans}`;
    ctx.fillText(" 分钟", padX + 6 + cMinW, splitTop + 276);

    ctx.font = `600 32px ${sans}`;
    const cardioSub = payload.cardio.avgBpm
      ? `平均心率 ${payload.cardio.avgBpm} bpm`
      : payload.cardio.caloriesKcal
        ? `消耗热量 ${payload.cardio.caloriesKcal} kcal`
        : "今日有氧时长";
    ctx.fillText(cardioSub, padX + 10, splitTop + 346);

    // Right Column: 饮食记录
    const rightX = 500;
    drawSlantedMarker(ctx, rightX, splitTop + 4, 28, 46, 15, crimson);
    ctx.fillStyle = ink;
    ctx.font = `900 46px ${sans}`;
    ctx.fillText("饮食记录", rightX + 60, splitTop + 44);
    ctx.fillStyle = crimson;
    ctx.fillRect(rightX, splitTop + 76, W - padX - rightX, 2.4);

    ctx.fillStyle = ink;
    ctx.font = `900 84px ${sans}`;
    const dKcalStr = fmt(payload.diet.calories, 0);
    ctx.fillText(dKcalStr, rightX + 16, splitTop + 170);
    const dKcalW = ctx.measureText(dKcalStr).width;
    ctx.font = `800 44px ${sans}`;
    ctx.fillText(" kcal", rightX + 16 + dKcalW, splitTop + 170);

    const macroRows = [
      ["蛋白质", `${fmt(payload.diet.protein, 0)} g`],
      ["碳水", `${fmt(payload.diet.carbs, 0)} g`],
      ["脂肪", `${fmt(payload.diet.fat, 0)} g`],
    ];
    macroRows.forEach(([label, val], idx) => {
      const my = splitTop + 230 + idx * 58;
      ctx.fillStyle = ink;
      ctx.font = `600 32px ${sans}`;
      ctx.fillText(label, rightX + 20, my);
      ctx.font = `600 34px ${sans}`;
      ctx.fillText(val, rightX + 198, my);
      if (idx < 2) {
        ctx.fillStyle = grayRule;
        ctx.fillRect(rightX + 16, my + 18, W - padX - rightX - 16, 1.3);
      }
    });
  } else if (hasDiet && !hasCardio) {
    // Full-width Diet Section (no cardio section rendered!)
    const dietTop = Math.max(1156, afterStrengthY);
    drawSlantedMarker(ctx, padX, dietTop, 30, 50, 16, crimson);
    ctx.fillStyle = ink;
    ctx.font = `900 50px ${sans}`;
    ctx.fillText("饮食记录", padX + 66, dietTop + 44);
    ctx.fillStyle = crimson;
    ctx.fillRect(padX, dietTop + 78, W - padX * 2, 2.4);

    const divTop = dietTop + 112;
    const macroY = dietTop + 206;
    ctx.fillStyle = ink;
    ctx.font = `900 66px ${sans}`;
    const kcalStr = fmt(payload.diet.calories, 0);
    ctx.fillText(kcalStr, padX + 8, macroY);
    const kcalW = ctx.measureText(kcalStr).width;
    ctx.font = `800 38px ${sans}`;
    ctx.fillText(" kcal", padX + 8 + kcalW, macroY);

    for (const [divX, label, grams] of [
      [352, "蛋白质", payload.diet.protein],
      [584, "碳水", payload.diet.carbs],
      [804, "脂肪", payload.diet.fat],
    ]) {
      ctx.fillStyle = "rgba(23, 22, 20, 0.45)";
      ctx.fillRect(divX, divTop, 1.6, 106);
      ctx.fillStyle = ink;
      ctx.font = `600 30px ${sans}`;
      ctx.fillText(label, divX + 32, divTop + 32);
      ctx.font = `900 56px ${sans}`;
      const gStr = fmt(grams, 0);
      ctx.fillText(gStr, divX + 32, macroY);
      const gW = ctx.measureText(gStr).width;
      ctx.font = `700 36px ${sans}`;
      ctx.fillText(" g", divX + 32 + gW, macroY);
    }
  } else if (hasCardio && !hasDiet) {
    // Full-width Cardio Section
    const cardioTop = Math.max(1180, afterStrengthY);
    drawSlantedMarker(ctx, padX, cardioTop, 30, 50, 16, crimson);
    ctx.fillStyle = ink;
    ctx.font = `900 50px ${sans}`;
    ctx.fillText("有氧训练", padX + 66, cardioTop + 44);
    ctx.fillStyle = crimson;
    ctx.fillRect(padX, cardioTop + 78, W - padX * 2, 2.4);

    const cardioSegs = [
      [{ text: payload.cardio.title, bold: false }],
      [{ text: String(payload.cardio.minutes), bold: true }, { text: " 分钟", bold: false }],
      ...(payload.cardio.avgBpm
        ? [[{ text: "平均心率 ", bold: false }, { text: String(payload.cardio.avgBpm), bold: true }, { text: " bpm", bold: false }]]
        : payload.cardio.caloriesKcal
          ? [[{ text: "消耗 ", bold: false }, { text: String(payload.cardio.caloriesKcal), bold: true }, { text: " kcal", bold: false }]]
          : []),
    ];
    drawInlinePipeSegments(ctx, cardioSegs, padX + 12, cardioTop + 158, {
      numFont: `900 52px ${sans}`,
      textFont: `700 36px ${sans}`,
      color: ink,
      pipeColor: "rgba(23,22,20,0.45)",
      pipeGap: 32,
      pipeTopOffset: -40,
      pipeHeight: 48,
    });
  }

  // Footer
  ctx.fillStyle = ink;
  ctx.font = `600 28px ${sans}`;
  ctx.fillText(payload.authorLabel, padX, 1496);
  const authW = ctx.measureText(payload.authorLabel).width;
  ctx.fillStyle = "rgba(23, 22, 20, 0.55)";
  ctx.fillRect(padX + authW + 24, 1486, W - padX * 2 - authW - 24, 1.6);
}

async function renderStyleObsidian(ctx, W, H, payload, sans, mono) {
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, W, H);

  const plateImg = await loadShareBgImage("./plate-halftone.jpg");
  if (plateImg && plateImg.width) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.drawImage(plateImg, W - 520, -20, 540, 540);
    const fade = ctx.createRadialGradient(W - 140, 220, 80, W - 140, 220, 440);
    fade.addColorStop(0, "rgba(20,20,20,0)");
    fade.addColorStop(1, "rgba(20,20,20,1)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = fade;
    ctx.fillRect(W - 540, 0, 540, 560);
    ctx.restore();
  }

  const red = "#e03a32";
  const white = "#f4f3ef";
  const rule = "rgba(255, 255, 255, 0.18)";
  const padX = 52;

  // Dot-matrix brand mark + IRONLOG
  const dots = [
    [0, 0], [0, 1], [0, 2],
    [1, 0], [1, 1], [1, 2],
    [2, 1], [3, 1],
    [4, 0], [4, 1], [4, 2],
    [5, 0], [5, 1], [5, 2],
  ];
  ctx.fillStyle = white;
  for (const [col, row] of dots) {
    drawRoundedRect(ctx, padX + col * 11, 54 + row * 11, 8, 8, 2);
    ctx.fill();
  }
  ctx.fillStyle = red;
  drawRoundedRect(ctx, padX + 6 * 11 + 4, 54 + 2 * 11, 8, 8, 2);
  ctx.fill();

  ctx.fillStyle = white;
  ctx.font = `800 38px ${sans}`;
  ctx.fillText("IRONLOG", padX + 94, 83);

  ctx.font = `600 31px ${mono}`;
  const dateW = ctx.measureText(payload.dateDot).width;
  ctx.fillText(payload.dateDot, W - padX - dateW, 82);

  ctx.fillStyle = red;
  ctx.fillRect(padX, 114, 72, 4);
  ctx.fillStyle = rule;
  ctx.fillRect(padX + 84, 115, W - padX * 2 - 84, 1.5);

  // Title & Hero Duration
  ctx.fillStyle = white;
  ctx.font = `900 104px ${sans}`;
  ctx.fillText(payload.headline, padX, 248);

  ctx.font = `800 168px ${sans}`;
  const durStr = String(payload.totalMinutes || 0);
  ctx.fillText(durStr, padX, 466);
  const durW = ctx.measureText(durStr).width;
  ctx.font = `800 62px ${sans}`;
  ctx.fillText(" 分钟", padX + durW, 466);
  ctx.fillStyle = "#b5b8c0";
  ctx.font = `500 34px ${sans}`;
  ctx.fillText("总训练时长", padX + 4, 526);

  // Section 1: 力量训练
  ctx.fillStyle = rule;
  ctx.fillRect(padX, 608, W - padX * 2, 1.5);
  ctx.fillStyle = red;
  ctx.fillRect(padX, 648, 8, 46);
  ctx.fillStyle = white;
  ctx.font = `800 44px ${sans}`;
  ctx.fillText("力量训练", padX + 30, 687);

  drawInlinePipeSegments(
    ctx,
    [
      [{ text: String(payload.strength.minutes), bold: true }, { text: " 分钟", bold: false }],
      [{ text: String(payload.strength.totalSets), bold: true }, { text: " 组", bold: false }],
      [{ text: fmt(payload.strength.totalVolumeKg, 0), bold: true }, { text: " kg", bold: false }],
    ],
    376,
    686,
    {
      numFont: `800 40px ${sans}`,
      textFont: `500 30px ${sans}`,
      color: white,
      pipeColor: "rgba(255,255,255,0.3)",
      pipeGap: 28,
      pipeTopOffset: -33,
      pipeHeight: 38,
    },
  );

  ctx.fillStyle = rule;
  ctx.fillRect(padX, 724, W - padX * 2, 1.5);

  const hasCardio = Boolean(payload.cardio.hasData);
  const hasDiet = Boolean(payload.diet.hasData);
  const maxEx = (!hasCardio && !hasDiet) ? 8 : (!hasCardio || !hasDiet) ? 6 : 4;
  const exRows = (payload.strength.exercises.length
    ? payload.strength.exercises
    : [{ name: "今日未记录力量动作", summary: "—" }]
  ).slice(0, maxEx);
  const availForTable = (!hasCardio && !hasDiet) ? 640 : (!hasCardio && hasDiet) ? 390 : (hasCardio && !hasDiet) ? 460 : 260;
  const rowH = Math.max(58, Math.min(86, Math.floor(availForTable / Math.max(1, exRows.length))));
  exRows.forEach((ex, i) => {
    const ry = 724 + i * rowH;
    const ty = ry + Math.round(rowH * 0.65);
    ctx.fillStyle = white;
    ctx.font = `600 33px ${sans}`;
    ctx.fillText(truncateText(ctx, ex.name, 460), padX + 18, ty);
    const sumStr = truncateText(ctx, ex.summary, 420);
    const sumW = ctx.measureText(sumStr).width;
    ctx.fillText(sumStr, W - padX - 14 - sumW, ty);
    ctx.fillStyle = rule;
    ctx.fillRect(padX, ry + rowH, W - padX * 2, 1.3);
  });

  let curY = 724 + exRows.length * rowH + 34;

  // Section 2: 有氧训练 (only when cardio data exists)
  if (hasCardio) {
    const cardioTop = curY;
    ctx.fillStyle = red;
    ctx.fillRect(padX, cardioTop + 34, 8, 46);
    ctx.fillStyle = white;
    ctx.font = `800 44px ${sans}`;
    ctx.fillText("有氧训练", padX + 30, cardioTop + 73);

    const cardioSegs = [
      [{ text: payload.cardio.title, bold: false }],
      [{ text: String(payload.cardio.minutes), bold: true }, { text: " 分钟", bold: false }],
      ...(payload.cardio.avgBpm
        ? [[{ text: "平均心率 ", bold: false }, { text: String(payload.cardio.avgBpm), bold: true }, { text: " bpm", bold: false }]]
        : payload.cardio.caloriesKcal
          ? [[{ text: "消耗 ", bold: false }, { text: String(payload.cardio.caloriesKcal), bold: true }, { text: " kcal", bold: false }]]
          : []),
    ];

    drawInlinePipeSegments(ctx, cardioSegs, 356, cardioTop + 72, {
      numFont: `800 38px ${sans}`,
      textFont: `500 30px ${sans}`,
      color: white,
      pipeColor: "rgba(255,255,255,0.3)",
      pipeGap: 26,
      pipeTopOffset: -32,
      pipeHeight: 38,
    });

    ctx.fillStyle = rule;
    ctx.fillRect(padX, cardioTop + 114, W - padX * 2, 1.5);
    curY = cardioTop + 150;
  }

  // Section 3: 饮食记录 (only when diet data exists)
  if (hasDiet) {
    const dietTop = hasCardio ? Math.max(curY, 1178) : Math.max(curY, 1160);
    ctx.fillStyle = red;
    ctx.fillRect(padX, dietTop, 8, 46);
    ctx.fillStyle = white;
    ctx.font = `800 44px ${sans}`;
    ctx.fillText("饮食记录", padX + 30, dietTop + 39);

    const divTop = dietTop + 88;
    const macroY = dietTop + 178;
    ctx.font = `800 56px ${sans}`;
    const kcalStr = fmt(payload.diet.calories, 0);
    ctx.fillText(kcalStr, padX + 8, macroY);
    const kcalW = ctx.measureText(kcalStr).width;
    ctx.font = `600 34px ${sans}`;
    ctx.fillText(" kcal", padX + 8 + kcalW, macroY);

    for (const [divX, label, grams] of [
      [344, "蛋白质", payload.diet.protein],
      [570, "碳水", payload.diet.carbs],
      [796, "脂肪", payload.diet.fat],
    ]) {
      ctx.fillStyle = rule;
      ctx.fillRect(divX, divTop, 1.5, 102);
      ctx.fillStyle = "#b5b8c0";
      ctx.font = `500 28px ${sans}`;
      ctx.fillText(label, divX + 28, divTop + 28);
      ctx.fillStyle = white;
      ctx.font = `800 52px ${sans}`;
      const gStr = fmt(grams, 0);
      ctx.fillText(gStr, divX + 28, macroY);
      const gW = ctx.measureText(gStr).width;
      ctx.font = `600 34px ${sans}`;
      ctx.fillText(" g", divX + 28 + gW, macroY);
    }
  }

  ctx.fillStyle = rule;
  ctx.fillRect(padX, 1422, W - padX * 2, 1.5);
  ctx.fillStyle = "#d2d4dc";
  ctx.font = `600 28px ${sans}`;
  ctx.fillText(payload.authorLabel, padX, 1478);
}

export async function renderDailyShareCard(payload, styleKey = "paper") {
  const W = 1024;
  const H = 1536;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持生成分享记录图");

  const sans = '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif';
  const mono = '"JetBrains Mono", "SFMono-Regular", Consolas, monospace';

  if (styleKey === "ring") {
    await renderStyleRing(ctx, W, H, payload, sans, mono);
  } else if (styleKey === "mono") {
    await renderStyleMono(ctx, W, H, payload, sans, mono);
  } else if (styleKey === "poster") {
    await renderStylePoster(ctx, W, H, payload, sans, mono);
  } else if (styleKey === "obsidian") {
    await renderStyleObsidian(ctx, W, H, payload, sans, mono);
  } else {
    await renderStylePaper(ctx, W, H, payload, sans, mono);
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((res) => (res ? resolve(res) : reject(new Error("生成分享图片失败"))), "image/png");
  });
  const dataUrl = canvas.toDataURL("image/png");
  return {
    dataUrl,
    blob,
    styleKey,
    filename: `ironlog-${payload.date || "daily"}-${styleKey}.png`,
  };
}

export async function renderWorkoutShareCard(report, health = null, styleKey = "paper", extraContext = {}) {
  const payload = buildDailySharePayload({
    date: report?.date,
    singleReport: report,
    singleHealth: health,
    ...extraContext,
  });
  return renderDailyShareCard(payload, styleKey);
}
