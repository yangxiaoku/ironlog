import { useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { fmt, guessMeal, today } from "../../lib/date";
import {
  MEALS,
  shiftDateStr,
  type DietData,
  type MealKey,
  type RecordEnvelope,
} from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { enqueueMutation, isNetworkError } from "../../lib/offline-queue";
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

  const pNum = Math.max(0, Number(protein) || 0);
  const cNum = Math.max(0, Number(carbs) || 0);
  const fNum = Math.max(0, Number(fat) || 0);
  const estimatedKcal = Math.round(pNum * 4 + cNum * 4 + fNum * 9);

  const presets = (recentFoods.length ? recentFoods : DEFAULT_FOOD_PRESETS).slice(0, 8);

  const stepMacro = (cur: string, setter: (val: string) => void, delta: number, decimals = 0) => {
    triggerHaptic("light");
    const next = Math.max(0, (Number(cur) || 0) + delta);
    setter(decimals ? String(Math.round(next * 10) / 10) : String(Math.round(next)));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
      closeAllModals();
      notify(record ? "饮食记录已更新" : "饮食已记录");
    } catch (err) {
      if (isNetworkError(err) && userId && typeof localStorage !== "undefined") {
        enqueueMutation(localStorage, userId, {
          opId: payload.opId,
          path: "/api/records",
          method: "POST",
          body: payload,
          label: `饮食：${cleanName}`,
        });
        refreshPendingCount(userId);
        closeAllModals();
        notify("离线状态：已保存在本地，恢复网络后自动同步");
        return;
      }
      setError((err as Error)?.message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
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
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            autoFocus={!record}
            placeholder="例如：鸡胸肉 150g、全蛋 2 个"
          />
        </div>
      </label>

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
                  setName(p.name);
                  setCalories(String(Math.round(p.calories)));
                  setProtein(String(Math.round(p.protein * 10) / 10));
                  setCarbs(String(Math.round(p.carbs * 10) / 10));
                  setFat(String(Math.round(p.fat * 10) / 10));
                }}
              >
                {p.name} <small>{fmt(p.calories, 0)} kcal</small>
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
              onChange={(e) => setCalories(e.target.value)}
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
              onChange={(e) => setProtein(e.target.value)}
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
              onChange={(e) => setCarbs(e.target.value)}
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
              onChange={(e) => setFat(e.target.value)}
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

      {estimatedKcal > 0 ? (
        <div className="macro-calc-bar">
          <span className="macro-calc-hint">
            按三大营养素折算约 <strong>{fmt(estimatedKcal, 0)}</strong> kcal <small>(4·4·9)</small>
          </span>
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
        </div>
      ) : null}

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className={`dialog-foot${record ? " has-remove" : ""}`}>
        {record ? (
          <button type="button" className="danger" onClick={handleDelete}>
            删除记录
          </button>
        ) : (
          <button type="button" className="quiet" onClick={closeAllModals}>
            取消
          </button>
        )}
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : record ? "保存修改" : "保存饮食"}
        </button>
      </footer>
    </form>
  );
}
