import { useEffect, useMemo, useRef, useState } from "react";
import { MiniSparkline, WeightChart } from "../components/Charts";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { PageHeading, WorkspaceTabs } from "../components/WorkspaceTabs";
import { ProgressPhotosPanel } from "../components/weight/ProgressPhotosPanel";
import { displayWeekday, fmt, shortDate, today } from "../lib/date";
import {
  MEASUREMENT_SPECS,
  shiftDateStr,
  type MeasurementEntry,
  type ProfileGoals,
  type RecordEnvelope,
  type WeightData,
} from "../lib/domain";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import { openMeasurementModal, openWeightEditor } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

interface WeightViewSnap {
  records: Array<RecordEnvelope<WeightData>>;
  measurements: MeasurementEntry[];
  goals: ProfileGoals | null;
}

export function WeightView() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const cached = peekQuery<WeightViewSnap>("view:weight", userId)?.data;

  const [records, setRecords] = useState<Array<RecordEnvelope<WeightData>>>(() => cached?.records ?? []);
  const [measurements, setMeasurements] = useState<MeasurementEntry[]>(() => cached?.measurements ?? []);
  const [goals, setGoals] = useState<ProfileGoals | null>(() => cached?.goals ?? null);
  const [shownWeights, setShownWeights] = useState(12);
  const [shownMeasures, setShownMeasures] = useState(8);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState("");
  const lastUserRef = useRef(userId);

  useEffect(() => {
    let active = true;
    const userChanged = lastUserRef.current !== userId;
    lastUserRef.current = userId;
    const hit = peekQuery<WeightViewSnap>("view:weight", userId)?.data;
    if (userChanged) {
      if (hit) {
        setRecords(hit.records);
        setMeasurements(hit.measurements);
        setGoals(hit.goals);
        setLoading(false);
      } else {
        setRecords([]);
        setMeasurements([]);
        setGoals(null);
        setLoading(true);
      }
    } else if (!hit) {
      setLoading(true);
    }
    setError("");
    void Promise.all([
      cachedApiFetch<Array<RecordEnvelope<WeightData>>>("/api/records/weight", { epoch: dataEpoch, userId }),
      cachedApiFetch<MeasurementEntry[]>("/api/web/measurements", { epoch: dataEpoch, userId })
        .then((v) => ({ ok: true as const, v }))
        .catch(() => ({ ok: false as const, v: null })),
      cachedApiFetch<{ profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId })
        .then((v) => ({ ok: true as const, v }))
        .catch(() => ({ ok: false as const, v: null })),
    ])
      .then(([weightRows, measureRes, profRes]) => {
        if (!active) return;
        const sorted = weightRows
          .filter((r) => !r.deleted)
          .sort((a, b) => b.data.date.localeCompare(a.data.date) || b.updatedAt.localeCompare(a.updatedAt));
        setRecords(sorted);
        if (measureRes.ok && measureRes.v) setMeasurements(measureRes.v);
        if (profRes.ok && profRes.v) setGoals(profRes.v.profile ?? null);
        if (measureRes.ok && profRes.ok) {
          const nextSnap: WeightViewSnap = {
            records: sorted,
            measurements: measureRes.v ?? [],
            goals: profRes.v?.profile ?? null,
          };
          writeQueryCache("view:weight", nextSnap, { userId, epoch: dataEpoch });
        }
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载体重数据失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  const todayKey = today();
  const latestRecord = records[0];
  const latest = latestRecord?.data;
  const todayRecord = records.find((r) => r.id === `weight_${todayKey}`);
  const todayMeasurement = useMemo(() => measurements.find((m) => m.date === todayKey) ?? null, [measurements, todayKey]);
  const weightGoal = goals?.targetWeight ?? null;
  const heightCm = goals?.energyProfile?.heightCm ?? null;

  const [chartRange, setChartRange] = useState<30 | 90 | 180 | 0>(30);
  const earliestWeightDate = records.at(-1)?.data.date ?? shiftDateStr(todayKey, -29);
  const rangeStart = chartRange === 0 ? earliestWeightDate : shiftDateStr(todayKey, -(chartRange - 1));
  const { recentWithAvg, change30d } = useMemo(() => {
    // #192: Include 6 extra lookback days before rangeStart when computing 7-day rolling average
    // so the same date displays an identical 7d average across 30/90/180d chart ranges.
    const lookbackStart = shiftDateStr(rangeStart, -6);
    const byDay = new Map<string, WeightData>();
    for (const r of records) {
      if (r.data.date >= lookbackStart && r.data.date <= todayKey && !byDay.has(r.data.date)) {
        byDay.set(r.data.date, r.data);
      }
    }
    const ascAll = [...byDay.values()].reverse();
    let left = 0;
    let winSum = 0;
    const allWithAvg = ascAll.map((row, idx) => {
      winSum += row.weight;
      const winStart = shiftDateStr(row.date, -6);
      while (left <= idx && (ascAll[left]?.date ?? "") < winStart) {
        winSum -= ascAll[left++]?.weight ?? 0;
      }
      const sampleCount = Math.max(1, idx - left + 1);
      return {
        date: row.date,
        weight: row.weight,
        average: Math.round((winSum / sampleCount) * 100) / 100,
        avgSamples: sampleCount,
      };
    });
    const visible = allWithAvg.filter((row) => row.date >= rangeStart);
    const diff =
      visible.length > 1 ? Math.round((visible.at(-1)!.weight - visible[0]!.weight) * 100) / 100 : null;
    return { recentWithAvg: visible, change30d: diff };
  }, [records, rangeStart, todayKey]);

  const byMonth = useMemo(() => {
    const map = new Map<string, Array<RecordEnvelope<WeightData>>>();
    for (const r of records.slice(0, shownWeights)) {
      const m = r.data.date.slice(0, 7);
      const list = map.get(m) ?? [];
      list.push(r);
      map.set(m, list);
    }
    return map;
  }, [records, shownWeights]);

  // Body ratios WHR / WHtR (#193: same-day paired waist+hip for WHR; #194: unrounded WHtR threshold + precision near 0.50)
  const { whr, whrDate, whrUnpaired, whtr, ascMeasures } = useMemo(() => {
    const asc = [...measurements].reverse();
    let latestWaist: { value: number; date: string } | null = null;
    let latestHip: { value: number; date: string } | null = null;
    let pairedWhr: { value: number; date: string } | null = null;
    for (const row of asc) {
      if (row.waistCm != null) latestWaist = { value: row.waistCm, date: row.date };
      if (row.hipCm != null) latestHip = { value: row.hipCm, date: row.date };
      if (row.waistCm != null && row.hipCm != null && row.hipCm > 0) {
        pairedWhr = { value: row.waistCm / row.hipCm, date: row.date };
      }
    }
    return {
      whr: pairedWhr?.value ?? null,
      whrDate: pairedWhr?.date ?? null,
      whrUnpaired: !pairedWhr && latestWaist && latestHip ? { waistDate: latestWaist.date, hipDate: latestHip.date } : null,
      whtr: latestWaist && heightCm ? latestWaist.value / heightCm : null,
      ascMeasures: asc,
    };
  }, [measurements, heightCm]);

  const formatWhtr = (ratio: number) => (Math.abs(ratio - 0.5) < 0.01 ? ratio.toFixed(3) : ratio.toFixed(2));

  const measurementsPanel = (
    <section className="panel measurements-panel" aria-label="身体围度档案">
      <header className="panel-head">
        <div>
          <h2>身体围度档案</h2>
          <p>
            {measurements.length
              ? `已记 ${measurements.length} 次围度 · 追踪腰围与各部位变化`
              : "记录腰围、胸围、臂围、大腿围与臀围（cm）"}
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => openMeasurementModal(todayMeasurement, measurements)}>
          <Icon name="plus" size={15} /> {todayMeasurement ? "更新今日围度" : "记录围度"}
        </button>
      </header>

      {measurements.length ? (
        <>
          {whr || whtr || whrUnpaired ? (
            <div className="measure-ratios">
              {whr ? (
                <span className="measure-ratio-chip" title={whrDate ? `同日测量：${whrDate}` : undefined}>
                  腰臀比 WHR <b>{whr.toFixed(2)}</b>
                  {whrDate ? <small>{shortDate(whrDate)}</small> : null}
                </span>
              ) : whrUnpaired ? (
                <span className="measure-ratio-chip" title="腰围与臀围来自不同日期，建议同日测量后计算腰臀比">
                  腰臀比 WHR <small>缺同日配对（腰 {shortDate(whrUnpaired.waistDate)} / 臀 {shortDate(whrUnpaired.hipDate)}）</small>
                </span>
              ) : null}
              {whtr ? (
                <span className={`measure-ratio-chip${whtr < 0.5 ? " is-good" : " is-warn"}`}>
                  腰高比 WHtR <b>{formatWhtr(whtr)}</b>
                  <small>{whtr < 0.5 ? "健康区间" : "偏高"}</small>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="measure-tiles">
            {MEASUREMENT_SPECS.map(([key, label]) => {
              const vals = ascMeasures.map((r) => r[key]).filter((v): v is number => v != null);
              const firstVal = vals[0] ?? null;
              const latestVal = vals.at(-1) ?? null;
              const diff =
                latestVal != null && firstVal != null && vals.length > 1
                  ? Math.round((latestVal - firstVal) * 10) / 10
                  : null;
              const diffCls =
                diff == null
                  ? ""
                  : key === "waistCm"
                    ? diff < 0
                      ? " is-good"
                      : diff > 0
                        ? " is-warn"
                        : ""
                    : diff > 0
                      ? " is-up"
                      : diff < 0
                        ? " is-down"
                        : "";
              return (
                <div key={key} className="measure-tile">
                  <span>{label}</span>
                  <strong>
                    {latestVal != null ? (
                      <>
                        {fmt(latestVal, 1)} <small>cm</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </strong>
                  <MiniSparkline values={vals} />
                  <small className={`measure-diff${diffCls}`}>
                    {diff != null ? `${diff > 0 ? "+" : ""}${fmt(diff, 1)} cm` : "暂无对比"}
                  </small>
                </div>
              );
            })}
          </div>

          <div className="measure-history-list">
            {measurements.slice(0, shownMeasures).map((m) => {
              const parts = MEASUREMENT_SPECS.filter(([k]) => m[k] != null).map(([k, lbl]) => `${lbl} ${fmt(m[k], 1)}`);
              return (
                <button
                  key={m.date}
                  type="button"
                  className="record-line measure-line"
                  onClick={() => openMeasurementModal(m, measurements)}
                >
                  <time dateTime={m.date}>{shortDate(m.date)}</time>
                  <span>
                    <strong>{parts.join(" · ")}</strong>
                    {m.notes ? <small>{m.notes}</small> : null}
                  </span>
                  <Icon name="chevron" size={15} />
                </button>
              );
            })}
            {measurements.length > shownMeasures ? (
              <button
                type="button"
                className="quiet"
                style={{ justifySelf: "start" }}
                onClick={() => setShownMeasures((c) => c + 10)}
              >
                查看更多围度（剩余 {measurements.length - shownMeasures} 条）
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );

  return (
    <>
      <WorkspaceTabs />
      <PageHeading
        title="体重记录"
        view="weight"
        controls={
          <div className="heading-actions">
            <button type="button" className="secondary-button" onClick={() => openMeasurementModal(todayMeasurement, measurements)}>
              <Icon name="plus" size={16} /> {todayMeasurement ? "更新今日围度" : "记围度"}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                openWeightEditor({
                  record: todayRecord,
                  defaultWeight: latest?.weight ?? null,
                })
              }
            >
              <Icon name={todayRecord ? "weight" : "plus"} />
              {todayRecord ? "更新今日体重" : "记体重"}
            </button>
          </div>
        }
      />

      {error && records.length > 0 ? (
        <div className="form-error" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
          <span>刷新体重数据失败：{error}</span>
          <button type="button" className="quiet" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      ) : null}

      {error && records.length === 0 ? (
        <div className="empty">
          <strong>体重数据加载失败</strong>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={bumpDataEpoch}>
            重试
          </button>
        </div>
      ) : loading && records.length === 0 ? (
        <div className="skeleton-list">
          <div className="skeleton-block skeleton-row" />
        </div>
      ) : latest ? (
        <>
          <div className="weight-layout">
            <section className="panel weight-summary">
              <header className="panel-head">
                <div>
                  <h2>最近一次称重</h2>
                  <p>
                    <time dateTime={latest.date}>{latest.date}</time>
                  </p>
                </div>
                <span className="status-pill">最新</span>
              </header>
              <div className="weight-number">
                <strong>
                  <MatrixText value={fmt(latest.weight, 1)} />
                </strong>
                <span>kg</span>
              </div>
              <dl className="weight-facts">
                <div>
                  <dt>{chartRange === 0 ? "全周期变化" : `近 ${chartRange} 天变化`}</dt>
                  <dd>
                    {change30d === null ? "—" : `${change30d > 0 ? "+" : ""}${fmt(change30d, 2)} kg`}
                  </dd>
                </div>
                {weightGoal ? (
                  <div>
                    <dt>目标体重</dt>
                    <dd>{fmt(weightGoal, 2)} kg</dd>
                  </div>
                ) : null}
                {latest.bodyFat != null ? (
                  <div>
                    <dt>体脂率</dt>
                    <dd>{fmt(latest.bodyFat)}%</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="panel weight-trend">
              <header className="panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h2>{chartRange === 0 ? "全部体重趋势" : `近 ${chartRange} 天趋势`}</h2>
                  <p>
                    {shortDate(rangeStart)} – {shortDate(todayKey)} · {recentWithAvg.length} 天有称重
                  </p>
                </div>
                <div className="segments" role="group" aria-label="体重趋势周期">
                  {(
                    [
                      [30, "30天"],
                      [90, "90天"],
                      [180, "180天"],
                      [0, "全部"],
                    ] as const
                  ).map(([days, lbl]) => (
                    <button key={days} type="button" aria-pressed={chartRange === days} onClick={() => setChartRange(days)}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </header>
              {recentWithAvg.length ? (
                <WeightChart
                  rows={recentWithAvg}
                  from={rangeStart}
                  to={todayKey}
                  goal={weightGoal}
                  showAverage={recentWithAvg.length >= 2}
                />
              ) : (
                <p className="weight-chart-empty muted">
                  {chartRange === 0 ? "暂无称重记录。" : `最近 ${chartRange} 天暂无称重记录。`}
                </p>
              )}
              {recentWithAvg.length && (recentWithAvg.length >= 2 || weightGoal) ? (
                <footer className="panel-foot">
                  {[
                    recentWithAvg.length >= 2 ? "虚线 7 日滚动均值" : null,
                    weightGoal ? "灰虚线为目标体重" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </footer>
              ) : null}
            </section>

            <section className="weight-history" aria-label="称重历史">
              <h2>称重历史</h2>
              {[...byMonth].map(([month, rows]) => (
                <section key={month} className="weight-month">
                  <header className="weight-month-head">
                    <h3>
                      {month.slice(0, 4)} 年 {Number(month.slice(5))} 月
                    </h3>
                    <span>{rows.length} 条</span>
                  </header>
                  <div className="weight-log">
                    {rows.map((rec) => (
                      <button
                        key={rec.id}
                        type="button"
                        className="record-line weight-line"
                        onClick={() => openWeightEditor({ record: rec })}
                      >
                        <time dateTime={rec.data.date}>
                          {shortDate(rec.data.date)} <small>{displayWeekday(rec.data.date)}</small>
                        </time>
                        <strong>
                          {fmt(rec.data.weight, 2)} <span>kg</span>
                        </strong>
                        <span>{rec.data.bodyFat == null ? "" : `体脂 ${fmt(rec.data.bodyFat)}%`}</span>
                        <Icon name="chevron" size={15} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {records.length > shownWeights ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShownWeights((n) => n + 12)}
                >
                  查看更多记录
                </button>
              ) : null}
            </section>
          </div>
          {measurementsPanel}
          <ProgressPhotosPanel />
        </>
      ) : (
        <>
          {measurementsPanel}
          <ProgressPhotosPanel />
          <div className="empty">
            <strong>还没有体重记录</strong>
            <p>添加一次称重，即可开始查看变化。</p>
          </div>
        </>
      )}
    </>
  );
}
