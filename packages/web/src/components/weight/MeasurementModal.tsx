import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { shortDate, today } from "../../lib/date";
import { MEASUREMENT_SPECS, type MeasurementEntry, type MeasurementValues } from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { useUiStore } from "../../store/useUiStore";

function valuesFromEntry(entry: MeasurementEntry | null | undefined): Record<keyof MeasurementValues, string> {
  return {
    waistCm: entry?.waistCm != null ? String(entry.waistCm) : "",
    chestCm: entry?.chestCm != null ? String(entry.chestCm) : "",
    armCm: entry?.armCm != null ? String(entry.armCm) : "",
    thighCm: entry?.thighCm != null ? String(entry.thighCm) : "",
    hipCm: entry?.hipCm != null ? String(entry.hipCm) : "",
  };
}

export function MeasurementModal({
  existing = null,
  history: initialHistory = [],
}: {
  existing?: MeasurementEntry | null;
  history?: MeasurementEntry[];
}) {
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const todayStr = today();
  const [history, setHistory] = useState<MeasurementEntry[]>(initialHistory);
  const [date, setDate] = useState(existing?.date ?? todayStr);
  const [values, setValues] = useState<Record<keyof MeasurementValues, string>>(() => valuesFromEntry(existing));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [loadedFromDate, setLoadedFromDate] = useState<string>(existing?.date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialHistory.length > 0) return;
    let active = true;
    void apiFetch<MeasurementEntry[]>("/api/web/measurements")
      .then((rows) => {
        if (!active || !Array.isArray(rows)) return;
        setHistory(rows);
        if (!existing) {
          const matched = rows.find((r) => r.date === date);
          if (matched) {
            setValues(valuesFromEntry(matched));
            setNotes(matched.notes ?? "");
            setLoadedFromDate(matched.date);
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const byDate = useMemo(() => new Map(history.map((m) => [m.date, m])), [history]);
  const activeExisting = existing ?? byDate.get(date) ?? null;

  const latestByKey = useMemo(() => {
    const out: Partial<Record<keyof MeasurementValues, number>> = {};
    for (const row of history) {
      for (const [k] of MEASUREMENT_SPECS) {
        if (out[k] == null && row[k] != null) out[k] = row[k]!;
      }
    }
    return out;
  }, [history]);

  const handleDateChange = (nextDate: string) => {
    setDate(nextDate);
    const matched = byDate.get(nextDate);
    if (matched) {
      setValues(valuesFromEntry(matched));
      setNotes(matched.notes ?? "");
      setLoadedFromDate(matched.date);
    } else if (loadedFromDate) {
      setValues(valuesFromEntry(null));
      setNotes("");
      setLoadedFromDate("");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const parseNum = (k: keyof MeasurementValues): number | null => {
      const raw = values[k].trim();
      return raw === "" ? null : Number(raw);
    };

    const parsedVals = {
      waistCm: parseNum("waistCm"),
      chestCm: parseNum("chestCm"),
      armCm: parseNum("armCm"),
      thighCm: parseNum("thighCm"),
      hipCm: parseNum("hipCm"),
    };
    if (!Object.values(parsedVals).some((v) => v != null && Number.isFinite(v))) {
      setError("请至少填写一项围度数据");
      return;
    }

    const payload = {
      date,
      ...parsedVals,
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
    if (!activeExisting) return;
    openConfirm({
      title: "删除围度记录",
      message: `确定要删除 ${activeExisting.date} 的身体围度记录吗？`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        await apiFetch(`/api/web/measurements/${encodeURIComponent(activeExisting.date)}`, { method: "DELETE" });
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
          onChange={(e) => handleDateChange(e.target.value)}
        />
      </label>

      {!existing && activeExisting ? (
        <p className="muted" role="status" style={{ margin: "-4px 0 4px", fontSize: 12 }}>
          已自动载入 {shortDate(activeExisting.date)} 已有围度，可直接补充或修改，不会覆盖未改动项。
        </p>
      ) : null}

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
                placeholder={latestByKey[key] != null ? `上次 ${latestByKey[key]}` : ""}
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

      <footer className={`dialog-foot${activeExisting ? " has-remove" : ""}`}>
        {activeExisting ? (
          <button type="button" className="danger" onClick={handleDelete}>
            删除记录
          </button>
        ) : (
          <button type="button" className="quiet" onClick={closeAllModals}>
            取消
          </button>
        )}
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "保存中…" : "保存围度"}
        </button>
      </footer>
    </form>
  );
}
