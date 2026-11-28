import { useEffect, useState } from "react";
import {
  BADGE_TIER_LABELS,
  formatBadgeProgressPct,
  getPinnedBadges,
  pinnedBadgesKey,
  togglePinnedBadgeResult,
  type BadgeItem,
} from "../../lib/badges";
import { fmt } from "../../lib/date";
import { triggerHaptic } from "../../lib/haptics-audio";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";
import { DotMeter } from "../Meters";

export function BadgeDetailModal({
  badge,
  onPinnedChange,
  allBadges,
}: {
  badge: BadgeItem;
  onPinnedChange?: (pinned: string[]) => void;
  allBadges?: BadgeItem[];
}) {
  const userId = useAuthStore((s) => s.userId);
  const notify = useUiStore((s) => s.notify);

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => getPinnedBadges(userId));
  const [choosingReplace, setChoosingReplace] = useState(false);

  // #204: Stay synced with cross-tab native storage events & same-tab custom events
  useEffect(() => {
    setPinnedIds(getPinnedBadges(userId));
    const key = pinnedBadgesKey(userId);
    const onCustom = () => setPinnedIds(getPinnedBadges(userId));
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === null || ev.key === key) setPinnedIds(getPinnedBadges(userId));
    };
    window.addEventListener("ironlog-pinned-badges-change", onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ironlog-pinned-badges-change", onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  const pctText = formatBadgeProgressPct(badge);
  const isPinned = pinnedIds.includes(badge.id);
  const titleOf = (id: string) => allBadges?.find((b) => b.id === id)?.title ?? id;

  const commitTogglePin = (replaceId?: string) => {
    triggerHaptic("light");
    const res = togglePinnedBadgeResult(userId, badge.id, { replaceId });
    // #203: Never pretend save succeeded when localStorage throws
    if (!res.ok) {
      notify("保存徽章佩戴失败，请检查浏览器存储权限或释放空间后重试");
      return;
    }
    setChoosingReplace(false);
    setPinnedIds(res.pinned);
    onPinnedChange?.(res.pinned);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ironlog-pinned-badges-change", { detail: { userId, pinned: res.pinned } }));
    }
    if (res.pinned.includes(badge.id)) {
      notify(
        res.replacedId
          ? `已将「${badge.title}」佩戴至首页，并替换「${titleOf(res.replacedId)}」`
          : `已将「${badge.title}」佩戴至首页`,
      );
    } else {
      notify("已取消首页佩戴");
    }
  };

  const handleTogglePin = () => {
    if (!isPinned && pinnedIds.length >= 3) {
      setChoosingReplace(true);
      return;
    }
    commitTogglePin();
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
                {fmt(badge.current)} / {fmt(badge.target)} {badge.unit} · {pctText}
              </b>
            </div>
          </div>
        </div>
        {badge.unlocked ? (
          <div className="badge-modal-actions" style={{ flexDirection: "column", gap: 8 }}>
            {choosingReplace ? (
              <div style={{ display: "grid", gap: 6, width: "100%" }}>
                <small className="muted">首页已佩戴 3 枚徽章，请选择要替换的一枚：</small>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {pinnedIds.map((pid) => (
                    <button
                      key={pid}
                      type="button"
                      className="secondary-button"
                      onClick={() => commitTogglePin(pid)}
                    >
                      替换「{titleOf(pid)}」
                    </button>
                  ))}
                  <button type="button" className="quiet" onClick={() => setChoosingReplace(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={isPinned ? "secondary-button is-pinned" : "primary-button"}
                onClick={handleTogglePin}
              >
                <Icon name="bookmark" size={15} />{" "}
                {isPinned ? "取消首页佩戴" : "佩戴到首页展示（最多 3 枚）"}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
