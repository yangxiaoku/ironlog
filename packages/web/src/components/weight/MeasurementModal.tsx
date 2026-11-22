import { useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { today } from "../../lib/date";
import { MEASUREMENT_SPECS, type MeasurementEntry, type MeasurementValues } from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { useUiStore } from "../../store/useUiStore";

export function MeasurementModal({ existing = null }: { existing?: MeasurementEntry | null }) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const todayStr = today();
  const [date, setDate] = useState(existing?.date ?? todayStr);
  const [values, setValues] = useState<Record<keyof MeasurementValues, string>>({
    waistCm: existing?.waistCm != null ? String(existing.waistCm) : "",
    chestCm: existing?.chestCm != null ? String(existing.chestCm) : "",
    armCm: existing?.armCm != null ? String(existing.armCm) : "",
    thighCm: existing?.thighCm != null ? String(existing.thighCm) : "",
    hipCm: existing?.hipCm != null ? String(existing.hipCm) : "",
  });
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parseNum = (k: keyof MeasurementValues): number | null => {
      const raw = values[k].trim();
      return raw === "" ? null : Number(raw);
    };

    const payload = {
      date,
      waistCm: parseNum("waistCm"),
      chestCm: parseNum("chestCm"),
      armCm: parseNum("armCm"),
      thighCm: parseNum("thighCm"),
      hipCm: parseNum("hipCm"),
      notes: notes.trim(),
    };

    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/web/measurements", { method: "PUT", body: payload });
      triggerHaptic("success");
      bumpDataEpoch();
      closeAllModals();
      notify("身体围度已保存");
    } catch (err) {
      setError((err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!existing) return;
    openConfirm({
      title: "删除围度记录",
      message: `确定要删除 ${existing.date} 的身体围度记录吗？`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        await apiFetch(`/api/web/measurements/${encodeURIComponent(existing.date)}`, { method: "DELETE" });
        bumpDataEpoch();
        closeAllModals();
        notify("已删除围度记录");
      },
    });
  };

  return (
    <form className="dialog-form" onSubmit={(e) => void handleSubmit(e)}>
      <label className="field">
        <span>测量日期</span>
        <input
          type="date"
          value={date}
          min="1902-01-01"
          max={todayStr}
          required
          readOnly={Boolean(existing)}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>

      <div className="fields">
        {MEASUREMENT_SPECS.map(([key, label, minVal, maxVal]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <div className="input-unit">
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={minVal}
                max={maxVal}
                value={values[key]}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              />
              <span>cm</span>
            </div>
          </label>
        ))}
      </div>

      <label className="field">
        <span>测量备注（可选）</span>
        <input
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例如：晨起空腹、冷态测量"
        />
      </label>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>

      <footer className={`dialog-foot${existing ? " has-remove" : ""}`}>
        {existing ? (
          <button type="button" className="danger" onClick={handleDelete}>
            删除记录
          </button>
        ) : null}
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : "保存围度"}
        </button>
      </footer>
    </form>
  );
}
