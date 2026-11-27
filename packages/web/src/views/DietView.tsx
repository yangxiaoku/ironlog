import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotMeter, ThinMeter } from "../components/Meters";
import { PageHeading, WorkspaceTabs } from "../components/WorkspaceTabs";
import { apiFetch } from "../lib/api";
import { fmt, shortDate, today } from "../lib/date";
import { copyDietBatch, DietCopyMismatchError } from "../lib/diet-copy";
import {
  MEALS,
  safeUuid,
  shiftDateStr,
  type DietData,
  type MealKey,
  type MealTemplateData,
  type MealTemplateFood,
  type ProfileGoals,
  type RecordEnvelope,
} from "../lib/domain";
import { triggerHaptic } from "../lib/haptics-audio";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import { PROFILE_VERSION_EVENT } from "../lib/workout-helpers";
import {
  openDietEditor,
  openEditMealTemplateModal,
  openSaveMealTemplateModal,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

const WATER_GOAL_KEY = "ironlog-web-water-goal";
const WATER_GOALS = [2000, 2500, 3000, 3500];

function waterGoalKey(userId: string): string {
  return userId ? `${WATER_GOAL_KEY}:${userId}` : WATER_GOAL_KEY;
}

function getWaterGoalMl(userId: string): number {
  if (typeof localStorage === "undefined") return 2000;
  const v = Number(localStorage.getItem(waterGoalKey(userId)) ?? localStorage.getItem(WATER_GOAL_KEY));
  return WATER_GOALS.includes(v) ? v : 2000;
}

export function DietView() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);

  const todayStr = today();
  const [date, setDate] = useState(todayStr);
  interface DietViewSnap {
    records: Array<RecordEnvelope<DietData>>;
    templates: Array<RecordEnvelope<MealTemplateData>>;
    goals: ProfileGoals | null;
  }
  const cachedDiet = peekQuery<DietViewSnap>("view:diet", userId)?.data;
  const [records, setRecords] = useState<Array<RecordEnvelope<DietData>>>(() => cachedDiet?.records ?? []);
  const [templates, setTemplates] = useState<Array<RecordEnvelope<MealTemplateData>>>(() => cachedDiet?.templates ?? []);
  const [goals, setGoals] = useState<ProfileGoals | null>(() => cachedDiet?.goals ?? null);
  const [loading, setLoading] = useState(() => !cachedDiet);
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);
  const copyInFlight = useRef(false);
  const [dietDone, setDietDone] = useState(false);
  const [waterMl, setWaterMl] = useState(0);
  const [waterGoal, setWaterGoal] = useState(() => getWaterGoalMl(userId));
  const [savingWaterGoal, setSavingWaterGoal] = useState(false);
  const [failedWaterGoal, setFailedWaterGoal] = useState<number | null>(null);
  const [busyWater, setBusyWater] = useState(false);
  const [pendingWaterOp, setPendingWaterOp] = useState<{
    opId: string;
    date: string;
    deltaMl?: number;
    setMl?: number;
    label: string;
  } | null>(null);
  const [customWaterOpen, setCustomWaterOpen] = useState(false);
  const [customWaterVal, setCustomWaterVal] = useState("");
  const [markingDone, setMarkingDone] = useState(false);
  const dateRef = useRef(date);
  dateRef.current = date;
  const lastHydrationKeyRef = useRef(`${userId}:${date}`);

  useEffect(() => {
    setWaterGoal(goals?.waterGoalMl ?? getWaterGoalMl(userId));
  }, [userId, goals?.waterGoalMl]);

  useEffect(() => {
    let active = true;
    const staleHit = peekQuery<DietViewSnap>("view:diet", userId)?.data;
    if (staleHit) {
      setRecords(staleHit.records);
      setTemplates(staleHit.templates);
      setGoals(staleHit.goals);
      setLoading(false);
    } else {
      setRecords([]);
      setTemplates([]);
      setGoals(null);
      setLoading(true);
    }
    setError("");
    void Promise.all([
      cachedApiFetch<Array<RecordEnvelope<DietData>>>("/api/records/diet", { epoch: dataEpoch, userId }),
      cachedApiFetch<Array<RecordEnvelope<MealTemplateData>>>("/api/records/mealTemplate", { epoch: dataEpoch, userId }).catch(() => []),
      cachedApiFetch<{ profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId }).catch(() => null),
    ])
      .then(([dietRows, tplRows, profRes]) => {
        if (!active) return;
        const snap: DietViewSnap = {
          records: dietRows.filter((r) => !r.deleted),
          templates: tplRows.filter((r) => !r.deleted),
          goals: profRes?.profile ?? null,
        };
        writeQueryCache("view:diet", snap, { userId, epoch: dataEpoch });
        setRecords(snap.records);
        setTemplates(snap.templates);
        setGoals(snap.goals);
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载饮食数据失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  useEffect(() => {
    let active = true;
    const hydrationKey = `${userId}:${date}`;
    if (lastHydrationKeyRef.current !== hydrationKey) {
      lastHydrationKeyRef.current = hydrationKey;
      setDietDone(false);
      setWaterMl(0);
      setPendingWaterOp(null);
    }
    void Promise.all([
      cachedApiFetch<{ complete?: boolean }>(`/api/web/nutrition-day?date=${encodeURIComponent(date)}`, { epoch: dataEpoch, userId }).catch(() => null),
      cachedApiFetch<{ entries?: Array<{ waterMl?: number }> }>(
        `/api/integrations/apple-health/daily?from=${date}&through=${date}`,
        { epoch: dataEpoch, userId },
      ).catch(() => null),
    ]).then(([marker, dailyRes]) => {
      if (!active) return;
      setDietDone(Boolean(marker?.complete));
      setWaterMl(dailyRes?.entries?.[0]?.waterMl ?? 0);
    });
    return () => {
      active = false;
    };
  }, [userId, date, dataEpoch]);

  const recentFoods = useMemo(() => {
    const counts = new Map<string, DietData & { count: number; updatedAt: string }>();
    for (const r of records) {
      const d = r.data;
      if (!d?.name) continue;
      const prev = counts.get(d.name);
      if (!prev || r.updatedAt > prev.updatedAt) {
        counts.set(d.name, { ...d, count: (prev?.count ?? 0) + 1, updatedAt: r.updatedAt });
      } else {
        prev.count++;
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10);
  }, [records]);

  const prevDate = shiftDateStr(date, -1);
  const dayRows = useMemo(
    () => records.filter((r) => r.data.date === date).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [records, date],
  );
  const prevDayRows = useMemo(() => records.filter((r) => r.data.date === prevDate), [records, prevDate]);

  const totalKcal = dayRows.reduce((s, r) => s + r.data.calories, 0);
  const targetKcal = goals?.calories ?? null;
  const kcalDiff = targetKcal != null ? Math.round(targetKcal - totalKcal) : null;
  const goalDiffNote =
    kcalDiff === null
      ? ""
      : kcalDiff > 0
        ? `还差 ${fmt(kcalDiff, 0)} kcal`
        : kcalDiff < 0
          ? `超出 ${fmt(Math.abs(kcalDiff), 0)} kcal`
          : "已达每日目标";

  const copyFoodsToDate = async (
    intent: string,
    foods: Array<Pick<MealTemplateFood, "name" | "calories" | "protein" | "carbs" | "fat"> & { meal?: MealKey }>,
    targetMeal?: MealKey,
    label?: string,
    mode: "auto" | "retry-pending" | "replace-with-new" = "auto",
  ) => {
    if (copyInFlight.current) return;
    const targetDate = date;
    copyInFlight.current = true;
    setCopying(true);
    try {
      const count = await copyDietBatch({
        userId, intent, date: targetDate, meal: targetMeal, foods, mode, detectSourceChange: true,
        send: (body) => apiFetch("/api/sync", { method: "POST", body, accountId: userId }),
      });
      if (!count) return;
      triggerHaptic("success");
      bumpDataEpoch();
      notify(label || `已添加 ${count} 项饮食至 ${shortDate(targetDate)}`);
    } catch (err) {
      if (err instanceof DietCopyMismatchError) {
        openConfirm({
          title: "模板内容已更新",
          message: `上次复制（${err.pendingSummary.names || `${err.pendingSummary.count} 项`} · ${err.pendingSummary.calories} kcal）尚未收到确认回执，但当前内容已变更为（${err.newSummary.names || `${err.newSummary.count} 项`} · ${err.newSummary.calories} kcal）。确认放弃旧批次并按最新内容复制吗？`,
          confirmLabel: "按最新内容复制",
          onConfirm: async () => {
            await copyFoodsToDate(intent, foods, targetMeal, label, "replace-with-new");
          },
        });
        return;
      }
      notify((err as Error)?.message || "复制饮食失败");
    } finally {
      copyInFlight.current = false;
      setCopying(false);
    }
  };

  const sendWaterRequest = async (req: { opId: string; date: string; deltaMl?: number; setMl?: number; label: string }) => {
    if (busyWater) return;
    setBusyWater(true);
    triggerHaptic("light");
    try {
      const res = await apiFetch<{ waterMl: number }>("/api/web/water", {
        method: "POST",
        body: req.setMl != null
          ? { date: req.date, setMl: req.setMl, opId: req.opId }
          : { date: req.date, deltaMl: req.deltaMl ?? 250, opId: req.opId },
      });
      setPendingWaterOp(null);
      if (dateRef.current === req.date) {
        setWaterMl(res.waterMl);
      }
      const dayLabel = req.date === todayStr ? "今日饮水" : `${shortDate(req.date)} 饮水`;
      notify(req.setMl === 0 ? `已重置${dayLabel}记录` : `${dayLabel} ${fmt(res.waterMl, 0)} ml`);
    } catch (err) {
      setPendingWaterOp(req);
      notify((err as Error)?.message || "饮水保存尚未确认，可点击下方重试原操作");
    } finally {
      setBusyWater(false);
    }
  };

  const updateWater = async (deltaMl?: number, setMl?: number) => {
    const reqDate = date;
    const samePending =
      pendingWaterOp &&
      pendingWaterOp.date === reqDate &&
      (setMl != null ? pendingWaterOp.setMl === setMl : pendingWaterOp.setMl == null && pendingWaterOp.deltaMl === (deltaMl ?? 250));
    const label =
      setMl === 0
        ? "清零饮水"
        : setMl != null
          ? `设为 ${setMl}ml`
          : (deltaMl ?? 250) > 0
            ? `+${deltaMl ?? 250}ml`
            : `${deltaMl}ml`;
    const op = samePending
      ? pendingWaterOp
      : {
          opId: safeUuid(),
          date: reqDate,
          ...(setMl != null ? { setMl } : { deltaMl: deltaMl ?? 250 }),
          label,
        };
    await sendWaterRequest(op);
  };

  const handleMarkDone = async () => {
    if (markingDone) return;
    const reqDate = date;
    setMarkingDone(true);
    try {
      await apiFetch("/api/web/nutrition-day", {
        method: "PUT",
        body: { date: reqDate, opId: safeUuid() },
      });
      triggerHaptic("success");
      if (dateRef.current === reqDate) {
        setDietDone(true);
      }
      notify("已标记全天饮食记录完成");
    } catch (err) {
      notify((err as Error)?.message || "操作失败");
    } finally {
      setMarkingDone(false);
    }
  };

  const handleUnmarkDone = async () => {
    if (markingDone) return;
    const reqDate = date;
    setMarkingDone(true);
    try {
      await apiFetch(`/api/web/nutrition-day?date=${encodeURIComponent(reqDate)}`, { method: "DELETE" });
      triggerHaptic("light");
      if (dateRef.current === reqDate) {
        setDietDone(false);
      }
      notify("已取消全天已记录标记");
    } catch (err) {
      notify((err as Error)?.message || "取消标记失败");
    } finally {
      setMarkingDone(false);
    }
  };

  const waterCups = Math.floor(waterMl / 250);
  const waterPct = Math.min(100, Math.round((waterMl / Math.max(250, waterGoal)) * 100));

  if (loading && !records.length && !templates.length && !goals) {
    return (
      <>
        <WorkspaceTabs />
        <PageHeading title="饮食记录" view="diet" />
        <div className="empty loading" role="status">
          正在加载饮食记录…
        </div>
      </>
    );
  }

  if (error && !records.length && !templates.length && !goals) {
    return (
      <>
        <WorkspaceTabs />
        <PageHeading title="饮食记录" view="diet" />
        <div className="empty">
          <strong>饮食数据加载失败</strong>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <WorkspaceTabs />
      <PageHeading title="饮食记录" view="diet" />
      {error ? (
        <div
          className="panel"
          role="alert"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}
        >
          <span>饮食数据刷新失败：{error}</span>
          <button type="button" className="secondary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      ) : null}

      <div className="diet-toolbar">
        <div className="toolbar">
          <button
            type="button"
            className="icon-button"
            aria-label="前一天"
            disabled={date <= "1902-01-01"}
            onClick={() => setDate(shiftDateStr(date, -1))}
          >
            <Icon name="back" />
          </button>
          <input
            aria-label="饮食日期"
            type="date"
            min="1902-01-01"
            max={todayStr}
            value={date}
            onChange={(e) => {
              if (e.target.value && e.target.validity.valid) setDate(e.target.value);
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="后一天"
            disabled={date >= todayStr}
            onClick={() => setDate(shiftDateStr(date, 1))}
          >
            <Icon name="chevron" />
          </button>
          {date !== todayStr ? (
            <button type="button" className="quiet" onClick={() => setDate(todayStr)}>
              今天
            </button>
          ) : null}
        </div>

        <div className="diet-toolbar-actions">
          {prevDayRows.length ? (
            <button
              type="button"
              className="secondary-button"
              disabled={copying}
              onClick={() =>
                void copyFoodsToDate(
                  `day:${prevDate}`,
                  prevDayRows.map((r) => r.data),
                  undefined,
                  `已复刻昨日全部饮食 (${prevDayRows.length} 项)`,
                )
              }
            >
              <Icon name="copy" size={15} /> 复刻昨日 ({prevDayRows.length})
            </button>
          ) : null}
          <button
            type="button"
            className="primary-button"
            onClick={() => openDietEditor({ date, recentFoods })}
          >
            <Icon name="plus" size={16} /> 记一笔饮食
          </button>
        </div>
      </div>

      <div className="diet-layout">
        <section className="panel diet-summary">
          <header className="panel-head">
            <h2>当天摄入</h2>
            {goalDiffNote && dayRows.length > 0 ? <span className="diet-diff">{goalDiffNote}</span> : null}
          </header>

          <div className="diet-energy">
            <strong>
              <MatrixText value={dayRows.length ? fmt(totalKcal, 0) : "0"} />
            </strong>
            <span>kcal</span>
          </div>

          {targetKcal ? (
            <>
              <DotMeter ratio={dayRows.length ? totalKcal / targetKcal : 0} count={20} label="热量完成度" />
              <div className="diet-budget-strip" aria-label="今日热量预算">
                <div>
                  <span>已摄入</span>
                  <strong>{dayRows.length ? fmt(totalKcal, 0) : "0"}</strong>
                  <small>kcal</small>
                </div>
                <div className={kcalDiff != null && kcalDiff < 0 ? "is-over" : "is-focus"}>
                  <span>{kcalDiff != null && kcalDiff < 0 ? "已超出" : "今日剩余"}</span>
                  <strong>{fmt(Math.abs(kcalDiff ?? targetKcal), 0)}</strong>
                  <small>kcal</small>
                </div>
                <div>
                  <span>每日目标</span>
                  <strong>{fmt(targetKcal, 0)}</strong>
                  <small>kcal</small>
                </div>
              </div>
            </>
          ) : null}

          <div className="diet-macros-list">
            {(
              [
                ["protein", "蛋白质"],
                ["carbs", "碳水"],
                ["fat", "脂肪"],
              ] as const
            ).map(([key, label]) => {
              const val = dayRows.reduce((s, r) => s + r.data[key], 0);
              const target = goals?.[key] ?? null;
              const rem = target ? Math.round(target - val) : null;
              return (
                <div key={key} className="macro-row">
                  <div className="macro-row-head">
                    <span>
                      {label}
                      {rem != null ? (
                        <small className={`macro-rem${rem <= 0 ? " is-met" : ""}`}>
                          {rem > 0 ? `还差 ${fmt(rem, 0)}g` : "已达标"}
                        </small>
                      ) : null}
                    </span>
                    <strong>
                      {dayRows.length ? fmt(val) : "—"}
                      {target ? <small> / {fmt(target, 0)} g</small> : <small> g</small>}
                    </strong>
                  </div>
                  {target ? (
                    <ThinMeter ratio={dayRows.length ? val / target : 0} label={`${label}完成度`} />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="hydration-box">
            <div className="hydration-head">
              <span>
                每日饮水 <strong>{fmt(waterMl, 0)}</strong> / {fmt(waterGoal, 0)} ml
              </span>
              <button
                type="button"
                className="quiet"
                disabled={savingWaterGoal}
                title={`已喝 ${waterCups} 杯，点击切换每日饮水目标`}
                onClick={async () => {
                  if (savingWaterGoal) return;
                  const next = WATER_GOALS[(WATER_GOALS.indexOf(waterGoal) + 1) % WATER_GOALS.length]!;
                  setSavingWaterGoal(true);
                  try {
                    const res = await apiFetch<{ waterGoalMl?: number; version?: number }>("/api/web/profile/water-goal", {
                      method: "PUT",
                      body: { waterGoalMl: next },
                    });
                    const confirmed = typeof res?.waterGoalMl === "number" ? res.waterGoalMl : next;
                    setWaterGoal(confirmed);
                    setFailedWaterGoal(null);
                    try {
                      localStorage.setItem(waterGoalKey(userId), String(confirmed));
                    } catch {}
                    if (typeof res?.version === "number" && typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent(PROFILE_VERSION_EVENT, { detail: res.version }));
                    }
                    notify(`每日饮水目标已设为 ${fmt(confirmed, 0)} ml（已同步云端）`);
                  } catch (err) {
                    setFailedWaterGoal(next);
                    notify((err as Error)?.message || "饮水目标保存失败，未同步云端");
                  } finally {
                    setSavingWaterGoal(false);
                  }
                }}
              >
                {savingWaterGoal ? "保存中…" : `${waterPct}% · 目标`}
              </button>
            </div>
            <ThinMeter ratio={waterMl / waterGoal} label="每日饮水完成度" />
            {failedWaterGoal != null ? (
              <div className="form-error" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                <span>饮水目标（{fmt(failedWaterGoal, 0)} ml）同步失败，当前仍为 {fmt(waterGoal, 0)} ml</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="micro-chip"
                    disabled={savingWaterGoal}
                    onClick={async () => {
                      const target = failedWaterGoal;
                      if (target == null || savingWaterGoal) return;
                      setSavingWaterGoal(true);
                      try {
                        const res = await apiFetch<{ waterGoalMl?: number; version?: number }>("/api/web/profile/water-goal", {
                          method: "PUT",
                          body: { waterGoalMl: target },
                        });
                        const confirmed = typeof res?.waterGoalMl === "number" ? res.waterGoalMl : target;
                        setWaterGoal(confirmed);
                        setFailedWaterGoal(null);
                        try {
                          localStorage.setItem(waterGoalKey(userId), String(confirmed));
                        } catch {}
                        if (typeof res?.version === "number" && typeof window !== "undefined") {
                          window.dispatchEvent(new CustomEvent(PROFILE_VERSION_EVENT, { detail: res.version }));
                        }
                        notify(`每日饮水目标已设为 ${fmt(confirmed, 0)} ml（已同步云端）`);
                      } catch (err) {
                        notify((err as Error)?.message || "饮水目标保存失败，未同步云端");
                      } finally {
                        setSavingWaterGoal(false);
                      }
                    }}
                  >
                    重试同步
                  </button>
                  <button type="button" className="quiet" disabled={savingWaterGoal} onClick={() => setFailedWaterGoal(null)}>
                    取消
                  </button>
                </span>
              </div>
            ) : null}
            {pendingWaterOp && pendingWaterOp.date === date ? (
              <div className="form-error" role="status" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                <span>上次「{pendingWaterOp.label}」未收到确认回执</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="micro-chip" disabled={busyWater} onClick={() => void sendWaterRequest(pendingWaterOp)}>
                    重试原操作
                  </button>
                  <button type="button" className="quiet" disabled={busyWater} onClick={() => setPendingWaterOp(null)}>
                    取消
                  </button>
                </span>
              </div>
            ) : null}
            <div className="hydration-actions">
              <button type="button" className="micro-chip" disabled={busyWater} onClick={() => void updateWater(250)}>
                +250ml
              </button>
              <button type="button" className="micro-chip" disabled={busyWater} onClick={() => void updateWater(500)}>
                +500ml
              </button>
              {waterMl > 0 ? (
                <>
                  <button
                    type="button"
                    className="micro-chip"
                    disabled={busyWater}
                    onClick={() => void updateWater(-Math.min(250, waterMl))}
                  >
                    -250ml
                  </button>
                  <button type="button" className="micro-chip" disabled={busyWater} onClick={() => void updateWater(0, 0)}>
                    清零
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="micro-chip"
                disabled={busyWater}
                aria-pressed={customWaterOpen}
                onClick={() => {
                  setCustomWaterVal(waterMl > 0 ? String(waterMl) : "");
                  setCustomWaterOpen((v) => !v);
                }}
              >
                自定义
              </button>
            </div>
            {customWaterOpen ? (
              <form
                style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = Math.round(Number(customWaterVal));
                  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 15000) {
                    notify("请输入 0–15000 ml 之间的有效饮水量");
                    return;
                  }
                  setCustomWaterOpen(false);
                  void updateWater(0, parsed);
                }}
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={15000}
                  step={50}
                  placeholder="输入今日总饮水量 (ml)"
                  value={customWaterVal}
                  onChange={(e) => setCustomWaterVal(e.target.value)}
                  style={{ flex: 1, minHeight: 34 }}
                />
                <button type="submit" className="secondary-button" disabled={busyWater} style={{ minHeight: 34, padding: "4px 12px" }}>
                  设定
                </button>
              </form>
            ) : null}
          </div>

          {dayRows.length ? (
            <footer className="diet-status">
              <button
                type="button"
                className="secondary-button"
                hidden={dietDone}
                disabled={markingDone}
                onClick={() => void handleMarkDone()}
              >
                标记全天已记录
              </button>
              <span className="diet-done" role="status" hidden={!dietDone}>
                <Icon name="check" size={17} /> 全天已记录
                <button
                  type="button"
                  className="quiet"
                  disabled={markingDone}
                  style={{ marginLeft: 8, padding: "2px 6px", fontSize: 12, minHeight: 24 }}
                  onClick={() => void handleUnmarkDone()}
                >
                  取消标记
                </button>
              </span>
            </footer>
          ) : null}
        </section>

        <div className="meal-grid">
          {(Object.entries(MEALS) as Array<[MealKey, string]>).map(([mealKey, mealLabel]) => {
            const entries = dayRows.filter((r) => r.data.meal === mealKey);
            const prevMealEntries = prevDayRows.filter((r) => r.data.meal === mealKey);
            const mealCal = entries.reduce((s, r) => s + r.data.calories, 0);
            const mealProt = entries.reduce((s, r) => s + r.data.protein, 0);
            const mealCarbs = entries.reduce((s, r) => s + r.data.carbs, 0);
            const mealFat = entries.reduce((s, r) => s + r.data.fat, 0);

            return (
              <section key={mealKey} className="panel meal-card">
                <header className="panel-head">
                  <div>
                    <h2>{mealLabel}</h2>
                    <p>
                      {entries.length
                        ? `${fmt(mealCal, 0)} kcal · 蛋 ${fmt(mealProt, 0)} · 碳 ${fmt(mealCarbs, 0)} · 脂 ${fmt(mealFat, 0)}g`
                        : "暂无记录"}
                    </p>
                  </div>
                  <div className="meal-head-actions">
                    {!entries.length && prevMealEntries.length ? (
                      <button
                        type="button"
                        className="quiet"
                        disabled={copying}
                        onClick={() =>
                          void copyFoodsToDate(
                            `meal:${prevDate}:${mealKey}`,
                            prevMealEntries.map((r) => r.data),
                            mealKey,
                            `已复刻昨日${mealLabel}（${prevMealEntries.length} 项）`,
                          )
                        }
                      >
                        <Icon name="copy" size={14} /> 同昨日
                      </button>
                    ) : null}
                    {entries.length ? (
                      <button
                        type="button"
                        className="quiet"
                        title="将本餐组合存为常用餐单"
                        onClick={() => openSaveMealTemplateModal({ meal: mealKey, entries })}
                      >
                        <Icon name="bookmark" size={14} /> 存餐单
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button meal-add-btn"
                      aria-label={`记录${mealLabel}`}
                      onClick={() => openDietEditor({ date, meal: mealKey, recentFoods })}
                    >
                      <Icon name="plus" size={15} /> 添加
                    </button>
                  </div>
                </header>

                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="record-line"
                    onClick={() => openDietEditor({ record: entry, recentFoods })}
                  >
                    <span className="record-icon">
                      <Icon name="diet" />
                    </span>
                    <span>
                      <strong>{entry.data.name}</strong>
                      {entry.data.protein > 0 || entry.data.carbs > 0 || entry.data.fat > 0 ? (
                        <small className="food-macro-sub">
                          蛋 {fmt(entry.data.protein, 0)}g · 碳 {fmt(entry.data.carbs, 0)}g · 脂 {fmt(entry.data.fat, 0)}g
                        </small>
                      ) : null}
                    </span>
                    <span className="record-number">{fmt(entry.data.calories)} kcal</span>
                    <Icon name="chevron" size={15} />
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      <section className="panel meal-templates-panel" style={{ marginTop: 14 }}>
        <header className="panel-head">
          <div>
            <h2>常用餐单模板</h2>
            <p>
              {templates.length
                ? `已存 ${templates.length} 套搭配`
                : "在上方任意一餐点击「存餐单」，日后可整餐复刻"}
            </p>
          </div>
        </header>

        {templates.length ? (
          <div className="meal-tpl-grid">
            {templates.map((tpl) => {
              const foods = tpl.data.foods ?? [];
              const kcal = Math.round(foods.reduce((s, f) => s + f.calories, 0));
              const prot = Math.round(foods.reduce((s, f) => s + f.protein, 0));
              return (
                <article key={tpl.id} className="meal-tpl-card">
                  <header>
                    <div>
                      <strong>{tpl.data.name}</strong>
                      <small>
                        {foods.length} 项 · {fmt(kcal, 0)} kcal · 蛋白 {prot}g
                      </small>
                    </div>
                    <div className="meal-tpl-card-ops">
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => openEditMealTemplateModal(tpl)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="quiet icon-button"
                        aria-label="删除餐单"
                        onClick={() =>
                          openConfirm({
                            title: "删除常用餐单",
                            message: `确定要删除餐单「${tpl.data.name}」吗？此操作不可撤销。`,
                            confirmLabel: "删除餐单",
                            onConfirm: async () => {
                              await apiFetch("/api/records", {
                                method: "POST",
                                body: {
                                  opId: safeUuid(),
                                  id: tpl.id,
                                  kind: "mealTemplate",
                                  baseVersion: tpl.version,
                                  deleted: true,
                                  data: tpl.data,
                                },
                              });
                              bumpDataEpoch();
                              notify(`已删除餐单「${tpl.data.name}」`);
                            },
                          })
                        }
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                  </header>
                  <p className="meal-tpl-foods">{foods.map((f) => f.name).join("、")}</p>
                  <div className="meal-tpl-apply-row" role="group" aria-label="添加到餐次">
                    {(Object.entries(MEALS) as Array<[MealKey, string]>).map(([mKey, mLabel]) => (
                      <button
                        key={mKey}
                        type="button"
                        className="micro-chip"
                        disabled={copying}
                        onClick={() =>
                          void copyFoodsToDate(
                            `template:${tpl.id}:${mKey}`,
                            foods,
                            mKey,
                            `已将「${tpl.data.name}」填入${mLabel}`,
                          )
                        }
                      >
                        +{mLabel}
                      </button>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );
}
