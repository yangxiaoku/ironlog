import { $, copyText, esc, fmt, icon, field } from "./ui.js";

/** Download generated text or JSON/CSV payload as a client-side file. */
export function downloadTextFile(text, mime, filename) {
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

/** Create data import/export, backup restore, API token, and plan JSON modal handlers. */
export function createDataModals({
  api,
  open,
  dialog,
  notify,
  getState,
  onInvalidate,
  onRefreshView,
  onPlanImported,
}) {
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

    const fileInput = /** @type {HTMLInputElement | null} */ ($("#csv-import-file", dialog));
    const fileLabel = $("#csv-file-label", dialog);
    const textArea = /** @type {HTMLTextAreaElement} */ ($("#csv-import-text", dialog));
    const skipCheck = /** @type {HTMLInputElement} */ ($("#csv-import-skip", dialog));
    const previewBtn = /** @type {HTMLButtonElement | null} */ ($("#csv-import-preview-btn", dialog));
    const commitBtn = /** @type {HTMLButtonElement | null} */ ($("#csv-import-commit-btn", dialog));
    const previewBox = /** @type {HTMLElement} */ ($("#csv-import-preview", dialog));
    const errEl = /** @type {HTMLElement} */ ($("#csv-import-error", dialog));

    async function runPreview() {
      const csv = textArea.value.trim();
      errEl.hidden = true;
      if (commitBtn) commitBtn.disabled = true;
      if (!csv) {
        previewBox.hidden = true;
        return;
      }
      if (previewBtn) previewBtn.disabled = true;
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
        if (commitBtn) commitBtn.disabled = !(res.importableWorkouts > 0);
      } catch (problem) {
        previewBox.hidden = true;
        errEl.textContent = problem.message;
        errEl.hidden = false;
      } finally {
        if (previewBtn) previewBtn.disabled = false;
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
      if (!csv || !commitBtn) return;
      commitBtn.disabled = true;
      errEl.hidden = true;
      try {
        const res = await api("/api/web/import-csv/commit", {
          method: "POST",
          body: { csv, skipDuplicates: skipCheck.checked },
        });
        await onInvalidate?.({ clearAllCaches: true });
        if (dialog.open) dialog.close();
        await onRefreshView?.();
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

    const fileInput = /** @type {HTMLInputElement | null} */ ($("#backup-restore-file", dialog));
    const fileLabel = $("#backup-file-label", dialog);
    const textArea = /** @type {HTMLTextAreaElement} */ ($("#backup-restore-text", dialog));
    const strategySel = /** @type {HTMLSelectElement} */ ($("#backup-restore-strategy", dialog));
    const previewBtn = /** @type {HTMLButtonElement | null} */ ($("#backup-restore-preview-btn", dialog));
    const commitBtn = /** @type {HTMLButtonElement | null} */ ($("#backup-restore-commit-btn", dialog));
    const previewBox = /** @type {HTMLElement} */ ($("#backup-restore-preview", dialog));
    const errEl = /** @type {HTMLElement} */ ($("#backup-restore-error", dialog));
    let parsedBackup = null;

    async function runPreview() {
      const raw = textArea.value.trim();
      errEl.hidden = true;
      if (commitBtn) {
        commitBtn.disabled = true;
        delete commitBtn.dataset.confirm;
        commitBtn.textContent = "确认恢复";
      }
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
      if (previewBtn) previewBtn.disabled = true;
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
        if (commitBtn) commitBtn.disabled = false;
      } catch (problem) {
        previewBox.hidden = true;
        errEl.textContent = problem.message;
        errEl.hidden = false;
      } finally {
        if (previewBtn) previewBtn.disabled = false;
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
      if (!parsedBackup || !commitBtn) return;
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
        await onInvalidate?.({ clearAllCaches: true, refreshAccount: true });
        if (dialog.open) dialog.close();
        await onRefreshView?.();
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
      const form = /** @type {HTMLFormElement} */ (event.currentTarget);
      const label = String(new FormData(form).get("label") ?? "").trim();
      const btn = /** @type {HTMLButtonElement | null} */ ($('button[type="submit"]', form));
      const errEl = /** @type {HTMLElement | null} */ ($(".form-error", form));
      if (!label) return;
      if (btn) btn.disabled = true;
      if (errEl) errEl.hidden = true;
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
        if (getState().view === "settings") await onRefreshView?.();
      } catch (problem) {
        if (errEl) {
          errEl.textContent = problem.message;
          errEl.hidden = false;
        }
        if (btn) btn.disabled = false;
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

    const fileInput = /** @type {HTMLInputElement | null} */ ($("#plan-import-file", dialog));
    const fileLabel = $("#plan-file-label", dialog);
    const textArea = /** @type {HTMLTextAreaElement} */ ($("#plan-import-text", dialog));
    const previewBtn = /** @type {HTMLButtonElement | null} */ ($("#plan-import-preview-btn", dialog));
    const draftBtn = /** @type {HTMLButtonElement} */ ($("#plan-import-draft-btn", dialog));
    const applyBtn = /** @type {HTMLButtonElement} */ ($("#plan-import-apply-btn", dialog));
    const previewBox = /** @type {HTMLElement} */ ($("#plan-import-preview", dialog));
    const errEl = /** @type {HTMLElement} */ ($("#plan-import-error", dialog));

    async function runPreview() {
      const json = textArea.value.trim();
      errEl.hidden = true;
      draftBtn.disabled = true;
      applyBtn.disabled = true;
      applyBtn.dataset.confirm = "";
      applyBtn.textContent = "一键启用";
      if (!json) { previewBox.hidden = true; return; }
      if (previewBtn) previewBtn.disabled = true;
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
        if (previewBtn) previewBtn.disabled = false;
      }
    }

    async function commitPlan(mode) {
      const json = textArea.value.trim();
      if (!json) return;
      if (mode === "apply" && getState().plan?.data && applyBtn.dataset.confirm !== "true") {
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
          body: { json, mode, expectedRevision: getState().plan?.revision ?? 0 },
        });
        if (dialog.open) dialog.close();
        await onPlanImported?.(mode);
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

  return {
    openCsvImportModal,
    openBackupRestoreModal,
    openIssueApiTokenModal,
    exportPlanAsJson,
    openPlanImportModal,
  };
}
