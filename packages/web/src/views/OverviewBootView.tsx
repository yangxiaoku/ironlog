import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { apiFetch } from "../lib/api";
import { duration, fmt, shortDate, today } from "../lib/date";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

interface OverviewStatsResponse {
  from: string;
  through: string;
  today: string;
  period: number;
  totals: {
    workouts: number;
    activities?: number;
    volume: number;
    sets: number;
    timedWorkouts?: number;
    seconds: number;
  };
  previous: {
    workouts: number;
    activities?: number;
    volume: number;
    sets: number;
  };
  weights?: Array<{ date: string; weight: number }>;
  recent?: Array<{
    id: string;
    title: string;
    date: string;
    duration: number | null;
    feeling?: string | null;
    sets: number;
    volume: number;
  }>;
  goals?: { targetWeight?: number | null };
}

interface TodayResponse {
  date: string;
  active?: { id: string; title: string; done: number; total: number } | null;
  planned?: { id: string; date: string; name: string; exercises: number } | null;
  completed?: number;
  restToday?: boolean;
  weight?: number | null;
  nutrition: { count: number; calories: number; target: number; complete?: boolean };
}

function DeltaLabel({
  value,
  previous,
  suffix,
}: {
  value: number;
  previous: number;
  suffix: string;
}) {
  if (!previous && !value) return <span className="comparison">暂无对比</span>;
  const diff = value - previous;
  if (diff === 0) return <span className="comparison">与上期持平</span>;
  const positive = diff > 0;
  return (
    <span className={`comparison${positive ? " gain" : ""}`}>
      {positive ? "↑ +" : "↓ "}
      {fmt(diff)}
      {suffix}
    </span>
  );
}

export function OverviewBootView() {
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const demo = useAuthStore((s) => s.demo);
  const logout = useAuthStore((s) => s.logout);

  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);
  const navigate = useUiStore((s) => s.navigate);

  const [stats, setStats] = useState<OverviewStatsResponse | null>(null);
  const [day, setDay] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const through = today();
    setLoading(true);
    setError("");
    void Promise.all([
      apiFetch<OverviewStatsResponse>(`/api/web/statistics?through=${encodeURIComponent(through)}`),
      apiFetch<TodayResponse>("/api/web/today").catch(() => null),
    ])
      .then(([statsRes, todayRes]) => {
        if (!active) return;
        setStats(statsRes);
        setDay(todayRes);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error)?.message || "加载统计数据失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  if (loading && !stats) {
    return (
      <div className="skeleton-page" role="status" aria-label="正在加载首页工作台">
        <div className="skeleton-block skeleton-hero" />
        <div className="skeleton-kpis">
          <div className="skeleton-block skeleton-kpi" />
          <div className="skeleton-block skeleton-kpi" />
        </div>
        <div className="skeleton-list">
          <div className="skeleton-block skeleton-row" />
          <div className="skeleton-block skeleton-row" />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="empty">
        <strong>首页数据暂时无法加载</strong>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={bumpDataEpoch}>
          重新加载
        </button>
      </div>
    );
  }

  const todayKey = stats?.today ?? today();
  const activities = stats?.totals.activities ?? stats?.totals.workouts ?? 0;
  const prevActivities = stats?.previous.activities ?? stats?.previous.workouts ?? 0;
  const latestWeight = day?.weight ?? stats?.weights?.at(-1)?.weight ?? null;

  const trainingHeadline = day?.active
    ? `进行中：${day.active.title}（${day.active.done}/${day.active.total} 组）`
    : day?.planned?.date === todayKey
      ? `今日计划：${day.planned.name}（${day.planned.exercises} 个动作）`
      : day?.completed
        ? `今日已完成 ${day.completed} 次训练`
        : day?.restToday
          ? "今日休息 · 主动恢复"
          : "自由训练准备就绪";

  return (
    <>
      <div className="overview-lead">
        <section className="hero">
          <span className="vf-c tl" aria-hidden="true" />
          <span className="vf-c tr" aria-hidden="true" />
          <span className="vf-c bl" aria-hidden="true" />
          <span className="vf-c br" aria-hidden="true" />
          <div className="hero-top">
            <time className="hero-date" dateTime={todayKey}>
              <strong>
                <MatrixText value={todayKey.slice(8)} />
              </strong>
              <span>{todayKey.slice(0, 7).replace("-", ".")}</span>
            </time>
            <div className="hero-top-actions">
              <button
                type="button"
                className="quiet hero-share-btn"
                onClick={() => {
                  bumpDataEpoch();
                  notify("已向服务端刷新最新训练数据");
                }}
              >
                <Icon name="refresh" size={14} /> 刷新数据
              </button>
              <div className="hero-status">
                <i />
                {demo ? "演示 · React 架构" : `${username || "训练日志"} · React`}
              </div>
            </div>
          </div>

          <div className="hero-inner">
            <h1>今天</h1>
            <button type="button" className="hero-sublink" onClick={() => navigate("workout")}>
              <span>{trainingHeadline}</span>
              <Icon name="chevron" size={15} />
            </button>
            <div className="phase-summary-grid">
              <div className="phase-summary-tile">
                <span>今日摄入</span>
                <strong>
                  {day?.nutrition.count
                    ? `${fmt(day.nutrition.calories, 0)} / ${fmt(day.nutrition.target, 0)} kcal`
                    : "暂无记录"}
                </strong>
              </div>
              <div className="phase-summary-tile">
                <span>最近体重</span>
                <strong>{latestWeight != null ? `${fmt(latestWeight, 1)} kg` : "暂无称重"}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>阶段一基座已就绪</h2>
              <p>Vite + React 19 + TS + Zustand + PWA 已对接真实 API</p>
            </div>
            <button
              type="button"
              className="quiet"
              onClick={() =>
                openConfirm({
                  title: "退出账号",
                  message: "确认退出当前账号并返回登录页吗？",
                  confirmLabel: "退出登录",
                  onConfirm: () => logout(),
                })
              }
            >
              退出账号
            </button>
          </header>
          <p className="muted">
            当前正在运行 React 前端架构基座（分支 <code>feat/react-frontend</code>），底部与侧栏导航、安全区适配、Web Audio/触感反馈、移动端弹窗历史栈及真实后端统计接口均已打通。
          </p>
        </section>
      </div>

      {stats ? (
        <>
          <div className="section-bar stats-header">
            <div>
              <h2>训练表现</h2>
              <p>
                {shortDate(stats.from)} – {shortDate(stats.through)}（近 {stats.period} 天）
              </p>
            </div>
          </div>

          <div className="kpis">
            <article className="kpi">
              <div>
                <span>完成训练</span>
              </div>
              <strong>
                <span className="kpi-num">
                  <MatrixText value={fmt(activities)} />
                </span>
                <small>次</small>
              </strong>
              <DeltaLabel value={activities} previous={prevActivities} suffix=" 次" />
            </article>

            <article className="kpi">
              <div>
                <span>训练容量</span>
              </div>
              <strong>
                <span className="kpi-num">
                  <MatrixText value={fmt(stats.totals.volume)} />
                </span>
                <small>kg</small>
              </strong>
              <DeltaLabel value={stats.totals.volume} previous={stats.previous.volume} suffix=" kg" />
            </article>

            <article className="kpi">
              <div>
                <span>完成组数</span>
              </div>
              <strong>
                <span className="kpi-num">
                  <MatrixText value={fmt(stats.totals.sets)} />
                </span>
                <small>组</small>
              </strong>
              <DeltaLabel value={stats.totals.sets} previous={stats.previous.sets} suffix=" 组" />
            </article>

            <article className="kpi">
              <div>
                <span>训练时长</span>
              </div>
              <strong>
                <span className="kpi-num">
                  <MatrixText value={stats.totals.timedWorkouts ? fmt(stats.totals.seconds / 3600, 1) : "—"} />
                </span>
                <small>h</small>
              </strong>
              <span className="comparison">
                {stats.totals.timedWorkouts
                  ? `均次 ${duration(stats.totals.seconds / stats.totals.timedWorkouts)}`
                  : "暂无时长"}
              </span>
            </article>
          </div>
        </>
      ) : null}
    </>
  );
}
