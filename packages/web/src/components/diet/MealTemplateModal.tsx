import { useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { fmt } from "../../lib/date";
import {
  MEALS,
  type DietData,
  type MealKey,
  type MealTemplateData,
  type MealTemplateFood,
  type RecordEnvelope,
} from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export function SaveMealTemplateModal({
  meal,
  entries,
}: {
  meal: MealKey;
  entries: Array<RecordEnvelope<DietData>>;
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const totalCal = Math.round(entries.reduce((s, r) => s + r.data.calories, 0));
  const defaultName =
    entries.length === 1 ? entries[0]!.data.name : `${MEALS[meal]}搭配 · ${entries[0]!.data.name}`.slice(0, 48);
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingSaveRef = useRef<{ sig: string; id: string; opId: string } | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const clean = name.trim();
    if (!clean) return;
    setSaving(true);
    setError("");
    try {
      const foods: MealTemplateFood[] = entries.slice(0, 30).map((r) => ({
        name: r.data.name,
        calories: r.data.calories,
        protein: r.data.protein,
        carbs: r.data.carbs,
        fat: r.data.fat,
        source: "manual",
        rawPrompt: "",
      }));
      const sig = JSON.stringify({ name: clean, foods });
      if (pendingSaveRef.current?.sig !== sig) {
        pendingSaveRef.current = {
          sig,
          id: `mealTpl_${crypto.randomUUID().slice(0, 12)}`,
          opId: crypto.randomUUID(),
        };
      }
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: pendingSaveRef.current.opId,
          id: pendingSaveRef.current.id,
          kind: "mealTemplate",
          baseVersion: 0,
          deleted: false,
          data: { name: clean, foods },
        },
      });
      pendingSaveRef.current = null;
      triggerHaptic("success");
      bumpDataEpoch();
      closeAllModals();
      notify(`已存为常用餐单「${clean}」`);
    } catch (err) {
      setError((err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="field">
        <span>餐单名称</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          autoFocus
        />
      </label>

      <div className="meal-tpl-preview">
        <small>
          包含 {entries.length} 项食材 · 共 {fmt(totalCal, 0)} kcal
        </small>
        <ul>
          {entries.map((r) => (
            <li key={r.id}>
              <span>{r.data.name}</span>
              <span>{fmt(r.data.calories, 0)} kcal</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className="dialog-foot">
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : "保存餐单模板"}
        </button>
      </footer>
    </form>
  );
}

interface EditableTemplateFood {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export function EditMealTemplateModal({ template }: { template: RecordEnvelope<MealTemplateData> }) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [name, setName] = useState(template.data.name ?? "");
  const [foods, setFoods] = useState<EditableTemplateFood[]>(() => {
    const initial = (template.data.foods ?? []).map((f) => ({
      name: f.name ?? "",
      calories: String(Number(f.calories) || 0),
      protein: String(Number(f.protein) || 0),
      carbs: String(Number(f.carbs) || 0),
      fat: String(Number(f.fat) || 0),
    }));
    return initial.length ? initial : [{ name: "", calories: "", protein: "0", carbs: "0", fat: "0" }];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pendingEditRef = useRef<{ sig: string; opId: string } | null>(null);

  const totalKcal = Math.round(foods.reduce((s, f) => s + (Number(f.calories) || 0), 0));
  const totalProt = Math.round(foods.reduce((s, f) => s + (Number(f.protein) || 0), 0) * 10) / 10;

  const updateFood = (idx: number, patch: Partial<EditableTemplateFood>) => {
    setFoods((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const cleanName = name.trim();
    const cleaned = foods
      .filter((f) => f.name.trim().length > 0)
      .slice(0, 30)
      .map((f) => ({
        name: f.name.trim(),
        calories: Math.max(0, Number(f.calories) || 0),
        protein: Math.max(0, Number(f.protein) || 0),
        carbs: Math.max(0, Number(f.carbs) || 0),
        fat: Math.max(0, Number(f.fat) || 0),
        source: "manual",
        rawPrompt: "",
      }));
    if (!cleanName || !cleaned.length) {
      setError("请填写餐单名称并保留至少 1 项有效食物。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const sig = JSON.stringify({ name: cleanName, foods: cleaned });
      if (pendingEditRef.current?.sig !== sig) {
        pendingEditRef.current = { sig, opId: crypto.randomUUID() };
      }
      await apiFetch("/api/records", {
        method: "POST",
        body: {
          opId: pendingEditRef.current.opId,
          id: template.id,
          kind: "mealTemplate",
          baseVersion: template.version,
          deleted: false,
          data: { name: cleanName, foods: cleaned },
        },
      });
      pendingEditRef.current = null;
      triggerHaptic("success");
      bumpDataEpoch();
      closeAllModals();
      notify(`已更新常用餐单「${cleanName}」`);
    } catch (err) {
      setError((err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="field">
        <span>餐单名称</span>
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
      </label>

      <div className="meal-tpl-edit-head">
        <small>
          共 {foods.length} 项 · 约 {fmt(totalKcal, 0)} kcal · 蛋白 {fmt(totalProt, 1)} g
        </small>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            if (foods.length >= 30) {
              notify("每个常用餐单最多保存 30 项食物");
              return;
            }
            setFoods((prev) => [...prev, { name: "", calories: "", protein: "0", carbs: "0", fat: "0" }]);
          }}
        >
          <Icon name="plus" size={14} /> 添加一项
        </button>
      </div>

      <div className="meal-tpl-edit-list">
        {foods.map((f, idx) => (
          <div key={idx} className="meal-tpl-edit-row">
            <label className="tpl-food-name">
              <span>食物名称</span>
              <input
                maxLength={120}
                required
                value={f.name}
                onChange={(e) => updateFood(idx, { name: e.target.value })}
                placeholder="例如：鸡胸肉 150g"
              />
            </label>
            <label>
              <span>千卡</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={50000}
                step="any"
                required
                value={f.calories}
                onChange={(e) => updateFood(idx, { calories: e.target.value })}
              />
            </label>
            <label>
              <span>蛋白g</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step="any"
                required
                value={f.protein}
                onChange={(e) => updateFood(idx, { protein: e.target.value })}
              />
            </label>
            <label>
              <span>碳水g</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step="any"
                required
                value={f.carbs}
                onChange={(e) => updateFood(idx, { carbs: e.target.value })}
              />
            </label>
            <label>
              <span>脂肪g</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step="any"
                required
                value={f.fat}
                onChange={(e) => updateFood(idx, { fat: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="quiet icon-button tpl-food-del"
              aria-label={`删除第 ${idx + 1} 项`}
              disabled={foods.length <= 1}
              onClick={() => setFoods((prev) => prev.filter((_, i) => i !== idx))}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
      </div>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className="dialog-foot">
        <button type="button" className="quiet" onClick={closeAllModals}>
          取消
        </button>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : "保存修改"}
        </button>
      </footer>
    </form>
  );
}
