import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  const [baseEntry, setBaseEntry] = useState<MeasurementEntry | null>(existing ?? null);
  const [conflictCurrent, setConflictCurrent] = useState<MeasurementEntry | null>(null);
  const [loadedFromDate, setLoadedFromDate] = useState<string>(existing?.date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dateRef = useRef(date);
  dateRef.current = date;
  const dirtyFieldsRef = useRef<Set<keyof MeasurementValues | "notes">>(new Set());

  useEffect(() => {
    if (initialHistory.length > 0) {
      if (!existing) {
        const matched = initialHistory.find((r) => r.date === dateRef.current);
        if (matched) {
          setValues(valuesFromEntry(matched));
          setNotes(matched.notes ?? "");
          setBaseEntry(matched);
          setLoadedFromDate(matched.date);
        }
      }
      return;
    }
    let active = true;
    void apiFetch<MeasurementEntry[]>("/api/web/measurements")
      .then((rows) => {
        if (!active || !Array.isArray(rows)) return;
        setHistory(rows);
        if (!existing) {
          // #86: Always match against currently selected dateRef.current and merge only untouched fields.
          const currentDate = dateRef.current;
          const matched = rows.find((r) => r.date === currentDate) ?? null;
          setBaseEntry(matched);
          setLoadedFromDate(matched?.date ?? "");
          if (matched) {
            const serverVals = valuesFromEntry(matched);
            setValues((prev) => {
              const merged = { ...prev };
              for (const [k] of MEASUREMENT_SPECS) {
                if (!dirtyFieldsRef.current.has(k)) merged[k] = serverVals[k];
              }
              return merged;
            });
            if (!dirtyFieldsRef.current.has("notes")) {
              setNotes(matched.notes ?? "");
            }
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const byDate = useMemo(() => new Map(history.map((m) => [m.date, m])), [history]);
  // #86: Never attach a baseEntry belonging to a different date than the currently selected date.
  const activeExisting =
    (baseEntry && baseEntry.date === date ? baseEntry : null) ??
    (existing && existing.date === date ? existing : null) ??
    byDate.get(date) ??
    null;

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
    dateRef.current = nextDate;
    dirtyFieldsRef.current.clear();
    setConflictCurrent(null);
    setError("");
    const matched = byDate.get(nextDate);
    if (matched) {
      setValues(valuesFromEntry(matched));
      setNotes(matched.notes ?? "");
      setBaseEntry(matched);
      setLoadedFromDate(matched.date);
    } else if (loadedFromDate) {
      setValues(valuesFromEntry(null));
      setNotes("");
      setBaseEntry(null);
      setLoadedFromDate("");
    }
  };

  const handleReloadLatest = async () => {
    setError("");
    try {
      const latest = conflictCurrent ?? (await apiFetch<MeasurementEntry[]>("/api/web/measurements")).find((r) => r.date === date) ?? null;
      if (latest) {
        setHistory((prev) => [latest, ...prev.filter((r) => r.date !== latest.date)]);
        setBaseEntry(latest);
        // Preserve user's locally modified fields while pulling fresh server values for untouched fields
        setValues((prev) => {
          const baseVals = valuesFromEntry(activeExisting);
          const serverVals = valuesFromEntry(latest);
          const merged = { ...serverVals };
          for (const [k] of MEASUREMENT_SPECS) {
            if (prev[k].trim() !== baseVals[k].trim()) merged[k] = prev[k];
          }
          return merged;
        });
        const baseNotes = (activeExisting?.notes ?? "").trim();
        if (notes.trim() === baseNotes) {
          setNotes(latest.notes ?? "");
        }
        setConflictCurrent(null);
        notify("已载入最新围度，请核对后再次保存");
      } else {
        setBaseEntry(null);
        setConflictCurrent(null);
      }
    } catch {
      setError("刷新最新围度失败，请稍后重试");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const parseNum = (k: keyof MeasurementValues): number | null => {
      const raw = values[k].trim();
      return raw === "" ? null : Number(raw);
    };

    const parsedVals: Record<keyof MeasurementValues, number | null> = {
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

    const trimmedNotes = notes.trim();
    const loaded = activeExisting;
    const payload: Record<string, unknown> = {
      date,
      expectedUpdatedAt: loaded?.updatedAt ?? null,
    };

    if (loaded) {
      const base: Record<string, unknown> = {};
      let dirtyCount = 0;
      for (const [k] of MEASUREMENT_SPECS) {
        const prevVal = loaded[k] != null ? Number(loaded[k]) : null;
        const nextVal = parsedVals[k];
        if (nextVal !== prevVal) {
          payload[k] = nextVal;
          base[k] = prevVal;
          dirtyCount++;
        }
      }
      const prevNotes = (loaded.notes ?? "").trim();
      if (trimmedNotes !== prevNotes) {
        payload.notes = trimmedNotes;
        base.notes = prevNotes;
        dirtyCount++;
      }
      if (dirtyCount === 0) {
        closeAllModals();
        notify("未检测到围度修改");
        return;
      }
      payload.base = base;
    } else {
      Object.assign(payload, parsedVals, { notes: trimmedNotes });
    }

    setSaving(true);
    setError("");
    setConflictCurrent(null);
    try {
      await apiFetch("/api/web/measurements", { method: "PUT", body: payload });
      triggerHaptic("success");
      bumpDataEpoch();
      closeAllModals();
      notify("身体围度已保存");
    } catch (err) {
      const apiErr = err as Error & { status?: number; payload?: { current?: MeasurementEntry | null } };
      if (apiErr.status === 409) {
        setConflictCurrent(apiErr.payload?.current ?? null);
        setError(apiErr.message || "该日期的围度已在其他设备更新，请刷新合并后再保存");
      } else {
        setError(apiErr?.message || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!activeExisting) return;
    const target = activeExisting;
    openConfirm({
      title: "删除围度记录",
      message: `确定要删除 ${target.date} 的身体围度记录吗？`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        const qs = target.updatedAt ? `?expectedUpdatedAt=${encodeURIComponent(target.updatedAt)}` : "";
        try {
          await apiFetch(`/api/web/measurements/${encodeURIComponent(target.date)}${qs}`, { method: "DELETE" });
          bumpDataEpoch();
          closeAllModals();
          notify("已删除围度记录");
        } catch (err) {
          const apiErr = err as Error & { status?: number; payload?: { current?: MeasurementEntry | null } };
          if (apiErr.status === 409) {
            const latest = apiErr.payload?.current ?? null;
            setConflictCurrent(latest);
            if (latest) {
              setHistory((prev) => [latest, ...prev.filter((r) => r.date !== latest.date)]);
              setBaseEntry(latest);
              setValues(valuesFromEntry(latest));
              setNotes(latest.notes ?? "");
              dirtyFieldsRef.current.clear();
            }
            setError(apiErr.message || "该日期的围度已在其他设备更新，已载入最新数据，请确认后再删除");
            notify("围度已在其他设备更新，已取消删除并载入最新数据");
            return;
          }
          throw err;
        }
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
                onChange={(e) => {
                  dirtyFieldsRef.current.add(key);
                  setValues((prev) => ({ ...prev, [key]: e.target.value }));
                }}
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
          onChange={(e) => {
            dirtyFieldsRef.current.add("notes");
            setNotes(e.target.value);
          }}
          placeholder="例如：晨起空腹、冷态测量"
        />
      </label>

      <p className="form-error" role="alert" hidden={!error}>
        {error}
      </p>
      {conflictCurrent ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4 }}>
          <button type="button" className="secondary-button" onClick={() => void handleReloadLatest()}>
            载入最新围度并保留当前草稿
          </button>
        </div>
      ) : null}

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
