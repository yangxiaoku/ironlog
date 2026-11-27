import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { safeExerciseMediaUrl, safeExternalUrl } from "../../lib/catalogue";
import { fmt, shortDate, today } from "../../lib/date";
import {
  EQUIPMENT,
  MUSCLES,
  type CatalogueExercise,
  type EquipmentKey,
  type ExerciseMode,
  type FavoriteData,
  type MuscleKey,
  type RecordEnvelope,
  type WorkoutData,
} from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

interface ExerciseHistorySession {
  date: string;
  title: string;
  workSets: number;
  weightUnit?: "kg" | "lb";
  topWeight?: number | null;
  topReps?: number | null;
  estimated1rm?: number | null;
  bestSeconds?: number | null;
  sets: Array<{ weight: number; weightUnit?: "kg" | "lb"; weightKg?: number; reps: number; seconds: number }>;
}

interface ExerciseHistoryResponse {
  note?: string;
  sessions?: ExerciseHistorySession[];
}

function ExDetailSparkline({
  sessions,
  timed,
  assisted,
}: {
  sessions: ExerciseHistorySession[];
  timed: boolean;
  assisted: boolean;
}) {
  const pts = sessions
    .slice()
    .reverse()
    .map((s) => ({
      date: s.date,
      value: timed ? s.bestSeconds : assisted ? s.topWeight : s.estimated1rm ?? s.topWeight,
    }))
    .filter((p): p is { date: string; value: number } =>
      p.value != null && (assisted ? p.value >= 0 : p.value > 0),
    );
  if (pts.length < 2) return null;

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
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });
  const unit = timed ? "秒" : "kg";
  const chartTitle = timed ? "最长保持趋势" : assisted ? "辅助重量走势（越低越强）" : "估算 1RM 走势";
  const chartAria = timed ? "时长走势图" : assisted ? "辅助重量走势图" : "估算1RM走势图";

  return (
    <div className="ex-detail-chart">
      <div className="ex-chart-head">
        <span>{chartTitle}</span>
        <small>
          {fmt(min)} → {fmt(max)} {unit}
        </small>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={chartAria}>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords.map((pt) => `${pt.x},${pt.y}`).join(" ")}
        />
        {coords.map((pt, idx) => (
          <circle key={idx} cx={pt.x} cy={pt.y} r={2.8} fill="currentColor" />
        ))}
      </svg>
      <div className="ex-chart-foot">
        <small>{shortDate(pts[0]!.date)}</small>
        <small>{shortDate(pts.at(-1)!.date)}</small>
      </div>
    </div>
  );
}

export function ExerciseDetailModal({
  exerciseId,
  customRecord,
  inActiveWorkout = false,
  onQuickStart,
  onEditCustom,
  onResolvedTitle,
}: {
  exerciseId: string;
  customRecord?: RecordEnvelope<CatalogueExercise> | null;
  inActiveWorkout?: boolean;
  onQuickStart: (seed: Partial<WorkoutData>) => void;
  onEditCustom?: (rec: RecordEnvelope<CatalogueExercise>) => void;
  onResolvedTitle?: (name: string) => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const notify = useUiStore((s) => s.notify);

  const [exercise, setExercise] = useState<CatalogueExercise | null>(customRecord?.data ?? null);
  const [resolvedCustomRec, setResolvedCustomRec] = useState<RecordEnvelope<CatalogueExercise> | null>(customRecord ?? null);
  const [hist, setHist] = useState<ExerciseHistoryResponse | null>(null);
  const [favRec, setFavRec] = useState<RecordEnvelope<FavoriteData> | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [togglingFav, setTogglingFav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const [exRes, histRes, favsRes, customsRes] = await Promise.all([
          customRecord
            ? Promise.resolve({ exercise: customRecord.data })
            : apiFetch<{ exercise: CatalogueExercise }>(`/api/catalogue/exercises/${encodeURIComponent(exerciseId)}`, {
                token: "",
              }).catch(() => null),
          userId ? apiFetch<ExerciseHistoryResponse>(`/api/web/exercise-history/${encodeURIComponent(exerciseId)}`).catch(() => null) : Promise.resolve(null),
          userId ? apiFetch<Array<RecordEnvelope<FavoriteData>>>("/api/records/favorite").catch(() => []) : Promise.resolve([]),
          !customRecord && userId ? apiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise").catch(() => []) : Promise.resolve([]),
        ]);
        if (!active) return;
        const foundCustom = customRecord ?? customsRes.find((r) => !r.deleted && r.data?.id === exerciseId) ?? null;
        const resolved = exRes?.exercise ?? (foundCustom ? { ...foundCustom.data, custom: true } : null);
        if (!resolved) {
          setError("未找到该动作详情");
          return;
        }
        setResolvedCustomRec(foundCustom);
        setExercise(resolved);
        onResolvedTitle?.(resolved.name);
        setHist(histRes);
        setNoteInput(histRes?.note ?? "");
        const matchedFav = favsRes.find((r) => !r.deleted && r.data?.exerciseId === resolved.id) ?? null;
        setFavRec(matchedFav);
      } catch (err) {
        if (active) setError((err as Error)?.message || "加载动作详情失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [exerciseId, customRecord, userId, onResolvedTitle]);

  if (loading) {
    return (
      <div className="exercise-detail">
        <p className="muted" style={{ padding: "18px 0" }}>正在读取动作百科与个人训练档案…</p>
      </div>
    );
  }

  if (error || !exercise) {
    return (
      <div className="exercise-detail">
        <p className="form-error" role="alert">
          {error || "无法加载动作详情"}
        </p>
      </div>
    );
  }

  const illustration = exercise.illustration;
  const frames = (illustration?.frames ?? []).filter((f) => safeExerciseMediaUrl(f.path));
  const gifPath = safeExerciseMediaUrl(illustration?.gifPath);
  const tags = [
    MUSCLES[exercise.muscle] ?? exercise.muscle,
    EQUIPMENT[exercise.equipment] ?? exercise.equipment,
    exercise.custom ? "自定义动作" : "",
  ].filter(Boolean);
  const timed = exercise.mode === "timed";
  const assisted = exercise.mode === "assisted";
  const sessions = hist?.sessions ?? [];
  const totalWorkSets = sessions.reduce((s, r) => s + (r.workSets ?? 0), 0);
  const bestWeight = sessions.reduce((m, r) => (r.topWeight != null && r.topWeight > m ? r.topWeight : m), 0);
  const bestAssistance = sessions.reduce<number | null>(
    (m, r) => (r.topWeight != null && (m == null || r.topWeight < m) ? r.topWeight : m),
    null,
  );
  const best1rm = sessions.reduce((m, r) => (r.estimated1rm != null && r.estimated1rm > m ? r.estimated1rm : m), 0);
  const bestHold = sessions.reduce((m, r) => (r.bestSeconds != null && r.bestSeconds > m ? r.bestSeconds : m), 0);
  const isFav = Boolean(favRec);

  const handleToggleFav = async () => {
    if (!userId || togglingFav) return;
    triggerHaptic("light");
    setTogglingFav(true);
    try {
      if (favRec) {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: favRec.id,
            kind: "favorite",
            baseVersion: favRec.version,
            deleted: true,
            data: favRec.data,
          },
        });
        setFavRec(null);
        notify("已取消收藏");
      } else {
        const id = `fav_${crypto.randomUUID().slice(0, 12)}`;
        const res = await apiFetch<{ record?: RecordEnvelope<FavoriteData> }>("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id,
            kind: "favorite",
            baseVersion: 0,
            deleted: false,
            data: { exerciseId: exercise.id },
          },
        });
        setFavRec(
          res.record ?? {
            id,
            kind: "favorite",
            version: 1,
            deleted: false,
            updatedAt: new Date().toISOString(),
            data: { exerciseId: exercise.id },
          },
        );
        notify("已加入收藏");
      }
      bumpDataEpoch();
    } catch (err) {
      notify((err as Error)?.message || "更新收藏失败");
    } finally {
      setTogglingFav(false);
    }
  };

  const handleSaveNote = async () => {
    if (!userId || savingNote) return;
    setSavingNote(true);
    try {
      await apiFetch(`/api/web/exercise-notes/${encodeURIComponent(exercise.id)}`, {
        method: "PUT",
        body: { note: noteInput },
      });
      notify("动作备忘已保存");
    } catch (err) {
      notify((err as Error)?.message || "保存备忘失败");
    } finally {
      setSavingNote(false);
    }
  };

  const handleQuickStart = () => {
    triggerHaptic("light");
    onQuickStart({
      title: `${exercise.name}训练`,
      date: today(),
      exercises: [
        {
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          restSeconds: 90,
          snapshot: {
            name: exercise.name,
            muscle: exercise.muscle,
            equipment: exercise.equipment,
            mode: exercise.mode,
            volumeMultiplier: exercise.volumeMultiplier ?? 1,
          },
          sets: [0, 1, 2].map(() => ({
            id: crypto.randomUUID(),
            type: "normal" as const,
            weight: 0,
            reps: timed ? 1 : 8,
            seconds: timed ? 45 : 0,
            completed: false,
            rir: null,
          })),
        },
      ],
    });
  };

  return (
    <div className="exercise-detail">
      <div className="exercise-meta">
        <p>{exercise.englishName || "自定义器械或训练动作"}</p>
        <div>
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>

      {userId ? (
        <div className="exercise-detail-actions">
          {inActiveWorkout ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                triggerHaptic("light");
                closeTopModal();
              }}
            >
              返回当前训练
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={handleQuickStart}>
              <Icon name="workout" size={15} /> 以此动作开始训练
            </button>
          )}
          <button
            type="button"
            className={`secondary-button${isFav ? " is-faved" : ""}`}
            disabled={togglingFav}
            onClick={() => void handleToggleFav()}
          >
            <Icon name={isFav ? "starFilled" : "star"} size={15} /> {isFav ? "已收藏" : "收藏动作"}
          </button>
          {resolvedCustomRec && onEditCustom ? (
            <button type="button" className="secondary-button" onClick={() => onEditCustom(resolvedCustomRec)}>
              编辑自定义动作
            </button>
          ) : null}
        </div>
      ) : null}

      {userId ? (
        <section className="ex-detail-dossier" aria-label="个人训练档案">
          <h3>个人训练档案</h3>
          <div className="ex-detail-kpis">
            {timed ? (
              <div>
                <span>最佳时长</span>
                <strong>{bestHold > 0 ? <>{bestHold} <small>秒</small></> : "—"}</strong>
              </div>
            ) : assisted ? (
              <div>
                <span>最低辅助</span>
                <strong>
                  {bestAssistance != null ? (
                    bestAssistance === 0 ? (
                      <>0 <small>kg（无辅助）</small></>
                    ) : (
                      <>{fmt(bestAssistance)} <small>kg</small></>
                    )
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
            ) : (
              <>
                <div>
                  <span>历史最佳</span>
                  <strong>{bestWeight > 0 ? <>{fmt(bestWeight)} <small>kg</small></> : "—"}</strong>
                </div>
                <div>
                  <span>估算 1RM</span>
                  <strong>{best1rm > 0 ? <>{fmt(best1rm)} <small>kg</small></> : "—"}</strong>
                </div>
              </>
            )}
            <div>
              <span>近期场次</span>
              <strong>{sessions.length} <small>场</small></strong>
            </div>
            <div>
              <span>累计工作组</span>
              <strong>{totalWorkSets} <small>组</small></strong>
            </div>
          </div>

          <ExDetailSparkline sessions={sessions} timed={timed} assisted={assisted} />

          <div className="ex-detail-note">
            <input
              type="text"
              maxLength={500}
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="记下座椅档位、握距或发力要点…"
              aria-label="动作个人备忘"
            />
            <button type="button" className="secondary-button" disabled={savingNote} onClick={() => void handleSaveNote()}>
              {savingNote ? "保存中…" : "保存备忘"}
            </button>
          </div>

          {sessions.length ? (
            <ul className="ex-detail-history">
              {sessions.slice(0, 6).map((s, idx) => (
                <li key={`${s.date}-${idx}`}>
                  <div className="ex-hist-head">
                    <b>{shortDate(s.date)}</b>
                    <span>{s.title}</span>
                    <small>
                      {timed
                        ? s.bestSeconds
                          ? `最佳 ${s.bestSeconds} 秒`
                          : ""
                        : s.topWeight != null
                          ? `${fmt(s.topWeight)}kg × ${s.topReps ?? 0}`
                          : ""}
                      {!timed && s.estimated1rm ? ` · 1RM ${fmt(s.estimated1rm)}` : ""}
                    </small>
                  </div>
                  <div className="ex-hist-sets">
                    {s.sets.slice(0, 6).map((st, sIdx) => (
                      <span key={sIdx}>
                        {timed ? `${st.seconds}s` : `${fmt(st.weight)}${st.weightUnit ?? s.weightUnit ?? "kg"}×${st.reps}`}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">暂无该动作的历史记录，点击上方「以此动作开始训练」立即建立记录。</p>
          )}
        </section>
      ) : null}

      {exercise.description ? <p className="exercise-summary">{exercise.description}</p> : null}

      <div className={`exercise-guide${frames.length ? " with-poses" : ""}`}>
        {frames.length ? (
          <section className="exercise-poses">
            <h3>姿势示意</h3>
            {gifPath ? (
              <figure className="pose-anim-hero">
                <img src={gifPath} width={160} height={160} alt={`${exercise.name} 动作示范动图`} />
                <figcaption>
                  <span>GIF</span>动态示范
                </figcaption>
              </figure>
            ) : null}
            <div className="pose-grid">
              {frames.map((frame, index) => (
                <figure key={frame.path}>
                  <img src={frame.path} alt={frame.caption ?? exercise.name} />
                  <figcaption>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {frame.caption ?? ""}
                  </figcaption>
                </figure>
              ))}
            </div>
            {illustration?.author || illustration?.licenseUrl || illustration?.sourceUrl ? (
              <details className="credit">
                <summary>图片来源与许可</summary>
                <p>
                  {illustration.author ?? "Ironlog"}
                  {safeExternalUrl(illustration.licenseUrl) ? (
                    <>
                      {" "}
                      ·{" "}
                      <a href={safeExternalUrl(illustration.licenseUrl)} target="_blank" rel="noopener noreferrer">
                        {illustration.license ?? "许可协议"}
                      </a>
                    </>
                  ) : null}
                  {safeExternalUrl(illustration.sourceUrl) ? (
                    <>
                      {" "}
                      ·{" "}
                      <a href={safeExternalUrl(illustration.sourceUrl)} target="_blank" rel="noopener noreferrer">
                        素材来源
                      </a>
                    </>
                  ) : null}
                </p>
              </details>
            ) : null}
          </section>
        ) : null}

        <section className="exercise-instructions">
          <h3>动作步骤</h3>
          {exercise.instructions?.length ? (
            <ol>
              {exercise.instructions.map((stepText, idx) => (
                <li key={idx}>{stepText}</li>
              ))}
            </ol>
          ) : (
            <p className="muted">暂无步骤说明。</p>
          )}
          {exercise.mistakes?.length ? (
            <details className="exercise-notes">
              <summary>常见问题</summary>
              <ul>
                {exercise.mistakes.map((m, idx) => (
                  <li key={idx}>{m}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}

const MODE_LABELS: Record<ExerciseMode, string> = {
  reps: "负重 / 计次",
  timed: "静态计时",
  assisted: "机械辅助（减重）",
};

export function CustomExerciseModal({
  existing,
}: {
  existing?: RecordEnvelope<CatalogueExercise> | null;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const cur = existing?.data;
  const [name, setName] = useState(cur?.name ?? "");
  const [englishName, setEnglishName] = useState(cur?.englishName ?? "");
  const [muscle, setMuscle] = useState<MuscleKey>(cur?.muscle ?? "chest");
  const [equipment, setEquipment] = useState<EquipmentKey>(cur?.equipment ?? "machine");
  const [mode, setMode] = useState<ExerciseMode>(cur?.mode ?? "reps");
  const [instructions, setInstructions] = useState((cur?.instructions ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = () => {
    if (!existing) return;
    openConfirm({
      title: "删除自定义动作",
      message: `确定要删除「${existing.data.name}」吗？历史已记录的训练快照不受影响。`,
      confirmLabel: "删除动作",
      onConfirm: async () => {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: existing.id,
            kind: "exercise",
            baseVersion: existing.version,
            deleted: true,
            data: existing.data,
          },
        });
        bumpDataEpoch();
        closeAllModals();
        notify("已删除自定义动作");
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || saving) return;
    const rawSteps = instructions
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const id = existing?.id ?? `custom_${crypto.randomUUID().slice(0, 12)}`;
    const payload: CatalogueExercise = {
      id,
      name: cleanName,
      englishName: englishName.trim(),
      aliases: cur?.aliases ?? [],
      muscle,
      secondaryMuscles: cur?.secondaryMuscles ?? [],
      equipment,
      mode,
      volumeMultiplier: cur?.volumeMultiplier ?? 1,
      instructions: rawSteps.length ? rawSteps.slice(0, 16) : [`标准执行「${cleanName}」，控制离心下放与发力节奏。`],
      mistakes: cur?.mistakes ?? [],
      custom: true,
    };
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: crypto.randomUUID(),
          id,
          kind: "exercise",
          baseVersion: existing?.version ?? 0,
          deleted: false,
          data: payload,
        },
      });
      bumpDataEpoch();
      closeAllModals();
      notify(existing ? `已更新自定义动作「${cleanName}」` : `已创建自定义动作「${cleanName}」`);
    } catch (err) {
      setError((err as Error)?.message || "保存自定义动作失败");
      setSaving(false);
    }
  };

  return (
    <form id="custom-exercise-form" className="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="field">
        <span>动作名称</span>
        <input
          maxLength={120}
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：悍马机斜上推胸"
        />
      </label>
      <label className="field">
        <span>英文名或别名（可选）</span>
        <input
          maxLength={120}
          value={englishName}
          onChange={(e) => setEnglishName(e.target.value)}
          placeholder="例如：Hammer Incline Press"
        />
      </label>
      <div className="fields">
        <label className="field">
          <span>主要肌群</span>
          <select value={muscle} onChange={(e) => setMuscle(e.target.value as MuscleKey)}>
            {(Object.entries(MUSCLES) as Array<[MuscleKey, string]>).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>主要器械</span>
          <select value={equipment} onChange={(e) => setEquipment(e.target.value as EquipmentKey)}>
            {(Object.entries(EQUIPMENT) as Array<[EquipmentKey, string]>).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>计量方式</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as ExerciseMode)}>
            {(Object.entries(MODE_LABELS) as Array<[ExerciseMode, string]>).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>动作要领（可选，每行一步）</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="收紧肩胛下沉，控制离心 2 秒…"
        />
      </label>
      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      <footer className={`dialog-foot${existing ? " has-remove" : ""}`}>
        {existing ? (
          <button type="button" className="danger" onClick={handleDelete}>
            删除动作
          </button>
        ) : (
          <button type="button" className="quiet" onClick={closeAllModals}>
            取消
          </button>
        )}
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : existing ? "保存修改" : "保存并创建"}
        </button>
      </footer>
    </form>
  );
}
