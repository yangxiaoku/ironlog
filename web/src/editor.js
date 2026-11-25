import { $, $$, esc, fmt, today, workoutSeconds, field, input, inputGroup, options, icon, empty, meals, feelings, muscles, equipment, prioritizeExact, estimated1RM, plateBreakdown } from "./ui.js";
import { createRestAudio, createRestTimer, elapsedAt, formatClock, normalizeRestTimer, pauseAt, pauseRestTimer, recoverClock, restProgress, resolveSetRestSeconds, resumeRestTimer, shiftRestTimer, keepWorkoutScreenAwake, haptic } from "./workout-clock.js";
import { matrix } from "./display.js";
import { isNetworkError } from "./offline-queue.js";
import { round2, numeric, soundPreference, screenPreference, rirPreference, dialPreference, notifyPreference, barPreference, platesPreference, ALL_PLATES, BAR_PRESETS, forgetDraft, renderDialTicks, syncDialTicks, exerciseLabel, plateDeltaLabel, snapWarmupWeight } from "./workout-helpers.js";
import { commonFields as baseCommonFields, openSimpleRecordEditor } from "./simple-editors.js";

const uuid = () => crypto.randomUUID();
const set = () => ({ id: uuid(), type: "normal", weight: 0, reps: 8, seconds: 0, completed: false, rir: null });

export function makeEditor({ api, dialog, open, refresh, notify, owner, onDraft, showReport, appDate, getLatestWeight, getRecentFoods, getFavoriteIds, getCustomExercises, onCreateCustomExercise, getReadinessHint, getUserEquipment, pushOverlay = /** @type {(fn?: any) => any} */ (() => null), popOverlay = /** @type {(id?: any) => void} */ (() => {}), openConfirmDialog, queueOfflineRecord }) {
  let searching = 0, closeWorkout;
  const audio = createRestAudio(() => localStorage.getItem(soundPreference) !== "off");
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    const close = closeWorkout;
    closeWorkout = undefined;
    close?.();
    searching++;
  });

  function commonFields(kind, data, record) {
    return baseCommonFields(kind, data, record, appDate);
  }

  function edit(kind, record, settings = {}, seed) {
    const prevClose = closeWorkout;
    closeWorkout = undefined;
    prevClose?.();
    dialog.classList.remove("is-live-workout");
    const data = record?.data ?? seed ?? {};
    if (kind === "workout") return editWorkout(record, data, settings);
    openSimpleRecordEditor({
      kind, record, settings, seed, api, open, appDate,
      getLatestWeight, getRecentFoods, commit, deleteRecord, onSwitchDate: edit,
    });
  }

  function resetKeepOpenDietForm(form, message) {
    ["name", "calories", "protein", "carbs", "fat"].forEach((key) => {
      const el = $(`[name="${key}"]`, form);
      if (el) el.value = "";
    });
    const sumEl = $("[data-macro-sum]", form);
    if (sumEl) sumEl.textContent = "0";
    notify(message);
    $('[name="name"]', form)?.focus({ preventScroll: true });
  }

  async function commit(form, mutation, kind, date, draftKey, recap = false, keepOpen = false) {
    const buttons = $$("button", form).filter((button) => !button.disabled);
    buttons.forEach((button) => { button.disabled = true; });
    const error = $("[data-form-error]", form) ?? $(".form-error", form);
    error.hidden = true;
    const payload = { opId: uuid(), deleted: false, ...mutation };
    try {
      const { record } = await api("/api/records", { method: "POST", body: payload });
      if (keepOpen && kind === "diet" && !mutation.deleted) {
        await refresh(kind, date);
        resetKeepOpenDietForm(form, `已保存「${mutation.data.name}」，可继续录入`);
        return;
      }
      form.dataset.saved = "true";
      forgetDraft(draftKey);
      const wasOpen = dialog.open && dialog.contains(form);
      if (wasOpen) dialog.close();
      notify(mutation.deleted ? "记录已删除" : mutation.data.status === "active" ? "训练草稿已保存" : "记录已保存");
      await refresh(kind, date);
      if (recap && record && wasOpen && !dialog.open) {
        await showReport(record.id, record).catch(() => notify("训练已保存，可在训练记录里打开复盘"));
      }
    } catch (problem) {
      if (isNetworkError(problem) && queueOfflineRecord && owner?.()) {
        const typeLabel = kind === "workout" ? "训练记录" : kind === "diet" ? "饮食记录" : "体重记录";
        if (queueOfflineRecord(payload, mutation.deleted ? `删除${typeLabel}` : typeLabel) == null) {
          error.textContent = "浏览器无法暂存离线记录。请保留此页面，联网后重新保存";
          error.hidden = false;
          return;
        }
        if (keepOpen && kind === "diet" && !mutation.deleted) {
          resetKeepOpenDietForm(form, `当前离线，已暂存「${mutation.data.name}」，联网后自动同步`);
          return;
        }
        form.dataset.saved = "true";
        forgetDraft(draftKey);
        const wasOpen = dialog.open && dialog.contains(form);
        if (wasOpen) dialog.close();
        notify("当前离线，已保存到本地同步队列，联网后自动同步");
        return;
      }
      error.textContent = problem.status === 409 ? "记录已在其他设备更新。请先关闭并刷新，避免覆盖已有记录。" : problem.message;
      error.hidden = false;
    } finally { buttons.forEach((button) => { button.disabled = false; }); }
  }

  function deleteRecord(form, record) {
    const mutation = { kind: record.kind, id: record.id, baseVersion: record.version, deleted: true, data: record.data };
    if (openConfirmDialog) {
      openConfirmDialog({
        title: "删除记录",
        message: "确定要删除这条记录吗？删除后无法恢复。",
        confirmLabel: "删除记录",
        onConfirm: () => commit(form, mutation, record.kind, record.data.date, form.dataset.draft),
      });
      return;
    }
    const button = $("#remove-record", form);
    if (button.dataset.confirm !== "yes") {
      button.textContent = "确认删除这条记录";
      button.dataset.confirm = "yes";
      return;
    }
    void commit(form, mutation, record.kind, record.data.date, form.dataset.draft);
  }

  function editWorkout(record, data, settings) {
    const template = data.templateKey;
    const seedExerciseMeta = Array.isArray(data.exerciseMeta) ? data.exerciseMeta : [];
    const scope = owner();
    const draftKey = scope ? "ironlog-web-draft:" + scope + ":" + (record ? record.id + ":" + record.version : template ? "template:" + template : "new") : "";
    data = { ...data };
    delete data.templateKey;
    delete data.exerciseMeta;
    let local;
    try { if (draftKey) local = JSON.parse(localStorage.getItem(draftKey) ?? sessionStorage.getItem(draftKey) ?? "null"); } catch {}
    const rows = structuredClone(local?.exercises ?? data.exercises ?? []).map((r) => ({ ...r, supersetGroup: r.supersetGroup ?? null }));
    const started = data.startedAt ?? local?.startedAt ?? new Date().toISOString();
    const previousDuration = workoutSeconds(data);
    const isActive = data.status === "active";
    const live = !record || isActive;
    const initialDate = local?.date ?? data.date ?? appDate();
    const now = Date.now();
    let timing = local?.timing ?? recoverClock({ ...data, exercises: rows }, now);
    if (!local && !record && initialDate === today()) timing.runningSince = started;
    let rest = normalizeRestTimer(
      local?.rest ?? (data.restEndsAt ? { end: data.restEndsAt, start: data.restStartedAt ?? now } : null),
      now,
    );
    if (live && rest) audio.unlock();
    let guided = live;
    let showRir = localStorage.getItem(rirPreference) === "on" || rows.some((row) => row.sets.some((entry) => entry.rir != null));
    const rawSavedBar = localStorage.getItem(barPreference);
    const savedBar = rawSavedBar === null || rawSavedBar === "" ? NaN : Number(rawSavedBar);
    let barWeight = [20, 15, 10, 25, 0].includes(savedBar) ? savedBar : 20;
    let enabledPlates = [25, 20, 15, 10, 5, 2.5, 1.25];
    try {
      const rawPlates = JSON.parse(localStorage.getItem(platesPreference) ?? "null");
      if (Array.isArray(rawPlates)) {
        const validPlates = rawPlates.map(Number).filter((p) => ALL_PLATES.includes(p));
        if (validPlates.length) enabledPlates = validPlates;
      }
    } catch {}
    let plateConfigRowId = "";
    let dialOpen = false;
    const supportsWake = live && "wakeLock" in navigator;
    const restoredIndex = rows.findIndex((row) => row.id === local?.focusId);
    const firstPendingIndex = rows.findIndex((row) => row.sets.some((entry) => !entry.completed));
    let dirty = !!local, lastRest = null, restNotifiedEndAt = 0, focusRow = Math.max(0, restoredIndex >= 0 ? restoredIndex : firstPendingIndex);
    const originalTitle = document.title;
    let referenceRequest = 0, detailRequest = 0, advanceTimer = 0, stepNoticeTimer = 0, stepNotice = null;
    let references = new Map(), prBaselines = new Map(), exerciseDetails = new Map();
    const exerciseNotes = new Map(), draftDossierNotes = new Map(), exerciseHistoryCache = new Map(), openDossiers = new Set(), openMotions = new Set();
    const isMobileViewport = () => matchMedia("(max-width: 630px)").matches;
    let readinessDismissed = false, swapTargetRow = -1, activeHold = null;
    let reviewing = false, pickerMuscle = "", pickerEquipment = "", pendingUndo = null, undoTimer = 0;
    let settingsOpen = !live || initialDate !== today();
    let sessionMenuOpen = false, quickNotesOpen = false;
    let pickerOverlayToken = null, sessionMenuToken = null, dialOverlayToken = null, adaptOverlayToken = null;
    function syncOverlayToken(currentToken, shouldBeOpen, onClose) {
      if (shouldBeOpen && currentToken == null) return pushOverlay(onClose);
      if (!shouldBeOpen && currentToken != null) { popOverlay(currentToken); return null; }
      return currentToken;
    }
    const openExMenus = new Set(), deleteSetMode = new Set();
    const celebratedPrKeys = new Set();
    const plannedMeta = new Map();
    seedExerciseMeta.forEach((meta, idx) => { if (meta) plannedMeta.set(meta.exerciseId + ":" + idx, meta); });
    let activeRecord = record ?? null, workoutId = activeRecord?.id ?? uuid(), activeAdapt = null;
    const untouchedWeights = new WeakSet();
    const title = local?.title ?? data.title ?? "自由训练";
    const selectedFeeling = local?.feeling ?? data.feeling ?? "";

    open(record && !isActive ? "编辑训练" : isActive ? "继续训练" : "记录训练", `<form id="editor-form" class="dialog-form workout-form${live && focusRow < rows.length - 1 ? " has-next" : ""}${showRir ? " show-rir" : ""}${live ? " is-live" : ""}">
      ${live ? `<header class="workout-topbar" aria-label="本次训练概况">
        <div class="workout-topbar-row">
          <button type="button" class="workout-circle-btn" data-action="close" aria-label="收起训练" autofocus>${icon("arrowDown", 18)}</button>
          <button type="button" class="workout-topbar-center" data-live-clock data-clock="train" aria-label="暂停或继续训练计时">
            <strong data-session-title>${esc(title)}</strong>
            <span class="workout-topbar-sub"><i class="live-led" aria-hidden="true"></i><em data-live-clock-text>00:00</em><i class="clock-sep" aria-hidden="true"> · </i><span data-set-count>0/0 组</span></span>
          </button>
          <div class="workout-topbar-actions">
            <button type="button" class="workout-circle-btn" data-workout="toggle-session-menu" aria-label="训练设置与更多操作" aria-expanded="false">${icon("more", 18)}</button>
            <button type="button" class="workout-finish-pill finish-trigger" data-workout="finish-review">结束</button>
            <button type="button" class="secondary-button workout-finish-pill" data-workout="back-from-finish" hidden>返回</button>
          </div>
        </div>
        <div class="workout-progress-strip">
          <progress max="1" value="0" aria-label="训练组数进度"></progress>
          <span class="workout-live-vol" data-live-volume>0 kg</span>
        </div>
      </header>` : ""}
      <div class="workout-scroll">
        ${local ? '<p class="draft-note">已恢复此设备上的草稿 <button class="quiet" type="button" id="discard-local">丢弃草稿</button></p>' : ""}
        <div id="readiness-slot"></div>
        ${live ? `<button type="button" class="up-next-card" data-workout="step" data-step="1" hidden>
          <span class="up-next-kicker">这之后</span>
          <strong data-next-name></strong>
        </button>
        <div class="exercise-circle-bar" data-circle-bar hidden>
          <div class="exercise-jump" role="group" aria-label="切换动作"></div>
          <div class="exercise-bar-right">
            <div class="session-live-muscles" data-live-muscles hidden></div>
            <button type="button" class="workout-circle-btn add-circle-btn" data-workout="open-picker" aria-label="添加动作">${icon("plus", 16)}</button>
          </div>
        </div>` : ""}
        <div id="workout-rows"></div>
        ${live ? `<div class="workout-step-nav" data-step-nav hidden>
          <button type="button" class="step-nav-btn" data-workout="step" data-step="-1">${icon("back", 15)}<span>上一个</span></button>
          <button type="button" class="step-nav-btn" data-workout="step" data-step="1"><span data-step-next-label>下一个</span>${icon("chevron", 15)}</button>
        </div>
        <div class="workout-bottom-list" data-bottom-list hidden>
          <button type="button" class="workout-list-row is-accent" data-workout="open-picker">${icon("plus", 17)}<span>添加训练动作</span></button>
          <button type="button" class="workout-list-row" data-workout="open-notes" aria-expanded="false">${icon("book", 16)}<span>添加训练备注</span>${icon("chevron", 15)}</button>
          <div class="workout-quick-note-box" data-quick-note-box hidden>
            <textarea rows="2" maxlength="4000" data-quick-notes placeholder="记录本次组间体感或下次调整…">${esc(local?.notes ?? data.notes)}</textarea>
          </div>
        </div>` : `<button type="button" class="secondary-button workout-inline-add-btn" data-workout="open-picker"${rows.length === 0 ? " hidden" : ""}>${icon("plus", 16)} 添加训练动作</button>
        <details class="training-details" open><summary><span>训练信息</span>${icon("chevron", 14)}</summary>
        <div class="details-body">
          ${field("训练名称", input("title", title, 'maxlength="120" required'))}
          <div class="fields">${commonFields("workout", { date: initialDate }, record)}
            ${field("手动时长", inputGroup("minutes", local?.minutes ?? (previousDuration == null ? "" : Math.round(previousDuration / 60 * 100) / 100), "分钟", 'placeholder="自动计时" type="number" inputmode="decimal" min="0" max="10080" step="0.01"'))}</div>
          <div class="session-options">
            <label class="switch-chip"><span>显示 RIR 列</span><input class="switch" type="checkbox" name="toggleRirEdit"${showRir ? " checked" : ""}></label>
          </div>
          ${record ? '<div class="details-actions"><button id="remove-record" class="danger" type="button">删除记录</button><span></span></div>' : ""}
        </div></details>`}
        <section class="finish-panel" aria-label="训练小结"${live ? " hidden" : ""}>
          ${live ? '<div class="finish-summary-slot" data-finish-summary></div>' : ""}
          <fieldset><legend>训练体感</legend><div class="feeling-choices">${Object.entries(feelings).map(([key, label]) =>
            `<label><input type="radio" name="feeling" value="${key}"${selectedFeeling === key ? " checked" : ""}><span>${label}</span></label>`).join("")}</div>
            <button class="quiet" type="button" data-workout="clear-feeling"${selectedFeeling ? "" : " hidden"}>清除体感</button></fieldset>
          ${field("备注（可选）", `<textarea name="notes" maxlength="4000" rows="2" placeholder="记录本次组间体感或下次调整…">${esc(local?.notes ?? data.notes)}</textarea>`)}
        </section>
      </div>
      ${live ? `<div class="session-menu-overlay" data-session-menu hidden aria-label="训练设置与更多操作">
        <header class="rest-dial-head">
          <span>${icon("settings", 16)} 训练设置与更多</span>
          <button type="button" class="secondary-button picker-close-btn" data-workout="close-session-menu">完成</button>
        </header>
        <div class="session-menu-body">
          <div class="session-menu-quick">
            <button type="button" class="secondary-button ai-adapt-btn" data-adapt="open">${icon("bolt", 14)} AI 训中调整</button>
            <button type="button" class="secondary-button" data-workout="toggle-rir" aria-pressed="${showRir}">RIR 列：${showRir ? "开" : "关"}</button>
            <button type="button" class="secondary-button" data-workout="toggle-layout" aria-pressed="${!guided}">${guided ? "单步视图" : "全部视图"}</button>
          </div>
          <div class="details-body">
            ${field("训练名称", input("title", title, 'maxlength="120" required'))}
            <div class="fields">${commonFields("workout", { date: initialDate }, record)}
              ${field("手动时长", inputGroup("minutes", local?.minutes ?? "", "分钟", 'placeholder="自动计时" type="number" inputmode="decimal" min="0" max="10080" step="0.01"'))}</div>
            <div class="session-options">
              <label class="switch-chip"><span>按键与休息提示音</span><input class="switch" type="checkbox" name="restSound"${localStorage.getItem(soundPreference) !== "off" ? " checked" : ""}></label>
              <label class="switch-chip"><span>自动展开休息表盘</span><input class="switch" type="checkbox" name="autoDial"${localStorage.getItem(dialPreference) === "on" ? " checked" : ""}></label>
              ${"Notification" in window ? `<label class="switch-chip" title="切到后台时推送休息结束提醒"><span>后台休息提醒</span><input class="switch" type="checkbox" name="restNotify"${Notification.permission === "granted" && localStorage.getItem(notifyPreference) !== "off" ? " checked" : ""}></label>` : ""}
              ${supportsWake ? `<label class="switch-chip" title="训练计时期间保持屏幕常亮"><span>屏幕常亮<span data-wake-status class="visually-hidden" role="status"></span></span><input class="switch" type="checkbox" name="keepScreen"${localStorage.getItem(screenPreference) === "on" ? " checked" : ""}></label>` : ""}
            </div>
            <div class="details-actions">${record ? '<button id="remove-record" class="danger" type="button">删除记录</button>' : "<span></span>"}<button class="secondary-button" type="button" data-workout="save-draft">存为草稿</button></div>
          </div>
        </div>
      </div>` : ""}
      <div class="picker-overlay workout-picker" data-picker-overlay${rows.length ? " hidden" : ""} aria-label="添加动作">
        <header class="picker-overlay-head">
          <strong data-picker-title>${icon("plus", 16)} 添加训练动作</strong>
          <button type="button" class="secondary-button picker-close-btn" data-workout="close-picker">返回训练</button>
        </header>
        <div class="swap-mode-banner" data-swap-banner hidden></div>
        <label class="search picker-search">${icon("search")}<input id="exercise-query" type="search" enterkeyhint="search" maxlength="120" placeholder="搜索动作名称或别名（如 卧推、深蹲、划船）" aria-label="搜索动作"></label>
        <div class="muscle-pills picker-muscles" role="group" aria-label="按肌群快速筛选">${Object.entries({ "": "全部", __fav__: "★ 收藏", chest: "胸", back: "背", legs: "腿", shoulders: "肩", arms: "臂", core: "核心" }).map(([val, label]) =>
          `<button type="button" data-picker-muscle="${val}" aria-pressed="${val === ""}">${label}</button>`).join("")}</div>
        ${(() => {
          const userEquip = getUserEquipment?.() ?? [];
          const equipOpts = [
            ["", "全部器械"],
            ...(userEquip.length ? [["__mine__", "我的器械"]] : []),
            ["barbell", "杠铃"], ["dumbbell", "哑铃"], ["machine", "器械"], ["cable", "绳索"],
            ["bodyweight", "自重"], ["kettlebell", "壶铃"], ["band", "弹力带"],
          ];
          return `<div class="muscle-pills picker-equipment" role="group" aria-label="按器械筛选">${equipOpts.map(([val, label]) =>
            `<button type="button" data-picker-equipment="${val}" aria-pressed="${val === ""}">${label}</button>`).join("")}</div>`;
        })()}
        <div id="matches" class="picker-results"></div>
        ${onCreateCustomExercise ? `<footer class="picker-overlay-foot"><button type="button" class="quiet picker-create-custom" data-workout="create-custom-exercise">${icon("plus", 15)} 没找到想要的？新建自定义动作</button></footer>` : ""}
      </div>
      <div class="rest-dial-overlay" hidden aria-label="组间休息表盘">
        <span class="crosshair tl" aria-hidden="true"></span><span class="crosshair br" aria-hidden="true"></span>
        <header class="rest-dial-head"><span><i aria-hidden="true"></i> 组间休息</span>
          <button type="button" class="quiet" data-clock="dial-close">收起表盘</button></header>
        <div class="rest-dial-face">
          <svg class="rest-dial-svg" viewBox="0 0 260 260" aria-hidden="true">${renderDialTicks(1)}</svg>
          <div class="rest-dial-readout">
            <strong data-dial-time>${matrix("00:00")}</strong>
            <span data-dial-sub>组间恢复</span>
          </div>
        </div>
        <div class="rest-dial-next" data-dial-next hidden></div>
        <div class="rest-dial-controls">
          <button type="button" class="secondary-button" data-clock="sub15">-15 秒</button>
          <button type="button" class="primary-button" data-clock="skip">跳过休息</button>
          <button type="button" class="secondary-button" data-clock="add15">+15 秒</button>
        </div>
        <div class="rest-dial-presets" role="group" aria-label="快速设定休息时长">${[60, 90, 120, 180].map((sec) =>
          `<button type="button" class="stepper-pill" data-clock-preset="${sec}">${sec}s</button>`).join("")}</div>
      </div>
      ${live ? `<div class="ai-adapt-overlay" data-adapt-overlay hidden aria-label="AI 训中调整">
        <header class="rest-dial-head"><span>${icon("bolt", 16)} AI 训中实时调整</span>
          <button type="button" class="quiet" data-adapt="close">返回记录</button></header>
        <div class="ai-adapt-body">
          <p class="muted">根据你此刻的剩余时间或身体状态，仅对尚未完成的训练组提出调整，已打卡组不受影响。</p>
          <div class="ai-presets" role="group" aria-label="常见训中状况">
            <button type="button" class="ai-chip" data-adapt-preset="时间不太够，只剩 15 分钟，请精简后续训练组并缩短休息">赶时间精简</button>
            <button type="button" class="ai-chip" data-adapt-preset="今天有点疲劳，请适当降低余下重量或组数以保持动作质量">疲劳降载</button>
            <button type="button" class="ai-chip" data-adapt-preset="目前状态很好，未完成工作组可以微调加重冲一下状态">状态好加量</button>
          </div>
          <label class="field"><span>当前状况或要求</span><textarea rows="2" maxlength="1000" data-adapt-input placeholder="例如：肩前束有点酸，不想推举了，或者只剩 20 分钟"></textarea></label>
          <p class="form-error" data-adapt-error hidden></p>
          <div class="ai-adapt-proposal" data-adapt-proposal hidden></div>
        </div>
        <footer class="ai-adapt-foot">
          <button type="button" class="secondary-button" data-adapt="ask">${icon("bolt", 15)} 获取建议</button>
          <button type="button" class="primary-button" data-adapt="apply" hidden>应用所选调整</button>
        </footer>
      </div>` : ""}
      <footer class="session-dock">
        <p class="form-error" data-form-error role="alert" hidden></p>
        <div class="undo-banner" data-undo-banner hidden></div>
        <div class="rest-clock" hidden>
          <div class="rest-top-progress" aria-hidden="true"><i data-rest-progress-fill></i></div>
          <div class="rest-clock-inner">
            <button type="button" class="rest-dock-trigger" data-clock="dial-open" aria-label="展开组间休息表盘">
              <strong role="timer" aria-label="组间休息倒计时" data-rest-time>${matrix("0:00")}</strong>
              <span data-rest-label><i class="rest-led" aria-hidden="true"></i>休息 ${icon("arrowDown", 11)}</span>
            </button>
            <div class="rest-dock-buttons">
              <button type="button" class="rest-pill-btn" data-clock="sub15">− 15s</button>
              <button type="button" class="rest-pill-btn" data-clock="add15">+ 15s</button>
              <button type="button" class="rest-pill-btn rest-pause-btn" data-clock="pause-rest" aria-label="暂停休息计时">${icon("pause", 14)}</button>
              <button type="button" class="rest-skip-btn" data-clock="skip">跳过</button>
            </div>
          </div>
          <span class="visually-hidden" data-rest-announcement role="status"></span>
        </div>
        <div class="session-dock-actions"${live ? " hidden" : ""}>
          ${live ? `<button type="button" class="secondary-button" data-workout="back-from-finish" hidden>返回记录</button>` : ""}
          <button class="primary-button finish-save" type="submit" value="finish"${live ? " hidden" : ""}>${live ? "保存并完成" : "保存训练"}</button>
        </div>
      </footer>
    </form>`, true, "workout");
    dialog.classList.toggle("is-live-workout", live);

    const form = $("#editor-form");
    const scroller = $(".workout-scroll", form);
    form.dataset.draft = draftKey;
    $("#discard-local")?.addEventListener("click", () => {
      form.dataset.saved = "true";
      forgetDraft(draftKey);
      closeWorkout?.();
      onDraft?.();
      editWorkout(record, { ...data, ...(template ? { templateKey: template } : {}), exerciseMeta: seedExerciseMeta }, settings);
    });
    function remember() {
      if (!draftKey || !form.isConnected) return;
      const values = Object.fromEntries(new FormData(form).entries());
      try { localStorage.setItem(draftKey, JSON.stringify({ ...values, startedAt: started, exercises: rows,
        timing: pauseAt(timing, Date.now()), rest, focusId: rows[focusRow]?.id })); } catch {}
    }
    function markDirty() { dirty = true; remember(); }
    const list = $("#workout-rows");
    const dateInput = $('[name="date"]', form);
    const error = $("[data-form-error]", form) ?? $(".form-error", form);
    function startFor(date) {
      if (record && date === data.date) return started;
      return date === today() ? started : new Date(date + "T00:00:00+08:00").toISOString();
    }

    function nextPendingDescription() {
      const targetRow = rows[focusRow];
      if (!targetRow) return "";
      const nextIndex = targetRow.sets.findIndex((entry) => !entry.completed);
      if (nextIndex >= 0) {
        const entry = targetRow.sets[nextIndex];
        const mode = targetRow.snapshot?.mode ?? "reps";
        const val = mode === "timed" ? `${entry.seconds} 秒`
          : entry.weight ? `${entry.weight} kg × ${entry.reps}` : `${entry.reps} 次`;
        return `下一组 · ${exerciseLabel(targetRow)} · 第 ${nextIndex + 1} 组 · ${val}`;
      }
      const nextRow = rows[focusRow + 1];
      return nextRow ? `下个动作 · ${exerciseLabel(nextRow)}` : "所有预设组已完成 · 可结束训练";
    }

    function updateSetInlineMetas(section, row, rowIndex) {
      const equipKey = row.snapshot?.equipment ?? exerciseDetails.get(row.exerciseId)?.equipment;
      const mode = row.snapshot?.mode ?? "reps";
      const baseline = prBaselines.get(row.exerciseId + ":" + mode);
      const timed = mode === "timed";
      const orderedIndices = [
        ...row.sets.flatMap((s, i) => (s.type === "warmup" ? [i] : [])),
        ...row.sets.flatMap((s, i) => (s.type !== "warmup" ? [i] : [])),
      ];
      let prevWeight = null;
      for (const sIdx of orderedIndices) {
        const entry = row.sets[sIdx];
        const metaEl = $(`[data-inline-meta="${rowIndex}:${sIdx}"]`, section);
        if (!metaEl) continue;
        let leftHtml = "";
        let rightHtml = "";
        if (!timed && equipKey === "barbell" && entry.weight > barWeight) {
          const calc = plateBreakdown(entry.weight, barWeight, enabledPlates);
          if (calc.valid && calc.plates.length) {
            const platesLabel = calc.plates.join(" + ");
            const isFirst = prevWeight === null;
            const prefix = isFirst ? `${barWeight} kg 杠铃杆上每侧` : "每侧";
            leftHtml += `<button type="button" class="set-plate-line" data-workout="toggle-plate-config" data-row-id="${esc(row.id)}" title="设置杠铃杆与可用杠铃片">◎ ${prefix} ${esc(platesLabel)}${calc.remainder > 0 ? ` (+${calc.remainder})` : ""}</button>`;
            const delta = prevWeight !== null ? plateDeltaLabel(prevWeight, entry.weight, barWeight, enabledPlates) : "";
            if (delta) rightHtml += `<span class="set-plate-delta">${esc(delta)}</span>`;
          }
        }
        if (entry.weight > 0) prevWeight = entry.weight;
        const prHits = setBeatenPrs(row, entry);
        let prHtml = "";
        if (prHits.length) {
          prHtml = `<span class="set-pr-chip${entry.completed ? " is-achieved" : ""}">${icon("trending", 12)} ${entry.completed ? `新纪录！${esc(prHits[0].label)}` : `${esc(prHits[0].label)} · 完成即破纪录`}</span>`;
        } else if (mode === "reps" && entry.type !== "warmup" && !entry.completed && baseline?.oneRepMax > 0 && entry.weight > 0 && entry.reps > 0) {
          const curEst = estimated1RM(entry.weight, entry.reps);
          const pct = Math.round((curEst / baseline.oneRepMax) * 100);
          if (pct >= 88) {
            let needReps = null;
            for (let r = entry.reps + 1; r <= entry.reps + 3; r++) {
              if (round2(estimated1RM(entry.weight, r)) > baseline.oneRepMax) {
                needReps = r - entry.reps;
                break;
              }
            }
            if (needReps !== null) {
              prHtml = `<span class="set-pr-hint">${icon("trending", 12)} 这个重量再多 ${needReps} 次就是纪录 · 最佳 e1RM 的 ${pct}%</span>`;
            }
          }
        }
        let holdHtml = "";
        if (timed && live && !entry.completed) {
          const running = activeHold && activeHold.rowId === row.id && activeHold.setId === entry.id;
          const holdSec = running ? Math.max(0, Math.floor((Date.now() - activeHold.startedAt) / 1000)) : 0;
          holdHtml = `<button type="button" class="stepper-pill ${running ? "is-hold-running" : "stepper-clone"}" data-workout="hold-timer" data-row="${rowIndex}" data-index="${sIdx}">${running ? `● <span data-hold-clock>${formatClock(holdSec)}</span> · 停止打卡` : `${icon("clock", 12)} 开始计时`}</button>`;
        }
        const hasBody = Boolean(leftHtml || rightHtml || prHtml || holdHtml);
        metaEl.hidden = !hasBody;
        if (!hasBody) { metaEl.innerHTML = ""; continue; }
        const topLine = (leftHtml || rightHtml) ? `<div class="set-inline-top">${leftHtml}${rightHtml}</div>` : "";
        const botLine = (prHtml || holdHtml) ? `<div class="set-inline-bot">${prHtml}${holdHtml}</div>` : "";
        metaEl.innerHTML = `${topLine}${botLine}`;
      }
    }

    function updatePlateHint(section, row) {
      const host = $("[data-plate-math]", section);
      if (!host) return;
      const isConfigOpen = plateConfigRowId === row.id;
      if (!isConfigOpen) { host.hidden = true; host.innerHTML = ""; return; }
      host.hidden = false;
      host.innerHTML = `<div class="plate-config-pop">
        <div class="plate-inv-row"><span>杠铃杆</span><div class="plate-inv-pills">${BAR_PRESETS.map(([w, lbl]) =>
          `<button type="button" class="stepper-pill" data-plate-bar="${w}" aria-pressed="${barWeight === w}">${lbl}</button>`).join("")}</div></div>
        <div class="plate-inv-row"><span>可用配片 (kg)</span><div class="plate-inv-pills">${ALL_PLATES.map((p) =>
          `<button type="button" class="stepper-pill" data-plate-toggle="${p}" aria-pressed="${enabledPlates.includes(p)}">${p}</button>`).join("")}</div></div>
      </div>`;
    }

    function rowMeta(row, index) {
      return plannedMeta.get(row.exerciseId + ":" + (row.targetIndex ?? index))
        ?? plannedMeta.get(row.exerciseId + ":" + index)
        ?? null;
    }

    function setBeatenPrs(row, entry) {
      if (!entry || entry.type === "warmup") return [];
      const mode = row.snapshot?.mode ?? "reps";
      const baseline = prBaselines.get(row.exerciseId + ":" + mode);
      if (!baseline) return [];
      const hits = [];
      if (mode === "timed") {
        if (baseline.hold != null && entry.seconds > baseline.hold) {
          hits.push({ metric: "hold", label: `时长 PR ${entry.seconds}s`, prev: baseline.hold, cur: entry.seconds });
        }
      } else if (mode === "assisted") {
        if (entry.reps > 0 && baseline.assistance != null && entry.weight < baseline.assistance) {
          hits.push({ metric: "assistance", label: `辅助 PR ${fmt(entry.weight)}kg`, prev: baseline.assistance, cur: entry.weight });
        }
      } else if (entry.weight > 0 && entry.reps > 0) {
        if (baseline.weight != null && entry.weight > baseline.weight) {
          hits.push({ metric: "weight", label: `重量 PR ${fmt(entry.weight)}kg`, prev: baseline.weight, cur: entry.weight });
        }
        if (entry.reps <= 10 && baseline.oneRepMax != null) {
          const est = round2(estimated1RM(entry.weight, entry.reps));
          if (est > baseline.oneRepMax) {
            hits.push({ metric: "oneRepMax", label: `1RM PR ${fmt(est)}kg`, prev: baseline.oneRepMax, cur: est });
          }
        }
      }
      return hits;
    }

    function computeLiveSessionStats() {
      let vol = 0, refVol = 0, workSets = 0, unfinishedCount = 0;
      const prByKey = new Map();
      for (const row of rows) {
        const mode = row.snapshot?.mode ?? "reps";
        const mult = row.snapshot?.volumeMultiplier ?? 1;
        for (const entry of row.sets) {
          if (entry.type === "warmup") continue;
          const valid = mode === "timed" ? entry.seconds > 0 : entry.reps > 0;
          if (entry.completed) {
            if (valid) workSets++;
            if (mode === "reps" && entry.weight > 0 && entry.reps > 0) {
              vol += entry.weight * entry.reps * mult;
            }
            for (const hit of setBeatenPrs(row, entry)) {
              const k = `${row.exerciseId}:${hit.metric}`;
              const prev = prByKey.get(k);
              const better = !prev || (hit.metric === "assistance" ? hit.cur < prev.cur : hit.cur > prev.cur);
              if (better) prByKey.set(k, { name: exerciseLabel(row), ...hit });
            }
          } else if (valid) {
            unfinishedCount++;
          }
        }
        if (mode === "reps") {
          const prevSets = references.get(row.exerciseId);
          if (Array.isArray(prevSets)) {
            for (const prev of prevSets) {
              if (prev?.weight > 0 && prev?.reps > 0) refVol += prev.weight * prev.reps * mult;
            }
          }
        }
      }
      return { vol, refVol, workSets, unfinishedCount, beatenPrs: [...prByKey.values()] };
    }

    function renderFinishSummary() {
      const host = $("[data-finish-summary]", form);
      if (!host) return;
      const { vol, refVol, workSets, unfinishedCount, beatenPrs } = computeLiveSessionStats();
      const elapsedSec = elapsedAt(timing, Date.now());
      const diff = refVol > 0 && vol > 0 ? Math.round(vol - refVol) : null;
      host.innerHTML = `<div class="finish-summary-card">
        <div class="finish-summary-grid">
          <div><span>有效工作组</span><strong>${workSets} <small>组</small></strong></div>
          <div><span>完成总容量</span><strong>${Math.round(vol).toLocaleString("zh-CN")} <small>kg</small></strong>${diff != null && diff > 0 ? `<em class="finish-delta is-up">+${diff.toLocaleString("zh-CN")}</em>` : ""}</div>
          <div><span>已用时长</span><strong>${formatClock(elapsedSec)}</strong></div>
        </div>
        ${beatenPrs.length ? `<div class="finish-pr-list">${beatenPrs.map((p) =>
          `<span>${icon("trophy", 12)} <b>${esc(p.name)}</b> · ${esc(p.label)}</span>`).join("")}</div>` : ""}
        ${unfinishedCount > 0 ? `<div class="finish-uncheck-alert" role="status">
          <span>还有 <b>${unfinishedCount}</b> 组未勾选（保存时仅计入已勾选组）</span>
          <div class="finish-uncheck-actions">
            <button type="button" class="quiet" data-workout="check-remaining">全部补勾</button>
            <button type="button" class="quiet" data-workout="back-from-finish">返回核对</button>
          </div>
        </div>` : ""}
      </div>`;
    }

    function updateLiveMetrics() {
      const { vol, refVol } = computeLiveSessionStats();
      const volEl = $("[data-live-volume]", form);
      if (volEl) {
        volEl.textContent = `${Math.round(vol).toLocaleString("zh-CN")} kg`;
        volEl.title = refVol > 0 ? `较上次 ${vol >= refVol ? "+" : ""}${Math.round(vol - refVol)} kg` : "";
      }
      $$(".exercise-editor", form).forEach((section, index) => {
        const row = rows[index];
        if (!row) return;
        const mode = row.snapshot?.mode ?? "reps";
        const mult = row.snapshot?.volumeMultiplier ?? 1;
        const baseline = prBaselines.get(row.exerciseId + ":" + mode);
        const bestTagEl = $("[data-exercise-best]", section);
        if (bestTagEl) {
          if (baseline) {
            const bestStr = mode === "timed" ? `最佳: ${baseline.hold ?? 0} 秒`
              : mode === "assisted" ? `最佳辅助: ${fmt(baseline.assistance)} kg`
              : baseline.weight != null ? `最佳: ${fmt(baseline.weight)} kg`
              : baseline.oneRepMax != null ? `最佳 1RM: ${fmt(baseline.oneRepMax)} kg` : "";
            bestTagEl.hidden = !bestStr;
            bestTagEl.textContent = bestStr;
          } else {
            bestTagEl.hidden = true;
            bestTagEl.textContent = "";
          }
        }
        const oneRmEl = $("[data-exercise-1rm]", section);
        if (oneRmEl) {
          if (mode !== "reps") { oneRmEl.textContent = ""; }
          else {
            const candidates = row.sets.filter((entry) => entry.type !== "warmup" && entry.weight > 0 && entry.reps > 0);
            const completed = candidates.filter((entry) => entry.completed);
            const pool = completed.length ? completed : candidates;
            let best = 0;
            let usedRir = false;
            for (const entry of pool) {
              const rir = entry.rir != null && Number.isFinite(entry.rir) && entry.rir > 0 && entry.rir <= 4 ? entry.rir : 0;
              const est = estimated1RM(entry.weight, Math.min(entry.reps + rir, 12));
              if (est > best) {
                best = est;
                usedRir = rir > 0;
              }
            }
            oneRmEl.textContent = best > 0 ? `估算 1RM ${Math.round(best * 10) / 10} kg${usedRir ? " (含RIR)" : ""}` : "";
          }
        }
        const exVolEl = $("[data-exercise-vol]", section);
        if (exVolEl) {
          if (mode !== "reps") {
            exVolEl.textContent = "";
          } else {
            let exVol = 0;
            for (const entry of row.sets) {
              if (entry.completed && entry.type !== "warmup" && entry.weight > 0 && entry.reps > 0) {
                exVol += entry.weight * entry.reps * mult;
              }
            }
            let exRefVol = 0;
            for (const prev of references.get(row.exerciseId) ?? []) {
              if (prev?.weight > 0 && prev?.reps > 0) exRefVol += prev.weight * prev.reps * mult;
            }
            exVolEl.textContent = exVol > 0
              ? `本项 ${Math.round(exVol).toLocaleString("zh-CN")} kg${exRefVol > 0 && exVol > exRefVol ? ` (+${Math.round(exVol - exRefVol)})` : ""}`
              : "";
          }
        }
        const prEl = $("[data-exercise-pr]", section);
        if (prEl) {
          const completedBestHits = row.sets.filter((s) => s.completed).flatMap((s) => setBeatenPrs(row, s));
          const previewHits = row.sets.flatMap((s) => setBeatenPrs(row, s));
          if (completedBestHits.length) {
            prEl.className = "exercise-pr-line is-pr";
            prEl.innerHTML = `${icon("trophy", 12)} <b>新纪录！</b>${esc(completedBestHits[0].label)}（原 ${fmt(completedBestHits[0].prev)}）`;
          } else if (previewHits.length) {
            prEl.className = "exercise-pr-line is-pr-pending";
            prEl.innerHTML = `${icon("trophy", 12)} 完成即刷新 ${esc(previewHits[0].label)}`;
          } else {
            prEl.className = "exercise-pr-line";
            prEl.textContent = "";
          }
        }
        updateSetInlineMetas(section, row, index);
        updatePlateHint(section, row);
      });
      const musclesHost = $("[data-live-muscles]", form);
      if (musclesHost) {
        const tracked = new Set(["chest", "back", "legs", "shoulders", "arms", "core"]);
        let completedWorkCount = 0;
        const doneMap = new Map();
        const planMap = new Map();
        for (const row of rows) {
          const primary = row.snapshot?.muscle ?? exerciseDetails.get(row.exerciseId)?.muscle;
          const secondary = (exerciseDetails.get(row.exerciseId)?.secondaryMuscles ?? [])
            .filter((s) => s !== primary && tracked.has(s));
          for (const s of row.sets) {
            if (s.type === "warmup") continue;
            if (primary && (tracked.has(primary) || primary === "cardio")) {
              planMap.set(primary, (planMap.get(primary) ?? 0) + 1);
            }
            for (const sec of new Set(secondary)) {
              planMap.set(sec, (planMap.get(sec) ?? 0) + 0.5);
            }
            if (s.completed) {
              completedWorkCount++;
              if (primary && (tracked.has(primary) || primary === "cardio")) {
                doneMap.set(primary, (doneMap.get(primary) ?? 0) + 1);
              }
              for (const sec of new Set(secondary)) {
                doneMap.set(sec, (doneMap.get(sec) ?? 0) + 0.5);
              }
            }
          }
        }
        const activeMap = completedWorkCount > 0 ? doneMap : planMap;
        const items = [...activeMap.entries()]
          .map(([k, v]) => [k, Math.round(v * 10) / 10])
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2);
        musclesHost.hidden = items.length === 0;
        musclesHost.innerHTML = items.length
          ? items.map(([k, v]) => `<span>${esc(muscles[k] ?? k)} <b>${fmt(v)}</b></span>`).join("")
          : "";
      }
    }

    function isRowCompleted(row) {
      return Boolean(row?.sets?.length) && row.sets.every((entry) => entry.completed);
    }
    function findNextPendingRow(fromIndex) {
      for (let i = fromIndex + 1; i < rows.length; i++) {
        if (!isRowCompleted(rows[i])) return i;
      }
      for (let i = 0; i < fromIndex; i++) {
        if (!isRowCompleted(rows[i])) return i;
      }
      return -1;
    }
    function clearAutoAdvance() {
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = 0;
      }
    }
    function showStepNotice(message, backRowIndex) {
      clearTimeout(stepNoticeTimer);
      stepNotice = { message, backRowIndex };
      renderUndoBanner();
      stepNoticeTimer = setTimeout(() => {
        stepNotice = null;
        renderUndoBanner();
      }, 4500);
    }

    function syncDockVisibility() {
      if (!live) return;
      const dock = $(".session-dock", form);
      const restBanner = $(".rest-clock", form);
      const undoBanner = $("[data-undo-banner]", form);
      if (!dock) return;
      const hasAlert = !error.hidden || (undoBanner && !undoBanner.hidden) || (restBanner && !restBanner.hidden);
      dock.hidden = !reviewing && !hasAlert;
    }

    function updateProgress() {
      const done = rows.reduce((sum, row) => sum + row.sets.filter((entry) => entry.completed).length, 0);
      const total = rows.reduce((sum, row) => sum + row.sets.length, 0);
      form.dataset.layout = guided ? "focus" : "list";
      form.classList.toggle("show-rir", showRir);
      const pickerEl = $("[data-picker-overlay]", form);
      const inlineAddBtn = $(".workout-inline-add-btn", form);
      if (inlineAddBtn) inlineAddBtn.hidden = reviewing || (live && guided) || rows.length === 0;
      if (live) {
        $("[data-set-count]", form).textContent = `${done}/${total} 组`;
        $(".workout-progress-strip progress", form).value = total ? done / total : 0;
        const circleBar = $("[data-circle-bar]", form);
        if (circleBar) circleBar.hidden = reviewing || rows.length === 0;
        const upNextCard = $(".up-next-card", form);
        const hasNext = !reviewing && guided && focusRow < rows.length - 1;
        if (upNextCard) {
          upNextCard.hidden = !hasNext;
          const nextNameEl = $("[data-next-name]", upNextCard);
          if (nextNameEl) {
            const nextRow = rows[focusRow + 1];
            const nextEn = nextRow ? exerciseDetails.get(nextRow.exerciseId)?.englishName : "";
            nextNameEl.textContent = nextRow ? `${exerciseLabel(nextRow)}${nextEn && nextEn !== exerciseLabel(nextRow) ? ` (${nextEn})` : ""}` : "";
          }
        }
        const stepNav = $("[data-step-nav]", form);
        if (stepNav) {
          stepNav.hidden = reviewing || !guided || rows.length < 2;
          const prevBtn = $('[data-step="-1"]', stepNav);
          const nextBtn = $('[data-step="1"]', stepNav);
          if (prevBtn) prevBtn.disabled = focusRow <= 0;
          if (nextBtn) nextBtn.disabled = focusRow >= rows.length - 1;
        }
        const bottomList = $("[data-bottom-list]", form);
        if (bottomList) bottomList.hidden = reviewing || rows.length === 0;
        form.classList.toggle("has-next", hasNext);
        const finishBtn = $(".finish-trigger", form);
        if (finishBtn) finishBtn.hidden = reviewing;
        const topBackBtn = $('.workout-topbar [data-workout="back-from-finish"]', form);
        if (topBackBtn) topBackBtn.hidden = !reviewing;
        const dockActions = $(".session-dock-actions", form);
        if (dockActions) dockActions.hidden = !reviewing;
        const dockBack = $('.session-dock [data-workout="back-from-finish"]', form);
        if (dockBack) dockBack.hidden = !reviewing;
        const saveBtn = $(".finish-save", form);
        if (saveBtn) saveBtn.hidden = !reviewing;
        if (pickerEl && reviewing) pickerEl.hidden = true;
        const menuEl = $("[data-session-menu]", form);
        if (menuEl) {
          if (reviewing) sessionMenuOpen = false;
          menuEl.hidden = !sessionMenuOpen;
          $('[data-workout="toggle-session-menu"]', form)?.setAttribute("aria-expanded", String(sessionMenuOpen));
          sessionMenuToken = syncOverlayToken(sessionMenuToken, !menuEl.hidden, () => {
            sessionMenuOpen = false;
            sessionMenuToken = null;
            updateProgress();
          });
        }
        const rirMenuBtn = $('.session-menu-overlay [data-workout="toggle-rir"]', form);
        if (rirMenuBtn) {
          rirMenuBtn.setAttribute("aria-pressed", String(showRir));
          rirMenuBtn.textContent = `RIR 列：${showRir ? "开" : "关"}`;
        }
        const layoutMenuBtn = $('.session-menu-overlay [data-workout="toggle-layout"]', form);
        if (layoutMenuBtn) {
          layoutMenuBtn.setAttribute("aria-pressed", String(!guided));
          layoutMenuBtn.textContent = guided ? "单步视图" : "全部视图";
        }
        syncDockVisibility();
      }
      $$(".exercise-jump button", form).forEach((button, index) => {
        const sets = rows[index]?.sets ?? [];
        button.classList.toggle("finished", sets.length > 0 && sets.every((entry) => entry.completed));
        const isCurrent = index === focusRow;
        button.setAttribute("aria-pressed", String(isCurrent));
        if (isCurrent) {
          requestAnimationFrame(() => {
            try { button.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); } catch {}
          });
        }
      });
      const allDone = rows.length > 0 && rows.every((row) => isRowCompleted(row));
      const nextPending = findNextPendingRow(focusRow);
      $$(".exercise-editor", form).forEach((section, index) => {
        section.hidden = (guided && index !== focusRow) || (live && reviewing);
        const sets = rows[index].sets;
        $("[data-exercise-count]", section).textContent = `${sets.filter((entry) => entry.completed).length} / ${sets.length} 组`;
        const next = live && index === focusRow ? sets.findIndex((entry) => !entry.completed) : -1;
        $$(".set-row", section).forEach((element) => {
          const pos = Number(element.dataset.index);
          element.classList.toggle("is-next", pos === next);
          element.classList.toggle("is-complete", Boolean(sets[pos]?.completed));
        });
        const callout = $("[data-complete-callout]", section);
        if (callout) {
          const rowDone = live && isRowCompleted(rows[index]);
          callout.hidden = !rowDone;
          if (rowDone) {
            if (allDone) {
              callout.innerHTML = `<span>全部 ${rows.length} 个动作已完成，可补组或结束训练</span>
                <button type="button" class="primary-button" data-workout="finish-review">进入训练小结</button>`;
            } else if (nextPending >= 0) {
              const target = rows[nextPending];
              callout.innerHTML = `<span>本动作已完成</span>
                <button type="button" class="primary-button" data-workout="focus-row" data-row="${nextPending}">下一动作：${esc(exerciseLabel(target))}</button>`;
            }
          }
        }
      });
      updateLiveMetrics();
    }

    function jumpTo(index, animate = true) {
      clearAutoAdvance();
      const previous = focusRow;
      focusRow = Math.max(0, Math.min(rows.length - 1, index));
      updateProgress();
      const section = $(`[data-row-index="${focusRow}"]`, list);
      if (section && scroller) {
        const top = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        if (!guided || top < 0 || top > scroller.clientHeight * 0.5) scroller.scrollTop += top - 6;
        const jump = $(".exercise-jump", form), active = jump?.children[focusRow];
        if (active && jump.scrollWidth > jump.clientWidth + 2) {
          jump.scrollTo({ left: Math.max(0, active.offsetLeft - (jump.clientWidth - active.offsetWidth) / 2), behavior: animate ? "smooth" : "instant" });
        }
        if (guided && animate && focusRow !== previous && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const distance = focusRow > previous ? 8 : -8;
          section.animate?.([{ opacity: .65, transform: `translateX(${distance}px)` },
            { opacity: 1, transform: "translateX(0)" }], { duration: 140, easing: "ease-out" });
        }
      }
      if (dirty) remember();
    }

    function referenceForSet(row, setIndex) {
      const entry = row?.sets?.[setIndex];
      if (!entry || entry.type === "warmup") return null;
      let workIdx = 0;
      for (let i = 0; i < setIndex; i++) {
        if (row.sets[i]?.type !== "warmup") workIdx++;
      }
      return references.get(row.exerciseId)?.[workIdx] ?? null;
    }

    function updateReferences() {
      $$(".exercise-editor", form).forEach((section, index) => {
        const row = rows[index];
        if (!row) return;
        const lastHost = $("[data-ex-last-summary]", section);
        if (lastHost) {
          const prevSets = references.get(row.exerciseId) ?? [];
          const mode = row.snapshot?.mode ?? "reps";
          const canApply = row.sets.some((entry, idx) => !entry.completed && !!referenceForSet(row, idx));
          if (prevSets.length) {
            const parts = prevSets.slice(0, 6).map((p) => mode === "timed" ? `${p.seconds}s` : `${fmt(p.weight)}×${p.reps}`);
            lastHost.hidden = false;
            lastHost.innerHTML = `<span>上次: ${esc(parts.join(", "))}</span>${canApply ? `<button type="button" class="ex-apply-ref" data-workout="use-workout-reference" data-row="${index}">↻ 沿用</button>` : ""}`;
          } else {
            lastHost.hidden = true;
            lastHost.innerHTML = "";
          }
        }
      });
      updateLiveMetrics();
    }

    function renderMotionMarkup(row) {
      const detail = exerciseDetails.get(row.exerciseId);
      const illustration = detail?.illustration;
      const gifPath = illustration?.gifPath?.startsWith("/media/exercises/") ? illustration.gifPath : "";
      const thumbPath = illustration?.frames?.[0]?.path?.startsWith("/media/exercises/") ? illustration.frames[0].path : "";
      const mediaPath = gifPath || thumbPath;
      const muscleKey = row.snapshot?.muscle ?? detail?.muscle;
      const gearKey = row.snapshot?.equipment ?? detail?.equipment;
      const tags = [muscles[muscleKey] ?? muscleKey, equipment[gearKey] ?? gearKey].filter(Boolean);
      const steps = detail?.instructions ?? [];
      const mistakes = detail?.mistakes ?? [];
      const frames = illustration?.frames?.filter((f) => f.path.startsWith("/media/exercises/")) ?? [];
      const safeURL = (value) => typeof value === "string" && value.startsWith("https://") ? esc(value) : "#";
      const summary = detail?.description ?? "";
      return `<div class="workout-motion-box">
        <div class="workout-motion-media${mediaPath ? "" : " is-fallback"}">
          ${mediaPath ? `<img class="workout-motion-gif" src="${esc(mediaPath)}" width="112" height="112" decoding="async" alt="${esc(exerciseLabel(row))} 动作示范">${gifPath ? '<span class="motion-pill">GIF</span>' : ""}`
            : `${icon("workout", 26)}<span>${esc(muscles[muscleKey] ?? "动作")}</span>`}
        </div>
        <div class="workout-motion-copy">
          ${tags.length ? `<div class="workout-motion-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}
          ${summary ? `<p class="workout-motion-desc">${esc(summary)}</p>` : ""}
          ${steps.length || frames.length ? `<details class="exercise-cue-details"><summary>动作要领与分解${steps.length ? `（${steps.length} 步）` : ""}${icon("chevron", 12)}</summary>
            <div class="exercise-cue-body">
              ${steps.length ? `<ol>${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>` : ""}
              ${mistakes.length ? `<ul class="cue-mistakes">${mistakes.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}
              ${frames.length ? `<div class="cue-frames">${frames.map((frame, i) => `<figure><img src="${esc(frame.path)}" width="72" height="72" loading="lazy" alt="${esc(frame.caption)}"><figcaption>${String(i + 1).padStart(2, "0")} ${esc(frame.caption)}</figcaption></figure>`).join("")}</div>
                <p class="cue-credit">${esc(illustration.author)} · <a href="${safeURL(illustration.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(illustration.license)}</a></p>` : ""}
            </div></details>` : ""}
        </div>
      </div>`;
    }

    function refreshMotionSlots() {
      $$("[data-motion-slot]", list).forEach((slot) => {
        const idx = Number(slot.dataset.motionSlot);
        const row = rows[idx];
        if (row) {
          slot.innerHTML = renderMotionMarkup(row);
          slot.hidden = !openMotions.has(row.id);
          const thumbBtn = $(`[data-ex-thumb="${idx}"]`, list);
          if (thumbBtn) {
            const detail = exerciseDetails.get(row.exerciseId);
            const illustration = detail?.illustration;
            const thumbUrl = (illustration?.gifPath?.startsWith("/media/exercises/") ? illustration.gifPath : "")
              || (illustration?.frames?.[0]?.path?.startsWith("/media/exercises/") ? illustration.frames[0].path : "");
            thumbBtn.classList.toggle("is-fallback", !thumbUrl);
            thumbBtn.innerHTML = `${thumbUrl ? `<img src="${esc(thumbUrl)}" width="54" height="54" decoding="async" alt="">` : `${icon("workout", 22)}`}<span class="ex-thumb-badge" aria-hidden="true">${icon("more", 10)}</span>`;
            const enName = detail?.englishName && detail.englishName !== exerciseLabel(row) ? detail.englishName : "";
            const h3 = $(`[data-row-index="${idx}"] .ex-hero-title-row h3`, list);
            if (h3) h3.innerHTML = `${esc(exerciseLabel(row))}${enName ? ` <small class="ex-en-name">(${esc(enName)})</small>` : ""}`;
          }
        }
      });
    }

    async function loadExerciseDetails() {
      for (const ex of getCustomExercises?.() ?? []) {
        if (ex?.id && !exerciseDetails.has(ex.id)) exerciseDetails.set(ex.id, ex);
      }
      const ids = [...new Set(rows.map((row) => row.exerciseId))].filter((id) => !exerciseDetails.has(id));
      if (!ids.length) { refreshMotionSlots(); return; }
      const sequence = ++detailRequest;
      try {
        for (let i = 0; i < ids.length; i += 100) {
          const { items = [] } = await api("/api/catalogue/exercises/details", {
            method: "POST",
            body: { ids: ids.slice(i, i + 100) },
          });
          if (sequence !== detailRequest || !dialog.open || !form.isConnected) return;
          for (const item of items) exerciseDetails.set(item.id, item);
        }
        refreshMotionSlots();
        updateLiveMetrics();
      } catch { /* Catalogue illustrations stay optional when offline. */ }
    }

    async function loadReferences() {
      const sequence = ++referenceRequest;
      const date = dateInput.value;
      if (!rows.length || !date || !dateInput.validity.valid) return;
      const entries = [...new Map(rows.map((row) => [row.exerciseId, { id: row.exerciseId, mode: row.snapshot?.mode }])).values()];
      const payload = { date, startedAt: startFor(date), workoutId: record?.id, exercises: entries };
      try {
        const [refReply, prReply] = await Promise.all([
          api("/api/web/exercise-references", { method: "POST", body: payload }),
          api("/api/web/exercise-prs", { method: "POST", body: payload }).catch(() => []),
        ]);
        if (sequence !== referenceRequest || !dialog.open || !form.isConnected) return;
        references = new Map(refReply.map(({ id, sets }) => [id, sets]));
        prBaselines = new Map(prReply.map((b) => [b.exerciseId + ":" + b.mode, b]));
        updateReferences();
        updateLiveMetrics();
      } catch { /* Historical hints can be unavailable while recording offline. */ }
    }

    function renderReadinessBanner() {
      const slot = $("#readiness-slot", form);
      if (!slot) return;
      const hint = live && !readinessDismissed ? getReadinessHint?.() : null;
      if (!hint) { slot.innerHTML = ""; return; }
      slot.innerHTML = `<div class="readiness-banner is-${esc(hint.tone)}" role="status">
        <div class="readiness-banner-copy">
          <strong>${icon("bolt", 14)} ${esc(hint.title)}</strong>
          <small>${esc(hint.detail)}</small>
        </div>
        <div class="readiness-banner-actions">
          <button type="button" class="secondary-button" data-workout="apply-readiness-deload">一键减载 -10%</button>
          <button type="button" class="quiet icon-button" data-workout="dismiss-readiness" aria-label="忽略提示">${icon("close", 14)}</button>
        </div>
      </div>`;
    }

    function cleanSupersetOrphans() {
      const counts = new Map();
      for (const r of rows) {
        if (r.supersetGroup) counts.set(r.supersetGroup, (counts.get(r.supersetGroup) ?? 0) + 1);
      }
      for (const r of rows) {
        if (r.supersetGroup && (counts.get(r.supersetGroup) ?? 0) < 2) r.supersetGroup = null;
      }
    }

    function computeSupersetBadges() {
      const counters = new Map();
      return rows.map((r) => {
        if (!r.supersetGroup) return "";
        const n = (counters.get(r.supersetGroup) ?? 0) + 1;
        counters.set(r.supersetGroup, n);
        return `${r.supersetGroup}${n}`;
      });
    }

    function toggleSupersetAt(index) {
      const row = rows[index];
      if (!row) return;
      if (row.supersetGroup) {
        row.supersetGroup = null;
        cleanSupersetOrphans();
        return;
      }
      if (rows.length < 2) return;
      const prev = index > 0 ? rows[index - 1] : null;
      if (prev?.supersetGroup) {
        row.supersetGroup = prev.supersetGroup;
        return;
      }
      const used = new Set(rows.map((r) => r.supersetGroup).filter(Boolean));
      const letters = "ABCDEFGHIJKLMN".split("");
      const nextCode = letters.find((ch) => !used.has(ch)) ?? `S${used.size + 1}`;
      row.supersetGroup = nextCode;
      const partner = rows[index + 1] ?? rows[index - 1];
      if (partner) partner.supersetGroup = nextCode;
      cleanSupersetOrphans();
    }

    function renderDossierHistory(row) {
      const hist = exerciseHistoryCache.get(row.exerciseId);
      if (!hist) return '<p class="muted dossier-loading">正在读取历史走势…</p>';
      const sessions = hist.sessions ?? [];
      if (!sessions.length) return '<p class="muted dossier-empty">暂无该动作的历史完成记录。</p>';
      const asc = [...sessions].reverse();
      const chartPts = asc.filter((s) => s.estimated1rm != null && s.estimated1rm > 0);
      let svgHtml = "";
      if (chartPts.length >= 2) {
        const w = 260, h = 64, p = 8;
        const vals = chartPts.map((s) => s.estimated1rm);
        const minV = Math.min(...vals), maxV = Math.max(...vals);
        const span = Math.max(1, maxV - minV);
        const coords = chartPts.map((s, idx) => {
          const x = p + (idx / (chartPts.length - 1)) * (w - p * 2);
          const y = h - p - ((s.estimated1rm - minV) / span) * (h - p * 2);
          return [x.toFixed(1), y.toFixed(1), s];
        });
        const polyline = coords.map(([x, y]) => `${x},${y}`).join(" ");
        svgHtml = `<div class="dossier-chart-wrap">
          <div class="dossier-chart-head"><span>估算 1RM 趋势</span><strong>${fmt(chartPts.at(-1).estimated1rm)} kg</strong></div>
          <svg class="dossier-sparkline" viewBox="0 0 ${w} ${h}" role="img" aria-label="估算 1RM 历史折线图">
            <polyline fill="none" stroke="var(--red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"/>
            ${coords.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.8" fill="var(--bg)" stroke="var(--red)" stroke-width="1.6"/>`).join("")}
          </svg>
        </div>`;
      }
      const listHtml = `<ul class="dossier-history-list">${sessions.slice(0, 5).map((s) => {
        const bestLabel = hist.mode === "timed"
          ? `${s.bestSeconds ?? 0} 秒`
          : `${fmt(s.topWeight ?? 0)} kg × ${s.topReps ?? 0}`;
        return `<li><time datetime="${esc(s.date)}">${esc(s.date.slice(5))}</time><span>${esc(bestLabel)}</span><small>${s.estimated1rm ? `1RM ${fmt(s.estimated1rm)}kg` : `${fmt(s.workSets, 0)} 组`}</small></li>`;
      }).join("")}</ul>`;
      return `${svgHtml}${listHtml}`;
    }

    function bestReference1rm(row) {
      if ((row.snapshot?.mode ?? "reps") !== "reps") return 0;
      let best = prBaselines.get(row.exerciseId + ":reps")?.oneRepMax ?? 0;
      const hist = exerciseHistoryCache.get(row.exerciseId);
      if (hist?.sessions) {
        for (const s of hist.sessions) {
          if (s.estimated1rm && s.estimated1rm > best) best = s.estimated1rm;
        }
      }
      for (const s of row.sets) {
        if (s.type !== "warmup" && s.weight > 0 && s.reps > 0) {
          const est = estimated1RM(s.weight, Math.min(s.reps, 12));
          if (est > best) best = est;
        }
      }
      return best > 0 ? round2(best) : 0;
    }

    function renderDossierPct(row, index) {
      const ref1rm = bestReference1rm(row);
      if (!ref1rm) return "";
      const zones = [
        [0.9, "90%·3次", 3],
        [0.85, "85%·5次", 5],
        [0.8, "80%·8次", 8],
        [0.75, "75%·10次", 10],
        [0.7, "70%·12次", 12],
      ];
      return `<div class="dossier-pct-strip">
        <div class="dossier-pct-head"><span>%1RM 负荷速填</span><small>基准 ${fmt(ref1rm)} kg</small></div>
        <div class="dossier-pct-pills">${zones.map(([pct, label, targetReps]) => {
          const w = Math.max(2.5, Math.round((ref1rm * Number(pct)) / 2.5) * 2.5);
          return `<button type="button" class="stepper-pill" data-workout="apply-pct-load" data-row="${index}" data-weight="${w}" data-reps="${targetReps}"><b>${fmt(w)}kg</b><small>${label}</small></button>`;
        }).join("")}</div>
      </div>`;
    }

    function renderDossierSlot(row, index) {
      if (!openDossiers.has(row.id)) return "";
      const noteVal = draftDossierNotes.has(row.exerciseId)
        ? draftDossierNotes.get(row.exerciseId)
        : (exerciseNotes.get(row.exerciseId) ?? "");
      return `<div class="exercise-dossier" data-dossier-row="${index}">
        <div class="dossier-note-row">
          <input type="text" maxlength="500" data-dossier-note="${index}" value="${esc(noteVal)}" placeholder="记下座椅档位、握距或发力提示…">
          <button type="button" class="secondary-button" data-workout="save-note" data-row="${index}">保存备忘</button>
        </div>
        <div data-dossier-pct="${index}">${renderDossierPct(row, index)}</div>
        <div class="dossier-history-box">${renderDossierHistory(row)}</div>
      </div>`;
    }

    function cuePillMarkup(noteText, rowIndex) {
      return noteText
        ? `<button type="button" class="ex-note-card" data-workout="toggle-dossier" data-row="${rowIndex}" title="点击编辑动作备忘">${icon("bookmark", 13)}<span>${esc(noteText)}</span></button>`
        : "";
    }

    async function loadExerciseNotes() {
      try {
        const map = await api("/api/web/exercise-notes");
        if (!dialog.open || !form.isConnected) return;
        for (const [exId, entry] of Object.entries(map ?? {})) {
          if (entry?.note) exerciseNotes.set(exId, entry.note);
        }
        $$(".exercise-editor", list).forEach((section, index) => {
          const row = rows[index];
          if (!row) return;
          const noteText = exerciseNotes.get(row.exerciseId) ?? "";
          const cueSlot = $("[data-cue-slot]", section);
          if (cueSlot) cueSlot.innerHTML = cuePillMarkup(noteText, index);
          const noteInput = $(`[data-dossier-note="${index}"]`, section);
          if (noteInput && document.activeElement !== noteInput) noteInput.value = noteText;
        });
      } catch { /* Notes stay optional offline */ }
    }

    async function loadExerciseHistoryFor(exerciseId) {
      if (exerciseHistoryCache.has(exerciseId)) return;
      try {
        const hist = await api("/api/web/exercise-history/" + encodeURIComponent(exerciseId));
        if (!dialog.open || !form.isConnected) return;
        exerciseHistoryCache.set(exerciseId, hist);
        if (hist?.note && !exerciseNotes.has(exerciseId)) exerciseNotes.set(exerciseId, hist.note);
        $$(".exercise-editor", list).forEach((section, index) => {
          const row = rows[index];
          if (!row || row.exerciseId !== exerciseId || !openDossiers.has(row.id)) return;
          const pctBox = $(`[data-dossier-pct="${index}"]`, section);
          if (pctBox) pctBox.innerHTML = renderDossierPct(row, index);
          const box = $(".dossier-history-box", section);
          if (box) box.innerHTML = renderDossierHistory(row);
        });
      } catch { /* History unavailable offline */ }
    }

    function renderRows() {
      renderReadinessBanner();
      const ssBadges = computeSupersetBadges();
      const jump = $(".exercise-jump", form);
      focusRow = Math.min(focusRow, Math.max(0, rows.length - 1));
      if (jump) jump.innerHTML = rows.map((row, index) => {
        const ss = ssBadges[index];
        return `<button type="button" class="jump-circle" data-workout="focus-row" data-row="${index}" aria-label="第 ${index + 1} 个动作：${esc(exerciseLabel(row))}">${ss ? `<em class="jump-ss-sup">${esc(ss)}</em>` : ""}<b>${index + 1}</b></button>`;
      }).join("");

      const typeNames = { normal: "常规", warmup: "热身", failure: "力竭", drop: "递减", rest_pause: "休停" };
      const typeBadges = { warmup: "W", failure: "F", drop: "D", rest_pause: "P" };
      const rirValues = { "": "—", 0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5" };

      list.innerHTML = rows.map((row, index) => {
        const mode = row.snapshot?.mode ?? "reps";
        const timed = mode === "timed";
        const meta = rowMeta(row, index);
        const prog = meta?.progression;
        const backup = meta?.backup;
        const ssBadge = ssBadges[index];
        const partnerIdx = row.supersetGroup
          ? (() => {
              const after = rows.findIndex((other, idx) => idx > index && other.supersetGroup === row.supersetGroup);
              if (after >= 0) return after;
              return rows.findIndex((other, idx) => idx !== index && other.supersetGroup === row.supersetGroup);
            })()
          : -1;
        const savedNote = exerciseNotes.get(row.exerciseId) ?? "";
        const dossierOpen = openDossiers.has(row.id);
        const exMenuOpen = openExMenus.has(row.id);
        const showDelCols = deleteSetMode.has(row.id);
        const detail = exerciseDetails.get(row.exerciseId);
        const illustration = detail?.illustration;
        const thumbUrl = (illustration?.gifPath?.startsWith("/media/exercises/") ? illustration.gifPath : "")
          || (illustration?.frames?.[0]?.path?.startsWith("/media/exercises/") ? illustration.frames[0].path : "");
        const muscleKey = row.snapshot?.muscle ?? detail?.muscle;
        const equipKey = row.snapshot?.equipment ?? detail?.equipment;
        const muscleLabel = muscles[muscleKey] ?? muscleKey ?? "";
        const equipLabel = equipment[equipKey] ?? equipKey ?? "";
        const enName = detail?.englishName && detail.englishName !== exerciseLabel(row) ? detail.englishName : "";
        const isUnilateral = !timed && mode === "reps" && (row.snapshot?.volumeMultiplier ?? 1) >= 2;

        const warmupIndices = [];
        const workIndices = [];
        row.sets.forEach((entry, i) => {
          if (entry.type === "warmup") warmupIndices.push(i);
          else workIndices.push(i);
        });

        const renderSetItem = (i, displayNum) => {
          const entry = row.sets[i];
          const isSmallEquip = ["dumbbell", "kettlebell", "cable", "band"].includes(equipKey) || (entry.weight > 0 && entry.weight <= 15);
          const wtStep = isSmallEquip ? 1 : 2.5;
          const badgeTag = typeBadges[entry.type] ?? "";
          return `<div class="set-block" data-row="${index}" data-index="${i}">
            <div class="set-row" data-row="${index}" data-index="${i}">
              <div class="set-swipe-bg is-done-hint" aria-hidden="true">${icon("check", 16)}<span>${entry.completed ? "取消完成" : "完成本组"}</span></div>
              <div class="set-swipe-bg is-del-hint" aria-hidden="true"><span>删除本组</span>${icon("close", 16)}</div>
              <button type="button" class="set-num-btn" data-workout="cycle-type" data-type="${esc(entry.type)}" data-row="${index}" data-index="${i}" aria-label="第 ${displayNum} 组类型，当前${typeNames[entry.type] ?? "常规"}，点击切换"><b>${displayNum}</b>${badgeTag ? `<sup class="set-kind-sup">${badgeTag}</sup>` : ""}</button>
              ${timed
                ? `<div class="num-stepper">
                    <button type="button" class="num-step-btn" data-step-sec="-10" data-row="${index}" data-index="${i}" aria-label="减少 10 秒">−</button>
                    <input aria-label="第 ${displayNum} 组秒数" type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" min="0" max="86400" step="1" data-set="seconds" data-row="${index}" data-index="${i}" value="${entry.seconds}" required>
                    <button type="button" class="num-step-btn" data-step-sec="10" data-row="${index}" data-index="${i}" aria-label="增加 10 秒">+</button>
                  </div>`
                : `<div class="num-stepper">
                    <button type="button" class="num-step-btn" data-step-wt="-${wtStep}" data-row="${index}" data-index="${i}" aria-label="减少重量 ${wtStep} kg">−</button>
                    <input aria-label="第 ${displayNum} 组重量" type="number" inputmode="decimal" enterkeyhint="next" min="0" max="100000" step="0.01" data-set="weight" data-row="${index}" data-index="${i}" value="${entry.weight}" required>
                    <button type="button" class="num-step-btn" data-step-wt="${wtStep}" data-row="${index}" data-index="${i}" aria-label="增加重量 ${wtStep} kg">+</button>
                  </div>
                  <div class="num-stepper">
                    <button type="button" class="num-step-btn" data-step-rep="-1" data-row="${index}" data-index="${i}" aria-label="减少 1 次">−</button>
                    <input aria-label="第 ${displayNum} 组次数" type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" min="0" max="1000" step="1" data-set="reps" data-row="${index}" data-index="${i}" value="${entry.reps}" required>
                    <button type="button" class="num-step-btn" data-step-rep="1" data-row="${index}" data-index="${i}" aria-label="增加 1 次">+</button>
                  </div>`}
              ${timed ? "" : `<select class="col-rir set-rir-select" aria-label="第 ${displayNum} 组 RIR" data-set="rir" data-row="${index}" data-index="${i}">${options(rirValues, entry.rir ?? "")}</select>`}
              <label class="check-set"><input type="checkbox" switch aria-label="完成第 ${displayNum} 组" data-set="completed" data-row="${index}" data-index="${i}"${entry.completed ? " checked" : ""}><span>${icon("check", 16)}</span></label>
              ${showDelCols ? `<button type="button" class="quiet icon-button set-del-btn" data-workout="remove-set" data-row="${index}" data-index="${i}" aria-label="删除第 ${displayNum} 组">${icon("close", 14)}</button>` : ""}
            </div>
            <div class="set-inline-meta" data-inline-meta="${index}:${i}" hidden></div>
          </div>`;
        };

        const warmupRowsHtml = warmupIndices.length
          ? `<div class="sets-group-label">热身</div>${warmupIndices.map((sIdx, pos) => renderSetItem(sIdx, pos + 1)).join("")}`
          : "";
        const dividerHtml = warmupIndices.length && workIndices.length ? '<div class="sets-divider" aria-hidden="true"></div>' : "";
        const workRowsHtml = workIndices.map((sIdx, pos) => renderSetItem(sIdx, pos + 1)).join("");

        return `<section class="exercise-editor${timed ? " timed-exercise" : ""}${ssBadge ? " has-superset" : ""}${showDelCols ? " has-delete-cols" : ""}" data-row-index="${index}"${row.supersetGroup ? ` data-superset="${esc(row.supersetGroup)}"` : ""}>
          <header class="ex-hero-head">
            <button type="button" class="ex-hero-thumb${thumbUrl ? "" : " is-fallback"}" data-workout="toggle-motion" data-row="${index}" data-ex-thumb="${index}" aria-label="展开或收起动作示范" aria-pressed="${openMotions.has(row.id)}">
              ${thumbUrl ? `<img src="${esc(thumbUrl)}" width="54" height="54" decoding="async" alt="">` : `${icon("workout", 22)}`}
              <span class="ex-thumb-badge" aria-hidden="true">${icon("more", 10)}</span>
            </button>
            <div class="ex-hero-title-col">
              <div class="ex-hero-title-row">
                <h3 tabindex="-1">${esc(exerciseLabel(row))}${enName ? ` <small class="ex-en-name">(${esc(enName)})</small>` : ""}</h3>
                <span class="ex-set-ratio" data-exercise-count></span>
              </div>
              <div class="ex-hero-tags">
                ${muscleLabel ? `<span class="ex-tag">${esc(muscleLabel)}</span>` : ""}
                ${equipLabel ? `<span class="ex-tag">${esc(equipLabel)}</span>` : ""}
                <span class="ex-tag is-best" data-exercise-best hidden></span>
                ${ssBadge ? `<span class="superset-pill">超级组 ${esc(ssBadge)}</span>` : ""}
                ${isUnilateral ? `<span class="unilateral-pill">单侧 ×2</span>` : ""}
              </div>
            </div>
            <button type="button" class="workout-circle-btn ex-more-btn" data-workout="toggle-ex-menu" data-row="${index}" aria-label="动作选项与休息设置" aria-expanded="${exMenuOpen}">${icon("more", 17)}</button>
          </header>

          <div class="ex-context-stack">
            <div class="exercise-cue-slot" data-cue-slot>${cuePillMarkup(savedNote, index)}</div>
            <div class="ex-last-row" data-ex-last-summary hidden></div>
            ${prog ? `<div class="ex-prog-row">
              <span class="ex-prog-line is-${prog.status === "progress_weight" || prog.status === "progress_reps" ? "up" : prog.status === "plateau_deload" ? "warn" : "base"}" title="${esc(prog.forecast ?? "")}">${icon("bolt", 13)} <span>${esc(prog.statusLabel)}${prog.forecast ? ` · ${esc(prog.forecast)}` : ""}</span></span>
              ${prog.deloadWeight != null ? `<button type="button" class="quiet deload-btn" data-workout="apply-deload" data-row="${index}">降载 ${fmt(prog.deloadWeight)}kg</button>` : ""}
            </div>` : ""}
            <div class="exercise-telemetry-row">
              <small class="exercise-1rm" data-exercise-1rm></small>
              <small class="exercise-vol" data-exercise-vol></small>
              <small class="exercise-pr-line" data-exercise-pr></small>
            </div>
          </div>

          <div class="exercise-settings"${exMenuOpen ? "" : " hidden"} data-ex-menu="${index}">
            <div class="exercise-settings-body">
              <div class="rest-preset-row">
                <label>组间休息 <input aria-label="休息秒数" data-rest="${index}" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="900" value="${row.restSeconds}" required> 秒</label>
                <div class="rest-quick-pills" role="group" aria-label="常用休息时长">${[60, 90, 120, 180].map((sec) =>
                  `<button type="button" class="stepper-pill" data-workout="set-rest" data-row="${index}" data-seconds="${sec}" aria-pressed="${row.restSeconds === sec}">${sec}s</button>`).join("")}
                  ${live && row.restSeconds > 0 ? `<button type="button" class="stepper-pill stepper-clone" data-workout="start-rest" data-row="${index}">立即计时</button>` : ""}
                </div>
              </div>
              <div class="exercise-manage-row">
                <button type="button" class="secondary-button${dossierOpen ? " is-active" : ""}" data-workout="toggle-dossier" data-row="${index}">${icon("analytics", 14)} 备忘/历史</button>
                <button type="button" class="secondary-button${openMotions.has(row.id) ? " is-active" : ""}" data-workout="toggle-motion" data-row="${index}">${icon("play", 14)} ${openMotions.has(row.id) ? "收起示范" : "动作示范"}</button>
                ${partnerIdx >= 0 ? `<button type="button" class="secondary-button" data-workout="focus-row" data-row="${partnerIdx}">切搭档 ${esc(ssBadges[partnerIdx])}</button>` : ""}
                ${!timed && mode === "reps" ? `<button type="button" class="secondary-button${isUnilateral ? " is-active" : ""}" data-workout="toggle-unilateral" data-row="${index}" aria-pressed="${isUnilateral}">${isUnilateral ? "计容：单侧 ×2" : "计容：双侧 ×1"}</button>` : ""}
                ${rows.length > 1 || row.supersetGroup ? `<button type="button" class="secondary-button${row.supersetGroup ? " is-superset" : ""}" data-workout="toggle-superset" data-row="${index}" aria-pressed="${!!row.supersetGroup}">${row.supersetGroup ? `超级组 ${esc(row.supersetGroup)} · 取消` : "设为超级组"}</button>` : ""}
                ${!timed && row.sets.length < 100 && row.sets.some((s) => s.weight > 0) ? `${mode === "reps" ? `<button type="button" class="secondary-button" data-workout="add-drop-set" data-row="${index}">${icon("bolt", 13)} + 递减组</button>` : ""}<button type="button" class="secondary-button" data-workout="add-rest-pause" data-row="${index}">${icon("clock", 13)} + 休停组</button>` : ""}
                ${rows.length > 1 ? `<div class="exercise-move-group">
                  <button type="button" class="quiet" data-workout="move-row" data-row="${index}" data-dir="-1"${index === 0 ? " disabled" : ""}>${icon("arrowUp", 14)} 上移</button>
                  <button type="button" class="quiet" data-workout="move-row" data-row="${index}" data-dir="1"${index === rows.length - 1 ? " disabled" : ""}>${icon("arrowDown", 14)} 下移</button>
                </div>` : ""}
                ${backup ? `<button type="button" class="secondary-button" data-workout="swap-backup" data-row="${index}">${icon("swap", 14)} 换为备选：${esc(backup.name)}</button>` : ""}
                <button type="button" class="secondary-button" data-workout="swap-any" data-row="${index}">${icon("swap", 14)} 替换动作</button>
                <button type="button" class="danger" data-workout="remove-row" data-row="${index}">移除动作</button>
              </div>
            </div>
          </div>

          <div class="plate-math" data-plate-math hidden></div>
          <div class="workout-motion-slot" data-motion-slot="${index}"${openMotions.has(row.id) ? "" : " hidden"}>${renderMotionMarkup(row)}</div>
          ${renderDossierSlot(row, index)}

          <div class="sets-card">
            <div class="set-head"><span></span><span>${timed ? "时长 (秒)" : mode === "assisted" ? "辅助 (kg)" : "重量 (kg)"}</span>${timed ? "" : "<span>次数</span>"}${timed ? "" : '<span class="col-rir">RIR</span>'}<span></span>${showDelCols ? "<span></span>" : ""}</div>
            ${warmupRowsHtml}${dividerHtml}${workRowsHtml}
            <footer class="sets-card-foot">
              <button type="button" class="sets-add-btn" data-workout="add-set" data-row="${index}"${row.sets.length >= 100 ? " disabled" : ""}>${icon("plus", 15)} 加一组</button>
              <div class="sets-foot-tools">
                ${mode === "reps" && row.sets.some((s) => s.type !== "warmup" && s.weight > 20) && !row.sets.some((s) => s.type === "warmup") ? `<button type="button" class="quiet sets-foot-pill" data-workout="gen-warmups" data-row="${index}">+ 热身组</button>` : ""}
                ${row.sets.filter((s) => !s.completed && s.type !== "warmup").length > 1 ? `<button type="button" class="quiet sets-foot-pill" data-workout="sync-rest-sets" data-row="${index}" title="将已输入重量和次数同步到后续未完成组">同步后续</button>` : ""}
                ${row.sets.length > 0 ? `<button type="button" class="quiet sets-foot-pill${showDelCols ? " is-active" : ""}" data-workout="toggle-del-sets" data-row="${index}" aria-pressed="${showDelCols}">${showDelCols ? "完成删组" : "删组"}</button>` : ""}
              </div>
            </footer>
          </div>
          ${live ? `<div class="exercise-complete-banner" data-complete-callout hidden></div>` : ""}</section>`;
      }).join("") || `<div class="empty workout-empty-state"><strong>还没有训练动作</strong><p>从动作库选择今日要练的动作开始记录</p><button type="button" class="primary-button" data-workout="open-picker">${icon("plus", 16)} 添加第一个动作</button></div>`;
      updateProgress();
      updateReferences();
      const jumpBar = $(".exercise-jump", form), activeChip = jumpBar?.children[focusRow];
      if (activeChip && jumpBar.scrollWidth > jumpBar.clientWidth + 2) {
        jumpBar.scrollTo({ left: Math.max(0, activeChip.offsetLeft - (jumpBar.clientWidth - activeChip.offsetWidth) / 2), behavior: "instant" });
      }
    }
    renderRows();
    void loadReferences();
    void loadExerciseDetails();
    void loadExerciseNotes();

    const liveClock = $("[data-live-clock]", form);
    const restBanner = $(".rest-clock", form);
    const dialOverlay = $(".rest-dial-overlay", form);
    const dialSvg = $(".rest-dial-svg", form);
    let restSoundedEndAt = rest && rest.end <= Date.now() && rest.pausedLeftMs == null ? rest.end : 0;
    form.addEventListener("touchend", () => audio.unlock(), { passive: true });
    form.addEventListener("click", () => audio.unlock(), { passive: true });
    const wake = supportsWake ? keepWorkoutScreenAwake(() => !!$('[name="keepScreen"]', form)?.checked
      && !!timing.runningSince && dateInput.value === today(), (locked) => {
        $("[data-wake-status]", form).textContent = locked ? "屏幕常亮已启用" : "";
        $('[name="keepScreen"]', form)?.closest("label").classList.toggle("wake-active", locked);
      }) : null;

    function fireRestNotification() {
      if (!("Notification" in window) || Notification.permission !== "granted" || localStorage.getItem(notifyPreference) === "off") return;
      const titleText = "铁记 · 组间休息结束";
      const opts = {
        body: nextPendingDescription() || "准备好开始下一组！",
        icon: "./icon-192.png",
        badge: "./icon-192.png",
        tag: "ironlog-rest",
        renotify: true,
        vibrate: [200, 100, 200],
      };
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => { if (reg?.showNotification) return reg.showNotification(titleText, opts); new Notification(titleText, opts); })
          .catch(() => { try { new Notification(titleText, opts); } catch {} });
      } else {
        try { new Notification(titleText, opts); } catch {}
      }
    }

    function renderClocks() {
      const now = Date.now();
      if (activeHold) {
        const holdElapsed = Math.max(0, Math.floor((now - activeHold.startedAt) / 1000));
        const holdEl = $("[data-hold-clock]", list);
        if (holdEl) {
          const text = formatClock(holdElapsed);
          if (holdEl.textContent !== text) holdEl.textContent = text;
        }
        if (activeHold.targetSeconds > 0 && holdElapsed >= activeHold.targetSeconds && !activeHold.beeped) {
          activeHold.beeped = true;
          audio.play(true);
          haptic("timer", { fromUserGesture: false });
        }
      }
      if (liveClock) {
        const showTimer = dateInput.value === today();
        const clockTextEl = $("[data-live-clock-text]", liveClock);
        const sepEl = $(".clock-sep", liveClock);
        if (clockTextEl) {
          clockTextEl.hidden = !showTimer;
          const elapsed = formatClock(elapsedAt(timing, now));
          const displayElapsed = elapsed.startsWith("0") && elapsed.length === 5 ? elapsed.slice(1) : elapsed;
          if (clockTextEl.textContent !== displayElapsed) clockTextEl.textContent = displayElapsed;
        }
        if (sepEl) sepEl.hidden = !showTimer;
        liveClock.classList.toggle("is-paused", !timing.runningSince);
      }
      const showRest = !!rest && !reviewing && dateInput.value === today();
      restBanner.hidden = !showRest;
      dialOverlay.hidden = !showRest || !dialOpen;
      dialOverlayToken = syncOverlayToken(dialOverlayToken, !dialOverlay.hidden, () => {
        dialOpen = false;
        dialOverlayToken = null;
        renderClocks();
      });
      syncDockVisibility();
      if (!showRest) {
        if (activeHold) {
          const holdElapsed = Math.max(0, Math.floor((now - activeHold.startedAt) / 1000));
          document.title = `[● ${formatClock(holdElapsed)}] 计时中 · 铁记`;
        } else if (document.title !== originalTitle) {
          document.title = originalTitle;
        }
        return;
      }
      const { total, fraction: remainingFrac, seconds: time, paused } = restProgress(rest, now);
      const formatted = time ? formatClock(time) : "00:00";
      const compactTime = formatted.startsWith("0") && formatted.length === 5 ? formatted.slice(1) : formatted;
      document.title = paused ? `[❚❚ ${compactTime}] 已暂停 · 铁记` : time ? `[${compactTime}] 休息中 · 铁记` : "休息结束！· 铁记";
      if (!paused && time === 0 && rest.end && restSoundedEndAt !== rest.end) {
        restSoundedEndAt = rest.end;
        audio.play(true);
      }
      if (!paused && time === 0 && rest.end && restNotifiedEndAt !== rest.end) {
        restNotifiedEndAt = rest.end;
        fireRestNotification();
      }
      const fillEl = $("[data-rest-progress-fill]", restBanner);
      if (fillEl) {
        fillEl.style.width = `${(remainingFrac * 100).toFixed(2)}%`;
      }
      const pauseBtn = $('[data-clock="pause-rest"]', restBanner);
      if (pauseBtn) {
        pauseBtn.setAttribute("aria-pressed", String(paused));
        pauseBtn.setAttribute("aria-label", paused ? "继续休息计时" : "暂停休息计时");
        pauseBtn.innerHTML = icon(paused ? "play" : "pause", 14);
      }
      if (lastRest !== time || restBanner.dataset.pausedState !== String(paused)) {
        if (!paused && time > 0 && time <= 3 && lastRest !== null && time < lastRest) {
          audio.play(false);
        }
        const restTimeEl = $("[data-rest-time]", restBanner);
        if (restTimeEl) restTimeEl.innerHTML = matrix(time ? compactTime : "0:00");
        const restLabelEl = $("[data-rest-label]", restBanner);
        if (restLabelEl) restLabelEl.innerHTML = `<i class="rest-led" aria-hidden="true"></i>${paused ? "已暂停" : time ? "休息" : "休息结束"} ${icon("arrowDown", 11)}`;
        restBanner.classList.toggle("rest-urgent", !paused && time > 0 && time <= 10);
        restBanner.classList.toggle("rest-done", time === 0);
        restBanner.classList.toggle("is-paused", paused);
        restBanner.dataset.pausedState = String(paused);
        $("[data-rest-announcement]", restBanner).textContent = time === 0 ? "组间休息结束" : "";
        if ($("[data-dial-time]", dialOverlay)) {
          $("[data-dial-time]", dialOverlay).innerHTML = matrix(formatted);
          $("[data-dial-sub]", dialOverlay).textContent = paused ? "休息已暂停" : time ? `组间恢复 · 共 ${formatClock(Math.round(total / 1000))}` : "休息结束";
          dialOverlay.classList.toggle("rest-done", time === 0);
          $$("[data-clock-preset]", dialOverlay).forEach((btn) =>
            btn.setAttribute("aria-pressed", String(Math.round(total / 1000) === Number(btn.dataset.clockPreset))));
        }
        lastRest = time;
      }
      if (dialSvg && !dialOverlay.hidden) {
        syncDialTicks(dialSvg, remainingFrac);
        const nextText = nextPendingDescription();
        const nextBox = $("[data-dial-next]", dialOverlay);
        nextBox.hidden = !nextText;
        nextBox.textContent = nextText;
      }
    }

    function beginRest(seconds, setId) {
      rest = createRestTimer(seconds, setId, Date.now());
      lastRest = null;
      restSoundedEndAt = 0;
      if (localStorage.getItem(dialPreference) === "on") dialOpen = true;
      audio.unlock();
      if ("Notification" in window && Notification.permission === "default" && localStorage.getItem(notifyPreference) !== "off") {
        void Notification.requestPermission().catch(() => {});
      }
      renderClocks();
    }
    renderClocks();
    wake?.update();
    const ticks = live ? setInterval(renderClocks, 180) : null;
    function onForegroundResume() {
      if (document.visibilityState === "hidden") return;
      renderClocks();
      wake?.update();
    }
    if (live) {
      document.addEventListener("visibilitychange", onForegroundResume);
      window.addEventListener("focus", onForegroundResume);
    }
    let stepHoldDelay = 0, stepHoldInterval = 0, suppressStepClickUntil = 0;
    function stopStepRepeat() {
      clearTimeout(stepHoldDelay);
      clearInterval(stepHoldInterval);
      stepHoldDelay = 0;
      stepHoldInterval = 0;
    }
    function applyStepperButton(btn, { fromRepeat = false } = {}) {
      const rIdx = Number(btn.dataset.row);
      const sIdx = Number(btn.dataset.index);
      const targetSet = rows[rIdx]?.sets[sIdx];
      if (!targetSet) return false;
      audio.unlock();
      audio.tap("tick");
      haptic("light", { fromUserGesture: !fromRepeat });
      if (btn.hasAttribute("data-step-wt")) {
        const delta = Number(btn.dataset.stepWt);
        untouchedWeights.delete(targetSet);
        const nextVal = Math.max(0, Math.round(((Number(targetSet.weight) || 0) + delta) * 100) / 100);
        targetSet.weight = nextVal;
        const inputEl = $(`[data-set="weight"][data-row="${rIdx}"][data-index="${sIdx}"]`, list);
        if (inputEl) inputEl.value = String(nextVal);
      } else if (btn.hasAttribute("data-step-rep")) {
        const delta = Number(btn.dataset.stepRep);
        const nextVal = Math.max(0, Math.round((Number(targetSet.reps) || 0) + delta));
        targetSet.reps = nextVal;
        const inputEl = $(`[data-set="reps"][data-row="${rIdx}"][data-index="${sIdx}"]`, list);
        if (inputEl) inputEl.value = String(nextVal);
      } else if (btn.hasAttribute("data-step-sec")) {
        const delta = Number(btn.dataset.stepSec);
        const nextVal = Math.max(0, (Number(targetSet.seconds) || 0) + delta);
        targetSet.seconds = nextVal;
        const inputEl = $(`[data-set="seconds"][data-row="${rIdx}"][data-index="${sIdx}"]`, list);
        if (inputEl) inputEl.value = String(nextVal);
      } else {
        return false;
      }
      updateReferences();
      updateLiveMetrics();
      markDirty();
      return true;
    }
    form.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest?.(".num-step-btn");
      if (!btn || (e.button !== undefined && e.button !== 0)) return;
      stopStepRepeat();
      stepHoldDelay = setTimeout(() => {
        if (!btn.isConnected || !form.isConnected) { stopStepRepeat(); return; }
        applyStepperButton(btn, { fromRepeat: true });
        suppressStepClickUntil = Date.now() + 400;
        stepHoldInterval = setInterval(() => {
          if (!btn.isConnected || !form.isConnected) { stopStepRepeat(); return; }
          applyStepperButton(btn, { fromRepeat: true });
          suppressStepClickUntil = Date.now() + 400;
        }, 105);
      }, 360);
    });
    form.addEventListener("pointerup", stopStepRepeat);
    form.addEventListener("pointercancel", stopStepRepeat);
    form.addEventListener("pointerleave", stopStepRepeat);
    window.addEventListener("blur", stopStepRepeat);
    function checkpoint() { if (dirty && !form.dataset.saved) remember(); }
    window.addEventListener("pagehide", checkpoint);
    closeWorkout = () => {
      activeHold = null;
      stopStepRepeat();
      window.removeEventListener("blur", stopStepRepeat);
      if (ticks) clearInterval(ticks);
      if (live) {
        document.removeEventListener("visibilitychange", onForegroundResume);
        window.removeEventListener("focus", onForegroundResume);
      }
      pickerOverlayToken = null;
      sessionMenuToken = null;
      dialOverlayToken = null;
      adaptOverlayToken = null;
      dialog.classList.remove("is-live-workout");
      document.title = originalTitle;
      clearTimeout(undoTimer);
      clearTimeout(advanceTimer);
      clearTimeout(stepNoticeTimer);
      referenceRequest++;
      detailRequest++;
      wake?.stop();
      window.removeEventListener("pagehide", checkpoint);
      checkpoint();
      if (dirty && !form.dataset.saved) onDraft?.();
    };

    function renderUndoBanner() {
      const banner = $("[data-undo-banner]", form);
      if (!banner) return;
      if (pendingUndo) {
        banner.hidden = false;
        banner.innerHTML = `<span>已删除「${esc(pendingUndo.label)}」第 ${pendingUndo.index + 1} 组</span>
          <button type="button" class="quiet" data-workout="undo-set">撤销</button>`;
        syncDockVisibility();
        return;
      }
      if (stepNotice) {
        banner.hidden = false;
        banner.innerHTML = `<span>${esc(stepNotice.message)}</span>
          <button type="button" class="quiet" data-workout="focus-row" data-row="${stepNotice.backRowIndex}">返回查看</button>`;
        syncDockVisibility();
        return;
      }
      banner.hidden = true;
      banner.innerHTML = "";
      syncDockVisibility();
    }

    function clearSwapMode() {
      swapTargetRow = -1;
      const banner = $("[data-swap-banner]", form);
      if (banner) {
        banner.hidden = true;
        banner.innerHTML = "";
      }
      const titleEl = $("[data-picker-title]", form);
      if (titleEl) titleEl.innerHTML = `${icon("plus", 16)} 添加训练动作`;
    }

    function openPickerOverlay(swapIdx = -1) {
      const pickerEl = $("[data-picker-overlay]", form);
      if (!pickerEl) return;
      const queryEl = $("#exercise-query", form);
      if (swapIdx >= 0 && rows[swapIdx]) {
        const targetRow = rows[swapIdx];
        swapTargetRow = swapIdx;
        pickerMuscle = targetRow.snapshot?.muscle ?? "";
        pickerEquipment = "";
        const titleEl = $("[data-picker-title]", form);
        if (titleEl) titleEl.innerHTML = `${icon("swap", 16)} 替换「${esc(exerciseLabel(targetRow))}」`;
        const banner = $("[data-swap-banner]", form);
        if (banner) {
          banner.hidden = false;
          banner.innerHTML = `<span>点选下方任一动作即可替换「<b>${esc(exerciseLabel(targetRow))}</b>」</span>
            <button type="button" class="quiet" data-workout="cancel-swap">取消替换</button>`;
        }
      } else {
        clearSwapMode();
      }
      $$("[data-picker-muscle]", form).forEach((el) =>
        el.setAttribute("aria-pressed", String(el.dataset.pickerMuscle === pickerMuscle)));
      $$("[data-picker-equipment]", form).forEach((el) =>
        el.setAttribute("aria-pressed", String(el.dataset.pickerEquipment === pickerEquipment)));
      dialOpen = false;
      sessionMenuOpen = false;
      const menuEl = $("[data-session-menu]", form);
      if (menuEl) menuEl.hidden = true;
      const adaptModal = $("[data-adapt-overlay]", form);
      if (adaptModal) adaptModal.hidden = true;
      pickerEl.hidden = false;
      form.classList.add("is-picking");
      pickerOverlayToken = syncOverlayToken(pickerOverlayToken, true, () => {
        pickerOverlayToken = null;
        closePickerOverlay();
      });
      updateProgress();
      renderClocks();
      void find(queryEl?.value.trim() ?? "");
      if (!isMobileViewport()) {
        requestAnimationFrame(() => queryEl?.focus({ preventScroll: true }));
      }
    }

    function closePickerOverlay() {
      const pickerEl = $("[data-picker-overlay]", form);
      if (!pickerEl) return;
      clearSwapMode();
      pickerEl.hidden = true;
      form.classList.remove("is-picking");
      pickerOverlayToken = syncOverlayToken(pickerOverlayToken, false);
      updateProgress();
    }

    function applyExerciseSwap(rowIndex, nextId, nextSnapshot) {
      const targetRow = rows[rowIndex];
      if (!targetRow) return false;
      const completedSets = targetRow.sets.filter((s) => s.completed);
      const openSets = targetRow.sets.filter((s) => !s.completed);
      if (completedSets.length && !openSets.length) {
        notify("该动作已全部完成，无法替换剩余组");
        return false;
      }
      const nextMode = nextSnapshot?.mode ?? "reps";
      const normalizeSwappedSet = (s, resetWeight) => ({
        ...s,
        weight: nextMode === "timed" ? 0 : (resetWeight ? 0 : s.weight),
        seconds: nextMode === "timed" ? (s.seconds || 30) : 0,
        reps: nextMode === "timed" ? 0 : (s.reps || 8),
      });
      if (activeHold?.rowId === targetRow.id) activeHold = null;
      if (pendingUndo?.rowId === targetRow.id) {
        pendingUndo = null;
        clearTimeout(undoTimer);
        renderUndoBanner();
      }
      if (!completedSets.length) {
        targetRow.exerciseId = nextId;
        targetRow.snapshot = nextSnapshot;
        targetRow.sets = targetRow.sets.map((s) => normalizeSwappedSet(s, false));
        if (guided) focusRow = rowIndex;
      } else if (rows.length < 100) {
        targetRow.sets = completedSets;
        rows.splice(rowIndex + 1, 0, {
          id: uuid(),
          exerciseId: nextId,
          supersetGroup: targetRow.supersetGroup ?? null,
          restSeconds: targetRow.restSeconds,
          snapshot: nextSnapshot,
          sets: openSets.map((s) => ({ ...normalizeSwappedSet(s, true), id: uuid() })),
        });
        focusRow = rowIndex + 1;
      } else {
        notify("动作数量已达上限，无法拆分替换");
        return false;
      }
      return true;
    }

    function completeSetEffects(row, entry, wasComplete, { viaNativeSwitch = false } = {}) {
      if (activeHold?.setId === entry.id) activeHold = null;
      const curRowIdx = rows.indexOf(row);
      let supersetHandled = false;
      if (dateInput.value === today()) {
        entry.completedAt = entry.completedAt ?? new Date().toISOString();
        const startSetRest = () => {
          const entryIdx = row.sets.indexOf(entry);
          const nextPending = entryIdx >= 0 ? row.sets.slice(entryIdx + 1).find((s) => !s.completed) : null;
          const decision = resolveSetRestSeconds({
            setType: entry.type,
            nextSetType: nextPending?.type ?? null,
            defaultRestSeconds: row.restSeconds,
          });
          if (decision.reason === "drop_chain") {
            notify("递减组连续执行 · 降重后立即开组");
            return;
          }
          if (!decision.seconds) return;
          beginRest(decision.seconds, entry.id);
          if (decision.reason === "rest_pause") {
            notify(`休停组 · ${decision.seconds} 秒短暂喘息`);
          } else if (decision.reason === "warmup" && decision.seconds < (Number(row.restSeconds) || 0)) {
            notify(`热身组 · ${decision.seconds} 秒快捷间歇`);
          }
        };
        if (live && row.supersetGroup && curRowIdx >= 0) {
          const groupIndices = rows.flatMap((r, idx) => (r.supersetGroup === row.supersetGroup ? [idx] : []));
          if (groupIndices.length > 1) {
            const myDone = row.sets.filter((s) => s.completed).length;
            const posInGroup = groupIndices.indexOf(curRowIdx);
            let nextPartnerIdx = -1;
            for (let off = 1; off < groupIndices.length; off++) {
              const pIdx = groupIndices[(posInGroup + off) % groupIndices.length];
              const pRow = rows[pIdx];
              const pDone = pRow.sets.filter((s) => s.completed).length;
              if (pDone < myDone && pRow.sets.some((s) => !s.completed)) {
                nextPartnerIdx = pIdx;
                break;
              }
            }
            if (nextPartnerIdx >= 0) {
              supersetHandled = true;
              if (guided) {
                clearAutoAdvance();
                advanceTimer = setTimeout(() => {
                  advanceTimer = 0;
                  if (!dialog.open || !form.isConnected || reviewing) return;
                  jumpTo(nextPartnerIdx, true);
                  showStepNotice(`超级组 ${row.supersetGroup} · 下一搭档：${exerciseLabel(rows[nextPartnerIdx])}`, curRowIdx);
                }, 450);
              }
            } else {
              startSetRest();
              const firstPendingInGroup = groupIndices.find((idx) => rows[idx]?.sets.some((s) => !s.completed));
              if (guided && firstPendingInGroup !== undefined && firstPendingInGroup !== curRowIdx) {
                supersetHandled = true;
                clearAutoAdvance();
                advanceTimer = setTimeout(() => {
                  advanceTimer = 0;
                  if (!dialog.open || !form.isConnected || reviewing) return;
                  jumpTo(firstPendingInGroup, true);
                  showStepNotice(`本轮超级组完成 · 休息后回到「${exerciseLabel(rows[firstPendingInGroup])}」`, curRowIdx);
                }, 650);
              }
            }
          } else {
            startSetRest();
          }
        } else if (live) {
          startSetRest();
        }
      }
      const prHits = setBeatenPrs(row, entry);
      let isPrHit = false;
      if (prHits.length) {
        const freshHits = prHits.filter((hit) => {
          const prKey = `${row.exerciseId}:${hit.metric}:${hit.cur}`;
          if (celebratedPrKeys.has(prKey)) return false;
          celebratedPrKeys.add(prKey);
          return true;
        });
        if (freshHits.length) {
          isPrHit = true;
          audio.tap("pr");
          haptic("pr", { skipIosSwitch: viaNativeSwitch });
          notify(`新纪录！${exerciseLabel(row)} · ${freshHits[0].label}`);
        }
      }
      if (!isPrHit) {
        audio.tap("check");
        haptic("success", { skipIosSwitch: viaNativeSwitch });
      }
      updateProgress();
      if (!supersetHandled && live && guided && !wasComplete && isRowCompleted(row) && curRowIdx === focusRow) {
        const completedIndex = focusRow;
        const nextIndex = findNextPendingRow(completedIndex);
        if (nextIndex >= 0) {
          clearAutoAdvance();
          advanceTimer = setTimeout(() => {
            advanceTimer = 0;
            if (!dialog.open || !form.isConnected || reviewing) return;
            if (!isRowCompleted(rows[completedIndex]) || focusRow !== completedIndex) return;
            jumpTo(nextIndex, true);
            showStepNotice(`已完成「${exerciseLabel(rows[completedIndex])}」，已切换下一动作`, completedIndex);
          }, 650);
        }
      }
    }

    function removeSetAt(index, setIndex) {
      const row = rows[index];
      const targetSet = row?.sets[setIndex];
      if (!row || !targetSet) return;
      if (targetSet.id === rest?.setId) {
        rest = null;
        dialOpen = false;
        renderClocks();
      }
      if (activeHold?.setId === targetSet.id) activeHold = null;
      const [removed] = row.sets.splice(setIndex, 1);
      if (removed) {
        pendingUndo = { rowId: row.id, index: setIndex, entry: removed, label: exerciseLabel(row) };
        clearTimeout(undoTimer);
        undoTimer = setTimeout(() => { pendingUndo = null; renderUndoBanner(); }, 5000);
        renderUndoBanner();
      }
      renderRows();
      markDirty();
    }

    scroller?.addEventListener("focusin", ({ target }) => {
      if (target.matches('.set-row input[type="number"]')) {
        target.dataset.justFocused = "1";
        try { target.select(); } catch {}
        setTimeout(() => {
          if (document.activeElement === target) {
            try { target.select(); } catch {}
          }
        }, 25);
      }
    });
    scroller?.addEventListener("mouseup", (e) => {
      const target = e.target;
      if (target?.matches?.('.set-row input[type="number"]') && target.dataset.justFocused === "1") {
        delete target.dataset.justFocused;
        e.preventDefault();
        try { target.select(); } catch {}
      }
    });

    let touchStartX = 0, touchStartY = 0, touchStartTime = 0;
    let swipeSetEl = null, swipeAxisLocked = "";
    scroller?.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        if (e.touches[0].clientX < 20) {
          touchStartX = -1;
          swipeSetEl = null;
          return;
        }
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        swipeAxisLocked = "";
        const inStepper = e.target.closest?.(".num-step-btn, .muscle-pills, .exercise-jump");
        swipeSetEl = inStepper ? null : e.target.closest?.(".set-row");
        if (swipeSetEl) {
          swipeSetEl.style.transition = "none";
        }
      }
    }, { passive: true });
    scroller?.addEventListener("touchmove", (e) => {
      if (touchStartX < 0 || !swipeSetEl || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (!swipeAxisLocked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        swipeAxisLocked = Math.abs(dx) > Math.abs(dy) * 1.35 ? "x" : "y";
      }
      if (swipeAxisLocked !== "x") return;
      const clamped = Math.max(-96, Math.min(96, dx * 0.78));
      swipeSetEl.style.transform = `translateX(${clamped.toFixed(1)}px)`;
      swipeSetEl.classList.toggle("is-swiping-right", clamped > 24);
      swipeSetEl.classList.toggle("is-swiping-left", clamped < -24);
    }, { passive: true });
    const resetSetSwipe = () => {
      if (!swipeSetEl) return;
      const el = swipeSetEl;
      swipeSetEl = null;
      swipeAxisLocked = "";
      el.style.transition = "transform .18s ease";
      el.style.transform = "";
      el.classList.remove("is-swiping-right", "is-swiping-left");
    };
    scroller?.addEventListener("touchcancel", resetSetSwipe, { passive: true });
    scroller?.addEventListener("touchend", (e) => {
      if (e.target?.matches?.('.set-row input[type="number"]') && e.target.dataset.justFocused === "1") {
        const numInput = e.target;
        setTimeout(() => {
          delete numInput.dataset.justFocused;
          if (document.activeElement === numInput) {
            try { numInput.select(); } catch {}
          }
        }, 0);
      }
      if (touchStartX < 0) { resetSetSwipe(); return; }
      if (e.changedTouches.length !== 1) { resetSetSwipe(); return; }
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const duration = Date.now() - touchStartTime;

      if (swipeSetEl && swipeAxisLocked === "x") {
        const targetSetEl = swipeSetEl;
        resetSetSwipe();
        if (Math.abs(deltaX) >= 62 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
          if (deltaX > 0) {
            // Swipe Right -> Toggle set completed
            const checkbox = $('input[data-set="completed"]', targetSetEl);
            if (checkbox) {
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event("input", { bubbles: true }));
            }
          } else {
            // Swipe Left -> Delete set (with 5-second undo banner)
            audio.tap("skip");
            haptic("light");
            removeSetAt(Number(targetSetEl.dataset.row), Number(targetSetEl.dataset.index));
          }
          return;
        }
      } else {
        resetSetSwipe();
      }

      if (!live || reviewing || rows.length < 2) return;
      if (e.target.closest?.(".set-row, .workout-picker, input, select, textarea")) return;
      if (duration < 450 && Math.abs(deltaX) > 64 && Math.abs(deltaX) > 1.8 * Math.abs(deltaY)) {
        if (deltaX < 0 && focusRow < rows.length - 1) {
          jumpTo(focusRow + 1, true);
          audio.tap("tick");
          haptic("light");
        } else if (deltaX > 0 && focusRow > 0) {
          jumpTo(focusRow - 1, true);
          audio.tap("tick");
          haptic("light");
        }
      }
    }, { passive: true });

    form.addEventListener("input", (event) => {
      const { target } = event;
      if (target.matches?.("[data-quick-notes]")) {
        const mainNotes = $('[name="notes"]', form);
        if (mainNotes) mainNotes.value = target.value;
        markDirty();
        return;
      }
      if (target.dataset.rest !== undefined) {
        const seconds = Number(target.value);
        rows[Number(target.dataset.rest)].restSeconds = seconds;
      }
      if (target.name === "title" && live) $("[data-session-title]", form).textContent = target.value.trim() || "自由训练";
      if (target.name === "notes") {
        const quickNotesEl = $("[data-quick-notes]", form);
        if (quickNotesEl && quickNotesEl.value !== target.value) quickNotesEl.value = target.value;
      }
      if (target.name === "feeling") $('[data-workout="clear-feeling"]', form).hidden = false;
      if (!target.dataset.set) return;
      const row = rows[Number(target.dataset.row)];
      const entry = row.sets[Number(target.dataset.index)];
      const key = target.dataset.set;
      const wasComplete = key === "completed" ? isRowCompleted(row) : false;
      if (key === "type") entry.type = target.value;
      else if (key === "completed") entry.completed = target.checked;
      else if (key === "rir") entry.rir = target.value === "" ? null : Number(target.value);
      else entry[key] = Number(target.value);

      if (key === "weight") {
        untouchedWeights.delete(entry);
        const val = Number(target.value);
        if (val > 0) {
          const rowIndex = Number(target.dataset.row);
          const curIndex = Number(target.dataset.index);
          for (let i = curIndex + 1; i < row.sets.length; i++) {
            const nextSet = row.sets[i];
            if (!nextSet.completed && nextSet.weight === 0 && untouchedWeights.has(nextSet)) {
              nextSet.weight = val;
              untouchedWeights.delete(nextSet);
              const inputEl = $(`[data-set="weight"][data-row="${rowIndex}"][data-index="${i}"]`, list);
              if (inputEl) inputEl.value = String(val);
            }
          }
        }
      }

      if (key === "completed") {
        const viaNativeSwitch = Boolean(event.isTrusted);
        if (target.checked) {
          completeSetEffects(row, entry, wasComplete, { viaNativeSwitch });
        } else {
          if (activeHold?.setId === entry.id) activeHold = null;
          audio.tap("uncheck");
          haptic("light", { skipIosSwitch: viaNativeSwitch });
          delete entry.completedAt;
          clearAutoAdvance();
          if (rest?.setId === entry.id) { rest = null; dialOpen = false; renderClocks(); }
          updateProgress();
        }
        if (live && row.snapshot?.mode === "timed") {
          const rIdx = Number(target.dataset.row);
          const sIdx = Number(target.dataset.index);
          const secEl = $(`[data-row-index="${rIdx}"]`, list);
          if (secEl) updateSetInlineMetas(secEl, row, rIdx);
        }
      } else if (key === "weight" || key === "reps" || key === "seconds" || key === "rir") {
        updateReferences();
      }
      if (key === "completed" || key === "type") updateReferences();
      if (error.dataset.finishRequired && hasCompletedSet()) {
        error.hidden = true;
        delete error.dataset.finishRequired;
        syncDockVisibility();
      }
    });
    form.addEventListener("input", ({ target }) => {
      if (target.matches?.("[data-dossier-note]")) {
        const noteRow = rows[Number(target.dataset.dossierNote)];
        if (noteRow) draftDossierNotes.set(noteRow.exerciseId, target.value);
        return;
      }
      if (target.id !== "exercise-query" && !["keepScreen", "restSound", "autoDial", "restNotify", "toggleRirEdit"].includes(target.name)) markDirty();
    });
    form.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && event.target.matches?.("input")) event.preventDefault();
    }, true);
    form.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        const pickerOverlay = $("[data-picker-overlay]", form);
        if (pickerOverlay && !pickerOverlay.hidden) {
          event.preventDefault();
          event.stopPropagation();
          closePickerOverlay();
          return;
        }
        const adaptModal = $("[data-adapt-overlay]", form);
        if (adaptModal && !adaptModal.hidden) {
          event.preventDefault();
          event.stopPropagation();
          adaptModal.hidden = true;
          return;
        }
        if (sessionMenuOpen) {
          event.preventDefault();
          event.stopPropagation();
          sessionMenuOpen = false;
          updateProgress();
          return;
        }
        if (dialOverlay && !dialOverlay.hidden) {
          event.preventDefault();
          event.stopPropagation();
          dialOpen = false;
          renderClocks();
          return;
        }
      }
      if (event.key !== "Enter" || event.isComposing) return;
      const noteEl = event.target.closest?.("[data-dossier-note]");
      if (noteEl) {
        event.preventDefault();
        event.stopPropagation();
        $(`[data-workout="save-note"][data-row="${noteEl.dataset.dossierNote}"]`, list)?.click();
        return;
      }
      const setInput = event.target.closest?.("[data-set]");
      if (setInput) {
        const fieldKey = setInput.dataset.set;
        const setRowEl = setInput.closest(".set-row");
        if (fieldKey === "weight") {
          event.preventDefault();
          event.stopPropagation();
          if (setRowEl) $('[data-set="reps"]', setRowEl)?.focus();
          return;
        }
        if (fieldKey === "reps" || fieldKey === "seconds") {
          event.preventDefault();
          event.stopPropagation();
          setInput.dispatchEvent(new Event("input", { bubbles: true }));
          if (setRowEl) {
            const checkEl = $('[data-set="completed"]', setRowEl);
            if (checkEl && !checkEl.checked) checkEl.click();
            const secEl = setRowEl.closest(".exercise-editor");
            const nextRow = secEl ? $$(".set-row", secEl).find((el) => !$('[data-set="completed"]', el)?.checked) : null;
            const nextInput = nextRow ? ($('[data-set="weight"]', nextRow) ?? $('[data-set="seconds"]', nextRow)) : null;
            nextInput?.focus();
          }
          return;
        }
      }
      if (live && !reviewing && event.target.matches?.('input:not([type="checkbox"]):not([type="radio"])')) {
        event.preventDefault();
      }
    }, true);
    form.addEventListener("change", ({ target }) => {
      if (target === dateInput) {
        if (dateInput.value !== today()) { timing = pauseAt(timing, Date.now()); rest = null; dialOpen = false; }
        references.clear();
        prBaselines.clear();
        updateReferences();
        renderClocks();
        wake?.update();
        markDirty();
        void loadReferences();
      }
      if (target.name === "restSound") {
        localStorage.setItem(soundPreference, target.checked ? "on" : "off");
        if (target.checked) audio.unlock();
      }
      if (target.name === "autoDial") {
        localStorage.setItem(dialPreference, target.checked ? "on" : "off");
      }
      if (target.name === "restNotify") {
        if (target.checked) {
          if ("Notification" in window) {
            if (Notification.permission === "granted") {
              localStorage.setItem(notifyPreference, "on");
            } else if (Notification.permission === "denied") {
              target.checked = false;
              localStorage.setItem(notifyPreference, "off");
              notify("浏览器已屏蔽通知权限，请在地址栏权限设置中允许通知");
            } else {
              Notification.requestPermission().then((perm) => {
                if (perm === "granted") {
                  localStorage.setItem(notifyPreference, "on");
                  notify("已开启后台休息结束提醒");
                } else {
                  target.checked = false;
                  localStorage.setItem(notifyPreference, "off");
                  notify("未授予通知权限，已关闭后台提醒");
                }
              }).catch(() => { target.checked = false; });
            }
          }
        } else {
          localStorage.setItem(notifyPreference, "off");
        }
      }
      if (target.name === "toggleRirEdit") {
        showRir = target.checked;
        localStorage.setItem(rirPreference, showRir ? "on" : "off");
        updateProgress();
      }
      if (target.name === "keepScreen") {
        localStorage.setItem(screenPreference, target.checked ? "on" : "off");
        wake?.update();
      }
    });
    form.addEventListener("invalid", ({ target }) => {
      if (live && reviewing) {
        showFinish(false);
        notify("请补全空白的训练组或日期/标题必填项");
      }
      if (target.closest("[data-session-menu]")) {
        sessionMenuOpen = true;
        const menuEl = $("[data-session-menu]", form);
        if (menuEl) menuEl.hidden = false;
      }
      const details = target.closest("details");
      if (details) {
        if (details.classList.contains("training-details")) settingsOpen = true;
        details.hidden = false;
        details.open = true;
      }
      const section = target.closest("[data-row-index]");
      if (section?.hidden) jumpTo(Number(section.dataset.rowIndex), false);
      setTimeout(() => { if (form.isConnected && target.isConnected) target.focus({ preventScroll: false }); }, 0);
    }, true);
    function hasCompletedSet() {
      return rows.some((row) => row.sets.some((entry) =>
        entry.completed && (row.snapshot?.mode === "timed" ? entry.seconds > 0 : entry.reps > 0)));
    }
    function canFinish() {
      if (hasCompletedSet()) return true;
      error.textContent = "至少完成一组有效训练，或在更多设置中存为草稿。";
      error.hidden = false;
      error.dataset.finishRequired = "true";
      syncDockVisibility();
      return false;
    }
    function showFinish(openReview) {
      const panel = $(".finish-panel", form);
      reviewing = openReview;
      dialOpen = false;
      sessionMenuOpen = false;
      if (openReview) {
        const quickNotesEl = $("[data-quick-notes]", form);
        const mainNotesEl = $('[name="notes"]', panel);
        if (quickNotesEl && mainNotesEl && quickNotesEl.value !== mainNotesEl.value) {
          mainNotesEl.value = quickNotesEl.value;
        }
        renderFinishSummary();
      }
      panel.hidden = !openReview;
      updateProgress();
      renderClocks();
      if (openReview) {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        ($('[name="feeling"]:checked', panel) ?? $('[name="feeling"]', panel)).focus({ preventScroll: true });
      } else {
        jumpTo(focusRow, false);
        $(".finish-trigger", form).focus({ preventScroll: true });
      }
    }
    form.addEventListener("click", ({ target }) => {
      const clockControl = target.closest("[data-clock]")?.dataset.clock;
      if (clockControl) {
        const instant = Date.now();
        audio.unlock();
        audio.tap(clockControl === "skip" || clockControl === "pause-rest" ? "skip" : "tick");
        haptic("light");
        if (clockControl === "skip") { rest = null; dialOpen = false; }
        if (clockControl === "dial-open") { dialOpen = true; lastRest = null; }
        if (clockControl === "dial-close") { dialOpen = false; }
        if ((clockControl === "add15" || clockControl === "add") && rest) {
          rest = shiftRestTimer(rest, 15, instant);
          lastRest = null;
          restSoundedEndAt = 0;
          restNotifiedEndAt = 0;
        }
        if (clockControl === "sub15" && rest) {
          rest = shiftRestTimer(rest, -15, instant);
          lastRest = null;
          restSoundedEndAt = 0;
          restNotifiedEndAt = 0;
        }
        if (clockControl === "pause-rest" && rest) {
          rest = rest.pausedLeftMs != null ? resumeRestTimer(rest, instant) : pauseRestTimer(rest, instant);
          lastRest = null;
          restSoundedEndAt = 0;
          restNotifiedEndAt = 0;
        }
        if (clockControl === "train") timing = timing.runningSince ? pauseAt(timing, instant)
          : { ...timing, runningSince: new Date(instant).toISOString() };
        renderClocks();
        wake?.update();
        markDirty();
        return;
      }
      const clockPreset = target.closest("[data-clock-preset]");
      if (clockPreset) {
        const sec = Number(clockPreset.dataset.clockPreset);
        if (sec > 0) {
          dialOpen = true;
          audio.unlock();
          audio.tap("tick");
          haptic("light");
          beginRest(sec, rest?.setId ?? null);
          markDirty();
        }
        return;
      }
      const stepBtn = target.closest("[data-step-wt], [data-step-rep], [data-step-sec]");
      if (stepBtn) {
        stopStepRepeat();
        if (Date.now() < suppressStepClickUntil) {
          suppressStepClickUntil = 0;
          return;
        }
        applyStepperButton(stepBtn, { fromRepeat: false });
        return;
      }
      const cloneBtn = target.closest("[data-step-clone]");
      if (cloneBtn) {
        const rIdx = Number(cloneBtn.dataset.stepClone);
        const sIdx = Number(cloneBtn.dataset.index);
        const targetRow = rows[rIdx];
        if (targetRow && sIdx > 0) {
          const prev = targetRow.sets[sIdx - 1];
          const cur = targetRow.sets[sIdx];
          if (prev && cur) {
            cur.weight = prev.weight;
            cur.reps = prev.reps;
            cur.seconds = prev.seconds;
            untouchedWeights.delete(cur);
            const wtInput = $(`[data-set="weight"][data-row="${rIdx}"][data-index="${sIdx}"]`, list);
            const repInput = $(`[data-set="reps"][data-row="${rIdx}"][data-index="${sIdx}"]`, list);
            if (wtInput) wtInput.value = String(cur.weight);
            if (repInput) repInput.value = String(cur.reps);
            updateReferences();
            updateLiveMetrics();
            markDirty();
            audio.unlock();
            audio.tap("tick");
            haptic("light");
          }
        }
        return;
      }
      const fillRestBtn = target.closest("[data-step-fill-rest]");
      if (fillRestBtn) {
        const rIdx = Number(fillRestBtn.dataset.stepFillRest);
        const sIdx = Number(fillRestBtn.dataset.index);
        const targetRow = rows[rIdx];
        const src = targetRow?.sets[sIdx];
        if (targetRow && src) {
          let filled = 0;
          for (let k = sIdx + 1; k < targetRow.sets.length; k++) {
            const dst = targetRow.sets[k];
            if (dst.completed || dst.type === "warmup") continue;
            dst.weight = src.weight;
            dst.reps = src.reps;
            untouchedWeights.delete(dst);
            filled++;
          }
          if (filled > 0) {
            renderRows();
            markDirty();
            audio.unlock();
            audio.tap("tick");
            haptic("light");
            notify(`已将 ${fmt(src.weight)} kg × ${src.reps} 同步至后续 ${filled} 组`);
          }
        }
        return;
      }
      const barSelect = target.closest("[data-plate-bar]");
      if (barSelect) {
        barWeight = Number(barSelect.dataset.plateBar);
        localStorage.setItem(barPreference, String(barWeight));
        updateLiveMetrics();
        audio.unlock();
        audio.tap("tick");
        haptic("light");
        return;
      }
      const plateToggle = target.closest("[data-plate-toggle]");
      if (plateToggle) {
        const val = Number(plateToggle.dataset.plateToggle);
        if (enabledPlates.includes(val)) {
          if (enabledPlates.length <= 1) { notify("至少保留一种配片规格"); return; }
          enabledPlates = enabledPlates.filter((p) => p !== val);
        } else {
          enabledPlates = [...enabledPlates, val].sort((a, b) => b - a);
        }
        localStorage.setItem(platesPreference, JSON.stringify(enabledPlates));
        updateLiveMetrics();
        audio.unlock();
        audio.tap("tick");
        haptic("light");
        return;
      }
      const button = target.closest("[data-workout]");
      if (!button) return;
      audio.unlock();
      audio.tap(button.dataset.workout === "remove-set" || button.dataset.workout === "remove-row" ? "skip" : "tick");
      haptic("light");
      if (button.dataset.workout === "gen-warmups") {
        const targetRow = rows[Number(button.dataset.row)];
        if (targetRow && (targetRow.snapshot?.mode ?? "reps") === "reps") {
          const maxWeight = Math.max(...targetRow.sets.filter((s) => s.type !== "warmup").map((s) => s.weight || 0), 0);
          const isBarbell = targetRow.snapshot?.equipment === "barbell";
          const warmups = [];
          let prevWeight = -1;
          if (isBarbell && barWeight > 0 && barWeight < maxWeight) {
            warmups.push({ ...set(), type: "warmup", weight: barWeight, reps: 10, completed: false });
            prevWeight = barWeight;
          }
          const ratios = maxWeight >= 100
            ? [[0.55, 5], [0.75, 3], [0.88, 1]]
            : isBarbell ? [[0.55, 6], [0.75, 3]] : [[0.45, 10], [0.65, 6], [0.8, 3]];
          for (const [ratio, reps] of ratios) {
            const w = snapWarmupWeight(maxWeight * ratio, isBarbell, barWeight, enabledPlates);
            if (w > 0 && w > prevWeight && w < maxWeight) {
              warmups.push({ ...set(), type: "warmup", weight: w, reps, completed: false });
              prevWeight = w;
            }
          }
          if (!warmups.length && maxWeight > 0) {
            warmups.push({ ...set(), type: "warmup", weight: snapWarmupWeight(maxWeight * 0.5, isBarbell, barWeight, enabledPlates), reps: 8, completed: false });
          }
          targetRow.sets.unshift(...warmups);
          renderRows();
          markDirty();
          haptic("success");
          notify(`已为「${exerciseLabel(targetRow)}」生成 ${warmups.length} 组热身：${warmups.map((s) => fmt(s.weight)).join(" / ")} kg`);
        }
        return;
      }
      if (button.dataset.workout === "toggle-rir") {
        showRir = !showRir;
        localStorage.setItem(rirPreference, showRir ? "on" : "off");
        updateProgress();
        return;
      }
      if (button.dataset.workout === "quick-rest") {
        const activeRest = normalizeRestTimer(rest, Date.now());
        dialOpen = true;
        if (!activeRest) {
          const sec = Math.max(15, Math.min(900, Number(rows[focusRow]?.restSeconds) || 90));
          beginRest(sec, null);
        } else {
          renderClocks();
        }
        markDirty();
        haptic("light");
        return;
      }
      if (button.dataset.workout === "toggle-bar") {
        barWeight = barWeight === 20 ? 15 : 20;
        localStorage.setItem(barPreference, String(barWeight));
        updateLiveMetrics();
        return;
      }
      if (button.dataset.workout === "toggle-plate-config") {
        const rowId = button.dataset.rowId ?? "";
        plateConfigRowId = plateConfigRowId === rowId ? "" : rowId;
        updateLiveMetrics();
        return;
      }
      if (button.dataset.workout === "finish-review") {
        if (canFinish()) { error.hidden = true; showFinish(true); }
        return;
      }
      if (button.dataset.workout === "back-from-finish") { showFinish(false); return; }
      if (button.dataset.workout === "save-draft") {
        if (!dateInput.value) dateInput.value = today();
        submitWorkout("active");
        return;
      }
      if (button.dataset.workout === "check-remaining") {
        const nowIso = new Date().toISOString();
        let added = 0;
        for (const r of rows) {
          const exMode = r.snapshot?.mode ?? "reps";
          for (const s of r.sets) {
            if (!s.completed && s.type !== "warmup" && (exMode === "timed" ? s.seconds > 0 : s.reps > 0)) {
              if (activeHold?.setId === s.id) activeHold = null;
              s.completed = true;
              s.completedAt = s.completedAt ?? nowIso;
              added++;
            }
          }
        }
        if (added) {
          renderRows();
          renderFinishSummary();
          markDirty();
          haptic("success");
          notify(`已补勾全部剩余 ${added} 组`);
        }
        return;
      }
      if (button.dataset.workout === "clear-feeling") {
        const selection = $('[name="feeling"]:checked', form);
        if (selection) selection.checked = false;
        button.hidden = true;
        $('[name="feeling"]', form).focus({ preventScroll: true });
        markDirty();
        return;
      }
      if (button.dataset.workout === "toggle-session-menu") {
        sessionMenuOpen = !sessionMenuOpen;
        updateProgress();
        return;
      }
      if (button.dataset.workout === "close-session-menu") {
        sessionMenuOpen = false;
        updateProgress();
        return;
      }
      if (button.dataset.workout === "open-notes") {
        quickNotesOpen = !quickNotesOpen;
        const box = $("[data-quick-note-box]", form);
        if (box) box.hidden = !quickNotesOpen;
        button.setAttribute("aria-expanded", String(quickNotesOpen));
        if (quickNotesOpen) $("[data-quick-notes]", box)?.focus();
        return;
      }
      if (button.dataset.workout === "toggle-layout") {
        guided = !guided;
        updateProgress();
        return;
      }
      if (button.dataset.workout === "toggle-settings") {
        settingsOpen = !settingsOpen;
        updateProgress();
        if (settingsOpen) {
          requestAnimationFrame(() => {
            $(".training-details", form)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
        }
        return;
      }
      if (button.dataset.workout === "open-picker") {
        openPickerOverlay(-1);
        return;
      }
      if (button.dataset.workout === "close-picker") {
        closePickerOverlay();
        return;
      }
      if (button.dataset.workout === "step") {
        jumpTo(focusRow + Number(button.dataset.step));
        if (button.hidden || button.disabled) $(`[data-row-index="${focusRow}"] h3`, list)?.focus({ preventScroll: true });
        return;
      }
      if (button.dataset.workout === "undo-set" && pendingUndo) {
        const { rowId, index: restoreAt, entry } = pendingUndo;
        const targetRow = rows.find((item) => item.id === rowId);
        pendingUndo = null;
        clearTimeout(undoTimer);
        renderUndoBanner();
        if (targetRow) {
          targetRow.sets.splice(Math.min(restoreAt, targetRow.sets.length), 0, entry);
          renderRows();
          markDirty();
          notify("已恢复该组");
        }
        return;
      }
      if (button.dataset.workout === "create-custom-exercise") {
        remember();
        const savedRecord = activeRecord;
        const savedData = {
          ...data,
          ...(template ? { templateKey: template } : {}),
          exerciseMeta: seedExerciseMeta,
        };
        const savedSettings = settings;
        const reopenKey = scope
          ? "ironlog-web-draft:" + scope + ":" + (savedRecord ? savedRecord.id + ":" + savedRecord.version : template ? "template:" + template : "new")
          : "";
        if (reopenKey && reopenKey !== draftKey) {
          try {
            const rawDraft = localStorage.getItem(draftKey);
            if (rawDraft) localStorage.setItem(reopenKey, rawDraft);
          } catch {}
        }
        const prevClose = closeWorkout;
        closeWorkout = null;
        prevClose?.();
        onCreateCustomExercise?.({
          onDone: (created) => {
            if (created && reopenKey) {
              try {
                const raw = localStorage.getItem(reopenKey) ?? localStorage.getItem(draftKey);
                const draft = raw ? JSON.parse(raw) : { exercises: rows };
                const { name, muscle, equipment: equip, mode, volumeMultiplier } = created;
                draft.exercises = [...(draft.exercises ?? rows), {
                  id: uuid(), exerciseId: created.id, restSeconds: settings.restSeconds ?? 90,
                  snapshot: { name, muscle, equipment: equip, mode, volumeMultiplier },
                  sets: Array.from({ length: 3 }, () => ({
                    ...set(), seconds: mode === "timed" ? 30 : 0, reps: mode === "timed" ? 0 : 8,
                  })),
                }];
                draft.focusId = draft.exercises.at(-1)?.id;
                localStorage.setItem(reopenKey, JSON.stringify(draft));
              } catch {}
            }
            editWorkout(savedRecord, savedData, savedSettings);
          },
        });
        return;
      }
      const index = Number(button.dataset.row);
      const row = rows[index];
      const setIndex = Number(button.dataset.index);
      if (button.dataset.workout === "toggle-ex-menu" && row) {
        if (openExMenus.has(row.id)) openExMenus.delete(row.id);
        else openExMenus.add(row.id);
        const isOpen = openExMenus.has(row.id);
        const menuPanel = $(`[data-ex-menu="${index}"]`, list);
        if (menuPanel) menuPanel.hidden = !isOpen;
        button.setAttribute("aria-expanded", String(isOpen));
        return;
      }
      if (button.dataset.workout === "toggle-del-sets" && row) {
        if (deleteSetMode.has(row.id)) deleteSetMode.delete(row.id);
        else deleteSetMode.add(row.id);
        renderRows();
        return;
      }
      if (button.dataset.workout === "sync-rest-sets" && row) {
        const src = row.sets.findLast((s) => s.completed && s.type !== "warmup")
          ?? row.sets.find((s) => !s.completed && s.type !== "warmup" && s.weight > 0)
          ?? row.sets.find((s) => !s.completed && s.type !== "warmup");
        const srcIdx = src ? row.sets.indexOf(src) : -1;
        if (src && srcIdx >= 0) {
          let filled = 0;
          for (let k = srcIdx + 1; k < row.sets.length; k++) {
            const dst = row.sets[k];
            if (dst.completed || dst.type === "warmup") continue;
            dst.weight = src.weight;
            dst.reps = src.reps;
            dst.seconds = src.seconds;
            untouchedWeights.delete(dst);
            filled++;
          }
          if (filled > 0) {
            renderRows();
            markDirty();
            notify(`已将 ${fmt(src.weight)} kg × ${src.reps} 同步至后续 ${filled} 组`);
          } else {
            notify("当前动作没有可同步的后续工作组");
          }
        }
        return;
      }
      if (button.dataset.workout === "set-rest" && row) {
        const sec = Number(button.dataset.seconds);
        row.restSeconds = sec;
        openExMenus.delete(row.id);
        renderRows();
        markDirty();
        notify(`组间休息已设为 ${sec} 秒`);
        return;
      }
      if (button.dataset.workout === "start-rest" && row && live) {
        openExMenus.delete(row.id);
        const menuPanel = $(`[data-ex-menu="${index}"]`, list);
        if (menuPanel) menuPanel.hidden = true;
        if (row.restSeconds > 0) {
          beginRest(row.restSeconds, row.sets.at(-1)?.id ?? row.id);
          notify(`已开启 ${row.restSeconds} 秒组间休息`);
        }
        return;
      }
      if (button.dataset.workout === "move-row" && row) {
        const dir = Number(button.dataset.dir);
        const targetPos = index + dir;
        if (targetPos >= 0 && targetPos < rows.length) {
          [rows[index], rows[targetPos]] = [rows[targetPos], rows[index]];
          if (focusRow === index) focusRow = targetPos;
          else if (focusRow === targetPos) focusRow = index;
          renderRows();
          markDirty();
        }
        return;
      }
      if (button.dataset.workout === "focus-row") {
        stepNotice = null;
        clearTimeout(stepNoticeTimer);
        renderUndoBanner();
        jumpTo(index);
        return;
      }
      if (button.dataset.workout === "cycle-type" && row && row.sets[setIndex]) {
        const order = ["normal", "warmup", "failure", "drop", "rest_pause"];
        const labels = { normal: "常规", warmup: "热身", failure: "力竭", drop: "递减", rest_pause: "休停" };
        const entry = row.sets[setIndex];
        entry.type = order[(order.indexOf(entry.type) + 1) % order.length];
        renderRows();
        markDirty();
        notify(`已切换为${labels[entry.type]}组`);
        return;
      }
      if (button.dataset.workout === "toggle-unilateral" && row) {
        const detail = exerciseDetails.get(row.exerciseId);
        row.snapshot = row.snapshot ?? (detail
          ? { name: detail.name, muscle: detail.muscle, equipment: detail.equipment, mode: detail.mode, volumeMultiplier: detail.volumeMultiplier ?? 1 }
          : { name: exerciseLabel(row), muscle: "chest", equipment: "dumbbell", mode: "reps", volumeMultiplier: 1 });
        row.snapshot.volumeMultiplier = (row.snapshot.volumeMultiplier ?? 1) >= 2 ? 1 : 2;
        renderRows();
        markDirty();
        notify(row.snapshot.volumeMultiplier === 2 ? "已切换为单侧双倍计容（每组重量 × 2）" : "已切换为标准总重计容（× 1）");
        return;
      }
      if (button.dataset.workout === "toggle-superset" && row) {
        toggleSupersetAt(index);
        renderRows();
        markDirty();
        notify(row.supersetGroup ? `已编入超级组 ${row.supersetGroup}` : "已取消超级组配对");
        return;
      }
      if (button.dataset.workout === "toggle-motion" && row) {
        if (openMotions.has(row.id)) openMotions.delete(row.id);
        else openMotions.add(row.id);
        const nowOpen = openMotions.has(row.id);
        openExMenus.delete(row.id);
        const slot = $(`[data-motion-slot="${index}"]`, list);
        if (slot) slot.hidden = !nowOpen;
        const menuPanel = $(`[data-ex-menu="${index}"]`, list);
        if (menuPanel) menuPanel.hidden = true;
        const thumbBtn = $(`[data-ex-thumb="${index}"]`, list);
        if (thumbBtn) thumbBtn.setAttribute("aria-pressed", String(nowOpen));
        $$(`[data-workout="toggle-motion"][data-row="${index}"]`, list).forEach((el) => {
          if (el === thumbBtn) return;
          el.classList.toggle("is-active", nowOpen);
          el.innerHTML = `${icon("play", 14)} ${nowOpen ? "收起示范" : "动作示范"}`;
        });
        return;
      }
      if (button.dataset.workout === "toggle-dossier" && row) {
        if (openDossiers.has(row.id)) openDossiers.delete(row.id);
        else {
          openDossiers.add(row.id);
          void loadExerciseHistoryFor(row.exerciseId);
        }
        renderRows();
        if (openDossiers.has(row.id)) $(`[data-dossier-note="${index}"]`, list)?.focus({ preventScroll: true });
        return;
      }
      if (button.dataset.workout === "save-note" && row) {
        const noteInput = $(`[data-dossier-note="${index}"]`, list);
        const noteText = (noteInput?.value ?? "").trim();
        button.disabled = true;
        void api("/api/web/exercise-notes/" + encodeURIComponent(row.exerciseId), {
          method: "PUT",
          body: { note: noteText },
        }).then((saved) => {
          draftDossierNotes.delete(row.exerciseId);
          if (saved.note) exerciseNotes.set(row.exerciseId, saved.note);
          else exerciseNotes.delete(row.exerciseId);
          $$(".exercise-editor", list).forEach((section, rIdx) => {
            if (rows[rIdx]?.exerciseId !== row.exerciseId) return;
            const cueSlot = $("[data-cue-slot]", section);
            if (cueSlot) cueSlot.innerHTML = cuePillMarkup(saved.note, rIdx);
          });
          notify(saved.note ? "已保存动作技术备忘" : "已清空动作备忘");
        }).catch((err) => notify(err.message)).finally(() => { button.disabled = false; });
        return;
      }
      if (button.dataset.workout === "apply-readiness-deload") {
        const scale = getReadinessHint?.()?.suggestedScale ?? 0.9;
        let touched = 0;
        for (const r of rows) {
          const exMode = r.snapshot?.mode ?? "reps";
          if (exMode === "timed") continue;
          for (const s of r.sets) {
            if (!s.completed && s.type !== "warmup" && s.weight > 0) {
              untouchedWeights.delete(s);
              const step = s.weight <= 5 ? 0.5 : 2.5;
              if (exMode === "assisted") {
                const next = Math.round((s.weight * (2 - scale)) / step) * step;
                s.weight = Math.max(s.weight, round2(next));
              } else {
                const next = Math.max(step, Math.round((s.weight * scale) / step) * step);
                s.weight = Math.min(s.weight, round2(next));
              }
              touched++;
            }
          }
        }
        readinessDismissed = true;
        renderRows();
        markDirty();
        notify(touched ? "已将未完成工作组重量按减载规则调整" : "已收起减载提示");
        return;
      }
      if (button.dataset.workout === "dismiss-readiness") {
        readinessDismissed = true;
        renderReadinessBanner();
        return;
      }
      if (button.dataset.workout === "apply-deload") {
        const meta = rowMeta(row, index);
        const deloadW = meta?.progression?.deloadWeight;
        if (deloadW != null) {
          row.sets.forEach((entry) => {
            if (!entry.completed && entry.type !== "warmup") {
              untouchedWeights.delete(entry);
              entry.weight = deloadW;
            }
          });
          renderRows();
          markDirty();
          notify(`${exerciseLabel(row)} 未完成组已减载至 ${fmt(deloadW)} kg`);
        }
        return;
      }
      if (button.dataset.workout === "hold-timer" && row && row.sets[setIndex] && live) {
        const entry = row.sets[setIndex];
        if (activeHold && activeHold.rowId === row.id && activeHold.setId === entry.id) {
          const sec = Math.max(1, Math.floor((Date.now() - activeHold.startedAt) / 1000));
          const wasComplete = isRowCompleted(row);
          activeHold = null;
          entry.seconds = sec;
          entry.completed = true;
          entry.completedAt = new Date().toISOString();
          renderRows();
          completeSetEffects(row, entry, wasComplete);
          markDirty();
          notify(`已完成保持 ${sec} 秒`);
        } else if (!entry.completed) {
          activeHold = {
            rowId: row.id,
            setId: entry.id,
            startedAt: Date.now(),
            targetSeconds: entry.seconds || 0,
            beeped: false,
          };
          audio.unlock();
          renderRows();
        }
        return;
      }
      if (button.dataset.workout === "apply-pct-load" && row) {
        const w = Number(button.dataset.weight);
        const r = Number(button.dataset.reps);
        const targetSet = row.sets.find((s) => !s.completed && s.type !== "warmup")
          ?? row.sets.findLast((s) => !s.completed);
        if (targetSet && w > 0) {
          untouchedWeights.delete(targetSet);
          targetSet.weight = w;
          if (r > 0) targetSet.reps = r;
          renderRows();
          markDirty();
          haptic("light");
          notify(`已填入 ${fmt(w)} kg × ${r} 次`);
        } else {
          notify("当前动作没有可填入的待完成组");
        }
        return;
      }
      if (button.dataset.workout === "add-drop-set" && row && row.sets.length < 100 && (row.snapshot?.mode ?? "reps") === "reps") {
        const last = [...row.sets].reverse().find((s) => s.weight > 0) ?? row.sets.at(-1);
        const baseW = Number(last?.weight) || 0;
        const step = baseW <= 10 ? 0.5 : 2.5;
        let dropW = Math.max(step, Math.round((baseW * 0.8) / step) * step);
        if (dropW >= baseW && baseW > 0) dropW = Math.max(0, round2(baseW - step));
        const added = {
          ...set(),
          type: "drop",
          weight: round2(dropW),
          reps: last?.reps || 8,
          seconds: 0,
        };
        row.sets.push(added);
        renderRows();
        markDirty();
        haptic("light");
        notify(`已添加递减组（${fmt(dropW)} kg）`);
        return;
      }
      if (button.dataset.workout === "add-rest-pause" && row && row.sets.length < 100) {
        const last = [...row.sets].reverse().find((s) => s.weight > 0) ?? row.sets.at(-1);
        const baseW = Number(last?.weight) || 0;
        const added = {
          ...set(),
          type: "rest_pause",
          weight: round2(baseW),
          reps: Math.max(1, Math.round((last?.reps || 8) * 0.5)),
          seconds: 0,
        };
        row.sets.push(added);
        renderRows();
        markDirty();
        haptic("light");
        notify(`已添加休停组（${fmt(baseW)} kg · 组间 20 秒）`);
        return;
      }
      if (button.dataset.workout === "swap-any" && row) {
        if (row.sets.some((s) => s.completed) && !row.sets.some((s) => !s.completed)) {
          notify("该动作已全部完成，无法替换剩余组");
          return;
        }
        openExMenus.delete(row.id);
        const menuPanel = $(`[data-ex-menu="${index}"]`, list);
        if (menuPanel) menuPanel.hidden = true;
        openPickerOverlay(index);
        return;
      }
      if (button.dataset.workout === "cancel-swap") {
        closePickerOverlay();
        return;
      }
      if (button.dataset.workout === "swap-backup") {
        const meta = rowMeta(row, index);
        const backup = meta?.backup;
        if (backup && applyExerciseSwap(index, backup.id, backup.snapshot)) {
          renderRows();
          markDirty();
          void loadReferences();
          void loadExerciseDetails();
          notify(`已切换备选动作：${backup.name}`);
        }
        return;
      }
      if (button.dataset.workout === "use-reference") {
        const entry = row.sets[setIndex];
        const previous = referenceForSet(row, setIndex);
        if (previous && !entry.completed && entry.type !== "warmup") {
          untouchedWeights.delete(entry);
          if (row.snapshot?.mode === "timed") entry.seconds = previous.seconds;
          else Object.assign(entry, { weight: previous.weight, reps: previous.reps });
        }
      }
      if (button.dataset.workout === "use-workout-reference") {
        row.sets.forEach((entry, position) => {
          const value = referenceForSet(row, position);
          if (!value || entry.completed || entry.type === "warmup") return;
          untouchedWeights.delete(entry);
          if (row.snapshot?.mode === "timed") entry.seconds = value.seconds;
          else Object.assign(entry, { weight: value.weight, reps: value.reps });
        });
      }
      if (button.dataset.workout === "remove-row" && row.sets.some((entry) => entry.id === rest?.setId)) {
        rest = null;
        dialOpen = false;
        renderClocks();
      }
      if (button.dataset.workout === "remove-row" && activeHold?.rowId === row?.id) {
        activeHold = null;
      }
      if (button.dataset.workout === "remove-row") {
        if (swapTargetRow === index) clearSwapMode();
        else if (swapTargetRow > index) swapTargetRow--;
        openExMenus.delete(row.id);
        deleteSetMode.delete(row.id);
        rows.splice(index, 1);
        cleanSupersetOrphans();
        if (index < focusRow) focusRow--;
        pendingUndo = null;
        renderUndoBanner();
      }
      if (button.dataset.workout === "remove-set") {
        removeSetAt(index, setIndex);
        return;
      }
      if (button.dataset.workout === "add-set" && row.sets.length < 100) {
        pendingUndo = null;
        renderUndoBanner();
        const last = row.sets.at(-1);
        const added = { ...set(), weight: last?.weight ?? 0, reps: last?.reps ?? 8, seconds: last?.seconds ?? (row.snapshot?.mode === "timed" ? 30 : 0) };
        if (added.weight === 0) untouchedWeights.add(added);
        row.sets.push(added);
      }
      renderRows();
      if (button.dataset.workout === "add-set") $('[data-workout="add-set"][data-row="' + index + '"]', list)?.focus({ preventScroll: true });
      markDirty();
    });

    const query = $("#exercise-query");
    const adaptOverlay = $("[data-adapt-overlay]", form);
    const adaptInput = $("[data-adapt-input]", form);
    const adaptProposal = $("[data-adapt-proposal]", form);
    const adaptError = $("[data-adapt-error]", form);
    const adaptAskBtn = $('[data-adapt="ask"]', form);
    const adaptApplyBtn = $('[data-adapt="apply"]', form);

    function formatAdaptPatch(before, patch) {
      const notes = [];
      if (patch.exerciseId && patch.exerciseId !== before.exerciseId) notes.push(`更换动作`);
      if (patch.weight !== undefined) notes.push(`重量 → ${patch.weight} kg`);
      if (patch.reps !== undefined) notes.push(`次数 → ${patch.reps} 次`);
      if (patch.seconds !== undefined) notes.push(`时长 → ${patch.seconds} 秒`);
      if (patch.remainingSets !== undefined) {
        notes.push(patch.remainingSets === 0 ? "跳过余下组" : `余组 ${before.openSets.length} → ${patch.remainingSets} 组`);
      }
      if (patch.restSeconds !== undefined) notes.push(`休息 → ${patch.restSeconds} 秒`);
      return notes.join(" · ") || "微调参数";
    }

    async function ensureActiveRecordSaved() {
      const date = dateInput.value;
      const nowDate = new Date();
      const minutes = $('[name="minutes"]', form)?.value ?? "";
      const elapsed = minutes === "" ? null : Math.round(Number(minutes) * 60);
      const tracked = pauseAt(timing, nowDate.getTime());
      const recordedTime = elapsed !== null ? { elapsedSeconds: elapsed, runningSince: null }
        : (date === today() || (date === initialDate && tracked.elapsedSeconds > 0)) ? tracked : undefined;
      const resting = rest?.pausedLeftMs == null && rest?.end > nowDate.getTime() && date === today();
      const payload = {
        ...data,
        date,
        title: $('[name="title"]', form)?.value.trim() || "自由训练",
        startedAt: startFor(date),
        endedAt: null,
        status: "active",
        durationUnknown: false,
        notes: $('[name="notes"]', form)?.value ?? "",
        feeling: $('[name="feeling"]:checked', form)?.value || null,
        exercises: rows,
        timing: recordedTime,
        restEndsAt: resting ? rest.end : null,
        restStartedAt: resting ? rest.start : null,
        adjustments: activeRecord?.data?.adjustments ?? data.adjustments ?? [],
      };
      const res = await api("/api/records", {
        method: "POST",
        body: { opId: uuid(), id: workoutId, kind: "workout", baseVersion: activeRecord?.version ?? 0, deleted: false, data: payload },
      });
      if (res.record) activeRecord = res.record;
      return activeRecord;
    }

    function openAdaptOverlay() {
      if (!adaptOverlay) return;
      if (!rows.some((r) => r.sets.some((s) => !s.completed))) {
        notify("当前没有待完成的训练组，可结束训练或先加一组");
        return;
      }
      dialOpen = false;
      sessionMenuOpen = false;
      const menuEl = $("[data-session-menu]", form);
      if (menuEl) menuEl.hidden = true;
      activeAdapt = null;
      adaptProposal.hidden = true;
      adaptProposal.innerHTML = "";
      adaptApplyBtn.hidden = true;
      adaptAskBtn.className = "primary-button";
      adaptAskBtn.textContent = "获取 AI 建议";
      adaptError.hidden = true;
      adaptOverlay.hidden = false;
      adaptOverlayToken = syncOverlayToken(adaptOverlayToken, true, () => {
        adaptOverlayToken = null;
        adaptOverlay.hidden = true;
      });
      renderClocks();
      adaptInput?.focus();
    }

    $$("[data-adapt-preset]", form).forEach((btn) => btn.addEventListener("click", () => {
      if (!adaptInput) return;
      adaptInput.value = btn.dataset.adaptPreset ?? "";
      adaptInput.focus();
    }));

    form.addEventListener("click", async ({ target }) => {
      const adaptAction = target.closest("[data-adapt]")?.dataset.adapt;
      if (adaptAction === "open") { openAdaptOverlay(); return; }
      if (adaptAction === "close") {
        adaptOverlay.hidden = true;
        adaptOverlayToken = syncOverlayToken(adaptOverlayToken, false);
        return;
      }
      if (adaptAction === "ask") {
        const text = adaptInput?.value.trim();
        if (!text) { adaptError.textContent = "请先填写当前状态或时间要求"; adaptError.hidden = false; return; }
        adaptAskBtn.disabled = true;
        adaptApplyBtn.disabled = true;
        adaptAskBtn.textContent = "正在分析…";
        adaptError.hidden = true;
        try {
          const saved = await ensureActiveRecordSaved();
          if (!dialog.open || !form.isConnected) return;
          const proposal = await api("/api/ai/adapt-workout", {
            method: "POST",
            timeout: 125000,
            body: { workoutId: saved.id, text },
          });
          if (!dialog.open || !form.isConnected) return;
          activeAdapt = proposal;
          adaptProposal.hidden = false;
          adaptProposal.innerHTML = `<div class="ai-prose"><p>${esc(proposal.summary)}</p></div>` +
            (proposal.changes.length ? `<div class="ai-adapt-changes">${proposal.changes.map((ch) => {
              const exName = ch.before.snapshot?.name ?? ch.before.exerciseId;
              return `<label class="ai-adapt-item"><input class="switch" type="checkbox" data-adapt-pick value="${esc(ch.exerciseRowId)}" checked>
                <span><strong>${esc(exName)} · ${esc(formatAdaptPatch(ch.before, ch.patch))}</strong><small>${esc(ch.reason)}</small></span></label>`;
            }).join("")}</div>` : '<p class="muted">当前无需修改具体组数，按原计划继续即可。</p>');
          adaptApplyBtn.hidden = proposal.changes.length === 0;
          adaptApplyBtn.disabled = proposal.changes.length === 0;
          adaptAskBtn.className = "secondary-button";
          adaptAskBtn.textContent = "重新获取";
        } catch (err) {
          adaptError.textContent = err.message;
          adaptError.hidden = false;
          adaptAskBtn.textContent = "获取 AI 建议";
        } finally {
          adaptAskBtn.disabled = false;
          adaptApplyBtn.disabled = false;
        }
        return;
      }
      if (adaptAction === "apply" && activeAdapt) {
        const selectedRowIds = $$("[data-adapt-pick]:checked", adaptProposal).map((el) => el.value);
        if (!selectedRowIds.length) { adaptError.textContent = "请至少保留一项需要应用的调整"; adaptError.hidden = false; return; }
        adaptApplyBtn.disabled = true;
        adaptAskBtn.disabled = true;
        adaptError.hidden = true;
        try {
          const { record: updatedRecord } = await api("/api/ai/adapt-workout/apply", {
            method: "POST",
            body: { workoutId: activeAdapt.workoutId, proposal: activeAdapt, selectedRowIds },
          });
          if (!dialog.open || !form.isConnected) return;
          activeRecord = updatedRecord;
          rows.splice(0, rows.length, ...structuredClone(updatedRecord.data.exercises));
          pendingUndo = null;
          renderUndoBanner();
          adaptOverlay.hidden = true;
          renderRows();
          markDirty();
          void loadReferences();
          void loadExerciseDetails();
          notify("已应用 AI 训中调整");
        } catch (err) {
          adaptError.textContent = err.message;
          adaptError.hidden = false;
        } finally {
          adaptApplyBtn.disabled = false;
          adaptAskBtn.disabled = false;
        }
      }
    });
    const picker = $("[data-picker-overlay]", form);
    let results = [];
    let debounce;
    function matchesPickerQuery(item, q) {
      if (!q) return true;
      const needle = q.toLowerCase();
      return [item.name, item.englishName, ...(item.aliases ?? [])].some((t) => String(t ?? "").toLowerCase().includes(needle));
    }
    async function find(value) {
      const seq = ++searching;
      const favIds = getFavoriteIds?.() ?? new Set();
      const customList = getCustomExercises?.() ?? [];
      const customIds = new Set(customList.map((ex) => ex.id));
      const mineSet = pickerEquipment === "__mine__" ? new Set(getUserEquipment?.() ?? []) : null;
      const matchesEquip = (ex) => !pickerEquipment || (mineSet ? mineSet.has(ex.equipment) : ex.equipment === pickerEquipment);
      try {
        let pool = [];
        if (pickerMuscle === "__fav__") {
          const builtinFavIds = [...favIds].filter((id) => !customIds.has(id)).slice(0, 100);
          const customFavs = customList.filter((ex) => favIds.has(ex.id) && matchesEquip(ex) && matchesPickerQuery(ex, value));
          let builtinFavs = [];
          if (builtinFavIds.length) {
            const { items = [] } = await api("/api/catalogue/exercises/details", { method: "POST", body: { ids: builtinFavIds } });
            builtinFavs = items.filter((ex) => matchesEquip(ex) && matchesPickerQuery(ex, value));
          }
          pool = [...customFavs, ...builtinFavs];
        } else {
          const customMatches = customList.filter((ex) => (!pickerMuscle || ex.muscle === pickerMuscle) && matchesEquip(ex) && matchesPickerQuery(ex, value));
          const params = new URLSearchParams({ q: value, limit: pickerEquipment === "__mine__" ? "48" : "18" });
          if (pickerMuscle) params.set("muscle", pickerMuscle);
          if (pickerEquipment && pickerEquipment !== "__mine__") params.set("equipment", pickerEquipment);
          const { items = [] } = await api("/api/catalogue/exercises?" + params);
          pool = [...customMatches, ...items.filter((ex) => !customIds.has(ex.id) && matchesEquip(ex))].slice(0, 24);
          // If no search query and viewing "全部", bubble favorites to top cleanly
          if (!value && !pickerMuscle && favIds.size) {
            const missingFavs = [...favIds].filter((id) => !pool.some((p) => p.id === id) && !customIds.has(id)).slice(0, 6);
            if (missingFavs.length) {
              const { items: favItems = [] } = await api("/api/catalogue/exercises/details", { method: "POST", body: { ids: missingFavs } }).catch(() => ({ items: [] }));
              pool = [...favItems.filter(matchesEquip), ...pool];
            }
          }
        }
        if (seq !== searching || !form.isConnected) return;
        const ranked = prioritizeExact(pool, value);
        results = ranked.sort((a, b) => (value ? 0 : Number(favIds.has(b.id)) - Number(favIds.has(a.id))));
        const swapping = swapTargetRow >= 0 && !!rows[swapTargetRow];
        $("#matches", form).innerHTML = results.map((item, i) =>
          `<button type="button" data-result="${i}"><span class="picker-item-main"><strong>${favIds.has(item.id) ? '<b class="fav-pip" aria-label="已收藏">★</b> ' : ""}${esc(item.name)}${item.custom ? ' <em class="custom-badge">自定义</em>' : ""}</strong><small>${esc(muscles[item.muscle] ?? item.muscle)} · ${esc(equipment[item.equipment] ?? item.equipment)}</small></span><span class="picker-add-chip">${swapping ? "替换" : "+ 添加"}</span></button>`).join("")
          || `<p class="muted">${pickerMuscle === "__fav__" ? "还没有符合筛选条件的收藏动作。" : "没有匹配动作，试试切换肌群/器械或新建自定义动作。"}</p>`;
      } catch (problem) { if (seq === searching && form.isConnected) $("#matches", form).textContent = problem.message; }
    }
    $(".picker-muscles", form)?.addEventListener("click", ({ target }) => {
      const btn = target.closest("[data-picker-muscle]");
      if (!btn) return;
      pickerMuscle = btn.dataset.pickerMuscle;
      $$("[data-picker-muscle]", form).forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.pickerMuscle === pickerMuscle)));
      void find(query.value.trim());
    });
    $(".picker-equipment", form)?.addEventListener("click", ({ target }) => {
      const btn = target.closest("[data-picker-equipment]");
      if (!btn) return;
      pickerEquipment = btn.dataset.pickerEquipment;
      $$("[data-picker-equipment]", form).forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.pickerEquipment === pickerEquipment)));
      void find(query.value.trim());
    });
    if (picker && !picker.hidden) void find("");
    query.addEventListener("input", () => { searching++; clearTimeout(debounce); debounce = setTimeout(() => find(query.value.trim()), 180); });
    query.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) event.preventDefault(); });
    query.addEventListener("focus", () => { if (!results.length) void find(query.value.trim()); });
    $("#matches", form).addEventListener("click", async ({ target }) => {
      const button = target.closest("[data-result]");
      const swapping = swapTargetRow >= 0 && !!rows[swapTargetRow];
      if (!button || (!swapping && rows.length >= 100)) return;
      const match = results[Number(button.dataset.result)];
      button.disabled = true;
      try {
        const exercise = match.custom ? match : (await api("/api/catalogue/exercises/" + encodeURIComponent(match.id))).exercise;
        if (!dialog.open || !form.isConnected) return;
        exerciseDetails.set(exercise.id, exercise);
        const { name, muscle, equipment: equip, mode, volumeMultiplier } = exercise;
        const newSnapshot = { name, muscle, equipment: equip, mode, volumeMultiplier };
        let changed = true;
        if (swapping) {
          changed = applyExerciseSwap(swapTargetRow, exercise.id, newSnapshot);
          clearSwapMode();
          if (changed) notify(`已替换为「${name}」`);
        } else {
          const initialSets = Array.from({ length: 3 }, () => {
            const entry = { ...set(), seconds: mode === "timed" ? 30 : 0, reps: mode === "timed" ? 0 : 8 };
            untouchedWeights.add(entry);
            return entry;
          });
          rows.push({ id: uuid(), exerciseId: exercise.id, supersetGroup: null, restSeconds: settings.restSeconds ?? 90,
            snapshot: newSnapshot,
            sets: initialSets });
          if (guided) focusRow = rows.length - 1;
          notify(`已添加「${name}」`);
        }
        query.value = "";
        results = [];
        closePickerOverlay();
        renderRows();
        audio.tap("check");
        haptic("success");
        if (!changed) return;
        if (guided) {
          jumpTo(focusRow);
          $(`[data-row-index="${focusRow}"] h3`, list)?.focus({ preventScroll: true });
        }
        markDirty();
        void loadReferences();
        void loadExerciseDetails();
      } catch (problem) { notify(problem.message); } finally { button.disabled = false; }
    });
    function submitWorkout(status) {
      const values = new FormData(form);
      const date = values.get("date");
      const nowDate = new Date();
      if (status === "completed" && !canFinish()) return;
      const minutes = values.get("minutes");
      const elapsed = minutes === "" ? null : Math.round(Number(minutes) * 60);
      const sessionStart = startFor(date);
      const endedAt = status === "active" ? null : data.endedAt && date === data.date
        ? data.endedAt : date === today() ? nowDate.toISOString() : new Date(Date.parse(sessionStart) + (elapsed ?? 0) * 1000).toISOString();
      const tracked = pauseAt(timing, nowDate.getTime());
      const recordedTime = elapsed !== null ? { elapsedSeconds: elapsed, runningSince: null }
        : live && (date === today() || (date === initialDate && tracked.elapsedSeconds > 0)) ? tracked : undefined;
      const durationUnknown = recordedTime === undefined && status === "completed";
      const resting = status === "active" && rest?.pausedLeftMs == null && rest?.end > nowDate.getTime() && date === today();
      const updated = { ...data, date, title: String(values.get("title") ?? "").trim(), startedAt: sessionStart, endedAt, status, durationUnknown,
        notes: values.get("notes"), feeling: values.get("feeling") || null, exercises: rows,
        adjustments: activeRecord?.data?.adjustments ?? data.adjustments ?? [],
        timing: recordedTime, restEndsAt: resting ? rest.end : null, restStartedAt: resting ? rest.start : null };
      commit(form, { kind: "workout", id: workoutId, baseVersion: activeRecord?.version ?? 0, data: updated },
        "workout", date, draftKey, live && status === "completed");
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (live && !reviewing) return;
      submitWorkout("completed");
    });
    $("#remove-record", form)?.addEventListener("click", () => { if (activeRecord) deleteRecord(form, activeRecord); });
  }
  return { edit };
}
