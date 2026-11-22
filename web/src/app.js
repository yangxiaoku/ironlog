import { $, $$, copyText, esc, fmt, today, duration, shortDate, icon, field, input, inputGroup, switchField, options, segments, empty, equipment, muscles, meals, feelings, panelNames, workoutSeconds, prioritizeExact, dotMeter, thinMeter, dotPlayIcon, dotCheckIcon, progressionShortLabel, supersetBadges } from "./ui.js";
import { statisticsPanels, loadPanel, applePanel, weightChart, weekStrip, ironDial, miniSparkline, muscleCard, formatAtlasPill, preloadAtlasMasks, hitTestAtlas } from "./charts.js";
import { matrix } from "./display.js";
import { appleDailyDetailsModal, appleLine, appleWorkoutDetails, openDeviceSetupDialog, openHealthDataImport, openHealthDataWebhook, renderAppleDailyStrip } from "./apple-health-ui.js";
import { badgesOverviewStrip, filterVisibleBadges, renderBadgeSections, renderBadgesView, badgeDetailModal } from "./badges-ui.js";
import { onboardingSeenKey, welcomeDismissedKey, renderWelcomeChecklist, openOnboardingGuide } from "./onboarding-ui.js";
import { primeSharedAudio, triggerHaptic } from "./workout-clock.js";

const zhWeekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const formatWeekdayZh = (date) => zhWeekdays[(new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7] ?? "";

let editorPromise, sessionUiMod, aiUiMod, planUiMod, calendarUiMod, calendarUi, analyticsUiMod, analyticsUi, calcUiMod;
const loadSessionUi = () => (sessionUiMod ??= import("./session-ui.js"));
const loadAiUi = () => (aiUiMod ??= import("./ai-ui.js"));
const loadPlanUi = () => (planUiMod ??= import("./plan-ui.js"));
const loadCalcUi = () => (calcUiMod ??= import("./calc-ui.js"));
const loadCalendarUi = () => (calendarUiMod ??= import("./calendar-ui.js").then((m) => (calendarUi = m)));
const loadAnalyticsUi = () => (analyticsUiMod ??= import("./analytics-ui.js").then((m) => (analyticsUi = m)));

const content = $("#content"), dialog = $("#dialog");
const destinations = { overview: "首页", workout: "训练记录", plan: "训练计划", analytics: "数据分析", diet: "饮食记录", weight: "体重记录", calendar: "日历", badges: "成就徽章", exercises: "动作库", settings: "设置" };
const workspaces = {
  overview: { label: "首页", icon: "overview", views: ["overview"] },
  workout: {
    label: "训练", icon: "workout", views: ["workout", "plan", "exercises"],
    tabs: [{ id: "workout", label: "训练记录" }, { id: "plan", label: "训练计划" }, { id: "exercises", label: "动作库" }],
  },
  diet: {
    label: "饮食体重", icon: "diet", views: ["diet", "weight"],
    tabs: [{ id: "diet", label: "饮食记录" }, { id: "weight", label: "体重记录" }],
  },
  calendar: { label: "日历", icon: "calendar", views: ["calendar"] },
  analytics: {
    label: "数据分析", icon: "analytics", views: ["analytics"],
  },
  badges: {
    label: "成就徽章", icon: "badges", views: ["badges"],
  },
  settings: { label: "设置", icon: "settings", views: ["settings"] },
};
const viewWorkspace = Object.fromEntries(
  Object.entries(workspaces).flatMap(([wsId, ws]) => ws.views.map((viewId) => [viewId, wsId])),
);
const mobileTabs = { overview: "首页", workout: "训练", diet: "饮食", calendar: "日历" };
const moreWorkspaces = ["analytics", "badges", "settings"];
function workspaceTabsHtml(view = state.view) {
  if (!state.userId) return "";
  const ws = workspaces[viewWorkspace[view]];
  if (!ws?.tabs) return "";
  return `<nav class="workspace-tabs" aria-label="${esc(ws.label)}子页面">${ws.tabs.map((tab) => {
    const extra = tab.id === "badges" && state.badges
      ? `<span class="workspace-tab-count">${state.badges.earnedCount}/${state.badges.totalCount}</span>` : "";
    return `<a href="#${tab.id}"${tab.id === view ? ' aria-current="page"' : ""}>${esc(tab.label)}${extra}</a>`;
  }).join("")}</nav>`;
}
const recordLabels = { workout: "训练", diet: "饮食", weight: "体重" };
const intervals = { 7: "7 天", 30: "30 天", 90: "90 天", 365: "1 年" };
const settingsSections = { statistics: "统计", profile: "训练与饮食", devices: "Apple 健康", ai: "AI 助手", account: "账号" };
const state = {
  view: "overview", demoToken: "", demo: false, data: null,
  authMode: localStorage.getItem("ironlog-web-account-seen") ? "login" : "register", authName: "", authenticating: false,
  userId: "", username: "", appleHealthConnected: false, isNewUser: false, currentDay: null, dietDone: false, appleEntries: [], appleExpanded: false, moreExpanded: false, trainingSource: "all",
  period: null, through: today(), metric: "volume", strength: "", muscle: "", month: today().slice(0, 7),
  analyticsThrough: today(), analyticsPeriod: 30, analyticsSection: "training", analyticsData: null, appleBodyChart: "weightKg", appleRecoveryChart: "restingHeartRateBpm", appleWorkoutFilter: "all", appleReportWorkoutsExpanded: false, appleReportDailyExpanded: false, appleDailyWeightList: [],
  calendar: "all", date: today(), records: [], query: "", catalogue: [], catalogueTotal: 0, nextCursor: null, preferences: null, plan: null, routines: [], healthType: "",
  dietTarget: null, dietTargets: null, planSection: "current", settingsSection: "statistics",
  weightGoal: null, shownWeights: 12, shownWorkouts: 15, workoutQuery: "", workoutMuscle: "", catalogueMuscle: "", catalogueEquipment: "", catalogueScope: "all", trainedSort: "recent", trainedExercisesCache: null,
  badges: null, badgeCategory: "", badgeStatus: "all", badgeQuery: "", atlasMode: "volume", userEquipment: null, aiStatus: null,
  dietWaterMl: 0, measurements: [], profileHeightCm: null,
  favorites: [], customExercises: [], mealTemplates: [], recentFoods: [], libraryLoaded: false,
  weekDate: "", weekSummary: "", weekDetail: null, schedule: null,
  calendarSchedule: null, calendarDetail: null, calendarWeights: [], calendarNutritionDays: [], calendarDaily: new Map(), calendarGoals: null, calendarCatalogue: new Map(),
  heatmapDate: "", heatmapSummary: "", dayCache: new Map(),
  cacheMeta: {}, planCache: null, recordsCache: {}, calendarCache: null,
};
let requestId = 0, dataEpoch = 0, notices = 0, reportApple = null;
const loadingMarkup = () => `${workspaceTabsHtml()}<div class="skeleton-page" role="status" aria-label="正在加载内容">
  <div class="skeleton-block skeleton-hero"></div>
  <div class="skeleton-kpis"><div class="skeleton-block skeleton-kpi"></div><div class="skeleton-block skeleton-kpi"></div></div>
  <div class="skeleton-list"><div class="skeleton-block skeleton-row"></div><div class="skeleton-block skeleton-row"></div><div class="skeleton-block skeleton-row"></div></div>
</div>`;
const readOnlyPostPaths = new Set([
  "/api/catalogue/exercises/lookup",
  "/api/catalogue/exercises/details",
  "/api/web/exercise-references",
  "/api/web/exercise-prs",
  "/api/web/import-csv/preview",
  "/api/ai/review",
  "/api/ai/parse-diet",
  "/api/ai/parse-workout",
  "/api/ai/adapt-workout",
]);
function notify(message, action = null) {
  const id = ++notices;
  const toast = $("#toast");
  toast.replaceChildren();
  const hasAction = Boolean(action?.label && typeof action?.onClick === "function");
  toast.classList.toggle("has-action", hasAction);
  toast.append(document.createTextNode(String(message ?? "")));
  if (hasAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      if (id !== notices) return;
      toast.classList.remove("shown", "has-action");
      void action.onClick();
    }, { once: true });
    toast.append(btn);
  }
  toast.classList.add("shown");
  setTimeout(() => {
    if (id === notices) toast.classList.remove("shown", "has-action");
  }, hasAction ? 4500 : 1900);
}
async function api(path, { method = "GET", body, token = state.demoToken, timeout = 15000 } = {}) {
  const response = await fetch(path, {
    method, credentials: "same-origin", headers: {
      ...(token && { Authorization: "Bearer " + token }),
      ...(state.userId && { "X-Ironlog-Account": state.userId }),
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    cache: method === "GET" && path.startsWith("/api/catalogue/") ? "default" : "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw Object.assign(new Error(
    (path.startsWith("/auth/web/") ? data?.details?.[0]?.message : null) ?? data?.error ?? "请求失败，请重试",
  ), { status: response.status });
  if (data === undefined) throw new Error("服务器没有返回有效数据");
  if (method !== "GET" && !path.startsWith("/auth/") && !readOnlyPostPaths.has(path.split("?")[0])) {
    dataEpoch++;
    state.dayCache.clear();
    const cleanPath = path.split("?")[0];
    if (["/api/records", "/api/plans/apply", "/api/plans/drafts"].includes(cleanPath)) state.isNewUser = false;
  }
  return data;
}
let modalSeq = 0, modalHistoryDepth = 0, closingFromPopstate = false, suppressNextHistoryBack = false, expectedProgrammaticPops = 0;
const overlayStack = [];

function pushOverlay(onClose) {
  const id = ++modalSeq;
  overlayStack.push({ id, onClose });
  try {
    history.pushState({ ...(history.state ?? {}), ironlogOverlay: id }, "", location.href);
    modalHistoryDepth++;
  } catch {}
  return id;
}

function popOverlay(id) {
  const idx = overlayStack.findIndex((item) => item.id === id);
  if (idx >= 0) overlayStack.splice(idx, 1);
  if (!closingFromPopstate && history.state?.ironlogOverlay === id) {
    modalHistoryDepth = Math.max(0, modalHistoryDepth - 1);
    expectedProgrammaticPops++;
    try { history.back(); } catch { expectedProgrammaticPops = Math.max(0, expectedProgrammaticPops - 1); }
  }
}

window.addEventListener("popstate", () => {
  if (expectedProgrammaticPops > 0) {
    expectedProgrammaticPops--;
    return;
  }
  if (overlayStack.length > 0) {
    const top = overlayStack.pop();
    modalHistoryDepth = Math.max(0, modalHistoryDepth - 1);
    closingFromPopstate = true;
    try { top?.onClose?.(); } finally { closingFromPopstate = false; }
    return;
  }
  if (dialog.open && modalHistoryDepth > 0) {
    modalHistoryDepth = 0;
    closingFromPopstate = true;
    try { dialog.close(); } finally { closingFromPopstate = false; }
  }
});

function open(title, body, wide = false, layout = "") {
  const wasOpen = dialog.open;
  dialog.classList.toggle("wide-dialog", wide);
  dialog.classList.toggle("mobile-sheet", layout === "menu");
  dialog.classList.toggle("workout-dialog", layout === "workout");
  dialog.classList.toggle("report-dialog", layout === "report");
  dialog.classList.toggle("badge-dialog", layout === "badge");
  dialog.classList.toggle("exercise-dialog", layout === "exercise");
  dialog.classList.toggle("onboarding-dialog", layout === "onboarding");
  dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>
    ${layout === "exercise" ? `<button class="quiet copy-exercise" type="button" data-action="copy-exercise" data-value="${esc(title)}">复制动作名</button>` : ""}
    <button type="button" class="icon-button" data-action="close" aria-label="关闭"${layout === "workout" ? " autofocus" : ""}>${icon("close")}</button></header>${body}`;
  if (!dialog.open) dialog.showModal();
  if (!wasOpen) {
    try {
      history.pushState({ ...(history.state ?? {}), ironlogModal: ++modalSeq }, "", location.href);
      modalHistoryDepth = 1;
    } catch {}
  } else {
    overlayStack.length = 0;
  }
  dialog.scrollTop = 0;
}

function openConfirmDialog({ title, message, confirmLabel = "确认删除", onConfirm }) {
  open(title, `<div class="confirm-dialog-body">
    <p class="confirm-dialog-message">${esc(message)}</p>
    <p class="form-error" data-confirm-error role="alert" hidden></p>
    <footer class="confirm-dialog-foot">
      <button type="button" class="quiet" data-confirm-cancel>取消</button>
      <button type="button" class="danger" data-confirm-ok>${esc(confirmLabel)}</button>
    </footer>
  </div>`);
  const cancelBtn = $("[data-confirm-cancel]", dialog);
  const okBtn = $("[data-confirm-ok]", dialog);
  const errEl = $("[data-confirm-error]", dialog);
  cancelBtn?.addEventListener("click", () => dialog.close());
  okBtn?.addEventListener("click", async () => {
    if (!okBtn || okBtn.disabled) return;
    okBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (errEl) errEl.hidden = true;
    try {
      await onConfirm();
      if (dialog.open) dialog.close();
    } catch (error) {
      if (errEl) {
        errEl.textContent = error?.message || "操作失败，请重试";
        errEl.hidden = false;
      }
      okBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  });
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').content = theme === "light" ? "#f4f4f1" : "#000000";
  localStorage.setItem("ironlog-web-theme", theme);
}
setTheme(localStorage.getItem("ironlog-web-theme") === "light" ? "light" : "dark");
sessionStorage.removeItem("ironlog-web-token");
function clearUser() {
  if (dialog.open) { suppressNextHistoryBack = true; dialog.close(); }
  requestId++;
  reportApple = null;
  dataEpoch = 0;
  const prefix = "ironlog-web-draft:" + state.userId + ":";
  if (state.userId) for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) if (key.startsWith(prefix)) storage.removeItem(key);
  }
  Object.assign(state, { demo: false, demoToken: "", authMode: "login", authName: "", data: null, records: [], preferences: null, period: null,
    through: today(), metric: "volume", strength: "", date: today(), month: today().slice(0, 7), query: "", catalogue: [], catalogueTotal: 0, nextCursor: null, calendar: "all", muscle: "",
    analyticsThrough: today(), analyticsPeriod: 30, analyticsSection: "training", analyticsData: null, appleBodyChart: "weightKg", appleRecoveryChart: "restingHeartRateBpm",
    appleWorkoutFilter: "all", appleReportWorkoutsExpanded: false, appleReportDailyExpanded: false, appleDailyWeightList: [],
    plan: null, routines: [], healthType: "", userId: "", username: "", appleHealthConnected: false, isNewUser: false, currentDay: null, dietDone: false, appleEntries: [], appleExpanded: false, moreExpanded: false, trainingSource: "all",
    dietTarget: null, dietTargets: null, planSection: "current", settingsSection: "statistics", weightGoal: null, shownWeights: 12, shownWorkouts: 15,
    catalogueMuscle: "", catalogueEquipment: "", catalogueScope: "all", trainedSort: "recent", trainedExercisesCache: null, workoutQuery: "", workoutMuscle: "", badges: null, badgeCategory: "", badgeStatus: "all", badgeQuery: "", atlasMode: "volume", userEquipment: null, aiStatus: null,
    dietWaterMl: 0, measurements: [], profileHeightCm: null,
    favorites: [], customExercises: [], mealTemplates: [], recentFoods: [], libraryLoaded: false,
    weekDate: "", weekSummary: "", weekDetail: null, schedule: null, calendarSchedule: null, calendarDetail: null, calendarDaily: new Map(),
    calendarWeights: [], calendarNutritionDays: [], calendarGoals: null, calendarCatalogue: new Map(),
    heatmapDate: "", heatmapSummary: "", dayCache: new Map(),
    cacheMeta: {}, planCache: null, recordsCache: {}, calendarCache: null });
}
function pinnedBadgesKey() {
  return state.userId ? "ironlog-pinned-badges:" + state.userId : "";
}
function getPinnedBadges() {
  const key = pinnedBadgesKey();
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, 3) : [];
  } catch { return []; }
}
function togglePinBadge(id) {
  const key = pinnedBadgesKey();
  if (!key) return { list: [], pinned: false, replaced: false };
  const cur = getPinnedBadges();
  const idx = cur.indexOf(id);
  let next;
  let pinned;
  let replaced = false;
  if (idx >= 0) {
    next = cur.filter((x) => x !== id);
    pinned = false;
  } else {
    replaced = cur.length >= 3;
    next = [...cur.slice(-2), id];
    pinned = true;
  }
  try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
  return { list: next, pinned, replaced };
}
async function ensureTodayMeta() {
  const ownerId = state.userId;
  if (!ownerId) return null;
  if (state.currentDay?.date === today()) return state.currentDay;
  const res = await api("/api/web/today").catch(() => null);
  if (state.userId !== ownerId) return null;
  if (res) state.currentDay = res;
  return state.currentDay;
}
function syncAccountMeta(account) {
  if (!account) return;
  state.userId = account.userId ?? "";
  state.username = account.username ?? "";
  state.appleHealthConnected = Boolean(account.appleHealthConnected);
  state.isNewUser = Boolean(account.isNewUser);
}
async function refreshAccountMeta() {
  if (!state.userId) return;
  try { syncAccountMeta(await api("/api/me")); } catch {}
}
function triggerOpenOnboarding(initialStep = 1) {
  if (!state.userId) return;
  openOnboardingGuide({
    api, open, dialog, notify,
    userId: state.userId,
    username: state.username,
    demo: state.demo,
    appleHealthConnected: state.appleHealthConnected,
    currentProfile: state.data?.goals ?? null,
    initialStep,
    onProfileSaved: (profile) => {
      if (profile) {
        state.userEquipment = profile.equipment ?? state.userEquipment;
        if (state.data) state.data.goals = profile;
      }
      dataEpoch++;
      if (state.view === "overview" && state.data) overview(state.data);
    },
    onLaunchAction: async (kind) => {
      if (kind === "browse-plans") {
        state.planSection = "starters";
        await route("plan");
      } else if (kind === "start-workout") {
        await openQuickRecord("workout");
      } else if (kind === "log-diet") {
        await openQuickRecord("diet");
      } else if (kind === "log-weight") {
        await openQuickRecord("weight");
      }
    },
    onComplete: () => {
      if (state.view === "overview" && state.data) overview(state.data);
    },
  });
}
async function checkBadgeUnlocks(prevSummary) {
  const ownerId = state.userId;
  if (!ownerId) return;
  const beforeUnlocked = prevSummary?.badges
    ? new Set(prevSummary.badges.filter((b) => b.unlocked).map((b) => b.id))
    : null;
  try {
    const alreadyFresh = Boolean(state.badges && state.cacheMeta.badgesEpoch === dataEpoch);
    const fresh = alreadyFresh ? state.badges : await api("/api/web/badges");
    if (state.userId !== ownerId) return;
    state.badges = fresh;
    state.cacheMeta.badgesEpoch = dataEpoch;
    if (beforeUnlocked) {
      const gained = (fresh.badges ?? []).filter((b) => b.unlocked && !beforeUnlocked.has(b.id));
      if (gained.length) {
        const names = gained.slice(0, 2).map((b) => b.title).join("、");
        notify(`解锁新徽章：${names}${gained.length > 2 ? ` 等 ${gained.length} 枚` : ""}`);
      }
    }
    if (!alreadyFresh) {
      if (state.view === "overview" && state.data) {
        const strip = $(".badges-strip", content);
        if (strip) strip.outerHTML = badgesOverviewStrip(fresh, getPinnedBadges(), { appleHealthConnected: state.appleHealthConnected });
      } else if (state.view === "badges") {
        renderBadges();
      }
    }
  } catch {}
}

function extractRecentFoods(dietRecords) {
  const counts = new Map();
  for (const row of dietRecords) {
    const d = row.data;
    if (!d?.name) continue;
    const prev = counts.get(d.name);
    if (!prev || row.updatedAt > prev.updatedAt) {
      counts.set(d.name, { name: d.name, protein: d.protein, carbs: d.carbs, fat: d.fat, calories: d.calories, count: (prev?.count ?? 0) + 1, updatedAt: row.updatedAt });
    } else {
      prev.count++;
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
}
async function ensureLibraryCaches(force = false) {
  const ownerId = state.userId;
  if (!ownerId) return;
  if (state.libraryLoaded && !force) return;
  try {
    const [favorites, customExercises] = await Promise.all([
      api("/api/records/favorite"),
      api("/api/records/exercise"),
    ]);
    if (state.userId !== ownerId) return;
    state.favorites = favorites;
    state.customExercises = customExercises;
    state.libraryLoaded = true;
  } catch {}
}
async function ensureRecentFoodsCache() {
  const ownerId = state.userId;
  if (!ownerId || state.recentFoods.length) return;
  try {
    const dietRows = await api("/api/records/diet");
    if (state.userId !== ownerId) return;
    state.recentFoods = extractRecentFoods(dietRows);
  } catch {}
}
async function toggleFavorite(exerciseId) {
  if (!state.userId) { notify("请先登录后收藏动作"); return false; }
  await ensureLibraryCaches();
  const existing = state.favorites.find((r) => !r.deleted && r.data?.exerciseId === exerciseId);
  if (existing) {
    await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id: existing.id, kind: "favorite", baseVersion: existing.version, deleted: true, data: existing.data } });
    state.favorites = state.favorites.filter((r) => r.id !== existing.id);
    notify("已取消收藏");
    return false;
  }
  const res = await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id: "fav_" + crypto.randomUUID().slice(0, 12), kind: "favorite", baseVersion: 0, deleted: false, data: { exerciseId } } });
  if (res.record) state.favorites.push(res.record);
  notify("已收藏动作 · 训练选动作时优先置顶");
  return true;
}
function openCreateExerciseModal({ existing = null, onDone } = {}) {
  const cur = existing?.data ?? {};
  const modeLabels = { reps: "负重 / 计次", timed: "静态计时", assisted: "机械辅助（减重）" };
  open(existing ? "编辑自定义动作" : "新建自定义动作", `<form id="custom-exercise-form" class="dialog-form">
    ${field("动作名称", input("name", cur.name ?? "", 'maxlength="120" required autofocus placeholder="例如：悍马机斜上推胸"'))}
    ${field("英文名或别名（可选）", input("englishName", cur.englishName ?? "", 'maxlength="120" placeholder="例如：Hammer Incline Press"'))}
    <div class="fields">
      ${field("主要肌群", `<select name="muscle">${options(muscles, cur.muscle ?? "chest")}</select>`)}
      ${field("主要器械", `<select name="equipment">${options(equipment, cur.equipment ?? "machine")}</select>`)}
      ${field("计量方式", `<select name="mode">${options(modeLabels, cur.mode ?? "reps")}</select>`)}
    </div>
    ${field("动作要领（可选，每行一步）", `<textarea name="instructions" rows="3" maxlength="2000" placeholder="收紧肩胛下沉，控制离心 2 秒…">${esc((cur.instructions ?? []).join("\n"))}</textarea>`)}
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot${existing ? " has-remove" : ""}">
      ${existing ? '<button type="button" class="danger" id="delete-custom-exercise">删除动作</button>' : `<button type="button" class="quiet" id="cancel-custom-exercise">取消</button>`}
      <button type="submit" class="primary-button">${existing ? "保存修改" : "保存并创建"}</button>
    </footer>
  </form>`);
  const form = $("#custom-exercise-form", dialog);
  $("#cancel-custom-exercise", form)?.addEventListener("click", () => {
    if (onDone) onDone(null);
    else dialog.close();
  });
  $("#delete-custom-exercise", form)?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    if (!btn.dataset.confirm) { btn.dataset.confirm = "true"; btn.textContent = "确认删除"; return; }
    btn.disabled = true;
    try {
      await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id: existing.id, kind: "exercise", baseVersion: existing.version, deleted: true, data: existing.data } });
      state.customExercises = state.customExercises.filter((r) => r.id !== existing.id);
      notify("已删除自定义动作");
      if (onDone) onDone(null);
      else { dialog.close(); if (state.view === "exercises") void catalogueSearch(); }
    } catch (err) {
      const errEl = $(".form-error", form);
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const vals = new FormData(form);
    const name = String(vals.get("name") ?? "").trim();
    if (!name) return;
    const rawSteps = String(vals.get("instructions") ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const id = existing?.id ?? ("custom_" + crypto.randomUUID().slice(0, 12));
    const payload = {
      id,
      name,
      englishName: String(vals.get("englishName") ?? "").trim(),
      aliases: existing?.data?.aliases ?? [],
      muscle: String(vals.get("muscle")),
      secondaryMuscles: existing?.data?.secondaryMuscles ?? [],
      equipment: String(vals.get("equipment")),
      mode: String(vals.get("mode")),
      volumeMultiplier: existing?.data?.volumeMultiplier ?? 1,
      instructions: rawSteps.length ? rawSteps.slice(0, 16) : [`标准执行「${name}」，控制离心下放与发力节奏。`],
      mistakes: existing?.data?.mistakes ?? [],
      custom: true,
    };
    const submitBtn = $('button[type="submit"]', form);
    const errEl = $(".form-error", form);
    submitBtn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id, kind: "exercise", baseVersion: existing?.version ?? 0, deleted: false, data: payload } });
      if (res.record) {
        const idx = state.customExercises.findIndex((r) => r.id === res.record.id);
        if (idx >= 0) state.customExercises[idx] = res.record;
        else state.customExercises.push(res.record);
      }
      notify(existing ? "自定义动作已更新" : `已创建「${name}」`);
      if (onDone) onDone(res.record?.data ?? payload);
      else {
        dialog.close();
        if (state.view === "exercises") void catalogueSearch();
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally { submitBtn.disabled = false; }
  });
}
async function getAiStatus(force = false) {
  if (!force && state.aiStatus) return state.aiStatus;
  try {
    state.aiStatus = await api("/api/ai/status");
  } catch {
    state.aiStatus = { ready: false, mode: "unconfigured", model: null };
  }
  return state.aiStatus;
}
async function logout() {
  if (!state.demo) await api("/auth/web/logout", { method: "POST" });
  clearUser();
  route("overview");
}
function findLocalWorkoutDraft() {
  if (!state.userId) return null;
  const prefix = "ironlog-web-draft:" + state.userId + ":";
  for (const storage of [localStorage, sessionStorage]) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(prefix)) return { key, suffix: key.slice(prefix.length) };
    }
  }
  return null;
}
function centerActivePills(root = content, smooth = false) {
  if (!root) return;
  $$(".plan-sections .segments, .settings-sections .segments, .workspace-tabs, .muscle-pills, .badge-filters", root).forEach((el) => {
    if (el.scrollWidth <= el.clientWidth + 2) return;
    const active = $('[aria-pressed="true"], [aria-current="page"]', el);
    if (!active) return;
    el.scrollTo({
      left: Math.max(0, active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2),
      behavior: smooth ? "smooth" : "instant",
    });
  });
}
function nav() {
  const activeWs = viewWorkspace[state.view] ?? "overview";
  const activeGroup = workspaces[activeWs];
  const themeIcon = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon", 19);
  const liveActive = state.userId ? state.currentDay?.active : null;
  const localDraft = state.userId && !liveActive ? findLocalWorkoutDraft() : null;
  const resumePillHtml = liveActive || localDraft
    ? `<button type="button" class="live-resume-pill" data-action="resume-live-workout" aria-label="${liveActive ? "继续进行中的训练" : "恢复未保存的训练草稿"}"><i class="training-led" aria-hidden="true"></i><span>${liveActive ? "训练中" : "草稿"}</span></button>`
    : "";
  const navLink = (id) => `<a href="#${id}" aria-label="${workspaces[id].label}"${id === activeWs ? ' aria-current="page"' : ""}>
      ${icon(workspaces[id].icon)}<span>${workspaces[id].label}</span>${id === activeWs ? '<i class="nav-dot"></i>' : ""}</a>`;
  const primaryNav = ["overview", "workout", "diet", "calendar", "analytics", "badges"];
  const secondaryNav = ["settings"];
  $("#sidebar").innerHTML = `<a href="#overview" class="brand" aria-label="铁记首页">
    <span class="brand-type">${matrix("IRONLOG")}<strong>铁记</strong></span><img width="43" height="43" src="./icon-192.png" alt=""></a>
    <nav class="desktop-nav">${primaryNav.map(navLink).join("")}<span class="nav-divider" aria-hidden="true"></span>${secondaryNav.map(navLink).join("")}</nav>
    <nav class="mobile-nav" aria-label="手机导航">${Object.entries(mobileTabs).map(([id, title]) => `<a href="#${id}"${id === activeWs ? ' aria-current="page"' : ""}>
      ${icon(id)}<span>${title}</span></a>`).join("")}
      <button class="mobile-more" type="button" data-action="more-menu" aria-haspopup="dialog" aria-controls="dialog" aria-expanded="false"${moreWorkspaces.includes(activeWs) ? ' aria-current="true"' : ""}>
        ${icon("more")}<span>更多</span>
      </button>
    </nav>
    <footer><span class="connection"><i class="${state.userId ? "online" : ""}"></i>${state.demo ? "演示模式" : state.userId ? "已登录" : "未登录"}</span>
      <div class="sidebar-foot-actions">${state.userId ? `<button type="button" class="quiet sidebar-guide-btn" data-action="open-onboarding" aria-label="打开使用指南">${icon("book", 15)}<span>指南</span></button>` : ""}<button type="button" class="icon-button" data-action="theme" aria-label="切换浅色与深色">${themeIcon}</button></div></footer>`;
  const activeTabLabel = activeGroup?.tabs?.find((tab) => tab.id === state.view)?.label ?? destinations[state.view];
  const breadcrumbTrail = activeGroup?.tabs && state.userId
    ? `<a class="breadcrumb-group" href="#${activeWs}">${activeGroup.label}</a>${icon("chevron", 14)}<strong>${activeTabLabel}</strong>`
    : `<strong>${destinations[state.view]}</strong>`;
  $("#top").innerHTML = `<div class="breadcrumb"><span>铁记</span>${icon("chevron", 14)}${breadcrumbTrail}</div>
    <a href="#overview" class="phone-brand" aria-label="铁记首页">${matrix("IRONLOG")}<strong>铁记</strong></a>
    <div class="top-actions"><span class="local-date">${icon("calendar", 16)} <time datetime="${today()}">${today().slice(0, 4)} / ${today().slice(5).replace("-", ".")}</time></span>${state.userId ?
      `${resumePillHtml}<button type="button" class="quick-record-pill" data-action="quick-record-sheet" aria-label="快捷速记">${icon("plus", 14)}<span>速记</span></button>
       <button type="button" class="icon-button top-theme" data-action="theme" aria-label="切换浅色与深色">${themeIcon}</button>` :
      `<button type="button" class="icon-button" data-action="theme" aria-label="切换浅色与深色">${themeIcon}</button>`}</div>`;
}
async function openQuickRecord(kind) {
  try {
    if (kind === "workout") {
      const [ed] = await Promise.all([getEditor(), ensureLibraryCaches(), ensureTodayMeta()]);
      ed.edit("workout", undefined, state.data?.goals ?? (await api("/api/web/profile")).profile);
    } else if (kind === "diet") {
      const [ed] = await Promise.all([getEditor(), ensureRecentFoodsCache()]);
      ed.edit("diet", undefined, {}, { date: today(), meal: guessMeal() });
    } else if (kind === "weight") {
      const id = "weight_" + today();
      const [ed, fetched] = await Promise.all([
        getEditor(),
        (state.view === "weight" ? state.records.find((row) => row.id === id) : null)
          ?? api("/api/web/records/weight/" + id + "?includeDeleted=1").catch(() => undefined),
      ]);
      const record = fetched && !fetched.deleted ? fetched : undefined;
      const ad = state.currentDay?.date === today() ? state.currentDay?.appleDaily : null;
      const seed = !record && ad?.weightKg != null
        ? { date: today(), weight: ad.weightKg, ...(ad.bodyFatPct != null ? { bodyFat: ad.bodyFatPct } : {}) }
        : undefined;
      ed.edit("weight", record, {}, seed);
    } else if (kind === "calc") {
      (await loadCalcUi()).openStrengthCalculator({ open, dialog });
    }
  } catch (error) {
    if (dialog.open) dialog.close();
    if (error.status === 401) showError(error);
    else notify(error.message);
  }
}
function openQuickRecordSheet() {
  open("快捷速记", `<div class="quick-record-sheet-body">
    <div class="quick-sheet-list">
      <button type="button" class="quick-sheet-card" data-quick-open="workout">
        <div class="quick-sheet-icon workout-accent">${icon("workout", 22)}</div>
        <div class="quick-sheet-info">
          <strong>记录训练</strong>
          <small>自选动作，或开始今天的计划</small>
        </div>
        ${icon("chevron", 16)}
      </button>
      <button type="button" class="quick-sheet-card" data-quick-open="diet">
        <div class="quick-sheet-icon diet-accent">${icon("diet", 22)}</div>
        <div class="quick-sheet-info">
          <strong>记录饮食</strong>
          <small>按餐次记录食物</small>
        </div>
        ${icon("chevron", 16)}
      </button>
      <button type="button" class="quick-sheet-card" data-quick-open="weight">
        <div class="quick-sheet-icon weight-accent">${icon("weight", 22)}</div>
        <div class="quick-sheet-info">
          <strong>记录体重</strong>
          <small>默认带入上次体重</small>
        </div>
        ${icon("chevron", 16)}
      </button>
      <button type="button" class="quick-sheet-card" data-quick-open="calc">
        <div class="quick-sheet-icon calc-accent">${icon("bolt", 22)}</div>
        <div class="quick-sheet-info">
          <strong>1RM 与配片计算器</strong>
          <small>估算 1RM、百分比负荷与杠铃配片图</small>
        </div>
        ${icon("chevron", 16)}
      </button>
    </div>
  </div>`, false, "menu");
}
function openMore() {
  const activeWs = viewWorkspace[state.view] ?? "overview";
  const visibleBadges = filterVisibleBadges(state.badges, state.appleHealthConnected);
  const moreMeta = {
    analytics: state.appleHealthConnected ? "负荷、恢复、体征与周期报表" : "负荷比、肌群剂量、1RM 与周报",
    badges: visibleBadges ? `已点亮 ${visibleBadges.earnedCount} / ${visibleBadges.totalCount} 枚徽章` : "力量、连击、容量与坚持徽章",
    settings: state.appleHealthConnected ? "目标、Apple 健康、AI、账号" : "目标、AI 助手、导出与账号",
  };
  const shortcutPages = [
    { id: "plan", label: "训练计划" },
    { id: "weight", label: "体重记录" },
    { id: "exercises", label: "动作库" },
  ];
  const isDark = document.documentElement.dataset.theme === "dark";
  open("更多", `<div class="more-sheet-body">
    ${state.userId ? `<div class="more-quick" role="group" aria-label="快速记录">
      <button type="button" class="more-quick-btn" data-more-action="edit" data-value="workout">${icon("workout", 18)}<span>记训练</span></button>
      <button type="button" class="more-quick-btn" data-more-action="today-diet">${icon("diet", 18)}<span>记饮食</span></button>
      <button type="button" class="more-quick-btn" data-more-action="today-weight">${icon("weight", 18)}<span>记体重</span></button>
    </div>` : ""}
    <nav class="more-links" aria-label="更多工作区">${moreWorkspaces.map((id) =>
      `<a href="#${id}"${id === activeWs ? ' aria-current="page"' : ""}>
         ${icon(workspaces[id].icon)}<span class="more-link-copy"><b>${workspaces[id].label}</b><small>${esc(moreMeta[id] ?? "")}</small></span>${icon(id === activeWs ? "check" : "chevron", 17)}
       </a>`).join("")}</nav>
    <p class="more-shortcuts-head">子页面直达</p>
    <nav class="more-shortcuts" aria-label="子页面直达">${shortcutPages.map(({ id, label }) =>
      `<a href="#${id}"${id === state.view ? ' aria-current="page"' : ""}>${icon(id, 16)}<span>${label}</span></a>`).join("")}</nav>
    <footer class="more-foot">${state.userId ? `<button type="button" class="quiet" data-action="open-onboarding">${icon("book", 16)} 使用指南</button>` : ""}<button type="button" class="quiet" data-more-theme>${icon(isDark ? "sun" : "moon", 16)} 切换${isDark ? "浅色" : "深色"}外观</button></footer>
  </div>`, false, "menu");
  $('[data-action="more-menu"]')?.setAttribute("aria-expanded", "true");
  $(".more-sheet-body", dialog)?.addEventListener("click", ({ target }) => {
    if (target.closest("a")) { suppressNextHistoryBack = true; dialog.close(); }
  });
  $$("[data-more-action]", dialog).forEach((btn) => btn.addEventListener("click", async () => {
    const { moreAction, value } = btn.dataset;
    if (moreAction === "edit") await openQuickRecord(value);
    if (moreAction === "today-diet") await openQuickRecord("diet");
    if (moreAction === "today-weight") await openQuickRecord("weight");
  }));
  $("[data-more-theme]", dialog)?.addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    nav();
    openMore();
  });
}
dialog.addEventListener("close", () => {
  $('[data-action="more-menu"]')?.setAttribute("aria-expanded", "false");
  dialog.style.transform = "";
  dialog.style.transition = "";
  overlayStack.length = 0;
  const depth = modalHistoryDepth;
  modalHistoryDepth = 0;
  const suppress = suppressNextHistoryBack;
  suppressNextHistoryBack = false;
  if (depth > 0 && !closingFromPopstate && !suppress && (history.state?.ironlogModal || history.state?.ironlogOverlay)) {
    expectedProgrammaticPops++;
    try { history.go(-depth); } catch { expectedProgrammaticPops = Math.max(0, expectedProgrammaticPops - 1); }
  }
  nav();
});
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog || dialog.classList.contains("workout-dialog") || dialog.classList.contains("onboarding-dialog")) return;
  const isSheet = dialog.classList.contains("mobile-sheet");
  const isFormDialog = Boolean(dialog.querySelector("form"));
  if (!isSheet && isFormDialog) return;
  const rect = dialog.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (outside) dialog.close();
});

// Mobile bottom-sheet pull-down-to-dismiss gesture on dialog header or non-form sheets at scrollTop
let sheetTouchY = 0, sheetTouchX = 0, sheetDragging = false;
dialog.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1 || dialog.classList.contains("workout-dialog")) return;
  if (!matchMedia("(max-width: 630px)").matches) return;
  const inHead = Boolean(e.target.closest?.(".dialog-head"));
  const hasForm = Boolean(dialog.querySelector("form"));
  const atTopScroll = dialog.scrollTop <= 2 && !e.target.closest?.("input, textarea, select");
  if (!inHead && (hasForm || !atTopScroll)) return;
  sheetTouchY = e.touches[0].clientY;
  sheetTouchX = e.touches[0].clientX;
  sheetDragging = true;
  dialog.style.transition = "none";
}, { passive: true });

dialog.addEventListener("touchmove", (e) => {
  if (!sheetDragging || e.touches.length !== 1) return;
  const dy = e.touches[0].clientY - sheetTouchY;
  const dx = e.touches[0].clientX - sheetTouchX;
  if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) {
    sheetDragging = false;
    dialog.style.transform = "";
    return;
  }
  if (dy > 8 && dy > Math.abs(dx) * 1.3) {
    dialog.style.transform = `translateY(${Math.min(220, dy * 0.72).toFixed(1)}px)`;
  }
}, { passive: true });

const endSheetDrag = (e) => {
  if (!sheetDragging) return;
  sheetDragging = false;
  const dy = e.changedTouches?.[0] ? e.changedTouches[0].clientY - sheetTouchY : 0;
  dialog.style.transition = "transform .18s ease";
  dialog.style.transform = "";
  if (dy >= 78) dialog.close();
};
dialog.addEventListener("touchend", endSheetDrag, { passive: true });
dialog.addEventListener("touchcancel", endSheetDrag, { passive: true });
const halftoneViews = new Set(["workout", "plan", "diet", "exercises", "badges", "calendar"]);
function heading(title, sub = "", controls = "") {
  const brackets = halftoneViews.has(state.view)
    ? '<span class="vf-c tl" aria-hidden="true"></span><span class="vf-c tr" aria-hidden="true"></span><span class="vf-c bl" aria-hidden="true"></span><span class="vf-c br" aria-hidden="true"></span>'
    : "";
  return `${workspaceTabsHtml()}<div class="page-heading masthead-${state.view}">${brackets}<div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${controls}</div>`;
}
function route(view) {
  if (location.hash.slice(1) !== view) location.hash = view;
  else void renderRoute();
}
window.addEventListener("hashchange", () => { if (location.hash !== "#content") void renderRoute(); });
function loginPanel() {
  const mode = state.authMode;
  const registering = mode === "register";
  const label = registering ? "注册账号" : "登录";
  const newPasswordRules = 'minlength="10" pattern="[A-Za-z0-9]{10,128}" title="请输入至少 10 个英文字母或数字"';
  content.innerHTML = `<section class="login-layout"><div class="login-hero"><div><img src="./icon-192.png" width="62" height="62" alt="">
    <h1>铁记</h1><p>记训练，记饮食，记体重。</p>
    <ul class="login-hero-list"><li>训练计划 · 实时计时与杠铃配片</li><li>饮食热量 · 体重均线与负荷科学</li><li>5,650+ 动作库 · 无需手环即开即用</li></ul></div></div>
    <form id="login-form" class="panel login-form">
      <div class="auth-mode" role="group" aria-label="账号入口">${segments({ register: "注册", login: "登录" }, mode, "auth-mode")}</div>
      <h2>${registering ? "创建铁记账号" : "登录铁记"}</h2>
      ${field("用户名", input("username", state.authName, 'maxlength="100" required autocomplete="username" autocapitalize="none" spellcheck="false"')
        + (registering ? '<small>3–32 位中文、字母、数字、下划线或短横线</small>' : ""))}
      ${field("密码", input("password", "", `type="password" required maxlength="128" ${registering ? newPasswordRules + ' placeholder="至少 10 个字母或数字"' : ""} autocomplete="${registering ? "new-password" : "current-password"}"`))}
      ${registering ? field("确认密码", input("confirm", "", `type="password" required maxlength="128" ${newPasswordRules} autocomplete="new-password"`)) : ""}
      <p class="form-error" role="alert" hidden></p>
      <button class="primary-button" type="submit"${state.authenticating ? " disabled" : ""}>${label}</button></form></section>`;
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.authenticating) return;
    const form = event.currentTarget, button = $('button[type="submit"]', form), error = $(".form-error", form);
    const values = new FormData(form);
    const username = values.get("username").trim(), password = values.get("password");
    state.authName = username;
    if (registering && password !== values.get("confirm")) {
      error.textContent = "两次输入的密码不一致";
      error.hidden = false;
      form.elements.confirm.focus();
      return;
    }
    state.authenticating = true;
    button.disabled = true; error.hidden = true; button.textContent = registering ? "正在注册…" : "正在登录…";
    try {
      await api("/auth/web/" + mode, { method: "POST", body: { username, password } });
      const account = await api("/api/me").catch((problem) => {
        if (problem.status === 401) throw new Error("浏览器未保存登录状态，请允许本站使用 Cookie 后重新登录");
        throw problem;
      });
      syncAccountMeta(account);
      state.authMode = "login";
      localStorage.setItem("ironlog-web-account-seen", "1");
      await renderRoute();
      if ((registering || account.isNewUser) && account.userId && !localStorage.getItem(onboardingSeenKey(account.userId))) {
        triggerOpenOnboarding(1);
      }
    } catch (problem) {
      const currentForm = $("#login-form");
      const currentError = currentForm ? $(".form-error", currentForm) : error;
      currentError.textContent = problem.message;
      currentError.hidden = false;
    } finally {
      state.authenticating = false;
      button.textContent = label;
      const current = $('#login-form button[type="submit"]');
      if (current) current.disabled = false;
    }
  });
}
function guessMeal() {
  const hour = new Date(Date.now() + 8 * 3600000).getUTCHours();
  return hour < 10 ? "breakfast" : hour < 14 ? "lunch" : hour < 17 ? "snack" : "dinner";
}
function delta(value, previous, suffix) {
  if (!previous && !value) return '<span class="comparison">暂无对比</span>';
  const difference = value - previous;
  if (difference === 0) return '<span class="comparison">与上期持平</span>';
  const arrow = difference > 0 ? "↑ +" : "↓ ";
  return `<span class="comparison${difference > 0 ? " gain" : ""}">${arrow}${fmt(difference)}${suffix}</span>`;
}
function kpi(name, value, unit, message, symbol) {
  return `<article class="kpi"><div><span>${name}</span></div>
    <strong><span class="kpi-num">${matrix(value)}</span><small>${unit}</small></strong>${message}</article>`;
}
function todayTrainingMeta(data, statsData) {
  if (!data) return null;
  const { active, planned, completed, applePlan } = data;
  const hasLocal = !!state.userId && [localStorage, sessionStorage].some((storage) =>
    storage.getItem("ironlog-web-draft:" + state.userId + ":new"));
  const matchedApple = applePlan ? ((data.apple ?? []).find((item) => item.plan?.routineId === applePlan.routineId) ?? data.apple?.[0]) : null;
  const todayRecent = statsData?.recent?.find((item) => item.date === data.date);
  const todayAppleFirst = data.apple?.[0];
  if (active) {
    return { main: active.title, note: `${active.from ? shortDate(active.from) + " · " : ""}${active.done}/${active.total} 组`, action: "workout-detail", value: active.id, label: "继续训练", active: true, completed: false };
  }
  if (hasLocal) return { main: "本机训练草稿", note: "有未提交组数", action: "edit", value: "workout", label: "恢复草稿", active: false, completed: false };
  if (applePlan) {
    return {
      main: applePlan.name, note: "Apple 健康已打卡",
      action: matchedApple?.manualWorkoutId ? "workout-detail" : matchedApple ? "apple-activity" : "today-routine",
      value: matchedApple?.manualWorkoutId ?? matchedApple?.id ?? applePlan.routineId, label: "查看详情", active: false, completed: true,
    };
  }
  if (planned?.date === data.date) {
    return {
      main: planned.name, note: `${planned.exercises} 个动作`,
      action: planned.source === "scheduled" ? "schedule-preview" : "today-routine",
      value: planned.source === "scheduled" ? planned.date : planned.id, label: "开始计划", active: false, completed: false,
    };
  }
  if (completed) {
    return {
      main: `今日已完成 ${completed} 次`, note: "",
      action: todayRecent ? "workout-detail" : todayAppleFirst ? "apple-activity" : "edit",
      value: todayRecent?.id ?? todayAppleFirst?.id ?? "workout", label: todayRecent || todayAppleFirst ? "查看详情" : "记一笔", active: false, completed: true,
    };
  }
  if (data.restToday) return { main: "今日休息", note: "主动恢复日", action: "schedule-day", value: data.date, label: "调整排期", active: false, completed: false };
  if (planned) return { main: planned.name, note: `${shortDate(planned.date)} · 下次`, action: "today-routine", value: planned.id, label: "预览计划", active: false, completed: false };
  return { main: "自由训练", note: "", action: "edit", value: "workout", label: "开始记录", active: false, completed: false };
}
function todayStrip(data, statsData) {
  if (!data) return "";
  const { nutrition, weight } = data;
  const training = todayTrainingMeta(data, statsData);
  const targetWeight = statsData?.goals?.targetWeight;
  const weights = statsData?.weights ?? [];
  const displayWeight = weight ?? weights.at(-1)?.weight ?? null;
  const prevWeight = weights.length >= 2 ? weights.at(-2)?.weight : null;
  const wDiff = prevWeight != null && displayWeight != null ? Math.round((displayWeight - prevWeight) * 10) / 10 : null;
  const wDelta = wDiff != null && wDiff !== 0 ? `${wDiff > 0 ? "+" : ""}${fmt(wDiff, 1)} kg ${wDiff > 0 ? "↑" : "↓"}` : "";
  const weightSub = wDelta || (targetWeight ? `目标 ${fmt(targetWeight, 1)} kg` : weight === null && displayWeight != null ? "最近" : "点击记录");
  return `<section class="today-strip" aria-label="今日摘要">
    <button type="button" class="today-training${training.active ? " is-training" : ""}" data-action="${training.action}" data-value="${esc(training.value)}">
      <span class="play-squircle">${training.completed && !training.active ? dotCheckIcon(24) : dotPlayIcon(24)}</span>
      <span class="today-training-main">
        <span class="today-caption">${training.active ? '<span class="training-led" aria-hidden="true"></span>' : ""}今日训练 · ${esc(training.label)}</span>
        <strong>${esc(training.main)}</strong>
        ${training.note ? `<small>${esc(training.note)}</small>` : ""}
      </span>
      ${icon("chevron", 18)}
    </button>
    <button type="button" class="today-tile is-diet" data-action="today-diet">
      <span class="tile-head"><span>摄入</span>${nutrition.complete ? '<em class="tile-badge">完整</em>' : ""}${icon("plus", 14)}</span>
      <strong>${nutrition.count ? matrix(fmt(nutrition.calories, 0)) : "记饮食"}</strong>
      ${nutrition.count ? `<small>/ ${fmt(nutrition.target, 0)} kcal</small>${thinMeter(nutrition.calories / nutrition.target, "热量进度")}` : "<small>快速记录</small>"}</button>
    <button type="button" class="today-tile is-weight" data-action="today-weight">
      <span class="tile-head"><span>体重</span>${icon("plus", 14)}</span>
      <strong>${displayWeight != null ? `${matrix(fmt(displayWeight, 1))} <em>kg</em>` : "记体重"}</strong>
      <small>${esc(weightSub)}</small>
      ${miniSparkline(weights.slice(-8))}</button>
    </section>`;
}
// Secondary overview content: nothing here is lost, it just waits behind one disclosure.
function overviewMore(data, todayApple) {
  const panels = statisticsPanels(data, state, energyCard(data), "more");
  const daily = state.appleHealthConnected ? renderAppleDailyStrip(state.currentDay?.appleDaily) : "";
  const sync = todayApple.length ? `<details class="today-apple"${state.appleExpanded ? " open" : ""}>
    <summary><span class="record-icon">${icon("heart", 17)}</span><span class="sync-caption"><strong>今日同步</strong>
      <small>Apple 健康</small></span><span class="sync-count">${todayApple.length} 项</span>${icon("chevron", 16)}</summary>
    <div class="sync-list">${todayApple.map(appleLine).join("")}</div></details>` : "";
  if (!panels && !daily && !sync) return "";
  const showAppleCopy = Boolean(state.appleHealthConnected || todayApple.length > 0);
  return `<details class="overview-more"${state.moreExpanded ? " open" : ""}>
    <summary><span><strong>更多数据</strong><small>${showAppleCopy ? "日历 · 饮食 · Apple 健康 · 体感" : "日历 · 饮食 · 体感"}</small></span>${icon("chevron", 16)}</summary>
    <div class="overview-more-body">${daily}${sync}<div class="dashboard">${panels}</div></div></details>`;
}
function overview(data) {
  const { totals, previous } = data;
  const activities = totals.activities ?? totals.workouts;
  const todayApple = state.currentDay?.apple ?? [];
  const heroTraining = todayTrainingMeta(state.currentDay, data);
  const welcomeHtml = state.isNewUser && !state.demo
    ? renderWelcomeChecklist({
        userId: state.userId,
        data,
        currentDay: state.currentDay,
        hasPlan: Boolean(state.plan || state.schedule?.planId),
        appleHealthConnected: state.appleHealthConnected,
      })
    : "";
  const controls = `<div class="period-controls"><label aria-label="统计截止日期"><input type="date" data-change="through" min="1902-01-01" max="${data.today}" value="${data.through}"></label>
    ${segments(intervals, data.period, "period")}</div>`;
  content.innerHTML = `<div class="overview-lead${state.currentDay ? "" : " single-lead"}"><section class="hero">
    <span class="vf-c tl" aria-hidden="true"></span><span class="vf-c tr" aria-hidden="true"></span><span class="vf-c bl" aria-hidden="true"></span><span class="vf-c br" aria-hidden="true"></span>
    <div class="hero-top">
      <time class="hero-date" datetime="${data.today}"><strong>${matrix(data.today.slice(8))}</strong><span>${data.today.slice(0, 7).replace("-", ".")}</span></time>
      <div class="hero-top-actions">
        <button type="button" class="quiet hero-share-btn" data-action="share-day-record" data-value="${esc(data.today)}">${icon("download", 14)} 分享记录</button>
        <div class="hero-status"><i></i>${state.demo ? "演示" : "训练日志"}</div>
      </div>
    </div>
    <div class="hero-inner">
      <h1>今天</h1>
      ${heroTraining ? `<button type="button" class="hero-sublink" data-action="${heroTraining.action}" data-value="${esc(heroTraining.value)}"><span>${esc(heroTraining.main)}</span>${icon("chevron", 15)}</button>` : ""}
      ${weekStrip(data.activity, data.today, state.weekDate, state.weekSummary, state.schedule?.days, state.weekDetail)}
    </div>
  </section>${todayStrip(state.currentDay, data)}</div>
  ${welcomeHtml}
  ${ironDial(state.currentDay, data, { appleHealthConnected: state.appleHealthConnected })}
  <div class="section-bar stats-header"><div><h2>训练表现</h2><p>${shortDate(data.from)} – ${shortDate(data.through)}</p></div>${controls}</div>
  <div class="kpis">
    ${kpi("完成训练", fmt(activities), "次", delta(activities, previous.activities ?? previous.workouts, " 次"), "workout")}
    ${kpi("训练容量", fmt(totals.volume), "kg", delta(totals.volume, previous.volume, " kg"), "exercises")}
    ${kpi("完成组数", fmt(totals.sets), "组", delta(totals.sets, previous.sets, " 组"), "overview")}
    ${kpi("训练时长", totals.timedWorkouts ? fmt(totals.seconds / 3600, 1) : "—", "h",
        `<span class="comparison">${totals.timedWorkouts ? `均次 ${duration(totals.seconds / totals.timedWorkouts)}` : "暂无时长"}</span>`, "clock")}
  </div>
  <div class="dashboard">${statisticsPanels(data, state, energyCard(data), "primary")}</div>
  <section class="panel recent"><header class="panel-head"><h2>近期训练</h2><div class="heading-actions"><button type="button" class="quiet ai-inline-btn" data-action="ai-review">${icon("bolt", 15)} AI 复盘</button><button type="button" class="quiet" data-action="route" data-value="workout">全部训练 ${icon("chevron", 16)}</button></div></header>
   ${data.recent.length ? data.recent.map((row) => `<button class="record-line" data-action="workout-detail" data-value="${esc(row.id)}">
     <span class="record-icon">${icon("workout")}</span><span><strong>${esc(row.title)}</strong><small>${shortDate(row.date)} · ${duration(row.duration)}${row.feeling ? " · " + feelings[row.feeling] : ""}</small></span>
     <span class="record-number">${fmt(row.sets)} 组 · ${fmt(row.volume)} kg</span>${icon("chevron", 15)}</button>`).join("") :
     empty("暂无近期训练", "添加第一条训练，从这里回看表现。")}</section>
  ${badgesOverviewStrip(state.badges, getPinnedBadges(), { appleHealthConnected: state.appleHealthConnected })}
  ${overviewMore(data, todayApple)}`;
  $(".overview-more")?.addEventListener("toggle", ({ currentTarget }) => {
    if (currentTarget.isConnected) state.moreExpanded = currentTarget.open;
  });
  $(".today-apple")?.addEventListener("toggle", ({ currentTarget }) => {
    if (currentTarget.isConnected) state.appleExpanded = currentTarget.open;
  });
  void preloadAtlasMasks();
}
let dayLookupSeq = 0;
async function loadWorkoutsForDate(date) {
  if (state.dayCache.has(date)) return state.dayCache.get(date);
  const [workouts, activities] = await Promise.all([
    api("/api/records/workout"),
    appleRange(date, date).catch(() => []),
  ]);
  const manual = workouts
    .filter((row) => row.data.status !== "cancelled" && row.data.date === date)
    .sort((a, b) => Date.parse(b.data.startedAt) - Date.parse(a.data.startedAt));
  const apple = activities
    .filter((row) => !row.manualWorkoutId && row.date === date)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const result = { manual, apple };
  state.dayCache.set(date, result);
  return result;
}
function formatDaySummary(manual, apple) {
  const count = manual.length + apple.length;
  if (!count) return "未训练";
  const lead = manual[0]?.data.title ?? apple[0]?.title ?? "已训练";
  return count > 1 ? `${lead} 等 ${count} 项` : lead;
}
async function openDayWorkouts(date, cached = null) {
  const { manual, apple } = cached ?? await loadWorkoutsForDate(date);
  if (!manual.length && !apple.length) { notify("这一天暂无训练记录"); return; }
  if (apple.length) {
    const known = new Set(state.appleEntries.map((item) => item.id));
    state.appleEntries = [...state.appleEntries, ...apple.filter((item) => !known.has(item.id))];
  }
  if (manual.length === 1 && !apple.length) {
    if (manual[0].data.status === "completed") await showReport(manual[0].id, manual[0]);
    else (await getEditor()).edit("workout", manual[0], state.data?.goals);
    return;
  }
  if (!manual.length && apple.length === 1) {
    open("Apple 健康训练", appleWorkoutDetails(apple[0], false), true, "report");
    return;
  }
  open(`${shortDate(date)} · ${displayWeekday(date)}`, `<div class="dialog-form day-workouts">
    <div class="preview-meta"><span>共 ${manual.length + apple.length} 条训练记录</span></div>
    <div class="day-workout-list">
      ${manual.map((row) => {
        const sets = row.data.exercises.reduce((sum, ex) => sum + ex.sets.filter((entry) => entry.completed && entry.type !== "warmup").length, 0);
        const sec = workoutSeconds(row.data);
        return `<button type="button" class="record-line" data-action="workout-detail" data-value="${esc(row.id)}">
          <span class="record-icon">${icon("workout")}</span>
          <span><strong>${esc(row.data.title)}</strong><small>${row.data.status === "active" ? "进行中" : duration(sec)}${row.data.feeling ? " · " + feelings[row.data.feeling] : ""}</small></span>
          <span class="record-number">${row.data.status === "completed" ? `${sets} 组` : "草稿"}</span>${icon("chevron", 15)}</button>`;
      }).join("")}
      ${apple.map((item) => appleLine(item)).join("")}
    </div>
    <footer class="dialog-foot has-remove">
      <button type="button" class="secondary-button" data-action="share-day-record" data-value="${esc(date)}">${icon("download", 15)} 分享记录</button>
      <button type="button" class="secondary-button" data-action="edit-for-date" data-value="${esc(date)}">${icon("plus", 16)} 补录训练</button>
      <button type="button" class="primary-button" data-action="close">完成</button>
    </footer></div>`, false, "report");
}
function overviewKey() {
  return `${state.through}|${state.period ?? ""}|${state.strength}|${state.weekDate}`;
}
async function loadOverview(reloadDay = false) {
  const key = overviewKey();
  if (!reloadDay && state.data && state.cacheMeta.overviewEpoch === dataEpoch && state.cacheMeta.overviewKey === key && state.currentDay?.date === today()) {
    overview(state.data);
    return;
  }
  if (reloadDay) state.dayCache.clear();
  const query = new URLSearchParams({ through: state.through });
  if (state.period) query.set("days", state.period);
  if (state.strength) query.set("exercise", state.strength);
  const current = ++requestId;
  const fetchEpoch = dataEpoch;
  const [data, day, badges, schedule, weekDetail] = await Promise.all([api("/api/web/statistics?" + query),
    reloadDay || state.currentDay?.date !== today() ? api("/api/web/today").catch(() => null) : state.currentDay,
    reloadDay || !state.badges ? api("/api/web/badges").catch(() => null) : state.badges,
    reloadDay || !state.schedule ? api("/api/web/schedule").catch(() => null) : state.schedule,
    state.weekDate ? api("/api/web/schedule/" + encodeURIComponent(state.weekDate)).catch(() => null) : null]);
  if (current === requestId && state.view === "overview") {
    state.data = data;
    state.currentDay = day;
    state.badges = badges;
    state.schedule = schedule;
    state.weekDetail = weekDetail;
    state.cacheMeta.overviewEpoch = fetchEpoch;
    state.cacheMeta.overviewKey = key;
    if (badges) state.cacheMeta.badgesEpoch = fetchEpoch;
    nav();
    overview(data);
  }
}
function summarizeWorkoutRecord(data) {
  let sets = 0, vol = 0;
  for (const row of data.exercises ?? []) {
    const mode = row.snapshot?.mode ?? "reps";
    const mult = row.snapshot?.volumeMultiplier ?? 1;
    for (const entry of row.sets ?? []) {
      if (!entry.completed || entry.type === "warmup") continue;
      sets++;
      if (mode === "reps" && entry.weight > 0 && entry.reps > 0) vol += entry.weight * entry.reps * mult;
    }
  }
  return { sets, volume: Math.round(vol * 10) / 10 };
}
function recordLine(record, insideMeal = false, appleByWorkoutId = null) {
  const { kind, data } = record;
  let workoutRight = "";
  if (kind === "workout") {
    if (data.status === "completed") {
      const { sets, volume } = summarizeWorkoutRecord(data);
      workoutRight = `${sets} 组${volume > 0 ? ` · ${fmt(volume)} kg` : ""}`;
    } else {
      workoutRight = "草稿";
    }
  }
  const names = {
    workout: [data.title, data.status === "active" ? "进行中 · 可继续训练" : `${duration(workoutSeconds(data))}${data.feeling ? " · " + feelings[data.feeling] : ""}`,
      workoutRight],
    diet: [data.name, insideMeal === true ? "" : meals[data.meal], fmt(data.calories) + " kcal"],
    weight: [fmt(data.weight, 2) + " kg", data.bodyFat == null ? "称重记录" : "体脂率 " + fmt(data.bodyFat) + "%", ""],
  }[kind];
  const linked = kind === "workout" && (appleByWorkoutId ? appleByWorkoutId.get(record.id) : state.appleEntries.find((item) => item.manualWorkoutId === record.id));
  const subtitle = linked ? names[1] + " · Apple 健康 · " + linked.title : names[1];
  const lineBtn = `<button class="record-line" type="button" data-action="edit-record" data-kind="${esc(kind)}" data-value="${esc(record.id)}"><span class="record-icon">${icon(kind)}</span>
    <span><strong>${esc(names[0])}</strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</span><span class="record-number">${esc(names[2])}</span>${icon("chevron", 15)}</button>`;
  if (kind === "diet" && insideMeal) {
    return `<div class="swipe-row" data-swipe-kind="diet" data-record-id="${esc(record.id)}">
      <div class="swipe-bg is-copy-hint" aria-hidden="true">${icon("plus", 15)}<span>再来一份</span></div>
      <div class="swipe-bg is-del-hint" aria-hidden="true"><span>删除</span>${icon("close", 15)}</div>
      ${lineBtn}
    </div>`;
  }
  return lineBtn;
}
const weekDay = new Intl.DateTimeFormat("zh-CN", { weekday: "long", timeZone: "Asia/Hong_Kong" });
const displayWeekday = (date) => weekDay.format(new Date(date + "T12:00:00+08:00"));
function buildAppleWorkoutMap() {
  const map = new Map();
  for (const entry of state.appleEntries) {
    if (entry.manualWorkoutId && !map.has(entry.manualWorkoutId)) {
      map.set(entry.manualWorkoutId, entry);
    }
  }
  return map;
}
function workoutMatchesFilters(record, query, muscleFilter) {
  const data = record.data;
  if (muscleFilter) {
    const hasMuscle = (data.exercises ?? []).some((row) => row.snapshot?.muscle === muscleFilter);
    if (!hasMuscle) return false;
  }
  if (!query) return true;
  const hay = [
    data.title,
    data.notes,
    ...(data.exercises ?? []).flatMap((row) => [row.snapshot?.name, row.exerciseId]),
  ];
  return hay.some((t) => String(t ?? "").toLowerCase().includes(query));
}
function renderWorkoutHistoryBody(appleByWorkoutId = buildAppleWorkoutMap()) {
  const source = state.trainingSource;
  const query = state.workoutQuery.trim().toLowerCase();
  const muscleFilter = state.workoutMuscle;
  const allEntries = [];
  let filteredVolume = 0;

  for (const record of state.records) {
    if (record.data.status !== "completed") continue;
    if (source === "apple" && !appleByWorkoutId.has(record.id)) continue;
    if (!workoutMatchesFilters(record, query, muscleFilter)) continue;
    filteredVolume += summarizeWorkoutRecord(record.data).volume;
    allEntries.push({
      date: record.data.date,
      atMs: Date.parse(record.data.startedAt) || 0,
      type: "workout",
      item: record,
    });
  }
  if (source !== "ironlog" && !muscleFilter) {
    for (const activity of state.appleEntries) {
      if (activity.manualWorkoutId) continue;
      if (query && !String(activity.title ?? "").toLowerCase().includes(query)) continue;
      allEntries.push({
        date: activity.date,
        atMs: Date.parse(activity.startedAt) || 0,
        type: "apple",
        item: activity,
      });
    }
  }
  allEntries.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : b.atMs - a.atMs));
  const visibleEntries = allEntries.slice(0, state.shownWorkouts);
  const byMonth = new Map();
  for (const entry of visibleEntries) {
    const month = entry.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { count: 0, days: new Map() });
    const monthBucket = byMonth.get(month);
    monthBucket.count++;
    if (!monthBucket.days.has(entry.date)) monthBucket.days.set(entry.date, []);
    const markup = entry.type === "workout" ? recordLine(entry.item, false, appleByWorkoutId) : appleLine(entry.item);
    monthBucket.days.get(entry.date).push(markup);
  }
  const totalCount = allEntries.length;
  const remaining = totalCount - visibleEntries.length;
  const summaryLine = query || muscleFilter
    ? `<p class="workout-filter-stats">筛选命中 <b>${totalCount}</b> 场训练${filteredVolume > 0 ? ` · 累计容量 <b>${fmt(filteredVolume, 0)}</b> kg` : ""}</p>`
    : "";
  return `${summaryLine}${byMonth.size ? [...byMonth].map(([month, { count, days }]) => `<section class="history-month">
      <header class="history-month-head"><h3>${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月</h3><span>${count} 场</span></header>
      ${[...days].map(([date, entries]) => `<section class="history-day">
        <header><h3><time datetime="${date}">${shortDate(date)}</time></h3>
        <p>${date === today() ? "今天" : displayWeekday(date)}${date.slice(0, 4) === today().slice(0, 4) ? "" : " · " + date.slice(0, 4)} · ${entries.length} 条</p></header>
        <div class="history-entries">${entries.join("")}</div></section>`).join("")}
    </section>`).join("") :
      empty("暂无已完成训练", query || muscleFilter ? "没有匹配的训练记录，试试清空关键词或切换肌群。" : source === "all" ? "完成一场训练后，可以在这里回看。" : "可切换到全部来源查看记录。")}
    ${remaining > 0 ? `<div class="history-more"><button class="secondary-button" type="button" data-action="more-workouts">查看更多记录（还有 ${remaining} 场）</button></div>` : ""}`;
}
function renderPrWallSection(trainedItems = []) {
  if (!trainedItems.length) return "";
  const byId = new Map(trainedItems.map((item) => [item.id, item]));
  const squat1rm = byId.get("squat")?.best1rm ?? 0;
  const bench1rm = byId.get("bench-press")?.best1rm ?? 0;
  const pull1rm = byId.get("deadlift")?.best1rm ?? byId.get("romanian-deadlift")?.best1rm ?? 0;
  const big3Count = [squat1rm, bench1rm, pull1rm].filter((v) => v > 0).length;
  const sbdTotal = squat1rm + bench1rm + pull1rm;
  const canonicalIds = ["bench-press", "squat", "deadlift", "romanian-deadlift", "overhead-press", "barbell-row"];
  const picks = [];
  const seen = new Set();
  for (const id of canonicalIds) {
    const hit = byId.get(id);
    if (hit) { picks.push(hit); seen.add(id); }
  }
  const scoreOf = (ex) => ex.mode === "timed" ? (ex.bestHold ?? 0) : (ex.best1rm ?? ex.bestWeight ?? 0);
  for (const ex of [...trainedItems].sort((a, b) => scoreOf(b) - scoreOf(a) || b.sessionsCount - a.sessionsCount)) {
    if (picks.length >= 6) break;
    if (!seen.has(ex.id)) { picks.push(ex); seen.add(ex.id); }
  }
  const cards = picks.slice(0, 6).map((ex) => {
    const mainVal = ex.mode === "timed"
      ? `${ex.bestHold ?? 0} 秒`
      : ex.mode === "assisted"
      ? `辅助 ${fmt(ex.bestAssistance)} kg`
      : ex.best1rm
      ? `1RM ${fmt(ex.best1rm)} kg`
      : `${fmt(ex.bestWeight)} kg`;
    const subTxt = ex.mode === "reps" && ex.best1rm && ex.bestWeight
      ? `最高 ${fmt(ex.bestWeight)} kg · ${ex.sessionsCount} 场`
      : `${ex.sessionsCount} 场 · ${shortDate(ex.lastDate)}`;
    return `<button type="button" class="pr-wall-card" data-action="exercise-detail" data-value="${esc(ex.id)}">
      <span class="pr-wall-top"><small>${esc(muscles[ex.muscle] ?? ex.muscle)}</small><small>${shortDate(ex.lastDate)}</small></span>
      <strong>${esc(ex.name)}</strong>
      <b>${esc(mainVal)}</b>
      <em>${esc(subTxt)}</em>
    </button>`;
  }).join("");
  return `<section class="panel pr-wall-panel" aria-label="个人最佳纪录榜">
    <header class="panel-head">
      <div class="pr-wall-head-copy">
        <h2>个人最佳纪录榜</h2>
        ${big3Count >= 2 ? `<span class="pr-sbd-badge">${icon("trophy", 12)} 三大项预估 <b>${fmt(sbdTotal, 0)} kg</b></span>` : ""}
      </div>
      <button type="button" class="quiet" data-action="open-trained-prs">全部 ${trainedItems.length} 项 ${icon("chevron", 14)}</button>
    </header>
    <div class="pr-wall-grid">${cards}</div>
  </section>`;
}
function renderWorkoutHistory() {
  const hasAppleWorkouts = Boolean(state.appleHealthConnected || state.appleEntries.length > 0);
  if (!hasAppleWorkouts) state.trainingSource = "all";
  const source = state.trainingSource;
  const appleByWorkoutId = buildAppleWorkoutMap();
  const active = state.records.filter((record) => record.data.status === "active");
  const totalUnfiltered = state.records.filter((r) => r.data.status === "completed").length
    + state.appleEntries.filter((a) => !a.manualWorkoutId).length;
  const filterMuscles = { "": "全部", chest: "胸", back: "背", legs: "腿", shoulders: "肩", arms: "臂", core: "核心" };
  content.innerHTML = heading("训练记录", `${totalUnfiltered} 场训练`, `<div class="heading-actions"><button class="secondary-button" type="button" data-action="open-csv-import">${icon("upload", 15)} 导入 CSV</button><button class="secondary-button" type="button" data-action="ai-workout">${icon("bolt", 16)} AI 记训练</button><button class="primary-button" type="button" data-action="edit" data-value="workout">${icon("plus")} 记录训练</button></div>`) +
    (active.length ? `<section class="panel history-active"><h2>进行中的训练</h2>${active.slice().reverse().map((record) => recordLine(record, false, appleByWorkoutId)).join("")}</section>` : "") +
    renderPrWallSection(state.trainedExercisesCache?.items ?? []) +
    `<section class="training-history" aria-label="历史训练"><header class="history-bar"><h2>已完成</h2>
      ${hasAppleWorkouts ? segments({ all: "全部来源", ironlog: "铁记", apple: "Apple 健康" }, source, "training-source") : ""}</header>
      <div class="workout-filter-bar">
        <label class="search workout-search">${icon("search", 15)}<input id="workout-search" type="search" enterkeyhint="search" maxlength="80" value="${esc(state.workoutQuery)}" placeholder="搜索训练标题、动作名或备注…" aria-label="搜索训练记录"></label>
        <div class="muscle-pills" role="group" aria-label="按目标肌群筛选历史训练">${Object.entries(filterMuscles).map(([val, lbl]) =>
          `<button type="button" data-action="workout-muscle" data-value="${val}" aria-pressed="${state.workoutMuscle === val}">${lbl}</button>`).join("")}</div>
      </div>
      <div id="workout-history-body">${renderWorkoutHistoryBody(appleByWorkoutId)}</div></section>`;
  requestAnimationFrame(() => centerActivePills(content, false));
}
const appleRange = (from, through) => api("/api/integrations/apple-health/agenda?" + new URLSearchParams({ from, through }));
const appleDailyRange = (from, through) => api("/api/integrations/apple-health/daily?" + new URLSearchParams({ from, through })).then((res) => res?.entries ?? []);
async function loadRecords(kind, version) {
  const date = state.date;
  const cached = state.recordsCache[kind];
  if (cached && cached.epoch === dataEpoch) {
    state.records = cached.records;
    state.appleEntries = cached.appleEntries;
    if (kind === "workout" && cached.trainedItems && (!state.trainedExercisesCache || state.trainedExercisesCache.epoch !== dataEpoch)) {
      state.trainedExercisesCache = { epoch: dataEpoch, items: cached.trainedItems };
    }
    if (kind === "diet") {
      state.dietTarget = cached.dietTarget;
      state.dietTargets = cached.dietTargets;
      state.mealTemplates = cached.mealTemplates;
      state.recentFoods = cached.recentFoods;
      const hasWater = cached.waterByDate?.has(date);
      state.dietWaterMl = hasWater ? cached.waterByDate.get(date) : 0;
      if (cached.doneByDate.has(date) && hasWater) {
        state.dietDone = cached.doneByDate.get(date);
        renderRecords(kind);
        return;
      }
      state.dietDone = cached.doneByDate.has(date) ? cached.doneByDate.get(date) : false;
      renderRecords(kind);
      const [marker, dailyList] = await Promise.all([
        cached.doneByDate.has(date) ? null : api("/api/web/nutrition-day?date=" + date).catch(() => null),
        hasWater ? null : appleDailyRange(date, date).catch(() => []),
      ]);
      if (version !== requestId || state.view !== "diet" || state.date !== date) return;
      if (marker) {
        state.dietDone = !!marker.complete;
        cached.doneByDate.set(date, state.dietDone);
        updateDietStatus();
      }
      if (dailyList) {
        state.dietWaterMl = dailyList[0]?.waterMl ?? 0;
        cached.waterByDate.set(date, state.dietWaterMl);
        updateDietHydration();
      }
      return;
    }
    if (kind === "weight") {
      state.weightGoal = cached.weightGoal;
      state.appleDailyWeightList = cached.appleDailyWeightList;
      state.measurements = cached.measurements ?? [];
      state.profileHeightCm = cached.profileHeightCm ?? null;
    }
    state.dietDone = false;
    renderRecords(kind);
    return;
  }
  content.innerHTML = loadingMarkup();
  const fetchEpoch = dataEpoch;
  const latest = today();
  const first = new Date(Date.parse(latest) - 365 * 86400000).toISOString().slice(0, 10);
  const since30 = new Date(Date.parse(latest) - 29 * 86400000).toISOString().slice(0, 10);
  const [records, marker, activities, profile, mealTemplates, dailyWeights, measurements, dietDaily, trainedMeta] = await Promise.all([api("/api/records/" + kind),
    kind === "diet" ? api("/api/web/nutrition-day?date=" + date).catch(() => null) : null,
    kind === "workout" ? appleRange(first, latest).catch(() => []) : [],
    kind !== "workout" ? api("/api/web/profile").catch(() => null) : null,
    kind === "diet" ? api("/api/records/mealTemplate").catch(() => []) : [],
    kind === "weight" ? appleDailyRange(since30, latest).catch(() => []) : [],
    kind === "weight" ? api("/api/web/measurements").catch(() => []) : [],
    kind === "diet" ? appleDailyRange(date, date).catch(() => []) : [],
    kind === "workout"
      ? (state.trainedExercisesCache?.epoch === fetchEpoch
        ? Promise.resolve(state.trainedExercisesCache)
        : api("/api/web/trained-exercises").then((res) => ({ epoch: fetchEpoch, items: res?.items ?? [] })).catch(() => null))
      : null]);
  if (version !== requestId) return;
  state.records = records.filter((row) => kind !== "workout" || row.data.status !== "cancelled");
  state.dietDone = !!marker?.complete && date === state.date;
  if (kind === "workout" && trainedMeta) {
    state.trainedExercisesCache = { epoch: fetchEpoch, items: trainedMeta.items ?? [] };
  }
  if (kind === "diet") {
    state.dietTarget = profile?.profile.calories ?? null;
    state.dietTargets = profile?.profile ?? null;
    state.mealTemplates = mealTemplates;
    state.recentFoods = extractRecentFoods(records);
    state.dietWaterMl = dietDaily?.[0]?.waterMl ?? 0;
  }
  if (kind === "weight") {
    state.weightGoal = profile?.profile.targetWeight ?? null;
    state.appleDailyWeightList = dailyWeights;
    state.measurements = measurements ?? [];
    state.profileHeightCm = profile?.profile?.energyProfile?.heightCm ?? null;
  }
  state.appleEntries = activities;
  state.recordsCache[kind] = {
    epoch: fetchEpoch,
    records: state.records,
    appleEntries: activities,
    ...(kind === "workout" && { trainedItems: state.trainedExercisesCache?.items ?? [] }),
    ...(kind === "diet" && {
      dietTarget: state.dietTarget,
      dietTargets: state.dietTargets,
      mealTemplates,
      recentFoods: state.recentFoods,
      doneByDate: new Map([[date, state.dietDone]]),
      waterByDate: new Map([[date, state.dietWaterMl]]),
    }),
    ...(kind === "weight" && {
      weightGoal: state.weightGoal,
      appleDailyWeightList: dailyWeights,
      measurements: state.measurements,
      profileHeightCm: state.profileHeightCm,
    }),
  };
  renderRecords(kind);
}
async function copyDietFoods({ date, meal, foods, source = "copy", label = "" }) {
  if (!foods.length) return;
  const mutations = foods.slice(0, 100).map((f) => ({
    opId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    kind: "diet",
    baseVersion: 0,
    deleted: false,
    data: {
      date,
      meal: meal ?? f.meal,
      name: f.name,
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      source,
      rawPrompt: "",
    },
  }));
  await api("/api/sync", { method: "POST", body: { cursor: 0, mutations } });
  state.badges = null;
  await loadRecords("diet", requestId);
  notify(label || `已添加 ${mutations.length} 项饮食至 ${shortDate(date)}`);
}
function openSaveMealTemplateModal(meal, entries) {
  const totalCal = Math.round(entries.reduce((s, r) => s + r.data.calories, 0));
  const defaultName = entries.length === 1 ? entries[0].data.name : `${meals[meal]}搭配 · ${entries[0].data.name}`.slice(0, 48);
  open("存为常用餐单", `<form id="meal-tpl-form" class="dialog-form">
    ${field("餐单名称", input("name", defaultName, 'maxlength="120" required autofocus'))}
    <div class="meal-tpl-preview">
      <small>包含 ${entries.length} 项食材 · 共 ${fmt(totalCal, 0)} kcal</small>
      <ul>${entries.map((r) => `<li><span>${esc(r.data.name)}</span><span>${fmt(r.data.calories, 0)} kcal</span></li>`).join("")}</ul>
    </div>
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot">
      <button type="button" class="quiet" data-action="close">取消</button>
      <button type="submit" class="primary-button">保存餐单模板</button>
    </footer>
  </form>`);
  const form = $("#meal-tpl-form", dialog);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    const btn = $('button[type="submit"]', form);
    const err = $(".form-error", form);
    btn.disabled = true;
    err.hidden = true;
    try {
      const foods = entries.slice(0, 30).map((r) => ({
        name: r.data.name, calories: r.data.calories, protein: r.data.protein, carbs: r.data.carbs, fat: r.data.fat, source: "manual", rawPrompt: "",
      }));
      const id = "mealTpl_" + crypto.randomUUID().slice(0, 12);
      const res = await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id, kind: "mealTemplate", baseVersion: 0, deleted: false, data: { name, foods } } });
      if (res.record) state.mealTemplates.push(res.record);
      dialog.close();
      if (state.view === "diet") renderDiet();
      notify(`已存为常用餐单「${name}」`);
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
}
function openEditMealTemplateModal(tpl) {
  let foods = (tpl.data.foods ?? []).map((f) => ({
    name: f.name ?? "",
    calories: Number(f.calories) || 0,
    protein: Number(f.protein) || 0,
    carbs: Number(f.carbs) || 0,
    fat: Number(f.fat) || 0,
  }));
  if (!foods.length) foods = [{ name: "", calories: 0, protein: 0, carbs: 0, fat: 0 }];

  open("编辑常用餐单", `<form id="edit-meal-tpl-form" class="dialog-form">
    ${field("餐单名称", input("name", tpl.data.name ?? "", 'maxlength="120" required'))}
    <div class="meal-tpl-edit-head">
      <small data-tpl-totals></small>
      <button type="button" class="quiet" id="meal-tpl-add-item">${icon("plus", 14)} 添加一项</button>
    </div>
    <div class="meal-tpl-edit-list" id="meal-tpl-edit-rows"></div>
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot">
      <button type="button" class="quiet" data-action="close">取消</button>
      <button type="submit" class="primary-button">保存修改</button>
    </footer>
  </form>`, true);

  const form = $("#edit-meal-tpl-form", dialog);
  const rowsHost = $("#meal-tpl-edit-rows", form);
  const totalsEl = $("[data-tpl-totals]", form);
  const err = $(".form-error", form);

  function syncDomToFoods() {
    foods = $$("[data-tpl-food-row]", rowsHost).map((el) => ({
      name: String($('[data-f="name"]', el)?.value ?? "").trim(),
      calories: Math.max(0, Number($('[data-f="calories"]', el)?.value) || 0),
      protein: Math.max(0, Number($('[data-f="protein"]', el)?.value) || 0),
      carbs: Math.max(0, Number($('[data-f="carbs"]', el)?.value) || 0),
      fat: Math.max(0, Number($('[data-f="fat"]', el)?.value) || 0),
    }));
  }

  function updateTotals() {
    const kcal = Math.round(foods.reduce((s, f) => s + (Number(f.calories) || 0), 0));
    const prot = Math.round(foods.reduce((s, f) => s + (Number(f.protein) || 0), 0) * 10) / 10;
    if (totalsEl) totalsEl.textContent = `共 ${foods.length} 项 · 约 ${fmt(kcal, 0)} kcal · 蛋白 ${fmt(prot, 1)} g`;
  }

  function drawFoodRows() {
    rowsHost.innerHTML = foods.map((f, idx) => `<div class="meal-tpl-edit-row" data-tpl-food-row="${idx}">
      <label class="tpl-food-name"><span>食物名称</span><input data-f="name" maxlength="120" required value="${esc(f.name)}" placeholder="例如：鸡胸肉 150g"></label>
      <label><span>千卡</span><input data-f="calories" type="number" inputmode="decimal" min="0" max="50000" step="1" required value="${f.calories}"></label>
      <label><span>蛋白g</span><input data-f="protein" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required value="${f.protein}"></label>
      <label><span>碳水g</span><input data-f="carbs" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required value="${f.carbs}"></label>
      <label><span>脂肪g</span><input data-f="fat" type="number" inputmode="decimal" min="0" max="1000" step="0.1" required value="${f.fat}"></label>
      <button type="button" class="quiet icon-button tpl-food-del" data-tpl-del="${idx}" aria-label="删除第 ${idx + 1} 项"${foods.length <= 1 ? " disabled" : ""}>${icon("close", 15)}</button>
    </div>`).join("");
    updateTotals();
  }

  rowsHost.addEventListener("input", () => { syncDomToFoods(); updateTotals(); });
  rowsHost.addEventListener("click", ({ target }) => {
    const delBtn = target.closest("[data-tpl-del]");
    if (!delBtn || foods.length <= 1) return;
    syncDomToFoods();
    foods.splice(Number(delBtn.dataset.tplDel), 1);
    drawFoodRows();
  });
  $("#meal-tpl-add-item", form)?.addEventListener("click", () => {
    if (foods.length >= 30) { notify("每个常用餐单最多保存 30 项食物"); return; }
    syncDomToFoods();
    foods.push({ name: "", calories: 0, protein: 0, carbs: 0, fat: 0 });
    drawFoodRows();
    $$('[data-f="name"]', rowsHost).at(-1)?.focus({ preventScroll: true });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncDomToFoods();
    err.hidden = true;
    const name = String(form.elements.name.value ?? "").trim();
    const cleaned = foods.filter((f) => f.name.length > 0).slice(0, 30).map((f) => ({
      ...f, source: "manual", rawPrompt: "",
    }));
    if (!name || !cleaned.length) {
      err.textContent = "请填写餐单名称并保留至少 1 项有效食物。";
      err.hidden = false;
      return;
    }
    const submitBtn = $('button[type="submit"]', form);
    submitBtn.disabled = true;
    try {
      const res = await api("/api/records", {
        method: "POST",
        body: { opId: crypto.randomUUID(), id: tpl.id, kind: "mealTemplate", baseVersion: tpl.version, deleted: false, data: { name, foods: cleaned } },
      });
      if (res.record) {
        state.mealTemplates = state.mealTemplates.map((r) => (r.id === tpl.id ? res.record : r));
        if (state.recordsCache.diet) state.recordsCache.diet.mealTemplates = state.mealTemplates;
      }
      dialog.close();
      if (state.view === "diet") renderDiet();
      notify(`已更新常用餐单「${name}」`);
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    } finally { submitBtn.disabled = false; }
  });

  drawFoodRows();
}
const WATER_GOAL_KEY = "ironlog-web-water-goal";
const WATER_GOALS = [2000, 2500, 3000, 3500];
function getWaterGoalMl() {
  try {
    const v = Number(localStorage.getItem(WATER_GOAL_KEY));
    return WATER_GOALS.includes(v) ? v : 2000;
  } catch {
    return 2000;
  }
}
function cycleWaterGoalMl() {
  const cur = getWaterGoalMl();
  const next = WATER_GOALS[(WATER_GOALS.indexOf(cur) + 1) % WATER_GOALS.length];
  try { localStorage.setItem(WATER_GOAL_KEY, String(next)); } catch {}
  return next;
}
function renderHydrationBoxHtml(ml) {
  const goal = getWaterGoalMl();
  return `<div class="hydration-box" data-hydration-box>
    <div class="hydration-head">
      <span>今日饮水 <button type="button" class="quiet hydration-goal-btn" data-action="cycle-water-goal" title="点击切换每日饮水目标">调目标</button></span>
      <strong>${fmt(ml, 0)} <small>/ ${fmt(goal, 0)} ml</small></strong>
    </div>
    ${thinMeter(ml / goal, "今日饮水完成度")}
    <div class="hydration-actions" role="group" aria-label="快捷记录饮水量">
      <button type="button" class="micro-chip" data-action="water-delta" data-value="250">+250ml</button>
      <button type="button" class="micro-chip" data-action="water-delta" data-value="500">+500ml</button>
      ${ml >= 250 ? `<button type="button" class="micro-chip" data-action="water-delta" data-value="-250">-250ml</button>` : ""}
      ${ml > 0 ? `<button type="button" class="quiet hydration-reset" data-action="water-reset">重置</button>` : ""}
    </div>
  </div>`;
}
function updateDietHydration() {
  const box = $("[data-hydration-box]", content);
  if (box) box.outerHTML = renderHydrationBoxHtml(state.dietWaterMl ?? 0);
}
async function changeDietDate(date) {
  state.date = date;
  const cached = state.recordsCache.diet;
  const hasDone = cached && cached.epoch === dataEpoch && cached.doneByDate?.has(date);
  const hasWater = cached && cached.epoch === dataEpoch && cached.waterByDate?.has(date);
  if (hasDone && hasWater) {
    state.dietDone = cached.doneByDate.get(date);
    state.dietWaterMl = cached.waterByDate.get(date);
    renderRecords("diet");
    return;
  }
  state.dietDone = hasDone ? cached.doneByDate.get(date) : false;
  state.dietWaterMl = hasWater ? cached.waterByDate.get(date) : 0;
  renderRecords("diet");
  const [marker, dailyList] = await Promise.all([
    hasDone ? null : api("/api/web/nutrition-day?date=" + date).catch(() => null),
    hasWater ? null : appleDailyRange(date, date).catch(() => []),
  ]);
  if (state.view !== "diet" || state.date !== date) return;
  if (marker) {
    state.dietDone = !!marker.complete;
    if (cached && cached.epoch === dataEpoch) cached.doneByDate.set(date, state.dietDone);
    updateDietStatus();
  }
  if (dailyList) {
    state.dietWaterMl = dailyList[0]?.waterMl ?? 0;
    if (cached && cached.epoch === dataEpoch) cached.waterByDate?.set(date, state.dietWaterMl);
    updateDietHydration();
  }
}
function updateDietStatus() {
  const button = $('[data-action="complete-diet"]');
  if (!button) return;
  button.hidden = state.dietDone;
  $(".diet-done").hidden = !state.dietDone;
}
function renderDiet() {
  const date = state.date;
  const prevDate = shiftDateStr(date, -1);
  const rows = state.records.filter((row) => row.data.date === date).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const prevDayRows = state.records.filter((row) => row.data.date === prevDate);
  const sum = (items, key) => items.reduce((total, row) => total + row.data[key], 0);
  const calories = sum(rows, "calories");
  const target = state.dietTarget;
  const targets = state.dietTargets;
  const diff = target ? Math.round(target - calories) : null;
  const goalDiffNote = diff === null ? "" : diff > 0 ? `还差 ${fmt(diff, 0)} kcal` : diff < 0 ? `超出 ${fmt(Math.abs(diff), 0)} kcal` : "已达每日目标";
  const mealTplPanel = `<section class="panel meal-templates-panel">
    <header class="panel-head"><div><h2>常用餐单模板</h2><p>${state.mealTemplates.length ? `已存 ${state.mealTemplates.length} 套搭配 · 1 键填入任一餐次` : "在上方任意一餐点击「存餐单」，日后可整餐复刻"}</p></div></header>
    ${state.mealTemplates.length ? `<div class="meal-tpl-grid">${state.mealTemplates.map((tpl) => {
      const foods = tpl.data.foods ?? [];
      const kcal = Math.round(foods.reduce((s, f) => s + f.calories, 0));
      const prot = Math.round(foods.reduce((s, f) => s + f.protein, 0));
      return `<article class="meal-tpl-card">
        <header><div><strong>${esc(tpl.data.name)}</strong><small>${foods.length} 项 · ${fmt(kcal, 0)} kcal · 蛋白 ${prot}g</small></div>
          <div class="meal-tpl-card-ops">
            <button type="button" class="quiet" data-action="edit-meal-template" data-value="${esc(tpl.id)}">编辑</button>
            <button type="button" class="quiet icon-button" data-action="delete-meal-template" data-value="${esc(tpl.id)}" aria-label="删除餐单">${icon("close", 15)}</button>
          </div></header>
        <p class="meal-tpl-foods">${esc(foods.map((f) => f.name).join("、"))}</p>
        <div class="meal-tpl-apply-row" role="group" aria-label="添加到餐次">${Object.entries(meals).map(([mKey, mLabel]) =>
          `<button type="button" class="micro-chip" data-action="apply-meal-template" data-id="${esc(tpl.id)}" data-meal="${mKey}">+${mLabel}</button>`).join("")}</div>
      </article>`;
    }).join("")}</div>` : ""}
  </section>`;
  content.innerHTML = heading("饮食记录", "") +
    `<div class="diet-toolbar"><div class="toolbar">
      <button type="button" class="icon-button" data-action="diet-step" data-value="-1" aria-label="前一天"${date <= "1902-01-01" ? " disabled" : ""}>${icon("back")}</button>
      <input aria-label="饮食日期" data-change="diet-date" type="date" min="1902-01-01" max="${today()}" value="${date}">
      <button type="button" class="icon-button" data-action="diet-step" data-value="1" aria-label="后一天"${date >= today() ? " disabled" : ""}>${icon("chevron")}</button>
      ${date !== today() ? '<button class="quiet" type="button" data-action="diet-today">今天</button>' : ""}</div>
      <div class="diet-toolbar-actions">
        ${prevDayRows.length ? `<button class="secondary-button" type="button" data-action="copy-diet-day" data-from="${esc(prevDate)}" data-to="${esc(date)}">${icon("copy", 15)} 复刻昨日 (${prevDayRows.length})</button>` : ""}
        <button class="secondary-button" type="button" data-action="ai-diet">${icon("bolt", 16)} AI 记饮食</button>
      </div></div>
    <div class="diet-layout">
      <section class="panel diet-summary"><header class="panel-head"><h2>当天摄入</h2>${goalDiffNote ? `<span class="diet-diff">${esc(goalDiffNote)}</span>` : ""}</header>
        <div class="diet-energy"><strong>${rows.length ? matrix(fmt(calories, 0)) : "—"}</strong><span>kcal</span></div>
        ${target ? `<p class="diet-goal">每日目标 ${fmt(target, 0)} kcal</p>
          ${dotMeter(rows.length ? calories / target : 0, 20, "热量完成度")}` : ""}
        <div class="diet-macros-list">${[["protein", "蛋白质"], ["carbs", "碳水"], ["fat", "脂肪"]].map(([key, label]) => {
          const val = rows.length ? sum(rows, key) : 0;
          const mTarget = targets?.[key] ?? null;
          const rem = mTarget ? Math.round(mTarget - val) : null;
          return `<div class="macro-row">
            <div class="macro-row-head"><span>${label}${rem != null ? ` <small class="macro-rem${rem <= 0 ? " is-met" : ""}">${rem > 0 ? `还差 ${fmt(rem, 0)}g` : "已达标"}</small>` : ""}</span><strong>${rows.length ? fmt(val) : "—"}${mTarget ? ` <small>/ ${fmt(mTarget, 0)} g</small>` : " <small>g</small>"}</strong></div>
            ${mTarget ? thinMeter(rows.length ? val / mTarget : 0, `${label}完成度`) : ""}
          </div>`;
        }).join("")}</div>
        ${renderHydrationBoxHtml(state.dietWaterMl ?? 0)}
        ${rows.length ? `<footer class="diet-status">
          <button class="secondary-button" type="button" data-action="complete-diet"${state.dietDone ? " hidden" : ""}>标记全天已记录</button>
          <span class="diet-done" role="status"${state.dietDone ? "" : " hidden"}>${icon("check", 17)} 全天已记录</span></footer>` : ""}</section>
      <div class="meal-grid">${Object.entries(meals).map(([meal, label]) => {
        const entries = rows.filter((row) => row.data.meal === meal);
        const prevMealCount = prevDayRows.filter((row) => row.data.meal === meal).length;
        return `<section class="panel meal-card"><header class="panel-head"><div><h2>${label}</h2>
          ${entries.length ? `<p>${fmt(sum(entries, "calories"), 0)} kcal</p>` : '<p>暂无记录</p>'}</div>
          <div class="meal-head-actions">
            ${!entries.length && prevMealCount ? `<button type="button" class="quiet" data-action="copy-diet-meal" data-meal="${meal}" data-from="${esc(prevDate)}" data-to="${esc(date)}">${icon("copy", 14)} 同昨日</button>` : ""}
            ${entries.length ? `<button type="button" class="quiet" data-action="save-meal-template" data-meal="${meal}" title="将本餐组合存为常用餐单">${icon("bookmark", 14)} 存餐单</button>` : ""}
            <button type="button" class="quiet" data-action="record-meal" data-value="${meal}" aria-label="记录${label}">${icon("plus", 17)} 添加</button>
          </div></header>
          ${entries.map((row) => recordLine(row, true)).join("")}</section>`;
      }).join("")}</div>
    </div>
    ${mealTplPanel}`;
}
function renderRecords(kind) {
  if (kind === "workout") return renderWorkoutHistory();
  if (kind === "diet") return renderDiet();
  renderWeight();
}
const measurementSpecs = [
  ["waistCm", "腰围", 30, 250],
  ["chestCm", "胸围", 40, 250],
  ["armCm", "臂围", 15, 100],
  ["thighCm", "大腿围", 25, 150],
  ["hipCm", "臀围", 40, 250],
];
function measureSparkSvg(values) {
  if (values.length < 2) return "";
  const w = 72, h = 22, p = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(0.2, max - min);
  const pts = values.map((v, i) => {
    const x = p + (i / (values.length - 1)) * (w - p * 2);
    const y = h - p - ((v - min) / span) * (h - p * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts.at(-1).split(",");
  return `<svg class="measure-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polyline fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}"/>
    <circle cx="${lx}" cy="${ly}" r="2.2" fill="currentColor"/>
  </svg>`;
}
function renderMeasurementsSection(measurements = [], heightCm = state.profileHeightCm) {
  const asc = [...measurements].reverse();
  let latestWaist = null, latestHip = null;
  for (const row of asc) {
    if (row.waistCm != null) latestWaist = row.waistCm;
    if (row.hipCm != null) latestHip = row.hipCm;
  }
  const whr = latestWaist && latestHip ? (latestWaist / latestHip) : null;
  const whtr = latestWaist && heightCm ? (latestWaist / heightCm) : null;
  const ratiosHtml = (whr || whtr) ? `<div class="measure-ratios">
    ${whr ? `<span class="measure-ratio-chip">腰臀比 WHR <b>${whr.toFixed(2)}</b></span>` : ""}
    ${whtr ? `<span class="measure-ratio-chip${whtr < 0.5 ? " is-good" : " is-warn"}">腰高比 WHtR <b>${whtr.toFixed(2)}</b><small>${whtr < 0.5 ? "健康区间" : "偏高"}</small></span>` : ""}
  </div>` : "";
  const tiles = measurementSpecs.map(([key, label]) => {
    const vals = asc.map((r) => r[key]).filter((v) => v != null);
    const firstVal = vals[0] ?? null;
    const latestVal = vals.at(-1) ?? null;
    const diff = latestVal != null && firstVal != null && vals.length > 1
      ? Math.round((latestVal - firstVal) * 10) / 10
      : null;
    const diffCls = diff == null ? "" : key === "waistCm" ? (diff < 0 ? " is-good" : diff > 0 ? " is-warn" : "") : (diff > 0 ? " is-up" : diff < 0 ? " is-down" : "");
    return `<div class="measure-tile">
      <span>${label}</span>
      <strong>${latestVal != null ? `${fmt(latestVal, 1)} <small>cm</small>` : "—"}</strong>
      ${measureSparkSvg(vals)}
      ${diff != null ? `<small class="measure-diff${diffCls}">${diff > 0 ? "+" : ""}${fmt(diff, 1)} cm</small>` : "<small class='measure-diff'>暂无对比</small>"}
    </div>`;
  }).join("");

  return `<section class="panel measurements-panel" aria-label="身体围度档案">
    <header class="panel-head">
      <div><h2>身体围度档案</h2><p>${measurements.length ? `已记 ${measurements.length} 次围度 · 追踪腰围/维度重塑变化` : "记录腰围、胸围、臂围、大腿围、臀围（cm），观察减脂增肌真实变化"}</p></div>
      <button type="button" class="secondary-button" data-action="add-measurement">${icon("plus", 15)} 记录围度</button>
    </header>
    ${measurements.length ? `${ratiosHtml}<div class="measure-tiles">${tiles}</div>
      <div class="measure-history-list">${measurements.slice(0, 8).map((m) => {
        const parts = measurementSpecs
          .filter(([k]) => m[k] != null)
          .map(([k, lbl]) => `${lbl} ${fmt(m[k], 1)}`);
        return `<button type="button" class="record-line measure-line" data-action="edit-measurement" data-value="${esc(m.date)}">
          <time datetime="${esc(m.date)}">${shortDate(m.date)}</time>
          <span><strong>${esc(parts.join(" · "))}</strong>${m.notes ? `<small>${esc(m.notes)}</small>` : ""}</span>
          ${icon("chevron", 15)}
        </button>`;
      }).join("")}</div>` : ""}
  </section>`;
}
function openMeasurementModal(existing = null) {
  const initialDate = existing?.date ?? today();
  open(existing ? `编辑 ${shortDate(initialDate)} 围度` : "记录身体围度", `<form id="measurement-form" class="dialog-form">
    ${field("测量日期", `<input type="date" name="date" value="${esc(initialDate)}" min="1902-01-01" max="${today()}" required ${existing ? "readonly" : ""}>`)}
    <div class="fields">${measurementSpecs.map(([k, lbl, minVal, maxVal]) =>
      field(lbl, inputGroup(k, existing?.[k] ?? "", "cm", `type="number" inputmode="decimal" step="0.1" min="${minVal}" max="${maxVal}"`))).join("")}</div>
    ${field("测量备注（可选）", input("notes", existing?.notes ?? "", 'maxlength="300" placeholder="例如：晨起空腹、冷态测量"'))}
    <p class="form-error" role="alert" hidden></p>
    <footer class="dialog-foot${existing ? " has-remove" : ""}">
      ${existing ? `<button type="button" class="danger" id="delete-measurement">删除记录</button>` : ""}
      <button type="submit" class="primary-button">保存围度</button>
    </footer>
  </form>`);
  const form = $("#measurement-form", dialog);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const vals = new FormData(form);
    const num = (key) => {
      const raw = String(vals.get(key) ?? "").trim();
      return raw === "" ? null : Number(raw);
    };
    const payload = {
      date: String(vals.get("date")),
      waistCm: num("waistCm"),
      chestCm: num("chestCm"),
      armCm: num("armCm"),
      thighCm: num("thighCm"),
      hipCm: num("hipCm"),
      notes: String(vals.get("notes") ?? "").trim(),
    };
    const btn = $('button[type="submit"]', form);
    const err = $(".form-error", form);
    btn.disabled = true;
    err.hidden = true;
    try {
      await api("/api/web/measurements", { method: "PUT", body: payload });
      dialog.close();
      state.recordsCache.weight = null;
      await loadRecords("weight", requestId);
      notify("身体围度已保存");
    } catch (problem) {
      err.textContent = problem.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  $("#delete-measurement", form)?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    if (btn.dataset.confirm !== "yes") {
      btn.dataset.confirm = "yes";
      btn.textContent = "确认删除";
      return;
    }
    btn.disabled = true;
    try {
      await api("/api/web/measurements/" + encodeURIComponent(existing.date), { method: "DELETE" });
      dialog.close();
      state.recordsCache.weight = null;
      await loadRecords("weight", requestId);
      notify("已删除围度记录");
    } catch (problem) {
      notify(problem.message);
      btn.disabled = false;
    }
  });
}

function renderWeight() {
  const records = [...state.records].sort((a, b) => b.data.date.localeCompare(a.data.date) || b.updatedAt.localeCompare(a.updatedAt));
  const todayKey = today();
  const latest = records[0]?.data;
  const todayRecorded = records.some((row) => row.id === "weight_" + todayKey);
  const since = new Date(Date.parse(todayKey) - 29 * 86400000).toISOString().slice(0, 10);
  const byDay = new Map();
  for (const { data } of records) {
    if (data.date >= since && data.date <= todayKey && !byDay.has(data.date)) byDay.set(data.date, data);
  }
  const recent = [...byDay.values()].reverse();
  const change = recent.length > 1 ? Math.round((recent.at(-1).weight - recent[0].weight) * 100) / 100 : null;
  const byMonth = new Map();
  for (const record of records.slice(0, state.shownWeights)) {
    const month = record.data.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(record);
  }
  const latestAppleWeight = [...(state.appleDailyWeightList ?? [])]
    .reverse()
    .find((row) => row.weightKg != null || row.bodyFatPct != null || row.leanBodyMassKg != null || row.waistCm != null);
  const appleWeightDate = latestAppleWeight?.weightDate || latestAppleWeight?.date || todayKey;
  const matchedDayRecord = latestAppleWeight?.weightKg != null
    ? records.find((row) => row.data.date === appleWeightDate)
    : null;
  const needsAdoptAppleWeight = latestAppleWeight?.weightKg != null && (
    !matchedDayRecord || Math.abs(matchedDayRecord.data.weight - latestAppleWeight.weightKg) >= 0.05
  );
  const appleWeightStrip = latestAppleWeight
    ? `<div class="apple-weight-sync-strip">
        <div class="apple-weight-sync-meta">
          <strong>Apple 健康体成分 (${shortDate(appleWeightDate)})</strong>
          <small>${[
            latestAppleWeight.weightKg != null ? `体重 ${fmt(latestAppleWeight.weightKg, 2)} kg` : null,
            latestAppleWeight.bodyFatPct != null ? `体脂 ${fmt(latestAppleWeight.bodyFatPct, 1)}%` : null,
            latestAppleWeight.leanBodyMassKg != null ? `瘦体重 ${fmt(latestAppleWeight.leanBodyMassKg, 1)} kg` : null,
            latestAppleWeight.waistCm != null ? `腰围 ${fmt(latestAppleWeight.waistCm, 1)} cm` : null,
          ].filter(Boolean).join(" · ")}</small>
        </div>
        ${needsAdoptAppleWeight ? `<button type="button" class="secondary-button" data-action="adopt-apple-weight">采纳 ${fmt(latestAppleWeight.weightKg, 2)} kg</button>` : `<button type="button" class="quiet" data-action="route" data-value="analytics">体成分分析 ${icon("chevron", 13)}</button>`}
      </div>`
    : "";

  content.innerHTML = heading("体重记录", "",
    `<div class="heading-actions"><button class="secondary-button" type="button" data-action="add-measurement">${icon("plus", 16)} 记围度</button><button class="primary-button" type="button" data-action="today-weight">${icon(todayRecorded ? "weight" : "plus")}${todayRecorded ? "更新今日体重" : "记体重"}</button></div>`) +
    (latest ? `<div class="weight-layout">
      <section class="panel weight-summary"><header class="panel-head"><div><h2>最近一次称重</h2><p><time datetime="${latest.date}">${latest.date}</time></p></div><span class="status-pill">最新</span></header>
        <div class="weight-number"><strong>${matrix(fmt(latest.weight, 1))}</strong><span>kg</span></div>
        <dl class="weight-facts"><div><dt>近 30 天变化</dt><dd>${change === null ? "—" : (change > 0 ? "+" : "") + fmt(change, 2) + " kg"}</dd></div>
          ${state.weightGoal ? `<div><dt>目标体重</dt><dd>${fmt(state.weightGoal, 2)} kg</dd></div>` : ""}
          ${latest.bodyFat != null ? `<div><dt>体脂率</dt><dd>${fmt(latest.bodyFat)}%</dd></div>` : ""}</dl>
        ${appleWeightStrip}
      </section>
      <section class="panel weight-trend"><div class="chart-wrap"><header class="panel-head"><div><h2>近 30 天趋势</h2><p>${shortDate(since)} – ${shortDate(todayKey)} · ${recent.length} 天有称重</p></div><span class="chart-readout" data-chart-readout></span></header>
        ${recent.length ? (() => {
          let left = 0, winSum = 0;
          const recentWithAvg = recent.map((row, idx) => {
            winSum += row.weight;
            const winStart = shiftDateStr(row.date, -6);
            while (left <= idx && recent[left].date < winStart) winSum -= recent[left++].weight;
            return { ...row, average: Math.round((winSum / (idx - left + 1)) * 100) / 100 };
          });
          return weightChart(recentWithAvg, { from: since, to: todayKey, goal: state.weightGoal, showAverage: recentWithAvg.length >= 2 });
        })() : '<p class="weight-chart-empty muted">最近 30 天暂无称重记录。</p>'}</div>
        ${recent.length && (recent.length >= 2 || state.weightGoal) ? `<footer class="panel-foot">${[recent.length >= 2 ? "虚线 7 日滚动均值" : null, state.weightGoal ? "灰虚线为目标体重" : null].filter(Boolean).join(" · ")}</footer>` : ""}
      </section>
      <section class="weight-history" aria-label="称重历史"><h2>称重历史</h2>
        ${[...byMonth].map(([month, rows]) => `<section class="weight-month"><header class="weight-month-head"><h3>${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月</h3><span>${rows.length} 条</span></header>
          <div class="weight-log">${rows.map(({ id, data }) => `<div class="swipe-row" data-swipe-kind="weight" data-record-id="${esc(id)}">
            <div class="swipe-bg is-del-hint" aria-hidden="true"><span>删除记录</span>${icon("close", 15)}</div>
            <button type="button" class="record-line weight-line" data-action="edit-record" data-kind="weight" data-value="${esc(id)}">
              <time datetime="${data.date}">${shortDate(data.date)} <small>${displayWeekday(data.date)}</small></time>
              <strong>${fmt(data.weight, 2)} <span>kg</span></strong>
              ${data.bodyFat == null ? "<span></span>" : `<span>体脂 ${fmt(data.bodyFat)}%</span>`}${icon("chevron", 15)}</button>
          </div>`).join("")}</div></section>`).join("")}
        ${records.length > state.shownWeights ? '<button class="secondary-button" type="button" data-action="more-weights">查看更多记录</button>' : ""}
      </section></div>${renderMeasurementsSection(state.measurements)}` : `${appleWeightStrip}${renderMeasurementsSection(state.measurements)}${empty("还没有体重记录", "添加一次称重，即可开始查看变化。")}`);
}
function monthDays(month) {
  const first = month + "-01";
  const beginning = (new Date(first + "T00:00Z").getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  return { beginning, days };
}
async function loadCalendar(version) {
  const month = state.month;
  const key = `${month}|${state.date}`;
  const cached = state.calendarCache;
  if (calendarUi && cached && cached.epoch === dataEpoch && cached.month === month) {
    state.records = cached.records;
    state.calendarWeights = cached.weights;
    state.calendarNutritionDays = cached.nutritionDays;
    state.calendarDaily = cached.daily;
    state.calendarGoals = cached.goals;
    state.calendarCatalogue = cached.catalogue;
    state.appleEntries = cached.appleEntries;
    state.calendarSchedule = cached.schedule;
    if (cached.key === key) {
      state.calendarDetail = cached.detail;
      renderCalendar();
      return;
    }
    state.calendarDetail = state.date >= today()
      ? await api("/api/web/schedule/" + encodeURIComponent(state.date)).catch(() => null)
      : null;
    if (version !== requestId || state.view !== "calendar") return;
    cached.key = key;
    cached.detail = state.calendarDetail;
    renderCalendar();
    return;
  }
  if (!calendarUi || cached?.month !== month) content.innerHTML = loadingMarkup();
  const fetchEpoch = dataEpoch;
  const { days } = monthDays(month);
  const from = month + "-01";
  const monthEnd = month + "-" + String(days).padStart(2, "0");
  const todayKey = today();
  const appleThrough = monthEnd > todayKey ? todayKey : monthEnd;
  const [workout, diet, weight, nutritionDay, profileRes, activities, dailyRows, schedule, detail, { resolveCatalogueMap }] = await Promise.all([
    api("/api/records/workout"),
    api("/api/records/diet"),
    api("/api/records/weight").catch(() => []),
    api("/api/records/nutritionDay").catch(() => []),
    api("/api/web/profile").catch(() => null),
    from <= todayKey ? appleRange(from, appleThrough).catch(() => []) : Promise.resolve([]),
    from <= todayKey ? appleDailyRange(from, appleThrough).catch(() => []) : Promise.resolve([]),
    api("/api/web/schedule?" + new URLSearchParams({ from, through: monthEnd })).catch(() => null),
    state.date >= todayKey ? api("/api/web/schedule/" + encodeURIComponent(state.date)).catch(() => null) : Promise.resolve(null),
    loadPlanUi(),
    loadCalendarUi(),
  ]);
  const cleanWorkouts = workout.filter((row) => row.data.status !== "cancelled");
  const exIds = cleanWorkouts.filter((row) => row.data.date.slice(0, 7) === month)
    .flatMap((row) => row.data.exercises?.map((ex) => ex.exerciseId) ?? []);
  const catMap = await resolveCatalogueMap(api, exIds, state.calendarCatalogue);
  if (version !== requestId) return;
  state.records = [...cleanWorkouts, ...diet, ...weight];
  state.calendarWeights = weight;
  state.calendarNutritionDays = nutritionDay;
  state.calendarDaily = new Map((dailyRows ?? []).map((row) => [row.date, row]));
  state.calendarGoals = profileRes?.profile ?? null;
  state.calendarCatalogue = catMap;
  state.appleEntries = activities;
  state.calendarSchedule = schedule;
  state.calendarDetail = detail;
  state.calendarCache = {
    epoch: fetchEpoch,
    month,
    key: `${month}|${state.date}`,
    records: state.records,
    weights: weight,
    nutritionDays: nutritionDay,
    daily: state.calendarDaily,
    goals: state.calendarGoals,
    catalogue: catMap,
    appleEntries: activities,
    schedule,
    detail,
  };
  renderCalendar();
}
function calendarContextForDate(targetDate) {
  const todayKey = today();
  const workouts = state.records.filter((row) => row.kind === "workout" && row.data.date === targetDate);
  const diets = state.records.filter((row) => row.kind === "diet" && row.data.date === targetDate);
  const appleEntries = state.appleEntries.filter((row) => !row.manualWorkoutId && row.date === targetDate);
  const weightRecord = state.calendarWeights.find((row) => !row.deleted && row.data.date === targetDate) ?? null;
  const nutritionComplete = state.calendarNutritionDays.some((row) => !row.deleted && row.data?.complete && row.data.date === targetDate);
  const schedByDate = new Map((state.calendarSchedule?.days ?? []).map((item) => [item.date, item]));
  return {
    date: targetDate,
    todayKey,
    workouts,
    appleEntries,
    appleDaily: state.calendarDaily.get(targetDate) ?? null,
    appleHealthConnected: state.appleHealthConnected,
    diets,
    weightRecord,
    nutritionComplete,
    goals: state.calendarGoals,
    daySched: state.calendarDetail?.date === targetDate ? state.calendarDetail : null,
    schedSummary: schedByDate.get(targetDate),
    catalogueMap: state.calendarCatalogue,
  };
}
function shiftDateStr(base, delta) {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(delta));
  return d.toISOString().slice(0, 10);
}
function updateCalendarSelection(targetDate) {
  const grid = $(".calendar-grid", content);
  const detailPanel = $(".calendar-detail", content);
  if (!calendarUi || !grid || !detailPanel) { renderCalendar(); return; }
  $$('.cal-cell[aria-pressed="true"]', grid).forEach((el) => {
    if (el.dataset.value !== targetDate) el.setAttribute("aria-pressed", "false");
  });
  const nextCell = $$('.cal-cell[data-action="calendar-date"]', grid).find((el) => el.dataset.value === targetDate);
  if (nextCell) nextCell.setAttribute("aria-pressed", "true");
  const todayBtn = $('[data-action="calendar-today"]', content);
  if (todayBtn) todayBtn.disabled = targetDate === today();
  const dossierHtml = calendarUi.renderDayDossier(calendarContextForDate(targetDate));
  detailPanel.outerHTML = calendarUi.renderCalendarDetailPanel({ date: targetDate, todayKey: today(), dossierHtml });
}
async function stepCalendarDossier(newDate) {
  state.date = newDate;
  const targetMonth = newDate.slice(0, 7);
  const monthChanged = state.month !== targetMonth;
  if (monthChanged) {
    state.month = targetMonth;
    await loadCalendar(++requestId);
  }
  openCalendarDayModal(newDate);
  if (state.view === "calendar" && !monthChanged) updateCalendarSelection(newDate);
}
function openCalendarDayModal(targetDate) {
  if (!calendarUi) return;
  state.date = targetDate;
  const body = calendarUi.renderDayDossier({ ...calendarContextForDate(targetDate), inModal: true });
  open(`${shortDate(targetDate)} · ${formatWeekdayZh(targetDate)}`, body, true, "report");
  const dossier = $(".cal-dossier.in-modal", dialog);
  if (dossier) {
    let startX = 0, startY = 0;
    dossier.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        if (e.touches[0].clientX < 20) { startX = -1; return; }
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
    }, { passive: true });
    dossier.addEventListener("touchend", (e) => {
      if (startX < 0) return;
      if (e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          const delta = dx < 0 ? 1 : -1;
          stepCalendarDossier(shiftDateStr(targetDate, delta));
        }
      }
    }, { passive: true });
  }
}
function renderCalendar() {
  if (!calendarUi) return;
  const { month, calendar, date } = state;
  const { beginning, days } = monthDays(month);
  const todayKey = today();
  const maxMonth = new Date(Date.parse(todayKey + "T00:00:00Z") + 365 * 86400000).toISOString().slice(0, 7);
  const workouts = state.records.filter((row) => row.kind === "workout");
  const diets = state.records.filter((row) => row.kind === "diet");
  const schedByDate = new Map((state.calendarSchedule?.days ?? []).map((item) => [item.date, item]));
  content.innerHTML = calendarUi.renderCalendarView({
    month,
    beginning,
    days,
    date,
    todayKey,
    maxMonth,
    lens: ["all", "training", "diet"].includes(calendar) ? calendar : "all",
    workouts,
    diets,
    weights: state.calendarWeights,
    nutritionDays: state.calendarNutritionDays,
    appleEntries: state.appleEntries,
    appleDailyMap: state.calendarDaily,
    appleHealthConnected: state.appleHealthConnected,
    schedByDate,
    daySched: state.calendarDetail,
    goals: state.calendarGoals,
    catalogueMap: state.calendarCatalogue,
    segmentsHtml: segments({ all: "全天双显", training: "训练", diet: "热量" }, ["all", "training", "diet"].includes(calendar) ? calendar : "all", "calendar-mode"),
  });
}
function renderExerciseTile(exercise, favIds) {
  const isFav = favIds.has(exercise.id);
  const prSummary = exercise.sessionsCount
    ? (exercise.mode === "timed"
      ? (exercise.bestHold != null ? `最佳 ${exercise.bestHold}s` : "")
      : exercise.mode === "assisted"
        ? (exercise.bestAssistance != null ? `最低辅助 ${fmt(exercise.bestAssistance)}kg` : "")
        : (exercise.bestWeight != null ? `最佳 ${fmt(exercise.bestWeight)}kg${exercise.best1rm ? ` · 1RM ${fmt(exercise.best1rm)}kg` : ""}` : ""))
    : "";
  return `<div class="exercise-card-shell${isFav ? " is-fav" : ""}">
    <button class="exercise-tile" type="button" data-action="exercise-detail" data-value="${esc(exercise.id)}">
      <span class="exercise-art">${exercise.thumbnail?.startsWith("/media/exercises/") ? `<img src="${esc(exercise.thumbnail)}" width="96" height="84" loading="lazy" decoding="async" alt="">` : icon("workout", 27)}${exercise.custom ? '<em class="tile-custom-tag">自定义</em>' : ""}</span>
      <span class="exercise-tile-copy"><strong>${esc(exercise.name)}</strong><small>${esc(muscles[exercise.muscle] ?? exercise.muscle)} · ${esc(equipment[exercise.equipment] ?? exercise.equipment)}</small></span>
      ${exercise.sessionsCount ? `<span class="exercise-tile-pr">${prSummary ? `<b>${esc(prSummary)}</b>` : ""}<small>${exercise.sessionsCount} 场 · ${shortDate(exercise.lastDate)}</small></span>` : ""}
    </button>
    ${state.userId ? `<button type="button" class="exercise-fav-btn${isFav ? " is-active" : ""}" data-action="toggle-favorite" data-value="${esc(exercise.id)}" aria-label="${isFav ? "取消收藏" : "收藏动作"}" aria-pressed="${isFav}">${icon(isFav ? "starFilled" : "star", 15)}</button>` : ""}
  </div>`;
}
function matchesExerciseLocal(ex, q, muscle, equip, mineSet = null) {
  if (muscle && ex.muscle !== muscle) return false;
  if (equip === "__mine__") {
    if (mineSet && mineSet.size && !mineSet.has(ex.equipment)) return false;
  } else if (equip && ex.equipment !== equip) {
    return false;
  }
  if (!q) return true;
  const needle = q.toLowerCase();
  return [ex.name, ex.englishName, ...(ex.aliases ?? [])].some((t) => String(t ?? "").toLowerCase().includes(needle));
}
async function getUserEquipSet() {
  if (Array.isArray(state.userEquipment)) return new Set(state.userEquipment);
  if (Array.isArray(state.data?.goals?.equipment)) return new Set(state.data.goals.equipment);
  if (!state.userId) return new Set();
  const res = await api("/api/web/profile").catch(() => null);
  const list = res?.profile?.equipment ?? ["barbell", "dumbbell", "machine"];
  state.userEquipment = list;
  return new Set(list);
}
async function catalogueSearch(append = false) {
  if (append && !state.nextCursor) return;
  const seq = ++requestId;
  const results = $("#exercise-results");
  if (!results) return;
  results.setAttribute("aria-busy", "true");
  $(".catalogue-status").textContent = append ? "正在加载更多…" : "正在查找动作…";
  try {
    await ensureLibraryCaches();
    const mineSet = state.catalogueEquipment === "__mine__" ? await getUserEquipSet() : null;
    if (seq !== requestId || state.view !== "exercises") return;
    const favIds = new Set(state.favorites.filter((r) => !r.deleted).map((r) => r.data?.exerciseId).filter(Boolean));
    const customList = state.customExercises.filter((r) => !r.deleted).map((r) => r.data);
    const customIds = new Set(customList.map((ex) => ex.id));

    if (state.catalogueScope === "trained") {
      state.nextCursor = null;
      if (!state.trainedExercisesCache || state.trainedExercisesCache.epoch !== dataEpoch) {
        const trainedReply = await api("/api/web/trained-exercises");
        state.trainedExercisesCache = { epoch: dataEpoch, items: trainedReply.items ?? [] };
      }
      if (seq !== requestId || state.view !== "exercises") return;
      const metricScore = (ex) => (ex.mode === "timed" ? (ex.bestHold ?? 0) : (ex.best1rm ?? ex.bestWeight ?? 0));
      let items = (state.trainedExercisesCache.items ?? [])
        .filter((ex) => matchesExerciseLocal(ex, state.query, state.catalogueMuscle, state.catalogueEquipment, mineSet));
      if (state.trainedSort === "1rm") {
        items = [...items].sort((a, b) => (metricScore(b) - metricScore(a)) || (b.sessionsCount - a.sessionsCount));
      } else if (state.trainedSort === "sessions") {
        items = [...items].sort((a, b) => (b.sessionsCount - a.sessionsCount) || (b.totalWorkSets - a.totalWorkSets));
      } else {
        items = [...items].sort((a, b) =>
          (b.lastDate < a.lastDate ? -1 : b.lastDate > a.lastDate ? 1 : 0) || (b.sessionsCount - a.sessionsCount));
      }
      if (state.query) items = prioritizeExact(items, state.query);

      const lookupIds = items.filter((ex) => !ex.custom && !ex.thumbnail).slice(0, 100).map((ex) => ex.id);
      if (lookupIds.length) {
        const { items: catItems = [] } = await api("/api/catalogue/exercises/lookup", {
          method: "POST", body: { ids: lookupIds }, token: "",
        }).catch(() => ({ items: [] }));
        if (seq !== requestId || state.view !== "exercises") return;
        const thumbMap = new Map(catItems.map((c) => [c.id, c.thumbnail]));
        items = items.map((ex) => thumbMap.has(ex.id) ? { ...ex, thumbnail: thumbMap.get(ex.id) } : ex);
      }

      state.catalogue = items;
      state.catalogueTotal = items.length;
      $(".catalogue-status").textContent = `已练过 ${fmt(items.length)} 个动作`;
      const sortBar = `<div class="muscle-pills trained-sort-bar" role="group" aria-label="排序方式">${
        Object.entries({ recent: "最近练过", "1rm": "最高 1RM / PR", sessions: "场次最多" }).map(([val, lbl]) =>
          `<button type="button" data-action="trained-sort" data-value="${val}" aria-pressed="${state.trainedSort === val}">${lbl}</button>`).join("")
      }</div>`;
      const tiles = items.map((ex) => renderExerciseTile(ex, favIds)).join("");
      results.innerHTML = tiles
        ? `${sortBar}<div class="tile-grid">${tiles}</div><footer class="catalogue-foot"></footer>`
        : `${sortBar}${empty("暂无匹配的已练动作", "记录并完成几次训练后，所有已练动作的个人 PR 都会自动汇集于此。")}`;
      return;
    }

    if (state.catalogueScope === "favorites" || state.catalogueScope === "custom") {
      state.nextCursor = null;
      let items = [];
      if (state.catalogueScope === "custom") {
        items = customList.filter((ex) => matchesExerciseLocal(ex, state.query, state.catalogueMuscle, state.catalogueEquipment, mineSet));
      } else {
        const customFavs = customList.filter((ex) => favIds.has(ex.id) && matchesExerciseLocal(ex, state.query, state.catalogueMuscle, state.catalogueEquipment, mineSet));
        const builtinFavIds = [...favIds].filter((id) => !customIds.has(id)).slice(0, 100);
        let builtinFavs = [];
        if (builtinFavIds.length) {
          const { items: loaded = [] } = await api("/api/catalogue/exercises/details", { method: "POST", body: { ids: builtinFavIds }, token: "" });
          builtinFavs = loaded
            .filter((ex) => matchesExerciseLocal(ex, state.query, state.catalogueMuscle, state.catalogueEquipment, mineSet))
            .map((ex) => ({ ...ex, thumbnail: ex.illustration?.frames?.[0]?.path }));
        }
        items = [...customFavs, ...builtinFavs];
      }
      if (seq !== requestId || state.view !== "exercises") return;
      state.catalogue = prioritizeExact(items, state.query);
      state.catalogueTotal = state.catalogue.length;
      $(".catalogue-status").textContent = state.catalogueScope === "favorites"
        ? `已收藏 ${fmt(state.catalogue.length)} 个动作`
        : `自定义 ${fmt(state.catalogue.length)} 个动作`;
      const tiles = state.catalogue.map((ex) => renderExerciseTile(ex, favIds)).join("");
      results.innerHTML = tiles ? `<div class="tile-grid">${tiles}</div><footer class="catalogue-foot"></footer>`
        : empty(state.catalogueScope === "favorites" ? "还没有符合筛选的收藏动作" : "还没有自定义动作",
            state.catalogueScope === "favorites" ? "点击任意动作卡片右上角星标即可快速收藏。" : "点击右上角「自定义动作」录入专属器械或训练动作。",
            state.catalogueScope === "custom" ? '<button type="button" class="secondary-button" data-action="create-exercise">新建自定义动作</button>' : "");
      return;
    }

    const query = new URLSearchParams({ q: state.query, limit: state.catalogueEquipment === "__mine__" ? "100" : "24" });
    if (state.catalogueMuscle) query.set("muscle", state.catalogueMuscle);
    if (state.catalogueEquipment && state.catalogueEquipment !== "__mine__") query.set("equipment", state.catalogueEquipment);
    if (append) query.set("cursor", state.nextCursor);
    else state.nextCursor = null;

    const data = await api("/api/catalogue/exercises?" + query, { token: "" });
    if (seq !== requestId || state.view !== "exercises") return;
    const equipMatch = (ex) => !mineSet || !mineSet.size || mineSet.has(ex.equipment);
    const filteredApiItems = data.items.filter(equipMatch);
    const customMatches = append ? [] : customList.filter((ex) => matchesExerciseLocal(ex, state.query, state.catalogueMuscle, state.catalogueEquipment, mineSet));
    const combinedFresh = [...customMatches, ...filteredApiItems.filter((ex) => !customIds.has(ex.id))];
    state.catalogue = append ? [...state.catalogue, ...filteredApiItems] : prioritizeExact(combinedFresh, state.query);
    state.catalogueTotal = state.catalogueEquipment === "__mine__" ? state.catalogue.length : (data.total + customMatches.length);
    state.nextCursor = data.nextCursor;
    $(".catalogue-status").textContent = state.catalogueEquipment === "__mine__"
      ? `匹配我的器械 ${fmt(state.catalogue.length)} 个动作${state.nextCursor ? "（可继续加载）" : ""}`
      : `已显示 ${fmt(state.catalogue.length)} / ${fmt(state.catalogueTotal)} 个动作`;
    const tiles = (append ? filteredApiItems : state.catalogue).map((ex) => renderExerciseTile(ex, favIds)).join("");
    if (append) {
      let grid = $(".tile-grid", results);
      if (!grid && tiles) {
        results.innerHTML = '<div class="tile-grid"></div><footer class="catalogue-foot"></footer>';
        grid = $(".tile-grid", results);
      }
      if (grid && tiles) grid.insertAdjacentHTML("beforeend", tiles);
    } else {
      results.innerHTML = tiles || state.nextCursor
        ? `${tiles ? `<div class="tile-grid">${tiles}</div>` : '<p class="muted">当前页暂无符合我的器械的动作，可继续加载下一页。</p>'}<footer class="catalogue-foot"></footer>`
        : empty("没有找到匹配的动作", "试试简称、英文名，或新建自定义动作。", state.userId ? '<button type="button" class="secondary-button" data-action="create-exercise">新建自定义动作</button>' : "");
    }
    const footer = $(".catalogue-foot", results);
    const remaining = Math.max(0, state.catalogueTotal - state.catalogue.length);
    if (footer) footer.innerHTML = state.nextCursor ? `<button type="button" class="secondary-button" data-action="more-catalogue">加载更多${remaining ? ` · 还有 ${fmt(remaining)} 个` : ""}</button>` : "";
    if (append && filteredApiItems.length) $$(".exercise-tile", results).at(-filteredApiItems.length)?.focus({ preventScroll: true });
  } catch (problem) {
    if (seq !== requestId) return;
    $(".catalogue-status").textContent = problem.message;
    if (append) {
      if (problem.status === 409) return await catalogueSearch();
      const button = $('[data-action="more-catalogue"]', results);
      if (button) button.disabled = false;
    } else {
      results.innerHTML = empty("暂时无法加载动作", "", '<button type="button" class="secondary-button" data-action="retry-catalogue">重试</button>');
    }
  } finally {
    if (seq === requestId) results.removeAttribute("aria-busy");
  }
}
function buildExDetailSparkline(sessions, timed) {
  const pts = sessions
    .slice()
    .reverse()
    .map((s) => ({
      date: s.date,
      value: timed ? s.bestSeconds : (s.estimated1rm ?? s.topWeight),
    }))
    .filter((p) => p.value != null && p.value > 0);
  if (pts.length < 2) return "";
  const w = 280;
  const h = 62;
  const pad = 8;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(0.5, max - min);
  const coords = pts.map((p, i) => {
    const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p.value - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const firstDate = shortDate(pts[0].date);
  const lastDate = shortDate(pts.at(-1).date);
  const unit = timed ? "秒" : "kg";
  return `<div class="ex-detail-chart">
    <div class="ex-chart-head"><span>${timed ? "最长保持趋势" : "估算 1RM 走势"}</span><small>${fmt(min)} → ${fmt(max)} ${unit}</small></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${timed ? "时长走势图" : "估算1RM走势图"}">
      <polyline fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${coords.join(" ")}"/>
      ${coords.map((pt) => {
        const [cx, cy] = pt.split(",");
        return `<circle cx="${cx}" cy="${cy}" r="2.8" fill="currentColor"/>`;
      }).join("")}
    </svg>
    <div class="ex-chart-foot"><small>${firstDate}</small><small>${lastDate}</small></div>
  </div>`;
}
async function exerciseDetail(id) {
  const version = requestId;
  const originView = state.view;
  await ensureLibraryCaches();
  const customRec = state.customExercises.find((r) => !r.deleted && r.id === id);
  const [exRes, hist] = await Promise.all([
    customRec ? Promise.resolve({ exercise: customRec.data }) : api("/api/catalogue/exercises/" + encodeURIComponent(id), { token: "" }),
    state.userId ? api("/api/web/exercise-history/" + encodeURIComponent(id)).catch(() => null) : Promise.resolve(null),
  ]);
  const exercise = exRes.exercise;
  if (state.view !== originView || version !== requestId) return;
  const isFav = state.favorites.some((r) => !r.deleted && r.data?.exerciseId === exercise.id);
  const illustration = exercise.illustration;
  const frames = illustration?.frames.filter((frame) => frame.path.startsWith("/media/exercises/")) ?? [];
  const gifPath = illustration?.gifPath?.startsWith("/media/exercises/") ? illustration.gifPath : "";
  const tags = [muscles[exercise.muscle] ?? exercise.muscle, equipment[exercise.equipment] ?? exercise.equipment, exercise.custom ? "自定义动作" : ""].filter(Boolean);
  const safeURL = (value) => typeof value === "string" && value.startsWith("https://") ? esc(value) : "#";
  const timed = exercise.mode === "timed";
  const sessions = hist?.sessions ?? [];
  const totalWorkSets = sessions.reduce((s, r) => s + (r.workSets ?? 0), 0);
  const bestWeight = sessions.reduce((m, r) => (r.topWeight != null && r.topWeight > m ? r.topWeight : m), 0);
  const best1rm = sessions.reduce((m, r) => (r.estimated1rm != null && r.estimated1rm > m ? r.estimated1rm : m), 0);
  const bestHold = sessions.reduce((m, r) => (r.bestSeconds != null && r.bestSeconds > m ? r.bestSeconds : m), 0);
  const dossierHtml = state.userId ? `<section class="ex-detail-dossier" aria-label="个人训练档案">
    <h3>个人训练档案</h3>
    <div class="ex-detail-kpis">
      ${timed
        ? `<div><span>最佳时长</span><strong>${bestHold > 0 ? `${bestHold} <small>秒</small>` : "—"}</strong></div>`
        : `<div><span>历史最佳</span><strong>${bestWeight > 0 ? `${fmt(bestWeight)} <small>kg</small>` : "—"}</strong></div>
           <div><span>估算 1RM</span><strong>${best1rm > 0 ? `${fmt(best1rm)} <small>kg</small>` : "—"}</strong></div>`}
      <div><span>近期场次</span><strong>${sessions.length} <small>场</small></strong></div>
      <div><span>累计工作组</span><strong>${totalWorkSets} <small>组</small></strong></div>
    </div>
    ${buildExDetailSparkline(sessions, timed)}
    <div class="ex-detail-note">
      <input type="text" id="ex-detail-note-input" maxlength="500" value="${esc(hist?.note ?? "")}" placeholder="记下座椅档位、握距或发力要点…" aria-label="动作个人备忘">
      <button type="button" class="secondary-button" id="ex-detail-save-note">保存备忘</button>
    </div>
    ${sessions.length ? `<ul class="ex-detail-history">${sessions.slice(0, 6).map((s) => `<li>
      <div class="ex-hist-head"><b>${esc(shortDate(s.date))}</b><span>${esc(s.title)}</span><small>${timed ? (s.bestSeconds ? `最佳 ${s.bestSeconds} 秒` : "") : (s.topWeight != null ? `${fmt(s.topWeight)}kg × ${s.topReps ?? 0}` : "")}${!timed && s.estimated1rm ? ` · 1RM ${fmt(s.estimated1rm)}` : ""}</small></div>
      <div class="ex-hist-sets">${s.sets.slice(0, 6).map((st) => `<span>${timed ? `${st.seconds}s` : `${fmt(st.weight)}×${st.reps}`}</span>`).join("")}</div>
    </li>`).join("")}</ul>` : '<p class="muted">暂无该动作的历史记录，点击上方「以此动作开始训练」立即建立记录。</p>'}
  </section>` : "";
  open(exercise.name, `<div class="exercise-detail">
   <div class="exercise-meta"><p>${esc(exercise.englishName || "自定义器械或训练动作")}</p><div>${tags.map((tag) => `<span>${esc(tag)}</span>`).join("")}</div></div>
   ${state.userId ? `<div class="exercise-detail-actions">
     <button type="button" class="primary-button" data-action="quick-start-exercise" data-value="${esc(exercise.id)}">${icon("workout", 15)} 以此动作开始训练</button>
     <button type="button" class="secondary-button${isFav ? " is-faved" : ""}" data-action="toggle-favorite-modal" data-value="${esc(exercise.id)}">${icon(isFav ? "starFilled" : "star", 15)} ${isFav ? "已收藏" : "收藏动作"}</button>
     ${customRec ? `<button type="button" class="secondary-button" data-action="edit-custom-exercise" data-value="${esc(exercise.id)}">编辑自定义动作</button>` : ""}
   </div>` : ""}
   ${dossierHtml}
   ${exercise.description ? `<p class="exercise-summary">${esc(exercise.description)}</p>` : ""}
   <div class="exercise-guide${frames.length ? " with-poses" : ""}">
   ${frames.length ? `<section class="exercise-poses"><h3>姿势示意</h3>${gifPath ? `<figure class="pose-anim-hero"><img src="${esc(gifPath)}" width="160" height="160" alt="${esc(exercise.name)} 动作示范动图"><figcaption><span>GIF</span>动态示范</figcaption></figure>` : ""}<div class="pose-grid">${frames.map((frame, index) =>
     `<figure><img src="${esc(frame.path)}" alt="${esc(frame.caption)}"><figcaption><span>${String(index + 1).padStart(2, "0")}</span>${esc(frame.caption)}</figcaption></figure>`).join("")}</div>
     <details class="credit"><summary>图片来源与许可</summary><p>${esc(illustration.author)} · <a href="${safeURL(illustration.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(illustration.license)}</a>
      · <a href="${safeURL(illustration.sourceUrl)}" target="_blank" rel="noopener noreferrer">素材来源</a></p></details></section>` : ""}
   <section class="exercise-instructions"><h3>动作步骤</h3>
   ${exercise.instructions.length ? `<ol>${exercise.instructions.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>` : '<p class="muted">暂无步骤说明。</p>'}
   ${exercise.mistakes?.length ? `<details class="exercise-notes"><summary>常见问题</summary><ul>${exercise.mistakes.map((step) => `<li>${esc(step)}</li>`).join("")}</ul></details>` : ""}
   </section></div></div>`, true, "exercise");
  $("#ex-detail-save-note", dialog)?.addEventListener("click", async () => {
    const noteInput = $("#ex-detail-note-input", dialog);
    const saveBtn = $("#ex-detail-save-note", dialog);
    if (!noteInput || !saveBtn) return;
    saveBtn.disabled = true;
    try {
      await api("/api/web/exercise-notes/" + encodeURIComponent(exercise.id), {
        method: "PUT",
        body: { note: noteInput.value },
      });
      notify("动作备忘已保存");
    } catch (problem) {
      notify(problem.message);
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function renderPlan({ active, templates, drafts, me, current, schedule, map, renderScheduleHorizon, starterPlans = [] }) {
  const activePlan = active?.data;
  const activeRoutines = activePlan?.routines ?? [];
  const saved = templates.map((record) => record.data);
  const unapplied = drafts.filter((record) => !active?.history.some((entry) => entry.id === record.id && entry.version === record.version))
    .filter((record) => record.id !== active?.id || record.version !== active?.version).reverse();
  state.plan = active;
  state.schedule = schedule;
  state.routines = [...activeRoutines.map((routine) => ({ id: routine.id, source: "plan" })), ...saved.map((routine) => ({ id: routine.id, source: "template" }))];
  const next = current?.planned;
  const routineMuscleSummary = (routine) => {
    const tracked = new Set(["chest", "back", "legs", "shoulders", "arms", "core"]);
    const mMap = new Map();
    for (const row of routine.exercises ?? []) {
      const ex = map.get(row.exerciseId);
      if (!ex) continue;
      if (tracked.has(ex.muscle)) mMap.set(ex.muscle, (mMap.get(ex.muscle) ?? 0) + (row.sets || 0));
      for (const sec of ex.secondaryMuscles ?? []) {
        if (sec !== ex.muscle && tracked.has(sec)) mMap.set(sec, (mMap.get(sec) ?? 0) + (row.sets || 0) * 0.5);
      }
    }
    return [...mMap.entries()]
      .map(([k, v]) => [k, Math.round(v * 10) / 10])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
  };
  const routineCards = (items, activeRows) => items.map((entry, index) => {
    const routine = activeRows ? entry : entry.data;
    const checkedIn = activeRows && current?.applePlan?.routineId === routine.id;
    const isNext = activeRows && next?.id === routine.id;
    const mChips = routineMuscleSummary(routine);
    return `<section class="panel routine routine-card${checkedIn ? " is-done" : isNext ? " is-next" : ""}">
    <header class="panel-head"><div><h3>${esc(routine.name)}</h3>
    ${checkedIn ? '<span class="apple-status">Apple 健康已完成</span>' : isNext ? '<span class="plan-next-tag">下次安排</span>' : activeRows && activePlan.schedule === "weekdays" ? `<p>星期${"一二三四五六日"[activePlan.weekdays[index] - 1]}</p>` : ""}</div>
    <div class="routine-head-actions">
      <button class="secondary-button" type="button" data-action="start-routine" data-value="${activeRows ? index : activeRoutines.length + index}" aria-label="预览训练 ${esc(routine.name)}">预览训练</button>
      ${!activeRows ? `<button class="quiet" type="button" data-action="edit-workout-template" data-value="${esc(entry.id)}" aria-label="编辑模板 ${esc(routine.name)}">编辑</button><button class="quiet icon-button" type="button" data-action="delete-workout-template" data-value="${esc(entry.id)}" aria-label="删除模板">${icon("close", 15)}</button>` : ""}
    </div></header>
    ${mChips.length ? `<div class="routine-muscles" aria-label="本训练日肌群有效组数">${mChips.map(([k, v]) => `<span>${esc(muscles[k] ?? k)} <b>${fmt(v)}</b> 组</span>`).join("")}</div>` : ""}
    <details><summary>${routine.exercises.length} 个动作 ${icon("chevron", 14)}</summary>
      <ol>${(() => {
        const ssBadges = supersetBadges(routine.exercises);
        return routine.exercises.map((row, exIdx) => {
          const progTxt = progressionShortLabel(row);
          const backupName = row.backupExerciseId ? (map.get(row.backupExerciseId)?.name ?? row.backupExerciseId) : "";
          const ssTag = ssBadges[exIdx];
          return `<li><span>${ssTag ? `<span class="superset-pill">超级组 ${esc(ssTag)}</span> ` : ""}<b>${esc(map.get(row.exerciseId)?.name ?? row.exerciseId)}</b>${progTxt ? `<small class="routine-prog-meta">${esc(progTxt)}${backupName ? ` · 备选 ${esc(backupName)}` : ""}</small>` : ""}</span><span>${row.sets} 组 × ${row.seconds ? row.seconds + " 秒" : row.repsMin + "–" + row.repsMax + " 次"}${row.weight ? " · " + fmt(row.weight) + " kg" : ""}</span></li>`;
        }).join("");
      })()}</ol></details>
    </section>`;
  }).join("");
  const starterCards = starterPlans.map((preset) => {
    const names = preset.exerciseNames ?? {};
    const equipChips = (preset.equipmentTags ?? []).map((eq) => `<span>${esc(equipment[eq] ?? eq)}</span>`).join("");
    const muscleChips = (preset.weeklyMuscleSets ?? []).map((m) => `<span>${esc(m.name)} <b>${fmt(m.sets)}</b> 组</span>`).join("");
    return `<section class="panel starter-card">
      <header class="starter-card-head">
        <div class="starter-card-meta"><span class="starter-tag">${esc(preset.tag)}</span><small>${esc(preset.level)} · 每周 ${preset.daysPerWeek} 练 · ${preset.plan.weeks} 周</small></div>
        <h3>${esc(preset.plan.name)}</h3>
        <p class="muted">${esc(preset.summary)}</p>
      </header>
      ${equipChips ? `<div class="starter-equip-row">${equipChips}</div>` : ""}
      ${muscleChips ? `<div class="starter-muscles" aria-label="每周肌群有效组数">${muscleChips}</div>` : ""}
      <details><summary>${preset.plan.routines.length} 个训练日明细 ${icon("chevron", 14)}</summary>
        <div class="starter-routines">${preset.plan.routines.map((rt) => `<div class="starter-routine-block">
          <strong>${esc(rt.name)}</strong>
          <ol>${rt.exercises.map((row) => `<li><span>${esc(names[row.exerciseId] ?? map.get(row.exerciseId)?.name ?? row.exerciseId)}</span><span>${row.sets} 组 × ${row.seconds ? row.seconds + " 秒" : row.repsMin + "–" + row.repsMax + " 次"}</span></li>`).join("")}</ol>
        </div>`).join("")}</div>
      </details>
      <footer class="starter-actions">
        <button type="button" class="secondary-button" data-action="adopt-starter-plan" data-value="${esc(preset.id)}" data-mode="draft">存为草稿</button>
        <button type="button" class="primary-button" data-action="adopt-starter-plan" data-value="${esc(preset.id)}" data-mode="apply">一键启用</button>
      </footer>
    </section>`;
  }).join("");
  const planShortcut = current?.active
    ? { label: "进行中的训练", name: current.active.title, note: `${current.active.done}/${current.active.total} 组`, action: "workout-detail", value: current.active.id, button: "继续训练" }
    : next ? { label: next.date === current.date ? "今日安排" : "下一次训练", name: next.name,
      note: `${shortDate(next.date)} · ${next.exercises} 个动作`, action: next.source === "scheduled" ? "schedule-preview" : "today-routine", value: next.source === "scheduled" ? next.date : next.id, button: "预览训练" }
    : current?.applePlan ? { label: "今日已完成", name: current.applePlan.name, note: "Apple 健康已同步", action: "training-today", value: "workout", button: "查看训练" }
    : null;
  content.innerHTML = heading("训练计划", activePlan ? `${activePlan.name} · ${activePlan.weeks} 周` : "训练周期、渐进与未来排期",
   `<div class="heading-actions"><button class="secondary-button" data-action="open-plan-import" type="button">${icon("upload", 15)} 导入计划</button><button class="secondary-button" data-action="new-plan" type="button">${icon("plus", 16)} 新建计划</button><button class="primary-button" data-action="ai-plan" type="button">${icon("bolt", 16)} 生成 AI 计划</button></div>`) +
    `<div class="page-sections plan-sections" role="group" aria-label="训练计划分类">${segments({ current: "当前计划", horizon: "未来排期", starters: "经典方案", templates: "训练模板", drafts: "计划草稿" }, state.planSection, "plan-section")}</div>
    <div data-section="current"${state.planSection === "current" ? "" : " hidden"}>
    ${planShortcut ? `<section class="panel plan-shortcut">
       <div><h2>${esc(planShortcut.name)}</h2>
       <p class="shortcut-meta"><i aria-hidden="true"></i>${esc(planShortcut.label)} · ${esc(planShortcut.note)}</p></div>
       <button class="primary-button" type="button" data-action="${planShortcut.action}" data-value="${esc(planShortcut.value)}">${planShortcut.button}${icon("chevron", 16)}</button>
     </section>` : ""}
    ${activePlan ? `<section class="plan-summary"><header class="panel-head"><div><h2>${esc(activePlan.name)}</h2><p>${activePlan.weeks} 周 · ${activePlan.schedule === "rotation" ? "按顺序轮换" : "按星期执行"}</p></div>
       <div class="plan-summary-actions"><button type="button" class="secondary-button" data-action="export-plan-json" data-value="active">${icon("download", 14)} 导出 JSON</button><button type="button" class="secondary-button" data-action="edit-active-plan">编辑此计划</button></div></header>
       ${activePlan.rationale ? `<details class="plan-rationale"><summary><span>计划说明</span>${icon("chevron", 14)}</summary><p>${esc(activePlan.rationale)}</p></details>` : ""}</section>
       <div class="routine-grid${activeRoutines.length === 3 ? " is-three" : ""}">${routineCards(activeRoutines, true)}</div>` :
       empty("暂无生效计划", "可直接选用「经典方案」，或点击右上角「新建计划」「生成 AI 计划」。", `<button type="button" class="secondary-button" data-action="plan-section" data-value="starters">${icon("plan", 16)} 浏览经典方案</button>`)}</div>
    <section data-section="horizon"${state.planSection === "horizon" ? "" : " hidden"}>
    ${renderScheduleHorizon({ scheduleData: schedule, todayDate: today() })}</section>
    <section data-section="starters"${state.planSection === "starters" ? "" : " hidden"}>
    ${starterPlans.length ? `<div class="starter-plan-grid">${starterCards}</div>` : empty("暂无经典方案", "")}</section>
    <section data-section="templates"${state.planSection === "templates" ? "" : " hidden"}>
    <div class="templates-head-bar"><button type="button" class="secondary-button" data-action="new-workout-template">${icon("plus", 15)} 新建训练模板</button></div>
    ${templates.length ? `<div class="routine-grid${templates.length === 3 ? " is-three" : ""}">${routineCards(templates, false)}</div>` : empty("还没有训练模板", "可直接点击上方「新建训练模板」，或在训练复盘里把一次训练存为模板。", `<button type="button" class="secondary-button" data-action="new-workout-template">${icon("plus", 15)} 新建训练模板</button>`)}</section>
    <section data-section="drafts"${state.planSection === "drafts" ? "" : " hidden"}>
    ${unapplied.length ? `<div class="panel plan-drafts">${unapplied.map((entry, index) =>
      `<button class="record-line" type="button" data-action="view-draft" data-value="${index}"><span class="record-icon">${icon("plan")}</span>
         <span><strong>${esc(entry.data.name)}</strong><small>${entry.data.weeks} 周 · ${entry.data.routines.length} 个训练日</small></span><span></span>${icon("chevron", 15)}</button>`).join("")}</div>` :
         empty("还没有计划草稿", me.aiReady ? "生成 AI 计划后，可在这里预览。" : "配置 AI 或手动新建草稿后，会出现在这里。")}</section>`;
  $("#content").onclick = (event) => {
    const row = event.target.closest('[data-action="view-draft"]');
    if (row) openDraft(unapplied[Number(row.dataset.value)], map);
  };
  requestAnimationFrame(() => centerActivePills(content, false));
}
async function loadPlan(version) {
  if (state.planCache && state.planCache.epoch === dataEpoch) {
    renderPlan(state.planCache);
    return;
  }
  if (!state.planCache) content.innerHTML = loadingMarkup();
  const fetchEpoch = dataEpoch;
  const [active, templates, drafts, me, current, schedule, planMod, starterPlans] = await Promise.all([
    api("/api/plans/active"), api("/api/records/template"), api("/api/records/plan"), api("/api/me"),
    api("/api/web/today").catch(() => null),
    api("/api/web/schedule").catch(() => null),
    loadPlanUi(),
    api("/api/web/starter-plans").catch(() => []),
  ]);
  const activeRoutines = active?.data?.routines ?? [];
  const saved = templates.map((record) => record.data);
  const unapplied = drafts.filter((record) => !active?.history.some((entry) => entry.id === record.id && entry.version === record.version))
    .filter((record) => record.id !== active?.id || record.version !== active?.version).reverse();
  const ids = [...new Set([...activeRoutines, ...saved, ...unapplied.flatMap((entry) => entry.data.routines)].flatMap((routine) =>
    routine.exercises.flatMap((row) => [row.exerciseId, row.backupExerciseId].filter(Boolean))))];
  const map = await planMod.resolveCatalogueMap(api, ids);
  if (version !== requestId || state.view !== "plan") return;
  state.planCache = { epoch: fetchEpoch, active, templates, drafts, me, current, schedule, map, renderScheduleHorizon: planMod.renderScheduleHorizon, starterPlans };
  renderPlan(state.planCache);
}
function openDraft(record, map) {
  const { data } = record;
  open(data.name, `<div class="dialog-form"><p>${esc(data.rationale)}</p>${data.routines.map((routine) => {
    const ssBadges = supersetBadges(routine.exercises);
    return `<section class="panel routine">
    <h3>${esc(routine.name)}</h3><ol>${routine.exercises.map((row, exIdx) => `<li><span>${ssBadges[exIdx] ? `<span class="superset-pill">超级组 ${esc(ssBadges[exIdx])}</span> ` : ""}${esc(map.get(row.exerciseId)?.name ?? row.exerciseId)}</span>
    <span>${row.sets} 组 × ${row.seconds ? row.seconds + " 秒" : row.repsMin + "–" + row.repsMax + " 次"}</span></li>`).join("")}</ol></section>`;
  }).join("")}
    <footer><button class="secondary-button" type="button" id="export-draft-json">${icon("download", 14)} 导出 JSON</button><button class="primary-button" type="button" id="apply-plan">启用此计划</button></footer></div>`, true);
  $("#export-draft-json")?.addEventListener("click", () => exportPlanAsJson(data));
  $("#apply-plan").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!button.dataset.confirm) { button.dataset.confirm = "true"; button.textContent = "确认启用"; return; }
    button.disabled = true;
    try {
      await api("/api/plans/apply", { method: "POST", body: { id: record.id, version: record.version, expectedRevision: state.plan?.revision ?? 0 } });
      state.planSection = "current";
      dialog.close(); await renderRoute(); notify("训练计划已启用");
    } catch (problem) { notify(problem.message); } finally { button.disabled = false; }
  });
}
function settingsPanels(preferences, profile, devices, aiStatus, aiSettingsCard, apiTokens = []) {
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
    if (target.checked) choice.add(target.value); else choice.delete(target.value);
  });
  $("#panel-options").addEventListener("click", ({ target }) => {
    const button = target.closest("[data-reorder]");
    if (!button) return;
    const visibleOrder = state.appleHealthConnected ? order : order.filter((id) => id !== "apple");
    const position = visibleOrder.indexOf(button.dataset.panel), next = position + Number(button.dataset.reorder);
    if (position < 0 || next < 0 || next >= visibleOrder.length) return;
    [visibleOrder[position], visibleOrder[next]] = [visibleOrder[next], visibleOrder[position]];
    order = state.appleHealthConnected ? visibleOrder : [...visibleOrder, ...(order.includes("apple") ? ["apple"] : [])];
    drawRows();
    const replacement = $(`[data-reorder="${button.dataset.reorder}"][data-panel="${button.dataset.panel}"]`);
    (replacement.disabled ? $(`[data-panel="${button.dataset.panel}"]:not(:disabled)`) : replacement)?.focus();
  });
  function submitForm(id, save) {
    $(id).addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget, button = $("footer button", form), error = $(".form-error", form);
      button.disabled = true; error.hidden = true;
      try { await save(new FormData(form)); }
      catch (problem) { error.textContent = problem.message; error.hidden = false; }
      finally { button.disabled = false; }
    });
  }
  submitForm("#preferences-form", async (form) => {
    const panels = order.filter((id) => choice.has(id));
    if (!panels.length) throw new Error("至少保留一张统计卡片。");
    state.preferences = await api("/api/web/preferences", { method: "PUT", body: {
      revision: state.preferences.revision, days: Number(form.get("days")), includeWarmups: form.has("warmups"), panels,
    } });
    state.period = null;
    notify("统计设置已保存");
  });
  $('[name="energy"]').addEventListener("change", ({ target }) => { $("#energy-fields").disabled = !target.checked; });
  const equipPresetMap = {
    gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
    home: ["dumbbell", "bodyweight", "band"],
    bodyweight: ["bodyweight"],
  };
  $("#profile-form").addEventListener("click", ({ target }) => {
    const presetBtn = target.closest("[data-equip-preset]");
    if (!presetBtn) return;
    const chosen = new Set(equipPresetMap[presetBtn.dataset.equipPreset] ?? []);
    $$('#profile-form input[name="equipment"]').forEach((box) => { box.checked = chosen.has(box.value); });
  });
  let profileVersion = profile.version;
  submitForm("#profile-form", async (form) => {
    const body = Object.fromEntries(["calories", "protein", "carbs", "fat", "daysPerWeek", "restSeconds"].map((name) => [name, Number(form.get(name))]));
    body.targetWeight = form.get("targetWeight") ? Number(form.get("targetWeight")) : null;
    body.equipment = form.getAll("equipment");
    body.energyProfile = form.has("energy") ? {
      heightCm: Number(form.get("heightCm")), weightKg: Number(form.get("weightKg")), weightDate: form.get("weightDate"),
      birthDate: form.get("birthDate"), sex: form.get("sex"), context: form.get("context"), activityFactor: Number(form.get("activityFactor")),
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
      $("#password-change-form")?.reset();
      notify("登录密码已更新");
    });
  }
  requestAnimationFrame(() => centerActivePills(content, false));
}
async function loadSettings(version) {
  content.innerHTML = loadingMarkup();
  const [preferences, profile, devices, aiStatus, { aiSettingsCard }, apiTokens] = await Promise.all([
    api("/api/web/preferences"),
    api("/api/web/profile"),
    api("/api/integrations/apple-health/tokens"),
    getAiStatus(true),
    loadAiUi(),
    api("/api/tokens").catch(() => []),
  ]);
  if (version !== requestId) return;
  state.preferences = preferences;
  state.userEquipment = profile?.profile?.equipment ?? state.userEquipment;
  settingsPanels(preferences, profile, devices, aiStatus, aiSettingsCard, apiTokens);
}
function renderAnalytics() {
  if (!state.analyticsData || !analyticsUi) return;
  content.innerHTML = workspaceTabsHtml("analytics") + analyticsUi.renderAnalyticsView(state.analyticsData, state);
}
async function loadAnalytics(version) {
  const key = `${state.analyticsThrough}|${state.analyticsPeriod}`;
  if (state.analyticsData && analyticsUi && state.cacheMeta.analyticsEpoch === dataEpoch && state.cacheMeta.analyticsKey === key) {
    renderAnalytics();
    return;
  }
  if (!state.analyticsData) content.innerHTML = loadingMarkup();
  const fetchEpoch = dataEpoch;
  const query = new URLSearchParams();
  if (state.analyticsPeriod) query.set("days", String(state.analyticsPeriod));
  if (state.analyticsThrough) query.set("through", state.analyticsThrough);
  const [data] = await Promise.all([
    api(`/api/web/analytics?${query.toString()}`),
    loadAnalyticsUi(),
  ]);
  if (version !== requestId || state.view !== "analytics") return;
  state.analyticsData = data;
  state.cacheMeta.analyticsEpoch = fetchEpoch;
  state.cacheMeta.analyticsKey = key;
  renderAnalytics();
}
async function saveAppleWeightToRecord({ targetDate, weightKg, bodyFatPct, existing }) {
  await api("/api/records", {
    method: "POST",
    body: {
      opId: crypto.randomUUID(),
      id: `weight_${targetDate}`,
      kind: "weight",
      baseVersion: existing?.version ?? 0,
      deleted: false,
      data: {
        date: targetDate,
        weight: weightKg,
        bodyFat: bodyFatPct ?? existing?.data?.bodyFat ?? null,
      },
    },
  });
}
function downloadTextFile(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderBadges() {
  if (!state.badges) return;
  const visibleSummary = filterVisibleBadges(state.badges, state.appleHealthConnected);
  content.innerHTML = heading("成就徽章", `${visibleSummary.earnedCount} / ${visibleSummary.totalCount} 枚已点亮`) +
    renderBadgesView(state.badges, {
      category: state.badgeCategory,
      status: state.badgeStatus,
      query: state.badgeQuery,
      pinnedIds: getPinnedBadges(),
      appleHealthConnected: state.appleHealthConnected,
    });
  requestAnimationFrame(() => centerActivePills(content, false));
}
async function loadBadges(version) {
  if (state.badges && state.cacheMeta.badgesEpoch === dataEpoch) {
    renderBadges();
    return;
  }
  if (!state.badges) content.innerHTML = loadingMarkup();
  const fetchEpoch = dataEpoch;
  const summary = await api("/api/web/badges");
  if (version !== requestId || state.view !== "badges") return;
  state.badges = summary;
  state.cacheMeta.badgesEpoch = fetchEpoch;
  renderBadges();
}
async function renderRoute() {
  const current = ++requestId;
  const view = location.hash.slice(1);
  const previousView = state.view;
  state.view = Object.hasOwn(destinations, view) ? view : "overview";
  content.onclick = null;
  nav();
  if (state.view !== previousView) window.scrollTo(0, 0);
  if (!state.userId && state.view !== "exercises") { loginPanel(); return; }
  try {
    if (state.view === "overview") {
      const sameKey = state.data && state.cacheMeta.overviewKey === overviewKey();
      if (sameKey && state.cacheMeta.overviewEpoch === dataEpoch && state.currentDay?.date === today()) {
        overview(state.data);
        return;
      }
      if (sameKey) {
        overview(state.data);
        return await loadOverview(true);
      }
      content.innerHTML = loadingMarkup();
      return await loadOverview(true);
    }
    if (state.view === "analytics") return await loadAnalytics(current);
    if (state.view === "calendar") return await loadCalendar(current);
    if (state.view === "badges") return await loadBadges(current);
    if (state.view === "settings") return await loadSettings(current);
    if (state.view === "plan") return await loadPlan(current);
    if (state.view === "exercises") {
      const quickMuscles = { "": "全部", ...muscles };
      const exActions = `<div class="heading-actions"><button class="secondary-button" type="button" data-action="open-strength-calc">${icon("bolt", 15)} 力量计算器</button>${state.userId ? `<button class="primary-button" type="button" data-action="create-exercise">${icon("plus", 16)} 自定义动作</button>` : ""}</div>`;
      content.innerHTML = heading("动作库", "", exActions) +
        `<div class="catalogue-shell">
          <form id="catalogue-search" class="catalogue-toolbar">
            <div class="search">${icon("search")}<input name="query" maxlength="120" type="search" enterkeyhint="search" value="${esc(state.query)}" aria-label="搜索动作" placeholder="搜索中文名或英文名"></div>
            ${state.userId ? segments({ all: "全部", trained: "已练/PR", favorites: "★ 收藏", custom: "自定义" }, state.catalogueScope, "catalogue-scope") : ""}
            <select name="equipment" aria-label="训练器械">${options({ "": "全部器械", ...(state.userId ? { __mine__: "我的器械" } : {}), ...equipment }, state.catalogueEquipment)}</select>
            <button type="button" class="quiet" data-clear-catalogue>清除筛选</button>
            <button class="visually-hidden" type="submit" tabindex="-1">搜索</button>
          </form>
          <div class="catalogue-pills-bar">
            <div class="muscle-pills" role="group" aria-label="快捷肌群筛选">${Object.entries(quickMuscles).map(([val, label]) =>
              `<button type="button" data-action="catalogue-muscle" data-value="${val}" aria-pressed="${state.catalogueMuscle === val}">${label}</button>`).join("")}</div>
            <p class="catalogue-status" role="status"></p>
          </div>
          <section id="exercise-results" aria-label="动作搜索结果"></section>
        </div>`;
      let delay;
      const form = $("#catalogue-search"), search = form.elements.query, clear = $("[data-clear-catalogue]", form);
      function syncPills() {
        $$('[data-action="catalogue-muscle"]', content).forEach((btn) =>
          btn.setAttribute("aria-pressed", String(btn.dataset.value === state.catalogueMuscle)));
        $$('[data-action="catalogue-scope"]', content).forEach((btn) =>
          btn.setAttribute("aria-pressed", String(btn.dataset.value === state.catalogueScope)));
      }
      function find() {
        clearTimeout(delay);
        if (!form.isConnected) return;
        state.query = search.value.trim();
        state.catalogueEquipment = form.elements.equipment.value;
        clear.hidden = !(state.query || state.catalogueMuscle || state.catalogueEquipment || state.catalogueScope !== "all");
        syncPills();
        void catalogueSearch();
      }
      content.onclick = (event) => {
        const pill = event.target.closest('[data-action="catalogue-muscle"]');
        if (pill) { state.catalogueMuscle = pill.dataset.value; find(); centerActivePills(content, true); return; }
        const scopeBtn = event.target.closest('[data-action="catalogue-scope"]');
        if (scopeBtn) { state.catalogueScope = scopeBtn.dataset.value; find(); return; }
        const sortBtn = event.target.closest('[data-action="trained-sort"]');
        if (sortBtn) { state.trainedSort = sortBtn.dataset.value; find(); }
      };
      search.addEventListener("input", (event) => {
        requestId++;
        state.nextCursor = null;
        const more = $('[data-action="more-catalogue"]');
        if (more) more.disabled = true;
        clearTimeout(delay);
        if (!event.isComposing) delay = setTimeout(find, 200);
      });
      search.addEventListener("compositionend", find);
      form.addEventListener("change", (event) => { if (event.target.matches("select")) find(); });
      form.addEventListener("submit", (event) => { event.preventDefault(); find(); });
      clear.addEventListener("click", () => {
        search.value = form.elements.equipment.value = "";
        state.catalogueMuscle = "";
        state.catalogueScope = "all";
        find();
        search.focus();
      });
      clear.hidden = !(state.query || state.catalogueMuscle || state.catalogueEquipment || state.catalogueScope !== "all");
      requestAnimationFrame(() => centerActivePills(content, false));
      return await catalogueSearch();
    }
    await loadRecords(state.view, current);
  } catch (problem) {
    if (!state.userId || (current !== requestId && state.view !== "overview")) return;
    showError(problem);
  }
}
function showError(problem) {
  if (problem.status === 401) { clearUser(); nav(); loginPanel(); notify(problem.message); return; }
  content.innerHTML = empty("暂时无法读取数据", problem.message, '<button class="secondary-button" data-action="refresh">重试</button>');
}
async function completeDiet(date) {
  const prevBadges = state.badges;
  await api("/api/web/nutrition-day", { method: "PUT", body: { date, opId: crypto.randomUUID() } });
  state.badges = null;
  notify("这一天已标记为全天记录");
  void checkBadgeUnlocks(prevBadges);
}
async function openDevice() {
  await openDeviceSetupDialog({
    api, open, notify,
    refresh: async () => { await refreshAccountMeta(); await renderRoute(); },
    userId: state.userId,
  });
}
function openCsvImportModal() {
  open("导入训练记录（CSV）", `<div class="dialog-form csv-import-box">
    <p class="muted">自动识别 <b>Strong</b>、<b>Hevy</b>、<b>FitNotes</b> 与 <b>铁记导出</b> CSV，自动换算 lbs→kg、匹配中文动作库并过滤重复场次。</p>
    <label class="csv-file-drop">
      <input type="file" id="csv-import-file" accept=".csv,text/csv,text/plain">
      <span>${icon("upload", 16)} 选择 CSV 文件</span>
      <small id="csv-file-label">或直接在下方粘贴 CSV 文本（含表头）</small>
    </label>
    <textarea id="csv-import-text" rows="5" placeholder="例如：Date,Workout Name,Exercise Name,Weight,Reps&#10;2026-11-20,Push Day,Bench Press (Barbell),100,5"></textarea>
    <div class="csv-import-options">
      <label class="switch-chip"><span>跳过同日同名重复训练</span><input class="switch" type="checkbox" id="csv-import-skip" checked></label>
      <button type="button" class="secondary-button" id="csv-import-preview-btn">解析预览</button>
    </div>
    <p class="form-error" id="csv-import-error" hidden></p>
    <div id="csv-import-preview" class="csv-preview-box" hidden></div>
    <footer>
      <button type="button" class="quiet" data-action="close">取消</button>
      <button type="button" class="primary-button" id="csv-import-commit-btn" disabled>确认导入</button>
    </footer>
  </div>`, true);

  const fileInput = $("#csv-import-file", dialog);
  const fileLabel = $("#csv-file-label", dialog);
  const textArea = $("#csv-import-text", dialog);
  const skipCheck = $("#csv-import-skip", dialog);
  const previewBtn = $("#csv-import-preview-btn", dialog);
  const commitBtn = $("#csv-import-commit-btn", dialog);
  const previewBox = $("#csv-import-preview", dialog);
  const errEl = $("#csv-import-error", dialog);

  async function runPreview() {
    const csv = textArea.value.trim();
    errEl.hidden = true;
    commitBtn.disabled = true;
    if (!csv) {
      previewBox.hidden = true;
      return;
    }
    previewBtn.disabled = true;
    try {
      const res = await api("/api/web/import-csv/preview", {
        method: "POST",
        body: { csv, skipDuplicates: skipCheck.checked },
      });
      if (!dialog.open || !textArea.isConnected) return;
      previewBox.hidden = false;
      previewBox.innerHTML = `<div class="csv-preview-head"><span class="starter-tag">识别格式：${esc(res.formatLabel)}</span><small>已匹配动作 ${res.matchedExercises} 个</small></div>
        <div class="csv-preview-stats">
          <div><span>解析场次</span><strong>${res.totalWorkouts} <small>场</small></strong></div>
          <div><span>将导入</span><strong>${res.importableWorkouts} <small>场</small></strong></div>
          <div><span>重复跳过</span><strong>${res.duplicateWorkouts} <small>场</small></strong></div>
          <div><span>有效组数</span><strong>${res.totalSets} <small>组</small></strong></div>
        </div>
        ${res.customExercisesToCreate?.length ? `<p class="muted csv-custom-note">将自动创建自定义动作：<b>${res.customExercisesToCreate.map((n) => esc(n)).join("、")}</b></p>` : ""}
        ${res.warnings?.length ? `<p class="muted csv-warn-note">${res.warnings.map((w) => esc(w)).join("<br>")}</p>` : ""}
        ${res.sampleWorkouts?.length ? `<ul class="csv-preview-list">${res.sampleWorkouts.map((w) =>
          `<li><span><b>${esc(w.date)}</b> · ${esc(w.title)}</span><small>${esc(w.exercises.slice(0, 3).join("、"))}${w.exercises.length > 3 ? ` 等 ${w.exercises.length} 项` : ""} · ${w.sets} 组</small></li>`).join("")}</ul>` : '<p class="muted">所有识别场次均为重复记录，取消勾选“跳过重复”或更换文件可强制导入。</p>'}`;
      commitBtn.disabled = !(res.importableWorkouts > 0);
    } catch (problem) {
      previewBox.hidden = true;
      errEl.textContent = problem.message;
      errEl.hidden = false;
    } finally {
      previewBtn.disabled = false;
    }
  }

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      errEl.textContent = "CSV 文件超过 2 MB，请分批导入。";
      errEl.hidden = false;
      return;
    }
    if (fileLabel) fileLabel.textContent = `已加载：${file.name}`;
    textArea.value = await file.text();
    await runPreview();
  });
  previewBtn?.addEventListener("click", () => void runPreview());
  skipCheck?.addEventListener("change", () => { if (textArea.value.trim()) void runPreview(); });
  commitBtn?.addEventListener("click", async () => {
    const csv = textArea.value.trim();
    if (!csv) return;
    commitBtn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await api("/api/web/import-csv/commit", {
        method: "POST",
        body: { csv, skipDuplicates: skipCheck.checked },
      });
      dataEpoch++;
      state.badges = null;
      state.libraryLoaded = false;
      state.planCache = null;
      state.recordsCache = {};
      if (dialog.open) dialog.close();
      await renderRoute();
      notify(`已从 ${res.formatLabel} 导入 ${res.importedWorkouts} 场训练（共 ${res.importedSets} 组）`);
    } catch (problem) {
      errEl.textContent = problem.message;
      errEl.hidden = false;
      commitBtn.disabled = false;
    }
  });
}
function openBackupRestoreModal() {
  open("恢复全量 JSON 备份", `<div class="dialog-form csv-import-box">
    <p class="muted">支持一键恢复由「导出全量 JSON」生成的备份文件（包含训练记录、饮食、体重、训练计划、自定义动作、身体围度、动作备忘与 Apple 健康同步数据）。</p>
    <label class="csv-file-drop">
      <input type="file" id="backup-restore-file" accept=".json,application/json">
      <span>${icon("upload", 16)} 选择全量 JSON 备份文件</span>
      <small id="backup-file-label">或直接在下方粘贴备份 JSON 内容</small>
    </label>
    <textarea id="backup-restore-text" rows="5" placeholder='{"format":"ironlog","schemaVersion":1,"records":[...]}'></textarea>
    <div class="csv-import-options">
      <select id="backup-restore-strategy" aria-label="恢复策略">
        <option value="merge">智能合并（推荐：保留现有数据，仅导入缺失或更新的记录）</option>
        <option value="replace">完整覆盖（清空当前账号数据，完整还原至此备份）</option>
      </select>
      <button type="button" class="secondary-button" id="backup-restore-preview-btn">解析预览</button>
    </div>
    <p class="form-error" id="backup-restore-error" hidden></p>
    <div id="backup-restore-preview" class="csv-preview-box" hidden></div>
    <footer>
      <button type="button" class="quiet" data-action="close">取消</button>
      <button type="button" class="primary-button" id="backup-restore-commit-btn" disabled>确认恢复</button>
    </footer>
  </div>`, true);

  const fileInput = $("#backup-restore-file", dialog);
  const fileLabel = $("#backup-file-label", dialog);
  const textArea = $("#backup-restore-text", dialog);
  const strategySel = $("#backup-restore-strategy", dialog);
  const previewBtn = $("#backup-restore-preview-btn", dialog);
  const commitBtn = $("#backup-restore-commit-btn", dialog);
  const previewBox = $("#backup-restore-preview", dialog);
  const errEl = $("#backup-restore-error", dialog);
  let parsedBackup = null;

  async function runPreview() {
    const raw = textArea.value.trim();
    errEl.hidden = true;
    commitBtn.disabled = true;
    delete commitBtn.dataset.confirm;
    commitBtn.textContent = "确认恢复";
    if (!raw) {
      previewBox.hidden = true;
      return;
    }
    try {
      parsedBackup = JSON.parse(raw);
    } catch {
      previewBox.hidden = true;
      errEl.textContent = "备份内容不是合法的 JSON 格式";
      errEl.hidden = false;
      return;
    }
    previewBtn.disabled = true;
    try {
      const res = await api("/api/web/restore-backup", {
        method: "POST",
        body: { backup: parsedBackup, mode: "preview", strategy: strategySel.value },
      });
      if (!dialog.open || !textArea.isConnected) return;
      const c = res.counts ?? {};
      const d = res.diff ?? {};
      previewBox.hidden = false;
      previewBox.innerHTML = `<div class="csv-preview-head"><span class="starter-tag">${res.strategy === "replace" ? "策略：完整覆盖" : "策略：智能合并"}</span><small>${res.exportedAt ? `备份时间：${esc(res.exportedAt.slice(0, 16).replace("T", " "))}` : "铁记全量备份"}</small></div>
        <div class="csv-preview-stats">
          <div><span>力量/训练</span><strong>${c.workouts ?? 0} <small>场</small></strong></div>
          <div><span>饮食记录</span><strong>${c.diets ?? 0} <small>条</small></strong></div>
          <div><span>体重/围度</span><strong>${(c.weights ?? 0) + (c.measurements ?? 0)} <small>条</small></strong></div>
          <div><span>计划/模板</span><strong>${(c.plans ?? 0) + (c.templates ?? 0)} <small>份</small></strong></div>
        </div>
        <p class="muted csv-custom-note">将新增 <b>${d.toImport ?? 0}</b> 项 · 更新 <b>${d.toUpdate ?? 0}</b> 项 · 已一致跳过 <b>${d.unchanged ?? 0}</b> 项${(c.appleDaily || c.appleWorkouts) ? ` · 含 Apple 健康 ${c.appleDaily ?? 0} 天 / ${c.appleWorkouts ?? 0} 场训练` : ""}</p>`;
      commitBtn.disabled = false;
    } catch (problem) {
      previewBox.hidden = true;
      errEl.textContent = problem.message;
      errEl.hidden = false;
    } finally {
      previewBtn.disabled = false;
    }
  }

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 16_000_000) {
      errEl.textContent = "备份文件超过 16 MB";
      errEl.hidden = false;
      return;
    }
    if (fileLabel) fileLabel.textContent = `已加载：${file.name}`;
    textArea.value = await file.text();
    await runPreview();
  });
  previewBtn?.addEventListener("click", () => void runPreview());
  strategySel?.addEventListener("change", () => { if (textArea.value.trim()) void runPreview(); });
  commitBtn?.addEventListener("click", async () => {
    if (!parsedBackup) return;
    if (strategySel.value === "replace" && commitBtn.dataset.confirm !== "true") {
      commitBtn.dataset.confirm = "true";
      commitBtn.textContent = "确认清空并覆盖恢复";
      return;
    }
    commitBtn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await api("/api/web/restore-backup", {
        method: "POST",
        body: { backup: parsedBackup, mode: "commit", strategy: strategySel.value },
      });
      dataEpoch++;
      state.badges = null;
      state.libraryLoaded = false;
      state.planCache = null;
      state.recordsCache = {};
      state.dayCache.clear();
      await refreshAccountMeta();
      if (dialog.open) dialog.close();
      await renderRoute();
      notify(`全量备份恢复完成：新增 ${res.imported} 项，更新 ${res.updated} 项`);
    } catch (problem) {
      errEl.textContent = problem.message;
      errEl.hidden = false;
      commitBtn.disabled = false;
    }
  });
}
function openIssueApiTokenModal() {
  open("生成 MCP / API 访问令牌", `<form id="issue-api-token-form" class="dialog-form">
    <p class="muted">生成后可用于配置 Claude Desktop、Cursor 的 <code>@ironlog/mcp</code> 服务或调用铁记 REST API。</p>
    ${field("令牌名称", '<input name="label" maxlength="80" required value="Claude Desktop MCP" placeholder="例如：Claude Desktop / 命令行脚本">')}
    <p class="form-error" role="alert" hidden></p>
    <footer>
      <button type="button" class="quiet" data-action="close">取消</button>
      <button type="submit" class="primary-button">生成令牌</button>
    </footer>
  </form>`, true);
  $("#issue-api-token-form", dialog)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get("label") ?? "").trim();
    const btn = $('button[type="submit"]', form);
    const errEl = $(".form-error", form);
    if (!label) return;
    btn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await api("/api/tokens", { method: "POST", body: { label } });
      const mcpConfig = JSON.stringify({
        mcpServers: {
          ironlog: {
            command: "npx",
            args: ["-y", "tsx", "packages/mcp/src/index.ts"],
            env: {
              IRONLOG_URL: location.origin,
              IRONLOG_TOKEN: res.token,
            },
          },
        },
      }, null, 2);
      open("令牌已生成（请立即保存）", `<div class="dialog-form">
        <p class="muted">出于安全考虑，此令牌仅显示一次。关闭窗口后将无法再次查看完整明文。</p>
        ${field("API 访问令牌 (IRONLOG_TOKEN)", `<input name="issued-api-token" readonly value="${esc(res.token)}">`)}
        ${field("MCP 客户端配置示例", `<textarea rows="7" readonly>${esc(mcpConfig)}</textarea>`)}
        <footer>
          <button type="button" class="secondary-button" id="copy-mcp-config-btn">复制 MCP 配置</button>
          <button type="button" class="primary-button" id="copy-api-token-btn">复制令牌</button>
        </footer>
      </div>`, true);
      $("#copy-api-token-btn", dialog)?.addEventListener("click", async () => {
        if (await copyText(res.token)) notify("API 访问令牌已复制");
      });
      $("#copy-mcp-config-btn", dialog)?.addEventListener("click", async () => {
        if (await copyText(mcpConfig)) notify("MCP 配置 JSON 已复制");
      });
      if (state.view === "settings") await renderRoute();
    } catch (problem) {
      errEl.textContent = problem.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
}
function exportPlanAsJson(plan) {
  if (!plan) return;
  const payload = {
    format: "ironlog-plan",
    version: 1,
    exportedAt: new Date().toISOString(),
    plan,
  };
  const safeName = String(plan.name || "plan").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 48);
  downloadTextFile(JSON.stringify(payload, null, 2), "application/json;charset=utf-8;", `ironlog-plan-${safeName}.json`);
  notify(`已导出计划「${plan.name ?? "训练计划"}」JSON 文件`);
}
function openPlanImportModal() {
  open("导入训练计划（JSON）", `<div class="dialog-form plan-import-box">
    <p class="muted">导入由铁记导出的 <code>ironlog-plan</code> JSON，或任何标准计划结构（支持按动作中/英文名自动匹配动作库）。</p>
    <label class="csv-file-drop">
      <input type="file" id="plan-import-file" accept=".json,application/json">
      <span>${icon("upload", 16)} 选择计划 JSON 文件</span>
      <small id="plan-file-label">或在下方直接粘贴计划 JSON 内容</small>
    </label>
    <textarea id="plan-import-text" rows="5" placeholder='{"format":"ironlog-plan","version":1,"plan":{"name":"示例推拉计划","weeks":6,"schedule":"rotation","routines":[...]}}'></textarea>
    <div class="csv-import-options">
      <span></span>
      <button type="button" class="secondary-button" id="plan-import-preview-btn">解析预览</button>
    </div>
    <p class="form-error" id="plan-import-error" hidden></p>
    <div id="plan-import-preview" class="csv-preview-box" hidden></div>
    <footer>
      <button type="button" class="quiet" data-action="close">取消</button>
      <button type="button" class="secondary-button" id="plan-import-draft-btn" disabled>存为草稿</button>
      <button type="button" class="primary-button" id="plan-import-apply-btn" disabled>一键启用</button>
    </footer>
  </div>`, true);

  const fileInput = $("#plan-import-file", dialog);
  const fileLabel = $("#plan-file-label", dialog);
  const textArea = $("#plan-import-text", dialog);
  const previewBtn = $("#plan-import-preview-btn", dialog);
  const draftBtn = $("#plan-import-draft-btn", dialog);
  const applyBtn = $("#plan-import-apply-btn", dialog);
  const previewBox = $("#plan-import-preview", dialog);
  const errEl = $("#plan-import-error", dialog);

  async function runPreview() {
    const json = textArea.value.trim();
    errEl.hidden = true;
    draftBtn.disabled = true;
    applyBtn.disabled = true;
    applyBtn.dataset.confirm = "";
    applyBtn.textContent = "一键启用";
    if (!json) { previewBox.hidden = true; return; }
    previewBtn.disabled = true;
    try {
      const res = await api("/api/web/plans/import-json", {
        method: "POST",
        body: { json, mode: "preview" },
      });
      if (!dialog.open || !textArea.isConnected) return;
      const p = res.plan;
      const names = res.exerciseNames ?? {};
      previewBox.hidden = false;
      previewBox.innerHTML = `<div class="csv-preview-head"><strong>${esc(p.name)}</strong><small>${p.weeks} 周 · ${p.schedule === "rotation" ? "按顺序轮换" : "按星期执行"} · ${res.routineCount} 练 / ${res.exerciseCount} 动作</small></div>
        ${res.weeklyMuscleSets?.length ? `<div class="starter-muscles">${res.weeklyMuscleSets.map((m) => `<span>${esc(m.name)} <b>${fmt(m.sets)}</b> 组</span>`).join("")}</div>` : ""}
        <ul class="csv-preview-list">${p.routines.map((rt) => `<li><span><b>${esc(rt.name)}</b></span><small>${esc(rt.exercises.map((ex) => names[ex.exerciseId] ?? ex.exerciseId).slice(0, 4).join("、"))}${rt.exercises.length > 4 ? ` 等 ${rt.exercises.length} 项` : ""}</small></li>`).join("")}</ul>`;
      draftBtn.disabled = false;
      applyBtn.disabled = false;
    } catch (problem) {
      previewBox.hidden = true;
      errEl.textContent = problem.message;
      errEl.hidden = false;
    } finally {
      previewBtn.disabled = false;
    }
  }

  async function commitPlan(mode) {
    const json = textArea.value.trim();
    if (!json) return;
    if (mode === "apply" && state.plan?.data && applyBtn.dataset.confirm !== "true") {
      applyBtn.dataset.confirm = "true";
      applyBtn.textContent = "确认覆盖当前计划";
      return;
    }
    draftBtn.disabled = true;
    applyBtn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await api("/api/web/plans/import-json", {
        method: "POST",
        body: { json, mode, expectedRevision: state.plan?.revision ?? 0 },
      });
      state.planSection = mode === "draft" ? "drafts" : "current";
      state.planCache = null;
      dataEpoch++;
      if (dialog.open) dialog.close();
      if (state.view === "plan") await loadPlan(requestId);
      else await route("plan");
      notify(mode === "draft" ? `已将「${res.plan.name}」存入计划草稿` : `已导入并启用「${res.plan.name}」`);
    } catch (problem) {
      errEl.textContent = problem.message;
      errEl.hidden = false;
      draftBtn.disabled = false;
      applyBtn.disabled = false;
    }
  }

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      errEl.textContent = "计划 JSON 文件超过 500 KB。";
      errEl.hidden = false;
      return;
    }
    if (fileLabel) fileLabel.textContent = `已加载：${file.name}`;
    textArea.value = await file.text();
    await runPreview();
  });
  previewBtn?.addEventListener("click", () => void runPreview());
  draftBtn?.addEventListener("click", () => void commitPlan("draft"));
  applyBtn?.addEventListener("click", () => void commitPlan("apply"));
}
function getEditor() {
  return (editorPromise ??= import("./editor.js").then(({ makeEditor }) => makeEditor({
    api, dialog, open, notify, owner: () => state.userId,
    showReport, pushOverlay, popOverlay,
    onDraft: () => { nav(); if (state.view === "overview" && state.data) overview(state.data); },
    appDate: () => ["diet", "calendar"].includes(state.view) ? state.date : today(),
    getLatestWeight: () => {
      const list = state.records.filter((r) => r.kind === "weight" && !r.deleted && r.data?.weight != null);
      list.sort((a, b) => b.data.date.localeCompare(a.data.date));
      return list[0]?.data.weight ?? state.data?.weights?.at(-1)?.weight ?? state.currentDay?.weight ?? null;
    },
    getRecentFoods: () => state.recentFoods,
    getFavoriteIds: () => new Set(state.favorites.filter((r) => !r.deleted).map((r) => r.data?.exerciseId).filter(Boolean)),
    getCustomExercises: () => state.customExercises.filter((r) => !r.deleted).map((r) => r.data),
    onCreateCustomExercise: ({ onDone }) => openCreateExerciseModal({ onDone }),
    getReadinessHint: () => state.currentDay?.readinessHint ?? null,
    getUserEquipment: () => state.userEquipment ?? state.data?.goals?.equipment ?? [],
    refresh: async (kind, date) => {
      const prevBadges = state.badges;
      dataEpoch++;
      state.badges = null;
      if (state.view === "diet" && kind === "diet") state.date = date;
      if (state.view === "calendar") { state.date = date; state.month = date.slice(0, 7); }
      await renderRoute();
      void checkBadgeUnlocks(prevBadges);
    },
  })));
}
async function showReport(id, record) {
  const [report, { workoutReport, workoutReportText, renderWorkoutShareCard }] = await Promise.all([
    api("/api/web/workout-report/" + encodeURIComponent(id)),
    loadSessionUi(),
  ]);
  reportApple = (await appleRange(report.date, report.date).catch(() => [])).find((item) => item.manualWorkoutId === id) ?? null;
  open(report.title, workoutReport(report, reportApple), true, "report");
  const getFullRecord = () => record ?? api("/api/web/records/workout/" + encodeURIComponent(id));
  $("#edit-workout-from-report", dialog).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const [current, ed] = await Promise.all([getFullRecord(), getEditor(), ensureLibraryCaches()]);
      if (dialog.open && dialog.contains(button)) {
        ed.edit("workout", current, state.data?.goals);
      }
    } catch (error) { notify(error.message); }
    finally { button.disabled = false; }
  });
  $("#save-workout-template", dialog)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const current = await getFullRecord();
      const plannedExercises = current.data.exercises.map((row) => {
        const mode = row.snapshot?.mode ?? "reps";
        const workSets = row.sets.filter((s) => s.type !== "warmup");
        const pool = workSets.length ? workSets : row.sets;
        const maxWeight = Math.max(...pool.map((s) => s.weight || 0), 0);
        const avgReps = Math.max(1, Math.round(pool.reduce((s, x) => s + (x.reps || 8), 0) / Math.max(1, pool.length)));
        const maxSec = Math.max(...pool.map((s) => s.seconds || 0), mode === "timed" ? 30 : 0);
        return {
          exerciseId: row.exerciseId,
          sets: Math.max(1, Math.min(100, pool.length)),
          repsMin: mode === "timed" ? 1 : Math.max(1, avgReps - 2),
          repsMax: mode === "timed" ? 1 : avgReps,
          weight: maxWeight > 0 ? maxWeight : null,
          seconds: mode === "timed" ? Math.max(1, maxSec) : 0,
          restSeconds: row.restSeconds ?? 90,
          targetRir: 2,
          progression: "double",
          increment: 2.5,
          backupExerciseId: null,
          supersetGroup: row.supersetGroup ?? null,
        };
      });
      if (!plannedExercises.length) { notify("本场没有动作可存为模板"); button.disabled = false; return; }
      const tplId = "tpl_" + crypto.randomUUID().slice(0, 12);
      const name = current.data.title || "自定义训练模板";
      await api("/api/records", {
        method: "POST",
        body: { opId: crypto.randomUUID(), id: tplId, kind: "template", baseVersion: 0, deleted: false, data: { id: tplId, name, exercises: plannedExercises } },
      });
      dataEpoch++;
      state.planCache = null;
      button.textContent = "已存为模板";
      notify(`已保存「${name}」至训练计划模板库`);
    } catch (error) { notify(error.message); button.disabled = false; }
  });
  $("#sync-workout-to-plan", dialog)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!button.dataset.confirm) {
      button.dataset.confirm = "true";
      button.textContent = "确认同步？";
      return;
    }
    button.disabled = true;
    try {
      const res = await api("/api/web/plans/sync-routine", {
        method: "POST",
        body: { workoutId: id, expectedRevision: report.activePlanRevision },
      });
      dataEpoch++;
      state.planCache = null;
      state.dayCache.clear();
      button.textContent = "已同步回计划";
      notify(`已将本场动作、组数与超级组同步至计划「${res.syncedRoutineName}」`);
    } catch (error) {
      delete button.dataset.confirm;
      button.innerHTML = `${icon("refresh", 15)} 同步回计划`;
      button.disabled = false;
      notify(error.message);
    }
  });
  $("#repeat-workout-from-report", dialog)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const [current, ed] = await Promise.all([getFullRecord(), getEditor(), ensureLibraryCaches()]);
      if (!dialog.open || !dialog.contains(button)) return;
      const clonedExercises = current.data.exercises.map((row) => {
        const workSets = row.sets.filter((s) => s.type !== "warmup");
        const pool = workSets.length ? workSets : row.sets;
        return {
          id: crypto.randomUUID(),
          exerciseId: row.exerciseId,
          supersetGroup: row.supersetGroup ?? null,
          restSeconds: row.restSeconds ?? 90,
          snapshot: row.snapshot,
          sets: pool.map((s) => ({
            id: crypto.randomUUID(),
            type: s.type === "warmup" ? "normal" : s.type,
            weight: s.weight ?? 0,
            reps: s.reps ?? 8,
            seconds: s.seconds ?? 0,
            completed: false,
            rir: null,
          })),
        };
      });
      ed.edit("workout", undefined, state.data?.goals ?? {}, {
        title: current.data.title,
        date: today(),
        exercises: clonedExercises,
        templateKey: "repeat_" + current.id,
      });
    } catch (error) { notify(error.message); button.disabled = false; }
  });
  $("#copy-workout-report", dialog).addEventListener("click", async ({ currentTarget }) => {
    if (await copyText(workoutReportText(report))) { currentTarget.textContent = "已复制训练摘要"; notify("训练摘要已复制"); }
    else notify("无法复制，可以长按选中训练内容");
  });
  $("#share-workout-card", dialog)?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await openShareForDate(report.date || today(), {
        singleReport: report,
        singleHealth: reportApple,
        onBack: () => { void showReport(id, record); },
      });
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  });
}
async function openDailyShareModal(payload, { onBack = null } = {}) {
  const { SHARE_CARD_STYLES, renderDailyShareCard } = await loadSessionUi();
  const savedStyle = localStorage.getItem("ironlog-share-style");
  let activeStyle = SHARE_CARD_STYLES.some((s) => s.id === savedStyle) ? savedStyle : "paper";
  let rendered = await renderDailyShareCard(payload, activeStyle);
  const canNativeShare = typeof navigator.canShare === "function"
    && navigator.canShare({ files: [new File([rendered.blob], rendered.filename, { type: "image/png" })] });

  const tabsHtml = `<div class="share-style-tabs" role="tablist" aria-label="切换分享记录样式">${
    SHARE_CARD_STYLES.map((st) => `<button type="button" role="tab" class="share-style-tab${st.id === activeStyle ? " is-active" : ""}" aria-selected="${st.id === activeStyle}" data-share-style="${esc(st.id)}">
      <strong>${esc(st.label)}</strong>
      <small>${esc(st.desc)}</small>
    </button>`).join("")
  }</div>`;

  open("分享记录预览", `<div class="dialog-form share-card-modal">
    ${tabsHtml}
    <div class="share-card-frame"><img class="share-card-preview" id="share-card-preview-img" src="${rendered.dataUrl}" alt="今日记录分享图预览"></div>
    <footer class="report-foot-actions">
      <div class="report-foot-secondary">
        ${onBack ? '<button type="button" class="quiet" id="back-to-report">返回</button>' : '<button type="button" class="quiet" data-action="close">关闭</button>'}
      </div>
      <div class="share-card-actions">
        ${canNativeShare ? `<button type="button" class="secondary-button" id="native-share-card">系统分享</button>` : ""}
        <a class="primary-button" id="download-share-card" href="${rendered.dataUrl}" download="${esc(rendered.filename)}">${icon("download", 15)} 下载 PNG 图片</a>
      </div>
    </footer>
  </div>`, false, "report");

  let renderSeq = 0;
  $$("[data-share-style]", dialog).forEach((tab) => {
    tab.addEventListener("click", async () => {
      const nextStyle = tab.dataset.shareStyle;
      if (!nextStyle || nextStyle === activeStyle) return;
      activeStyle = nextStyle;
      try { localStorage.setItem("ironlog-share-style", activeStyle); } catch {}
      $$("[data-share-style]", dialog).forEach((btn) => {
        const isCurrent = btn.dataset.shareStyle === activeStyle;
        btn.classList.toggle("is-active", isCurrent);
        btn.setAttribute("aria-selected", String(isCurrent));
      });
      const seq = ++renderSeq;
      const frame = $(".share-card-frame", dialog);
      frame?.setAttribute("aria-busy", "true");
      try {
        const nextRendered = await renderDailyShareCard(payload, activeStyle);
        if (seq !== renderSeq || !dialog.open) return;
        rendered = nextRendered;
        const imgEl = $("#share-card-preview-img", dialog);
        const dlEl = $("#download-share-card", dialog);
        if (imgEl) imgEl.src = rendered.dataUrl;
        if (dlEl) {
          dlEl.href = rendered.dataUrl;
          dlEl.download = rendered.filename;
        }
      } catch (err) {
        notify(err.message);
      } finally {
        if (seq === renderSeq) frame?.removeAttribute("aria-busy");
      }
    });
  });

  $("#back-to-report", dialog)?.addEventListener("click", () => { if (onBack) onBack(); });
  $("#native-share-card", dialog)?.addEventListener("click", async () => {
    try {
      const file = new File([rendered.blob], rendered.filename, { type: "image/png" });
      await navigator.share({ title: `${payload.dateDot} ${payload.headline}`, files: [file] });
    } catch {}
  });
}

async function openShareForDate(targetDate, { singleReport = null, singleHealth = null, onBack = null } = {}) {
  const dateKey = targetDate || today();
  const [sessionMod, workoutsAll, dietsAll, appleDay] = await Promise.all([
    loadSessionUi(),
    api("/api/records/workout").catch(() => []),
    api("/api/records/diet").catch(() => []),
    appleRange(dateKey, dateKey).catch(() => []),
    ensureLibraryCaches(),
  ]);
  const dayWorkouts = workoutsAll.filter((r) => !r.deleted && r.data?.status === "completed" && r.data?.date === dateKey);
  const dayDiets = dietsAll.filter((r) => !r.deleted && r.data?.date === dateKey);
  const payload = sessionMod.buildDailySharePayload({
    date: dateKey,
    todayKey: today(),
    workouts: singleReport ? [] : dayWorkouts,
    appleEntries: appleDay,
    diets: dayDiets,
    nutrition: dateKey === state.currentDay?.date ? state.currentDay?.nutrition : null,
    catalogueMap: state.catalogueById,
    username: state.username,
    isDemo: state.demo,
    singleReport,
    singleHealth,
  });
  await openDailyShareModal(payload, { onBack });
}
async function startRoutine(id, source = "plan", date = today()) {
  const [result, , { routinePreview }, , , statsFallback] = await Promise.all([
    api("/api/web/routine?" + new URLSearchParams({ id, source, date })),
    ensureLibraryCaches(),
    loadSessionUi(),
    getEditor(),
    ensureTodayMeta(),
    state.data?.muscleStatus ? Promise.resolve(null) : api("/api/web/statistics?days=7").catch(() => null),
  ]);
  const todayKey = today();
  const muscleStatus = state.data?.muscleStatus ?? statsFallback?.muscleStatus ?? [];
  open(result.name, routinePreview(result, { date, todayDate: todayKey, allowEditSchedule: source === "scheduled" || date > todayKey, muscleStatus }), true, "report");
  $("#edit-scheduled-day", dialog)?.addEventListener("click", () => openScheduleModal(date));
  $("#launch-routine", dialog).addEventListener("click", async () => {
    const ed = await getEditor();
    const exerciseMeta = result.exercises.map(({ exerciseId, progression, pr, backup }) => ({ exerciseId, progression, pr, backup }));
    const exercises = result.exercises.map(({ exerciseId, targetIndex, restSeconds, supersetGroup, snapshot, sets, weight, reps, seconds }) => ({
      id: crypto.randomUUID(),
      exerciseId,
      targetIndex,
      restSeconds,
      supersetGroup: supersetGroup ?? null,
      snapshot,
      sets: Array.from({ length: sets }, () => ({
        id: crypto.randomUUID(), type: "normal", weight, reps, seconds, completed: false, rir: null,
      })),
    }));
    ed.edit("workout", undefined, state.data?.goals ?? {}, {
      title: result.name, exercises, exerciseMeta, templateKey: source + "_" + result.routineId,
      planId: result.planId, planVersion: result.planVersion, routineId: result.routineId, targetSnapshot: result.targetSnapshot,
    });
  });
}

async function openScheduleModal(date) {
  const { openDayScheduler } = await loadPlanUi();
  await openDayScheduler({
    api, date, todayDate: today(), open, dialog, notify,
    onSaved: async (savedDate) => {
      dataEpoch++;
      state.dayCache.clear();
      if (state.view === "overview") state.weekDate = savedDate;
      if (state.view === "calendar") { state.date = savedDate; state.month = savedDate.slice(0, 7); }
      await renderRoute();
    },
    onStartPreview: (previewDate) => { void startRoutine(previewDate, "scheduled", previewDate); },
  });
}
function scrollPanel(id, control, value) {
  const panel = document.getElementById("panel-" + id);
  if (document.activeElement === document.body && panel)
    $$(`[data-action="${control}"]`, panel).find((item) => item.dataset.value === value)?.focus({ preventScroll: true });
}

function clearChartTips(root = content) {
  $$(".chart-hit.is-active", root).forEach((el) => el.classList.remove("is-active"));
  $$("[data-chart-readout]", root).forEach((el) => { el.textContent = ""; });
}
function showChartTip(target) {
  const tipTarget = target.closest?.("[data-chart-tip]");
  if (!tipTarget) return;
  const wrap = tipTarget.closest(".chart-wrap");
  if (!wrap) return;
  $$(".chart-hit.is-active", wrap).forEach((el) => { if (el !== tipTarget) el.classList.remove("is-active"); });
  tipTarget.classList.add("is-active");
  const readout = $("[data-chart-readout]", wrap);
  if (readout) readout.textContent = tipTarget.dataset.chartTip;
}
function updateAtlasReadout(panel, hoverPart = "") {
  if (!panel || !state.data) return;
  const target = hoverPart || state.muscle || "";
  const text = formatAtlasPill(state.data, state.atlasMode || "volume", target);
  const pill = $("[data-atlas-pill]", panel);
  const hint = $("[data-atlas-hint]", panel);
  const clearBtn = $("[data-atlas-clear]", panel);
  if (pill) {
    pill.textContent = text;
    pill.hidden = !text;
  }
  if (hint) hint.hidden = !!text;
  if (clearBtn) clearBtn.hidden = !state.muscle;
}
function selectMuscle(part, focusValue = "") {
  if (!state.data) return;
  state.muscle = part === state.muscle ? "" : part;
  const panel = $("#panel-muscle", content);
  if (panel) {
    const selected = state.muscle;
    $$(".atlas-layer", panel).forEach((layer) => {
      const isSel = !!selected && layer.dataset.muscle === selected;
      const isDim = !!selected && layer.dataset.muscle !== selected;
      layer.classList.toggle("is-selected", isSel);
      layer.classList.toggle("is-dimmed", isDim);
    });
    $$(".muscle-line", panel).forEach((line) => {
      const val = line.dataset.value || "";
      const isSel = !!selected && val === selected;
      const isDim = !!selected && val !== selected;
      line.classList.toggle("is-selected", isSel);
      line.classList.toggle("is-dimmed", isDim);
      line.setAttribute("aria-pressed", String(isSel));
    });
    updateAtlasReadout(panel, $("[data-atlas]", panel)?.dataset.hover || "");
  } else {
    overview(state.data);
  }
  if (focusValue !== null) {
    $(`#panel-muscle [data-action="muscle"][data-value="${focusValue}"]`, content)?.focus({ preventScroll: true });
  }
}
function setAtlasHover(panel, part) {
  if (!panel) return;
  const atlas = $("[data-atlas]", panel);
  const nextPart = part || "";
  if (atlas) {
    if ((atlas.dataset.hover || "") === nextPart) return;
    if (nextPart) atlas.dataset.hover = nextPart;
    else delete atlas.dataset.hover;
  }
  $$(".atlas-layer", panel).forEach((layer) => layer.classList.toggle("is-hovered", !!nextPart && layer.dataset.muscle === nextPart));
  $$(".muscle-line", panel).forEach((line) => line.classList.toggle("is-hovered", !!nextPart && line.dataset.value === nextPart));
  updateAtlasReadout(panel, nextPart);
}
let contentTouchX = 0, contentTouchY = 0, contentTouchAt = 0;
let activeSwipeRow = null, activeSwipeBtn = null, contentSwipeAxis = "";

async function handleRecordSwipe(rowEl, direction) {
  const kind = rowEl.dataset.swipeKind;
  const recordId = rowEl.dataset.recordId;
  const record = state.records.find((r) => r.id === recordId && (!kind || r.kind === kind));
  if (!record) return;
  try {
    if (direction === "left") {
      // Swipe Left -> Quick Delete with Undo toast
      const res = await api("/api/records", {
        method: "POST",
        body: { opId: crypto.randomUUID(), id: record.id, kind: record.kind, baseVersion: record.version, deleted: true, data: record.data },
      });
      state.badges = null;
      const undoVersion = res?.record?.version ?? (record.version + 1);
      const restore = async () => {
        try {
          await api("/api/records", {
            method: "POST",
            body: { opId: crypto.randomUUID(), id: record.id, kind: record.kind, baseVersion: undoVersion, deleted: false, data: record.data },
          });
          state.badges = null;
          await loadRecords(record.kind, requestId);
          notify("已撤销删除");
        } catch (err) {
          notify(err?.message || "撤销失败，可能已被修改");
        }
      };
      if (record.kind === "diet") {
        await loadRecords("diet", requestId);
        notify(`已删除「${record.data.name}」`, { label: "撤销", onClick: restore });
      } else if (record.kind === "weight") {
        await loadRecords("weight", requestId);
        notify(`已删除 ${shortDate(record.data.date)} 体重记录`, { label: "撤销", onClick: restore });
      }
    } else if (direction === "right" && record.kind === "diet") {
      // Swipe Right on Diet item -> Duplicate (+1 serving)
      await copyDietFoods({
        date: record.data.date,
        meal: record.data.meal,
        foods: [record.data],
        source: "copy",
        label: `已再来一份「${record.data.name}」(+${fmt(record.data.calories, 0)} kcal)`,
      });
    }
  } catch (err) {
    notify(err?.message || "操作失败");
  }
}

function resetContentSwipe() {
  if (!activeSwipeRow) return;
  const rowEl = activeSwipeRow;
  const btnEl = activeSwipeBtn;
  activeSwipeRow = null;
  activeSwipeBtn = null;
  contentSwipeAxis = "";
  if (btnEl) {
    btnEl.style.transition = "transform .18s ease";
    btnEl.style.transform = "";
  }
  rowEl.classList.remove("is-swiping-left", "is-swiping-right");
}

content.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return;
  if (e.touches[0].clientX < 20) {
    contentTouchX = -1;
    activeSwipeRow = null;
    activeSwipeBtn = null;
    return;
  }
  contentTouchX = e.touches[0].clientX;
  contentTouchY = e.touches[0].clientY;
  contentTouchAt = Date.now();
  contentSwipeAxis = "";
  if (e.target.closest?.(".muscle-pills, .segments, .apple-table-scroll, .activity-scroll, .preset-chips")) {
    activeSwipeRow = null;
    activeSwipeBtn = null;
    return;
  }
  activeSwipeRow = e.target.closest?.(".swipe-row");
  activeSwipeBtn = activeSwipeRow ? $(".record-line", activeSwipeRow) : null;
  if (activeSwipeBtn) activeSwipeBtn.style.transition = "none";
}, { passive: true });

content.addEventListener("touchmove", (e) => {
  if (contentTouchX < 0 || !activeSwipeRow || !activeSwipeBtn || e.touches.length !== 1) return;
  const dx = e.touches[0].clientX - contentTouchX;
  const dy = e.touches[0].clientY - contentTouchY;
  if (!contentSwipeAxis) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    contentSwipeAxis = Math.abs(dx) > Math.abs(dy) * 1.35 ? "x" : "y";
  }
  if (contentSwipeAxis !== "x") return;
  const allowRight = activeSwipeRow.dataset.swipeKind === "diet";
  const clamped = Math.max(-96, Math.min(allowRight ? 96 : 0, dx * 0.78));
  activeSwipeBtn.style.transform = `translateX(${clamped.toFixed(1)}px)`;
  activeSwipeRow.classList.toggle("is-swiping-left", clamped < -24);
  activeSwipeRow.classList.toggle("is-swiping-right", allowRight && clamped > 24);
}, { passive: true });

content.addEventListener("touchcancel", resetContentSwipe, { passive: true });

content.addEventListener("touchend", (e) => {
  if (contentTouchX < 0) { resetContentSwipe(); return; }
  if (e.changedTouches.length !== 1) { resetContentSwipe(); return; }
  const dx = e.changedTouches[0].clientX - contentTouchX;
  const dy = e.changedTouches[0].clientY - contentTouchY;
  const elapsed = Date.now() - contentTouchAt;

  if (activeSwipeRow && contentSwipeAxis === "x") {
    const targetRow = activeSwipeRow;
    const allowRight = targetRow.dataset.swipeKind === "diet";
    resetContentSwipe();
    if (Math.abs(dx) >= 62 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) {
        void handleRecordSwipe(targetRow, "left");
        return;
      }
      if (dx > 0 && allowRight) {
        void handleRecordSwipe(targetRow, "right");
        return;
      }
    }
    return;
  }
  resetContentSwipe();

  // Page-level horizontal swipe on Diet (prev/next day) or Calendar (prev/next month)
  if (elapsed < 480 && Math.abs(dx) >= 68 && Math.abs(dx) > Math.abs(dy) * 1.8) {
    if (e.target.closest?.("input, select, textarea, .muscle-pills, .segments, .apple-table-scroll, .activity-scroll, .hydration-actions, .meal-quick-chips, .recent-food-chips, .workout-filter-bar, .workspace-tabs, .badge-filters, .plan-sections")) return;
    if (state.view === "diet") {
      const nextDate = shiftDateStr(state.date, dx < 0 ? 1 : -1);
      if (nextDate >= "1902-01-01" && nextDate <= today()) {
        void changeDietDate(nextDate);
      }
    } else if (state.view === "calendar" && e.target.closest?.(".panel.calendar")) {
      const delta = dx < 0 ? 1 : -1;
      const btn = $(`[data-action="month"][data-value="${delta}"]`, content);
      if (btn && !btn.disabled) btn.click();
    }
  }
}, { passive: true });

content.addEventListener("pointerover", ({ target }) => {
  showChartTip(target);
  const row = target.closest?.('#panel-muscle .muscle-line[data-value]');
  if (row) setAtlasHover(row.closest("#panel-muscle"), row.dataset.value);
});
content.addEventListener("pointermove", (event) => {
  const atlas = event.target.closest?.("[data-atlas]");
  if (!atlas) return;
  const part = hitTestAtlas(atlas, event.clientX, event.clientY);
  if ((atlas.dataset.hover || "") !== part) setAtlasHover(atlas.closest("#panel-muscle"), part);
});
content.addEventListener("focusin", ({ target }) => showChartTip(target));
content.addEventListener("focusout", ({ target, relatedTarget }) => {
  const wrap = target.closest?.(".chart-wrap");
  if (wrap && (!relatedTarget || !wrap.contains(relatedTarget))) clearChartTips(wrap);
});
content.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const wrap = event.target.closest?.(".chart-wrap");
    if (wrap) clearChartTips(wrap);
  }
});
content.addEventListener("click", async (event) => {
  const { target } = event;
  const atlas = target.closest?.("[data-atlas]");
  if (atlas && !target.closest("[data-action]")) {
    await preloadAtlasMasks();
    const part = hitTestAtlas(atlas, event.clientX, event.clientY);
    if (part) selectMuscle(part, null);
    return;
  }
  if (target.closest("[data-chart-tip]")) { showChartTip(target); return; }
  $$("[data-chart-readout]", content).forEach((el) => {
    const wrap = el.closest(".chart-wrap");
    if (wrap && !wrap.contains(document.activeElement)) clearChartTips(wrap);
  });
});
content.addEventListener("pointerout", ({ target, relatedTarget }) => {
  const wrap = target.closest?.(".chart-wrap");
  if (wrap && (!relatedTarget || !wrap.contains(relatedTarget))) {
    if (!wrap.contains(document.activeElement)) clearChartTips(wrap);
  }
  const musclePanel = target.closest?.("#panel-muscle");
  if (musclePanel && (!relatedTarget || !relatedTarget.closest?.("[data-atlas], .muscle-bars"))) {
    setAtlasHover(musclePanel, "");
  }
});

document.addEventListener("click", async (event) => {
  const quickOpenBtn = event.target.closest("[data-quick-open]");
  if (quickOpenBtn) {
    await openQuickRecord(quickOpenBtn.dataset.quickOpen);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, value } = button.dataset;
  try {
    if (action === "route") route(value);
    if (action === "settings-open") { if (dialog.open) { suppressNextHistoryBack = true; dialog.close(); } state.settingsSection = value; route("settings"); }
    if (action === "plan-section" || action === "settings-section") {
      state[action === "plan-section" ? "planSection" : "settingsSection"] = value;
      $$("[data-section]", content).forEach((panel) => { panel.hidden = panel.dataset.section !== value; });
      const groupSel = action === "plan-section" ? '.plan-sections [data-action="plan-section"]' : '[data-action="settings-section"]';
      $$(groupSel, content).forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.value === value)));
      centerActivePills(content, true);
    }
    if (action === "training-today") { state.trainingSource = "all"; state.shownWorkouts = 15; route("workout"); }
    if (action === "training-source") {
      state.trainingSource = value;
      state.shownWorkouts = 15;
      renderWorkoutHistory();
      $$('[data-action="training-source"]').find((item) => item.dataset.value === value)?.focus({ preventScroll: true });
    }
    if (action === "workout-muscle") {
      state.workoutMuscle = value;
      state.shownWorkouts = 15;
      const body = $("#workout-history-body", content);
      if (body) {
        body.innerHTML = renderWorkoutHistoryBody();
        $$('[data-action="workout-muscle"]', content).forEach((btn) =>
          btn.setAttribute("aria-pressed", String((btn.dataset.value ?? "") === state.workoutMuscle)));
        centerActivePills(content, true);
      } else {
        renderWorkoutHistory();
      }
    }
    if (action === "delete-workout-template") {
      const tpl = state.planCache?.templates?.find((r) => r.id === value);
      if (tpl) {
        openConfirmDialog({
          title: "删除训练模板",
          message: `确定要删除模板「${tpl.data.name}」吗？删除后将无法通过模板列表一键复用。`,
          confirmLabel: "删除模板",
          onConfirm: async () => {
            await api("/api/records", {
              method: "POST",
              body: { opId: crypto.randomUUID(), id: tpl.id, kind: "template", baseVersion: tpl.version, deleted: true, data: tpl.data },
            });
            state.planCache = null;
            await loadPlan(requestId);
            notify(`已删除模板「${tpl.data.name}」`);
          },
        });
      }
    }
    if (action === "more-menu") openMore();
    if (action === "open-onboarding") { triggerOpenOnboarding(1); return; }
    if (action === "open-onboarding-step") { triggerOpenOnboarding(Number(value) || 2); return; }
    if (action === "dismiss-welcome") {
      if (state.userId) localStorage.setItem(welcomeDismissedKey(state.userId), "1");
      $(".welcome-checklist", content)?.remove();
      return;
    }
    if (action === "plan-starters") {
      state.planSection = "starters";
      await route("plan");
      return;
    }
    if (action === "badge-category" || action === "badge-status") {
      if (action === "badge-category") state.badgeCategory = value;
      else state.badgeStatus = value;
      const host = $(".badge-sections", content);
      if (host && state.badges) {
        host.innerHTML = renderBadgeSections(state.badges, {
          category: state.badgeCategory,
          status: state.badgeStatus,
          query: state.badgeQuery,
          pinnedIds: getPinnedBadges(),
          appleHealthConnected: state.appleHealthConnected,
        });
        $$('[data-action="badge-category"]', content).forEach((btn) =>
          btn.setAttribute("aria-pressed", String((btn.dataset.value ?? "") === state.badgeCategory)));
        $$('[data-action="badge-status"]', content).forEach((btn) =>
          btn.setAttribute("aria-pressed", String((btn.dataset.value ?? "all") === state.badgeStatus)));
        if (action === "badge-category") centerActivePills(content, true);
      } else {
        renderBadges();
        $(`[data-action="${action}"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
      }
    }
    if (action === "badge-detail") {
      const summary = state.badges ?? await api("/api/web/badges").then((res) => (state.badges = res));
      const badge = summary?.badges?.find((item) => item.id === value);
      if (badge) open("成就徽章", badgeDetailModal(badge, { pinned: getPinnedBadges().includes(badge.id) }), false, "badge");
    }
    if (action === "toggle-pin-badge") {
      const targetBadge = state.badges?.badges?.find((item) => item.id === value);
      if (targetBadge && !targetBadge.unlocked && !getPinnedBadges().includes(value)) {
        notify("解锁该徽章后才能佩戴到首页");
        return;
      }
      const { list, pinned, replaced } = togglePinBadge(value);
      button.className = pinned ? "secondary-button is-pinned" : "primary-button";
      button.innerHTML = `${icon("bookmark", 15)} ${pinned ? "取消首页佩戴" : "佩戴到首页展示（最多 3 枚）"}`;
      if (state.view === "overview" && state.data && state.badges) {
        const strip = $(".badges-strip", content);
        if (strip) strip.outerHTML = badgesOverviewStrip(state.badges, list, { appleHealthConnected: state.appleHealthConnected });
      } else if (state.view === "badges" && state.badges) {
        const host = $(".badge-sections", content);
        if (host) host.innerHTML = renderBadgeSections(state.badges, {
          category: state.badgeCategory, status: state.badgeStatus, query: state.badgeQuery, pinnedIds: list, appleHealthConnected: state.appleHealthConnected,
        });
      }
      notify(pinned ? (replaced ? "已佩戴到首页成就栏（已替换最早一枚，最多 3 枚）" : "已佩戴到首页成就栏") : "已取消首页佩戴");
    }
    if (action === "theme") { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); nav(); }
    if (action === "close") dialog.close();
    if (action === "logout") {
      button.disabled = true;
      try { await logout(); } finally { button.disabled = false; }
    }
    if (action === "auth-mode" && !state.authenticating && value !== state.authMode && (value === "login" || value === "register")) {
      state.authName = $('#login-form input[name="username"]')?.value ?? "";
      state.authMode = value;
      loginPanel();
      $(`[data-action="auth-mode"][data-value="${value}"]`)?.focus();
    }
    if (action === "refresh") { dataEpoch++; state.dayCache.clear(); await renderRoute(); }
    if (action === "period") {
      state.period = Number(value);
      await loadOverview();
      $$('#content [data-action="period"]').find((item) => item.dataset.value === value)?.focus({ preventScroll: true });
    }
    if (action === "analytics-period") {
      state.analyticsPeriod = Number(value);
      await loadAnalytics(++requestId);
      $$('#content [data-action="analytics-period"]').find((item) => item.dataset.value === value)?.focus({ preventScroll: true });
    }
    if (action === "analytics-section" && value) {
      state.analyticsSection = value;
      renderAnalytics();
      $(`[data-action="analytics-section"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
    }
    if (action === "apple-body-metric" && value) {
      state.appleBodyChart = value;
      renderAnalytics();
    }
    if (action === "apple-recovery-metric" && value) {
      state.appleRecoveryChart = value;
      renderAnalytics();
    }
    if (action === "apple-workout-filter" && value) {
      state.appleWorkoutFilter = value;
      renderAnalytics();
      $(`[data-action="apple-workout-filter"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
    }
    if (action === "adopt-apple-weight") {
      const latestApple = [...(state.appleDailyWeightList ?? [])].reverse().find((row) => row.weightKg != null);
      if (!latestApple?.weightKg) { notify("未找到可采纳的 Apple 体重"); return; }
      const targetDate = latestApple.weightDate || latestApple.date || today();
      const existing = state.records.find((row) => row.id === `weight_${targetDate}`);
      button.disabled = true;
      try {
        await saveAppleWeightToRecord({ targetDate, weightKg: latestApple.weightKg, bodyFatPct: latestApple.bodyFatPct, existing });
        notify(`已将 ${shortDate(targetDate)} 体重更新为 ${fmt(latestApple.weightKg, 2)} kg`);
        await loadRecords("weight", requestId);
      } catch (error) {
        notify(error.message || "更新失败");
        button.disabled = false;
      }
      return;
    }
    if (action === "adopt-apple-weight-analytics") {
      const ad = state.analyticsData?.appleDaily;
      const br = ad?.bodyReport;
      const lb = ad?.latestBody;
      const weightKg = br?.weightKg ?? lb?.weightKg?.value ?? state.analyticsData?.userProfile?.appleWeightKg;
      if (!weightKg) { notify("未找到可采纳的 Apple 体重"); return; }
      const targetDate = br?.measuredAt?.weightDate ?? lb?.weightKg?.date ?? today();
      const bodyFatPct = br?.bodyFatPct ?? lb?.bodyFatPct?.value ?? null;
      button.disabled = true;
      try {
        const weights = await api("/api/records/weight").catch(() => []);
        const existing = weights.find((row) => row.id === `weight_${targetDate}`);
        await saveAppleWeightToRecord({ targetDate, weightKg, bodyFatPct, existing });
        notify(`已将 ${shortDate(targetDate)} 体重同步为 ${fmt(weightKg, 2)} kg`);
        await loadAnalytics(requestId);
      } catch (error) {
        notify(error.message || "同步体重失败");
        button.disabled = false;
      }
      return;
    }
    if (action === "apply-apple-targets") {
      const br = state.analyticsData?.appleDaily?.bodyReport;
      if (!br?.metabolic) { notify("缺少瘦体重代谢测算数据"); return; }
      button.disabled = true;
      try {
        const { profile, version } = await api("/api/web/profile");
        const calories = br.metabolic.recompCutTargetKcal;
        const protein = br.metabolic.proteinTargetG;
        const fat = Math.max(40, Math.round((br.weightKg ?? 75) * 0.8));
        const carbs = Math.max(50, Math.round((calories - protein * 4 - fat * 9) / 4));
        const targetWeight = br.recomposition?.milestones?.[0]?.targetWeightKg ?? profile.targetWeight ?? null;
        const energyProfile = profile.energyProfile
          ? {
              ...profile.energyProfile,
              ...(br.heightCm ? { heightCm: br.heightCm } : {}),
              ...(br.weightKg ? { weightKg: br.weightKg, weightDate: br.measuredAt?.weightDate ?? today() } : {}),
            }
          : null;
        const updated = await api("/api/web/profile", {
          method: "PUT",
          body: {
            calories,
            protein,
            carbs,
            fat,
            targetWeight,
            daysPerWeek: profile.daysPerWeek,
            restSeconds: profile.restSeconds,
            energyProfile,
            version,
            opId: crypto.randomUUID(),
          },
        });
        if (state.data) state.data.goals = updated.profile;
        notify(`已写入目标：${calories} kcal · 蛋白 ${protein} g${targetWeight ? ` · 目标体重 ${targetWeight} kg` : ""}`);
        await loadAnalytics(requestId);
      } catch (error) {
        notify(error.message || "写入档案失败");
        button.disabled = false;
      }
      return;
    }
    if (action === "toggle-apple-workouts") {
      state.appleReportWorkoutsExpanded = !state.appleReportWorkoutsExpanded;
      renderAnalytics();
    }
    if (action === "toggle-apple-daily") {
      state.appleReportDailyExpanded = !state.appleReportDailyExpanded;
      renderAnalytics();
    }
    if (action === "print-report") {
      window.print();
    }
    if (action === "export-apple-csv") {
      const dailySummary = state.analyticsData?.appleDaily;
      const ts = state.analyticsData?.trainingSummary;
      const ad = dailySummary?.series ?? [];
      const activeWorkoutBucket = state.appleWorkoutFilter === "device" && state.analyticsData?.appleWorkouts?.realDeviceStats
        ? state.analyticsData.appleWorkouts.realDeviceStats
        : state.analyticsData?.appleWorkouts;
      const aw = activeWorkoutBucket?.recent ?? [];
      if (!ad.length && !aw.length && !(ts?.sessions > 0)) {
        notify("当前区间暂无可导出的健康与训练记录");
      } else {
        const csvCell = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;
        const br = dailySummary?.bodyReport;
        const rr = dailySummary?.recoveryReport;
        const lines = [
          ["记录类型", "日期", "名称/时段", "来源", "体重(kg)", "体脂(%)", "瘦体重(kg)", "BMI", "腰围(cm)", "FFMI", "WHtR腰高比", "Katch BMR(kcal)", "准备度评分", "静息HR", "即时HR", "HRV(ms)", "血氧(%)", "呼吸(/分)", "步数", "步行距离(km)", "楼层", "活动kcal", "静息kcal", "睡眠(分)", "训练时长(秒)"].map(csvCell).join(","),
          ...(ts?.sessions ? [[
            "力量训练汇总", state.analyticsData?.through ?? today(), `${ts.sessions}场·${ts.workSets}组·${ts.tonnageKg}kg吨位`, "铁记训练",
            "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
          ].map(csvCell).join(",")] : []),
          ...(br?.hasData || rr?.hasData ? [[
            "区间最新评估", state.analyticsData?.through ?? today(), rr?.readinessLabel ?? "", "汇总分析", br?.weightKg ?? "", br?.bodyFatPct ?? "", br?.leanBodyMassKg ?? "", br?.bmi ?? "", br?.waistCm ?? "",
            br?.ffmi ?? "", br?.whtr ?? "", br?.metabolic?.bmrKatchMcArdleKcal ?? "", rr?.readinessScore ?? "",
            "", "", "", "", "", "", "", "", "", "", "", "",
          ].map(csvCell).join(",")] : []),
          ...ad.map((r) => [
            "每日体征", r.date, "", "Apple 健康", r.weightKg, r.bodyFatPct, r.leanBodyMassKg, r.bmi, r.waistCm,
            "", "", "", "",
            r.restingHeartRateBpm, r.heartRateBpm, r.hrvMs, r.bloodOxygenPct, r.respiratoryRate,
            r.steps, r.distanceKm, r.flightsClimbed, r.activeEnergyKcal, r.restingEnergyKcal, r.sleepMinutes, "",
          ].map(csvCell).join(",")),
          ...aw.map((w) => [
            "运动记录", w.date, w.title, w.isDemo ? "示例" : (w.captureMethod === "trigger" ? "真机·触发" : "真机上传"), "", "", "", "", "",
            "", "", "", "",
            "", w.heartRate?.avgBpm ?? "", "", "", "",
            "", w.distanceMeters ? (w.distanceMeters / 1000).toFixed(2) : "", "", w.activeEnergyKcal ?? "", "", "", w.durationSeconds ?? "",
          ].map(csvCell).join(",")),
        ];
        const filterTag = state.appleWorkoutFilter === "device" ? "-仅真机" : "";
        downloadTextFile("\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8;", `铁记-健康训练分析报表-${state.analyticsData?.through || today()}${filterTag}.csv`);
        notify("已导出健康与训练 CSV 报表");
      }
    }
    if (action === "export-apple-json") {
      const ad = state.analyticsData?.appleDaily;
      const aw = state.analyticsData?.appleWorkouts;
      const ts = state.analyticsData?.trainingSummary;
      if (!ad?.series?.length && !aw?.totalCount && !(ts?.sessions > 0)) {
        notify("当前区间暂无可导出的健康与训练记录");
      } else {
        const payload = {
          exportedAt: new Date().toISOString(),
          through: state.analyticsData?.through ?? today(),
          periodDays: state.analyticsData?.period ?? state.analyticsPeriod,
          userProfile: state.analyticsData?.userProfile ?? null,
          trainingSummary: ts ?? null,
          appleDaily: ad ?? null,
          appleWorkouts: aw ?? null,
        };
        downloadTextFile(JSON.stringify(payload, null, 2), "application/json;charset=utf-8;", `铁记-健康训练体检报告-${state.analyticsData?.through || today()}.json`);
        notify("已导出完整健康与训练 JSON 报告");
      }
    }
    if (action === "metric") {
      state.metric = value;
      const host = $("#panel-load", content);
      if (host && state.data) host.outerHTML = loadPanel(state.data, state);
      else overview(state.data);
      scrollPanel("load", "metric", value);
    }
    if (action === "muscle") selectMuscle(value, value ? value : null);
    if (action === "atlas-mode") {
      state.atlasMode = value;
      const host = $("#panel-muscle", content);
      if (host && state.data) {
        host.outerHTML = muscleCard(state.data, state);
        $(`#panel-muscle [data-action="atlas-mode"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
      } else if (state.data) {
        overview(state.data);
      }
    }
    if (action === "open-csv-import") {
      openCsvImportModal();
    }
    if (action === "export-plan-json") {
      const planObj = state.plan?.data;
      if (planObj) exportPlanAsJson(planObj);
    }
    if (action === "open-plan-import") {
      openPlanImportModal();
    }
    if (action === "quick-start-exercise") {
      const customRec = state.customExercises.find((r) => !r.deleted && r.id === value);
      const exercise = customRec ? customRec.data : (await api("/api/catalogue/exercises/" + encodeURIComponent(value), { token: "" })).exercise;
      const [ed, profileRes] = await Promise.all([
        getEditor(),
        state.data?.goals ? Promise.resolve({ profile: state.data.goals }) : api("/api/web/profile").catch(() => ({ profile: {} })),
      ]);
      const timed = exercise.mode === "timed";
      if (dialog.open) dialog.close();
      ed.edit("workout", undefined, profileRes.profile ?? {}, {
        title: `${exercise.name}训练`,
        exercises: [{
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          targetIndex: null,
          supersetGroup: null,
          restSeconds: 90,
          snapshot: {
            name: exercise.name,
            muscle: exercise.muscle,
            equipment: exercise.equipment,
            mode: exercise.mode,
            volumeMultiplier: exercise.volumeMultiplier ?? 1,
          },
          sets: Array.from({ length: 3 }, () => ({
            id: crypto.randomUUID(),
            type: "normal",
            weight: 0,
            reps: timed ? 0 : 8,
            seconds: timed ? 45 : 0,
            completed: false,
            rir: null,
          })),
        }],
      });
    }
    if (action === "adopt-starter-plan") {
      const mode = button.dataset.mode === "draft" ? "draft" : "apply";
      if (mode === "apply" && state.plan?.data && button.dataset.confirm !== "true") {
        button.dataset.confirm = "true";
        button.textContent = "确认覆盖当前计划";
        return;
      }
      button.disabled = true;
      try {
        await api("/api/web/starter-plans/" + encodeURIComponent(value) + "/adopt", {
          method: "POST",
          body: { mode, expectedRevision: state.plan?.revision ?? 0 },
        });
        state.planSection = mode === "draft" ? "drafts" : "current";
        state.planCache = null;
        dataEpoch++;
        await loadPlan(requestId);
        notify(mode === "draft" ? "已存为计划草稿，可在「计划草稿」预览或修改" : "经典训练方案已启用！");
      } finally { button.disabled = false; }
    }
    if (action === "week-day") {
      const worked = button.classList.contains("is-active");
      const same = state.weekDate === value;
      if (same && !worked) {
        const refToday = state.data?.today || today();
        if (value < refToday) {
          const ed = await getEditor();
          ed.edit("workout", undefined, state.data?.goals ?? (await api("/api/web/profile")).profile, { date: value });
        } else {
          await openScheduleModal(value);
        }
        return;
      }
      state.weekDate = same ? "" : value;
      state.weekSummary = state.weekDate && worked ? "读取中…" : "";
      state.weekDetail = null;
      const host = $(".hero-week", content);
      if (host && state.data) {
        host.outerHTML = weekStrip(state.data.activity, state.data.today, state.weekDate, state.weekSummary, state.schedule?.days, null);
        $(`[data-action="week-day"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
      }
      if (state.weekDate && worked) {
        const seq = ++dayLookupSeq;
        const found = await loadWorkoutsForDate(value);
        if (seq !== dayLookupSeq || state.view !== "overview") return;
        state.weekSummary = formatDaySummary(found.manual, found.apple);
        const updated = $(".hero-week", content);
        if (updated && state.data) {
          updated.outerHTML = weekStrip(state.data.activity, state.data.today, state.weekDate, state.weekSummary, state.schedule?.days, null);
          $(`[data-action="week-day"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
        }
        await openDayWorkouts(value, found);
      } else if (state.weekDate && !worked) {
        const seq = ++dayLookupSeq;
        const detail = await api("/api/web/schedule/" + encodeURIComponent(value)).catch(() => null);
        if (seq !== dayLookupSeq || state.view !== "overview" || state.weekDate !== value) return;
        state.weekDetail = detail;
        const updated = $(".hero-week", content);
        if (updated && state.data) {
          updated.outerHTML = weekStrip(state.data.activity, state.data.today, state.weekDate, state.weekSummary, state.schedule?.days, detail);
          $(`[data-action="week-day"][data-value="${value}"]`, content)?.focus({ preventScroll: true });
        }
      }
    }
    if (action === "week-day-close") {
      state.weekDate = "";
      state.weekSummary = "";
      state.weekDetail = null;
      const host = $(".hero-week", content);
      if (host && state.data) {
        host.outerHTML = weekStrip(state.data.activity, state.data.today, "", "", state.schedule?.days, null);
      }
    }
    if (action === "schedule-day") await openScheduleModal(value);
    if (action === "schedule-preview") await startRoutine(value, "scheduled", value);
    if (action === "schedule-rest") {
      await api("/api/web/schedule/" + encodeURIComponent(value), {
        method: "PUT",
        body: { mode: "rest", title: "休息日", notes: "", exercises: [] },
      });
      state.dayCache.clear();
      if (state.view === "overview") state.weekDate = value;
      await renderRoute();
      notify(`${shortDate(value)} 已设为休息日`);
    }
    if (action === "schedule-shift") {
      const nextDate = shiftDateStr(value, 1);
      await api("/api/web/schedule/shift", { method: "POST", body: { fromDate: value, toDate: nextDate } });
      state.dayCache.clear();
      if (state.view === "overview") state.weekDate = nextDate <= (state.schedule?.days?.at(-1)?.date ?? nextDate) ? nextDate : "";
      if (state.view === "calendar") { state.date = nextDate; state.month = nextDate.slice(0, 7); }
      await renderRoute();
      notify(`训练已顺延至 ${shortDate(nextDate)}`);
    }
    if (action === "schedule-clear") {
      await api("/api/web/schedule/" + encodeURIComponent(value), { method: "DELETE" });
      state.dayCache.clear();
      await renderRoute();
      notify(`${shortDate(value)} 已恢复按计划顺排`);
    }
    if (action === "heatmap-day") {
      const worked = button.classList.contains("worked");
      const same = state.heatmapDate === value;
      state.heatmapDate = !worked && same ? "" : value;
      if (!state.heatmapDate) state.heatmapSummary = "";
      $$('[data-action="heatmap-day"]', content).forEach((cell) =>
        cell.setAttribute("aria-pressed", String(cell.dataset.value === state.heatmapDate)));
      const readout = $("[data-heatmap-readout]", content);
      if (!state.heatmapDate && readout && state.data) {
        const activeCount = state.data.activity.slice(-84).filter((c) => c.active).length;
        readout.textContent = `活跃 ${activeCount} 天`;
      } else if (state.heatmapDate && !worked && readout) {
        state.heatmapSummary = "";
        readout.innerHTML = `${shortDate(value)} · 未训练 <button type="button" class="heatmap-add" data-action="edit-for-date" data-value="${esc(value)}">补录</button>`;
      } else if (state.heatmapDate && worked) {
        const seq = ++dayLookupSeq;
        if (readout) readout.textContent = `${shortDate(value)} · 读取中…`;
        const found = await loadWorkoutsForDate(value);
        if (seq !== dayLookupSeq || state.view !== "overview") return;
        const summary = formatDaySummary(found.manual, found.apple);
        state.heatmapSummary = summary;
        const targetReadout = $("[data-heatmap-readout]", content);
        if (targetReadout) targetReadout.innerHTML = `<button type="button" class="heatmap-open" data-action="day-detail" data-value="${esc(value)}">${shortDate(value)} · ${esc(summary)} ${icon("chevron", 13)}</button>`;
        await openDayWorkouts(value, found);
      }
    }
    if (action === "day-detail") await openDayWorkouts(value);
    if (action === "edit-for-date") {
      const ed = await getEditor();
      ed.edit("workout", undefined, state.data?.goals ?? (await api("/api/web/profile")).profile, { date: value });
    }
    if (action === "date") { state.calendar = "all"; state.date = value; state.month = value.slice(0, 7); route("calendar"); }
    if (action === "calendar-mode") {
      state.calendar = value;
      const lens = ["all", "training", "diet"].includes(value) ? value : "all";
      const layout = $(".calendar-layout", content);
      if (layout) {
        layout.classList.remove("lens-all", "lens-training", "lens-diet");
        layout.classList.add("lens-" + lens);
        $$('[data-action="calendar-mode"]', content).forEach((btn) =>
          btn.setAttribute("aria-pressed", String(btn.dataset.value === lens)));
      } else {
        renderCalendar();
      }
    }
    if (action === "quick-record-sheet") { triggerHaptic("light"); openQuickRecordSheet(); }
    if (action === "open-day-dossier") { openCalendarDayModal(value || state.date); }
    if (action === "share-day-record") {
      button.disabled = true;
      try {
        await openShareForDate(value || state.date || today());
      } finally {
        button.disabled = false;
      }
    }
    if (action === "dossier-step") {
      const baseDate = button.dataset.date || state.date;
      const step = Number(button.dataset.step || 1);
      await stepCalendarDossier(shiftDateStr(baseDate, step));
    }
    if (action === "edit-weight-date") {
      const seed = {
        date: value || state.date,
        ...(button.dataset.weight ? { weight: Number(button.dataset.weight) } : {}),
        ...(button.dataset.bodyfat ? { bodyFat: Number(button.dataset.bodyfat) } : {}),
      };
      (await getEditor()).edit("weight", undefined, {}, seed);
    }
    if (action === "calendar-date") {
      state.date = value;
      state.calendarDetail = null;
      updateCalendarSelection(value);
      const isNarrow = matchMedia("(max-width: 850px)").matches;
      if (value >= today()) {
        const seq = ++dayLookupSeq;
        if (isNarrow) openCalendarDayModal(value);
        const detail = await api("/api/web/schedule/" + encodeURIComponent(value)).catch(() => null);
        if (seq === dayLookupSeq && state.view === "calendar" && state.date === value) {
          state.calendarDetail = detail;
          updateCalendarSelection(value);
          if (isNarrow && dialog.open && $(".cal-dossier.in-modal", dialog)) openCalendarDayModal(value);
        }
      } else if (isNarrow) {
        openCalendarDayModal(value);
      }
    }
    if (action === "calendar-today") {
      const month = today().slice(0, 7);
      const differentMonth = state.month !== month;
      state.month = month;
      state.date = today();
      if (differentMonth) await loadCalendar(++requestId);
      else updateCalendarSelection(state.date);
    }
    if (action === "month") {
      const selected = new Date(state.month + "-01T00:00:00Z");
      selected.setUTCMonth(selected.getUTCMonth() + Number(value));
      state.month = selected.toISOString().slice(0, 7);
      state.date = state.month === today().slice(0, 7) ? today() : state.month + "-01";
      await loadCalendar(++requestId);
    }
    if (action === "complete-diet") {
      const date = button.dataset.date || state.date;
      button.disabled = true;
      try {
        await completeDiet(date);
        if (state.view === "diet" && state.date === date) {
          state.dietDone = true;
          updateDietStatus();
        } else if (state.view === "calendar") {
          const wasModal = dialog.open && $(".cal-dossier.in-modal", dialog);
          await loadCalendar(++requestId);
          if (wasModal) openCalendarDayModal(date);
        }
      } finally { button.disabled = false; }
    }
    if (action === "diet-step") {
      const date = new Date(state.date + "T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + Number(value));
      await changeDietDate(date.toISOString().slice(0, 10));
    }
    if (action === "diet-today") await changeDietDate(today());
    if (action === "copy-diet-day") {
      const from = button.dataset.from, to = button.dataset.to;
      const items = state.records.filter((r) => r.kind === "diet" && r.data.date === from).map((r) => r.data);
      button.disabled = true;
      try { await copyDietFoods({ date: to, foods: items, source: "copy", label: `已复刻 ${shortDate(from)} 的 ${items.length} 项饮食` }); }
      finally { button.disabled = false; }
    }
    if (action === "copy-diet-meal") {
      const meal = button.dataset.meal, from = button.dataset.from, to = button.dataset.to;
      const items = state.records.filter((r) => r.kind === "diet" && r.data.date === from && r.data.meal === meal).map((r) => r.data);
      button.disabled = true;
      try { await copyDietFoods({ date: to, meal, foods: items, source: "copy", label: `已复刻昨日${meals[meal]}（${items.length} 项）` }); }
      finally { button.disabled = false; }
    }
    if (action === "save-meal-template") {
      const meal = button.dataset.meal;
      const entries = state.records.filter((r) => r.kind === "diet" && r.data.date === state.date && r.data.meal === meal);
      if (entries.length) openSaveMealTemplateModal(meal, entries);
    }
    if (action === "apply-meal-template") {
      const tpl = state.mealTemplates.find((r) => r.id === button.dataset.id);
      const meal = button.dataset.meal;
      if (tpl) {
        button.disabled = true;
        try { await copyDietFoods({ date: state.date, meal, foods: tpl.data.foods, source: "manual", label: `已将「${tpl.data.name}」填入${meals[meal]}` }); }
        finally { button.disabled = false; }
      }
    }
    if (action === "delete-meal-template") {
      const tpl = state.mealTemplates.find((r) => r.id === value);
      if (tpl) {
        openConfirmDialog({
          title: "删除常用餐单",
          message: `确定要删除餐单「${tpl.data.name}」吗？此操作不可撤销。`,
          confirmLabel: "删除餐单",
          onConfirm: async () => {
            await api("/api/records", { method: "POST", body: { opId: crypto.randomUUID(), id: tpl.id, kind: "mealTemplate", baseVersion: tpl.version, deleted: true, data: tpl.data } });
            state.mealTemplates = state.mealTemplates.filter((r) => r.id !== tpl.id);
            if (state.recordsCache.diet) state.recordsCache.diet.mealTemplates = state.mealTemplates;
            renderDiet();
            notify(`已删除餐单「${tpl.data.name}」`);
          },
        });
      }
    }
    if (action === "edit-meal-template") {
      const tpl = state.mealTemplates.find((r) => r.id === value);
      if (tpl) openEditMealTemplateModal(tpl);
    }
    if (action === "cycle-water-goal") {
      const nextGoal = cycleWaterGoalMl();
      updateDietHydration();
      notify(`每日饮水目标已设为 ${fmt(nextGoal, 0)} ml`);
    }
    if (action === "open-trained-prs") {
      state.catalogueScope = "trained";
      state.trainedSort = "1rm";
      route("exercises");
    }
    if (action === "record-meal") {
      const [ed] = await Promise.all([getEditor(), ensureRecentFoodsCache()]);
      ed.edit("diet", undefined, {}, { date: state.date, meal: value });
    }
    if (action === "edit") {
      const [ed] = await Promise.all([
        getEditor(),
        value === "workout" ? ensureLibraryCaches() : null,
        value === "workout" ? ensureTodayMeta() : null,
      ]);
      ed.edit(value, undefined, state.data?.goals ?? (value === "workout" ? (await api("/api/web/profile")).profile : {}));
    }
    if (action === "water-delta" || action === "water-reset") {
      button.disabled = true;
      const targetDate = state.date;
      try {
        const payload = action === "water-reset"
          ? { date: targetDate, setMl: 0 }
          : { date: targetDate, deltaMl: Number(value) || 250 };
        const res = await api("/api/web/water", { method: "POST", body: payload });
        const appliedDate = res.date ?? targetDate;
        if (state.recordsCache.diet) {
          state.recordsCache.diet.epoch = dataEpoch;
          state.recordsCache.diet.waterByDate?.set(appliedDate, res.waterMl);
        }
        if (state.currentDay?.date === appliedDate) {
          state.currentDay.waterMl = res.waterMl;
          if (state.currentDay.appleDaily) state.currentDay.appleDaily.waterMl = res.waterMl;
        }
        if (state.view === "diet" && state.date === appliedDate) {
          state.dietWaterMl = res.waterMl;
          updateDietHydration();
        }
        notify(action === "water-reset" ? "已重置今日饮水记录" : `今日饮水 ${fmt(res.waterMl, 0)} ml`);
      } finally { button.disabled = false; }
    }
    if (action === "add-measurement") {
      openMeasurementModal(null);
    }
    if (action === "edit-measurement") {
      const existing = state.measurements.find((m) => m.date === value) ?? null;
      if (existing) openMeasurementModal(existing);
    }
    if (action === "edit-record") {
      const targetKind = button.dataset.kind;
      const record = state.records.find((row) => row.id === value && (!targetKind || row.kind === targetKind));
      if (record?.kind === "workout" && record.data.status === "completed") await showReport(record.id, record);
      else if (record) {
        const [ed] = await Promise.all([
          getEditor(),
          record.kind === "workout" ? ensureLibraryCaches() : record.kind === "diet" ? ensureRecentFoodsCache() : null,
          record.kind === "workout" ? ensureTodayMeta() : null,
        ]);
        ed.edit(record.kind, record, state.data?.goals);
      }
    }
    if (action === "new-plan" || action === "edit-active-plan") {
      const existingPlan = action === "edit-active-plan" ? state.plan : null;
      const { openPlanBuilder } = await loadPlanUi();
      await openPlanBuilder({
        api,
        existingPlan,
        catalogueMap: new Map(),
        open, dialog, notify,
        onSaved: async (section) => {
          dataEpoch++;
          state.planSection = section || "current";
          state.dayCache.clear();
          await renderRoute();
        },
      });
    }
    if (action === "open-strength-calc") {
      (await loadCalcUi()).openStrengthCalculator({ open, dialog });
    }
    if (action === "new-workout-template" || action === "edit-workout-template") {
      const existingTemplate = action === "edit-workout-template"
        ? state.planCache?.templates?.find((r) => r.id === value) ?? null
        : null;
      const { openTemplateEditor } = await loadPlanUi();
      await openTemplateEditor({
        api,
        existingTemplate,
        catalogueMap: state.planCache?.map ?? new Map(),
        open, dialog, notify,
        onSaved: async () => {
          dataEpoch++;
          state.planCache = null;
          state.planSection = "templates";
          state.dayCache.clear();
          await renderRoute();
        },
      });
    }
    if (action === "ai-plan") {
      const [{ openAiPlan }, status] = await Promise.all([loadAiUi(), getAiStatus()]);
      openAiPlan({
        api, dialog, open, notify,
        status,
        activePlan: state.plan,
        onDone: async (result) => {
          dataEpoch++;
          if (result?.record) state.planSection = "drafts";
          if (state.view === "plan") await renderRoute();
        },
      });
    }
    if (action === "ai-review") {
      const [{ openAiReview }, status] = await Promise.all([loadAiUi(), getAiStatus()]);
      openAiReview({ api, dialog, open, notify, status });
    }
    if (action === "ai-diet") {
      const [{ openAiDiet }, status] = await Promise.all([loadAiUi(), getAiStatus()]);
      openAiDiet({
        api, dialog, open, notify,
        status,
        date: state.view === "diet" ? state.date : today(),
        meal: guessMeal(),
        refresh: async (_kind, date) => {
          dataEpoch++;
          state.badges = null;
          if (state.view === "diet") state.date = date;
          await renderRoute();
        },
      });
    }
    if (action === "ai-workout") {
      const [{ openAiWorkout }, ed, status, profile] = await Promise.all([
        loadAiUi(),
        getEditor(),
        getAiStatus(),
        state.data?.goals ? { profile: state.data.goals } : api("/api/web/profile").catch(() => null),
      ]);
      openAiWorkout({
        api, dialog, open, notify, status,
        date: today(),
        goals: profile?.profile ?? {},
        editor: ed, showReport,
        refresh: async () => {
          dataEpoch++;
          state.badges = null;
          await renderRoute();
        },
      });
    }
    if (action === "today-routine") {
      const plannedSource = state.currentDay?.planned?.source;
      const isScheduled = plannedSource === "scheduled" && /^\d{4}-\d{2}-\d{2}$/.test(value);
      await startRoutine(value, isScheduled ? "scheduled" : "plan", isScheduled ? value : today());
    }
    if (action === "today-diet") {
      const [ed] = await Promise.all([getEditor(), ensureRecentFoodsCache()]);
      ed.edit("diet", undefined, {}, { date: today(), meal: guessMeal() });
    }
    if (action === "today-weight") {
      await openQuickRecord("weight");
    }
    if (action === "more-weights") {
      const index = state.shownWeights;
      state.shownWeights += 12;
      renderWeight();
      $$(".weight-line")[index]?.focus({ preventScroll: true });
    }
    if (action === "more-workouts") {
      const index = state.shownWorkouts;
      state.shownWorkouts += 15;
      renderWorkoutHistory();
      $$(".training-history .record-line")[index]?.focus({ preventScroll: true });
    }
    if (action === "start-routine") {
      const { id, source } = state.routines[Number(value)];
      await startRoutine(id, source);
    }
    if (action === "workout-detail") {
      const [record, ed] = await Promise.all([
        api("/api/web/records/workout/" + encodeURIComponent(value)),
        getEditor(),
        ensureLibraryCaches(),
        ensureTodayMeta(),
      ]);
      if (record.data.status === "completed") await showReport(record.id, record);
      else ed.edit("workout", record, state.data?.goals);
    }
    if (action === "resume-live-workout") {
      const liveActive = state.currentDay?.active;
      if (liveActive?.id) {
        const [record, ed] = await Promise.all([
          api("/api/web/records/workout/" + encodeURIComponent(liveActive.id)),
          getEditor(),
          ensureLibraryCaches(),
          ensureTodayMeta(),
        ]);
        ed.edit("workout", record, state.data?.goals);
      } else {
        const draft = findLocalWorkoutDraft();
        if (!draft || draft.suffix === "new") {
          await openQuickRecord("workout");
        } else if (draft.suffix.startsWith("template:")) {
          const [ed] = await Promise.all([getEditor(), ensureLibraryCaches(), ensureTodayMeta()]);
          ed.edit("workout", undefined, state.data?.goals, { templateKey: draft.suffix.slice("template:".length) });
        } else {
          const recId = draft.suffix.split(":")[0];
          try {
            const [record, ed] = await Promise.all([
              api("/api/web/records/workout/" + encodeURIComponent(recId)),
              getEditor(),
              ensureLibraryCaches(),
              ensureTodayMeta(),
            ]);
            ed.edit("workout", record, state.data?.goals);
          } catch {
            await openQuickRecord("workout");
          }
        }
      }
    }
    if (action === "apple-activity") {
      let item = value ? [...state.appleEntries, ...(state.currentDay?.apple ?? []), ...(reportApple ? [reportApple] : [])].find((row) => row.id === value) : null;
      if (!item && button.dataset.date) {
        const { date, type, title } = button.dataset;
        const pool = state.currentDay?.date === date ? (state.currentDay.apple ?? []) : await appleRange(date, date);
        item = pool.find((row) => (value && row.id === value) || (row.date === date && (row.activityType === type || row.title === title))) ?? pool[0];
      }
      if (item) open("Apple 健康训练", appleWorkoutDetails(item, button.closest(".workout-report") !== null), true, "report");
    }
    if (action === "apple-daily-detail") {
      const targetDate = button.dataset.date || today();
      let item = state.currentDay?.date === targetDate ? state.currentDay?.appleDaily
        : state.calendarDaily.get(targetDate) ?? state.analyticsData?.appleDaily?.series?.find((row) => row.date === targetDate) ?? null;
      if (!item) {
        const list = await appleDailyRange(targetDate, targetDate).catch(() => []);
        item = list[0] ?? null;
      }
      if (item) open(`${shortDate(targetDate)} · Apple 健康档案`, appleDailyDetailsModal(item), true, "report");
      else notify("这一天暂无 Apple 健康指标");
    }
    if (action === "more-catalogue") { button.disabled = true; await catalogueSearch(true); }
    if (action === "retry-catalogue") await catalogueSearch();
    if (action === "exercise-detail") await exerciseDetail(value);
    if (action === "create-exercise") openCreateExerciseModal();
    if (action === "edit-custom-exercise") {
      const existing = state.customExercises.find((r) => !r.deleted && r.id === value);
      if (existing) openCreateExerciseModal({ existing });
    }
    if (action === "toggle-favorite" || action === "toggle-favorite-modal") {
      button.disabled = true;
      try {
        const nowFav = await toggleFavorite(value);
        if (action === "toggle-favorite-modal") {
          button.classList.toggle("is-faved", nowFav);
          button.innerHTML = `${icon(nowFav ? "starFilled" : "star", 15)} ${nowFav ? "已收藏" : "收藏动作"}`;
          if (state.view === "exercises") void catalogueSearch();
        } else {
          if (state.view === "exercises") {
            if (state.catalogueScope === "favorites" && !nowFav) void catalogueSearch();
            else {
              button.classList.toggle("is-active", nowFav);
              button.setAttribute("aria-pressed", String(nowFav));
              button.setAttribute("aria-label", nowFav ? "取消收藏" : "收藏动作");
              button.innerHTML = icon(nowFav ? "starFilled" : "star", 15);
              button.closest(".exercise-card-shell")?.classList.toggle("is-fav", nowFav);
            }
          }
        }
      } finally { button.disabled = false; }
    }
    if (action === "copy-exercise") {
      if (await copyText(value)) notify("动作名已复制");
      else notify("无法自动复制，请长按标题复制");
    }
    if (action === "issue-device") await openDevice();
    if (action === "import-health-data") openHealthDataImport({ api, open, onImported: async () => { dataEpoch++; state.dayCache.clear(); await refreshAccountMeta(); if (state.view === "settings") await renderRoute(); } });
    if (action === "connect-health-export") await openHealthDataWebhook({ api, open, notify, refresh: async () => { await refreshAccountMeta(); await renderRoute(); } });
    if (action === "copy-token") {
      const issuedVal = $('[name="issued"]')?.value ?? "";
      if (await copyText(issuedVal)) notify("上传令牌已复制");
      else notify("请长按令牌输入框复制");
    }
    if (action === "revoke-device") {
      if (button.dataset.confirm !== "true") { button.dataset.confirm = "true"; button.textContent = "确认撤销"; return; }
      await api("/api/integrations/apple-health/tokens/" + encodeURIComponent(value), { method: "DELETE" });
      await refreshAccountMeta();
      await renderRoute(); notify("设备已撤销");
    }
    if (action === "issue-api-token") {
      openIssueApiTokenModal();
    }
    if (action === "revoke-api-token") {
      if (button.dataset.confirm !== "true") { button.dataset.confirm = "true"; button.textContent = "确认撤销"; return; }
      await api("/api/tokens/" + encodeURIComponent(value), { method: "DELETE" });
      await renderRoute();
      notify("访问令牌已撤销");
    }
    if (action === "open-backup-restore") {
      openBackupRestoreModal();
    }
    if (action === "export") {
      const data = await api("/api/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      Object.assign(link, { href: url, download: `ironlog-${today()}.json` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (action === "export-csv") {
      const response = await fetch("/api/web/export-csv/" + encodeURIComponent(value), {
        method: "GET",
        credentials: "same-origin",
        headers: {
          ...(state.demoToken && { Authorization: "Bearer " + state.demoToken }),
          ...(state.userId && { "X-Ironlog-Account": state.userId }),
        },
        cache: "no-store",
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw Object.assign(new Error(errBody?.error ?? "导出 CSV 失败"), { status: response.status });
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      Object.assign(link, { href: url, download: `ironlog-${value}-${today()}.csv` });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify(`已导出 ${value} CSV 表格`);
    }
  } catch (error) { if (error.status === 401) showError(error); else notify(error.message); }
});
document.addEventListener("input", ({ target }) => {
  if (target.id === "badge-search") {
    state.badgeQuery = target.value;
    const host = $(".badge-sections", content);
    if (host && state.badges) {
      host.innerHTML = renderBadgeSections(state.badges, {
        category: state.badgeCategory,
        status: state.badgeStatus,
        query: state.badgeQuery,
        pinnedIds: getPinnedBadges(),
        appleHealthConnected: state.appleHealthConnected,
      });
    }
  }
  if (target.id === "workout-search") {
    state.workoutQuery = target.value;
    state.shownWorkouts = 15;
    const body = $("#workout-history-body", content);
    if (body) body.innerHTML = renderWorkoutHistoryBody();
  }
});
document.addEventListener("change", async ({ target }) => {
  try {
    if (target.dataset.change === "through" && target.value && target.validity.valid) { state.through = target.value; await loadOverview(); }
    if (target.dataset.change === "analytics-through" && target.value && target.validity.valid) { state.analyticsThrough = target.value; await loadAnalytics(++requestId); }
    if (target.dataset.change === "strength") { state.strength = target.value; await loadOverview(); $('[data-change="strength"]')?.focus({ preventScroll: true }); }
    if (target.dataset.change === "health-type") {
      state.healthType = target.value;
      const host = $("#panel-apple", content);
      if (host && state.data) host.outerHTML = applePanel(state.data, state);
      else overview(state.data);
      $('[data-change="health-type"]')?.focus({ preventScroll: true });
    }
    if (target.dataset.change === "diet-date" && target.value && target.validity.valid) await changeDietDate(target.value);
  } catch (error) { if (error.status === 401) showError(error); else notify(error.message); }
});
matchMedia("(max-width: 630px)").addEventListener("change", ({ matches }) => {
  if (!matches && dialog.open && dialog.classList.contains("mobile-sheet")) dialog.close();
  if (state.view === "overview" && state.data) overview(state.data);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.userId && !dialog.open &&
      ["overview", "workout", "calendar", "plan", "badges"].includes(state.view)) {
    dataEpoch++;
    void renderRoute();
  }
});
function energyCard(data) {
  const energy = data.energy;
  if (energy?.status !== "ready") return "";
  return `<section class="panel energy-panel"><header class="panel-head"><div><h2>能量估算</h2></div><button type="button" class="quiet" data-action="settings-open" data-value="profile">身体资料 ${icon("chevron", 15)}</button></header>
   <div class="health-metrics apple-telemetry"><div><span>静息消耗</span><strong>${fmt(energy.restingDisplay, 0)} <small>kcal</small></strong></div><div><span>日总消耗</span><strong>${fmt(energy.totalDisplay, 0)} <small>kcal</small></strong></div></div></section>`;
}
async function start() {
  // Demo is exposed only on the separate, loopback, in-memory preview server.
  try {
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      const demo = await api("/auth/web-demo", { token: "" });
      if (demo.token) { state.demo = true; state.demoToken = demo.token; }
    }
  } catch {}
  try {
    const account = await api("/api/me");
    syncAccountMeta(account);
  }
  catch { /* Guests can register, log in, or browse the public catalogue. */ }
  await renderRoute();
  if (!state.demo && state.userId && state.isNewUser && !localStorage.getItem(onboardingSeenKey(state.userId))) {
    triggerOpenOnboarding(1);
  }
  if ("serviceWorker" in navigator && !state.demo) navigator.serviceWorker.register("./sw.js").catch(() => {});
}
const unlockAudioOnce = () => {
  primeSharedAudio();
  document.removeEventListener("pointerdown", unlockAudioOnce, true);
  document.removeEventListener("touchstart", unlockAudioOnce, true);
};
document.addEventListener("pointerdown", unlockAudioOnce, { capture: true, passive: true });
document.addEventListener("touchstart", unlockAudioOnce, { capture: true, passive: true });

document.addEventListener("focusin", ({ target }) => {
  if (!matchMedia("(max-width: 630px)").matches) return;
  if (!target?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, select')) return;
  setTimeout(() => {
    if (target.isConnected && document.activeElement === target) {
      try {
        (target.closest(".set-row") ?? target).scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {}
    }
  }, 300);
});

$("#sidebar")?.addEventListener("click", ({ target }) => {
  if (target.closest?.(".mobile-nav :is(a, button)")) triggerHaptic("light");
});

void start();
