import { useState } from "react";
import { BADGE_TIER_LABELS, getPinnedBadges, togglePinnedBadge, type BadgeItem } from "../../lib/badges";
import { fmt } from "../../lib/date";
import { triggerHaptic } from "../../lib/haptics-audio";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";
import { DotMeter } from "../Meters";

export function BadgeDetailModal({
  badge,
  onPinnedChange,
}: {
  badge: BadgeItem;
  onPinnedChange?: (pinned: string[]) => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => getPinnedBadges(userId));

  const pct = Math.round(badge.progress * 100);
  const isPinned = pinnedIds.includes(badge.id);

  const handleTogglePin = () => {
    triggerHaptic("light");
    const next = togglePinnedBadge(userId, badge.id);
    setPinnedIds(next);
    onPinnedChange?.(next);
    bumpDataEpoch();
    notify(next.includes(badge.id) ? `已将「${badge.title}」佩戴至首页` : "已取消首页佩戴");
  };

  return (
    <div className={`dialog-form badge-modal${badge.unlocked ? " is-unlocked" : " is-locked"}`}>
      <div className="badge-stage">
        <span className="crosshair tl" aria-hidden="true" />
        <span className="crosshair br" aria-hidden="true" />
        <div className="badge-stage-ring">
          <img src={`/app/badge-${badge.id}.png`} width={210} height={210} alt={badge.title} />
        </div>
        <span className="badge-stage-status">
          <i />
          {badge.unlocked
            ? `已解锁${badge.unlockedAt ? ` · ${badge.unlockedAt.replace(/-/g, ".")}` : ""}`
            : "待解锁"}
        </span>
      </div>

      <div className="badge-modal-info">
        <div className="badge-modal-meta">
          <span>{badge.categoryLabel}</span>
          <span>{BADGE_TIER_LABELS[badge.tier] ?? ""}</span>
        </div>
        <h3>{badge.title}</h3>
        <p>{badge.subtitle}</p>
        <div className="badge-rule-box">
          <span>达成条件</span>
          <strong>{badge.rule}</strong>
          <div className="badge-modal-progress">
            <DotMeter ratio={badge.progress} count={20} />
            <div>
              <span>当前进度</span>
              <b>
                {fmt(badge.current)} / {fmt(badge.target)} {badge.unit} · {pct}%
              </b>
            </div>
          </div>
        </div>
        {badge.unlocked ? (
          <div className="badge-modal-actions">
            <button
              type="button"
              className={isPinned ? "secondary-button is-pinned" : "primary-button"}
              onClick={handleTogglePin}
            >
              <Icon name="bookmark" size={15} />{" "}
              {isPinned ? "取消首页佩戴" : "佩戴到首页展示（最多 3 枚）"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
