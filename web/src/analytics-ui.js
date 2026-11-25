import { esc, fmt, shortDate, duration, icon, empty, segments, dotMeter } from "./ui.js";
import { matrix } from "./display.js";
import { formatSleepMinutes } from "./apple-health-ui.js";

const intervalOptions = { 14: "14 天", 30: "30 天", 60: "60 天", 90: "90 天" };
const sectionOptions = {
  training: "训练与力量",
  health: "身体与恢复",
  reports: "明细与报表",
};
const BODY_CHART_METRICS = {
  weightKg: { label: "体重", unit: "kg", digits: 2 },
  bodyFatPct: { label: "体脂率", unit: "%", digits: 1 },
  waistCm: { label: "腰围", unit: "cm", digits: 1 },
};
const RECOVERY_CHART_METRICS = {
  restingHeartRateBpm: { label: "静息心率", unit: "bpm", digits: 0 },
  hrvMs: { label: "HRV", unit: "ms", digits: 1 },
  bloodOxygenPct: { label: "血氧 SpO2", unit: "%", digits: 1 },
  steps: { label: "步数", unit: "步", digits: 0 },
  distanceKm: { label: "距离", unit: "km", digits: 2 },
  activeEnergyKcal: { label: "活动消耗", unit: "kcal", digits: 0 },
};

function toneClass(tone) {
  return tone === "sweet" ? "is-sweet" : tone === "danger" ? "is-danger" : tone === "caution" ? "is-caution" : "";
}

function plainAcwrStatus(zone) {
  if (zone === "deload") return "偏轻松";
  if (zone === "sweet_spot") return "刚刚好";
  if (zone === "caution") return "有点累";
  return "练太猛了";
}

function formatHumanCorrelation(c) {
  const daysNote = `（近 ${c.sampleDays} 天规律）`;
  if (c.label.includes("睡眠") && c.label.includes("HRV")) {
    return `${c.r > 0 ? "睡得越久，身体恢复活力往往越好" : "睡眠时长和恢复指标近期走势相反"}${daysNote}。`;
  }
  if (c.label.includes("睡眠") && c.label.includes("静息心率")) {
    return `${c.r < 0 ? "睡得越足，早上静息心率通常越低越稳" : "睡眠时长与静息心率同步变动"}${daysNote}。`;
  }
  if (c.label.includes("步数") && c.label.includes("消耗")) {
    return `走动越多、越活跃的日子，额外消耗的热量也明显更高${daysNote}。`;
  }
  if (c.label.includes("体重") && c.label.includes("腰围")) {
    return `${c.r > 0 ? "体重下降的时候，腰围也在稳步变小" : "体重和腰围近期变化步调不完全一致"}${daysNote}。`;
  }
  return `${c.label}近期呈现稳定${c.r > 0 ? "同向" : "反向"}趋势${daysNote}。`;
}

function renderCoachSummaryStrip(data) {
  const { acwr, muscles, nutrition, bodyweight, appleDaily } = data;
  const curr = acwr.current;
  const rec = appleDaily?.recoveryReport;
  const readiness = rec?.readinessScore ?? null;
  const prot = nutrition.protein;
  const bw = bodyweight.report;
  const optMuscles = muscles.audits.filter((m) => m.category === "optimal").length;

  let loadTip = "最近还没有连贯训练，按计划正常开练就好。";
  if (curr.acwr > 0) {
    if (curr.zone === "danger" || (curr.ewmaZone === "danger" && readiness != null && readiness < 70)) {
      loadTip = "这阵子训练量冲得太猛了，建议接下来 1–2 天减载或休息恢复，避免练伤。";
    } else if (curr.ewmaZone === "danger" && curr.zone !== "danger") {
      loadTip = "近两天训练量加得有点急，虽然周平均还没超线，明天别硬上极限重量。";
    } else if (readiness != null && readiness < 60) {
      loadTip = `今天身体恢复状态一般（${readiness} 分），练的时候少冲力竭组、动作稳一点。`;
    } else if (curr.zone === "sweet_spot") {
      loadTip = "最近训练量和身体恢复配合得刚刚好，按计划稳步加重量或次数就行。";
    } else if (curr.zone === "caution") {
      loadTip = "近期训练量比平时略高一点，注意晚上睡足，别连着猛练同一个部位。";
    } else {
      loadTip = "最近训练量比较轻松，适合当作调整恢复周；想冲进度的话这周可以慢慢加点量。";
    }
  }

  let bodyTip = "多记几顿饮食和早起称重，系统就能自动过滤喝水波动，帮你盯住蛋白质和体重走向。";
  const parts = [];
  if (prot.totalDaysLogged > 0) {
    parts.push(
      prot.complianceRatePct == null
        ? `日均蛋白 ${fmt(prot.averageGramsPerDay)} g · 待补体重`
        : prot.status === "suboptimal"
        ? `每日蛋白偏低（均 ${fmt(prot.averageGramsPerDay)} g），多吃点瘦肉蛋奶`
        : `蛋白质吃得很够（均 ${fmt(prot.averageGramsPerDay)} g · 达标率 ${prot.complianceRatePct}%）`,
    );
  }
  if (bw) {
    const slopeAbs = fmt(Math.abs(bw.weeklySlopeKg ?? 0), 2);
    if (bw.category === "optimal_cut") parts.push(`近期体重每周稳降约 ${slopeAbs} kg，减脂不掉肌节奏很好`);
    else if (bw.category === "rapid_loss") parts.push(`近期每周降重约 ${slopeAbs} kg 有点太快，小心跟着掉力气`);
    else if (bw.category === "lean_bulk") parts.push(`近期体重每周稳涨约 ${slopeAbs} kg，干净增肌节奏不错`);
    else if (bw.category === "rapid_gain") parts.push(`近期每周涨重约 ${slopeAbs} kg 偏快，注意控制多余热量`);
    else parts.push("近期体重过滤单日波动后整体平稳");
  }
  if (parts.length) bodyTip = parts.join("；") + "。";

  let muscleTip = `本周有 ${optMuscles} / 6 个大肌群练够了推荐组数，分布很均衡。`;
  if (optMuscles < 4) {
    const lacking = muscles.audits.filter((m) => m.category === "maintenance").slice(0, 2).map((m) => m.muscleName).join("、");
    muscleTip = lacking
      ? `${lacking}这周练的组数偏少（不足 10 组），下周可以适当多给它们补一两个动作。`
      : "个别部位这周总组数偏高，记得留够肌肉恢复时间。";
  }

  return `<section class="coach-summary-strip" aria-label="本周核心建议">
    <div class="coach-summary-head">${icon("bolt", 15)} <strong>一句话结论</strong></div>
    <ul class="sci-insight-list">
      <li>${esc(loadTip)}</li>
      <li>${esc(bodyTip)}</li>
      <li>${esc(muscleTip)}</li>
    </ul>
  </section>`;
}

export function renderAnalyticsView(data, state) {
  const { acwr, monotony, muscles, inol, ipfGl, nutrition, bodyweight, appleDaily, appleWorkouts, userProfile } = data;

  const controls = `<div class="period-controls">
    <label aria-label="数据分析截止日期"><input type="date" data-change="analytics-through" min="1902-01-01" max="${data.today}" value="${data.through}"></label>
    ${segments(intervalOptions, data.period, "analytics-period")}
  </div>`;

  const currAcwr = acwr.current;
  const acwrBadgeClass = currAcwr.zone === "sweet_spot" ? "is-sweet"
    : currAcwr.zone === "danger" ? "is-danger"
    : currAcwr.zone === "caution" ? "is-caution" : "is-deload";

  const optMuscles = muscles.audits.filter((m) => m.category === "optimal").length;

  const { weightKg, appleWeightKg, gender } = userProfile;
  const appleWeightDiff = appleWeightKg != null && weightKg != null && Math.abs(appleWeightKg - weightKg) >= 0.1;

  const hasApple = Boolean(
    state?.appleHealthConnected ||
    appleDaily?.bodyReport?.hasData ||
    appleDaily?.recoveryReport?.hasData ||
    (appleWorkouts?.totalCount ?? 0) > 0,
  );
  const visibleSectionOptions = hasApple
    ? sectionOptions
    : { training: "训练与力量", reports: "训练报表与文献" };
  const rawSection = ["health", "training", "reports"].includes(state?.analyticsSection)
    ? state.analyticsSection
    : "training";
  const activeSection = !hasApple && rawSection === "health" ? "training" : rawSection;
  const rec = appleDaily?.recoveryReport;
  const body = appleDaily?.bodyReport;
  const readinessScore = hasApple ? (rec?.readinessScore ?? null) : null;
  const readinessToneClass = rec?.readinessTone ? toneClass(rec.readinessTone) : "";

  const healthPanels = [
    renderAppleRecoveryPanel(appleDaily, acwr, state),
    renderAppleBodyPanel(appleDaily, state),
  ];
  const strengthPanels = [
    renderAcwrPanel(acwr),
    renderMuscleDosePanel(muscles),
    renderMonotonyPanel(monotony),
    renderInolPanel(inol),
    renderIpfGlPanel(ipfGl, userProfile),
    renderNutritionPhysioPanel(nutrition, bodyweight),
  ];
  const reportPanels = [
    renderAppleReportsPanel(data, state, hasApple),
    renderBibliographyPanel(data),
  ];

  const visiblePanels = activeSection === "health"
    ? healthPanels
    : activeSection === "reports"
      ? reportPanels
      : strengthPanels;

  const tierRaw = ipfGl.total?.tierLabel ?? ipfGl.bench?.tierLabel ?? "暂无数据";
  const tierShort = tierRaw.replace(/\s*\([^)]*\)/, "");

  return `
    <div class="page-heading masthead-analytics">
      <div>
        <h1>数据分析</h1>
        <p>${hasApple ? "负荷、恢复、力量和饮食，一页看清近期状态与建议。" : "负荷、力量、肌群分布和饮食，一页看清近期训练节奏与建议。"}</p>
      </div>
      ${controls}
    </div>

    <div class="section-bar stats-header analytics-meta-bar">
      <div>
        <h2>近期状态一览</h2>
        <p>截至 ${shortDate(data.through)} · ${weightKg == null ? "暂无体重" : `体重 ${fmt(weightKg, 1)} kg`}${gender != null ? `（${gender === "female" ? "女性" : "男性"}）` : ""}${appleWeightDiff ? ` · Apple 健康 ${fmt(appleWeightKg, 2)} kg <button type="button" class="quiet apple-inline-sync" data-action="adopt-apple-weight-analytics">同步为 ${fmt(appleWeightKg, 2)} kg</button>` : ""}</p>
      </div>
    </div>

    <div class="kpis analytics-kpis">
      <div class="kpi-card ${acwrBadgeClass}">
        <span class="kpi-label">训练节奏（负荷比）</span>
        <div class="kpi-val-row">
          <strong class="kpi-value">${fmt(currAcwr.acwr, 2)}</strong>
          <span class="kpi-pill ${acwrBadgeClass}">${plainAcwrStatus(currAcwr.zone)}</span>
        </div>
        <span class="kpi-sub">近7天 ${fmt(currAcwr.acuteLoad)} kg · 平时每周 ${fmt(currAcwr.chronicLoad)} kg</span>
      </div>

      ${readinessScore != null ? `<div class="kpi-card ${readinessToneClass}">
        <span class="kpi-label">今日身体准备度</span>
        <div class="kpi-val-row">
          <strong class="kpi-value">${readinessScore} <small>分</small></strong>
          <span class="kpi-pill ${readinessToneClass}">${esc(rec.readinessLabel.split(" · ")[0])}</span>
        </div>
        <span class="kpi-sub">${[
          body?.weightKg != null ? `${fmt(body.weightKg, 2)} kg` : null,
          body?.bodyFatPct != null ? `体脂 ${fmt(body.bodyFatPct, 1)}%` : null,
          appleDaily?.averages?.sleepMinutes != null ? `睡眠 ${formatSleepMinutes(appleDaily.series?.at(-1)?.sleepMinutes ?? appleDaily.averages.sleepMinutes)}` : null,
        ].filter(Boolean).join(" · ") || "综合心率与睡眠恢复"}</span>
      </div>` : `<div class="kpi-card ${monotony.current.monotonyLevel === 'high' ? 'is-danger' : monotony.current.monotonyLevel === 'moderate' ? 'is-caution' : 'is-sweet'}">
        <span class="kpi-label">练休起伏</span>
        <div class="kpi-val-row">
          <strong class="kpi-value">${monotony.current.monotonyLevel === 'high' ? '太单一' : monotony.current.monotonyLevel === 'moderate' ? '较平均' : '张弛有度'}</strong>
          <span class="kpi-pill">${monotony.current.monotonyLevel === 'high' ? '多留休息日' : monotony.current.monotonyLevel === 'moderate' ? '轻重交替' : '恢复节奏好'}</span>
        </div>
        <span class="kpi-sub">重训与休息错开更不容易疲劳堆积</span>
      </div>`}

      <div class="kpi-card is-sweet">
        <span class="kpi-label">肌群练到位</span>
        <div class="kpi-val-row">
          <strong class="kpi-value">${optMuscles} <small>/ 6 部位</small></strong>
          <span class="kpi-pill is-sweet">${optMuscles >= 4 ? '分布均衡' : '部分偏少'}</span>
        </div>
        <span class="kpi-sub">建议每个部位每周 10–20 组</span>
      </div>

      <div class="kpi-card">
        <span class="kpi-label">同体重力量</span>
        <div class="kpi-val-row">
          <strong class="kpi-value">${ipfGl.total ? fmt(ipfGl.total.score, 1) : ipfGl.bench ? fmt(ipfGl.bench.score, 1) : '—'} <small>分</small></strong>
          <span class="kpi-pill">${esc(tierShort)}</span>
        </div>
        <span class="kpi-sub">${ipfGl.total ? '三大项同体型排名分' : ipfGl.bench ? '卧推同体型排名分' : '完成深蹲/卧推/硬拉后评估'}</span>
      </div>
    </div>

    ${renderCoachSummaryStrip(data)}

    <div class="analytics-subnav" role="navigation" aria-label="分析板块筛选">
      ${segments(visibleSectionOptions, activeSection, "analytics-section")}
      <span class="analytics-subnav-meta">
        ${activeSection === "health" ? "聚焦 Apple 健康体成分、睡眠与心率恢复" : activeSection === "training" ? "聚焦负荷节奏、肌群组数、强度与饮食" : activeSection === "reports" ? (hasApple ? "聚焦每日体征流水表、运动统计与导出" : "聚焦力量训练汇总报表、导出与科研文献") : `共展示 ${visiblePanels.length} 个核心分析模块`}
      </span>
    </div>

    <div class="analytics-deck">
      ${visiblePanels.join("")}
    </div>
  `;
}

function renderAcwrPanel(acwr) {
  const { current, series } = acwr;
  const hasData = series.length > 0;

  const svgGraph = hasData ? renderAcwrSvg(series) : empty("暂无负荷数据", "连续记录几次训练后就会看到节奏曲线。");
  const ewmaAlert = current.ewmaZone === "danger" && current.zone !== "danger"
    ? " 提醒：这最近两天训练量突然冲得有点猛，即使周平均还没超标，明天也建议放缓一点。"
    : "";

  return `
    <section class="panel analytics-panel panel-acwr" id="panel-acwr">
      <header class="panel-head">
        <div>
          <h2>最近训练量是否过载</h2>
          <p>把近 7 天训练量和平时 1 个月对比，预防练太猛受伤</p>
        </div>
        <span class="atlas-pill">${plainAcwrStatus(current.zone)} (${fmt(current.acwr, 2)})</span>
      </header>

      <div class="acwr-gauge-strip">
        <div class="acwr-zone-meter">
          <div class="zone-bar deload" title="偏轻 (<0.8)"></div>
          <div class="zone-bar sweet" title="刚刚好 (0.8–1.3)"></div>
          <div class="zone-bar caution" title="偏累 (1.3–1.5)"></div>
          <div class="zone-bar danger" title="过载 (≥1.5)"></div>
          <div class="acwr-pointer" style="left: ${Math.min(100, Math.max(0, (current.acwr / 2.0) * 100))}%">
            <i></i><b>${fmt(current.acwr, 2)}</b>
          </div>
        </div>
        <div class="acwr-zone-legend" aria-hidden="true">
          <span>&lt;0.8 偏轻</span><span>0.8–1.3 刚刚好</span><span>1.3–1.5 偏累</span><span>&ge;1.5 过载</span>
        </div>
      </div>

      <div class="chart-wrap">
        <div class="chart-info">
          <strong>${fmt(current.acwr, 2)}</strong>
          <span>负荷比 · ${plainAcwrStatus(current.zone)}</span>
          <small>近7天总量 ${fmt(current.acuteLoad)} kg · 平时每周 ${fmt(current.chronicLoad)} kg</small>
        </div>
        <div class="chart-readout-line"><span class="chart-readout" data-chart-readout></span></div>
        ${svgGraph}
      </div>

      <div class="sci-insight-box">
        <div class="sci-insight-head">${icon("bolt", 15)} <span>节奏建议</span></div>
        ${acwr.referenceWeightKg != null ? `<p>缺少体重记录，徒手或辅助动作的负荷按 ${fmt(acwr.referenceWeightKg, 0)} kg 参考体重估算。</p>` : ""}
        <p>${esc((current.zone === "sweet_spot" ? "当前训练节奏非常合适，刺激足够又不容易练伤，照常推进即可。" : current.zone === "danger" ? "警告：近期训练量突然上涨太多，关节和体能容易吃不消，强烈建议安排 2–3 天休息或大幅减轻重量！" : current.zone === "caution" ? "最近训练量比平时略高，如果感觉累了记得多睡会儿、吃好碳水，别连续加码。" : "最近训练量比平时轻一些，如果是主动减载休整正好；想冲力量的话可以慢慢多练几组。") + ewmaAlert)}</p>
      </div>
    </section>
  `;
}

function renderAcwrSvg(series) {
  const width = 640;
  const height = 180;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxAcwr = Math.max(2.0, ...series.map((s) => Math.max(s.acwr, s.ewmaAcwr ?? 0)));
  const minAcwr = 0;

  const getY = (val) => padTop + chartH - ((val - minAcwr) / (maxAcwr - minAcwr)) * chartH;
  const getX = (idx) => padLeft + (idx / Math.max(1, series.length - 1)) * chartW;

  const ySweetBottom = getY(0.8);
  const ySweetTop = getY(1.3);
  const yDanger = getY(1.5);

  const points = series.map((s, idx) => `${getX(idx).toFixed(1)},${getY(s.acwr).toFixed(1)}`).join(" ");
  const hasEwma = series.some((s) => typeof s.ewmaAcwr === "number");
  const ewmaPoints = hasEwma
    ? series.map((s, idx) => `${getX(idx).toFixed(1)},${getY(s.ewmaAcwr ?? s.acwr).toFixed(1)}`).join(" ")
    : "";

  const dateLabels = series.length >= 2
    ? `<text x="${padLeft}" y="${height - 5}" font-size="11" fill="var(--muted)">${shortDate(series[0].date)}</text>
       <text x="${width - padRight}" y="${height - 5}" font-size="11" text-anchor="end" fill="var(--muted)">${shortDate(series[series.length - 1].date)}</text>`
    : "";

  return `
    <svg class="analytics-chart" viewBox="0 0 ${width} ${height}" aria-label="ACWR 趋势图">
      <defs>
        <linearGradient id="sweetZoneGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="var(--ink)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>

      <!-- Sweet Spot Band (0.8 - 1.3) -->
      <rect x="${padLeft}" y="${ySweetTop}" width="${chartW}" height="${Math.max(0, ySweetBottom - ySweetTop)}" fill="url(#sweetZoneGrad)"/>
      <line x1="${padLeft}" y1="${ySweetBottom}" x2="${width - padRight}" y2="${ySweetBottom}" stroke="var(--edge)" stroke-dasharray="3 3"/>
      <line x1="${padLeft}" y1="${ySweetTop}" x2="${width - padRight}" y2="${ySweetTop}" stroke="var(--edge)" stroke-dasharray="3 3"/>
      <text x="${width - padRight - 4}" y="${ySweetTop - 5}" font-size="11" text-anchor="end" fill="var(--muted)">理想上限 1.3</text>

      <!-- Danger line (1.5) -->
      <line x1="${padLeft}" y1="${yDanger}" x2="${width - padRight}" y2="${yDanger}" stroke="var(--red)" stroke-dasharray="4 2" stroke-width="1.2"/>
      <text x="${padLeft + 4}" y="${yDanger - 5}" font-size="11" fill="var(--red)">过载线 1.5</text>

      <!-- EWMA Secondary Curve -->
      ${hasEwma ? `<polyline points="${ewmaPoints}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round"/>` : ""}

      <!-- Rolling ACWR Curve -->
      <polyline points="${points}" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>

      ${series.map((s, idx) => {
        const cx = getX(idx).toFixed(1), cy = getY(s.acwr).toFixed(1);
        const tip = `${shortDate(s.date)} · 负荷比 ${fmt(s.acwr, 2)}（${plainAcwrStatus(s.zone)}）`;
        return `<circle cx="${cx}" cy="${cy}" r="3" fill="var(--bg)" stroke="${s.zone === "danger" ? "var(--red)" : "var(--ink)"}" stroke-width="1.8"/>
          <circle cx="${cx}" cy="${cy}" r="10" class="chart-hit" tabindex="0" role="button" aria-label="${esc(tip)}" data-chart-tip="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
      }).join("")}

      ${dateLabels}
    </svg>
  `;
}

function renderMuscleDosePanel(muscles) {
  const { audits } = muscles;

  return `
    <section class="panel analytics-panel panel-muscle-dose" id="panel-muscle-dose">
      <header class="panel-head">
        <div>
          <h2>各部位练到位了吗</h2>
          <p>每个大肌群每周练 10–20 组最容易长肌肉</p>
        </div>
        <span class="atlas-pill">10–20 组/周最佳</span>
      </header>

      <div class="muscle-dose-list">
        ${audits.map((m) => {
          const pct = Math.min(100, Math.round((m.sets / 24) * 100));
          const opt10Pct = (10 / 24) * 100;
          const opt20Pct = (20 / 24) * 100;
          const pillClass = m.category === "optimal" ? "is-sweet" : m.category === "overreaching" ? "is-danger" : "is-deload";

          return `
            <div class="muscle-dose-row">
              <div class="muscle-dose-meta">
                <span class="muscle-name">${esc(m.muscleName)}</span>
                <span class="muscle-sets"><strong>${m.sets}</strong> 组/周 <small>(近4周均 ${fmt(m.avg4WeekSets, 1)})</small></span>
                <span class="kpi-pill ${pillClass}">${esc(m.categoryLabel)}</span>
              </div>
              <div class="muscle-dose-track">
                <div class="dose-zone-marker opt-start" style="left: ${opt10Pct}%" title="最低增肌阈值 10 组"></div>
                <div class="dose-zone-marker opt-end" style="left: ${opt20Pct}%" title="高容量上限 20 组"></div>
                <div class="muscle-dose-bar ${pillClass}" style="width: ${pct}%"></div>
              </div>
              <p class="muscle-dose-advice">${esc(m.advice)}</p>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderMonotonyPanel(monotony) {
  const { current, previous } = monotony;

  return `
    <section class="panel analytics-panel panel-monotony" id="panel-monotony">
      <header class="panel-head">
        <div>
          <h2>练休安排合不合理</h2>
          <p>轻重日与休息日错开，比每天硬练同样强度更不容易累</p>
        </div>
        <span class="atlas-pill">${current.monotony < 1.5 ? "有张有弛" : current.monotony < 2.0 ? "起伏偏平" : "太过单调"}</span>
      </header>

      <div class="health-metrics monotony-metrics">
        <div>
          <span>平均每天练多少</span>
          <strong>${fmt(current.meanDailyLoad)} <small>kg/天</small></strong>
          <small>起伏幅度 ±${fmt(current.standardDeviation)}</small>
        </div>
        <div>
          <span>训练重复度</span>
          <strong>${fmt(current.monotony, 2)}</strong>
          <small>${current.monotony >= 2.0 ? '≥2.0 太相似易疲劳' : '<1.5 轻重交替好'}</small>
        </div>
        <div>
          <span>本周总疲劳压</span>
          <strong>${fmt(current.trainingStrain)}</strong>
          <small>较上周 ${current.trainingStrain >= previous.trainingStrain ? '+' : ''}${fmt(current.trainingStrain - previous.trainingStrain)}</small>
        </div>
      </div>

      <div class="sci-insight-box">
        <div class="sci-insight-head">${icon("rest", 15)} <span>恢复节奏提醒</span></div>
        <p>${esc(current.monotonyAdvice)} 高效练法要有重训日、轻练日和休息日，不要每天练到差不多的疲劳度。</p>
      </div>
    </section>
  `;
}

function renderInolPanel(inol) {
  const { lifts } = inol;

  return `
    <section class="panel analytics-panel panel-inol" id="panel-inol">
      <header class="panel-head">
        <div>
          <h2>核心大重量动作疲劳度</h2>
          <p>评估卧推、深蹲、硬拉单次和一周累计压力，防止过度疲劳</p>
        </div>
        <span class="atlas-pill">单次建议 0.4–1.0</span>
      </header>

      ${lifts.length ? `
        <div class="inol-grid">
          ${lifts.map((l) => {
            const badgeClass = l.category === "optimal" ? "is-sweet" : l.category === "brutal" ? "is-danger" : l.category === "tough" ? "is-caution" : "is-deload";
            return `
              <div class="inol-card">
                <div class="inol-top">
                  <div>
                    <strong>${esc(l.name)}</strong>
                    <small>估算 1RM: ${fmt(l.oneRepMax)} kg · ${l.sessionDate ? shortDate(l.sessionDate) : '近期'}</small>
                  </div>
                  <span class="kpi-pill ${badgeClass}">${esc(l.categoryLabel)}</span>
                </div>
                <div class="inol-scores">
                  <div>
                    <span>单次压力</span>
                    <strong>${fmt(l.sessionInol, 2)}</strong>
                    <small>${l.totalSets} 组 · ${l.totalReps} 次</small>
                  </div>
                  <div>
                    <span>这周累计</span>
                    <strong>${fmt(l.weeklyInol, 2)}</strong>
                    <small>${l.weeklyInol >= 4.0 ? '累计偏重了' : l.weeklyInol >= 2.0 ? '刺激很充分' : '还有加练空间'}</small>
                  </div>
                </div>
                <p class="inol-advice">${esc(l.advice)}</p>
              </div>
            `;
          }).join("")}
        </div>
      ` : empty("暂无大重量动作记录", "完成卧推、深蹲、硬拉等复合动作后会自动评估强度压力。")}
    </section>
  `;
}

function renderIpfGlPanel(ipfGl, userProfile) {
  const { bench, total, components } = ipfGl;
  const bestTier = ((bench?.score ?? 0) >= (total?.score ?? 0) ? bench?.tierLabel : total?.tierLabel) ?? bench?.tierLabel ?? total?.tierLabel ?? "同体重评估";
  const tierShort = bestTier.replace(/\s*\([^)]*\)/, "");
  const bwKg = userProfile.weightKg;
  const needsProfile = bwKg == null || userProfile.gender == null;
  const formatLift = (liftKg) => `${fmt(liftKg)} kg${bwKg != null ? ` (${fmt(liftKg / bwKg, 2)}× 体重)` : ""}`;

  return `
    <section class="panel analytics-panel panel-ipf-gl" id="panel-ipf-gl">
      <header class="panel-head">
        <div>
          <h2>按体重算，力量排哪一档</h2>
          <p>按 IPF GL 公式排除体重影响，对比健身与力量训练人群相对力量（世界纪录基准为 100 分）</p>
        </div>
        <span class="atlas-pill">${esc(tierShort)}</span>
      </header>

      <div class="ipf-gl-cards">
        <div class="ipf-score-box">
          <div class="ipf-score-top">
            <span class="ipf-title">平板卧推得分</span>
            <span class="kpi-pill ${bench && bench.score >= 35 ? 'is-sweet' : ''}">${bench?.tierLabel ?? (components.bench1RM && needsProfile ? '待补体重或性别' : '需卧推数据')}</span>
          </div>
          <div class="ipf-score-val">
            <strong>${bench ? fmt(bench.score, 1) : '—'}</strong>
            <span>分</span>
          </div>
          <small>推算极限: ${components.bench1RM ? formatLift(components.bench1RM) : '未记录'}${bwKg != null ? ` · 体重 ${fmt(bwKg)} kg` : ""}</small>
        </div>

        <div class="ipf-score-box">
          <div class="ipf-score-top">
            <span class="ipf-title">三大项总分 (SBD)</span>
            <span class="kpi-pill ${total && total.score >= 35 ? 'is-sweet' : ''}">${total?.tierLabel ?? (components.total3Lift && needsProfile ? '待补体重或性别' : '需三项训练数据')}</span>
          </div>
          <div class="ipf-score-val">
            <strong>${total ? fmt(total.score, 1) : '—'}</strong>
            <span>分</span>
          </div>
          <small>卧推 ${fmt(components.bench1RM)} + 深蹲 ${fmt(components.squat1RM)} + ${esc(components.deadliftSourceName || '硬拉')} ${fmt(components.deadlift1RM)} = ${components.total3Lift ? formatLift(components.total3Lift) : '待补齐'}</small>
        </div>
      </div>

      <div class="ipf-standards-strip">
        <div class="ipf-level"><span class="dot"></span><b>入门</b>&lt;35 分</div>
        <div class="ipf-level"><span class="dot is-sweet"></span><b>扎实</b>35–46 分</div>
        <div class="ipf-level"><span class="dot is-sweet"></span><b>进阶</b>47–62 分</div>
        <div class="ipf-level"><span class="dot is-danger"></span><b>精英</b>&ge;63 分</div>
      </div>
    </section>
  `;
}

function renderNutritionPhysioPanel(nutrition, bodyweight) {
  const { protein } = nutrition;
  const { report: bwReport } = bodyweight;

  return `
    <section class="panel analytics-panel panel-nutrition-physio" id="panel-nutrition-physio">
      <header class="panel-head">
        <div>
          <h2>吃够蛋白了吗 · 体重真实走势</h2>
          <p>自动排除喝水起伏，看长期减脂增肌节奏稳不稳</p>
        </div>
        <span class="atlas-pill">建议蛋白 ≥1.6 g/kg</span>
      </header>

      <div class="physio-deck">
        <div class="physio-block">
          <div class="physio-top">
            <strong>每天蛋白质吃够没</strong>
            <span class="kpi-pill ${protein.status === 'optimal' ? 'is-sweet' : 'is-caution'}">${esc(protein.statusLabel)}</span>
          </div>
          <div class="physio-nums">
            <div>
              <span>日均摄入</span>
              <strong>${fmt(protein.averageGramsPerDay)} <small>g/天</small></strong>
            </div>
            <div>
              <span>每公斤体重</span>
              <strong>${protein.averageGramsPerKg != null ? `${fmt(protein.averageGramsPerKg, 2)} <small>g/kg</small>` : "—"}</strong>
            </div>
            <div>
              <span>达标天数</span>
              <strong>${protein.daysMeetingTarget != null ? `${protein.daysMeetingTarget} <small>/ ${protein.totalDaysLogged} 天 (${protein.complianceRatePct}%)</small>` : "—"}</strong>
            </div>
          </div>
          <p class="physio-advice">${esc(protein.advice)}</p>
        </div>

        <div class="physio-block">
          <div class="physio-top">
            <strong>每周真实体重变化节奏</strong>
            <span class="kpi-pill ${bwReport?.category === 'optimal_cut' || bwReport?.category === 'lean_bulk' ? 'is-sweet' : ''}">${esc(bwReport?.categoryLabel ?? '数据累积中')}</span>
          </div>
          ${bwReport ? `
            <div class="physio-nums">
              <div>
                <span>周变化率</span>
                <strong>${bwReport.changeRatePerWeekPct > 0 ? '+' : ''}${fmt(bwReport.changeRatePerWeekPct, 2)}% <small>/周</small></strong>
              </div>
              <div>
                <span>平均每周</span>
                <strong>${(bwReport.weeklySlopeKg ?? 0) > 0 ? '+' : ''}${fmt(bwReport.weeklySlopeKg ?? bwReport.deltaKg, 2)} <small>kg</small></strong>
              </div>
              <div>
                <span>跨度</span>
                <strong>${fmt(bwReport.weeksSpan, 1)} <small>周</small></strong>
              </div>
            </div>
            <p class="physio-advice">${esc(bwReport.advice)}</p>
          ` : empty("还缺几次称重记录", "记满 2 次以上体重后就能自动判断每周增减速度合不合理。")}
        </div>
      </div>
    </section>
  `;
}

function renderAppleOverviewRibbon(appleDaily, appleWorkouts) {
  const body = appleDaily?.bodyReport;
  const rec = appleDaily?.recoveryReport;
  const act = appleDaily?.activityReport;
  if (!body?.hasData && !rec?.hasData && !act?.hasData && !(appleWorkouts?.totalCount > 0)) return "";
  const items = [
    rec?.readinessScore != null ? ["今日准备度", `${rec.readinessScore} 分`, rec.readinessLabel.split(" · ")[0]] : null,
    body?.weightKg != null ? ["Apple 身体数据", `${fmt(body.weightKg, 2)} kg`, [body.bodyFatPct != null ? `体脂 ${fmt(body.bodyFatPct, 1)}%` : null, body.ffmiStatus ? `肌肉${body.ffmiStatus.label}` : null].filter(Boolean).join(" · ") || "最新记录"] : null,
    body?.waistCm != null ? ["腰围指标", `${fmt(body.waistCm, 1)} cm`, body.whtrStatus?.label ?? body.waistStatus?.label ?? "腹围"] : null,
    body?.metabolic ? ["日常推荐热量", `~${fmt(body.metabolic.recompCutTargetKcal, 0)} kcal`, `蛋白建议 ${fmt(body.metabolic.proteinTargetG, 0)} g/天`] : null,
    act?.hasData ? [
      "日常活动",
      act.latestSteps != null ? `${fmt(act.latestSteps, 0)} 步` : `${fmt(act.latestActiveEnergyKcal, 0)} kcal`,
      [act.latestDistanceKm != null ? `${fmt(act.latestDistanceKm, 2)} km` : null, act.activityTierLabel].filter(Boolean).join(" · "),
    ] : null,
    appleWorkouts?.totalCount ? [
      "Apple 运动",
      `${fmt(appleWorkouts.totalCount, 0)} 场`,
      `${appleWorkouts.realDeviceCount ? `真机 ${appleWorkouts.realDeviceCount} · ` : ""}${duration(appleWorkouts.totalDurationSeconds)}${appleWorkouts.avgBpm ? ` · 均心率 ${appleWorkouts.avgBpm}` : ""}`,
    ] : null,
  ].filter(Boolean);
  if (!items.length) return "";
  return `<div class="apple-overview-ribbon" role="region" aria-label="Apple 健康综合摘要">
    ${items.map(([k, v, sub]) => `<div class="apple-ribbon-cell"><span>${esc(k)}</span><strong>${esc(v)}</strong><small>${esc(sub)}</small></div>`).join("")}
  </div>`;
}

let appleTrendSeq = 0;

function pickAvailableChartMetric(series, metricsMap, requestedKey, fallbackKey) {
  if (requestedKey && metricsMap[requestedKey]) {
    const count = series.filter((e) => typeof e[requestedKey] === "number").length;
    if (count >= 2) return requestedKey;
  }
  for (const key of Object.keys(metricsMap)) {
    if (series.filter((e) => typeof e[key] === "number").length >= 2) return key;
  }
  return requestedKey && metricsMap[requestedKey] ? requestedKey : fallbackKey;
}

function renderInsightList(lines) {
  if (!lines?.length) return "";
  return `<ul class="sci-insight-list">${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
}

function ledgerCell(primaryHtml, subHtml = "") {
  if (!primaryHtml && !subHtml) return `<td class="muted">—</td>`;
  return `<td>${primaryHtml || `<span class="muted">—</span>`}${subHtml ? `<small class="apple-cell-sub">${subHtml}</small>` : ""}</td>`;
}

function renderSimpleTrendSvg(points, { label, unit, digits = 1 }) {
  if (points.length < 2) {
    return `<div class="apple-baseline-note">${icon("heart", 14)}<span>已记录首日基线数据（${points[0] ? `${shortDate(points[0].date)} · ${fmt(points[0].value, digits)} ${unit}` : "待同步"}）；连续同步 ≥ 2 天后自动绘制${esc(label)}趋势曲线。</span></div>`;
  }
  const width = 640, height = 180, padL = 52, padR = 16, padT = 18, padB = 26;
  const chartW = width - padL - padR, chartH = height - padT - padB;
  const vals = points.map((p) => p.value);
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  const delta = vals.at(-1) - vals[0];
  const span = Math.max(0.5, rawMax - rawMin);
  const lo = rawMin - span * 0.16;
  const hi = rawMax + span * 0.16;
  const getX = (i) => padL + (i / (points.length - 1)) * chartW;
  const getY = (v) => padT + chartH - ((v - lo) / (hi - lo)) * chartH;
  const poly = points.map((p, i) => `${getX(i).toFixed(1)},${getY(p.value).toFixed(1)}`).join(" ");
  const gradId = `apple-trend-${++appleTrendSeq}`;
  const baseBottomY = padT + chartH;
  const areaPoly = `${getX(0).toFixed(1)},${baseBottomY} ${poly} ${getX(points.length - 1).toFixed(1)},${baseBottomY}`;

  return `<div class="apple-trend-meta">
      <span>均值 <b>${esc(fmt(avg, digits))} ${esc(unit)}</b></span>
      <span>范围 ${esc(fmt(rawMin, digits))}–${esc(fmt(rawMax, digits))} ${esc(unit)}</span>
      <span>变化 <b class="${delta > 0 ? "is-up" : delta < 0 ? "is-down" : ""}">${delta > 0 ? "+" : ""}${esc(fmt(delta, digits))} ${esc(unit)}</b></span>
    </div>
    <div class="chart-readout-line"><span class="chart-readout" data-chart-readout></span></div>
    <svg class="analytics-chart" viewBox="0 0 ${width} ${height}" aria-label="${esc(label)}趋势图">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--red)" stop-opacity="0.24"/>
          <stop offset="100%" stop-color="var(--red)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${getY(rawMax)}" x2="${width - padR}" y2="${getY(rawMax)}" stroke="var(--edge)" stroke-dasharray="3 3"/>
      <line x1="${padL}" y1="${getY(avg)}" x2="${width - padR}" y2="${getY(avg)}" stroke="var(--muted)" stroke-dasharray="4 3" opacity="0.65"/>
      <line x1="${padL}" y1="${getY(rawMin)}" x2="${width - padR}" y2="${getY(rawMin)}" stroke="var(--edge)" stroke-dasharray="3 3"/>
      <text x="${padL - 6}" y="${getY(rawMax) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${esc(fmt(rawMax, digits))}</text>
      <text x="${padL - 6}" y="${getY(rawMin) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${esc(fmt(rawMin, digits))}</text>
      <text x="${width - padR - 2}" y="${getY(avg) - 5}" font-size="11" text-anchor="end" fill="var(--muted)">均值 ${esc(fmt(avg, digits))}</text>
      <polygon points="${areaPoly}" fill="url(#${gradId})"/>
      <polyline points="${poly}" fill="none" stroke="var(--red)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map((p, i) => {
        const cx = getX(i).toFixed(1), cy = getY(p.value).toFixed(1);
        const tip = `${shortDate(p.date)} · ${label} ${fmt(p.value, digits)} ${unit}`;
        return `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--red)"/>
          <circle cx="${cx}" cy="${cy}" r="10" class="chart-hit" tabindex="0" role="button" aria-label="${esc(tip)}" data-chart-tip="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
      }).join("")}
      <text x="${padL}" y="${height - 5}" font-size="11" fill="var(--muted)">${shortDate(points[0].date)}</text>
      <text x="${width - padR}" y="${height - 5}" font-size="11" text-anchor="end" fill="var(--muted)">${shortDate(points.at(-1).date)}</text>
    </svg>`;
}

function renderAppleBodyPanel(appleDaily, state) {
  const body = appleDaily?.bodyReport;
  const series = appleDaily?.series ?? [];
  const hasData = !!body?.hasData;
  const selectedKey = pickAvailableChartMetric(series, BODY_CHART_METRICS, state?.appleBodyChart, "weightKg");
  const chartSpec = BODY_CHART_METRICS[selectedKey];
  const points = series
    .filter((entry) => typeof entry[selectedKey] === "number")
    .map((entry) => ({ date: entry.date, value: entry[selectedKey] }));

  const cards = hasData ? [
    body.weightKg != null ? ["体重", `${fmt(body.weightKg, 2)} kg`, body.measuredAt?.weightDate ? shortDate(body.measuredAt.weightDate) : "最新"] : null,
    body.bodyFatPct != null ? ["体脂率", `${fmt(body.bodyFatPct, 1)}%`, body.fatMassKg != null ? `体脂约 ${fmt(body.fatMassKg, 2)} kg` : "体成分"] : null,
    body.leanBodyMassKg != null ? ["瘦体重", `${fmt(body.leanBodyMassKg, 2)} kg`, body.leanSharePct != null ? `占比 ${fmt(body.leanSharePct, 1)}%` : "去脂质量"] : null,
    body.bmi != null ? ["BMI", fmt(body.bmi, 1), body.bmiStatus?.label ?? "体重指数"] : null,
    body.ffmi != null ? ["肌肉量评级", body.ffmiStatus?.label ?? "标准", `综合肌肉指数 ${fmt(body.ffmi, 1)}`] : null,
    body.waistCm != null ? ["腰围状态", `${fmt(body.waistCm, 1)} cm`, body.whtrStatus?.label ?? body.waistStatus?.label ?? "腹围"] : null,
  ].filter(Boolean) : [];

  const splitBar = hasData && body.leanSharePct != null && body.bodyFatPct != null
    ? `<div class="apple-comp-split">
        <div class="apple-comp-head">
          <span><b>瘦体重</b> ${fmt(body.leanBodyMassKg, 2)} kg (${fmt(body.leanSharePct, 1)}%)</span>
          <span><b>体脂肪</b> ${fmt(body.fatMassKg, 2)} kg (${fmt(100 - body.leanSharePct, 1)}%)</span>
        </div>
        <div class="apple-comp-bar" role="img" aria-label="瘦体重与体脂肪比例">
          <i class="comp-lean" style="width:${Math.min(100, Math.max(0, body.leanSharePct))}%"></i>
          <i class="comp-fat" style="width:${Math.min(100, Math.max(0, 100 - body.leanSharePct))}%"></i>
        </div>
      </div>`
    : "";

  const metabolicCard = hasData && body.metabolic
    ? `<div class="apple-metabolic-box">
        <div class="apple-metabolic-head">
          <strong>每天建议热量与蛋白</strong>
          <small>按 ${fmt(body.leanBodyMassKg, 1)} kg 瘦体重推算${body.metabolic.appleRestingAvgKcal != null ? ` · 手表实测静息 ${fmt(body.metabolic.appleRestingAvgKcal, 0)} kcal` : ""}</small>
        </div>
        <div class="apple-metabolic-grid">
          <div><span>静息基础消耗</span><strong>${fmt(body.metabolic.bmrKatchMcArdleKcal, 0)} <small>kcal</small></strong></div>
          <div><span>每天总消耗</span><strong>${fmt(body.metabolic.sedentaryTdeeKcal, 0)}–${fmt(body.metabolic.trainingTdeeKcal, 0)}</strong></div>
          <div><span>建议减脂热量</span><strong>~${fmt(body.metabolic.recompCutTargetKcal, 0)} <small>kcal</small></strong></div>
          <div><span>每天蛋白目标</span><strong>${fmt(body.metabolic.proteinTargetG, 0)} <small>g/天</small></strong></div>
        </div>
        <button type="button" class="secondary-button apple-apply-btn" data-action="apply-apple-targets">${icon("check", 14)} 一键同步推荐热量与蛋白到饮食目标</button>
      </div>`
    : "";

  const recompCard = hasData && body.recomposition
    ? `<div class="apple-metabolic-box apple-recomp-box">
        <div class="apple-metabolic-head">
          <strong>保肌减脂路线预估（保持瘦体重不变）</strong>
          <small>理想腰围 &lt; ${fmt(body.recomposition.targetWaistCm, 0)} cm${body.recomposition.waistDeltaCm != null && body.recomposition.waistDeltaCm > 0 ? `（距达标差 ${fmt(body.recomposition.waistDeltaCm, 1)} cm）` : ""}</small>
        </div>
        ${body.recomposition.milestones.length ? `<div class="apple-recomp-list">
          ${body.recomposition.milestones.map((m) => `<div><span>${esc(m.label)}</span><strong>目标体重 ${fmt(m.targetWeightKg, 1)} kg</strong><small>减脂 ${fmt(m.fatToLoseKg, 1)} kg · 约 ${m.estWeeks} 周</small></div>`).join("")}
        </div>` : `<small class="muted">当前体脂与腰围已处于很理想的区间。</small>`}
      </div>`
    : "";

  const secondaryBodyDrawer = hasData && (recompCard || body.insights?.length)
    ? `<details class="sci-sub-drawer">
        <summary class="sci-sub-summary">
          <span>${icon("bolt", 14)} <strong>体成分详细解读与减脂阶段预估</strong></span>
          <small>展开查看</small>
        </summary>
        <div class="sci-sub-body">
          ${recompCard}
          ${body.insights?.length ? `<div class="sci-insight-box"><div class="sci-insight-head">${icon("bolt", 15)} <span>体成分科学洞察</span></div>${renderInsightList(body.insights)}</div>` : ""}
        </div>
      </details>`
    : "";

  return `
    <section class="panel analytics-panel" id="panel-apple-body">
      <header class="panel-head">
        <div>
          <h2>身体成分与热量建议</h2>
          <p>${hasData
            ? `${body.heightCm ? `${body.heightSource === "bmi_inferred" ? "按估算身高" : "档案身高"} ${fmt(body.heightCm, 1)} cm · ` : ""}看懂你的肌肉量、体脂和每日热量目标`
            : "同步体重、体脂率、瘦体重、BMI 或腰围后自动算出"}</p>
        </div>
        ${hasData
          ? segments(Object.fromEntries(Object.entries(BODY_CHART_METRICS).map(([k, v]) => [k, v.label])), selectedKey, "apple-body-metric")
          : `<button type="button" class="quiet" data-action="issue-device">${icon("plus", 14)} 生成快捷指令</button>`}
      </header>
      ${hasData ? `
        <div class="health-metrics analytics-apple-grid">
          ${cards.map(([label, val, sub]) => `<div><span>${esc(label)}</span><strong>${esc(val)}</strong><small>${esc(sub)}</small></div>`).join("")}
        </div>
        ${splitBar}
        ${metabolicCard}
        <div class="chart-wrap">${renderSimpleTrendSvg(points, chartSpec)}</div>
        ${secondaryBodyDrawer}
      ` : empty("暂未收到体成分数据", "在 Apple 健康同期上传体重、体脂率、瘦体重或腰围即可自动评估 FFMI 与腰高比。")}
    </section>
  `;
}

function renderSignalGauge(value, band, tone) {
  if (!band || band.max <= band.min) return "";
  const span = band.max - band.min;
  const pct = (v) => Math.min(100, Math.max(0, ((v - band.min) / span) * 100));
  const left = pct(band.optMin);
  const width = Math.max(4, pct(band.optMax) - left);
  const pos = pct(value);
  return `<div class="apple-signal-gauge" aria-hidden="true">
    <div class="apple-gauge-opt" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></div>
    <i class="apple-gauge-pin ${toneClass(tone)}" style="left:${pos.toFixed(1)}%"></i>
  </div>`;
}

function renderAppleRecoveryPanel(appleDaily, acwr, state) {
  const rec = appleDaily?.recoveryReport;
  const act = appleDaily?.activityReport;
  const series = appleDaily?.series ?? [];
  const hasData = !!rec?.hasData || !!act?.hasData;
  const selectedKey = pickAvailableChartMetric(series, RECOVERY_CHART_METRICS, state?.appleRecoveryChart, "restingHeartRateBpm");
  const chartSpec = RECOVERY_CHART_METRICS[selectedKey];
  const points = series
    .filter((entry) => typeof entry[selectedKey] === "number")
    .map((entry) => ({ date: entry.date, value: entry[selectedKey] }));

  const extraTiles = [];
  if (rec?.heartRateLatest) {
    extraTiles.push({
      label: "即时心率",
      value: `${fmt(rec.heartRateLatest.value, 0)} bpm`,
      statusLabel: rec.heartRateLatest.spreadFromRhr != null ? `高于静息 +${fmt(rec.heartRateLatest.spreadFromRhr, 0)} bpm` : shortDate(rec.heartRateLatest.date),
      tone: "sweet",
      detail: `最近采样 ${shortDate(rec.heartRateLatest.date)}`,
    });
  }
  if (rec?.vo2MaxLatest) {
    extraTiles.push({
      label: "最大摄氧量",
      value: fmt(rec.vo2MaxLatest.value, 1),
      statusLabel: rec.vo2MaxLatest.value >= 45 ? "心肺耐力优良" : "心肺基础指标",
      tone: rec.vo2MaxLatest.value >= 45 ? "sweet" : "caution",
      detail: `mL/kg·min · ${shortDate(rec.vo2MaxLatest.date)}`,
    });
  }
  if (act?.hasData) {
    const valParts = [
      act.latestSteps != null ? `${fmt(act.latestSteps, 0)} 步` : null,
      act.latestDistanceKm != null ? `${fmt(act.latestDistanceKm, 2)} km` : null,
    ].filter(Boolean);
    const detailParts = [
      act.avgSteps != null ? `均值 ${fmt(act.avgSteps, 0)} 步` : null,
      act.avgDistanceKm != null ? `${fmt(act.avgDistanceKm, 2)} km` : null,
      act.strideCm != null ? `步幅 ${fmt(act.strideCm, 0)} cm` : null,
      act.latestActiveEnergyKcal != null ? `活动 ${fmt(act.latestActiveEnergyKcal, 0)} kcal` : null,
      act.latestFlightsClimbed != null ? `爬楼 ${fmt(act.latestFlightsClimbed, 0)} 层` : null,
    ].filter(Boolean);
    extraTiles.push({
      label: "日常活动与步行",
      value: valParts.join(" · ") || `${fmt(act.latestActiveEnergyKcal, 0)} kcal`,
      statusLabel: String(act.activityTierLabel ?? "").replace(/\s*\([^)]*\)/, ""),
      tone: act.latestSteps != null && act.latestSteps < 300 ? "caution" : "sweet",
      detail: detailParts.join(" · ") || "日常活动基线",
    });
  }

  const corrInsights = (appleDaily?.correlations ?? []).map(formatHumanCorrelation);
  const combinedInsights = [...(rec?.insights ?? []), ...corrInsights];
  if (rec?.readinessScore != null && acwr?.current?.acwr > 0) {
    const zone = acwr.current.zone;
    if (zone === "danger" && rec.readinessScore < 70) {
      combinedInsights.push(`综合提醒：最近训练量已经冲得太猛，加上身体恢复得分偏低（${rec.readinessScore} 分），建议这两天减轻重量或休息一天。`);
    } else if (zone === "sweet_spot" && rec.readinessScore >= 75) {
      combinedInsights.push(`训练与恢复配合得很好：训练节奏合适且身体状态在线（准备度 ${rec.readinessScore} 分），可以稳步尝试加重量。`);
    }
  }

  return `
    <section class="panel analytics-panel" id="panel-apple-recovery">
      <header class="panel-head">
        <div>
          <h2>身体恢复与日常活力</h2>
          <p>${hasData
            ? `${rec?.baselineMode === "personal_baseline" ? "自动对照你最近几天的个人平时水平，看今天疲不疲劳" : rec?.hasData ? "当前先按健康标准区间评估（同步满 3 天后会自动对照个人平时习惯）" : "记录日常步数与步行状态"}`
            : "同步静息心率、HRV、血氧、呼吸频率和睡眠后每天帮你看恢复状态"}</p>
        </div>
        ${hasData && rec?.readinessScore != null
          ? `<span class="kpi-pill ${toneClass(rec.readinessTone)}">准备度 ${rec.readinessScore} 分 · ${esc(rec.readinessLabel.split(" · ")[0])}</span>`
          : `<button type="button" class="quiet" data-action="issue-device">${icon("plus", 14)} 生成快捷指令</button>`}
      </header>
      ${hasData ? `
        ${rec?.readinessScore != null ? `
          <div class="apple-readiness-banner ${toneClass(rec.readinessTone)}">
            <div class="apple-readiness-score">
              <div class="apple-readiness-matrix">${matrix(String(rec.readinessScore))}</div>
              <div>
                <small>今日身体准备度 / 100</small>
                <strong>${esc(rec.readinessLabel)}</strong>
              </div>
            </div>
            <div class="apple-readiness-meter">
              ${dotMeter(rec.readinessScore / 100, 10, `准备度 ${rec.readinessScore} / 100`)}
              <small>${rec.readinessScore}% 综合状态</small>
            </div>
          </div>` : ""}
        <div class="apple-signal-grid">
          ${[...(rec?.signals ?? []).map((s) => ({
            label: s.label,
            value: `${fmt(s.value, s.key === "hrvMs" || s.key === "respiratoryRate" || s.key === "bloodOxygenPct" || s.key === "sleepMinutes" ? 1 : 0)} ${s.unit}`,
            statusLabel: s.statusLabel,
            tone: s.tone,
            detail: s.detail,
            gauge: renderSignalGauge(s.value, s.rangeBand, s.tone),
          })), ...extraTiles].map((item) => `
            <div class="apple-signal-card">
              <div class="apple-signal-top">
                <span>${esc(item.label)}</span>
                <span class="kpi-pill ${toneClass(item.tone)}">${esc(item.statusLabel)}</span>
              </div>
              <strong>${esc(item.value)}</strong>
              ${item.gauge || ""}
              <small>${esc(item.detail)}</small>
            </div>
          `).join("")}
        </div>
        <div class="chart-wrap">
          <div class="apple-chart-subbar">
            <span>关键体征趋势</span>
            ${segments(Object.fromEntries(Object.entries(RECOVERY_CHART_METRICS).map(([k, v]) => [k, v.label])), selectedKey, "apple-recovery-metric")}
          </div>
          ${renderSimpleTrendSvg(points, chartSpec)}
        </div>
        ${combinedInsights.length ? `<div class="sci-insight-box">
          <div class="sci-insight-head">${icon("heart", 15)} <span>自主神经与训练载荷建议</span></div>
          ${renderInsightList(combinedInsights.slice(0, 2))}
          ${combinedInsights.length > 2 ? `<details class="sci-sub-drawer is-compact">
            <summary class="sci-sub-summary"><span>更多生理规律与关联解读（+${combinedInsights.length - 2} 条）</span><small>展开</small></summary>
            <div class="sci-sub-body">${renderInsightList(combinedInsights.slice(2))}</div>
          </details>` : ""}
        </div>` : ""}
      ` : empty("暂未收到心肺恢复样本", "通过快捷指令同步静息心率、HRV、血氧或呼吸频率后展示准备度与心肺分析。")}
    </section>
  `;
}

function dayDeltaHtml(curr, prev, unit = "", digits = 1, lowerBetter = false) {
  if (typeof curr !== "number" || typeof prev !== "number") return "";
  const diff = curr - prev;
  if (Math.abs(diff) < (digits === 0 ? 1 : 0.05)) return "";
  const good = lowerBetter ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "↑" : "↓";
  const sign = diff > 0 ? "+" : "";
  return ` <span class="apple-delta-tag ${good ? "is-good" : "is-warn"}">${arrow}${sign}${fmt(diff, digits)}${esc(unit)}</span>`;
}

function renderAppleReportsPanel(data, state, hasApple = true) {
  const { appleDaily, appleWorkouts, period: periodDays, through, trainingSummary, userProfile } = data;
  const entries = hasApple ? [...(appleDaily?.series ?? [])].reverse() : [];
  const hasDaily = entries.length > 0;
  const hasWorkouts = hasApple && (appleWorkouts?.totalCount ?? 0) > 0;
  const hasTraining = (trainingSummary?.sessions ?? 0) > 0 || (trainingSummary?.dietDaysLogged ?? 0) > 0;
  const workoutFilter = state?.appleWorkoutFilter === "device" ? "device" : "all";
  const realDeviceCount = appleWorkouts?.realDeviceCount ?? 0;
  const demoCount = appleWorkouts?.demoCount ?? 0;
  const activeStats = workoutFilter === "device" && appleWorkouts?.realDeviceStats
    ? appleWorkouts.realDeviceStats
    : appleWorkouts;
  const filteredRecent = activeStats?.recent ?? [];
  const woLimit = state?.appleReportWorkoutsExpanded ? filteredRecent.length : 8;
  const visibleWorkouts = filteredRecent.slice(0, woLimit);
  const dailyLimit = state?.appleReportDailyExpanded ? entries.length : 10;
  const visibleDaily = entries.slice(0, dailyLimit);

  const br = appleDaily?.bodyReport;
  const rr = appleDaily?.recoveryReport;
  const actRep = appleDaily?.activityReport;
  const execSummary = (hasDaily || hasWorkouts || hasTraining) ? `
    <div class="apple-report-subblock">
      <div class="apple-report-subhead">
        <strong>近 ${periodDays} 天周期摘要 · 截至 ${shortDate(through)}</strong>
        <small>${hasApple ? "聚合力量训练流水、Apple 健康体征与运动上报来源" : "聚合力量训练与体成分流水明细"}</small>
      </div>
      <div class="apple-weekly-grid apple-exec-grid">
        <div class="apple-weekly-card">
          <span>力量训练执行与总吨位</span>
          <strong>${fmt(trainingSummary?.sessions ?? 0, 0)} <small>场 · ${fmt(trainingSummary?.workSets ?? 0, 0)} 组</small></strong>
          <small>${trainingSummary?.tonnageKg ? `${fmt(trainingSummary.tonnageKg / 1000, 1)} t 有效吨位 · ` : ""}${fmt(trainingSummary?.activeDays ?? 0, 0)} 练日 · ${fmt(trainingSummary?.dietDaysLogged ?? 0, 0)} 饮食日</small>
        </div>
        <div class="apple-weekly-card">
          <span>当前体成分与目标基准</span>
          <strong>${br?.weightKg != null ? `${fmt(br.weightKg, 2)} <small>kg</small>` : userProfile?.weightKg != null ? `${fmt(userProfile.weightKg, 1)} <small>kg</small>` : "—"}</strong>
          <small>${[
            br?.bodyFatPct != null ? `体脂 ${fmt(br.bodyFatPct, 1)}%` : null,
            br?.ffmi != null ? `FFMI ${fmt(br.ffmi, 1)}` : null,
            br?.whtr != null ? `WHtR ${fmt(br.whtr, 3)}` : null,
          ].filter(Boolean).join(" · ") || "训练档案体重基线"}</small>
        </div>
        ${hasApple ? `<div class="apple-weekly-card">
          <span>恢复准备度与日常活动</span>
          <strong>${rr?.readinessScore != null ? `${rr.readinessScore} <small>分</small>` : (actRep?.latestSteps != null ? `${fmt(actRep.latestSteps, 0)} <small>步</small>` : "待同步")}</strong>
          <small>${[
            appleDaily?.averages?.restingHeartRateBpm != null ? `静息 ${fmt(appleDaily.averages.restingHeartRateBpm, 0)} bpm` : null,
            appleDaily?.averages?.hrvMs != null ? `HRV ${fmt(appleDaily.averages.hrvMs, 1)} ms` : null,
            actRep?.latestSteps != null ? `${fmt(actRep.latestSteps, 0)} 步` : null,
          ].filter(Boolean).join(" · ") || "等待快捷指令每日体征"}</small>
        </div>
        <div class="apple-weekly-card">
          <span>Apple 健康上报结构</span>
          <strong>真机 ${fmt(realDeviceCount, 0)} <small>场运动</small></strong>
          <small>演示对照 ${fmt(demoCount, 0)} 场 · 体征 ${fmt(entries.length, 0)} 天 · 覆盖 ${fmt(appleDaily?.coverageSummary?.syncedCount ?? 0, 0)}/${fmt(appleDaily?.coverageSummary?.totalCount ?? 22, 0)} 项</small>
        </div>` : ""}
      </div>
    </div>` : "";

  const onlyShortTriggers = workoutFilter === "device"
    && filteredRecent.length > 0
    && activeStats?.avgBpm == null
    && activeStats?.maxBpm == null
    && (activeStats?.totalCaloriesKcal ?? 0) === 0
    && filteredRecent.every((r) => r.captureMethod === "trigger");

  const workoutSection = hasWorkouts ? `
    <div class="apple-report-subblock">
      <div class="apple-report-subhead">
        <strong>Apple Watch 运动统计（${workoutFilter === "device" ? "仅真机" : `近 ${periodDays} 天`}）</strong>
        <div class="apple-report-subctrl">
          <small>真机 ${fmt(realDeviceCount, 0)} 场 · 示例 ${fmt(demoCount, 0)} 场 · 关联力量 ${fmt(activeStats?.linkedManualCount ?? 0, 0)} 场</small>
          ${segments({ all: "全部运动", device: "仅真机上传" }, workoutFilter, "apple-workout-filter")}
        </div>
      </div>
      ${activeStats && activeStats.totalCount > 0 ? `
        <div class="health-metrics apple-workout-kpis">
          <div><span>${workoutFilter === "device" ? "真机场次" : "累计场次"}</span><strong>${fmt(activeStats.totalCount, 0)} <small>场</small></strong></div>
          <div><span>运动总时长</span><strong>${duration(activeStats.totalDurationSeconds)}</strong></div>
          <div><span>总活动消耗</span><strong>${activeStats.totalCaloriesKcal ? `${fmt(activeStats.totalCaloriesKcal, 0)} <small>kcal</small>` : "—"}</strong></div>
          <div><span>累计距离 / 心率</span><strong>${activeStats.avgBpm ? `${fmt(activeStats.avgBpm, 0)} <small>bpm</small>` : activeStats.totalDistanceKm ? `${fmt(activeStats.totalDistanceKm, 2)} <small>km</small>` : "—"}</strong>${activeStats.maxBpm ? `<small>峰值 ${fmt(activeStats.maxBpm, 0)} bpm${activeStats.totalDistanceKm ? ` · ${fmt(activeStats.totalDistanceKm, 2)} km` : ""}</small>` : ""}</div>
        </div>
        ${onlyShortTriggers ? `<p class="apple-device-tip">当前 ${activeStats.totalCount} 条为捷径事件触发记录（未含窗口心率与千卡能耗）；佩戴 Apple Watch 完成完整锻炼或运行「近期训练直传」后，此处将自动呈现心率区间与热量拆分。</p>` : ""}
        <div class="apple-activity-bars">
          ${activeStats.byActivity.map((act) => {
            const share = Math.max(8, Math.round((act.durationSeconds / Math.max(1, activeStats.totalDurationSeconds)) * 100));
            return `<div class="apple-activity-row">
              <span><strong>${esc(act.title)}</strong><small>${act.count} 场 · ${duration(act.durationSeconds)}${act.caloriesKcal ? ` · ${fmt(act.caloriesKcal, 0)} kcal` : ""}${act.avgBpm ? ` · 均心率 ${act.avgBpm}` : ""}</small></span>
              <div class="apple-activity-track"><i style="width:${share}%"></i></div>
            </div>`;
          }).join("")}
        </div>
        ${activeStats.hrZones ? `<div class="apple-hr-zones">
          <div class="apple-hr-zone-head">
            <span>单场平均心率区间分布（按场次占比）</span>
            <small>Tanaka 估算最大心率 ${activeStats.hrZones.hrMax} bpm · 每场按平均值归类</small>
          </div>
          <div class="apple-hr-zone-bar" role="img" aria-label="单场平均心率区间分布">
            ${activeStats.hrZones.zones.filter((z) => z.pct > 0).map((z) => `<i class="hr-${z.key}" style="width:${z.pct}%" title="${esc(`${z.label} · ${z.count} 场（场次占 ${z.pct}%${z.durationSeconds > 0 ? ` · 共 ${duration(z.durationSeconds)}` : ""}）`)}"></i>`).join("")}
          </div>
          <div class="apple-hr-zone-legend">
            ${activeStats.hrZones.zones.filter((z) => z.count > 0).map((z) => `<span><i class="hr-${z.key}"></i>${esc(z.label)} ${z.count} 场（场次 ${z.pct}%${z.durationSeconds > 0 ? ` · 共 ${duration(z.durationSeconds)}` : ""}）</span>`).join("")}
          </div>
        </div>` : activeStats.avgBpm != null ? "<p>已记录平均心率。年龄资料在 18–81 岁范围内时可查看估算区间。</p>" : ""}
        <div class="apple-table-scroll">
          <table class="apple-ledger-table">
            <thead><tr><th>日期</th><th>运动类型</th><th>时长</th><th>消耗 / 距离</th><th>平均 / 峰值心率</th><th>详情</th></tr></thead>
            <tbody>
              ${visibleWorkouts.map((row) => `
                <tr>
                  <td>${esc(shortDate(row.date))}</td>
                  <td><b>${esc(row.title)}</b> <span class="apple-source-tag ${row.isDemo ? "is-demo" : "is-device"}">${row.isDemo ? "示例" : (row.captureMethod === "trigger" ? "真机·触发" : "真机")}</span></td>
                  <td>${esc(duration(row.durationSeconds))}</td>
                  <td>${[row.activeEnergyKcal != null ? `${fmt(row.activeEnergyKcal, 0)} kcal` : null, row.distanceMeters ? `${fmt(row.distanceMeters / 1000, 2)} km` : null].filter(Boolean).join(" · ") || "—"}</td>
                  <td>${row.heartRate?.avgBpm != null ? `${fmt(row.heartRate.avgBpm, 0)}${row.heartRate?.maxBpm ? ` / ${fmt(row.heartRate.maxBpm, 0)}` : ""} bpm` : "—"}</td>
                  <td><button type="button" class="quiet" data-action="apple-activity" data-value="${esc(row.id)}" data-date="${esc(row.date)}" data-type="${esc(row.activityType)}" data-title="${esc(row.title)}">查看 ${icon("chevron", 12)}</button></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
        ${filteredRecent.length > 8 ? `<div class="apple-table-more"><button type="button" class="quiet" data-action="toggle-apple-workouts">${state?.appleReportWorkoutsExpanded ? "收起至最近 8 条" : `展开全部 ${filteredRecent.length} 条运动记录`}</button></div>` : ""}
      ` : empty("近 " + periodDays + " 天暂无真机运动记录", "可在快捷指令运行运动上传或切换「全部运动」对照示例记录。")}
    </div>` : "";

  const dailySection = hasDaily ? `
    <div class="apple-report-subblock">
      <div class="apple-report-subhead">
        <strong>每日体征与体成分流水明细（共 ${entries.length} 天）</strong>
        <small>加粗为主指标，下行显示细分数据；含连续日环比波动提示</small>
      </div>
      <div class="apple-table-scroll">
        <table class="apple-ledger-table">
          <thead><tr><th>日期</th><th>体重与围度</th><th>去脂与指数</th><th>心率指标</th><th>恢复与通气</th><th>活动与睡眠</th><th>操作</th></tr></thead>
          <tbody>
            ${visibleDaily.map((row, idx) => {
              const prevDay = entries[idx + 1] ?? null;
              const bodyMain = row.weightKg != null
                ? `<b>${esc(fmt(row.weightKg, 2))} kg</b>${dayDeltaHtml(row.weightKg, prevDay?.weightKg, "", 2, true)}`
                : row.bodyFatPct != null ? `<b>体脂 ${esc(fmt(row.bodyFatPct, 1))}%</b>` : "";
              const bodySub = [
                row.weightKg != null && row.bodyFatPct != null ? `体脂 ${esc(fmt(row.bodyFatPct, 1))}%${dayDeltaHtml(row.bodyFatPct, prevDay?.bodyFatPct, "%", 1, true)}` : null,
                row.waistCm != null ? `腰围 ${esc(fmt(row.waistCm, 1))} cm` : null,
              ].filter(Boolean).join(" · ");

              const leanMain = row.leanBodyMassKg != null ? `<b>瘦体重 ${esc(fmt(row.leanBodyMassKg, 1))} kg</b>` : row.bmi != null ? `<b>BMI ${esc(fmt(row.bmi, 1))}</b>` : "";
              const leanSub = row.leanBodyMassKg != null && row.bmi != null ? `BMI ${esc(fmt(row.bmi, 1))}` : "";

              const hrMain = row.restingHeartRateBpm != null
                ? `<b>静息 ${esc(fmt(row.restingHeartRateBpm, 0))} bpm</b>${dayDeltaHtml(row.restingHeartRateBpm, prevDay?.restingHeartRateBpm, "", 0, true)}`
                : row.heartRateBpm != null ? `<b>即时 ${esc(fmt(row.heartRateBpm, 0))} bpm</b>` : "";
              const hrSub = row.restingHeartRateBpm != null && row.heartRateBpm != null ? `即时 ${esc(fmt(row.heartRateBpm, 0))} bpm` : "";

              const recMain = row.hrvMs != null
                ? `<b>HRV ${esc(fmt(row.hrvMs, 1))} ms</b>${dayDeltaHtml(row.hrvMs, prevDay?.hrvMs, "", 1, false)}`
                : row.bloodOxygenPct != null ? `<b>血氧 ${esc(fmt(row.bloodOxygenPct, 0))}%</b>` : row.respiratoryRate != null ? `<b>呼吸 ${esc(fmt(row.respiratoryRate, 1))}/分</b>` : "";
              const recSub = [
                row.hrvMs != null && row.bloodOxygenPct != null ? `血氧 ${esc(fmt(row.bloodOxygenPct, 0))}%` : null,
                (row.hrvMs != null || row.bloodOxygenPct != null) && row.respiratoryRate != null ? `呼吸 ${esc(fmt(row.respiratoryRate, 1))}/分` : null,
              ].filter(Boolean).join(" · ");

              const actMain = row.steps != null
                ? `<b>${esc(fmt(row.steps, 0))} 步</b>${row.distanceKm != null ? ` · ${esc(fmt(row.distanceKm, 2))} km` : ""}`
                : row.sleepMinutes != null ? `<b>睡眠 ${esc(formatSleepMinutes(row.sleepMinutes))}</b>` : row.activeEnergyKcal != null ? `<b>活动 ${esc(fmt(row.activeEnergyKcal, 0))} kcal</b>` : "";
              const actSub = [
                row.steps != null && row.flightsClimbed != null ? `爬楼 ${esc(fmt(row.flightsClimbed, 0))} 层` : null,
                (row.steps != null || row.sleepMinutes != null) && row.activeEnergyKcal != null ? `活动 ${esc(fmt(row.activeEnergyKcal, 0))} kcal` : null,
                row.steps != null && row.sleepMinutes != null ? `睡眠 ${esc(formatSleepMinutes(row.sleepMinutes))}` : null,
              ].filter(Boolean).join(" · ");

              return `<tr>
                <td><b>${esc(row.date)}</b></td>
                ${ledgerCell(bodyMain, bodySub)}
                ${ledgerCell(leanMain, leanSub)}
                ${ledgerCell(hrMain, hrSub)}
                ${ledgerCell(recMain, recSub)}
                ${ledgerCell(actMain, actSub)}
                <td><button type="button" class="quiet" data-action="apple-daily-detail" data-date="${esc(row.date)}">档案 ${icon("chevron", 12)}</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${entries.length > 10 ? `<div class="apple-table-more"><button type="button" class="quiet" data-action="toggle-apple-daily">${state?.appleReportDailyExpanded ? "收起至最近 10 天" : `展开全部 ${entries.length} 天体征流水`}</button></div>` : ""}
    </div>` : "";

  const wc = appleDaily?.weeklyComparison;
  const weeklySection = wc && wc.metrics?.length
    ? `<div class="apple-report-subblock">
        <div class="apple-report-subhead">
          <strong>近 7 天生理均值与周环比（${shortDate(wc.recentWindow.from)}–${shortDate(wc.recentWindow.through)}）</strong>
          <small>${wc.hasPreviousBaseline ? `对比前 7 天（${wc.previousWindow.daysWithData} 天样本）` : "累积跨周（≥8 天）后自动显示周环比涨跌"}</small>
        </div>
        <div class="apple-weekly-grid">
          ${wc.metrics.map((m) => {
            const digits = m.key === "weightKg" ? 2 : m.key === "hrvMs" ? 1 : 0;
            const dText = m.delta != null ? `${m.delta > 0 ? "+" : ""}${fmt(m.delta, digits)} ${m.unit}` : "首周基线";
            return `<div class="apple-weekly-card">
              <span>${esc(m.label)}</span>
              <strong>${m.current != null ? `${fmt(m.current, digits)} <small>${esc(m.unit)}</small>` : "—"}</strong>
              <small>${esc(dText)}</small>
            </div>`;
          }).join("")}
        </div>
      </div>`
    : "";

  const cov = appleDaily?.coverageSummary;
  const covStrip = cov && cov.totalCount > 0
    ? `<div class="apple-report-subblock">
        <div class="apple-report-subhead">
          <strong>体征维度覆盖矩阵（${cov.syncedCount} / ${cov.totalCount}）</strong>
          <small>${cov.missingMetrics?.length ? `还有 ${cov.missingMetrics.length} 项待同步` : "全部维度均已覆"}</small>
        </div>
        <div class="apple-cov-grid">
          ${(cov.categoryProgress ?? []).map((c) => `
            <div class="apple-cov-cat">
              <div class="apple-cov-head"><span>${esc(c.category)}</span><strong>${c.synced}<small>/${c.total}</small></strong></div>
              ${dotMeter(c.synced / Math.max(1, c.total), c.total, `${c.category} ${c.synced}/${c.total}`)}
            </div>
          `).join("")}
        </div>
        <details class="apple-missing-box">
          <summary>查看已同步与待解锁 22 项指标明细</summary>
          ${cov.syncedMetrics.length ? `<div class="apple-coverage-strip">${cov.syncedMetrics.map((m) => `<span class="kpi-pill is-sweet">${esc(m.label)}</span>`).join("")}</div>` : ""}
          ${(cov.missingMetrics ?? []).length > 0 ? `<div class="apple-coverage-strip">${cov.missingMetrics.map((m) => `<span class="kpi-pill">${esc(m.category)} · ${esc(m.label)}</span>`).join("")}</div>` : ""}
        </details>
      </div>`
    : "";

  const metaDrawer = (covStrip || weeklySection)
    ? `<details class="sci-sub-drawer">
        <summary class="sci-sub-summary">
          <span><strong>近 7 天生理均值周环比 · 体征维度覆盖矩阵（${cov?.syncedCount ?? 0}/${cov?.totalCount ?? 22}）</strong></span>
          <small>展开核对</small>
        </summary>
        <div class="sci-sub-body">
          ${weeklySection}${covStrip}
        </div>
      </details>`
    : "";

  return `
    <section class="panel analytics-panel panel-apple-report" id="panel-apple-report">
      <header class="panel-head">
        <div>
          <h2>${hasApple ? "Apple 健康 · 运动汇总与每日明细报表" : "训练汇总报表与数据导出"}</h2>
          <p>${hasDaily || hasWorkouts || hasTraining ? `近 ${periodDays} 天结构化明细报表 · 支持一键导出 CSV、完整 JSON 档案与打印/存 PDF` : (hasApple ? "通过快捷指令同步后自动生成每日体征流水账与运动统计报表" : `近 ${periodDays} 天力量训练汇总 · 支持导出 CSV、JSON 与打印/存 PDF`)}</p>
        </div>
        ${hasDaily || hasWorkouts || hasTraining ? `<div class="apple-report-actions">
          <button type="button" class="secondary-button" data-action="export-apple-csv">${icon("download", 15)} 导出 CSV</button>
          <button type="button" class="secondary-button" data-action="export-apple-json">${icon("download", 15)} 导出 JSON</button>
          <button type="button" class="secondary-button" data-action="print-report">${icon("print", 15)} 打印 / 存 PDF</button>
        </div>` : ""}
      </header>
      ${hasWorkouts || hasDaily || hasTraining ? `${dailySection}${workoutSection}${metaDrawer}` : empty(hasApple ? "暂无可生成报表的健康流水" : "暂无可生成的训练报表", hasApple ? "运行快捷指令上传体征或运动记录后，这里会生成综合执行摘要、运动分类统计、体征流水表及 CSV / JSON / PDF 导出。" : "完成训练或饮食记录后，可在此一键导出训练明细 CSV / JSON 或打印存档。")}
    </section>
  `;
}

function renderBibliographyPanel(data) {
  const { acwr, monotony, bodyweight, nutrition, appleDaily, citations } = data;
  const items = Object.values(citations);
  const bw = bodyweight?.report;
  const prot = nutrition?.protein;
  const rec = appleDaily?.recoveryReport;
  const body = appleDaily?.bodyReport;
  const corrs = appleDaily?.correlations ?? [];

  const techCards = [
    ["ACWR 双模型与去耦合", `滚动 ${fmt(acwr.current.acwr, 2)} · EWMA ${fmt(acwr.current.ewmaAcwr ?? acwr.current.acwr, 2)}`, acwr.current.uncoupledAcwr != null ? `去耦合 ${fmt(acwr.current.uncoupledAcwr, 2)} · 7d/28d` : "Gabbett / Williams"],
    ["Monotony & Strain", `${fmt(monotony.current.monotony, 2)} / ${fmt(monotony.current.trainingStrain)}`, `SD ±${fmt(monotony.current.standardDeviation)} kg`],
    bw ? ["体重趋势回归", `${bw.weeklySlopeKg >= 0 ? "+" : ""}${fmt(bw.weeklySlopeKg, 2)} kg/周`, bw.trendMethod === "ols_regression" ? `OLS R²=${fmt(bw.rSquared ?? 0, 2)}` : "Two-Point"] : null,
    prot?.totalDaysLogged ? ["蛋白摄入", prot.leanMassGramsPerKg != null ? `${fmt(prot.leanMassGramsPerKg, 2)} g/kg LBM` : prot.averageGramsPerKg != null ? `${fmt(prot.averageGramsPerKg, 2)} g/kg` : `${fmt(prot.averageGramsPerDay)} g/天`, prot.complianceRatePct != null ? `达标率 ${prot.complianceRatePct}%` : "待补体重"] : null,
    rec?.lnHrvBaseline ? ["ln(rMSSD) 自主神经基线", `${fmt(rec.lnHrvBaseline.latest, 2)}${rec.lnHrvBaseline.zScore != null ? ` (Z=${rec.lnHrvBaseline.zScore >= 0 ? "+" : ""}${fmt(rec.lnHrvBaseline.zScore, 2)})` : ""}`, `${rec.lnHrvBaseline.swcHalfSd != null ? `SWC ±${fmt(rec.lnHrvBaseline.swcHalfSd, 2)}` : "单日参考"}${rec.autonomicBalanceRatio != null ? ` · 平衡指数 ${fmt(rec.autonomicBalanceRatio, 2)}` : ""}`] : null,
    body?.metabolic?.measuredVsPredictedPct != null ? ["Katch-McArdle 实测比对", `${body.metabolic.appleRestingAvgKcal} kcal`, `偏差 ${body.metabolic.measuredVsPredictedPct >= 0 ? "+" : ""}${fmt(body.metabolic.measuredVsPredictedPct, 1)}%`] : null,
  ].filter(Boolean);

  return `
    <details class="panel analytics-panel panel-bibliography sci-advanced-drawer" id="panel-bibliography">
      <summary class="sci-drawer-summary">
        <div>
          <strong>进阶查看 · 底层科学模型参数与 ${items.length} 篇文献依据</strong>
          <small>平时无需关心，展开可核对 EWMA-ACWR、去耦合比、OLS R²、ln(rMSSD) Z-score、t 检验与参考文献</small>
        </div>
        <span class="atlas-pill">展开详情</span>
      </summary>

      <div class="sci-drawer-body">
        ${techCards.length ? `<div class="sci-tech-grid">
          ${techCards.map(([k, v, sub]) => `<div class="sci-tech-cell"><span>${esc(k)}</span><strong>${esc(v)}</strong><small>${esc(sub)}</small></div>`).join("")}
        </div>` : ""}

        ${corrs.length ? `<div class="sci-corr-raw">
          <strong>Student's t 检验显著相关性（仅统计过检项）：</strong>
          <span>${corrs.map((c) => esc(`${c.label}: ${c.note}`)).join(" ｜ ")}</span>
        </div>` : ""}

        <div class="bibliography-list">
          ${items.map((cit) => `
            <div class="biblio-entry">
              <div class="biblio-meta">
                <strong>${esc(cit.authors)} (${cit.year})</strong>
                <span class="biblio-journal">${esc(cit.journal)}</span>
              </div>
              <p class="biblio-title">“${esc(cit.title)}”</p>
              <p class="biblio-takeaway">${icon("check", 14)} <b>核心结论：</b>${esc(cit.takeaway)}</p>
            </div>
          `).join("")}
        </div>
      </div>
    </details>
  `;
}
