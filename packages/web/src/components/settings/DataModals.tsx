import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { fmt } from "../../lib/date";
import type { PlanData } from "../../lib/domain";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export function downloadClientFile(text: string, mime: string, filename: string): void {
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

export function exportPlanAsJson(plan: PlanData | null | undefined, notify: (msg: string) => void): void {
  if (!plan) return;
  const payload = {
    format: "ironlog-plan",
    version: 1,
    exportedAt: new Date().toISOString(),
    plan,
  };
  const safeName = String(plan.name || "plan").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 48);
  downloadClientFile(JSON.stringify(payload, null, 2), "application/json;charset=utf-8;", `ironlog-plan-${safeName}.json`);
  notify(`已导出计划「${plan.name ?? "训练计划"}」JSON 文件`);
}

interface CsvPreviewRes {
  formatLabel: string;
  matchedExercises: number;
  totalWorkouts: number;
  importableWorkouts: number;
  duplicateWorkouts: number;
  totalSets: number;
  customExercisesToCreate?: string[];
  warnings?: string[];
  sampleWorkouts?: Array<{ date: string; title: string; exercises: string[]; sets: number }>;
}

export function CsvImportModal({ onSuccess }: { onSuccess?: () => void }) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [preview, setPreview] = useState<CsvPreviewRes | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const runPreview = async (rawCsv: string, skip: boolean) => {
    const csv = rawCsv.trim();
    setError("");
    if (!csv) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiFetch<CsvPreviewRes>("/api/web/import-csv/preview", {
        method: "POST",
        body: { csv, skipDuplicates: skip },
      });
      setPreview(res);
    } catch (err) {
      setPreview(null);
      setError((err as Error)?.message || "解析 CSV 失败");
    } finally {
      setPreviewing(false);
    }
  };

  const commitImport = async () => {
    const csv = csvText.trim();
    if (!csv || committing) return;
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch<{ formatLabel: string; importedWorkouts: number; importedSets: number }>(
        "/api/web/import-csv/commit",
        { method: "POST", body: { csv, skipDuplicates } },
      );
      bumpDataEpoch();
      closeAllModals();
      onSuccess?.();
      notify(`已从 ${res.formatLabel} 导入 ${res.importedWorkouts} 场训练（共 ${res.importedSets} 组）`);
    } catch (err) {
      setError((err as Error)?.message || "导入失败");
      setCommitting(false);
    }
  };

  return (
    <div className="dialog-form csv-import-box">
      <p className="muted">
        自动识别 <b>Strong</b>、<b>Hevy</b>、<b>FitNotes</b> 与 <b>铁记导出</b> CSV，自动换算 lbs→kg、匹配中文动作库并过滤重复场次。
      </p>
      <label className="csv-file-drop">
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 2_000_000) {
              setPreview(null);
              setError("CSV 文件超过 2 MB，请分批导入。");
              return;
            }
            setFileName(`已加载：${file.name}`);
            void file.text().then((txt) => {
              setCsvText(txt);
              void runPreview(txt, skipDuplicates);
            });
          }}
        />
        <span>
          <Icon name="upload" size={16} /> 选择 CSV 文件
        </span>
        <small>{fileName || "或直接在下方粘贴 CSV 文本（含表头）"}</small>
      </label>

      <textarea
        rows={5}
        value={csvText}
        onChange={(e) => {
          setCsvText(e.target.value);
          setPreview(null);
          setError("");
        }}
        placeholder={"例如：Date,Workout Name,Exercise Name,Weight,Reps\n2026-11-20,Push Day,Bench Press (Barbell),100,5"}
      />

      <div className="csv-import-options">
        <label className="switch-chip">
          <span>跳过同日同名重复训练</span>
          <input
            className="switch"
            type="checkbox"
            checked={skipDuplicates}
            onChange={(e) => {
              const checked = e.target.checked;
              setSkipDuplicates(checked);
              if (csvText.trim()) void runPreview(csvText, checked);
            }}
          />
        </label>
        <button type="button" className="secondary-button" disabled={previewing} onClick={() => void runPreview(csvText, skipDuplicates)}>
          {previewing ? "解析中…" : "解析预览"}
        </button>
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      {preview ? (
        <div className="csv-preview-box">
          <div className="csv-preview-head">
            <span className="starter-tag">识别格式：{preview.formatLabel}</span>
            <small>已匹配动作 {preview.matchedExercises} 个</small>
          </div>
          <div className="csv-preview-stats">
            <div><span>解析场次</span><strong>{preview.totalWorkouts} <small>场</small></strong></div>
            <div><span>将导入</span><strong>{preview.importableWorkouts} <small>场</small></strong></div>
            <div><span>重复跳过</span><strong>{preview.duplicateWorkouts} <small>场</small></strong></div>
            <div><span>有效组数</span><strong>{preview.totalSets} <small>组</small></strong></div>
          </div>
          {preview.customExercisesToCreate?.length ? (
            <p className="muted csv-custom-note">
              将自动创建自定义动作：<b>{preview.customExercisesToCreate.join("、")}</b>
            </p>
          ) : null}
          {preview.warnings?.length ? <p className="muted csv-warn-note">{preview.warnings.join("\n")}</p> : null}
          {preview.sampleWorkouts?.length ? (
            <ul className="csv-preview-list">
              {preview.sampleWorkouts.map((w, i) => (
                <li key={i}>
                  <span><b>{w.date}</b> · {w.title}</span>
                  <small>
                    {w.exercises.slice(0, 3).join("、")}
                    {w.exercises.length > 3 ? ` 等 ${w.exercises.length} 项` : ""} · {w.sets} 组
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">所有识别场次均为重复记录，取消勾选“跳过重复”或更换文件可强制导入。</p>
          )}
        </div>
      ) : null}

      <footer>
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={committing || !(preview && preview.importableWorkouts > 0)}
          onClick={() => void commitImport()}
        >
          {committing ? "导入中…" : "确认导入"}
        </button>
      </footer>
    </div>
  );
}

interface BackupPreviewRes {
  strategy: "merge" | "replace";
  exportedAt?: string;
  counts?: {
    workouts?: number;
    diets?: number;
    weights?: number;
    measurements?: number;
    plans?: number;
    templates?: number;
    appleDaily?: number;
    appleWorkouts?: number;
  };
  diff?: { toImport?: number; toUpdate?: number; unchanged?: number };
}

export function BackupRestoreModal({ onSuccess }: { onSuccess?: () => void }) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState("");
  const [strategy, setStrategy] = useState<"merge" | "replace">("merge");
  const [parsedBackup, setParsedBackup] = useState<unknown>(null);
  const [preview, setPreview] = useState<BackupPreviewRes | null>(null);
  const [armedReplace, setArmedReplace] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const runPreview = async (txt: string, nextStrategy: "merge" | "replace") => {
    const clean = txt.trim();
    setError("");
    setArmedReplace(false);
    if (!clean) {
      setPreview(null);
      setParsedBackup(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      setPreview(null);
      setError("备份内容不是合法的 JSON 格式");
      return;
    }
    setParsedBackup(parsed);
    setPreviewing(true);
    try {
      const res = await apiFetch<BackupPreviewRes>("/api/web/restore-backup", {
        method: "POST",
        body: { backup: parsed, mode: "preview", strategy: nextStrategy },
      });
      setPreview(res);
    } catch (err) {
      setPreview(null);
      setError((err as Error)?.message || "预览恢复失败");
    } finally {
      setPreviewing(false);
    }
  };

  const commitRestore = async () => {
    if (!parsedBackup || committing) return;
    if (strategy === "replace" && !armedReplace) {
      setArmedReplace(true);
      return;
    }
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch<{ imported: number; updated: number }>("/api/web/restore-backup", {
        method: "POST",
        body: { backup: parsedBackup, mode: "commit", strategy },
      });
      bumpDataEpoch();
      closeAllModals();
      onSuccess?.();
      notify(`全量备份恢复完成：新增 ${res.imported} 项，更新 ${res.updated} 项`);
    } catch (err) {
      setError((err as Error)?.message || "恢复备份失败");
      setCommitting(false);
    }
  };

  const c = preview?.counts ?? {};
  const d = preview?.diff ?? {};

  return (
    <div className="dialog-form csv-import-box">
      <p className="muted">
        支持一键恢复由「导出全量 JSON」生成的备份文件（包含训练记录、饮食、体重、训练计划、自定义动作、身体围度、动作备忘与 Apple 健康同步数据）。
      </p>
      <label className="csv-file-drop">
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 16_000_000) {
              setPreview(null);
              setParsedBackup(null);
              setArmedReplace(false);
              setError("备份文件超过 16 MB");
              return;
            }
            setFileName(`已加载：${file.name}`);
            void file.text().then((txt) => {
              setRawText(txt);
              void runPreview(txt, strategy);
            });
          }}
        />
        <span>
          <Icon name="upload" size={16} /> 选择全量 JSON 备份文件
        </span>
        <small>{fileName || "或直接在下方粘贴备份 JSON 内容"}</small>
      </label>

      <textarea
        rows={5}
        value={rawText}
        onChange={(e) => {
          setRawText(e.target.value);
          setPreview(null);
          setParsedBackup(null);
          setArmedReplace(false);
          setError("");
        }}
        placeholder='{"format":"ironlog","schemaVersion":1,"records":[...]}'
      />

      <div className="csv-import-options">
        <select
          aria-label="恢复策略"
          value={strategy}
          onChange={(e) => {
            const next = e.target.value as "merge" | "replace";
            setStrategy(next);
            if (rawText.trim()) void runPreview(rawText, next);
          }}
        >
          <option value="merge">智能合并（推荐：保留现有数据，仅导入缺失或更新的记录）</option>
          <option value="replace">完整覆盖（清空当前账号数据，完整还原至此备份）</option>
        </select>
        <button type="button" className="secondary-button" disabled={previewing} onClick={() => void runPreview(rawText, strategy)}>
          {previewing ? "解析中…" : "解析预览"}
        </button>
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      {preview ? (
        <div className="csv-preview-box">
          <div className="csv-preview-head">
            <span className="starter-tag">{preview.strategy === "replace" ? "策略：完整覆盖" : "策略：智能合并"}</span>
            <small>
              {preview.exportedAt ? `备份时间：${preview.exportedAt.slice(0, 16).replace("T", " ")}` : "铁记全量备份"}
            </small>
          </div>
          <div className="csv-preview-stats">
            <div><span>力量/训练</span><strong>{c.workouts ?? 0} <small>场</small></strong></div>
            <div><span>饮食记录</span><strong>{c.diets ?? 0} <small>条</small></strong></div>
            <div><span>体重/围度</span><strong>{(c.weights ?? 0) + (c.measurements ?? 0)} <small>条</small></strong></div>
            <div><span>计划/模板</span><strong>{(c.plans ?? 0) + (c.templates ?? 0)} <small>份</small></strong></div>
          </div>
          <p className="muted csv-custom-note">
            将新增 <b>{d.toImport ?? 0}</b> 项 · 更新 <b>{d.toUpdate ?? 0}</b> 项 · 已一致跳过 <b>{d.unchanged ?? 0}</b> 项
            {c.appleDaily || c.appleWorkouts ? ` · 含 Apple 健康 ${c.appleDaily ?? 0} 天 / ${c.appleWorkouts ?? 0} 场训练` : ""}
          </p>
        </div>
      ) : null}

      <footer>
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={committing || !preview}
          onClick={() => void commitRestore()}
        >
          {committing ? "恢复中…" : armedReplace ? "确认清空并覆盖恢复" : "确认恢复"}
        </button>
      </footer>
    </div>
  );
}

export function IssueApiTokenModal({ onIssued }: { onIssued?: () => void }) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [label, setLabel] = useState("Claude Desktop MCP");
  const [issuedToken, setIssuedToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (issuedToken) {
    const mcpConfig = JSON.stringify(
      {
        mcpServers: {
          ironlog: {
            command: "npx",
            args: ["-y", "tsx", "packages/mcp/src/index.ts"],
            env: {
              IRONLOG_URL: typeof location !== "undefined" ? location.origin : "",
              IRONLOG_TOKEN: issuedToken,
            },
          },
        },
      },
      null,
      2,
    );

    return (
      <div className="dialog-form">
        <p className="muted">出于安全考虑，此令牌仅显示一次。关闭窗口后将无法再次查看完整明文。</p>
        <label className="field">
          <span>API 访问令牌 (IRONLOG_TOKEN)</span>
          <input name="issued-api-token" readOnly value={issuedToken} />
        </label>
        <label className="field">
          <span>MCP 客户端配置示例</span>
          <textarea rows={7} readOnly value={mcpConfig} />
        </label>
        <footer>
          <button
            type="button"
            className="quiet"
            onClick={closeAllModals}
          >
            完成
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void copyText(mcpConfig).then((ok) =>
                notify(ok ? "MCP 配置 JSON 已复制" : "自动复制受限，请手动全选复制上方文本"),
              )
            }
          >
            复制 MCP 配置
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void copyText(issuedToken).then((ok) =>
                notify(ok ? "API 访问令牌已复制" : "自动复制受限，请手动全选复制上方令牌"),
              )
            }
          >
            复制令牌
          </button>
        </footer>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = label.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ token: string }>("/api/tokens", { method: "POST", body: { label: clean } });
      setIssuedToken(res.token);
      bumpDataEpoch();
      onIssued?.();
    } catch (err) {
      setError((err as Error)?.message || "签发令牌失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id="issue-api-token-form" className="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="muted">
        生成后可用于配置 Claude Desktop、Cursor 的 <code>@ironlog/mcp</code> 服务或调用铁记 REST API。
      </p>
      <label className="field">
        <span>令牌名称</span>
        <input
          name="label"
          maxLength={80}
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例如：Claude Desktop / 命令行脚本"
        />
      </label>
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer>
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "生成中…" : "生成令牌"}
        </button>
      </footer>
    </form>
  );
}

interface PlanImportPreviewRes {
  plan: PlanData;
  exerciseNames?: Record<string, string>;
  routineCount: number;
  exerciseCount: number;
  weeklyMuscleSets?: Array<{ name: string; sets: number }>;
}

export function PlanImportModal({
  hasActivePlan,
  expectedRevision,
  onImported,
}: {
  hasActivePlan: boolean;
  expectedRevision: number;
  onImported?: (mode: "draft" | "apply") => void;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openPlanSection = useUiStore((s) => s.openPlanSection);
  const notify = useUiStore((s) => s.notify);

  const [fileName, setFileName] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<PlanImportPreviewRes | null>(null);
  const [armedApply, setArmedApply] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const runPreview = async (rawJson: string) => {
    const clean = rawJson.trim();
    setError("");
    setArmedApply(false);
    if (!clean) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiFetch<PlanImportPreviewRes>("/api/web/plans/import-json", {
        method: "POST",
        body: { json: clean, mode: "preview" },
      });
      setPreview(res);
    } catch (err) {
      setPreview(null);
      setError((err as Error)?.message || "解析计划 JSON 失败");
    } finally {
      setPreviewing(false);
    }
  };

  const commitPlan = async (mode: "draft" | "apply") => {
    const json = jsonText.trim();
    if (!json || committing) return;
    if (mode === "apply" && hasActivePlan && !armedApply) {
      setArmedApply(true);
      return;
    }
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch<{ plan: { name: string } }>("/api/web/plans/import-json", {
        method: "POST",
        body: { json, mode, expectedRevision },
      });
      bumpDataEpoch();
      closeAllModals();
      if (mode === "draft") openPlanSection("drafts");
      else openPlanSection("current");
      onImported?.(mode);
      notify(mode === "draft" ? `已将「${res.plan.name}」存入计划草稿` : `已导入并启用「${res.plan.name}」`);
    } catch (err) {
      setError((err as Error)?.message || "导入计划失败");
      setCommitting(false);
    }
  };

  return (
    <div className="dialog-form plan-import-box">
      <p className="muted">
        导入由铁记导出的 <code>ironlog-plan</code> JSON，或任何标准计划结构（支持按动作中/英文名自动匹配动作库）。
      </p>
      <label className="csv-file-drop">
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 500_000) {
              setPreview(null);
              setArmedApply(false);
              setError("计划 JSON 文件超过 500 KB。");
              return;
            }
            setFileName(`已加载：${file.name}`);
            void file.text().then((txt) => {
              setJsonText(txt);
              void runPreview(txt);
            });
          }}
        />
        <span>
          <Icon name="upload" size={16} /> 选择计划 JSON 文件
        </span>
        <small>{fileName || "或在下方直接粘贴计划 JSON 内容"}</small>
      </label>

      <textarea
        rows={5}
        value={jsonText}
        onChange={(e) => {
          setJsonText(e.target.value);
          setPreview(null);
          setArmedApply(false);
          setError("");
        }}
        placeholder='{"format":"ironlog-plan","version":1,"plan":{"name":"示例推拉计划","weeks":6,"schedule":"rotation","routines":[...]}}'
      />

      <div className="csv-import-options">
        <span />
        <button type="button" className="secondary-button" disabled={previewing} onClick={() => void runPreview(jsonText)}>
          {previewing ? "解析中…" : "解析预览"}
        </button>
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      {preview ? (
        <div className="csv-preview-box">
          <div className="csv-preview-head">
            <strong>{preview.plan.name}</strong>
            <small>
              {preview.plan.weeks} 周 · {preview.plan.schedule === "rotation" ? "按顺序轮换" : "按星期执行"} · {preview.routineCount} 练 /{" "}
              {preview.exerciseCount} 动作
            </small>
          </div>
          {preview.weeklyMuscleSets?.length ? (
            <div className="starter-muscles">
              {preview.weeklyMuscleSets.map((m) => (
                <span key={m.name}>
                  {m.name} <b>{fmt(m.sets)}</b> 组
                </span>
              ))}
            </div>
          ) : null}
          <ul className="csv-preview-list">
            {preview.plan.routines.map((rt) => (
              <li key={rt.id}>
                <span><b>{rt.name}</b></span>
                <small>
                  {rt.exercises
                    .map((ex) => preview.exerciseNames?.[ex.exerciseId] ?? ex.exerciseId)
                    .slice(0, 4)
                    .join("、")}
                  {rt.exercises.length > 4 ? ` 等 ${rt.exercises.length} 项` : ""}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <footer>
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button type="button" className="secondary-button" disabled={committing || !preview} onClick={() => void commitPlan("draft")}>
          存为草稿
        </button>
        <button type="button" className="primary-button" disabled={committing || !preview} onClick={() => void commitPlan("apply")}>
          {armedApply ? "确认覆盖当前计划" : "一键启用"}
        </button>
      </footer>
    </div>
  );
}
