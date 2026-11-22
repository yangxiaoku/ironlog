import { $, $$, esc, icon, equipment } from "./ui.js";

export const onboardingSeenKey = (userId) => "ironlog-web-onboarding-done:" + (userId || "anon");
export const welcomeDismissedKey = (userId) => "ironlog-web-welcome-dismissed:" + (userId || "anon");
export const setupSavedKey = (userId) => "ironlog-web-setup-saved:" + (userId || "anon");

const EQUIP_PRESETS = {
  gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
  home: ["dumbbell", "bodyweight", "band"],
  bodyweight: ["bodyweight"],
};

const EQUIP_KEYS = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band", "weighted"];

export function renderWelcomeChecklist({ userId = "", data = null, currentDay = null, hasPlan = false, appleHealthConnected = false } = {}) {
  if (!userId || localStorage.getItem(welcomeDismissedKey(userId)) === "1") return "";
  const setupDone = localStorage.getItem(setupSavedKey(userId)) === "1"
    || Boolean(data?.goals?.targetWeight != null)
    || Boolean(localStorage.getItem(onboardingSeenKey(userId)) === "1" && (data?.goals?.calories && data.goals.calories !== 2200));
  const trainingDone = Boolean(hasPlan || (data?.totals?.workouts ?? 0) > 0 || currentDay?.active || currentDay?.completed > 0);
  const bodyDone = Boolean((currentDay?.nutrition?.count ?? 0) > 0 || currentDay?.weight != null || (data?.weights?.length ?? 0) > 0);
  const doneCount = [setupDone, trainingDone, bodyDone].filter(Boolean).length;

  return `<section class="panel welcome-checklist" aria-label="新手快速上手清单">
    <header class="panel-head">
      <div>
        <h2>快速上手清单 <span class="atlas-pill">${doneCount} / 3</span></h2>
        <p>${appleHealthConnected ? "已完成 Apple 健康对接，按以下 3 步快速建档开练。" : "无需 Apple Watch 也能完整使用，按以下 3 步快速开启训练闭环。"}</p>
      </div>
      <div class="heading-actions">
        <button type="button" class="quiet" data-action="open-onboarding">${icon("book", 14)} 查看完整指南</button>
        <button type="button" class="quiet" data-action="dismiss-welcome">不再提示</button>
      </div>
    </header>
    <div class="welcome-checklist-items">
      <div class="welcome-item${setupDone ? " is-done" : ""}">
        <span class="welcome-check" aria-hidden="true">${setupDone ? icon("check", 14) : "01"}</span>
        <div class="welcome-copy">
          <strong>设定器械与每日目标</strong>
          <small>选择健身房 / 居家器械与热量蛋白参考，后续选动作更精准</small>
        </div>
        <button type="button" class="${setupDone ? "quiet" : "secondary-button"}" data-action="open-onboarding-step" data-value="2">${setupDone ? "修改设置" : "去设置"}</button>
      </div>
      <div class="welcome-item${trainingDone ? " is-done" : ""}">
        <span class="welcome-check" aria-hidden="true">${trainingDone ? icon("check", 14) : "02"}</span>
        <div class="welcome-copy">
          <strong>启用经典计划或记首场训练</strong>
          <small>直接套用经典分化方案，或自由添加动作记录组数与重量</small>
        </div>
        <div class="welcome-item-actions">
          <button type="button" class="secondary-button" data-action="plan-starters">选方案</button>
          <button type="button" class="primary-button" data-action="edit" data-value="workout">记训练</button>
        </div>
      </div>
      <div class="welcome-item${bodyDone ? " is-done" : ""}">
        <span class="welcome-check" aria-hidden="true">${bodyDone ? icon("check", 14) : "03"}</span>
        <div class="welcome-copy">
          <strong>记录今日饮食或体重</strong>
          <small>记录首餐蛋白热量或晨起体重，点亮今日进度与变化趋势</small>
        </div>
        <div class="welcome-item-actions">
          <button type="button" class="secondary-button" data-action="today-diet">记饮食</button>
          <button type="button" class="quiet" data-action="today-weight">记体重</button>
        </div>
      </div>
    </div>
  </section>`;
}

export function openOnboardingGuide({
  api,
  open,
  dialog,
  notify,
  userId,
  username,
  demo = false,
  appleHealthConnected = false,
  currentProfile = null,
  initialStep = 1,
  onProfileSaved,
  onLaunchAction,
  onComplete,
}) {
  const STEPS = [
    { id: 1, label: "认识铁记" },
    { id: 2, label: "目标器械" },
    { id: 3, label: "记录训练" },
    { id: 4, label: "饮食体重" },
    { id: 5, label: "立即开练" },
  ];
  let step = Math.max(1, Math.min(STEPS.length, Number(initialStep) || 1));
  let latestProfileRes = null;

  const markSeen = () => {
    if (userId) localStorage.setItem(onboardingSeenKey(userId), "1");
    onComplete?.();
  };

  const eqInit = new Set(
    Array.isArray(currentProfile?.equipment) && currentProfile.equipment.length
      ? currentProfile.equipment
      : ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
  );
  const setupState = {
    daysPerWeek: Number(currentProfile?.daysPerWeek) || 4,
    restSeconds: Number(currentProfile?.restSeconds) || 90,
    calories: Number(currentProfile?.calories) || 2200,
    protein: Number(currentProfile?.protein) || 140,
    equipment: eqInit,
  };

  open("铁记新手入门指南", `<div class="onboarding-shell" data-onboarding-shell>
    <div class="onboarding-top">
      <div class="onboarding-steps" role="tablist" aria-label="入门引导步骤">
        ${STEPS.map((s) => `<button type="button" role="tab" class="onboarding-step-dot" data-ob-step="${s.id}" aria-selected="${step === s.id}"><span>0${s.id}</span><b>${esc(s.label)}</b></button>`).join("")}
      </div>
      <span class="onboarding-step-counter" data-ob-counter></span>
    </div>

    <div class="onboarding-panels">
      <section class="onboarding-panel" data-ob-panel="1"${step === 1 ? "" : " hidden"}>
        <div class="onboarding-hero">
          <span class="atlas-pill">${demo ? "演示体验" : username ? `欢迎你，${esc(username)}` : "欢迎加入铁记"}</span>
          <h3>从开练、吃够蛋白到恢复分析，3 分钟掌握核心用法</h3>
          <p class="muted">铁记将训练计划、实时组间计时、营养摄入与负荷科学收拢到一个清爽工作台，桌面与手机端实时同步。</p>
        </div>
        <div class="onboarding-feature-grid">
          <article class="onboarding-card">
            <strong>${icon("workout", 16)} 训练计划与实时开练</strong>
            <small>支持 PPL/上下肢经典方案一键启用；训练中自带组间休息表盘、杠铃配片计算与动作动图要领。</small>
          </article>
          <article class="onboarding-card">
            <strong>${icon("diet", 16)} 饮食热量与每日饮水</strong>
            <small>常用健身餐 1 键填入、多食物连续录入、常用餐单整餐复刻，实时跟踪蛋白与热量缺口。</small>
          </article>
          <article class="onboarding-card">
            <strong>${icon("weight", 16)} 体重趋势与围度比例</strong>
            <small>记录每日体重、体脂与胸腰臀臂围，自动绘制 7 日滚动均值线，平滑掉单日水分波动。</small>
          </article>
          <article class="onboarding-card">
            <strong>${icon("analytics", 16)} 科学负荷与成就系统</strong>
            <small>自动计算 ACWR 急慢负荷比、肌群周有效组数与估算 1RM，点亮里程碑成就徽章。</small>
          </article>
        </div>
        <div class="onboarding-note-box">
          <strong>${icon("heart", 15)} 没有 Apple Watch / 智能手表？完全不影响！</strong>
          <small>${appleHealthConnected
            ? "当前账号已连接 Apple 健康数据，首页与分析页将自动结合心率、睡眠与日常体征展示恢复建议。"
            : "系统已自动隐藏未对接的 Apple 健康模块，界面更干净纯粹；日后如需配合 iPhone 捷径或手表同步，可随时到「设置 → Apple 健康」手动开启。"}</small>
        </div>
      </section>

      <section class="onboarding-panel" data-ob-panel="2"${step === 2 ? "" : " hidden"}>
        <div class="onboarding-subhead">
          <h3>10 秒设定基础目标与常用器械</h3>
          <p class="muted">选好后「动作库」与「训练编辑器」会自动优先推荐你能用到的动作；所有数值日后都可在设置里微调。</p>
        </div>
        <div class="onboarding-setup-form">
          <div class="onboarding-field-block">
            <span class="onboarding-field-label">快捷训练场景（点击一键勾选器械）</span>
            <div class="onboarding-pill-row">
              <button type="button" class="quiet" data-ob-preset="gym">商业健身房</button>
              <button type="button" class="quiet" data-ob-preset="home">居家哑铃</button>
              <button type="button" class="quiet" data-ob-preset="bodyweight">徒手训练</button>
            </div>
            <div class="equip-check-grid" data-ob-equip>
              ${EQUIP_KEYS.map((key) => `<label class="equip-check-pill"><input type="checkbox" value="${key}"${setupState.equipment.has(key) ? " checked" : ""}><span>${esc(equipment[key] ?? key)}</span></label>`).join("")}
            </div>
          </div>

          <div class="onboarding-two-cols">
            <div class="onboarding-field-block">
              <span class="onboarding-field-label">每周计划训练天数</span>
              <div class="onboarding-pill-row">
                ${[3, 4, 5, 6].map((d) => `<button type="button" class="stepper-pill" data-ob-days="${d}" aria-pressed="${setupState.daysPerWeek === d}">${d} 天/周</button>`).join("")}
              </div>
            </div>
            <div class="onboarding-field-block">
              <span class="onboarding-field-label">默认组间休息计时</span>
              <div class="onboarding-pill-row">
                ${[60, 90, 120].map((sec) => `<button type="button" class="stepper-pill" data-ob-rest="${sec}" aria-pressed="${setupState.restSeconds === sec}">${sec} 秒</button>`).join("")}
              </div>
            </div>
          </div>

          <div class="onboarding-two-cols">
            <label class="field">
              <span>每日热量目标 (kcal)</span>
              <input type="number" inputmode="numeric" name="obCalories" min="800" max="15000" step="10" value="${Math.round(setupState.calories)}">
            </label>
            <label class="field">
              <span>每日蛋白目标 (g) <small class="muted">建议 1.6–2.2 g/kg 体重</small></span>
              <input type="number" inputmode="numeric" name="obProtein" min="20" max="600" step="1" value="${Math.round(setupState.protein)}">
            </label>
          </div>
          <p class="form-error" data-ob-error role="alert" hidden></p>
          <div class="onboarding-save-bar">
            <button type="button" class="primary-button" data-ob-save-next>${demo ? "演示预览，进入下一步" : "保存设置并下一步"}</button>
            <button type="button" class="quiet" data-ob-next>暂不修改，跳过</button>
          </div>
        </div>
      </section>

      <section class="onboarding-panel" data-ob-panel="3"${step === 3 ? "" : " hidden"}>
        <div class="onboarding-subhead">
          <h3>怎么选计划 & 手机上快速记训练</h3>
          <p class="muted">铁记为健身房单手操作做了专门优化，不用每次打字输入。</p>
        </div>
        <ul class="onboarding-tip-list">
          <li>
            <strong>1. 从「经典方案」或「+ 速记」开始</strong>
            <small>进入「训练计划 → 经典方案」可一键启用 PPL、上下肢四分化或全身新手方案；也可以点顶部「+ 速记 → 记录训练」自由开练。</small>
          </li>
          <li>
            <strong>2. 组行左右滑动，少按一次是一次</strong>
            <small>在实时训练窗口中：组行<b>右滑直接勾选完成</b>并自动启动组间倒计时；<b>左滑删除该组</b>（支持 5 秒撤销）；点左侧组号可切换热身 / 递减 / 力竭组。</small>
          </li>
          <li>
            <strong>3. 动作示范、杠铃配片与防丢失草稿</strong>
            <small>点击「动作示范」展开标准动图与发力要点；点击「配片」自动换算杠铃片数；误关弹窗也会保留草稿，顶部随时点红点「草稿 / 训练中」回到现场。</small>
          </li>
          <li>
            <strong>4. 键盘快捷键</strong>
            <small>在重量框输完按手机键盘「下一项」直接跳至次数框，按「完成」自动勾选本组。</small>
          </li>
        </ul>
      </section>

      <section class="onboarding-panel" data-ob-panel="4"${step === 4 ? "" : " hidden"}>
        <div class="onboarding-subhead">
          <h3>饮食、体重、日历与科学数据分析</h3>
          <p class="muted">把每日恢复、吃与练串联起来，及时看出状态拐点。</p>
        </div>
        <div class="onboarding-feature-grid">
          <article class="onboarding-card">
            <strong>饮食快录与模板</strong>
            <small>内置常见健身餐快捷填入与「复刻昨日」，新建食物时点「保存并继续」可一次连录整顿饭；列表右滑再来一份、左滑可撤销删除。</small>
          </article>
          <article class="onboarding-card">
            <strong>体重跨日补录与围度</strong>
            <small>体重弹窗顶部点「今天 / 昨天 / 前天」无缝补录与修改历史体重；搭配围度记录自动算腰臀比与腰高比。</small>
          </article>
          <article class="onboarding-card">
            <strong>训练日历与月度总览</strong>
            <small>月历一格看清每日训练标题、饮食完整标记与未来排期，点击任意一天查看动作与热量明细。</small>
          </article>
          <article class="onboarding-card">
            <strong>负荷比与肌群均衡</strong>
            <small>在「数据分析」查看急慢负荷比（0.8–1.3 甜区）、各部位每周有效组数（10–20 组参考）以及单动作 1RM 估算曲线。</small>
          </article>
        </div>
      </section>

      <section class="onboarding-panel" data-ob-panel="5"${step === 5 ? "" : " hidden"}>
        <div class="onboarding-subhead">
          <h3>准备好了！选一个方式开启你的第一条记录</h3>
          <p class="muted">随时可以在桌面侧栏底部、手机底部「更多」菜单或「设置 → 账号与数据」重新打开本指南。</p>
        </div>
        <div class="onboarding-launch-grid">
          <button type="button" class="onboarding-launch-card" data-ob-launch="browse-plans">
            <span>${icon("plan", 20)}</span>
            <div><strong>浏览经典训练方案</strong><small>挑一套分化直接开启周期计划</small></div>
            ${icon("chevron", 16)}
          </button>
          <button type="button" class="onboarding-launch-card" data-ob-launch="start-workout">
            <span>${icon("workout", 20)}</span>
            <div><strong>开始第一场训练</strong><small>打开实时训练弹窗记录动作与组数</small></div>
            ${icon("chevron", 16)}
          </button>
          <button type="button" class="onboarding-launch-card" data-ob-launch="log-diet">
            <span>${icon("diet", 20)}</span>
            <div><strong>记录今天第一餐</strong><small>点亮今日热量与蛋白质进度</small></div>
            ${icon("chevron", 16)}
          </button>
          <button type="button" class="onboarding-launch-card" data-ob-launch="log-weight">
            <span>${icon("weight", 20)}</span>
            <div><strong>记录今日体重</strong><small>建立属于你的 7 日体重均值曲线</small></div>
            ${icon("chevron", 16)}
          </button>
        </div>
      </section>
    </div>

    <footer class="onboarding-foot">
      <button type="button" class="quiet" data-ob-skip>跳过指南</button>
      <div class="onboarding-foot-nav">
        <button type="button" class="secondary-button" data-ob-prev hidden>上一步</button>
        <button type="button" class="primary-button" data-ob-next>下一步</button>
        <button type="button" class="primary-button" data-ob-finish hidden>进入首页工作台</button>
      </div>
    </footer>
  </div>`, true, "onboarding");

  const shell = $("[data-onboarding-shell]", dialog);
  if (!shell) return;

  void api("/api/web/profile").then((res) => {
    if (!shell.isConnected || !res?.profile) return;
    latestProfileRes = res;
    if (!currentProfile) {
      setupState.daysPerWeek = Number(res.profile.daysPerWeek) || setupState.daysPerWeek;
      setupState.restSeconds = Number(res.profile.restSeconds) || setupState.restSeconds;
      setupState.calories = Number(res.profile.calories) || setupState.calories;
      setupState.protein = Number(res.profile.protein) || setupState.protein;
      if (Array.isArray(res.profile.equipment) && res.profile.equipment.length) {
        setupState.equipment = new Set(res.profile.equipment);
        $$('[data-ob-equip] input[type="checkbox"]', shell).forEach((box) => {
          box.checked = setupState.equipment.has(box.value);
        });
      }
      const calEl = $('[name="obCalories"]', shell);
      const proEl = $('[name="obProtein"]', shell);
      if (calEl) calEl.value = String(setupState.calories);
      if (proEl) proEl.value = String(setupState.protein);
      $$("[data-ob-days]", shell).forEach((btn) => btn.setAttribute("aria-pressed", String(Number(btn.dataset.obDays) === setupState.daysPerWeek)));
      $$("[data-ob-rest]", shell).forEach((btn) => btn.setAttribute("aria-pressed", String(Number(btn.dataset.obRest) === setupState.restSeconds)));
    }
  }).catch(() => {});

  function renderStep() {
    $("[data-ob-counter]", shell).textContent = `第 ${step} / ${STEPS.length} 步`;
    $$("[data-ob-step]", shell).forEach((tab) => {
      const s = Number(tab.dataset.obStep);
      tab.setAttribute("aria-selected", String(s === step));
      tab.classList.toggle("is-visited", s < step);
    });
    $$("[data-ob-panel]", shell).forEach((panel) => {
      panel.hidden = Number(panel.dataset.obPanel) !== step;
    });
    const prevBtn = $("[data-ob-prev]", shell);
    const nextBtn = $("[data-ob-next]", shell.querySelector(".onboarding-foot"));
    const finishBtn = $("[data-ob-finish]", shell);
    if (prevBtn) prevBtn.hidden = step <= 1;
    if (nextBtn) nextBtn.hidden = step >= STEPS.length || step === 2;
    if (finishBtn) finishBtn.hidden = step !== STEPS.length;
    dialog.scrollTop = 0;
  }
  renderStep();

  const onDialogClose = () => markSeen();
  dialog.addEventListener("close", onDialogClose, { once: true });

  shell.addEventListener("click", async ({ target }) => {
    const tab = target.closest("[data-ob-step]");
    if (tab) {
      step = Number(tab.dataset.obStep);
      renderStep();
      return;
    }
    const presetBtn = target.closest("[data-ob-preset]");
    if (presetBtn) {
      const list = EQUIP_PRESETS[presetBtn.dataset.obPreset] ?? [];
      setupState.equipment = new Set(list);
      $$('[data-ob-equip] input[type="checkbox"]', shell).forEach((box) => {
        box.checked = setupState.equipment.has(box.value);
      });
      return;
    }
    const dayBtn = target.closest("[data-ob-days]");
    if (dayBtn) {
      setupState.daysPerWeek = Number(dayBtn.dataset.obDays);
      $$("[data-ob-days]", shell).forEach((btn) => btn.setAttribute("aria-pressed", String(btn === dayBtn)));
      return;
    }
    const restBtn = target.closest("[data-ob-rest]");
    if (restBtn) {
      setupState.restSeconds = Number(restBtn.dataset.obRest);
      $$("[data-ob-rest]", shell).forEach((btn) => btn.setAttribute("aria-pressed", String(btn === restBtn)));
      return;
    }
    if (target.closest("[data-ob-save-next]")) {
      const btn = target.closest("[data-ob-save-next]");
      const errEl = $("[data-ob-error]", shell);
      if (errEl) errEl.hidden = true;
      if (demo) {
        notify("演示模式不写入演示库，已为你继续浏览设置指南");
        step = 3;
        renderStep();
        return;
      }
      const calories = Number($('[name="obCalories"]', shell)?.value);
      const protein = Number($('[name="obProtein"]', shell)?.value);
      const eqSelected = $$('[data-ob-equip] input[type="checkbox"]:checked', shell).map((box) => box.value);
      if (!Number.isFinite(calories) || calories < 500 || calories > 20000) {
        if (errEl) { errEl.textContent = "请输入合理的每日热量目标（500–20000 kcal）。"; errEl.hidden = false; }
        return;
      }
      if (!Number.isFinite(protein) || protein < 0 || protein > 1000) {
        if (errEl) { errEl.textContent = "请输入合理的每日蛋白目标（0–1000 g）。"; errEl.hidden = false; }
        return;
      }
      btn.disabled = true;
      try {
        const current = latestProfileRes ?? await api("/api/web/profile");
        const prev = current.profile ?? {};
        const updated = await api("/api/web/profile", {
          method: "PUT",
          body: {
            calories: Math.round(calories),
            protein: Math.round(protein),
            carbs: Number(prev.carbs ?? 240),
            fat: Number(prev.fat ?? 70),
            daysPerWeek: setupState.daysPerWeek,
            restSeconds: setupState.restSeconds,
            targetWeight: prev.targetWeight ?? null,
            equipment: eqSelected,
            energyProfile: prev.energyProfile ?? null,
            version: current.version ?? 0,
            opId: crypto.randomUUID(),
          },
        });
        latestProfileRes = updated;
        if (userId) localStorage.setItem(setupSavedKey(userId), "1");
        onProfileSaved?.(updated.profile);
        notify("初始目标与器械已保存");
        step = 3;
        renderStep();
      } catch (err) {
        if (errEl) { errEl.textContent = err?.message || "保存失败，请稍后再试"; errEl.hidden = false; }
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (target.closest("[data-ob-prev]")) {
      if (step > 1) { step--; renderStep(); }
      return;
    }
    if (target.closest("[data-ob-next]")) {
      if (step < STEPS.length) { step++; renderStep(); }
      return;
    }
    if (target.closest("[data-ob-skip]") || target.closest("[data-ob-finish]")) {
      markSeen();
      dialog.close();
      return;
    }
    const launchBtn = target.closest("[data-ob-launch]");
    if (launchBtn) {
      const kind = launchBtn.dataset.obLaunch;
      markSeen();
      dialog.close();
      await onLaunchAction?.(kind);
    }
  });
}
