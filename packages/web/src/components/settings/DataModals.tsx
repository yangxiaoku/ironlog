import { useEffect, useRef, useState } from "react";
import { BACKUP_JSON_LIMIT_LABEL, BACKUP_JSON_MAX_BYTES, BACKUP_REQUEST_TIMEOUT_MS } from "@ironlog/shared";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { fmt } from "../../lib/date";
import { safeUuid, type PlanData } from "../../lib/domain";
import { useAuthStore } from "../../store/useAuthStore";
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

interface CsvSampleSet {
  exercise: string;
  mode: string;
  rawWeightText: string;
  rawUnit: string;
  parsedWeight: number;
  parsedUnit: "kg" | "lb";
  reps: number;
  seconds: number;
}

interface CsvPreviewRes {
  formatLabel: string;
  previewSignature?: string;
  detectedDecimalSeparator?: "." | ",";
  ambiguousDecimal?: boolean;
  unclosedQuoteLine?: number | null;
  skippedRows?: number;
  matchedExercises: number;
  totalWorkouts: number;
  importableWorkouts: number;
  duplicateWorkouts: number;
  willSkipDuplicates?: number;
  suspectedDuplicateWorkouts?: number;
  totalSets: number;
  customExercisesToCreate?: string[];
  customExerciseDetails?: Array<{ name: string; mode: string; muscle: string; equipment: string }>;
  warnings?: string[];
  sampleWorkouts?: Array<{
    date: string;
    title: string;
    exercises: string[];
    sets: number;
    sampleSets?: CsvSampleSet[];
  }>;
  suspectedWorkouts?: Array<{ date: string; title: string; exercises: string[]; sets: number }>;
}

interface CsvCommitSummary {
  formatLabel: string;
  importedWorkouts: number;
  importedSets: number;
  skippedDuplicates: number;
  skippedSuspectedDuplicates: number;
  skippedRows: number;
  createdCustomExercises: number;
  createdCustomExerciseNames?: string[];
  warnings?: string[];
  replayed?: boolean;
  sourceLabel: string;
  completedAt: string;
}

const MODE_LABELS: Record<string, string> = {
  reps: "负重次数",
  timed: "计时",
  bodyweight: "自重",
  assisted: "配重辅助",
};

const LAST_CSV_IMPORT_KEY = "ironlog_last_csv_import_summary";

function lastCsvImportKeyForUser(userId: string): string {
  return userId ? `${LAST_CSV_IMPORT_KEY}:${userId}` : "";
}

function readLastCsvSummary(userId: string): CsvCommitSummary | null {
  if (!userId) return null;
  try {
    sessionStorage.removeItem(LAST_CSV_IMPORT_KEY);
    const raw = sessionStorage.getItem(lastCsvImportKeyForUser(userId));
    return raw ? (JSON.parse(raw) as CsvCommitSummary) : null;
  } catch {
    return null;
  }
}

function writeLastCsvSummary(userId: string, summary: CsvCommitSummary | null): void {
  if (!userId) return;
  try {
    sessionStorage.removeItem(LAST_CSV_IMPORT_KEY);
    const key = lastCsvImportKeyForUser(userId);
    if (summary) sessionStorage.setItem(key, JSON.stringify(summary));
    else sessionStorage.removeItem(key);
  } catch {}
}

export function CsvImportModal({ onSuccess }: { onSuccess?: () => void }) {
  const userId = useAuthStore((s) => s.userId);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [loadedFileName, setLoadedFileName] = useState("");
  const [readingFileName, setReadingFileName] = useState<string | null>(null);
  const [editedAfterLoad, setEditedAfterLoad] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [includeSuspected, setIncludeSuspected] = useState(false);
  const [decimalFormat, setDecimalFormat] = useState<"auto" | "dot" | "comma">("auto");
  const [allowPartialImport, setAllowPartialImport] = useState(false);
  const [expandedSamples, setExpandedSamples] = useState<Record<number, boolean>>({});
  const [commitResult, setCommitResult] = useState<CsvCommitSummary | null>(null);
  const [lastSummary, setLastSummary] = useState<CsvCommitSummary | null>(() => readLastCsvSummary(userId));

  // #268: Always re-bind cached CSV import summary to the currently signed-in account
  useEffect(() => {
    setLastSummary(readLastCsvSummary(userId));
  }, [userId]);

  // #220: Separate file read sequence from preview sequence and hold latest options in refs
  const fileReadReqRef = useRef(0);
  const previewReqRef = useRef(0);
  const skipDuplicatesRef = useRef(skipDuplicates);
  const includeSuspectedRef = useRef(includeSuspected);
  const decimalFormatRef = useRef(decimalFormat);
  skipDuplicatesRef.current = skipDuplicates;
  includeSuspectedRef.current = includeSuspected;
  decimalFormatRef.current = decimalFormat;

  const [validated, setValidated] = useState<{
    csv: string;
    skipDuplicates: boolean;
    includeSuspected: boolean;
    decimalFormat: "auto" | "dot" | "comma";
    sourceLabel: string;
    opId: string;
    preview: CsvPreviewRes;
  } | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const preview = validated?.preview ?? null;
  const currentSourceLabel = loadedFileName
    ? editedAfterLoad
      ? `已编辑内容（原自 ${loadedFileName}）`
      : `文件：${loadedFileName}`
    : "粘贴的文本内容";

  const runPreview = async (
    rawCsv: string,
    skip: boolean,
    includeSusp = includeSuspectedRef.current,
    decFmt: "auto" | "dot" | "comma" = decimalFormatRef.current,
    sourceLabel = currentSourceLabel,
  ) => {
    const reqId = ++previewReqRef.current;
    const csv = rawCsv.trim();
    setError("");
    setValidated(null);
    setAllowPartialImport(false);
    setExpandedSamples({});
    if (!csv) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiFetch<CsvPreviewRes>("/api/web/import-csv/preview", {
        method: "POST",
        body: {
          csv,
          skipDuplicates: skip,
          includeSuspectedDuplicates: includeSusp,
          decimalFormat: decFmt,
        },
      });
      // #90 / #220: Discard stale preview responses if input/options changed while request was in flight.
      if (reqId !== previewReqRef.current) return;
      setValidated({
        csv,
        skipDuplicates: skip,
        includeSuspected: includeSusp,
        decimalFormat: decFmt,
        sourceLabel,
        // #221: Bind one stable opId per validated preview snapshot so 503 retries are idempotent
        opId: `csv_${safeUuid()}`,
        preview: res,
      });
    } catch (err) {
      if (reqId !== previewReqRef.current) return;
      setValidated(null);
      setError((err as Error)?.message || "解析 CSV 失败");
    } finally {
      if (reqId === previewReqRef.current) setPreviewing(false);
    }
  };

  const commitImport = async () => {
    // #90 / #220: Commit strictly from the exact snapshot shown in preview and never while reading a file.
    if (!validated || previewing || committing || readingFileName) return;
    if (validated.preview.importableWorkouts <= 0) return;
    if (validated.preview.unclosedQuoteLine != null && !allowPartialImport) {
      setError(`第 ${validated.preview.unclosedQuoteLine} 行存在未闭合引号，请修复文件或勾选「忽略截断并部分导入」。`);
      return;
    }
    const commitUserId = userId;
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch<Omit<CsvCommitSummary, "sourceLabel" | "completedAt">>(
        "/api/web/import-csv/commit",
        {
          method: "POST",
          body: {
            csv: validated.csv,
            skipDuplicates: validated.skipDuplicates,
            includeSuspectedDuplicates: validated.includeSuspected,
            decimalFormat: validated.decimalFormat,
            allowPartialImport,
            expectedPreviewSignature: validated.preview.previewSignature,
            opId: validated.opId,
          },
        },
      );
      // #268: Guard against late responses arriving after logout/account switch
      if (!commitUserId || useAuthStore.getState().userId !== commitUserId) return;
      const summary: CsvCommitSummary = {
        ...res,
        sourceLabel: validated.sourceLabel,
        completedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      };
      writeLastCsvSummary(commitUserId, summary);
      setLastSummary(summary);
      setCommitResult(summary);
      bumpDataEpoch();
      onSuccess?.();
      notify(
        `已从 ${res.formatLabel} 导入 ${res.importedWorkouts} 场训练（共 ${res.importedSets} 组）${res.replayed ? "（已复用同次提交回执）" : ""}`,
      );
    } catch (err) {
      const msg = (err as Error)?.message || "导入失败";
      setError(msg);
      if (msg.includes("预览范围不一致") || msg.includes("已发生变化")) {
        void runPreview(
          validated.csv,
          validated.skipDuplicates,
          validated.includeSuspected,
          validated.decimalFormat,
          validated.sourceLabel,
        );
      }
    } finally {
      setCommitting(false);
    }
  };

  if (commitResult) {
    const skippedTotal = commitResult.skippedDuplicates + commitResult.skippedSuspectedDuplicates;
    return (
      <div className="dialog-form csv-import-box">
        <div className="csv-preview-box">
          <div className="csv-preview-head">
            <span className="starter-tag">导入完成：{commitResult.formatLabel}</span>
            <small>来源：{commitResult.sourceLabel} · {commitResult.completedAt}</small>
          </div>
          <div className="csv-preview-stats">
            <div><span>已写入</span><strong>{commitResult.importedWorkouts} <small>场</small></strong></div>
            <div><span>导入组数</span><strong>{commitResult.importedSets} <small>组</small></strong></div>
            <div><span>重复跳过</span><strong>{skippedTotal} <small>场</small></strong></div>
            <div><span>新增动作</span><strong>{commitResult.createdCustomExercises} <small>个</small></strong></div>
          </div>
          {commitResult.skippedRows > 0 ? (
            <p className="muted csv-warn-note">有 {commitResult.skippedRows} 行因日期或动作名无效被跳过。</p>
          ) : null}
          {commitResult.createdCustomExerciseNames?.length ? (
            <p className="muted csv-custom-note">
              本次新建自定义动作：<b>{commitResult.createdCustomExerciseNames.join("、")}</b>
            </p>
          ) : null}
          {commitResult.warnings?.length ? (
            <p className="muted csv-warn-note">{commitResult.warnings.join("\n")}</p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setCommitResult(null);
              setValidated(null);
            }}
          >
            继续导入另一份
          </button>
          <button type="button" className="primary-button" onClick={closeAllModals}>
            完成并关闭
          </button>
        </footer>
      </div>
    );
  }

  const willSkipCount =
    preview && validated
      ? (preview.willSkipDuplicates ?? Math.max(0, preview.totalWorkouts - preview.importableWorkouts))
      : 0;
  const detectedTotalDupes =
    preview ? preview.duplicateWorkouts + (preview.suspectedDuplicateWorkouts ?? 0) : 0;

  return (
    <div className="dialog-form csv-import-box">
      <p className="muted">
        自动识别 <b>Strong</b>、<b>Hevy</b>、<b>FitNotes</b> 与 <b>铁记导出</b> CSV，自动识别小数格式、换算 lbs→kg、匹配动作库并过滤重复场次。
      </p>
      <div className="csv-scope-note muted" style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2, rgba(255,255,255,0.04))", border: "1px solid var(--edge)" }}>
        <b>字段范围说明：</b>训练 CSV 保存「训练记录、组次重量/单位、RIR 与动作模式/肌群/器械」；若需跨账号完整迁移<b>训练计划、饮食、体重围度、体态照片与 Apple 健康</b>，请使用设置中的「全量 JSON 备份 / 恢复」。
      </div>
      {lastSummary ? (
        <details style={{ fontSize: 12 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            查看上次 CSV 导入摘要（{lastSummary.completedAt} · 写入 {lastSummary.importedWorkouts} 场 · 保留至当前标签会话结束）
          </summary>
          <div className="muted" style={{ marginTop: 6, paddingLeft: 8, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>
              来源：{lastSummary.sourceLabel} · 写入 {lastSummary.importedWorkouts} 场 / {lastSummary.importedSets} 组 · 跳过重复 {lastSummary.skippedDuplicates + lastSummary.skippedSuspectedDuplicates} 场 · 无效行 {lastSummary.skippedRows} 行 · 新建动作 {lastSummary.createdCustomExercises} 个
            </span>
            <button
              type="button"
              className="micro-chip"
              onClick={() => {
                writeLastCsvSummary(userId, null);
                setLastSummary(null);
                notify("已清除本机上次导入摘要");
              }}
            >
              清除摘要
            </button>
          </div>
        </details>
      ) : null}

      <label className="csv-file-drop">
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={committing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fileReadId = ++fileReadReqRef.current;
            ++previewReqRef.current;
            setValidated(null);
            setError("");
            if (file.size > 2_000_000) {
              setReadingFileName(null);
              setPreviewing(false);
              setError("CSV 文件超过 2 MB，请分批导入。");
              return;
            }
            // #220: Do NOT overwrite loadedFileName until file.text() finishes; keep readingFileName separate.
            setReadingFileName(file.name);
            setPreviewing(true);
            const nextSource = `文件：${file.name}`;
            void file
              .text()
              .then((txt) => {
                if (fileReadId !== fileReadReqRef.current) return;
                setReadingFileName(null);
                setLoadedFileName(file.name);
                setEditedAfterLoad(false);
                setCsvText(txt);
                void runPreview(
                  txt,
                  skipDuplicatesRef.current,
                  includeSuspectedRef.current,
                  decimalFormatRef.current,
                  nextSource,
                );
              })
              .catch(() => {
                if (fileReadId !== fileReadReqRef.current) return;
                setReadingFileName(null);
                setPreviewing(false);
                setError(`读取文件「${file.name}」失败，请重试。`);
              });
          }}
        />
        <span>
          <Icon name="upload" size={16} /> 选择 CSV 文件
        </span>
        <small>
          {readingFileName
            ? `正在读取：${readingFileName}…`
            : loadedFileName
              ? editedAfterLoad
                ? `已编辑内容（原自 ${loadedFileName}）`
                : `已加载：${loadedFileName}`
              : "或直接在下方粘贴 CSV 文本（含表头）"}
        </small>
      </label>

      <textarea
        rows={5}
        value={csvText}
        disabled={committing}
        onChange={(e) => {
          ++fileReadReqRef.current;
          ++previewReqRef.current;
          setReadingFileName(null);
          setCsvText(e.target.value);
          if (loadedFileName) setEditedAfterLoad(true);
          setValidated(null);
          setPreviewing(false);
          setError("");
        }}
        placeholder={"例如：Date,Workout Name,Exercise Name,Weight,Reps\n2026-11-20,Push Day,Bench Press (Barbell),100,5"}
      />

      <div className="csv-import-options">
        <label className="switch-chip">
          <span>跳过明确重复场次</span>
          <input
            className="switch"
            type="checkbox"
            disabled={committing}
            checked={skipDuplicates}
            onChange={(e) => {
              const checked = e.target.checked;
              setSkipDuplicates(checked);
              skipDuplicatesRef.current = checked;
              // #220: Do NOT cancel an in-flight file read or preview stale text while reading a new file!
              if (readingFileName) return;
              if (csvText.trim()) {
                void runPreview(csvText, checked, includeSuspectedRef.current, decimalFormatRef.current);
              } else {
                ++previewReqRef.current;
                setValidated(null);
              }
            }}
          />
        </label>
        {skipDuplicates && (preview?.suspectedDuplicateWorkouts ?? 0) > 0 ? (
          <label className="switch-chip">
            <span>导入疑似重复 ({preview?.suspectedDuplicateWorkouts})</span>
            <input
              className="switch"
              type="checkbox"
              disabled={committing}
              checked={includeSuspected}
              onChange={(e) => {
                const checked = e.target.checked;
                setIncludeSuspected(checked);
                includeSuspectedRef.current = checked;
                if (readingFileName) return;
                if (csvText.trim()) {
                  void runPreview(csvText, skipDuplicatesRef.current, checked, decimalFormatRef.current);
                }
              }}
            />
          </label>
        ) : null}
        <label className="switch-chip" style={{ gap: 6 }}>
          <span>小数格式</span>
          <select
            aria-label="CSV 小数格式"
            disabled={committing}
            value={decimalFormat}
            onChange={(e) => {
              const next = e.target.value as "auto" | "dot" | "comma";
              setDecimalFormat(next);
              decimalFormatRef.current = next;
              if (readingFileName) return;
              if (csvText.trim()) {
                void runPreview(csvText, skipDuplicatesRef.current, includeSuspectedRef.current, next);
              }
            }}
          >
            <option value="auto">自动识别</option>
            <option value="dot">小数点 (62.5)</option>
            <option value="comma">小数逗号 (62,5)</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={previewing || committing || Boolean(readingFileName)}
          onClick={() => void runPreview(csvText, skipDuplicates, includeSuspected, decimalFormat)}
        >
          {readingFileName ? "读取中…" : previewing ? "解析中…" : "解析预览"}
        </button>
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      {preview && validated && !readingFileName ? (
        <div className="csv-preview-box">
          <div className="csv-preview-head">
            <span className="starter-tag">识别格式：{preview.formatLabel}</span>
            <small>
              来源：{validated.sourceLabel} · 已匹配动作 {preview.matchedExercises} 个 · 小数符「{preview.detectedDecimalSeparator ?? "."}」
            </small>
          </div>
          <div className="csv-preview-stats">
            <div><span>解析场次</span><strong>{preview.totalWorkouts} <small>场</small></strong></div>
            <div><span>将导入</span><strong>{preview.importableWorkouts} <small>场</small></strong></div>
            <div><span>预计跳过</span><strong>{willSkipCount} <small>场</small></strong></div>
            <div><span>有效组数</span><strong>{preview.totalSets} <small>组</small></strong></div>
          </div>
          {detectedTotalDupes > 0 && !validated.skipDuplicates ? (
            <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
              共检测到 {detectedTotalDupes} 场重复记录，因已关闭「跳过明确重复场次」，本次将全部强制导入（预计跳过 0 场）。
            </p>
          ) : null}
          {preview.unclosedQuoteLine != null ? (
            <label className="switch-chip" style={{ marginTop: 6 }}>
              <span>忽略第 {preview.unclosedQuoteLine} 行引号截断并部分导入</span>
              <input
                className="switch"
                type="checkbox"
                checked={allowPartialImport}
                onChange={(e) => setAllowPartialImport(e.target.checked)}
              />
            </label>
          ) : null}
          {preview.suspectedWorkouts?.length ? (
            <p className="muted csv-warn-note">
              检测到 {preview.suspectedWorkouts.length} 场缺少精确开始时间且同日动作/标题相同的疑似重复场次：{preview.suspectedWorkouts.slice(0, 3).map((w) => `${w.date} ${w.title}`).join("、")}。可通过上方开关决定是否导入。
            </p>
          ) : null}
          {preview.customExerciseDetails?.length ? (
            <p className="muted csv-custom-note">
              将自动创建自定义动作：
              <b>
                {preview.customExerciseDetails
                  .map((e) => `${e.name}（${MODE_LABELS[e.mode] ?? e.mode}）`)
                  .join("、")}
              </b>
            </p>
          ) : preview.customExercisesToCreate?.length ? (
            <p className="muted csv-custom-note">
              将自动创建自定义动作：<b>{preview.customExercisesToCreate.join("、")}</b>
            </p>
          ) : null}
          {preview.warnings?.length ? <p className="muted csv-warn-note">{preview.warnings.join("\n")}</p> : null}
          {preview.sampleWorkouts?.length ? (
            <ul className="csv-preview-list">
              {preview.sampleWorkouts.map((w, i) => (
                <li key={i} style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span><b>{w.date}</b> · {w.title}</span>
                    {w.sampleSets?.length ? (
                      <button
                        type="button"
                        className="quiet"
                        style={{ fontSize: 12, padding: "2px 6px", minHeight: 24 }}
                        onClick={() => setExpandedSamples((prev) => ({ ...prev, [i]: !prev[i] }))}
                      >
                        {expandedSamples[i] ? "收起代表组" : "展开代表组"}
                      </button>
                    ) : null}
                  </div>
                  <small>
                    {w.exercises.slice(0, 3).join("、")}
                    {w.exercises.length > 3 ? ` 等 ${w.exercises.length} 项` : ""} · {w.sets} 组
                  </small>
                  {expandedSamples[i] && w.sampleSets?.length ? (
                    <div style={{ fontSize: 12, marginTop: 4, display: "grid", gap: 3, paddingLeft: 8, borderLeft: "2px solid var(--edge)" }}>
                      {w.sampleSets.map((s, si) => (
                        <div key={si} className="muted">
                          {s.exercise}（{MODE_LABELS[s.mode] ?? s.mode}）：源值 <code>{s.rawWeightText} {s.rawUnit}</code> → 入库 <b>{s.parsedWeight} {s.parsedUnit}</b> × {s.mode === "timed" ? `${s.seconds}s` : `${s.reps}次`}
                        </div>
                      ))}
                    </div>
                  ) : null}
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
          disabled={
            committing ||
            previewing ||
            Boolean(readingFileName) ||
            !(validated && validated.preview.importableWorkouts > 0) ||
            (validated.preview.unclosedQuoteLine != null && !allowPartialImport)
          }
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
  stateToken?: string;
  activePlanChange?: {
    action: "none" | "keep" | "activate" | "switch" | "deactivate";
    current: { id: string; name: string; version: number; revision: number } | null;
    incoming: { id: string; name: string; version: number } | null;
  };
  statisticsPreferences?: {
    included: boolean;
    missingInBackup: boolean;
    willResetToDefault: boolean;
  };
  counts?: {
    workouts?: number;
    diets?: number;
    weights?: number;
    measurements?: number;
    progressPhotos?: number;
    plans?: number;
    templates?: number;
    appleDaily?: number;
    appleWorkouts?: number;
  };
  photos?: {
    total: number;
    toImport: number;
    skippedDuplicate: number;
    skippedCapacity: number;
    remainingCapacity: number;
    capacityLimit: number;
  };
  diff?: {
    toImport?: number;
    toUpdate?: number;
    unchanged?: number;
    toDelete?: number;
    deletions?: {
      records: number;
      measurements: number;
      progressPhotos: number;
      exerciseNotes: number;
      appleDaily: number;
      appleWorkouts: number;
      activePlan?: number;
      total: number;
    };
  };
}

function formatBackupTimeWithTz(iso?: string | null): string {
  if (!iso) return "铁记全量备份";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return `备份时间：${iso}`;
  const d = new Date(ms);
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const hh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const mm = String(absMin % 60).padStart(2, "0");
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `备份时间：${local} (UTC${sign}${hh}:${mm})`;
}

export function BackupRestoreModal({ onSuccess }: { onSuccess?: () => void }) {
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);
  const currentUserId = useAuthStore((s) => s.userId);

  const [fileName, setFileName] = useState("");
  const [sourceLabel, setSourceLabel] = useState("粘贴内容");
  const [rawText, setRawText] = useState("");
  const [strategy, setStrategy] = useState<"merge" | "replace">("merge");
  const strategyRef = useRef(strategy);
  const previewRequest = useRef(0);
  // #228: Track whether this modal instance is still mounted so late restore responses never close a subsequently opened modal
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [validated, setValidated] = useState<{ backup: unknown; preview: BackupPreviewRes; opId: string; source: string } | null>(null);
  const [armedReplace, setArmedReplace] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const preview = validated?.preview;

  const runPreview = async (txt: string, nextStrategy: "merge" | "replace", nextSource?: string) => {
    const request = ++previewRequest.current;
    const clean = txt.trim();
    const resolvedSource = nextSource ?? sourceLabel;
    setError("");
    setArmedReplace(false);
    setValidated(null);
    setPreviewing(false);
    if (!clean) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      setError("备份内容不是合法的 JSON 格式");
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiFetch<BackupPreviewRes>("/api/web/restore-backup", {
        method: "POST",
        timeout: BACKUP_REQUEST_TIMEOUT_MS,
        body: { backup: parsed, mode: "preview", strategy: nextStrategy },
      });
      if (request === previewRequest.current && mountedRef.current) {
        setValidated({ backup: parsed, preview: res, opId: safeUuid(), source: resolvedSource });
      }
    } catch (err) {
      if (request === previewRequest.current && mountedRef.current) {
        setError((err as Error)?.message || "预览恢复失败");
      }
    } finally {
      if (request === previewRequest.current && mountedRef.current) setPreviewing(false);
    }
  };

  const commitRestore = async () => {
    if (!validated || validated.preview.strategy !== strategy || previewing || committing) return;
    if (strategy === "replace" && !armedReplace) {
      setArmedReplace(true);
      return;
    }
    const snapshot = validated;
    const targetUserId = currentUserId;
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch<{
        imported: number;
        updated: number;
        skipped?: number;
        photos?: { imported: number; skippedCapacity: number };
      }>("/api/web/restore-backup", {
        method: "POST",
        timeout: BACKUP_REQUEST_TIMEOUT_MS,
        body: {
          backup: snapshot.backup,
          mode: "commit",
          strategy,
          opId: snapshot.opId,
          ...(snapshot.preview.stateToken ? { expectedStateToken: snapshot.preview.stateToken } : {}),
        },
      });
      if (targetUserId && useAuthStore.getState().userId !== targetUserId) return;
      bumpDataEpoch();
      // #228: Only close this modal if it is still mounted; never close a newer modal opened after user cancelled
      if (mountedRef.current) {
        closeTopModal();
      }
      onSuccess?.();
      const capWarn = res.photos?.skippedCapacity
        ? `（照片达 60 张上限，跳过 ${res.photos.skippedCapacity} 张）`
        : "";
      notify(`全量备份恢复完成（${snapshot.source}）：新增 ${res.imported} 项，更新 ${res.updated} 项${capWarn}`);
    } catch (err) {
      if (!mountedRef.current) {
        notify((err as Error)?.message || "后台恢复备份失败");
        return;
      }
      const apiErr = err as Error & { status?: number };
      setCommitting(false);
      // #223: On state drift 409, disarm replace confirmation and refresh preview so user sees the latest deletion scope
      if (apiErr.status === 409) {
        setArmedReplace(false);
        await runPreview(rawText, strategy, snapshot.source);
        if (mountedRef.current) {
          setError(apiErr.message || "预览后账号数据已发生变化，已重新计算覆盖范围，请核对后再确认");
        }
        return;
      }
      setError(apiErr.message || "恢复备份失败");
    }
  };

  const c = preview?.counts ?? {};
  const d = preview?.diff ?? {};
  const apc = preview?.activePlanChange;

  return (
    <div className="dialog-form csv-import-box">
      <p className="muted">
        支持一键恢复由「导出全量 JSON」生成的备份文件（包含训练记录、饮食、体重、训练计划、统计偏好、自定义动作、身体围度、动作备忘与 Apple 健康同步数据）。
      </p>
      <label className="csv-file-drop">
        <input
          type="file"
          accept=".json,application/json"
          disabled={committing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const request = ++previewRequest.current;
            setValidated(null);
            setRawText("");
            setArmedReplace(false);
            if (file.size > BACKUP_JSON_MAX_BYTES) {
              setPreviewing(false);
              setError(`备份文件超过 ${BACKUP_JSON_LIMIT_LABEL}，请通过服务器 SQLite 备份恢复`);
              return;
            }
            setFileName(`已加载：${file.name}`);
            setSourceLabel(file.name);
            setError("");
            setPreviewing(true);
            void file.text().then((txt) => {
              if (request !== previewRequest.current) return;
              setRawText(txt);
              void runPreview(txt, strategyRef.current, file.name);
            }).catch(() => {
              if (request !== previewRequest.current) return;
              setPreviewing(false);
              setError("无法读取备份文件");
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
        disabled={committing}
        onChange={(e) => {
          ++previewRequest.current;
          setRawText(e.target.value);
          // #229: Clear stale loaded filename as soon as user pastes or edits JSON directly
          setFileName(e.target.value.trim() ? "当前来源：粘贴 / 已编辑的 JSON 内容" : "");
          setSourceLabel("粘贴 / 已编辑的 JSON 内容");
          setValidated(null);
          setPreviewing(false);
          setArmedReplace(false);
          setError("");
        }}
        placeholder='{"format":"ironlog","schemaVersion":1,"records":[...]}'
      />

      <div className="csv-import-options">
        <select
          aria-label="恢复策略"
          value={strategy}
          disabled={committing}
          onChange={(e) => {
            const next = e.target.value as "merge" | "replace";
            strategyRef.current = next;
            setStrategy(next);
            if (rawText.trim()) void runPreview(rawText, next);
          }}
        >
          <option value="merge">智能合并（推荐：保留现有数据，仅导入缺失或更新的记录）</option>
          <option value="replace">完整覆盖（清空当前账号数据，完整还原至此备份）</option>
        </select>
        <button type="button" className="secondary-button" disabled={previewing || committing} onClick={() => void runPreview(rawText, strategy)}>
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
              {validated?.source ? `来源：${validated.source} · ` : ""}
              {formatBackupTimeWithTz(preview.exportedAt)}
            </small>
          </div>
          <div className="csv-preview-stats">
            <div><span>力量/训练</span><strong>{c.workouts ?? 0} <small>场</small></strong></div>
            <div><span>饮食记录</span><strong>{c.diets ?? 0} <small>条</small></strong></div>
            <div><span>体重/围度</span><strong>{(c.weights ?? 0) + (c.measurements ?? 0)} <small>条</small></strong></div>
            <div><span>计划/模板</span><strong>{(c.plans ?? 0) + (c.templates ?? 0)} <small>份</small></strong></div>
          </div>
          <p className="muted csv-custom-note">
            预计新增 <b>{d.toImport ?? 0}</b> 项 · 更新 <b>{d.toUpdate ?? 0}</b> 项 · 保留现有 <b>{d.unchanged ?? 0}</b> 项
            {c.progressPhotos ? ` · 体态照片 ${c.progressPhotos} 张` : ""}
            {c.appleDaily || c.appleWorkouts ? ` · 含 Apple 健康 ${c.appleDaily ?? 0} 天 / ${c.appleWorkouts ?? 0} 场训练` : ""}
            {preview.statisticsPreferences?.missingInBackup ? " · 旧版备份不含统计偏好（将保留当前端设置）" : ""}
          </p>
          {apc && apc.action !== "none" && apc.action !== "keep" ? (
            <p className={apc.action === "deactivate" ? "form-error" : "muted csv-custom-note"} role={apc.action === "deactivate" ? "alert" : undefined} style={{ marginTop: 6 }}>
              {apc.action === "deactivate"
                ? `生效计划变更：当前生效计划「${apc.current?.name ?? "当前计划"}」将在覆盖恢复后被停用（备份为未启用状态）。`
                : apc.action === "switch"
                  ? `生效计划变更：将从「${apc.current?.name ?? "当前计划"}」切换为「${apc.incoming?.name ?? "备份计划"}」。`
                  : `生效计划变更：将启用备份中的计划「${apc.incoming?.name ?? "备份计划"}」。`}
            </p>
          ) : null}
          {preview.strategy === "replace" && (d.toDelete ?? 0) > 0 && d.deletions ? (
            <p className="form-error" role="alert" style={{ marginTop: 6 }}>
              完整覆盖将永久清除当前账号独有的 <b>{d.deletions.total}</b> 项数据：
              {[
                d.deletions.records ? `通用记录 ${d.deletions.records} 条` : "",
                d.deletions.measurements ? `身体围度 ${d.deletions.measurements} 条` : "",
                d.deletions.progressPhotos ? `体态照片 ${d.deletions.progressPhotos} 张` : "",
                d.deletions.exerciseNotes ? `动作备忘 ${d.deletions.exerciseNotes} 条` : "",
                d.deletions.appleDaily ? `Apple 日常 ${d.deletions.appleDaily} 天` : "",
                d.deletions.appleWorkouts ? `Apple 训练 ${d.deletions.appleWorkouts} 场` : "",
                d.deletions.activePlan ? `停用当前生效计划 1 项` : "",
              ]
                .filter(Boolean)
                .join("、")}
            </p>
          ) : null}
          {armedReplace ? (
            <p className="form-error" role="status" style={{ marginTop: 6 }}>
              二次确认：即将用「{validated?.source}」（{formatBackupTimeWithTz(preview.exportedAt)}）执行完整覆盖，再次点击下方按钮生效。
            </p>
          ) : null}
          {preview.photos && preview.photos.skippedCapacity > 0 ? (
            <p className="form-error" role="alert" style={{ marginTop: 6 }}>
              体态照片空间不足（上限 {preview.photos.capacityLimit} 张，当前剩余 {preview.photos.remainingCapacity} 个空位）：本次将导入{" "}
              <b>{preview.photos.toImport}</b> 张，<b>跳过 {preview.photos.skippedCapacity} 张</b>。建议先清理旧照片后再恢复。
            </p>
          ) : null}
        </div>
      ) : null}

      <footer>
        <button type="button" className="quiet" onClick={closeTopModal}>
          {committing ? "后台继续" : "取消"}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={committing || previewing || !preview || preview.strategy !== strategy}
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

  const [loadedFileName, setLoadedFileName] = useState("");
  const [editedAfterLoad, setEditedAfterLoad] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const previewReqRef = useRef(0);
  const [validated, setValidated] = useState<{
    json: string;
    sourceLabel: string;
    preview: PlanImportPreviewRes;
  } | null>(null);
  const [armedApplyJson, setArmedApplyJson] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  const preview = validated?.preview ?? null;
  const armedApply = Boolean(validated && armedApplyJson === validated.json);
  const currentSourceLabel = loadedFileName
    ? editedAfterLoad
      ? `已编辑内容（原自 ${loadedFileName}）`
      : `文件：${loadedFileName}`
    : "粘贴的 JSON 内容";

  const runPreview = async (rawJson: string, sourceLabel = currentSourceLabel) => {
    const reqId = ++previewReqRef.current;
    const clean = rawJson.trim();
    setError("");
    setArmedApplyJson(null);
    setValidated(null);
    if (!clean) {
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    try {
      const res = await apiFetch<PlanImportPreviewRes>("/api/web/plans/import-json", {
        method: "POST",
        body: { json: clean, mode: "preview" },
      });
      // #91 (P1): Discard stale preview responses when user edits text before previous request returns.
      if (reqId !== previewReqRef.current) return;
      setValidated({ json: clean, sourceLabel, preview: res });
    } catch (err) {
      if (reqId !== previewReqRef.current) return;
      setValidated(null);
      setError((err as Error)?.message || "解析计划 JSON 失败");
    } finally {
      if (reqId === previewReqRef.current) setPreviewing(false);
    }
  };

  const commitPlan = async (mode: "draft" | "apply") => {
    // #91 (P1): Bind preview, second-step overwrite confirm, and submission to the exact same validated snapshot.
    if (!validated || previewing || committing) return;
    if (mode === "apply" && hasActivePlan && armedApplyJson !== validated.json) {
      setArmedApplyJson(validated.json);
      return;
    }
    setCommitting(true);
    setError("");
    try {
      const res = await apiFetch<{ plan: { name: string } }>("/api/web/plans/import-json", {
        method: "POST",
        body: { json: validated.json, mode, expectedRevision },
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
          disabled={committing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reqId = ++previewReqRef.current;
            setValidated(null);
            setArmedApplyJson(null);
            if (file.size > 500_000) {
              setPreviewing(false);
              setError("计划 JSON 文件超过 500 KB。");
              return;
            }
            setLoadedFileName(file.name);
            setEditedAfterLoad(false);
            const nextSource = `文件：${file.name}`;
            void file.text().then((txt) => {
              if (reqId !== previewReqRef.current) return;
              setJsonText(txt);
              void runPreview(txt, nextSource);
            });
          }}
        />
        <span>
          <Icon name="upload" size={16} /> 选择计划 JSON 文件
        </span>
        <small>
          {loadedFileName
            ? editedAfterLoad
              ? `已编辑内容（原自 ${loadedFileName}）`
              : `已加载：${loadedFileName}`
            : "或在下方直接粘贴计划 JSON 内容"}
        </small>
      </label>

      <textarea
        rows={5}
        value={jsonText}
        disabled={committing}
        onChange={(e) => {
          ++previewReqRef.current;
          setJsonText(e.target.value);
          if (loadedFileName) setEditedAfterLoad(true);
          setValidated(null);
          setArmedApplyJson(null);
          setPreviewing(false);
          setError("");
        }}
        placeholder='{"format":"ironlog-plan","version":1,"plan":{"name":"示例推拉计划","weeks":6,"schedule":"rotation","routines":[...]}}'
      />

      <div className="csv-import-options">
        <span />
        <button type="button" className="secondary-button" disabled={previewing || committing} onClick={() => void runPreview(jsonText)}>
          {previewing ? "解析中…" : "解析预览"}
        </button>
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      {preview && validated ? (
        <div className="csv-preview-box">
          <div className="csv-preview-head">
            <strong>{preview.plan.name}</strong>
            <small>
              来源：{validated.sourceLabel} · {preview.plan.weeks} 周 · {preview.plan.schedule === "rotation" ? "按顺序轮换" : "按星期执行"} · {preview.routineCount} 练 /{" "}
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
          {armedApply ? (
            <p className="muted csv-warn-note" role="status">
              再次点击将启用计划「<b>{preview.plan.name}</b>」（{preview.routineCount} 个训练日，来源：{validated.sourceLabel}）并替换当前生效计划。
            </p>
          ) : null}
        </div>
      ) : null}

      <footer>
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button type="button" className="secondary-button" disabled={committing || previewing || !validated} onClick={() => void commitPlan("draft")}>
          存为草稿
        </button>
        <button type="button" className="primary-button" disabled={committing || previewing || !validated} onClick={() => void commitPlan("apply")}>
          {armedApply ? "确认覆盖当前计划" : "一键启用"}
        </button>
      </footer>
    </div>
  );
}
