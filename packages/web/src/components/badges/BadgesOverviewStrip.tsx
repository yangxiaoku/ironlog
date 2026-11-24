import { filterVisibleBadges, getPinnedBadges, selectOverviewBadges, type BadgeSummary } from "../../lib/badges";
import { openBadgeDetailModal } from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export function BadgesOverviewStrip({ rawSummary }: { rawSummary: BadgeSummary | null }) {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const navigate = useUiStore((s) => s.navigate);

  if (!rawSummary?.badges?.length) return null;
  const summary = filterVisibleBadges(rawSummary, appleHealthConnected);
  const pinnedIds = getPinnedBadges(userId);
  const pinnedSet = new Set(pinnedIds);
  const featured = selectOverviewBadges(summary, pinnedIds);
  if (!featured.length) return null;

  return (
    <section className="panel badges-strip" aria-label="成就徽章摘要">
      <header className="panel-head">
        <div className="badges-strip-title">
          <h2>成就徽章</h2>
          <span className="atlas-pill">
            {summary.earnedCount} / {summary.totalCount}
          </span>
        </div>
        <button type="button" className="quiet" onClick={() => navigate("badges")}>
          全部徽章 <Icon name="chevron" size={16} />
        </button>
      </header>
      <div className="badges-strip-grid">
        {featured.map((badge) => {
          const isPinned = badge.unlocked && pinnedSet.has(badge.id);
          return (
            <button
              key={badge.id}
              type="button"
              className={`badge-mini${badge.unlocked ? " is-unlocked" : " is-locked"}${isPinned ? " is-pinned" : ""}`}
              onClick={() => openBadgeDetailModal(badge)}
            >
              {isPinned ? <span className="badge-mini-pin">佩戴</span> : null}
              <span className="badge-mini-art">
                <img src={`/app/badge-${badge.id}.png`} width={76} height={76} loading="lazy" decoding="async" alt="" />
              </span>
              <strong>{badge.title}</strong>
              <small>{badge.unlocked ? "已点亮" : `${Math.round(badge.progress * 100)}%`}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
