import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { fmt } from "../../lib/date";
import {
  EQUIPMENT,
  MUSCLES,
  type CatalogueExercise,
  type EquipmentKey,
  type MuscleKey,
  type PlannedExercise,
  type ProgressionRule,
  type RecordEnvelope,
} from "../../lib/domain";
import { Icon } from "../Icon";

export const PROGRESSION_NAMES: Record<ProgressionRule, string> = {
  double: "双线性渐进（推荐）",
  triple: "三重渐进（次→组→重）",
  linear: "每次线性加重",
  greyskull: "Greyskull AMRAP",
  manual: "手动 / 保持",
};

export const PROGRESSION_SHORT_LABELS: Record<ProgressionRule, string> = {
  double: "双线性",
  triple: "三重渐进",
  linear: "线性递增",
  greyskull: "Greyskull",
  manual: "",
};

export interface ExercisePrInfo {
  exerciseId: string;
  mode: string;
  weight?: number | null;
  oneRepMax?: number | null;
  hold?: number | null;
  assistance?: number | null;
}

export function supersetBadges(rows: ReadonlyArray<{ supersetGroup?: string | null }>): Array<string | null> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const g = r?.supersetGroup ? String(r.supersetGroup).trim() : "";
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  let idx = 0;
  for (const r of rows) {
    const g = r?.supersetGroup ? String(r.supersetGroup).trim() : "";
    if (g && (counts.get(g) ?? 0) >= 2 && !labels.has(g)) {
      labels.set(g, String.fromCharCode(65 + (idx++ % 26)));
    }
  }
  return rows.map((r) => {
    const g = r?.supersetGroup ? String(r.supersetGroup).trim() : "";
    return g ? labels.get(g) ?? null : null;
  });
}

export function sanitizePlannedExercises(
  rows: PlannedExercise[],
  catalogueMap: Map<string, CatalogueExercise>,
): PlannedExercise[] {
  return rows.map((row) => {
    const ex = catalogueMap.get(row.exerciseId);
    // #157: When exercise metadata failed to load, infer timed from existing seconds > 0 so saving never wipes timed targets to 0
    const timed = ex ? ex.mode === "timed" : Number(row.seconds) > 0;
    const min = timed ? 1 : Math.max(1, Math.min(1000, Math.round(Number(row.repsMin) || 8)));
    const max = timed ? 1 : Math.max(min, Math.min(1000, Math.round(Number(row.repsMax) || min)));
    const rawRest = (row.restSeconds as unknown) === "" || row.restSeconds == null ? 90 : Number(row.restSeconds);
    return {
      exerciseId: row.exerciseId,
      sets: Math.max(1, Math.min(100, Math.round(Number(row.sets) || 3))),
      repsMin: min,
      repsMax: max,
      weight: (row.weight as unknown) === "" || row.weight == null ? null : Math.max(0, Number(row.weight)),
      seconds: timed ? Math.max(1, Math.min(86400, Math.round(Number(row.seconds) || 45))) : 0,
      restSeconds: Math.max(0, Math.min(900, Math.round(Number.isFinite(rawRest) ? rawRest : 90))),
      targetRir: Math.max(0, Math.min(10, Math.round(Number(row.targetRir ?? 2)))),
      progression: (["double", "triple", "linear", "greyskull", "manual"].includes(row.progression)
        ? row.progression
        : "double") as ProgressionRule,
      ...(row.progression === "triple"
        ? {
            setsMax: Math.max(
              Math.max(1, Math.min(100, Math.round(Number(row.sets) || 3))),
              Math.min(20, Math.round(Number(row.setsMax) || (Number(row.sets) || 3) + 2)),
            ),
          }
        : {}),
      ...(row.deloadMissThreshold != null
        ? { deloadMissThreshold: Math.max(2, Math.min(5, Math.round(Number(row.deloadMissThreshold) || 3))) }
        : {}),
      increment: Math.max(0, Math.min(20, Number(row.increment ?? 2.5))),
      backupExerciseId: row.backupExerciseId && row.backupExerciseId !== row.exerciseId ? row.backupExerciseId : null,
      supersetGroup: row.supersetGroup ? String(row.supersetGroup).trim().slice(0, 16) : null,
      ...(row.weightUnit === "kg" || row.weightUnit === "lb" ? { weightUnit: row.weightUnit } : {}),
      ...(row.autoWarmup ? { autoWarmup: true } : {}),
    };
  });
}

export function MuscleDistributionSummary({
  routines,
  catalogueMap,
  title = "全周肌群分布平衡",
  subNote = "推荐 10–20 组/部位",
  emptyHint = "",
  highlightRange = true,
}: {
  routines: ReadonlyArray<{ exercises: PlannedExercise[] }>;
  catalogueMap: Map<string, CatalogueExercise>;
  title?: string;
  subNote?: string;
  emptyHint?: string;
  highlightRange?: boolean;
}) {
  const tracked = new Set<MuscleKey>(["chest", "back", "legs", "shoulders", "arms", "core"]);
  const totalMap = new Map<MuscleKey, number>();
  let totalSets = 0;

  for (const r of routines) {
    for (const row of r.exercises ?? []) {
      const ex = catalogueMap.get(row.exerciseId);
      if (!ex) continue;
      const sets = row.sets || 0;
      if (tracked.has(ex.muscle)) {
        totalMap.set(ex.muscle, (totalMap.get(ex.muscle) ?? 0) + sets);
        totalSets += sets;
      }
      for (const sec of ex.secondaryMuscles ?? []) {
        if (sec !== ex.muscle && tracked.has(sec)) {
          totalMap.set(sec, (totalMap.get(sec) ?? 0) + sets * 0.5);
        }
      }
    }
  }

  const chips = [...totalMap.entries()]
    .map(([k, v]) => [k, Math.round(v * 10) / 10] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!chips.length) {
    return <small className="muted">{emptyHint}</small>;
  }

  return (
    <>
      <div className="builder-muscle-head">
        <span>
          {title}（约 {totalSets} 主项组）
        </span>
        {subNote ? <small>{subNote}</small> : null}
      </div>
      <div className="builder-muscle-chips">
        {chips.map(([k, v]) => {
          const cls = highlightRange ? (v > 20 ? "is-high" : v >= 10 ? "is-opt" : "") : "";
          return (
            <span key={k} className={cls}>
              {MUSCLES[k] ?? k} <b>{fmt(v)}</b> 组
            </span>
          );
        })}
      </div>
    </>
  );
}

const MUSCLE_FILTER_PILLS: ReadonlyArray<readonly [MuscleKey | "", string]> = [
  ["", "全部"],
  ["chest", "胸"],
  ["back", "背"],
  ["legs", "腿"],
  ["shoulders", "肩"],
  ["arms", "臂"],
  ["core", "核心"],
];

const EQUIP_FILTER_PILLS: ReadonlyArray<readonly [EquipmentKey | "", string]> = [
  ["", "全部器械"],
  ["barbell", "杠铃"],
  ["dumbbell", "哑铃"],
  ["machine", "器械"],
  ["cable", "绳索"],
  ["bodyweight", "自重"],
  ["kettlebell", "壶铃"],
  ["band", "弹力带"],
];

function cleanOrphans(list: PlannedExercise[]): PlannedExercise[] {
  const counts = new Map<string, number>();
  for (const r of list) {
    if (r.supersetGroup) counts.set(r.supersetGroup, (counts.get(r.supersetGroup) ?? 0) + 1);
  }
  return list.map((r) =>
    r.supersetGroup && (counts.get(r.supersetGroup) ?? 0) < 2 ? { ...r, supersetGroup: null } : r,
  );
}

export function PlannedExerciseList({
  items,
  catalogueMap,
  prMap,
  onChange,
  onRegisterExercise,
}: {
  items: PlannedExercise[];
  catalogueMap: Map<string, CatalogueExercise>;
  prMap: Map<string, ExercisePrInfo>;
  onChange: (next: PlannedExercise[]) => void;
  onRegisterExercise: (ex: CatalogueExercise) => void;
}) {
  const [backupTargetIndex, setBackupTargetIndex] = useState(-1);
  const [pickerMuscle, setPickerMuscle] = useState<MuscleKey | "">("");
  const [pickerEquipment, setPickerEquipment] = useState<EquipmentKey | "">("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogueExercise[]>([]);
  const [searching, setSearching] = useState(false);
  const [customPool, setCustomPool] = useState<CatalogueExercise[]>([]);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    let active = true;
    void apiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise")
      .then((customRecs) => {
        if (!active) return;
        setCustomPool(
          customRecs
            .filter((r) => !r.deleted && r.data?.id)
            .map((r) => ({ ...r.data, custom: true })),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const seq = ++searchSeqRef.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const q = new URLSearchParams({ q: query.trim(), limit: "12" });
      if (pickerMuscle) q.set("muscle", pickerMuscle);
      if (pickerEquipment) q.set("equipment", pickerEquipment);
      void apiFetch<{ items?: CatalogueExercise[] }>(`/api/catalogue/exercises?${q.toString()}`, { token: "" })
        .catch(() => ({ items: [] as CatalogueExercise[] }))
        .then((catRes) => {
          if (seq !== searchSeqRef.current) return;
          const needle = query.trim().toLowerCase();
          const customs = customPool.filter((ex) => {
            if (pickerMuscle && ex.muscle !== pickerMuscle) return false;
            if (pickerEquipment && ex.equipment !== pickerEquipment) return false;
            if (!needle) return true;
            return [ex.name, ex.englishName, ...(ex.aliases ?? [])].some((t) => String(t ?? "").toLowerCase().includes(needle));
          });
          const merged = [...customs, ...(catRes.items ?? [])];
          const seen = new Set<string>();
          const unique: CatalogueExercise[] = [];
          for (const ex of merged) {
            if (!seen.has(ex.id)) {
              seen.add(ex.id);
              unique.push(ex);
            }
          }
          setResults(unique.slice(0, 12));
        })
        .finally(() => {
          if (seq === searchSeqRef.current) setSearching(false);
        });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, pickerMuscle, pickerEquipment, customPool]);

  const ssBadges = supersetBadges(items);

  const prText = (exerciseId: string): string => {
    const b = prMap.get(exerciseId);
    if (!b) return "暂无 PR 基准";
    if (b.mode === "timed" && b.hold != null) return `最佳时长 ${b.hold} 秒`;
    if (b.mode === "assisted" && b.assistance != null) return `最低辅助 ${fmt(b.assistance)} kg`;
    if (b.weight != null) return `最佳 ${fmt(b.weight)} kg${b.oneRepMax ? ` · 1RM ${fmt(b.oneRepMax)} kg` : ""}`;
    return "暂无 PR 基准";
  };

  const updateRow = (index: number, patch: Partial<PlannedExercise>) => {
    onChange(items.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const toggleSupersetAt = (index: number) => {
    const row = items[index];
    if (!row) return;
    if (row.supersetGroup) {
      const next = items.map((r, i) => (i === index ? { ...r, supersetGroup: null } : r));
      onChange(cleanOrphans(next));
      return;
    }
    if (items.length < 2) return;
    const prev = index > 0 ? items[index - 1] : null;
    if (prev?.supersetGroup) {
      onChange(items.map((r, i) => (i === index ? { ...r, supersetGroup: prev.supersetGroup } : r)));
      return;
    }
    const used = new Set(items.map((r) => r.supersetGroup).filter(Boolean));
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const nextCode = letters.find((ch) => !used.has(ch)) ?? `S${used.size + 1}`;
    const partnerIdx = index + 1 < items.length ? index + 1 : index - 1;
    const next = items.map((r, i) => (i === index || i === partnerIdx ? { ...r, supersetGroup: nextCode } : r));
    onChange(cleanOrphans(next));
  };

  const moveRow = (index: number, dir: -1 | 1) => {
    const nextIdx = index + dir;
    if (nextIdx < 0 || nextIdx >= items.length) return;
    const next = [...items];
    [next[index], next[nextIdx]] = [next[nextIdx]!, next[index]!];
    if (backupTargetIndex === index) setBackupTargetIndex(nextIdx);
    else if (backupTargetIndex === nextIdx) setBackupTargetIndex(index);
    onChange(next);
  };

  const removeRow = (index: number) => {
    const next = cleanOrphans(items.filter((_, i) => i !== index));
    if (backupTargetIndex === index) setBackupTargetIndex(-1);
    else if (backupTargetIndex > index) setBackupTargetIndex(backupTargetIndex - 1);
    onChange(next);
  };

  const pickExercise = (ex: CatalogueExercise) => {
    onRegisterExercise(ex);
    if (backupTargetIndex >= 0 && items[backupTargetIndex]) {
      const targetRow = items[backupTargetIndex]!;
      if (targetRow.exerciseId !== ex.id) {
        updateRow(backupTargetIndex, { backupExerciseId: ex.id });
      }
      setBackupTargetIndex(-1);
      return;
    }
    const timed = ex.mode === "timed";
    onChange([
      ...items,
      {
        exerciseId: ex.id,
        sets: 3,
        repsMin: timed ? 1 : 8,
        repsMax: timed ? 1 : 12,
        weight: null,
        seconds: timed ? 45 : 0,
        restSeconds: 90,
        targetRir: 2,
        progression: timed ? "manual" : "double",
        increment: 2.5,
        backupExerciseId: null,
        supersetGroup: null,
      },
    ]);
  };

  const stopEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
  };

  return (
    <>
      <div className="plan-ex-list">
        {items.length ? (
          items.map((row, index) => {
            const ex = catalogueMap.get(row.exerciseId);
            const mode = ex?.mode ?? (Number(row.seconds) > 0 ? "timed" : "reps");
            const timed = mode === "timed";
            const backupEx = row.backupExerciseId ? catalogueMap.get(row.backupExerciseId) : null;
            const manual = row.progression === "manual" || timed;
            const ssBadge = ssBadges[index];

            return (
              <div key={`${row.exerciseId}-${index}`} className={`plan-ex-row${ssBadge ? " has-superset" : ""}`}>
                <div className="plan-ex-head">
                  <div className="plan-ex-title">
                    <span className="preview-index">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <div className="plan-ex-name-line">
                        {ssBadge ? <span className="superset-pill">超级组 {ssBadge}</span> : null}
                        <strong>{ex?.name ?? row.exerciseId}</strong>
                      </div>
                      <small>
                        {ex?.muscle ? MUSCLES[ex.muscle] ?? ex.muscle : ""}
                        {ex?.equipment ? ` · ${EQUIPMENT[ex.equipment] ?? ex.equipment}` : ""} ·{" "}
                        <Icon name="trophy" size={11} /> {prText(row.exerciseId)}
                      </small>
                    </div>
                  </div>
                  <div className="plan-ex-order">
                    {items.length > 1 || row.supersetGroup ? (
                      <button
                        type="button"
                        className={`quiet plan-ss-btn${row.supersetGroup ? " is-superset" : ""}`}
                        title="串联超级组，训练时自动连续切换搭档"
                        onClick={() => toggleSupersetAt(index)}
                      >
                        {row.supersetGroup ? `超级组 ${ssBadge} · 取消` : "超级组"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="上移"
                      disabled={index === 0}
                      onClick={() => moveRow(index, -1)}
                    >
                      <Icon name="arrowUp" size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="下移"
                      disabled={index === items.length - 1}
                      onClick={() => moveRow(index, 1)}
                    >
                      <Icon name="arrowDown" size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label="删除动作"
                      onClick={() => removeRow(index)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </div>
                </div>

                <div className="plan-ex-grid">
                  <label>
                    <span>组数</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={50}
                      step={1}
                      value={row.sets}
                      onKeyDown={stopEnter}
                      onChange={(e) => {
                        const nextSets = Number(e.target.value);
                        updateRow(index, {
                          sets: nextSets,
                          ...(row.progression === "triple" && Number.isFinite(nextSets) && nextSets > (row.setsMax ?? 0)
                            ? { setsMax: Math.min(20, Math.max(1, nextSets)) }
                            : {}),
                        });
                      }}
                    />
                  </label>
                  {timed ? (
                    <label>
                      <span>目标时长 (秒)</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={3600}
                        step={1}
                        value={row.seconds === 0 ? "" : row.seconds}
                        onKeyDown={stopEnter}
                        onChange={(e) => updateRow(index, { seconds: e.target.value === "" ? 0 : Number(e.target.value) })}
                      />
                    </label>
                  ) : (
                    <>
                      <label>
                        <span>最低次</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={200}
                          step={1}
                          value={row.repsMin}
                          onKeyDown={stopEnter}
                          onChange={(e) => updateRow(index, { repsMin: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>上限次</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={200}
                          step={1}
                          value={row.repsMax}
                          onKeyDown={stopEnter}
                          onChange={(e) => updateRow(index, { repsMax: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>目标 {row.weightUnit === "lb" ? "lb" : "kg"}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={1000}
                          step="any"
                          placeholder="自动"
                          value={row.weight ?? ""}
                          onKeyDown={stopEnter}
                          onChange={(e) => updateRow(index, { weight: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                      </label>
                    </>
                  )}
                  <label>
                    <span>休息秒</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={600}
                      step={1}
                      value={row.restSeconds}
                      onKeyDown={stopEnter}
                      onChange={(e) => updateRow(index, { restSeconds: Number(e.target.value) })}
                    />
                  </label>
                </div>

                {!timed ? (
                  <div className="plan-prog-bar">
                    <label>
                      <span>渐进规则</span>
                      <select
                        value={row.progression ?? "double"}
                        onChange={(e) => {
                          const nextProg = e.target.value as ProgressionRule;
                          updateRow(index, {
                            progression: nextProg,
                            ...(nextProg === "triple" && !row.setsMax ? { setsMax: Math.min(20, (row.sets || 3) + 2) } : {}),
                          });
                        }}
                      >
                        {(Object.entries(PROGRESSION_NAMES) as Array<[ProgressionRule, string]>).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                    </label>
                    {row.progression === "triple" ? (
                      <label>
                        <span>组数上限</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={Math.max(1, row.sets || 1)}
                          max={20}
                          step={1}
                          value={Math.max(row.sets || 1, row.setsMax ?? Math.min(20, (row.sets || 3) + 2))}
                          onKeyDown={stopEnter}
                          onChange={(e) => updateRow(index, { setsMax: Math.max(row.sets || 1, Number(e.target.value) || row.sets || 3) })}
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>单位</span>
                      <select
                        value={row.weightUnit === "lb" ? "lb" : "kg"}
                        onChange={(e) => {
                          const nextUnit = e.target.value === "lb" ? "lb" : "kg";
                          updateRow(index, {
                            weightUnit: nextUnit,
                            increment: nextUnit === "lb" && (row.increment == null || row.increment === 2.5)
                              ? 5
                              : nextUnit === "kg" && row.increment === 5
                                ? 2.5
                                : row.increment,
                          });
                        }}
                      >
                        <option value="kg">kg</option>
                        <option value="lb">lb</option>
                      </select>
                    </label>
                    <label>
                      <span>每次增量 {row.weightUnit === "lb" ? "lb" : "kg"}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={20}
                        step={0.25}
                        disabled={manual}
                        value={row.increment ?? 2.5}
                        onKeyDown={stopEnter}
                        onChange={(e) => updateRow(index, { increment: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      <span>目标 RIR</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={10}
                        step={1}
                        disabled={manual}
                        value={row.targetRir ?? 2}
                        onKeyDown={stopEnter}
                        onChange={(e) => updateRow(index, { targetRir: Number(e.target.value) })}
                      />
                    </label>
                    <label className="plan-warmup-toggle" title="开练时按目标重量自动生成递增热身组">
                      <span>自动热身</span>
                      <input
                        type="checkbox"
                        className="switch"
                        checked={Boolean(row.autoWarmup)}
                        onChange={(e) => updateRow(index, { autoWarmup: e.target.checked })}
                      />
                    </label>
                    <div className="plan-backup-slot">
                      <span>替补动作</span>
                      <div className="plan-backup-actions">
                        <button type="button" className="quiet" onClick={() => setBackupTargetIndex(index)}>
                          <Icon name="swap" size={13} /> {backupEx ? backupEx.name : "设置替补"}
                        </button>
                        {backupEx ? (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="清除替补"
                            onClick={() => updateRow(index, { backupExerciseId: null })}
                          >
                            <Icon name="close" size={13} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="muted plan-ex-empty">尚未添加动作，可从下方检索添加，或上方直接套用模板/计划日。</p>
        )}
      </div>

      <div className={`plan-picker-box${backupTargetIndex >= 0 ? " is-backup-mode" : ""}`}>
        <div className="plan-picker-head">
          <strong>
            {backupTargetIndex >= 0
              ? `为「${catalogueMap.get(items[backupTargetIndex]?.exerciseId ?? "")?.name ?? ""}」选择替补动作`
              : "添加训练动作"}
          </strong>
          {backupTargetIndex >= 0 ? (
            <button type="button" className="quiet" onClick={() => setBackupTargetIndex(-1)}>
              取消选择替补
            </button>
          ) : null}
        </div>
        <div className="muscle-pills picker-muscles" role="group" aria-label="按肌群筛选">
          {MUSCLE_FILTER_PILLS.map(([val, lbl]) => (
            <button
              key={val || "all"}
              type="button"
              aria-pressed={pickerMuscle === val}
              onClick={() => setPickerMuscle(val)}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="muscle-pills picker-equipment" role="group" aria-label="按器械筛选">
          {EQUIP_FILTER_PILLS.map(([val, lbl]) => (
            <button
              key={val || "all"}
              type="button"
              aria-pressed={pickerEquipment === val}
              onClick={() => setPickerEquipment(val)}
            >
              {lbl}
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="搜索动作名称或英文名…"
            onKeyDown={stopEnter}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="picker-results">
          {searching && !results.length ? (
            <p className="muted">正在搜索动作…</p>
          ) : results.length ? (
            results.map((ex) => (
              <button key={ex.id} type="button" className="pick-item" onClick={() => pickExercise(ex)}>
                <span>
                  {ex.name}
                  {ex.custom ? <em className="custom-badge">自定义</em> : null}
                  <small>
                    {MUSCLES[ex.muscle] ?? ex.muscle} · {EQUIPMENT[ex.equipment] ?? ex.equipment}
                  </small>
                </span>
                <span className="pick-add">
                  <Icon name="plus" size={14} /> {backupTargetIndex >= 0 ? "设为替补" : "添加"}
                </span>
              </button>
            ))
          ) : (
            <p className="muted">无匹配动作，换个关键词试试。</p>
          )}
        </div>
      </div>
    </>
  );
}
