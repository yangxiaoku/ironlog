import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { MatrixText } from "../components/MatrixText";
import { DotMeter } from "../components/Meters";
import { apiFetch } from "../lib/api";
import {
  BADGE_TIER_LABELS,
  filterVisibleBadges,
  getPinnedBadges,
  type BadgeSummary,
} from "../lib/badges";
import { fmt } from "../lib/date";
import { openBadgeDetailModal } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

export function BadgesView() {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);

  const [rawSummary, setRawSummary] = useState<BadgeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"all" | "unlocked" | "chasing">("all");
  const [query, setQuery] = useState("");
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => getPinnedBadges(userId));

  useEffect(() => {
    setPinnedIds(getPinnedBadges(userId));
  }, [userId, dataEpoch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void apiFetch<BadgeSummary>("/api/web/badges")
      .then((res) => {
        if (active) setRawSummary(res);
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载成就徽章失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  if (loading && !rawSummary) {
    return (
      <div className="empty loading" role="status">
        正在加载成就徽章库…
      </div>
    );
  }

  if (error && !rawSummary) {
    return (
      <div className="empty">
        <strong>成就徽章加载失败</strong>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={bumpDataEpoch}>
          重试
        </button>
      </div>
    );
  }

  if (!rawSummary) return null;

  const summary = filterVisibleBadges(rawSummary, appleHealthConnected);
  const { earnedCount, totalCount, categories, badges } = summary;
  const ratio = totalCount ? earnedCount / totalCount : 0;
  const pinnedSet = new Set(pinnedIds);
  const q = query.trim().toLowerCase();
  const visibleCategories = category ? categories.filter((cat) => cat.key === category) : categories;

  const sections = visibleCategories
    .map((cat) => {
      let items = badges.filter((item) => item.category === cat.key);
      if (status === "unlocked") items = items.filter((item) => item.unlocked);
      else if (status === "chasing") {
        items = items.filter((item) => !item.unlocked).sort((a, b) => b.progress - a.progress);
      }
      if (q) {
        items = items.filter((item) =>
          [item.title, item.subtitle, item.rule, item.categoryLabel].some((txt) =>
            String(txt ?? "").toLowerCase().includes(q),
          ),
        );
      }
      return { cat, items };
    })
    .filter(({ items }) => items.length > 0);

  return (
    <>
      <header className="page-heading masthead-badges">
        <span className="vf-c tl" aria-hidden="true" />
        <span className="vf-c tr" aria-hidden="true" />
        <span className="vf-c bl" aria-hidden="true" />
        <span className="vf-c br" aria-hidden="true" />
        <div>
          <h1>成就徽章</h1>
          <p>力量突破、连续坚持、总容量积累与体能成就图鉴</p>
        </div>
      </header>

      <section className="panel badge-overview-band">
        <div className="badge-band-main">
          <div>
            <span className="badge-band-label">收集进度</span>
            <strong>
              <MatrixText value={String(earnedCount).padStart(2, "0")} /> <small>/ {totalCount} 枚</small>
            </strong>
          </div>
          <span className="badge-pct">{Math.round(ratio * 100)}%</span>
        </div>
        <DotMeter ratio={ratio} count={24} label={`已获得 ${earnedCount} / ${totalCount} 枚成就徽章`} />
      </section>

      <div className="muscle-pills badge-filters" role="group" aria-label="徽章分类筛选">
        <button type="button" aria-pressed={category === ""} onClick={() => setCategory("")}>
          全部 {earnedCount}/{totalCount}
        </button>
        {categories.map((cat) => (
          <button key={cat.key} type="button" aria-pressed={category === cat.key} onClick={() => setCategory(cat.key)}>
            {cat.label} {cat.earned}/{cat.total}
          </button>
        ))}
      </div>

      <div className="badge-subtoolbar">
        <div className="segments" role="group" aria-label="徽章状态筛选">
          {(
            [
              ["all", "全部"],
              ["unlocked", "已点亮"],
              ["chasing", "冲刺中"],
            ] as const
          ).map(([val, lbl]) => (
            <button key={val} type="button" aria-pressed={status === val} onClick={() => setStatus(val)}>
              {lbl}
            </button>
          ))}
        </div>
        <label className="search badge-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            enterKeyHint="search"
            maxLength={60}
            value={query}
            placeholder="搜索成就徽章名称或条件…"
            aria-label="搜索徽章"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="badge-sections">
        {sections.length ? (
          sections.map(({ cat, items }) => (
            <section key={cat.key} className="badge-section" aria-label={cat.label}>
              <header className="badge-section-head">
                <h2>{cat.label}</h2>
                <span>{items.length === cat.total ? `${cat.earned} / ${cat.total}` : `${items.length} 枚`}</span>
              </header>
              <div className="badge-grid">
                {items.map((badge) => {
                  const pct = Math.round(badge.progress * 100);
                  const pinned = badge.unlocked && pinnedSet.has(badge.id);
                  const statusText = badge.unlocked
                    ? `${badge.unlockedAt ? `${badge.unlockedAt.slice(5).replace("-", "/")} ` : ""}已点亮`
                    : `${fmt(badge.current)} / ${fmt(badge.target)} ${badge.unit}`;

                  return (
                    <button
                      key={badge.id}
                      type="button"
                      className={`badge-card${badge.unlocked ? " is-unlocked" : " is-locked"}${pinned ? " is-pinned" : ""}`}
                      onClick={() => openBadgeDetailModal(badge, setPinnedIds)}
                    >
                      <div className="badge-card-top">
                        <span className="badge-tier">{BADGE_TIER_LABELS[badge.tier] ?? ""}</span>
                        {pinned ? <span className="badge-pin-tag">已佩戴</span> : <i className="badge-dot" aria-hidden="true" />}
                      </div>
                      <div className="badge-art">
                        <img
                          src={`/app/badge-${badge.id}.png`}
                          width={128}
                          height={128}
                          loading="lazy"
                          decoding="async"
                          alt=""
                        />
                      </div>
                      <div className="badge-copy">
                        <strong>{badge.title}</strong>
                        <small>{badge.subtitle}</small>
                      </div>
                      <div className="badge-foot">
                        <DotMeter ratio={badge.progress} count={10} />
                        <span>
                          {statusText}
                          {badge.unlocked ? "" : ` · ${pct}%`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="empty">
            <strong>没有匹配的成就徽章</strong>
            <p>试试切换筛选状态或更换关键词。</p>
          </div>
        )}
      </div>
    </>
  );
}
