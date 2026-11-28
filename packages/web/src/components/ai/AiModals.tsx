import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { guessMeal, today } from "../../lib/date";
import { MEALS, safeUuid, type DietData, type MealKey, type RecordEnvelope, type WorkoutData } from "../../lib/domain";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export interface AiStatus {
  ready: boolean;
  mode: "demo" | "live" | "unconfigured";
  model: string | null;
  baseUrlHost?: string;
}

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void apiFetch<AiStatus>("/api/ai/status")
      .then((res) => {
        if (active) setStatus(res);
      })
      .catch(() => {
        if (active) setStatus({ ready: false, mode: "unconfigured", model: null });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { status, loading };
}

export function AiModePill({ status }: { status: AiStatus | null }) {
  if (!status?.ready) return <span className="ai-pill is-off">AI 未配置</span>;
  if (status.mode === "demo") return <span className="ai-pill is-demo">演示模拟 AI</span>;
  return <span className="ai-pill is-ready">{status.model || "在线模型"}</span>;
}

function AiUnconfiguredBox({ includeSettingsJump = true }: { includeSettingsJump?: boolean }) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openSettingsSection = useUiStore((s) => s.openSettingsSection);

  return (
    <div className="ai-status-card is-off">
      <div className="ai-status-badge">
        <Icon name="bolt" size={16} />
        <strong>AI 服务尚未配置</strong>
      </div>
      <p className="muted">
        当前服务未设置模型参数。请在启动后端的 <code>.env</code> 文件中配置兼容 OpenAI 接口的模型地址与密钥（密钥只保存在服务端，不会发送到浏览器）：
      </p>
      <div className="ai-setup-box">
        <pre className="ai-code">
          {`AI_BASE_URL=https://api.openai.com/v1\nAI_MODEL=gpt-4o-mini\nAI_API_KEY=sk-你的模型密钥`}
        </pre>
      </div>
      {includeSettingsJump ? (
        <div className="dialog-foot">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              closeAllModals();
              openSettingsSection("ai");
            }}
          >
            前往 AI 状态
          </button>
        </div>
      ) : null}
    </div>
  );
}

const REVIEW_PRESETS = [
  "总结我近 14 天的训练容量与肌群均衡",
  "分析我的体重、热量和蛋白质达标趋势",
  "给出下周力量突破和恢复减载建议",
];

export function AiReviewModal() {
  const { status, loading } = useAiStatus();
  const notify = useUiStore((s) => s.notify);
  const [promptText, setPromptText] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  if (loading) {
    return (
      <div className="dialog-form ai-modal">
        <p className="muted">正在检查 AI 服务状态…</p>
      </div>
    );
  }
  if (!status?.ready) return <div className="dialog-form ai-modal"><AiUnconfiguredBox /></div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = promptText.trim();
    if (!text || busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch<{ summary: string }>("/api/ai/review", {
        method: "POST",
        timeout: 125_000,
        body: { text },
      });
      if (!mountedRef.current) return;
      setSummary(res.summary || "");
    } catch (err) {
      if (mountedRef.current) setError((err as Error)?.message || "分析失败，请重试");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <form id="ai-review-form" className="dialog-form ai-modal" onSubmit={(e) => void submit(e)}>
      <div className="ai-head-meta">
        <AiModePill status={status} />
        <small className="muted">自动结合你近期的训练容量、肌群分布、体重与营养数据回答</small>
      </div>
      <div className="ai-presets">
        {REVIEW_PRESETS.map((p) => (
          <button key={p} type="button" className="ai-chip" onClick={() => setPromptText(p)}>
            {p}
          </button>
        ))}
      </div>
      <label className="field">
        <span>提问内容</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="例如：帮我评估近期胸部和背部的组数比例是否失衡…"
          required
        />
      </label>
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      {summary ? (
        <div id="ai-review-result" className="ai-result-box">
          <div className="ai-prose">
            {summary
              .split(/\n{2,}/)
              .filter(Boolean)
              .map((para, idx) => (
                <p key={idx}>
                  {para.split("\n").map((line, i, arr) => (
                    <span key={i}>
                      {line}
                      {i < arr.length - 1 ? <br /> : null}
                    </span>
                  ))}
                </p>
              ))}
          </div>
          <div className="dialog-foot">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void copyText(summary).then((ok) => notify(ok ? "复盘内容已复制" : "无法复制，请长按文本复制"));
              }}
            >
              <Icon name="copy" size={14} /> 复制内容
            </button>
          </div>
        </div>
      ) : null}
      <footer className="dialog-foot">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "正在结合近期数据分析…" : "生成教练复盘"}
        </button>
      </footer>
    </form>
  );
}

interface ParsedDietItem {
  _recordId: string;
  _opId: string;
  _opFingerprint: string;
  _baseVersion: number;
  _saved?: boolean;
  _conflict?: {
    savedVersion: number;
    savedName: string;
    savedCalories: number;
  } | null;
  include: boolean;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  raw?: Record<string, unknown>;
}

const DIET_CHIPS = [
  "两个水煮蛋，一盒全脂牛奶，两片全麦面包",
  "150g煎鸡胸肉，200g米饭，一勺蛋白粉",
  "轻食牛肉能量碗配牛油果和溏心蛋",
];

export function AiDietModal({ initialDate }: { initialDate?: string }) {
  const { status, loading } = useAiStatus();
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [date, setDate] = useState(initialDate || today());
  const [meal, setMeal] = useState<MealKey>(() => guessMeal());
  const [promptText, setPromptText] = useState("");
  const [foods, setFoods] = useState<ParsedDietItem[] | null>(null);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  if (loading) {
    return (
      <div className="dialog-form ai-modal">
        <p className="muted">正在检查 AI 服务状态…</p>
      </div>
    );
  }
  if (!status?.ready) return <div className="dialog-form ai-modal"><AiUnconfiguredBox /></div>;

  const parseDiet = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = promptText.trim();
    if (!text || parsing) return;
    setError("");
    setParsing(true);
    try {
      const res = await apiFetch<{ foods?: Array<{ name: string; calories: number; protein: number; carbs: number; fat: number } & Record<string, unknown>> }>(
        "/api/ai/parse-diet",
        {
          method: "POST",
          timeout: 125_000,
          body: { text, date, meal },
        },
      );
      if (!mountedRef.current) return;
      const items = (res.foods ?? []).map((f) => ({
        _recordId: safeUuid(),
        _opId: safeUuid(),
        _opFingerprint: "",
        _baseVersion: 0,
        _saved: false,
        _conflict: null,
        include: true,
        name: String(f.name || "食物"),
        calories: Math.max(0, Number(f.calories) || 0),
        protein: Math.max(0, Number(f.protein) || 0),
        carbs: Math.max(0, Number(f.carbs) || 0),
        fat: Math.max(0, Number(f.fat) || 0),
        raw: f,
      }));
      if (!items.length) throw new Error("未能从描述中识别出食物，请补充克数或份量后再试");
      setFoods(items);
    } catch (err) {
      if (mountedRef.current) setError((err as Error)?.message || "饮食识别失败");
    } finally {
      if (mountedRef.current) setParsing(false);
    }
  };

  const confirmSave = async () => {
    if (!foods || saving) return;
    const pendingEntries = foods
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.include && !item._saved);
    if (!pendingEntries.length) return;
    setSaving(true);
    setError("");

    const opByRecordId = new Map<string, { opId: string; fingerprint: string }>();
    const mutations = pendingEntries.map(({ item }) => {
      const bodyData: DietData = {
        ...(item.raw as Partial<DietData>),
        date,
        meal,
        name: item.name.trim() || "食物",
        calories: Math.max(0, Number(item.calories) || 0),
        protein: Math.max(0, Number(item.protein) || 0),
        carbs: Math.max(0, Number(item.carbs) || 0),
        fat: Math.max(0, Number(item.fat) || 0),
      };
      const fingerprint = JSON.stringify({ baseVersion: item._baseVersion, data: bodyData });
      const opId = item._opFingerprint === fingerprint && item._opId ? item._opId : safeUuid();
      opByRecordId.set(item._recordId, { opId, fingerprint });
      return {
        opId,
        id: item._recordId,
        kind: "diet" as const,
        baseVersion: item._baseVersion,
        deleted: false,
        data: bodyData,
      };
    });

    // Persist opIds + fingerprints so identical retries after network failure / 503 reuse the exact opId
    setFoods((prev) =>
      prev
        ? prev.map((row) => {
            const meta = opByRecordId.get(row._recordId);
            return meta ? { ...row, _opId: meta.opId, _opFingerprint: meta.fingerprint } : row;
          })
        : null,
    );

    try {
      const res = await apiFetch<{
        results?: Array<{
          opId: string;
          status: "applied" | "conflict";
          record?: RecordEnvelope<DietData>;
        }>;
      }>("/api/sync", {
        method: "POST",
        body: { cursor: 0, mutations },
      });
      if (!mountedRef.current) return;

      const resultsByOp = new Map((res.results ?? []).map((r) => [r.opId, r]));
      let appliedCount = 0;
      let conflictCount = 0;

      const nextFoods = foods.map((row) => {
        const meta = opByRecordId.get(row._recordId);
        if (!meta) return row;
        const outcome = resultsByOp.get(meta.opId);
        if (outcome?.status === "applied") {
          appliedCount++;
          return {
            ...row,
            _saved: true,
            _baseVersion: outcome.record?.version ?? row._baseVersion + 1,
            _conflict: null,
          };
        }
        conflictCount++;
        const serverRec = outcome?.record;
        return {
          ...row,
          _saved: false,
          _baseVersion: serverRec?.version ?? row._baseVersion,
          _opId: safeUuid(),
          _opFingerprint: "",
          _conflict: {
            savedVersion: serverRec?.version ?? row._baseVersion,
            savedName: serverRec?.data?.name ?? row.name,
            savedCalories: serverRec?.data?.calories ?? row.calories,
          },
        };
      });
      setFoods(nextFoods);

      if (appliedCount > 0) bumpDataEpoch();
      if (conflictCount > 0) {
        setError(
          `有 ${conflictCount} 项记录与云端已保存版本冲突（已保留弹窗并自动更新版本号），请核对后再次点击保存以覆盖更新`,
        );
        return;
      }

      closeAllModals();
      notify(`已写入 ${appliedCount} 项饮食记录`);
    } catch (err) {
      if (mountedRef.current) setError((err as Error)?.message || "保存饮食记录失败，请重试");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const selectedCount = foods?.filter((f) => f.include && !f._saved).length ?? 0;

  return (
    <form id="ai-diet-form" className="dialog-form ai-modal" onSubmit={(e) => void parseDiet(e)}>
      <div className="ai-head-meta">
        <AiModePill status={status} />
        <small className="muted">自动拆解多种食物并估算热量、蛋白、碳水与脂肪（需你确认后入库）</small>
      </div>
      <div className="fields">
        <label className="field">
          <span>日期</span>
          <input type="date" min="1902-01-01" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>餐次</span>
          <select value={meal} onChange={(e) => setMeal(e.target.value as MealKey)}>
            {(Object.entries(MEALS) as Array<[MealKey, string]>).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ai-presets">
        {DIET_CHIPS.map((c) => (
          <button key={c} type="button" className="ai-chip" onClick={() => setPromptText(c)}>
            {c}
          </button>
        ))}
      </div>
      <label className="field">
        <span>描述你吃了什么</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="例如：中午吃了150g鸡胸肉配200g米饭和炒青菜，下午喝了一杯冰美式…"
          required
        />
      </label>

      {foods ? (
        <div id="ai-diet-preview" className="ai-preview-list">
          <div className="ai-preview-head">
            <strong>请核对识别结果并勾选写入</strong>
            <small className="muted">可直接修改名称与克数</small>
          </div>
          {foods.map((item, idx) => (
            <div key={item._recordId} className="ai-food-card">
              <label className="ai-food-check">
                <input
                  type="checkbox"
                  className="switch"
                  checked={item.include}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFoods((prev) => prev?.map((row, i) => (i === idx ? { ...row, include: checked } : row)) ?? null);
                  }}
                />
                <input
                  type="text"
                  maxLength={120}
                  value={item.name}
                  disabled={Boolean(item._saved)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFoods((prev) => prev?.map((row, i) => (i === idx ? { ...row, name: val } : row)) ?? null);
                  }}
                />
              </label>
              {item._saved ? (
                <p className="muted" style={{ margin: "2px 0 4px", fontSize: 12 }}>
                  ✓ 已保存（v{item._baseVersion}）
                </p>
              ) : item._conflict ? (
                <p className="form-error" role="status" style={{ margin: "2px 0 6px", fontSize: 12 }}>
                  版本冲突：云端已保存 v{item._conflict.savedVersion}「{item._conflict.savedName} · {item._conflict.savedCalories} kcal」，再次点击保存将按当前内容更新至 v{item._conflict.savedVersion + 1}。
                </p>
              ) : null}
              <div className="ai-food-nums">
                {(
                  [
                    ["calories", "热量", "kcal", 20000],
                    ["protein", "蛋白", "g", 5000],
                    ["carbs", "碳水", "g", 5000],
                    ["fat", "脂肪", "g", 5000],
                  ] as const
                ).map(([field, label, unit, maxVal]) => (
                  <label key={field} className="input-unit">
                    <small>{label}</small>
                    <input
                      type="number"
                      min={0}
                      max={maxVal}
                      step="any"
                      value={item[field]}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                      }}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value) || 0);
                        setFoods((prev) => prev?.map((row, i) => (i === idx ? { ...row, [field]: val } : row)) ?? null);
                      }}
                    />
                    <span>{unit}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className="dialog-foot">
        <button type="submit" className={foods ? "secondary-button" : "primary-button"} disabled={parsing || saving}>
          {parsing ? "正在识别估算…" : foods ? "重新识别" : "识别饮食与热量"}
        </button>
        {foods ? (
          <button
            type="button"
            className="primary-button"
            id="ai-diet-save"
            disabled={saving || parsing || selectedCount === 0}
            onClick={() => void confirmSave()}
          >
            {saving ? "写入中…" : `确认写入记录 (${selectedCount} 项)`}
          </button>
        ) : null}
      </footer>
    </form>
  );
}

const WORKOUT_CHIPS = [
  "今天练胸：平板杠铃卧推 80kg 5×5，上斜哑铃卧推 26kg 4×10，双杠臂屈伸 3×12",
  "下肢力量日：深蹲 100kg 4×6，罗马尼亚硬拉 90kg 3×8，腿举 140kg 3×12",
  "核心与有氧：平板支撑 60秒×3 组，慢跑 30 分钟",
];

export function AiWorkoutModal({
  initialDate,
  onEditParsed,
  onSavedReport,
}: {
  initialDate?: string;
  onEditParsed: (seed: Partial<WorkoutData>) => void;
  onSavedReport: (record: RecordEnvelope<WorkoutData>) => void;
}) {
  const { status, loading } = useAiStatus();
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [date, setDate] = useState(initialDate || today());
  const [promptText, setPromptText] = useState("");
  const [parsed, setParsed] = useState<WorkoutData | null>(null);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  if (loading) {
    return (
      <div className="dialog-form ai-modal">
        <p className="muted">正在检查 AI 服务状态…</p>
      </div>
    );
  }
  if (!status?.ready) return <div className="dialog-form ai-modal"><AiUnconfiguredBox /></div>;

  const directSaveRef = useRef<{ fingerprint: string; opId: string; id: string } | null>(null);
  const parseAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { parseAbortRef.current?.abort(); }, []);

  const parseWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = promptText.trim();
    if (!text || parsing) return;
    parseAbortRef.current?.abort();
    const ctrl = new AbortController();
    parseAbortRef.current = ctrl;
    setError("");
    setParsing(true);
    try {
      const res = await apiFetch<{ workout: WorkoutData }>("/api/ai/parse-workout", {
        method: "POST",
        timeout: 125_000,
        signal: ctrl.signal,
        body: { text, date },
      });
      if (!mountedRef.current || ctrl.signal.aborted) return;
      setParsed(res.workout);
    } catch (err) {
      if (mountedRef.current && !ctrl.signal.aborted) setError((err as Error)?.message || "训练文本解析失败");
    } finally {
      if (mountedRef.current) setParsing(false);
    }
  };

  const handleSaveDirect = async () => {
    if (!parsed || saving) return;
    setSaving(true);
    setError("");
    // #169: Cache id + opId by payload fingerprint so retries after timeout/503 do not duplicate workouts
    const payloadData = { ...parsed, date };
    const fingerprint = JSON.stringify(payloadData);
    if (!directSaveRef.current || directSaveRef.current.fingerprint !== fingerprint) {
      directSaveRef.current = { fingerprint, opId: safeUuid(), id: safeUuid() };
    }
    const { opId, id } = directSaveRef.current;
    try {
      const res = await apiFetch<{ record: RecordEnvelope<WorkoutData> }>("/api/records", {
        method: "POST",
        body: {
          opId,
          id,
          kind: "workout",
          baseVersion: 0,
          deleted: false,
          data: payloadData,
        },
      });
      if (!mountedRef.current) return;
      directSaveRef.current = null;
      bumpDataEpoch();
      notify("已写入训练记录");
      onSavedReport(res.record);
    } catch (err) {
      if (mountedRef.current) setError((err as Error)?.message || "保存训练记录失败");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <form id="ai-workout-form" className="dialog-form ai-modal" onSubmit={(e) => void parseWorkout(e)}>
      <div className="ai-head-meta">
        <AiModePill status={status} />
        <small className="muted">自然语言口述整场训练，自动匹配系统动作并结构化各组重量次数</small>
      </div>
      <label className="field">
        <span>训练日期</span>
        <input type="date" min="1902-01-01" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="ai-presets">
        {WORKOUT_CHIPS.map((c) => (
          <button key={c} type="button" className="ai-chip" onClick={() => setPromptText(c)}>
            {c}
          </button>
        ))}
      </div>
      <label className="field">
        <span>描述本次训练</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="例如：卧推 80kg 做 4 组每组 6 次，划船 60kg 4×8…"
          required
        />
      </label>

      {parsed ? (
        <div id="ai-workout-preview" className="ai-preview-list">
          <div className="ai-preview-head">
            <strong>{parsed.title}</strong>
            <small className="muted">{parsed.exercises.length} 个动作</small>
          </div>
          {parsed.exercises.map((row) => (
            <div key={row.id} className="ai-workout-row">
              <strong>{row.snapshot?.name ?? row.exerciseId}</strong>
              <small>
                {row.sets
                  .map((s) => (row.snapshot?.mode === "timed" ? `${s.seconds}秒` : `${s.weight}kg×${s.reps}`))
                  .join(" · ")}
              </small>
            </div>
          ))}
        </div>
      ) : null}

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className="dialog-foot">
        <button type="submit" className={parsed ? "quiet" : "primary-button"} disabled={parsing || saving}>
          {parsing ? "正在解析结构化训练…" : parsed ? "重新解析" : "解析训练记录"}
        </button>
        {parsed ? (
          <>
            <button
              type="button"
              id="ai-workout-edit"
              className="secondary-button"
              disabled={saving}
              onClick={() => {
                onEditParsed({
                  ...parsed,
                  date,
                  status: "active",
                  endedAt: null,
                });
              }}
            >
              进入编辑器调整
            </button>
            <button type="button" id="ai-workout-save" className="primary-button" disabled={saving} onClick={() => void handleSaveDirect()}>
              {saving ? "保存中…" : "直接保存记录"}
            </button>
          </>
        ) : null}
      </footer>
    </form>
  );
}

const PLAN_PRESETS = [
  "每周4天上下肢分化增肌计划，器械齐全",
  "每周3天全身力量与增肌兼顾方案，适合90天周期",
  "减脂期保留力量：每周5天推拉腿分化+核心",
];

export function AiPlanModal({ activePlanId }: { activePlanId?: string | null }) {
  const { status, loading } = useAiStatus();
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openPlanSection = useUiStore((s) => s.openPlanSection);
  const notify = useUiStore((s) => s.notify);

  const [promptText, setPromptText] = useState("");
  const [refine, setRefine] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  if (loading) {
    return (
      <div className="dialog-form ai-modal">
        <p className="muted">正在检查 AI 服务状态…</p>
      </div>
    );
  }
  if (!status?.ready) return <div className="dialog-form ai-modal"><AiUnconfiguredBox /></div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = promptText.trim();
    if (!text || busy) return;
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch<{ record?: { id: string } }>("/api/ai/plan", {
        method: "POST",
        timeout: 125_000,
        body: { text, ...(refine && activePlanId ? { parentId: activePlanId } : {}) },
      });
      if (!mountedRef.current) return;
      bumpDataEpoch();
      closeAllModals();
      openPlanSection("drafts");
      notify(res.record ? "AI 已生成新计划草稿，请在草稿列表核对后启用" : "已生成计划");
    } catch (err) {
      if (mountedRef.current) setError((err as Error)?.message || "生成计划失败");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <form id="ai-plan-form" className="dialog-form ai-modal" onSubmit={(e) => void submit(e)}>
      <div className="ai-head-meta">
        <AiModePill status={status} />
        <small className="muted">结合你的器械偏好与近期 1RM 生成周期分化草稿，安全入草稿箱后再启用</small>
      </div>
      <div className="ai-presets">
        {PLAN_PRESETS.map((p) => (
          <button key={p} type="button" className="ai-chip" onClick={() => setPromptText(p)}>
            {p}
          </button>
        ))}
      </div>
      {activePlanId ? (
        <label className="toggle-row">
          <input type="checkbox" className="switch" checked={refine} onChange={(e) => setRefine(e.target.checked)} />
          <span>基于当前正在执行的训练计划进行微调迭代</span>
        </label>
      ) : null}
      <label className="field">
        <span>训练目标与周期诉求</span>
        <textarea
          rows={4}
          maxLength={4000}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="例如：帮我设计每周4天的上肢/下肢分化，重点加强上胸与背阔肌，单次控制在60分钟内…"
          required
        />
      </label>
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer className="dialog-foot">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "正在排课与设定渐进规则…" : "生成训练计划草稿"}
        </button>
      </footer>
    </form>
  );
}

export interface AdaptChangeProposal {
  exerciseRowId: string;
  before: {
    exerciseId: string;
    snapshot?: { name?: string };
    openSets: unknown[];
  };
  patch: {
    exerciseId?: string;
    weight?: number;
    reps?: number;
    seconds?: number;
    remainingSets?: number;
    restSeconds?: number;
  };
  reason: string;
}

export interface WorkoutAdaptationProposal {
  workoutId: string;
  summary: string;
  changes: AdaptChangeProposal[];
}

function formatAdaptPatch(
  before: AdaptChangeProposal["before"] & { weightUnit?: "kg" | "lb" },
  patch: AdaptChangeProposal["patch"] & { weightUnit?: "kg" | "lb" },
): string {
  const notes: string[] = [];
  const unit = patch.weightUnit ?? before.weightUnit ?? "kg";
  if (patch.exerciseId && patch.exerciseId !== before.exerciseId) notes.push("更换动作");
  if (patch.weight !== undefined) notes.push(`重量 → ${patch.weight} ${unit}`);
  if (patch.reps !== undefined) notes.push(`次数 → ${patch.reps} 次`);
  if (patch.seconds !== undefined) notes.push(`时长 → ${patch.seconds} 秒`);
  if (patch.remainingSets !== undefined) {
    notes.push(patch.remainingSets === 0 ? "跳过余下组" : `余组 ${before.openSets.length} → ${patch.remainingSets} 组`);
  }
  if (patch.restSeconds !== undefined) notes.push(`休息 → ${patch.restSeconds} 秒`);
  return notes.join(" · ") || "微调参数";
}

const ADAPT_PRESETS = [
  "状态有点疲劳，适当降一点重量或减掉最后一组",
  "器械正被人占用，把剩余未练动作替换为同类哑铃/绳索",
  "时间只剩 20 分钟，精简剩余训练组数与休息",
];

export function AiAdaptWorkoutModal({
  ensureSavedWorkout,
  onApplied,
}: {
  ensureSavedWorkout: () => Promise<RecordEnvelope<WorkoutData>>;
  onApplied: (updated: RecordEnvelope<WorkoutData>) => void;
}) {
  const { status, loading } = useAiStatus();
  const closeTopModal = useUiStore((s) => s.closeTopModal);

  const [promptText, setPromptText] = useState("");
  const [proposal, setProposal] = useState<WorkoutAdaptationProposal | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [waitSecs, setWaitSecs] = useState(0);

  // #167: Guard unmount & abort in-flight AI requests so closing early never closes the underlying WorkoutEditorModal
  const mountedRef = useRef(true);
  const askAbortRef = useRef<AbortController | null>(null);
  const applyAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      askAbortRef.current?.abort();
      applyAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!asking) {
      setWaitSecs(0);
      return;
    }
    const started = Date.now();
    const t = window.setInterval(() => setWaitSecs(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [asking]);

  if (loading) {
    return (
      <div className="dialog-form ai-modal">
        <p className="muted">正在检查 AI 服务状态…</p>
      </div>
    );
  }
  if (!status?.ready) {
    return (
      <div className="dialog-form ai-modal">
        <AiUnconfiguredBox />
      </div>
    );
  }

  const handleAsk = async () => {
    const text = promptText.trim();
    if (!text) {
      setError("请先填写当前状态或时间要求");
      return;
    }
    askAbortRef.current?.abort();
    const ctrl = new AbortController();
    askAbortRef.current = ctrl;
    setAsking(true);
    setError("");
    try {
      const saved = await ensureSavedWorkout();
      if (!mountedRef.current || ctrl.signal.aborted) return;
      const res = await apiFetch<WorkoutAdaptationProposal>("/api/ai/adapt-workout", {
        method: "POST",
        timeout: 125_000,
        signal: ctrl.signal,
        body: { workoutId: saved.id, text },
      });
      if (!mountedRef.current || ctrl.signal.aborted) return;
      setProposal(res);
      setSelectedIds(new Set(res.changes.map((c) => c.exerciseRowId)));
    } catch (err) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        setError((err as Error)?.message || "获取 AI 调整建议失败");
      }
    } finally {
      if (mountedRef.current) setAsking(false);
    }
  };

  const handleCancelAsk = () => {
    askAbortRef.current?.abort();
    setAsking(false);
  };

  const handleApply = async () => {
    if (!proposal || applying) return;
    const selectedRowIds = [...selectedIds];
    if (!selectedRowIds.length) {
      setError("请至少保留一项需要应用的调整");
      return;
    }
    applyAbortRef.current?.abort();
    const ctrl = new AbortController();
    applyAbortRef.current = ctrl;
    setApplying(true);
    setError("");
    try {
      const { record } = await apiFetch<{ record: RecordEnvelope<WorkoutData> }>("/api/ai/adapt-workout/apply", {
        method: "POST",
        signal: ctrl.signal,
        body: { workoutId: proposal.workoutId, proposal, selectedRowIds },
      });
      onApplied(record);
      if (mountedRef.current && !ctrl.signal.aborted) {
        closeTopModal();
      }
    } catch (err) {
      if (mountedRef.current && !ctrl.signal.aborted) {
        setError((err as Error)?.message || "应用 AI 调整失败");
      }
    } finally {
      if (mountedRef.current) setApplying(false);
    }
  };

  return (
    <div className="dialog-form ai-modal">
      <div className="ai-head-meta">
        <AiModePill status={status} />
        <small className="muted">自动保留已完成组，仅对你确认勾选的剩余动作与组数生效</small>
      </div>
      <div className="ai-presets">
        {ADAPT_PRESETS.map((p) => (
          <button key={p} type="button" className="ai-chip" onClick={() => setPromptText(p)}>
            {p}
          </button>
        ))}
      </div>
      <label className="field">
        <span>当前感受或需要调整的条件</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="例如：右肩前束轻微不适 / 器械全满想换哑铃 / 还有 15 分钟得走…"
        />
      </label>

      {proposal ? (
        <div className="ai-result-box">
          <div className="ai-prose">
            <p>{proposal.summary}</p>
          </div>
          {proposal.changes.length ? (
            <div className="ai-adapt-changes">
              {proposal.changes.map((ch) => {
                const exName = ch.before.snapshot?.name ?? ch.before.exerciseId;
                const checked = selectedIds.has(ch.exerciseRowId);
                return (
                  <label key={ch.exerciseRowId} className="ai-adapt-item">
                    <input
                      type="checkbox"
                      className="switch"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(ch.exerciseRowId);
                        else next.delete(ch.exerciseRowId);
                        setSelectedIds(next);
                      }}
                    />
                    <span>
                      <strong>
                        {exName} · {formatAdaptPatch(ch.before, ch.patch)}
                      </strong>
                      <small>{ch.reason}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="muted">当前无需修改具体组数，按原计划继续即可。</p>
          )}
        </div>
      ) : null}

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className="dialog-foot">
        <button
          type="button"
          className={proposal ? "secondary-button" : "primary-button"}
          disabled={asking || applying}
          onClick={() => void handleAsk()}
        >
          {asking ? "正在分析…" : proposal ? "重新获取" : "获取 AI 建议"}
        </button>
        {proposal && proposal.changes.length > 0 ? (
          <button
            type="button"
            className="primary-button"
            disabled={applying || asking || selectedIds.size === 0}
            onClick={() => void handleApply()}
          >
            {applying ? "应用中…" : "应用已选调整"}
          </button>
        ) : null}
      </footer>
    </div>
  );
}

export function TextLogModal({
  initialTab = "workout",
  initialDate,
  onEditParsed,
  onSavedReport,
}: {
  initialTab?: "workout" | "diet";
  initialDate?: string;
  onEditParsed: (seed: Partial<WorkoutData>) => void;
  onSavedReport: (record: RecordEnvelope<WorkoutData>) => void;
}) {
  const [tab, setTab] = useState<"workout" | "diet">(initialTab);

  return (
    <div className="dialog-form">
      <div className="segments" role="tablist" aria-label="记录类型" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={tab === "workout"} aria-pressed={tab === "workout"} onClick={() => setTab("workout")}>
          训练
        </button>
        <button type="button" role="tab" aria-selected={tab === "diet"} aria-pressed={tab === "diet"} onClick={() => setTab("diet")}>
          饮食
        </button>
      </div>
      {tab === "workout" ? (
        <AiWorkoutModal
          initialDate={initialDate}
          onEditParsed={onEditParsed}
          onSavedReport={onSavedReport}
        />
      ) : (
        <AiDietModal initialDate={initialDate} />
      )}
    </div>
  );
}
