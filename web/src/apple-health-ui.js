import { $, copyText, duration, esc, field, fmt, icon, input, options } from "./ui.js";

let shortcutGenMod;
const loadShortcutGen = () => (shortcutGenMod ??= import("./shortcut-gen.js"));

const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const exportEndpoint = "/api/integrations/apple-health/health-data-export";
const maxExportBytes = 16 * 1024 * 1024;
const exportTooLarge = "文件超过 16 MB，请缩短导出日期范围，或只导出训练摘要。";

export function openHealthDataImport({ api, open, onImported }) {
  open("导入体能训练", `<form class="dialog-form" id="health-data-import">
    <p class="muted">在 Health Data Export 选择 Workouts（体能训练）和 JSON 格式，存到「文件」后在这里上传。</p>
    ${field("训练 JSON 文件", '<input name="exportFile" type="file" accept=".json,application/json" required>')}
    <p class="muted">一次最多 16 MB、1,000 条。重复上传会合并同一条训练。</p>
    <p class="form-error" role="alert" hidden></p>
    <p data-import-result role="status" hidden></p>
    <footer class="dialog-foot"><button class="primary-button">导入训练</button></footer>
  </form>`);
  const form = $("#health-data-import");
  const button = $("button", form);
  const errorEl = $(".form-error", form);
  const resultEl = $("[data-import-result]", form);
  const picker = $('[name="exportFile"]', form);
  picker.addEventListener("change", () => { errorEl.hidden = true; resultEl.hidden = true; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    resultEl.hidden = true;
    button.disabled = true;
    picker.disabled = true;
    button.textContent = "正在导入…";
    try {
      const file = picker.files[0];
      if (!file?.size) throw new Error("请选择有内容的训练 JSON 文件。");
      if (file.size > maxExportBytes) throw new Error(exportTooLarge);
      let body;
      try { body = JSON.parse(await file.text()); }
      catch { throw new Error("无法读取 JSON，请在 Health Data Export 重新选择 JSON 格式导出。"); }
      const result = await api(exportEndpoint + "/import", { method: "POST", body });
      resultEl.textContent = `新增 ${result.imported} 条 · 补全 ${result.updated} 条 · 跳过重复 ${result.duplicate} 条`;
      resultEl.hidden = false;
      picker.value = "";
      onImported();
    } catch (error) {
      errorEl.textContent = error.status === 413 ? exportTooLarge : error.message;
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      picker.disabled = false;
      button.textContent = "导入训练";
    }
  });
}

export async function openHealthDataWebhook({ api, open, notify, refresh }) {
  const { webhookUrl } = await api(exportEndpoint + "/config").catch((error) => {
    if (error.status === 404) return {};
    throw error;
  });
  const matchesOrigin = location.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const url = webhookUrl || (matchesOrigin ? location.origin + exportEndpoint + "/webhook" : null);
  open("连接 Health Data Export", `<form class="dialog-form" id="health-data-webhook">
    <p class="muted">${url ? "在 Health Data Export 的自动导出中选择 Workouts 和 HTTPS Webhook，填入地址与设备令牌，再测试连接。"
      : "此网页使用本机地址。可以先生成设备令牌，等 iPhone 可访问的 HTTPS 上传地址配置好后再填写。"} </p>
    ${url ? field("Webhook 地址", input("webhookUrl", url, "readonly")) : ""}
    <div data-token-fields hidden></div>
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot">
      ${url ? '<button type="button" class="secondary-button" data-copy-url>复制地址</button>' : ""}
      <button class="primary-button">生成设备令牌</button>
    </footer>
  </form>`);
  const form = $("#health-data-webhook");
  const errorEl = $(".form-error", form);
  const revealError = (message) => { errorEl.textContent = message; errorEl.hidden = false; };
  form.addEventListener("click", async ({ target }) => {
    const copy = target.closest("[data-copy-url], [data-copy-health-token]");
    if (!copy) return;
    errorEl.hidden = true;
    const name = copy.hasAttribute("data-copy-url") ? "webhookUrl" : "webhookToken";
    if (await copyText(form.elements[name].value)) {
      notify(name === "webhookUrl" ? "Webhook 地址已复制" : "设备令牌已复制");
    } else {
      form.elements[name].select();
      revealError("自动复制失败，请手动复制已选中的内容。");
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("button:not([type])", form);
    if (button.disabled) return;
    button.disabled = true;
    errorEl.hidden = true;
    try {
      const device = await api("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "Health Data Export" } });
      if (form.isConnected) {
        const tokenFields = $("[data-token-fields]", form);
        tokenFields.innerHTML = field("Bearer Token（仅显示一次）", input("webhookToken", device.token, "readonly")) +
          '<button type="button" class="secondary-button" data-copy-health-token>复制令牌</button>';
        tokenFields.hidden = false;
        button.hidden = true;
      }
      await refresh();
    } catch (error) {
      button.disabled = button.hidden;
      revealError(error.message);
    }
  });
}

export function appleLine(item) {
  const metadata = ["Apple 健康", item.plan?.name ? "已完成 " + item.plan.name : null,
    item.manualWorkoutId ? "已关联铁记记录" : null].filter(Boolean).join(" · ");
  return `<button class="record-line apple-line" type="button" data-action="apple-activity" data-value="${esc(item.id)}">
    <span class="record-icon">${icon("heart", 17)}</span><span><strong>${esc(item.title)}</strong><small>${esc(metadata)}</small></span>
    <span class="record-number">${duration(item.durationSeconds)}</span>${icon("chevron", 15)}</button>`;
}

export function formatSleepMinutes(minutes) {
  if (minutes == null) return "—";
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} 分钟`;
}

/**
 * Compact Apple Health daily summary strip rendered in Overview and Calendar Day Dossier.
 */
export function renderAppleDailyStrip(daily, { compact = false } = {}) {
  if (!daily) return "";
  const pills = [];
  if (daily.sleepMinutes != null) pills.push(["睡眠", formatSleepMinutes(daily.sleepMinutes)]);
  if (daily.weightKg != null) pills.push(["体重", `${fmt(daily.weightKg, 2)} kg`]);
  if (daily.bodyFatPct != null) pills.push(["体脂率", `${fmt(daily.bodyFatPct, 1)}%`]);
  if (daily.waistCm != null) pills.push(["腰围", `${fmt(daily.waistCm, 1)} cm`]);
  if (daily.steps != null) pills.push(["步数", !compact && daily.distanceKm != null ? `${fmt(daily.steps, 0)} · ${fmt(daily.distanceKm, 2)} km` : `${fmt(daily.steps, 0)} 步`]);
  if (daily.totalEnergyKcal != null) pills.push(["总消耗", `${fmt(daily.totalEnergyKcal, 0)} kcal`]);
  else if (daily.activeEnergyKcal != null) pills.push(["活动能量", `${fmt(daily.activeEnergyKcal, 0)} kcal`]);
  if (daily.restingHeartRateBpm != null) pills.push(["静息心率", `${fmt(daily.restingHeartRateBpm, 0)} bpm`]);
  if (daily.hrvMs != null) pills.push(["HRV", `${fmt(daily.hrvMs, 1)} ms`]);
  if (daily.bloodOxygenPct != null && !compact) pills.push(["血氧", `${fmt(daily.bloodOxygenPct, 0)}%`]);
  if (daily.respiratoryRate != null && !compact) pills.push(["呼吸", `${fmt(daily.respiratoryRate, 1)} /分`]);
  if (daily.vo2Max != null && !compact) pills.push(["VO2 Max", fmt(daily.vo2Max, 1)]);
  if (!pills.length) return "";

  const visible = compact ? pills.slice(0, 6) : pills.slice(0, 6);
  return `<div class="apple-daily-strip${compact ? " is-compact" : ""}">
    <div class="apple-daily-head">
      <span>${icon("heart", 15)} <strong>Apple 健康日常指标</strong><small>${esc(daily.date)}${pills.length > 6 ? ` · 已同步 ${pills.length} 项` : ""}</small></span>
      <div class="apple-daily-actions">
        ${!compact ? `<button type="button" class="quiet" data-action="route" data-value="analytics">数据分析 ${icon("chevron", 14)}</button>` : ""}
        <button type="button" class="quiet" data-action="apple-daily-detail" data-date="${esc(daily.date)}">完整指标 ${icon("chevron", 14)}</button>
      </div>
    </div>
    <div class="apple-daily-pills">
      ${visible.map(([label, val]) => `<div class="apple-daily-pill"><span>${esc(label)}</span><strong>${esc(val)}</strong></div>`).join("")}
    </div>
  </div>`;
}

function metricGrid(rows) {
  const valid = rows.filter(([, value]) => value !== "—");
  if (!valid.length) return "";
  return `<div class="health-metrics apple-telemetry">${valid.map(([label, value]) =>
    `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>`;
}

/**
 * Full multi-category Apple Health dossier modal covering Sleep stages, Body Composition,
 * Daily Activity & Expenditure, Cardiopulmonary Vitals, and Hydration/Nutrition snapshots.
 */
export function appleDailyDetailsModal(daily) {
  if (!daily) return "";
  const totalStageMin = (daily.sleepDeepMinutes ?? 0) + (daily.sleepCoreMinutes ?? 0) + (daily.sleepRemMinutes ?? 0) + (daily.sleepAwakeMinutes ?? 0);
  const sleepWindow = daily.sleepStartAt && daily.sleepEndAt
    ? `${clock.format(new Date(daily.sleepStartAt))} – ${clock.format(new Date(daily.sleepEndAt))}`
    : "";
  const sleepStagesBar = totalStageMin > 0
    ? `<div class="sleep-stage-bar" role="img" aria-label="睡眠分期比例">
        ${daily.sleepDeepMinutes ? `<i class="stage-deep" style="width:${(daily.sleepDeepMinutes / totalStageMin) * 100}%"></i>` : ""}
        ${daily.sleepCoreMinutes ? `<i class="stage-core" style="width:${(daily.sleepCoreMinutes / totalStageMin) * 100}%"></i>` : ""}
        ${daily.sleepRemMinutes ? `<i class="stage-rem" style="width:${(daily.sleepRemMinutes / totalStageMin) * 100}%"></i>` : ""}
        ${daily.sleepAwakeMinutes ? `<i class="stage-awake" style="width:${(daily.sleepAwakeMinutes / totalStageMin) * 100}%"></i>` : ""}
      </div>
      <div class="sleep-stage-legend">
        ${daily.sleepDeepMinutes != null ? `<span><i class="stage-deep"></i>深睡 ${formatSleepMinutes(daily.sleepDeepMinutes)}</span>` : ""}
        ${daily.sleepCoreMinutes != null ? `<span><i class="stage-core"></i>核心 ${formatSleepMinutes(daily.sleepCoreMinutes)}</span>` : ""}
        ${daily.sleepRemMinutes != null ? `<span><i class="stage-rem"></i>REM ${formatSleepMinutes(daily.sleepRemMinutes)}</span>` : ""}
        ${daily.sleepAwakeMinutes != null ? `<span><i class="stage-awake"></i>清醒 ${formatSleepMinutes(daily.sleepAwakeMinutes)}</span>` : ""}
      </div>`
    : "";

  const sleepBlock = daily.sleepMinutes != null || daily.sleepInBedMinutes != null
    ? `<section class="apple-dossier-section">
        <header><strong>睡眠恢复</strong>${sleepWindow ? `<small>${esc(sleepWindow)}</small>` : ""}</header>
        ${metricGrid([
          ["实际睡眠", formatSleepMinutes(daily.sleepMinutes)],
          ["卧床时长", formatSleepMinutes(daily.sleepInBedMinutes)],
          ["睡眠效率", daily.sleepEfficiencyPct != null ? `${fmt(daily.sleepEfficiencyPct, 0)}%` : "—"],
          ["清醒时长", formatSleepMinutes(daily.sleepAwakeMinutes)],
        ])}
        ${sleepStagesBar}
      </section>`
    : "";

  const bodyBlock = metricGrid([
    ["体重", daily.weightKg != null ? `${fmt(daily.weightKg, 2)} kg` : "—"],
    ["体脂率", daily.bodyFatPct != null ? `${fmt(daily.bodyFatPct, 1)}%` : "—"],
    ["瘦体重", daily.leanBodyMassKg != null ? `${fmt(daily.leanBodyMassKg, 2)} kg` : "—"],
    ["BMI", daily.bmi != null ? fmt(daily.bmi, 1) : "—"],
    ["腰围", daily.waistCm != null ? `${fmt(daily.waistCm, 1)} cm` : "—"],
  ]);

  const activityBlock = metricGrid([
    ["今日步数", daily.steps != null ? `${fmt(daily.steps, 0)} 步` : "—"],
    ["活动能量", daily.activeEnergyKcal != null ? `${fmt(daily.activeEnergyKcal, 0)} kcal` : "—"],
    ["静息能量", daily.restingEnergyKcal != null ? `${fmt(daily.restingEnergyKcal, 0)} kcal` : "—"],
    ["总能量消耗", daily.totalEnergyKcal != null ? `${fmt(daily.totalEnergyKcal, 0)} kcal` : "—"],
    ["步行/跑步距离", daily.distanceKm != null ? `${fmt(daily.distanceKm, 2)} km` : "—"],
    ["已爬楼层", daily.flightsClimbed != null ? `${fmt(daily.flightsClimbed, 0)} 层` : "—"],
  ]);

  const vitalsBlock = metricGrid([
    ["静息心率", daily.restingHeartRateBpm != null ? `${fmt(daily.restingHeartRateBpm, 0)} bpm` : "—"],
    ["最新心率", daily.heartRateBpm != null ? `${fmt(daily.heartRateBpm, 0)} bpm` : "—"],
    ["心率变异性 HRV", daily.hrvMs != null ? `${fmt(daily.hrvMs, 1)} ms` : "—"],
    ["VO2 Max", daily.vo2Max != null ? fmt(daily.vo2Max, 1) : "—"],
    ["血氧 SpO2", daily.bloodOxygenPct != null ? `${fmt(daily.bloodOxygenPct, 1)}%` : "—"],
    ["呼吸频率", daily.respiratoryRate != null ? `${fmt(daily.respiratoryRate, 1)} /分` : "—"],
  ]);

  const nutritionBlock = metricGrid([
    ["饮水量", daily.waterMl != null ? `${fmt(daily.waterMl, 0)} mL` : "—"],
    ["膳食热量", daily.dietaryEnergyKcal != null ? `${fmt(daily.dietaryEnergyKcal, 0)} kcal` : "—"],
    ["膳食蛋白", daily.dietaryProteinG != null ? `${fmt(daily.dietaryProteinG, 1)} g` : "—"],
    ["膳食碳水", daily.dietaryCarbsG != null ? `${fmt(daily.dietaryCarbsG, 1)} g` : "—"],
    ["膳食脂肪", daily.dietaryFatG != null ? `${fmt(daily.dietaryFatG, 1)} g` : "—"],
  ]);

  const updatedClock = daily.updatedAt ? clock.format(new Date(daily.updatedAt)) : "";
  return `<div class="dialog-form apple-workout apple-daily-dossier">
    <div class="report-meta">
      <time datetime="${esc(daily.date)}">${esc(daily.date)}</time>
      <span>Apple 健康${updatedClock ? " · " + esc(updatedClock) : ""}</span>
    </div>
    ${sleepBlock}
    ${bodyBlock ? `<section class="apple-dossier-section"><header><strong>身体成分</strong></header>${bodyBlock}</section>` : ""}
    ${activityBlock ? `<section class="apple-dossier-section"><header><strong>日常活动与消耗</strong></header>${activityBlock}</section>` : ""}
    ${vitalsBlock ? `<section class="apple-dossier-section"><header><strong>心肺与恢复体征</strong></header>${vitalsBlock}</section>` : ""}
    ${nutritionBlock ? `<section class="apple-dossier-section"><header><strong>饮水与膳食快照</strong></header>${nutritionBlock}</section>` : ""}
  </div>`;
}

export function appleWorkoutDetails(item, back = false) {
  const annotation = item.annotation;
  const sessionNotes = annotation ? [
    annotation.notes,
    annotation.feeling ? `体感 · ${({ easy: "轻松", balanced: "均衡", fatigued: "疲惫" })[annotation.feeling] || ""}` : "",
    annotation.distanceKm ? `手记距离 · ${annotation.distanceKm} km` : "",
    annotation.lapSeconds.length ? `分段 · ${annotation.lapSeconds.map((seconds) => `${fmt(seconds, 0)} 秒`).join(" / ")}` : "",
  ].filter(Boolean) : [];
  const measures = [
    [item.durationKind === "event_elapsed" ? "开始至结束间隔" : "训练时长", duration(item.durationSeconds)],
    [item.energyKind === "window_estimate" ? "活动能量（估算）" : "活动能量", item.activeEnergyKcal == null ? "—" : fmt(item.activeEnergyKcal) + " kcal"],
    ["训练距离", item.distanceMeters == null ? "—" : fmt(item.distanceMeters / 1000, 2) + " km"],
    ["平均心率", item.heartRate?.avgBpm == null ? "—" : fmt(item.heartRate.avgBpm, 0) + " bpm"],
  ];
  return `<div class="dialog-form apple-workout"><div class="report-meta"><time datetime="${item.startedAt}">${item.date} · ${clock.format(new Date(item.startedAt))}–${clock.format(new Date(item.endedAt))}</time>
    <span>运动类型 <strong>${esc(item.title)}</strong></span></div>
    ${item.plan ? `<div class="apple-plan-result">${icon("check", 17)}<div><strong>${esc(item.plan.name)}</strong><small>计划已完成</small></div></div>` : ""}
    <div class="health-metrics apple-telemetry">${measures.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>
    ${sessionNotes.length ? `<section class="report-notes"><h3>训练记录</h3>${sessionNotes.map((note) => `<p>${esc(note)}</p>`).join("")}</section>` : ""}
    ${item.manualWorkoutId ? `<footer><button type="button" class="secondary-button" data-action="workout-detail" data-value="${esc(item.manualWorkoutId)}">${back ? "返回训练复盘" : "查看关联训练"}</button></footer>` : ""}
  </div>`;
}

function triggerShortcutDownload(filename, xml) {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  Object.assign(link, { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function syncOriginWarning(value, target, assessServerOrigin) {
  if (!target) return { valid: false, warning: "" };
  const check = assessServerOrigin(value);
  target.textContent = check.valid ? check.warning : "";
  target.hidden = !check.valid || !check.warning;
  return check;
}

function deviceCacheKey(userId) {
  return `ironlog.appleDevice.${userId || "default"}`;
}

function readCachedDevice(userId) {
  try {
    const raw = localStorage.getItem(deviceCacheKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedDevice(userId, value) {
  try {
    localStorage.setItem(deviceCacheKey(userId), JSON.stringify(value));
  } catch {}
}

/**
 * Two-step Apple Health setup modal: reuses an existing account-bound device token when
 * available (so tokens stay stable across reloads/restarts), or issues a new one and lets
 * the user download pre-configured `.shortcut` files plus copy the macOS signing command.
 */
export async function openDeviceSetupDialog({ api, open, notify, refresh, userId }) {
  const [shortcutGen, cachedDevices] = await Promise.all([
    loadShortcutGen(),
    (async () => {
      const candidate = readCachedDevice(userId);
      if (!candidate?.id || !candidate?.token) return null;
      try {
        const devices = await api("/api/integrations/apple-health/tokens");
        return Array.isArray(devices) && devices.some((item) => item.id === candidate.id) ? candidate : null;
      } catch {
        return null;
      }
    })(),
  ]);
  const { assessServerOrigin } = shortcutGen;
  const cached = cachedDevices;

  const reuseHtml = cached
    ? `<div class="shortcut-card" style="margin-bottom:4px">
        <div class="shortcut-card-head"><span class="shortcut-tag">BOUND</span><strong>${esc(cached.label || "已绑定设备")}</strong></div>
        <small>此上传令牌已与账号持久绑定（服务重启也不变）。可直接沿用原令牌继续导出或增补快捷指令：</small>
        <button type="button" class="primary-button" data-reuse-device>${icon("download", 16)} 使用当前绑定令牌导出快捷指令</button>
      </div>`
    : "";

  open("添加设备并生成快捷指令", `<form id="device-form" class="dialog-form shortcut-modal">
    ${reuseHtml}
    <p class="muted">${cached ? "如需再绑定一台新手机/设备，可另建设备令牌：" : "签发设备令牌后（与账号持久绑定，重启不变），直接导出预填网址、授权头、日期格式与 JSON 的快捷指令，在 Mac 终端一行命令签名即可导入 iPhone。"}</p>
    ${field("设备名称", input("label", "我的 iPhone", 'maxlength="80" required'))}
    ${field("铁记服务器地址", input("serverOrigin", cached?.origin || location.origin, 'type="url" placeholder="https://ironlog.example.com" required'))}
    <p class="shortcut-warn" id="device-origin-warning" hidden></p>
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot"><button class="${cached ? "secondary-button" : "primary-button"}">${cached ? "额外新建设备令牌并导出" : "生成令牌并导出快捷指令"}</button></footer></form>`);

  const form = $("#device-form");
  const originInput = $('[name="serverOrigin"]', form);
  const originWarning = $("#device-origin-warning", form);
  syncOriginWarning(originInput.value, originWarning, assessServerOrigin);
  originInput.addEventListener("input", () => syncOriginWarning(originInput.value, originWarning, assessServerOrigin));

  const reuseBtn = $("[data-reuse-device]", form);
  if (reuseBtn && cached) {
    reuseBtn.addEventListener("click", () => {
      const check = assessServerOrigin(originInput.value);
      const nextOrigin = check.valid ? check.normalized : (cached.origin || location.origin);
      writeCachedDevice(userId, { ...cached, origin: nextOrigin });
      openExportStep({ token: cached.token, label: cached.label, initialOrigin: nextOrigin, open, notify, shortcutGen });
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"], footer button', form);
    const errorEl = $(".form-error", form);
    errorEl.hidden = true;
    const formData = new FormData(form);
    const check = assessServerOrigin(formData.get("serverOrigin"));
    if (!check.valid) {
      errorEl.textContent = check.warning;
      errorEl.hidden = false;
      return;
    }
    button.disabled = true;
    try {
      const label = String(formData.get("label") ?? "").trim() || "我的 iPhone";
      const device = await api("/api/integrations/apple-health/tokens", { method: "POST", body: { label } });
      writeCachedDevice(userId, { id: device.id, label, token: device.token, origin: check.normalized });
      await refresh();
      openExportStep({ token: device.token, label, initialOrigin: check.normalized, open, notify, shortcutGen });
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function openExportStep({ token, label, initialOrigin, open, notify, shortcutGen }) {
  const {
    APPLE_HEALTH_AUTO_METRICS,
    APPLE_HEALTH_DAILY_GROUPS,
    APPLE_HEALTH_DEFAULT_METRICS,
    APPLE_HEALTH_WATCH_METRICS,
    APPLE_SHORTCUT_ENVIRONMENTS,
    APPLE_SHORTCUT_RECENT_WINDOWS,
    APPLE_SHORTCUT_SPORTS,
    assessServerOrigin,
    buildIronlogDailyHealthShortcut,
    buildIronlogEventShortcut,
    buildIronlogRecentWorkoutShortcut,
    buildMacSignCommand,
  } = shortcutGen;
  const sportMap = Object.fromEntries(APPLE_SHORTCUT_SPORTS.map((item) => [item.activityType, item.label]));
  const defaultSport = APPLE_SHORTCUT_SPORTS[0];
  const macCommand = buildMacSignCommand();
  const defaultMetricSet = new Set(APPLE_HEALTH_DEFAULT_METRICS);

  const dailyCheckboxes = APPLE_HEALTH_DAILY_GROUPS.map((group) => {
    const chips = group.metrics.map((metric) =>
      `<label class="shortcut-pill">
        <input type="checkbox" name="dailyMetric" value="${esc(metric.key)}"${defaultMetricSet.has(metric.key) ? " checked" : ""}>
        <span>${esc(metric.typeLabel)}</span>${metric.emptyHint ? `<small class="shortcut-pill-hint">${esc(metric.emptyHint)}</small>` : ""}
      </label>`).join("");
    return `<div class="shortcut-metric-group">
      <div class="shortcut-metric-head"><b>${esc(group.label)}</b><small>${esc(group.description)}</small></div>
      <div class="shortcut-pill-grid">${chips}</div>
    </div>`;
  }).join("");

  open("导出 Apple 健康快捷指令", `<div class="dialog-form shortcut-modal" id="shortcut-export">
    <p class="muted">令牌已自动写入快捷指令。每日健康同步读取今天和前两天，按采样日期保存；单场训练可单独上传。</p>
    ${field("铁记服务器地址", input("shortcutOrigin", initialOrigin, 'type="url" placeholder="https://ironlog.example.com" required'))}
    <p class="shortcut-warn" id="export-origin-warning" hidden></p>

    <section class="shortcut-daily-box">
      <div class="shortcut-card-head">
        <span class="shortcut-tag">DAILY SYNC</span>
        <strong>铁记-每日全量健康同步.shortcut</strong>
      </div>
      <p class="muted">⚠️ iOS 只要遇到某项在「健康」里查到 <b>0 条记录</b>或未授权，就会弹出<b>「未找到样本」</b>（如未手动录过的腰围/饮水/膳食营养、未支持血氧、或<b>凌晨 0 点刚过</b>尚未写入今日的静息能量）。推荐点下方<b>「自动体征全项 (14项)」</b>，并在 iPhone <b>健康 App → 头像 → 隐私 → App → 快捷指令</b> 打开对应开关。</p>
      <div class="shortcut-preset-row">
        <button type="button" class="secondary-button shortcut-preset-btn" data-daily-preset="default">基础防弹窗 (4项)</button>
        <button type="button" class="secondary-button shortcut-preset-btn" data-daily-preset="watch">Watch 日常 (8项)</button>
        <button type="button" class="secondary-button shortcut-preset-btn" data-daily-preset="auto">自动体征全项 (14项)</button>
        <button type="button" class="secondary-button shortcut-preset-btn" data-daily-preset="all">全选全部 (22项)</button>
      </div>
      <div class="shortcut-check-grid">${dailyCheckboxes}</div>
      <button type="button" class="primary-button" data-daily-download>${icon("download", 16)} 下载每日健康同步（已选 <span data-daily-count>${APPLE_HEALTH_DEFAULT_METRICS.length}</span> 项）</button>
    </section>

    <details class="training-details" open><summary><span>单场训练自动同步（全运动类型 · 热量 / 心率 / 距离）</span>${icon("chevron", 14)}</summary>
      <div class="details-body">
        ${field("触发方式", `<select name="workoutSyncMode">
          <option value="recent" selected>单条全自动直传（只需绑定结束时 · 免配开始）</option>
          <option value="pair">开始 + 结束双条配对（精确计算训练时长）</option>
        </select>`)}
        <div class="shortcut-config-grid">
          ${field("运动类型", `<select name="shortcutActivity">${options(sportMap, defaultSport.activityType)}</select>`)}
          ${field("运动环境", `<select name="shortcutEnv">${options(APPLE_SHORTCUT_ENVIRONMENTS, defaultSport.defaultEnvironment)}</select>`)}
        </div>
        <div data-workout-mode-panel="recent">
          ${field("自动回溯窗口时长", `<select name="recentWindowMinutes">${options(APPLE_SHORTCUT_RECENT_WINDOWS, "45")}</select>`)}
          <div class="shortcut-card">
            <div class="shortcut-card-head"><span class="shortcut-tag">AUTO POST</span><strong data-shortcut-file="recent"></strong></div>
            <small>手表结束训练 5 秒后，自动拉取最近窗口内的活动能量、心率均值/峰值${defaultSport ? "及对应距离" : ""}并直接写入铁记。</small>
            <button type="button" class="primary-button" data-shortcut-recent-download>${icon("download", 16)} 下载结束直传快捷指令 (.shortcut)</button>
          </div>
        </div>
        <div data-workout-mode-panel="pair" hidden>
          <div class="shortcut-pair">
            <div class="shortcut-card">
              <div class="shortcut-card-head"><span class="shortcut-tag">START</span><strong data-shortcut-file="start"></strong></div>
              <small>开练时上报 event: "start"</small>
              <button type="button" class="secondary-button" data-shortcut-download="start">${icon("download", 16)} 下载开始</button>
            </div>
            <div class="shortcut-card">
              <div class="shortcut-card-head"><span class="shortcut-tag">END</span><strong data-shortcut-file="end"></strong></div>
              <small>结束时自动计算时长、匹配今日计划，并抓热量/心率/距离</small>
              <button type="button" class="secondary-button" data-shortcut-download="end">${icon("download", 16)} 下载结束</button>
            </div>
          </div>
        </div>
      </div>
    </details>

    <p class="form-error" id="shortcut-export-error" role="alert" hidden></p>
    <div class="shortcut-mac-box">
      <div class="shortcut-mac-head">
        <strong>Mac 终端一行签名命令（同时签名以上全部 .shortcut）</strong>
        <button type="button" class="quiet" data-copy-mac>${icon("copy", 15)} 复制命令</button>
      </div>
      <pre class="shortcut-code"><code>${esc(macCommand)}</code></pre>
      <ol class="shortcut-steps">
        <li>下载需要的 <code>.shortcut</code> 文件到 Mac「下载」文件夹；</li>
        <li>打开 Mac「<b>终端</b>」粘贴上方命令回车，将自动生成并打开 <code>ironlog-signed</code> 目录；</li>
        <li>把已签名的文件 <b>AirDrop 到 iPhone</b> 并添加（<b>每日全量健康同步须在 iPhone 运行</b>，Mac 无健康数据库；若个别指标因 iOS 版本译名微调显示未选，在手机端轻点该蓝色标签重选一次即可）；</li>
        <li>绑定自动化：<b>每日全量同步</b>建议设为每天 <b>23:30 睡前亮屏时段 / 充电时</b>「立即运行」（防锁屏读健康受限）；<b>开始 / 结束训练</b>绑到 Apple Watch 体能训练对应触发器。</li>
      </ol>
    </div>
    <details class="training-details"><summary><span>备用明文令牌（${esc(label)}）</span>${icon("chevron", 14)}</summary>
      <div class="details-body">
        <p class="muted">若需自行微调快捷指令请求头，Authorization 填 <code>Bearer &lt;令牌&gt;</code>。</p>
        ${field("上传令牌", input("issued", token, "readonly"))}
        <div class="details-actions"><button type="button" class="secondary-button" data-copy-issued>${icon("copy", 15)} 复制令牌</button></div>
      </div>
    </details>
  </div>`);

  const root = $("#shortcut-export");
  const originEl = $('[name="shortcutOrigin"]', root);
  const modeEl = $('[name="workoutSyncMode"]', root);
  const activityEl = $('[name="shortcutActivity"]', root);
  const envEl = $('[name="shortcutEnv"]', root);
  const windowEl = $('[name="recentWindowMinutes"]', root);
  const recentPanel = $('[data-workout-mode-panel="recent"]', root);
  const pairPanel = $('[data-workout-mode-panel="pair"]', root);
  const originWarnEl = $("#export-origin-warning", root);
  const errorEl = $("#shortcut-export-error", root);

  function updateLabels() {
    const sport = APPLE_SHORTCUT_SPORTS.find((item) => item.activityType === activityEl.value);
    const labelText = sport?.label ?? activityEl.value;
    $('[data-shortcut-file="recent"]', root).textContent = `铁记-结束直传-${labelText}.shortcut`;
    $('[data-shortcut-file="start"]', root).textContent = `铁记-开始-${labelText}.shortcut`;
    $('[data-shortcut-file="end"]', root).textContent = `铁记-结束-${labelText}.shortcut`;
    const isPair = modeEl.value === "pair";
    recentPanel.hidden = isPair;
    pairPanel.hidden = !isPair;
    syncOriginWarning(originEl.value, originWarnEl, assessServerOrigin);
  }
  updateLabels();
  originEl.addEventListener("input", () => { errorEl.hidden = true; updateLabels(); });
  modeEl.addEventListener("change", updateLabels);
  activityEl.addEventListener("change", () => {
    const sport = APPLE_SHORTCUT_SPORTS.find((item) => item.activityType === activityEl.value);
    if (sport) envEl.value = sport.defaultEnvironment;
    updateLabels();
  });

  const updateDailyCount = () => {
    const countEl = $("[data-daily-count]", root);
    if (countEl) countEl.textContent = String(root.querySelectorAll('input[name="dailyMetric"]:checked').length);
  };
  root.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "dailyMetric") updateDailyCount();
  });

  root.addEventListener("click", async ({ target }) => {
    const presetBtn = target.closest("[data-daily-preset]");
    if (presetBtn) {
      const presetMap = {
        default: APPLE_HEALTH_DEFAULT_METRICS,
        watch: APPLE_HEALTH_WATCH_METRICS,
        auto: APPLE_HEALTH_AUTO_METRICS,
      };
      const presetList = presetMap[presetBtn.dataset.dailyPreset];
      const allow = presetList ? new Set(presetList) : null;
      for (const box of root.querySelectorAll('input[name="dailyMetric"]')) {
        box.checked = allow === null || allow.has(box.value);
      }
      updateDailyCount();
      return;
    }

    const dailyBtn = target.closest("[data-daily-download]");
    if (dailyBtn) {
      errorEl.hidden = true;
      try {
        const metrics = [...root.querySelectorAll('input[name="dailyMetric"]:checked')].map((el) => el.value);
        const built = buildIronlogDailyHealthShortcut({
          serverOrigin: originEl.value,
          token,
          metrics,
        });
        triggerShortcutDownload(built.filename, built.xml);
        notify(`已导出 ${built.filename}（含 ${built.metricCount} 项健康指标）`);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
      return;
    }

    const recentBtn = target.closest("[data-shortcut-recent-download]");
    if (recentBtn) {
      errorEl.hidden = true;
      try {
        const built = buildIronlogRecentWorkoutShortcut({
          serverOrigin: originEl.value,
          token,
          activityType: activityEl.value,
          environment: envEl.value,
          windowMinutes: Number(windowEl.value),
        });
        triggerShortcutDownload(built.filename, built.xml);
        notify(`已导出 ${built.filename}`);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
      return;
    }

    const downloadBtn = target.closest("[data-shortcut-download]");
    if (downloadBtn) {
      errorEl.hidden = true;
      try {
        const built = buildIronlogEventShortcut({
          event: downloadBtn.dataset.shortcutDownload,
          serverOrigin: originEl.value,
          token,
          activityType: activityEl.value,
          environment: envEl.value,
        });
        triggerShortcutDownload(built.filename, built.xml);
        notify(`已导出 ${built.filename}`);
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
      return;
    }
    if (target.closest("[data-copy-mac]")) {
      if (await copyText(macCommand)) notify("Mac 签名命令已复制");
      else notify("无法自动复制，请长按上方命令框复制");
      return;
    }
    if (target.closest("[data-copy-issued]")) {
      if (await copyText(token)) notify("上传令牌已复制");
      else { $('[name="issued"]', root)?.select(); notify("请长按已选中的令牌复制"); }
    }
  });
}
