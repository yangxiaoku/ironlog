import { $, $$, esc, today, icon, field, input, inputGroup, switchField, options, segments, equipment, panelNames } from "./ui.js";

/**
 * Render and wire all Settings workspace sections (statistics, profile/equipment,
 * Apple Health devices, AI settings card, account password, MCP API tokens, CSV/JSON export & backup).
 */
export function renderSettingsPanels({
  content,
  heading,
  settingsSections,
  intervals,
  preferences,
  profile,
  devices,
  aiStatus,
  aiSettingsCard,
  apiTokens = [],
  state,
  api,
  notify,
  centerActivePills,
}) {
  const goal = profile.profile;
  const choice = new Set(preferences.panels);
  const primaryOverviewPanels = new Set(["load", "muscle", "strength", "weight"]);
  let order = [...preferences.panels, ...Object.keys(panelNames).filter((id) => !choice.has(id))];

  function drawRows() {
    const visibleOrder = state.appleHealthConnected ? order : order.filter((id) => id !== "apple");
    $("#panel-options").innerHTML = visibleOrder.map((id, position) => `<div class="panel-option-row"><label class="toggle-inline"><input class="switch" type="checkbox" name="panel" value="${id}"${choice.has(id) ? " checked" : ""}><span>${panelNames[id]}</span><em class="panel-slot-tag">${primaryOverviewPanels.has(id) ? "首页主区" : "更多数据"}</em></label>
      <div class="panel-option-order"><button type="button" class="icon-button" data-reorder="-1" data-panel="${id}" aria-label="上移${panelNames[id]}"${position === 0 ? " disabled" : ""}>${icon("arrowUp", 16)}</button>
      <button type="button" class="icon-button" data-reorder="1" data-panel="${id}" aria-label="下移${panelNames[id]}"${position === visibleOrder.length - 1 ? " disabled" : ""}>${icon("arrowDown", 16)}</button></div></div>`).join("");
  }

  const info = goal.energyProfile;
  const goalFields = (fields) => fields.map(([key, label, unit, min, max]) => {
    const attrs = `type="number" inputmode="${["daysPerWeek", "restSeconds"].includes(key) ? "numeric" : "decimal"}" min="${min}" max="${max}" step="${["daysPerWeek", "restSeconds"].includes(key) ? 1 : "any"}" ${key === "targetWeight" ? "" : "required"}`;
    return field(label, unit ? inputGroup(key, goal[key], unit, attrs) : input(key, goal[key], attrs));
  }).join("");
  const section = (id) => `data-section="${id}"${state.settingsSection === id ? "" : " hidden"}`;
  const persistentTokens = (apiTokens ?? []).filter((t) => !t.expiresAt);

  content.innerHTML = heading("设置") + `<div class="settings-layout">
  <div class="page-sections settings-sections" role="group" aria-label="设置分类">${segments(settingsSections, state.settingsSection, "settings-section")}</div>
  <div class="settings-content">
  <section class="panel" ${section("statistics")}><header class="panel-head"><h2>统计布局与口径</h2></header><form id="preferences-form" class="settings-form">
    ${field("默认统计周期", `<select name="days">${options(intervals, preferences.days)}</select>`)}
    ${switchField("warmups", "热身组计入完成组数与容量", preferences.includeWarmups, "最高重量与估算 1RM 仍只统计工作组")}
    <section class="form-section"><h3 class="form-section-title">显示卡片与顺序</h3><p class="muted panel-order-hint">主区 4 张核心图卡常驻首页，其余已启用卡片收进首页底部「更多数据」折叠区。</p><div id="panel-options" class="panel-options"></div></section>
    <p class="form-error" role="alert" hidden></p><footer class="form-foot"><button class="primary-button">保存设置</button></footer></form></section>
  <section class="panel" ${section("profile")}><header class="panel-head"><h2>训练与饮食目标</h2></header><form id="profile-form" class="settings-form">
    <section class="form-section"><h3 class="form-section-title">饮食目标</h3><div class="fields">${goalFields([["calories", "每日热量", "kcal", 1, 20000], ["protein", "每日蛋白质", "g", 0, 100000], ["carbs", "每日碳水", "g", 0, 100000], ["fat", "每日脂肪", "g", 0, 100000]])}</div></section>
    <section class="form-section"><h3 class="form-section-title">训练与体重</h3><div class="fields">${goalFields([["daysPerWeek", "每周训练", "天", 1, 7], ["restSeconds", "默认休息", "秒", 0, 900], ["targetWeight", "目标体重", "kg", 1, 500]])}</div></section>
    <section class="form-section"><h3 class="form-section-title">我的训练器械</h3><p class="muted panel-order-hint">保存后，训练编辑器的「我的器械」筛选会自动优先展示匹配的动作。</p>
      <div class="equip-presets">
        <button type="button" class="quiet" data-equip-preset="gym">商业健身房</button>
        <button type="button" class="quiet" data-equip-preset="home">居家哑铃</button>
        <button type="button" class="quiet" data-equip-preset="bodyweight">徒手街头</button>
      </div>
      <div class="equip-check-grid">${["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band", "weighted"].map((eqKey) => {
        const activeEq = (goal.equipment ?? ["barbell", "dumbbell", "machine"]).includes(eqKey);
        return `<label class="equip-check-pill"><input type="checkbox" name="equipment" value="${eqKey}"${activeEq ? " checked" : ""}><span>${esc(equipment[eqKey] ?? eqKey)}</span></label>`;
      }).join("")}</div>
    </section>
    <details class="energy-details"${info ? " open" : ""}><summary><span>能量估算资料</span>${icon("chevron", 14)}</summary>
    <div class="details-body">
    ${switchField("energy", "启用能量估算", !!info)}
    <fieldset class="form-fieldset" id="energy-fields"${info ? "" : " disabled"}><div class="fields">
    ${field("身高", inputGroup("heightCm", info?.heightCm, "cm", 'type="number" inputmode="decimal" min="50" max="250" step="0.1" required'))}
    ${field("参考体重", inputGroup("weightKg", info?.weightKg, "kg", 'type="number" inputmode="decimal" min="1" max="500" step="0.01" required'))}
    ${field("测量日期", input("weightDate", info?.weightDate, `type="date" max="${today()}" required`))}
    ${field("出生日期", input("birthDate", info?.birthDate, `type="date" max="${today()}" required`))}
    ${field("性别", `<select name="sex">${options({ male: "男", female: "女" }, info?.sex ?? "male")}</select>`)}
    ${field("活动系数", input("activityFactor", info?.activityFactor ?? 1.55, 'type="number" inputmode="decimal" step="0.01" min="1.4" max="2.5" required'))}
    ${field("生理状态", `<select name="context">${options({ general: "一般成人", pregnant: "妊娠期", breastfeeding: "哺乳期" }, info?.context ?? "general")}</select>`)}</div></fieldset></div></details>
    <p class="form-error" role="alert" hidden></p><footer class="form-foot"><button class="primary-button">保存目标</button></footer></form></section>
  <section class="panel" ${section("devices")}><header class="panel-head"><h2>Apple 健康</h2></header>
    <div class="settings-form">
      ${!state.appleHealthConnected ? `<div class="apple-optin-banner"><strong>暂未对接 Apple 健康</strong><small>没有 Apple Watch 也能完整使用铁记，首页、数据分析、日历与徽章中的苹果健康模块已自动为你隐藏。日后如需同步，在下方导入数据或生成快捷指令即可自动开启。</small></div>` : ""}
      <section class="form-section"><h3>Health Data Export</h3>
        <p class="muted">导入已有体能训练，或连接 iPhone 定时同步。</p>
        <div class="health-import-actions">
          <button type="button" class="primary-button" data-action="import-health-data">导入训练 JSON</button>
          <button type="button" class="secondary-button" data-action="connect-health-export">设置自动同步</button>
        </div>
      </section>
      <section class="form-section"><h3>Apple 快捷指令（全量健康 + 训练打卡）</h3>
        <p class="muted">支持一键导出「每日全量健康同步（睡眠分期、体脂、体重、步数、静息心率、HRV、血氧等）」与「单场训练打卡」快捷指令（配合 Mac 一行签名即可用）。</p>
        <p class="device-endpoint"><code>${esc(location.origin)}/api/integrations/apple-health/daily</code></p>
        <p class="device-endpoint"><code>${esc(location.origin)}/api/integrations/apple-health/events</code></p>
        <button type="button" class="secondary-button" data-action="issue-device">${icon("plus")} 生成上传快捷指令</button>
      </section>
      <section class="form-section"><h3>上传设备</h3>
        ${devices.length ? `<ul class="device-list">${devices.map((device) => `<li><span><strong>${esc(device.label)}</strong><small>${esc(device.expiresAt.slice(0, 10))} 到期</small></span>
          <button type="button" class="quiet" data-action="revoke-device" data-value="${esc(device.id)}">撤销</button></li>`).join("")}</ul>` : "<p class='muted'>暂未添加设备。</p>"}
      </section>
    </div>
  </section>
  ${aiSettingsCard(aiStatus, section("ai"))}
  <section class="panel" ${section("account")}><header class="panel-head"><h2>账号与数据</h2></header><p class="muted">${state.demo ? "当前为演示模式，修改仅保留在本次会话。" : state.username ? `用户名 ${esc(state.username)}` : "已登录铁记"}</p>
    ${!state.demo && state.username ? `<section class="form-section">
      <h3>登录安全 · 修改密码</h3>
      <p class="muted">密码需为 10–128 位英文字母或数字。修改后其他设备的旧登录会话将自动失效。</p>
      <form id="password-change-form" class="settings-form">
        <div class="fields">
          ${field("当前密码", '<input type="password" name="currentPassword" autocomplete="current-password" minlength="1" maxlength="128" required placeholder="输入当前登录密码">')}
          ${field("新密码", '<input type="password" name="newPassword" autocomplete="new-password" minlength="10" maxlength="128" pattern="[A-Za-z0-9]{10,128}" required placeholder="至少 10 位字母或数字">')}
          ${field("确认新密码", '<input type="password" name="confirmPassword" autocomplete="new-password" minlength="10" maxlength="128" pattern="[A-Za-z0-9]{10,128}" required placeholder="再次输入新密码">')}
        </div>
        <p class="form-error" role="alert" hidden></p>
        <footer class="form-foot"><button type="submit" class="secondary-button">更新登录密码</button></footer>
      </form>
    </section>` : ""}
    <section class="form-section api-tokens-section">
      <h3>MCP 与 API 访问令牌</h3>
      <p class="muted">用于连接 Claude Desktop / Cursor MCP 服务（<code>IRONLOG_TOKEN</code>）或脚本调用 REST API。令牌仅在生成时完整展示一次。</p>
      <div class="health-import-actions">
        <button type="button" class="secondary-button" data-action="issue-api-token">${icon("plus", 14)} 生成 MCP / API 令牌</button>
      </div>
      ${persistentTokens.length ? `<ul class="device-list">${persistentTokens.map((tok) => `<li><span><strong>${esc(tok.label)}</strong><small>创建于 ${esc((tok.createdAt ?? "").slice(0, 10))} · 永久有效</small></span>
        <button type="button" class="quiet" data-action="revoke-api-token" data-value="${esc(tok.id)}">撤销</button></li>`).join("")}</ul>` : "<p class='muted'>暂未生成 MCP / API 访问令牌。</p>"}
    </section>
    <section class="form-section csv-export-section">
      <h3>表格导出（Excel UTF-8 CSV）</h3>
      <p class="muted">直接用 Excel 或 WPS 打开不会乱码，也可作为原始分析数据留档。</p>
      <div class="csv-export-grid">
        <button type="button" class="secondary-button" data-action="export-csv" data-value="workouts">${icon("download", 14)} 训练记录 CSV</button>
        <button type="button" class="secondary-button" data-action="export-csv" data-value="diet">${icon("download", 14)} 饮食记录 CSV</button>
        <button type="button" class="secondary-button" data-action="export-csv" data-value="weight">${icon("download", 14)} 体重记录 CSV</button>
        <button type="button" class="secondary-button" data-action="export-csv" data-value="measurements">${icon("download", 14)} 身体围度 CSV</button>
      </div>
    </section>
    <footer class="form-foot"><button class="secondary-button" data-action="open-onboarding" type="button">${icon("book", 14)} 查看新手入门指南</button><button class="secondary-button" data-action="open-csv-import" type="button">${icon("upload", 14)} 导入历史 CSV</button><button class="secondary-button" data-action="export" type="button">${icon("download", 14)} 导出全量 JSON</button><button class="secondary-button" data-action="open-backup-restore" type="button">${icon("upload", 14)} 恢复全量 JSON</button><button class="quiet" data-action="logout" type="button">退出账号</button></footer></section></div></div>`;

  drawRows();
  $("#panel-options").addEventListener("change", ({ target }) => {
    const inputEl = /** @type {HTMLInputElement} */ (target);
    if (inputEl.checked) choice.add(inputEl.value); else choice.delete(inputEl.value);
  });
  $("#panel-options").addEventListener("click", ({ target }) => {
    const button = /** @type {HTMLButtonElement | null} */ (/** @type {Element} */ (target).closest("[data-reorder]"));
    if (!button) return;
    const visibleOrder = state.appleHealthConnected ? order : order.filter((id) => id !== "apple");
    const position = visibleOrder.indexOf(button.dataset.panel);
    const next = position + Number(button.dataset.reorder);
    if (position < 0 || next < 0 || next >= visibleOrder.length) return;
    [visibleOrder[position], visibleOrder[next]] = [visibleOrder[next], visibleOrder[position]];
    order = state.appleHealthConnected ? visibleOrder : [...visibleOrder, ...(order.includes("apple") ? ["apple"] : [])];
    drawRows();
    const replacement = /** @type {HTMLButtonElement | null} */ ($(`[data-reorder="${button.dataset.reorder}"][data-panel="${button.dataset.panel}"]`));
    const focusTarget = /** @type {HTMLElement | null} */ (replacement?.disabled ? $(`[data-panel="${button.dataset.panel}"]:not(:disabled)`) : replacement);
    focusTarget?.focus();
  });

  function submitForm(id, save) {
    $(id).addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = /** @type {HTMLFormElement} */ (event.currentTarget);
      const button = /** @type {HTMLButtonElement} */ ($("footer button", form));
      const error = /** @type {HTMLElement} */ ($(".form-error", form));
      button.disabled = true;
      error.hidden = true;
      try { await save(new FormData(form)); }
      catch (problem) { error.textContent = problem.message; error.hidden = false; }
      finally { button.disabled = false; }
    });
  }

  submitForm("#preferences-form", async (form) => {
    const panels = order.filter((id) => choice.has(id));
    if (!panels.length) throw new Error("至少保留一张统计卡片。");
    state.preferences = await api("/api/web/preferences", {
      method: "PUT",
      body: {
        revision: state.preferences.revision,
        days: Number(form.get("days")),
        includeWarmups: form.has("warmups"),
        panels,
      },
    });
    state.period = null;
    notify("统计设置已保存");
  });

  $('[name="energy"]').addEventListener("change", ({ target }) => {
    const fieldSet = /** @type {HTMLFieldSetElement} */ ($("#energy-fields"));
    fieldSet.disabled = !(/** @type {HTMLInputElement} */ (target)).checked;
  });

  const equipPresetMap = {
    gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
    home: ["dumbbell", "bodyweight", "band"],
    bodyweight: ["bodyweight"],
  };
  $("#profile-form").addEventListener("click", ({ target }) => {
    const presetBtn = /** @type {HTMLElement | null} */ (/** @type {Element} */ (target).closest("[data-equip-preset]"));
    if (!presetBtn) return;
    const chosen = new Set(equipPresetMap[presetBtn.dataset.equipPreset] ?? []);
    $$('#profile-form input[name="equipment"]').forEach((box) => {
      const checkEl = /** @type {HTMLInputElement} */ (box);
      checkEl.checked = chosen.has(checkEl.value);
    });
  });

  let profileVersion = profile.version;
  submitForm("#profile-form", async (form) => {
    const body = /** @type {Record<string, any>} */ (
      Object.fromEntries(["calories", "protein", "carbs", "fat", "daysPerWeek", "restSeconds"].map((name) => [name, Number(form.get(name))]))
    );
    body.targetWeight = form.get("targetWeight") ? Number(form.get("targetWeight")) : null;
    body.equipment = form.getAll("equipment");
    body.energyProfile = form.has("energy") ? {
      heightCm: Number(form.get("heightCm")),
      weightKg: Number(form.get("weightKg")),
      weightDate: form.get("weightDate"),
      birthDate: form.get("birthDate"),
      sex: form.get("sex"),
      context: form.get("context"),
      activityFactor: Number(form.get("activityFactor")),
    } : null;
    const updated = await api("/api/web/profile", { method: "PUT", body: { ...body, version: profileVersion, opId: crypto.randomUUID() } });
    profileVersion = updated.version;
    state.userEquipment = updated.profile.equipment ?? [];
    if (state.data) state.data.goals = updated.profile;
    notify("目标与器械配置已保存");
  });

  if ($("#password-change-form")) {
    submitForm("#password-change-form", async (form) => {
      const currentPassword = String(form.get("currentPassword") ?? "");
      const newPassword = String(form.get("newPassword") ?? "");
      const confirmPassword = String(form.get("confirmPassword") ?? "");
      if (newPassword !== confirmPassword) throw new Error("两次输入的新密码不一致");
      if (newPassword.length < 10 || /[^A-Za-z0-9]/.test(newPassword)) {
        throw new Error("新密码需为 10–128 位英文字母和数字");
      }
      await api("/api/web/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      /** @type {HTMLFormElement | null} */ ($("#password-change-form"))?.reset();
      notify("登录密码已更新");
    });
  }
  requestAnimationFrame(() => centerActivePills(content, false));
}
