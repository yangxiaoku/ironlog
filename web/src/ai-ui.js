import { $, $$, copyText, esc, fmt, today, icon, field, input, inputGroup, options, meals, segments } from "./ui.js";

function escapeAndFormatLines(text) {
  return esc(text)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function unconfiguredNotice(status) {
  return `<div class="dialog-form ai-modal">
    <div class="ai-status-card is-off">
      <span class="ai-status-badge"><i aria-hidden="true"></i>未配置模型参数</span>
      <p>铁记 AI 能力（自然语言记饮食、记训练、AI 计划、周期复盘、训中调整）由后端统一安全转发，密钥不会下发到浏览器。</p>
    </div>
    <section class="ai-setup-box">
      <h3>服务端配置方式（.env）</h3>
      <p class="muted">在项目根目录的 <code>.env</code> 中配置任意 OpenAI 兼容接口并重启服务：</p>
      <pre class="ai-code">AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_API_KEY=你的密钥</pre>
    </section>
    <footer class="dialog-foot">
      ${status ? `<button type="button" class="secondary-button" data-action="settings-open" data-value="ai">前往 AI 状态</button>` : ""}
      <button type="button" class="primary-button" data-action="close">知道了</button>
    </footer>
  </div>`;
}

function modePill(status) {
  if (!status?.ready) return '<span class="ai-pill is-off">未配置</span>';
  if (status.mode === "demo") return '<span class="ai-pill is-demo">演示模拟</span>';
  return `<span class="ai-pill is-ready">已连接 · ${esc(status.model ?? "")}</span>`;
}

export function openAiReview({ api, dialog, open, notify, status }) {
  if (!status?.ready) { open("AI 训练复盘", unconfiguredNotice(status)); return; }
  const presets = [
    "综合近 30 天的训练、饮食和体重数据，指出做得好的地方和下一步改进建议。",
    "分析我最近的力量进步与肌群分配是否均衡，哪些部位需要加强？",
    "结合我当前的能量估算和饮食达标情况，给出下周热量与恢复建议。",
  ];
  open("AI 训练复盘", `<form id="ai-review-form" class="dialog-form ai-modal">
    <div class="ai-head-meta">${modePill(status)}<span>基于你近 28 天的真实训练、饮食与体重记录生成</span></div>
    <div class="ai-presets" role="group" aria-label="快捷复盘问题">${presets.map((prompt, i) =>
      `<button type="button" class="ai-chip" data-ai-preset="${i}">${esc(["近30天全面复盘", "力量与肌群均衡", "饮食与恢复建议"][i])}</button>`).join("")}</div>
    ${field("复盘问题", `<textarea name="text" required maxlength="4000" rows="3" placeholder="例如：最近深蹲和卧推有点卡住，请结合训练频率和饮食给出调整建议"></textarea>`)}
    <p class="form-error" role="alert" hidden></p>
    <div class="ai-result-box" id="ai-review-result" hidden></div>
    <footer class="dialog-foot">
      <button type="button" class="secondary-button" id="ai-review-copy" hidden>复制内容</button>
      <button type="submit" class="primary-button">${icon("bolt", 16)} 生成复盘分析</button>
    </footer>
  </form>`, true);

  const form = $("#ai-review-form", dialog);
  const textarea = form.elements.text;
  const resultBox = $("#ai-review-result", form);
  const copyBtn = $("#ai-review-copy", form);
  let lastSummary = "";

  $$("[data-ai-preset]", form).forEach((btn) => btn.addEventListener("click", () => {
    textarea.value = presets[Number(btn.dataset.aiPreset)] ?? "";
    textarea.focus();
  }));

  copyBtn.addEventListener("click", async () => {
    if (await copyText(lastSummary)) notify("复盘内容已复制");
    else notify("无法自动复制，请长按正文选中");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form);
    const error = $(".form-error", form);
    button.disabled = true;
    button.textContent = "正在分析记录…";
    error.hidden = true;
    try {
      const { summary } = await api("/api/ai/review", {
        method: "POST",
        timeout: 125000,
        body: { text: new FormData(form).get("text") },
      });
      if (!dialog.open || !form.isConnected) return;
      lastSummary = summary;
      resultBox.hidden = false;
      resultBox.innerHTML = `<div class="ai-prose">${escapeAndFormatLines(summary)}</div>`;
      copyBtn.hidden = false;
      button.textContent = "重新分析";
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      button.textContent = "生成复盘分析";
    } finally {
      button.disabled = false;
    }
  });
}

export function openAiDiet({ api, dialog, open, notify, status, date, meal, refresh }) {
  if (!status?.ready) { open("AI 识别饮食", unconfiguredNotice(status)); return; }
  const examples = [
    "2个水煮蛋、一碗燕麦、250ml 纯牛奶",
    "200g 煎鸡胸肉、150g 米饭、一盘西兰花",
    "一碗牛肉面加一个鸡蛋",
  ];
  let selectedMeal = meal || "lunch";
  open("AI 识别饮食", `<form id="ai-diet-form" class="dialog-form ai-modal">
    <div class="ai-head-meta">${modePill(status)}<span>先智能拆分食物和营养估算，确认后再写入记录</span></div>
    <div class="fields">
      ${field("日期", `<input name="date" type="date" min="1902-01-01" max="${today()}" value="${esc(date)}" required>`)}
      ${field("餐次", `<select name="meal">${options(meals, selectedMeal)}</select>`)}
    </div>
    <div class="ai-presets" role="group" aria-label="示例输入">${examples.map((sample, i) =>
      `<button type="button" class="ai-chip" data-ai-sample="${i}">${esc(["早餐示例", "增肌午餐", "简餐示例"][i])}</button>`).join("")}</div>
    ${field("描述吃了什么", '<textarea name="text" required maxlength="4000" rows="3" placeholder="例如：午餐吃了200g煎鸡胸肉、150g米饭和西兰花，外加一盒无糖酸奶"></textarea>')}
    <p class="form-error" role="alert" hidden></p>
    <div id="ai-diet-preview" class="ai-preview-list" hidden></div>
    <footer class="dialog-foot">
      <button type="submit" class="primary-button" id="ai-diet-parse">${icon("bolt", 16)} 识别食物营养</button>
      <button type="button" class="primary-button" id="ai-diet-save" hidden>确认写入记录</button>
    </footer>
  </form>`, true);

  const form = $("#ai-diet-form", dialog);
  const textarea = form.elements.text;
  const preview = $("#ai-diet-preview", form);
  const parseBtn = $("#ai-diet-parse", form);
  const saveBtn = $("#ai-diet-save", form);
  let draftFoods = [];

  $$("[data-ai-sample]", form).forEach((btn) => btn.addEventListener("click", () => {
    textarea.value = examples[Number(btn.dataset.aiSample)] ?? "";
    textarea.focus();
  }));

  function syncSaveLabel() {
    const count = $$('[data-food-include]:checked', preview).length;
    saveBtn.disabled = count === 0;
    saveBtn.textContent = `确认写入记录 (${count} 项)`;
  }

  function renderFoods(foods) {
    draftFoods = foods.map((food) => ({ ...food, _recordId: crypto.randomUUID(), _opId: crypto.randomUUID() }));
    preview.hidden = false;
    preview.innerHTML = `<div class="ai-preview-head"><strong>识别结果（可微调数值）</strong><span>勾选要保留的条目</span></div>` +
      draftFoods.map((food, idx) => `<div class="ai-food-card" data-food-idx="${idx}">
        <label class="ai-food-check"><input class="switch" type="checkbox" data-food-include="${idx}" checked>
          <input type="text" data-food-field="name" value="${esc(food.name)}" maxlength="120" aria-label="食物名称"></label>
        <div class="ai-food-nums">
          <label><span>热量</span><div class="input-unit"><input type="number" inputmode="decimal" min="0" max="20000" step="any" data-food-field="calories" value="${food.calories}"><span>kcal</span></div></label>
          <label><span>蛋白</span><div class="input-unit"><input type="number" inputmode="decimal" min="0" max="5000" step="any" data-food-field="protein" value="${food.protein}"><span>g</span></div></label>
          <label><span>碳水</span><div class="input-unit"><input type="number" inputmode="decimal" min="0" max="5000" step="any" data-food-field="carbs" value="${food.carbs}"><span>g</span></div></label>
          <label><span>脂肪</span><div class="input-unit"><input type="number" inputmode="decimal" min="0" max="5000" step="any" data-food-field="fat" value="${food.fat}"><span>g</span></div></label>
        </div>
      </div>`).join("");
    saveBtn.hidden = false;
    parseBtn.className = "secondary-button";
    parseBtn.textContent = "重新识别";
    syncSaveLabel();
  }

  preview.addEventListener("change", (event) => {
    if (event.target.matches("[data-food-include]")) syncSaveLabel();
  });
  preview.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target.matches?.("input")) event.preventDefault();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $(".form-error", form);
    parseBtn.disabled = true;
    if (!saveBtn.hidden) saveBtn.disabled = true;
    parseBtn.textContent = "正在识别…";
    error.hidden = true;
    const values = new FormData(form);
    try {
      const { foods } = await api("/api/ai/parse-diet", {
        method: "POST",
        timeout: 125000,
        body: { text: values.get("text"), date: values.get("date"), meal: values.get("meal") },
      });
      if (!dialog.open || !form.isConnected) return;
      renderFoods(foods);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      parseBtn.textContent = draftFoods.length ? "重新识别" : "识别食物营养";
    } finally {
      parseBtn.disabled = false;
      if (!saveBtn.hidden) syncSaveLabel();
    }
  });

  saveBtn.addEventListener("click", async () => {
    const error = $(".form-error", form);
    const formValues = new FormData(form);
    const chosenDate = formValues.get("date");
    const chosenMeal = formValues.get("meal");
    const nonNeg = (v) => Math.max(0, Number(v) || 0);
    const items = $$(".ai-food-card", preview)
      .filter((card) => $("[data-food-include]", card).checked)
      .map((card) => {
        const idx = Number(card.dataset.foodIdx);
        const { _recordId, _opId, ...orig } = draftFoods[idx] ?? {};
        return {
          recordId: _recordId ?? crypto.randomUUID(),
          opId: _opId ?? crypto.randomUUID(),
          data: {
            ...orig,
            date: chosenDate,
            meal: chosenMeal,
            name: $('[data-food-field="name"]', card).value.trim() || orig.name || "食物",
            calories: nonNeg($('[data-food-field="calories"]', card).value),
            protein: nonNeg($('[data-food-field="protein"]', card).value),
            carbs: nonNeg($('[data-food-field="carbs"]', card).value),
            fat: nonNeg($('[data-food-field="fat"]', card).value),
          },
        };
      });
    if (!items.length) return;
    saveBtn.disabled = true;
    parseBtn.disabled = true;
    error.hidden = true;
    try {
      for (const entry of items) {
        await api("/api/records", {
          method: "POST",
          body: { opId: entry.opId, id: entry.recordId, kind: "diet", baseVersion: 0, deleted: false, data: entry.data },
        });
      }
      if (dialog.open) dialog.close();
      notify(`已写入 ${items.length} 条饮食记录`);
      await refresh("diet", chosenDate);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      parseBtn.disabled = false;
      syncSaveLabel();
    }
  });
}

export function openAiWorkout({ api, dialog, open, notify, status, date, refresh, editor, goals, showReport }) {
  if (!status?.ready) { open("AI 记录训练", unconfiguredNotice(status)); return; }
  const examples = [
    "平板杠铃卧推 75kg 4组x8次，上斜哑铃卧推 22.5kg 3组x10次",
    "杠铃深蹲 100kg 5组x5次，罗马尼亚硬拉 80kg 3组x8次",
    "高位下拉 55kg 4组x10次，杠铃划船 60kg 3组x8次，哑铃弯举 12.5kg 3x12",
  ];
  open("AI 快速记训练", `<form id="ai-workout-form" class="dialog-form ai-modal">
    <div class="ai-head-meta">${modePill(status)}<span>用一句话描述刚刚练完的内容，自动匹配动作库与组次</span></div>
    ${field("训练日期", `<input name="date" type="date" min="1902-01-01" max="${today()}" value="${esc(date || today())}" required>`)}
    <div class="ai-presets" role="group" aria-label="示例输入">${examples.map((sample, i) =>
      `<button type="button" class="ai-chip" data-ai-w-sample="${i}">${esc(["推胸日示例", "下肢日示例", "拉背手臂"][i])}</button>`).join("")}</div>
    ${field("训练描述", '<textarea name="text" required maxlength="4000" rows="3" placeholder="例如：平板卧推 80kg 4组x8次，哑铃侧平举 10kg 3组x12次"></textarea>')}
    <p class="form-error" role="alert" hidden></p>
    <div id="ai-workout-preview" class="ai-preview-list" hidden></div>
    <footer class="dialog-foot">
      <button type="submit" class="primary-button" id="ai-workout-parse">${icon("bolt", 16)} 解析训练内容</button>
      <button type="button" class="secondary-button" id="ai-workout-edit" hidden>进编辑器微调</button>
      <button type="button" class="primary-button" id="ai-workout-save" hidden>直接保存完成</button>
    </footer>
  </form>`, true);

  const form = $("#ai-workout-form", dialog);
  const textarea = form.elements.text;
  const preview = $("#ai-workout-preview", form);
  const parseBtn = $("#ai-workout-parse", form);
  const editBtn = $("#ai-workout-edit", form);
  const saveBtn = $("#ai-workout-save", form);
  let parsedWorkout = null;

  $$("[data-ai-w-sample]", form).forEach((btn) => btn.addEventListener("click", () => {
    textarea.value = examples[Number(btn.dataset.aiWSample)] ?? "";
    textarea.focus();
  }));

  function renderWorkoutPreview(workout) {
    parsedWorkout = workout;
    preview.hidden = false;
    preview.innerHTML = `<div class="ai-preview-head"><strong>${esc(workout.title)}</strong><span>${workout.exercises.length} 个动作 · ${esc(workout.date)}</span></div>` +
      workout.exercises.map((row) => {
        const name = row.snapshot?.name ?? row.exerciseId;
        const timed = row.snapshot?.mode === "timed";
        const setText = row.sets.map((s) => timed ? `${s.seconds}秒` : `${fmt(s.weight)}kg×${s.reps}`).join(" / ");
        return `<div class="ai-workout-row"><strong>${esc(name)}</strong><small>${row.sets.length} 组 · ${esc(setText)}</small></div>`;
      }).join("");
    editBtn.hidden = false;
    saveBtn.hidden = false;
    parseBtn.className = "secondary-button";
    parseBtn.textContent = "重新解析";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $(".form-error", form);
    parseBtn.disabled = true;
    editBtn.disabled = true;
    saveBtn.disabled = true;
    parseBtn.textContent = "正在识别动作…";
    error.hidden = true;
    const values = new FormData(form);
    try {
      const { workout } = await api("/api/ai/parse-workout", {
        method: "POST",
        timeout: 125000,
        body: { text: values.get("text"), date: values.get("date") },
      });
      if (!dialog.open || !form.isConnected) return;
      renderWorkoutPreview(workout);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      parseBtn.textContent = parsedWorkout ? "重新解析" : "解析训练内容";
    } finally {
      parseBtn.disabled = false;
      editBtn.disabled = false;
      saveBtn.disabled = false;
    }
  });

  editBtn.addEventListener("click", () => {
    if (!parsedWorkout) return;
    const chosenDate = new FormData(form).get("date") || parsedWorkout.date;
    const seed = { ...parsedWorkout, date: chosenDate, status: "active", endedAt: null };
    if (dialog.open) dialog.close();
    editor.edit("workout", undefined, goals ?? {}, seed);
  });

  saveBtn.addEventListener("click", async () => {
    if (!parsedWorkout) return;
    const error = $(".form-error", form);
    const chosenDate = new FormData(form).get("date") || parsedWorkout.date;
    const payload = { ...parsedWorkout, date: chosenDate };
    saveBtn.disabled = true;
    editBtn.disabled = true;
    parseBtn.disabled = true;
    error.hidden = true;
    try {
      const { record } = await api("/api/records", {
        method: "POST",
        body: { opId: crypto.randomUUID(), id: crypto.randomUUID(), kind: "workout", baseVersion: 0, deleted: false, data: payload },
      });
      if (dialog.open) dialog.close();
      notify("AI 训练记录已保存");
      await refresh("workout", chosenDate);
      if (record) await showReport(record.id, record).catch(() => {});
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      saveBtn.disabled = false;
      editBtn.disabled = false;
      parseBtn.disabled = false;
    }
  });
}

export function openAiPlan({ api, dialog, open, notify, status, activePlan, onDone }) {
  if (!status?.ready) { open("生成 AI 训练计划", unconfiguredNotice(status)); return; }
  const presets = [
    "每周练 3 天推拉腿，注重增肌与基础三大项，每次 50 分钟内。",
    "每周练 4 天上下肢分化，重点提升卧推与背部围度。",
    "减脂期保持力量，每周 4 练，优先复合动作与核心控制。",
  ];
  const current = activePlan?.data;
  open("生成 AI 训练计划", `<form id="ai-plan-form" class="dialog-form ai-modal">
    <div class="ai-head-meta">${modePill(status)}<span>生成的计划会存为草稿，预览核对后启用</span></div>
    <div class="ai-presets" role="group" aria-label="快捷需求">${presets.map((p, i) =>
      `<button type="button" class="ai-chip" data-ai-plan-preset="${i}">${esc(["3天推拉腿", "4天上下肢", "减脂保力量"][i])}</button>`).join("")}</div>
    ${current ? `<label class="toggle-row"><span><strong>基于当前计划微调</strong><small>参考「${esc(current.name)}」(${current.weeks}周)</small></span><input class="switch" type="checkbox" name="refine"></label>` : ""}
    ${field("训练需求", '<textarea name="text" required maxlength="4000" rows="4" placeholder="例如：每周 3 次，优先背部和腿部，使用杠铃与哑铃"></textarea>')}
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot"><button class="primary-button" type="submit">${icon("bolt", 16)} 生成计划草稿</button></footer>
  </form>`, true);

  const form = $("#ai-plan-form", dialog);
  const textarea = form.elements.text;
  $$("[data-ai-plan-preset]", form).forEach((btn) => btn.addEventListener("click", () => {
    textarea.value = presets[Number(btn.dataset.aiPlanPreset)] ?? "";
    textarea.focus();
  }));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $('button[type="submit"]', form);
    const error = $(".form-error", form);
    const values = new FormData(form);
    const refine = Boolean(activePlan?.id && values.has("refine"));
    button.disabled = true;
    button.textContent = "正在生成草稿…";
    error.hidden = true;
    try {
      const result = await api("/api/ai/plan", {
        method: "POST",
        timeout: 125000,
        body: { text: values.get("text"), ...(refine ? { parentId: activePlan.id } : {}) },
      });
      if (dialog.open && dialog.contains(form)) dialog.close();
      if (result.record) notify("计划草稿已生成，请在「计划草稿」核对启用");
      await onDone?.(result);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      button.textContent = "生成计划草稿";
    } finally {
      button.disabled = false;
    }
  });
}

export function aiSettingsCard(status, sectionAttr) {
  const ready = Boolean(status?.ready);
  const stateLabel = !ready ? "未配置" : status.mode === "demo" ? "演示模拟" : "已连接真实模型";
  return `<section class="panel" ${sectionAttr}>
    <header class="panel-head"><div><h2>AI 训练助手</h2><p>自然语言记录、智能计划、周期复盘与训中调整</p></div>${modePill(status)}</header>
    <div class="health-metrics apple-telemetry">
      <div><span>服务状态</span><strong>${esc(stateLabel)}</strong></div>
      <div><span>当前模型</span><strong>${esc(status?.model ?? "未指定")}</strong></div>
      <div><span>接入方式</span><strong>${status?.mode === "demo" ? "本地演示引擎" : status?.baseUrlHost ? esc(status.baseUrlHost) : "后端环境变量"}</strong></div>
      <div><span>支持能力</span><strong>5 <small>项模块</small></strong></div>
    </div>
    <div class="ai-tool-grid">
      <button type="button" class="ai-tool-btn" data-action="ai-review">${icon("bolt", 17)}<span><strong>AI 训练复盘</strong><small>基于近28天训练/饮食/体重给出建议</small></span></button>
      <button type="button" class="ai-tool-btn" data-action="ai-plan">${icon("plan", 17)}<span><strong>AI 训练计划</strong><small>按器械与目标生成可启用计划草稿</small></span></button>
      <button type="button" class="ai-tool-btn" data-action="ai-workout">${icon("workout", 17)}<span><strong>AI 记训练</strong><small>自然语言自动拆解动作、重量与组数</small></span></button>
      <button type="button" class="ai-tool-btn" data-action="ai-diet">${icon("diet", 17)}<span><strong>AI 记饮食</strong><small>语音/文字估算热量与三大营养素</small></span></button>
    </div>
    ${!ready ? `<div class="ai-setup-box"><h3>配置真实大模型（后端 .env）</h3><pre class="ai-code">AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_API_KEY=你的密钥</pre></div>` : `<p class="muted ai-foot-note">训练进行中，可在训练界面的「AI 调整」按实时疲劳与剩余时间调整余下组数。</p>`}
  </section>`;
}
