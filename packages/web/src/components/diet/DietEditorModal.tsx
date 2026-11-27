import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { fmt, guessMeal, today } from "../../lib/date";
import {
  MEALS,
  shiftDateStr,
  type DietData,
  type MealKey,
  type ProfileGoals,
  type QuickFoodItem,
  type RecordEnvelope,
} from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { enqueueMutation, getOfflineStorage, isNetworkError } from "../../lib/offline-queue";
import { PROFILE_VERSION_EVENT } from "../../lib/workout-helpers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export interface RecentFoodPreset {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const DEFAULT_FOOD_PRESETS: RecentFoodPreset[] = [
  { name: "全蛋 2个", calories: 145, protein: 12.6, carbs: 1.1, fat: 9.8 },
  { name: "鸡胸肉 150g", calories: 198, protein: 36, carbs: 0, fat: 4.5 },
  { name: "熟米饭 200g", calories: 232, protein: 5.2, carbs: 51.2, fat: 0.6 },
  { name: "乳清蛋白 1勺", calories: 120, protein: 24, carbs: 3, fat: 1.5 },
];

interface ScaleBaseline {
  baseName: string;
  unit: string;
  baseGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

function quickFoodsStorageKey(userId: string): string {
  return userId ? `ironlog-web-quick-foods:${userId}` : "ironlog-web-quick-foods";
}

function parseBaselineFromName(rawName: string): { baseName: string; baseGrams: number; unit: string; hasUnit: boolean } {
  const m = rawName.trim().match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(g|克|ml|毫升)\s*$/i);
  if (m) {
    const grams = Number(m[2]);
    if (Number.isFinite(grams) && grams > 0) {
      const unitRaw = m[3]!.toLowerCase();
      return {
        baseName: m[1]!.trim(),
        baseGrams: grams,
        unit: unitRaw === "ml" || unitRaw === "毫升" ? "ml" : "g",
        hasUnit: true,
      };
    }
  }
  return { baseName: rawName.trim(), baseGrams: 100, unit: "g", hasUnit: false };
}

function readLocalQuickFoods(userId: string): QuickFoodItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(quickFoodsStorageKey(userId)) ?? "[]");
    return Array.isArray(raw) ? (raw as QuickFoodItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocalQuickFoods(userId: string, items: QuickFoodItem[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(quickFoodsStorageKey(userId), JSON.stringify(items));
  } catch {}
}

export function DietEditorModal({
  record,
  defaultDate,
  defaultMeal,
  recentFoods = [],
}: {
  record?: RecordEnvelope<DietData>;
  defaultDate?: string;
  defaultMeal?: MealKey;
  recentFoods?: RecentFoodPreset[];
}) {
  const userId = useAuthStore((s) => s.userId);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const refreshPendingCount = useUiStore((s) => s.refreshPendingCount);
  const notify = useUiStore((s) => s.notify);

  const todayStr = today();
  const [date, setDate] = useState(record?.data.date ?? defaultDate ?? todayStr);
  const [meal, setMeal] = useState<MealKey>(record?.data.meal ?? defaultMeal ?? guessMeal());
  const [name, setName] = useState(record?.data.name ?? "");
  const [calories, setCalories] = useState<string>(record ? String(record.data.calories) : "");
  const [protein, setProtein] = useState<string>(record ? String(record.data.protein) : "0");
  const [carbs, setCarbs] = useState<string>(record ? String(record.data.carbs) : "0");
  const [fat, setFat] = useState<string>(record ? String(record.data.fat) : "0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [quickFoods, setQuickFoods] = useState<QuickFoodItem[]>(() => readLocalQuickFoods(userId));
  const [scaleBase, setScaleBase] = useState<ScaleBaseline | null>(null);
  const [gramsInput, setGramsInput] = useState<string>("");
  const [savingQuickFood, setSavingQuickFood] = useState(false);
  const quickFoodSeqRef = useRef(0);

  useEffect(() => {
    setQuickFoods(readLocalQuickFoods(userId));
    if (!userId) return;
    let active = true;
    const seqAtFetch = quickFoodSeqRef.current;
    void apiFetch<{ profile?: ProfileGoals }>("/api/web/profile")
      .then((res) => {
        if (!active || !res?.profile || quickFoodSeqRef.current !== seqAtFetch) return;
        const remote = res.profile.quickFoods ?? [];
        setQuickFoods(remote);
        writeLocalQuickFoods(userId, remote);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId]);

  const clearScale = () => {
    setScaleBase(null);
    setGramsInput("");
  };

  const applyScaledGrams = (baseline: ScaleBaseline, nextGrams: number, syncInput = true) => {
    const g = Math.max(0.1, Math.min(10000, Math.round(nextGrams * 10) / 10));
    const ratio = g / Math.max(0.1, baseline.baseGrams);
    if (syncInput) setGramsInput(String(g));
    setName(`${baseline.baseName} ${g}${baseline.unit}`);
    setCalories(String(Math.round(baseline.calories * ratio)));
    setProtein(String(Math.round(baseline.protein * ratio * 10) / 10));
    setCarbs(String(Math.round(baseline.carbs * ratio * 10) / 10));
    setFat(String(Math.round(baseline.fat * ratio * 10) / 10));
  };

  const mutateQuickFoodsRemote = async (
    optimisticList: QuickFoodItem[],
    body: { upsert: QuickFoodItem } | { removeId: string },
    toastMsg: string,
  ) => {
    const prevList = quickFoods;
    quickFoodSeqRef.current++;
    setQuickFoods(optimisticList);
    writeLocalQuickFoods(userId, optimisticList);
    if (!userId) {
      notify(toastMsg);
      return;
    }
    setSavingQuickFood(true);
    try {
      const res = await apiFetch<{ quickFoods?: QuickFoodItem[]; version?: number }>("/api/web/profile/quick-foods", {
        method: "PUT",
        body,
      });
      if (Array.isArray(res?.quickFoods)) {
        setQuickFoods(res.quickFoods);
        writeLocalQuickFoods(userId, res.quickFoods);
      }
      if (typeof res?.version === "number" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(PROFILE_VERSION_EVENT, { detail: res.version }));
      }
      bumpDataEpoch();
      notify(toastMsg);
    } catch (err) {
      setQuickFoods(prevList);
      writeLocalQuickFoods(userId, prevList);
      notify((err as Error)?.message || "保存个人单品失败，已恢复原列表");
    } finally {
      setSavingQuickFood(false);
    }
  };

  const handleSaveCurrentQuickFood = () => {
    const cleanName = name.trim();
    if (!cleanName || savingQuickFood) {
      setError("请先填写食物名称和营养素后再收藏");
      return;
    }
    const parsed = parseBaselineFromName(cleanName);
    const typedGrams = scaleBase ? Number(gramsInput) : NaN;
    const rawGrams = parsed.hasUnit
      ? parsed.baseGrams
      : Number.isFinite(typedGrams) && typedGrams >= 0.1
        ? typedGrams
        : parsed.baseGrams;
    const baseGrams = Math.max(0.1, Math.min(10000, Math.round(rawGrams * 10) / 10));
    const item: QuickFoodItem = {
      id: `qf_${Date.now().toString(36)}`,
      name: parsed.baseName || cleanName,
      baseGrams,
      unit: parsed.unit,
      calories: Math.max(0, Number(calories) || 0),
      protein: Math.max(0, Number(protein) || 0),
      carbs: Math.max(0, Number(carbs) || 0),
      fat: Math.max(0, Number(fat) || 0),
    };
    const nextList = [item, ...quickFoods.filter((q) => q.id !== item.id && q.name !== item.name)].slice(0, 60);
    setScaleBase({
      baseName: item.name,
      unit: item.unit,
      baseGrams: item.baseGrams,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    });
    setGramsInput(String(item.baseGrams));
    void mutateQuickFoodsRemote(nextList, { upsert: item }, `已收藏「${item.name}」(${item.baseGrams}${item.unit})`);
  };

  const pNum = Math.max(0, Number(protein) || 0);
  const cNum = Math.max(0, Number(carbs) || 0);
  const fNum = Math.max(0, Number(fat) || 0);
  const estimatedKcal = Math.round(pNum * 4 + cNum * 4 + fNum * 9);

  const presets = (recentFoods.length ? recentFoods : DEFAULT_FOOD_PRESETS).slice(0, 8);

  const stepMacro = (cur: string, setter: (val: string) => void, delta: number, decimals = 0) => {
    triggerHaptic("light");
    clearScale();
    const next = Math.max(0, (Number(cur) || 0) + delta);
    setter(decimals ? String(Math.round(next * 10) / 10) : String(Math.round(next)));
  };

  const submitDiet = async (keepOpen: boolean) => {
    if (saving) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setError("请输入食物名称");
      return;
    }
    setSaving(true);
    setError("");

    const payload = {
      opId: crypto.randomUUID(),
      id: record?.id ?? crypto.randomUUID(),
      kind: "diet" as const,
      baseVersion: record?.version ?? 0,
      deleted: false,
      data: {
        date,
        meal,
        name: cleanName,
        calories: Math.max(0, Number(calories) || 0),
        protein: Math.max(0, Number(protein) || 0),
        carbs: Math.max(0, Number(carbs) || 0),
        fat: Math.max(0, Number(fat) || 0),
        source: record?.data.source ?? "manual",
        rawPrompt: record?.data.rawPrompt ?? "",
      },
    };

    try {
      await apiFetch("/api/records", { method: "POST", body: payload });
      triggerHaptic("success");
      bumpDataEpoch();
      if (keepOpen && !record) {
        setName("");
        setCalories("0");
        setProtein("0");
        setCarbs("0");
        setFat("0");
        clearScale();
        notify(`已保存「${cleanName}」，可继续录入下一项`);
      } else {
        closeAllModals();
        notify(record ? "饮食记录已更新" : "饮食已记录");
      }
    } catch (err) {
      if (isNetworkError(err) && userId) {
        const queued = enqueueMutation(getOfflineStorage(), userId, {
          opId: payload.opId,
          path: "/api/records",
          method: "POST",
          body: payload,
          label: `饮食：${cleanName}`,
        });
        if (queued == null) {
          setError("浏览器无法暂存离线记录。请保留此页面，联网后重新保存");
          return;
        }
        refreshPendingCount(userId);
        if (keepOpen && !record) {
          setName("");
          setCalories("0");
          setProtein("0");
          setCarbs("0");
          setFat("0");
          clearScale();
          notify(`离线状态：已暂存「${cleanName}」，可继续录入`);
        } else {
          closeAllModals();
          notify("离线状态：已保存在本地，恢复网络后自动同步");
        }
        return;
      }
      setError((err as Error)?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await submitDiet(false);
  };

  const handleDelete = () => {
    if (!record) return;
    openConfirm({
      title: "删除饮食记录",
      message: `确定要删除「${record.data.name}」吗？`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: record.id,
            kind: "diet",
            baseVersion: record.version,
            deleted: true,
            data: record.data,
          },
        });
        bumpDataEpoch();
        closeAllModals();
        notify("饮食记录已删除");
      },
    });
  };

  const yesterday = shiftDateStr(todayStr, -1);

  return (
    <form className="dialog-form modern-diet-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="diet-top-bar">
        <div className="meal-segmented-control" role="group" aria-label="选择餐次">
          {(Object.entries(MEALS) as Array<[MealKey, string]>).map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className="meal-pill"
              aria-pressed={meal === k}
              onClick={() => {
                triggerHaptic("light");
                setMeal(k);
              }}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="date-quick-strip">
          <div className="date-pill-group">
            <button
              type="button"
              className="date-pill"
              aria-pressed={date === todayStr}
              onClick={() => setDate(todayStr)}
            >
              今天
            </button>
            <button
              type="button"
              className="date-pill"
              aria-pressed={date === yesterday}
              onClick={() => setDate(yesterday)}
            >
              昨天
            </button>
          </div>
          <input
            type="date"
            aria-label="饮食日期"
            className="date-input-inline"
            value={date}
            min="1902-01-01"
            max={todayStr}
            required
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <label className="food-name-field">
        <span className="preset-label">食物名称</span>
        <div className="food-input-group">
          <span className="food-icon" aria-hidden="true">
            <Icon name="diet" size={18} />
          </span>
          <input
            name="name"
            value={name}
            onChange={(e) => {
              clearScale();
              setName(e.target.value);
            }}
            maxLength={120}
            required
            autoFocus={!record}
            placeholder="例如：鸡胸肉 150g、全蛋 2 个"
          />
        </div>
      </label>

      {quickFoods.length ? (
        <div className="diet-quick-presets">
          <span className="preset-label">个人常用单品 · 点选可按克数换算</span>
          <div className="preset-chips">
            {quickFoods.map((q) => (
              <span key={q.id} className="diet-quick-food-chip">
                <button
                  type="button"
                  className={`preset-chip is-recent${scaleBase?.baseName === q.name ? " is-selected" : ""}`}
                  onClick={() => {
                    triggerHaptic("light");
                    const baseline: ScaleBaseline = {
                      baseName: q.name,
                      unit: q.unit || "g",
                      baseGrams: q.baseGrams,
                      calories: q.calories,
                      protein: q.protein,
                      carbs: q.carbs,
                      fat: q.fat,
                    };
                    setScaleBase(baseline);
                    applyScaledGrams(baseline, q.baseGrams);
                  }}
                >
                  {q.name} {q.baseGrams}{q.unit} <small>{fmt(q.calories, 0)} kcal</small>
                </button>
                <button
                  type="button"
                  className="diet-quick-food-del"
                  disabled={savingQuickFood}
                  aria-label={`移除常用单品 ${q.name}`}
                  onClick={() => {
                    openConfirm({
                      title: "移除常用单品",
                      message: `确定要从个人常用单品中移除「${q.name}」吗？`,
                      confirmLabel: "移除",
                      onConfirm: () => {
                        const nextList = quickFoods.filter((x) => x.id !== q.id);
                        if (scaleBase?.baseName === q.name) clearScale();
                        void mutateQuickFoodsRemote(nextList, { removeId: q.id }, `已移除「${q.name}」`);
                      },
                    });
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {presets.length ? (
        <div className="diet-quick-presets">
          <span className="preset-label">{recentFoods.length ? "最近常吃" : "常见搭配快填"}</span>
          <div className="preset-chips">
            {presets.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`preset-chip${recentFoods.length ? " is-recent" : ""}`}
                onClick={() => {
                  triggerHaptic("light");
                  const parsed = parseBaselineFromName(p.name);
                  const calRounded = Math.round(p.calories);
                  const proRounded = Math.round(p.protein * 10) / 10;
                  const carbRounded = Math.round(p.carbs * 10) / 10;
                  const fatRounded = Math.round(p.fat * 10) / 10;
                  if (parsed.hasUnit) {
                    const baseline: ScaleBaseline = {
                      baseName: parsed.baseName,
                      unit: parsed.unit,
                      baseGrams: parsed.baseGrams,
                      calories: calRounded,
                      protein: proRounded,
                      carbs: carbRounded,
                      fat: fatRounded,
                    };
                    setScaleBase(baseline);
                    setGramsInput(String(parsed.baseGrams));
                  } else {
                    clearScale();
                  }
                  setName(p.name);
                  setCalories(String(calRounded));
                  setProtein(String(proRounded));
                  setCarbs(String(carbRounded));
                  setFat(String(fatRounded));
                }}
              >
                {p.name} <small>{fmt(p.calories, 0)} kcal</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {scaleBase ? (
        <div className="diet-scaler-bar">
          <label className="diet-scaler-input">
            <span>实际克数</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={10000}
              step="any"
              aria-label="食物克数换算"
              value={gramsInput}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                const raw = e.target.value;
                setGramsInput(raw);
                const val = Number(raw);
                if (Number.isFinite(val) && val >= 0.1 && val <= 10000) {
                  applyScaledGrams(scaleBase, val, false);
                }
              }}
            />
            <small>{scaleBase.unit}（基准 {scaleBase.baseGrams}{scaleBase.unit}）</small>
          </label>
          <div className="diet-scaler-mults">
            {[0.5, 1, 1.5, 2].map((mult) => (
              <button
                key={mult}
                type="button"
                className="micro-chip"
                onClick={() => {
                  triggerHaptic("light");
                  applyScaledGrams(scaleBase, scaleBase.baseGrams * mult);
                }}
              >
                {mult}×
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="macro-deck">
        <div className="macro-card">
          <div className="macro-card-head">
            <span className="macro-badge badge-kcal">
              <i className="macro-dot" /> 热量
            </span>
            <span className="macro-unit">kcal</span>
          </div>
          <div className="macro-card-value">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100000}
              step="any"
              required
              value={calories}
              onChange={(e) => {
                clearScale();
                setCalories(e.target.value);
              }}
              placeholder="0"
            />
          </div>
          <div className="macro-steppers">
            {[50, 100, 200].map((d) => (
              <button key={d} type="button" className="micro-chip" onClick={() => stepMacro(calories, setCalories, d)}>
                +{d}
              </button>
            ))}
          </div>
        </div>

        <div className="macro-card">
          <div className="macro-card-head">
            <span className="macro-badge badge-protein">
              <i className="macro-dot" /> 蛋白质
            </span>
            <span className="macro-unit">g</span>
          </div>
          <div className="macro-card-value">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100000}
              step="any"
              required
              value={protein}
              onChange={(e) => {
                clearScale();
                setProtein(e.target.value);
              }}
            />
          </div>
          <div className="macro-steppers">
            {[5, 10, 20].map((d) => (
              <button key={d} type="button" className="micro-chip" onClick={() => stepMacro(protein, setProtein, d, 1)}>
                +{d}
              </button>
            ))}
          </div>
        </div>

        <div className="macro-card">
          <div className="macro-card-head">
            <span className="macro-badge badge-carbs">
              <i className="macro-dot" /> 碳水
            </span>
            <span className="macro-unit">g</span>
          </div>
          <div className="macro-card-value">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100000}
              step="any"
              required
              value={carbs}
              onChange={(e) => {
                clearScale();
                setCarbs(e.target.value);
              }}
            />
          </div>
          <div className="macro-steppers">
            {[10, 25, 50].map((d) => (
              <button key={d} type="button" className="micro-chip" onClick={() => stepMacro(carbs, setCarbs, d, 1)}>
                +{d}
              </button>
            ))}
          </div>
        </div>

        <div className="macro-card">
          <div className="macro-card-head">
            <span className="macro-badge badge-fat">
              <i className="macro-dot" /> 脂肪
            </span>
            <span className="macro-unit">g</span>
          </div>
          <div className="macro-card-value">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100000}
              step="any"
              required
              value={fat}
              onChange={(e) => {
                clearScale();
                setFat(e.target.value);
              }}
            />
          </div>
          <div className="macro-steppers">
            {[5, 10, 15].map((d) => (
              <button key={d} type="button" className="micro-chip" onClick={() => stepMacro(fat, setFat, d, 1)}>
                +{d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {estimatedKcal > 0 || (name.trim() && (Number(calories) || 0) > 0) ? (
        <div className="macro-calc-bar">
          <span className="macro-calc-hint">
            {estimatedKcal > 0 ? (
              <>
                按三大营养素折算约 <strong>{fmt(estimatedKcal, 0)}</strong> kcal <small>(4·4·9)</small>
              </>
            ) : (
              <>可保存当前单品，下次一键快填</>
            )}
          </span>
          <div className="diet-calc-actions">
            {name.trim() ? (
              <button
                type="button"
                className="quiet macro-calc-apply"
                disabled={savingQuickFood}
                onClick={handleSaveCurrentQuickFood}
              >
                {savingQuickFood ? "收藏中…" : "存为常用单品"}
              </button>
            ) : null}
            {estimatedKcal > 0 ? (
              <button
                type="button"
                className="quiet macro-calc-apply"
                onClick={() => {
                  triggerHaptic("light");
                  setCalories(String(estimatedKcal));
                }}
              >
                填入热量
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className={`dialog-foot${record ? " has-remove" : ""}`} style={{ flexWrap: "wrap", gap: 8 }}>
        {record ? (
          <button type="button" className="danger" onClick={handleDelete}>
            删除记录
          </button>
        ) : (
          <button type="button" className="quiet" onClick={closeAllModals}>
            取消
          </button>
        )}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          {!record ? (
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => void submitDiet(true)}
            >
              保存并继续
            </button>
          ) : null}
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "保存中…" : record ? "保存修改" : "保存饮食"}
          </button>
        </div>
      </footer>
    </form>
  );
}
