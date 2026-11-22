import { $, $$, copyText, esc, today, icon } from "./ui.js";

/**
 * Create workout report & daily/workout share card modal controller.
 */
export function createReportShareUi({
  api,
  open,
  dialog,
  notify,
  loadSessionUi,
  appleRange,
  getEditor,
  ensureLibraryCaches,
  getState,
  onInvalidate,
}) {
  let reportApple = null;

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
        const nextStyle = /** @type {HTMLElement} */ (tab).dataset.shareStyle;
        if (!nextStyle || nextStyle === activeStyle) return;
        activeStyle = nextStyle;
        try { localStorage.setItem("ironlog-share-style", activeStyle); } catch {}
        $$("[data-share-style]", dialog).forEach((btn) => {
          const isCurrent = /** @type {HTMLElement} */ (btn).dataset.shareStyle === activeStyle;
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
          const imgEl = /** @type {HTMLImageElement | null} */ ($("#share-card-preview-img", dialog));
          const dlEl = /** @type {HTMLAnchorElement | null} */ ($("#download-share-card", dialog));
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
    const state = getState();
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

  async function showReport(id, record) {
    const [report, { workoutReport, workoutReportText }] = await Promise.all([
      api("/api/web/workout-report/" + encodeURIComponent(id)),
      loadSessionUi(),
    ]);
    reportApple = (await appleRange(report.date, report.date).catch(() => [])).find((item) => item.manualWorkoutId === id) ?? null;
    open(report.title, workoutReport(report, reportApple), true, "report");
    const getFullRecord = () => record ?? api("/api/web/records/workout/" + encodeURIComponent(id));
    $("#edit-workout-from-report", dialog).addEventListener("click", async (event) => {
      const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
      button.disabled = true;
      try {
        const [current, ed] = await Promise.all([getFullRecord(), getEditor(), ensureLibraryCaches()]);
        if (dialog.open && dialog.contains(button)) {
          ed.edit("workout", current, getState().data?.goals);
        }
      } catch (error) { notify(error.message); }
      finally { button.disabled = false; }
    });
    $("#save-workout-template", dialog)?.addEventListener("click", async (event) => {
      const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
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
        onInvalidate?.({ clearPlanCache: true });
        button.textContent = "已存为模板";
        notify(`已保存「${name}」至训练计划模板库`);
      } catch (error) { notify(error.message); button.disabled = false; }
    });
    $("#sync-workout-to-plan", dialog)?.addEventListener("click", async (event) => {
      const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
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
        onInvalidate?.({ clearPlanCache: true, clearDayCache: true });
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
      const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
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
        ed.edit("workout", undefined, getState().data?.goals ?? {}, {
          title: current.data.title,
          date: today(),
          exercises: clonedExercises,
          templateKey: "repeat_" + current.id,
        });
      } catch (error) { notify(error.message); button.disabled = false; }
    });
    $("#copy-workout-report", dialog).addEventListener("click", async ({ currentTarget }) => {
      const btn = /** @type {HTMLElement} */ (currentTarget);
      if (await copyText(workoutReportText(report))) { btn.textContent = "已复制训练摘要"; notify("训练摘要已复制"); }
      else notify("无法复制，可以长按选中训练内容");
    });
    $("#share-workout-card", dialog)?.addEventListener("click", async (event) => {
      const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
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

  return {
    showReport,
    openDailyShareModal,
    openShareForDate,
    getReportApple: () => reportApple,
    clearReportApple: () => { reportApple = null; },
  };
}
