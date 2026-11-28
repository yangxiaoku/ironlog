import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { fmt, today } from "../../lib/date";
import { shiftDateStr, type RecordEnvelope, type WeightData } from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { enqueueMutation, getOfflineStorage, isNetworkError } from "../../lib/offline-queue";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export function WeightEditorModal({
  record,
  defaultDate,
  defaultWeight,
}: {
  record?: RecordEnvelope<WeightData>;
  defaultDate?: string;
  defaultWeight?: number | null;
}) {
  const userId = useAuthStore((s) => s.userId);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const refreshPendingCount = useUiStore((s) => s.refreshPendingCount);
  const notify = useUiStore((s) => s.notify);

  const todayStr = today();
  const [date, setDate] = useState(record?.data.date ?? defaultDate ?? todayStr);
  const [weight, setWeight] = useState<string>(() => {
    if (record?.data.weight != null) return String(record.data.weight);
    if (defaultWeight != null) return String(defaultWeight);
    return "";
  });
  const [bodyFat, setBodyFat] = useState<string>(
    record?.data.bodyFat != null ? String(record.data.bodyFat) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resolvedVersionsRef = useRef<Map<string, number>>(new Map());
  const resolvedExistingRef = useRef<Map<string, RecordEnvelope<WeightData>>>(new Map());
  const weightDirtyRef = useRef(false);
  const bodyFatDirtyRef = useRef(false);

  const handleDateSelect = (nextDate: string) => {
    if (nextDate === date) return;
    // #190: Clear auto-loaded values from the previous date so switching to an unlogged date never leaks stale bodyFat
    if (!weightDirtyRef.current) {
      setWeight(defaultWeight != null ? String(defaultWeight) : "");
    }
    if (!bodyFatDirtyRef.current) {
      setBodyFat("");
    }
    weightDirtyRef.current = false;
    bodyFatDirtyRef.current = false;
    setDate(nextDate);
  };

  useEffect(() => {
    if (record) return;
    let active = true;
    const targetDate = date;
    const weightId = `weight_${targetDate}`;
    void apiFetch<RecordEnvelope<WeightData>>(
      `/api/web/records/weight/${encodeURIComponent(weightId)}?includeDeleted=1`,
    )
      .then((existing) => {
        if (!active) return;
        resolvedVersionsRef.current.set(targetDate, existing.version);
        resolvedExistingRef.current.set(targetDate, existing);
        if (!existing.deleted && existing.data) {
          // #76: Merge each field independently so editing weight before slow fetch resolves preserves existing bodyFat.
          if (!weightDirtyRef.current) {
            setWeight(String(existing.data.weight));
          }
          if (!bodyFatDirtyRef.current) {
            setBodyFat(existing.data.bodyFat != null ? String(existing.data.bodyFat) : "");
          }
        } else {
          if (!bodyFatDirtyRef.current) setBodyFat("");
        }
      })
      .catch(() => {
        if (!active) return;
        resolvedVersionsRef.current.set(targetDate, 0);
        resolvedExistingRef.current.delete(targetDate);
        // #190: On 404 (no record for targetDate), ensure stale auto-loaded bodyFat is cleared
        if (!bodyFatDirtyRef.current) setBodyFat("");
      });
    return () => {
      active = false;
    };
  }, [record, date]);

  const stepWeight = (delta: number) => {
    triggerHaptic("light");
    weightDirtyRef.current = true;
    const cur = Number(weight) || defaultWeight || 65;
    const next = Math.max(1, Math.min(500, Math.round((cur + delta) * 100) / 100));
    setWeight(Number.isInteger(Math.round(next * 100) / 10) ? next.toFixed(1) : next.toFixed(2));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const wNum = Number(weight);
    if (!Number.isFinite(wNum) || wNum < 1 || wNum > 500) {
      setError("请输入有效体重（1–500 kg）");
      return;
    }
    const bfTrim = bodyFat.trim();
    let bfNum = bfTrim === "" ? null : Number(bfTrim);
    if (bfNum != null && (!Number.isFinite(bfNum) || bfNum < 1 || bfNum > 75)) {
      setError("请输入有效体脂率（1–75%）");
      return;
    }

    setSaving(true);
    setError("");

    let baseVersion = record?.version ?? resolvedVersionsRef.current.get(date);
    let existingRec = record ?? resolvedExistingRef.current.get(date);
    if (!record && baseVersion === undefined) {
      try {
        const existing = await apiFetch<RecordEnvelope<WeightData>>(
          `/api/web/records/weight/${encodeURIComponent(`weight_${date}`)}?includeDeleted=1`,
        );
        baseVersion = existing.version;
        existingRec = existing;
        resolvedVersionsRef.current.set(date, baseVersion);
        resolvedExistingRef.current.set(date, existing);
      } catch {
        baseVersion = 0;
      }
    }
    // #76: Preserve existing bodyFat if user only edited weight and never touched bodyFat field.
    if (!record && !bodyFatDirtyRef.current && bfNum === null && existingRec && !existingRec.deleted && existingRec.data?.bodyFat != null) {
      bfNum = existingRec.data.bodyFat;
    }

    const payload = {
      opId: crypto.randomUUID(),
      id: record?.id ?? `weight_${date}`,
      kind: "weight" as const,
      baseVersion: baseVersion ?? 0,
      deleted: false,
      data: {
        date,
        weight: Math.round(wNum * 100) / 100,
        bodyFat: bfNum != null ? Math.round(bfNum * 10) / 10 : null,
      },
    };

    try {
      await apiFetch("/api/records", { method: "POST", body: payload });
      triggerHaptic("success");
      bumpDataEpoch();
      closeAllModals();
      notify(record ? "体重记录已更新" : "体重已记录");
    } catch (err) {
      if (isNetworkError(err) && userId) {
        const queued = enqueueMutation(getOfflineStorage(), userId, {
          opId: payload.opId,
          path: "/api/records",
          method: "POST",
          body: payload,
          label: `体重：${fmt(payload.data.weight, 1)} kg`,
        });
        if (queued == null) {
          setError("浏览器无法暂存离线记录。请保留此页面，联网后重新保存");
          return;
        }
        refreshPendingCount(userId);
        closeAllModals();
        notify("离线状态：体重已暂存本地");
        return;
      }
      setError((err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!record) return;
    openConfirm({
      title: "删除体重记录",
      message: `确定要删除 ${record.data.date} 的称重记录（${fmt(record.data.weight, 2)} kg）吗？`,
      confirmLabel: "删除记录",
      onConfirm: async () => {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: record.id,
            kind: "weight",
            baseVersion: record.version,
            deleted: true,
            data: record.data,
          },
        });
        bumpDataEpoch();
        closeAllModals();
        notify("已删除体重记录");
      },
    });
  };

  const yesterday = shiftDateStr(todayStr, -1);
  const dayBeforeYesterday = shiftDateStr(todayStr, -2);

  return (
    <form className="dialog-form modern-weight-form" onSubmit={(e) => void handleSubmit(e)}>
      <div className="date-quick-strip">
        <div className="date-pill-group">
          <button
            type="button"
            className="date-pill"
            aria-pressed={date === todayStr}
            disabled={Boolean(record)}
            onClick={() => handleDateSelect(todayStr)}
          >
            今天
          </button>
          <button
            type="button"
            className="date-pill"
            aria-pressed={date === yesterday}
            disabled={Boolean(record)}
            onClick={() => handleDateSelect(yesterday)}
          >
            昨天
          </button>
          <button
            type="button"
            className="date-pill"
            aria-pressed={date === dayBeforeYesterday}
            disabled={Boolean(record)}
            onClick={() => handleDateSelect(dayBeforeYesterday)}
          >
            前天
          </button>
        </div>
        <input
          type="date"
          aria-label="称重日期"
          className="date-input-inline"
          value={date}
          min="1902-01-01"
          max={todayStr}
          required
          readOnly={Boolean(record)}
          onChange={(e) => handleDateSelect(e.target.value)}
        />
      </div>

      <div className="scale-hero-card">
        <div className="scale-head">
          <span className="scale-label">
            <Icon name="weight" size={16} /> 体重
          </span>
          <span className="scale-mode-pill">KG</span>
        </div>

        <div className="scale-display">
          <input
            type="number"
            aria-label="体重，千克"
            inputMode="decimal"
            min={1}
            max={500}
            step="any"
            required
            autoFocus={!record}
            value={weight}
            onChange={(e) => {
              weightDirtyRef.current = true;
              setWeight(e.target.value);
            }}
            placeholder="0.0"
          />
          <span className="scale-unit">kg</span>
        </div>

        {!record && defaultWeight != null ? (
          <p className="scale-prev-hint">已默认带入上次体重 {fmt(defaultWeight, 2)} kg</p>
        ) : null}

        <div className="scale-stepper-row">
          {[-1, -0.5, -0.1, 0.1, 0.5, 1].map((d) => (
            <button
              key={d}
              type="button"
              className="scale-stepper-btn"
              aria-label={`体重${d > 0 ? "增加" : "减少"} ${Math.abs(d)} 千克`}
              onClick={() => stepWeight(d)}
            >
              {d > 0 ? `+${d}` : d}
            </button>
          ))}
        </div>
      </div>

      <div className="bodyfat-card">
        <span className="bodyfat-head">体脂率 %（选填）</span>
        <div className="bodyfat-body">
          <input
            type="number"
            aria-label="体脂率，百分比"
            inputMode="decimal"
            min={1}
            max={75}
            step="any"
            value={bodyFat}
            onChange={(e) => {
              bodyFatDirtyRef.current = true;
              setBodyFat(e.target.value);
            }}
            placeholder="—"
          />
          <div className="bodyfat-steppers">
            {[-0.5, 0.5].map((d) => (
              <button
                key={d}
                type="button"
                className="micro-chip"
                aria-label={`体脂率${d > 0 ? "增加" : "减少"} ${Math.abs(d)} 个百分点`}
                onClick={() => {
                  triggerHaptic("light");
                  bodyFatDirtyRef.current = true;
                  const cur = Number(bodyFat) || 15;
                  setBodyFat(String(Math.max(1, Math.min(75, Math.round((cur + d) * 10) / 10))));
                }}
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
        </div>
      </div>

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
          {saving ? "保存中…" : "保存称重"}
        </button>
      </footer>
    </form>
  );
}
