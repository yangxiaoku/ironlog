import { useEffect, useState, type ReactNode } from "react";
import { triggerHaptic } from "../lib/haptics-audio";
import { clearFailedMutations, getOfflineStorage, readQueue } from "../lib/offline-queue";
import { WORKOUT_PREFS_EVENT, readWorkoutPreferences } from "../lib/workout-helpers";
import { prefetchWorkspace } from "../lib/prefetch";
import { openCommandPalette } from "../lib/record-openers";
import {
  DESTINATIONS,
  MOBILE_TABS,
  MORE_WORKSPACES,
  VIEW_WORKSPACE,
  WORKSPACES,
  type WorkspaceId,
} from "../lib/routes";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";
import { Icon } from "./Icon";
import { LiveWorkoutBar } from "./LiveWorkoutBar";
import { MatrixText } from "./MatrixText";
import { MoreSheetBody } from "./MoreSheet";
import { QuickRecordSheetBody } from "./QuickRecordSheet";

const DAILY_NAV: WorkspaceId[] = ["overview", "workout", "diet", "calendar"];
const INSIGHT_NAV: WorkspaceId[] = ["analytics", "badges"];
const SECONDARY_NAV: WorkspaceId[] = ["settings"];

export function AppShell({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.userId);
  const demo = useAuthStore((s) => s.demo);
  const offlineBoot = useAuthStore((s) => s.offlineBoot);

  const view = useUiStore((s) => s.view);
  const theme = useUiStore((s) => s.theme);
  const online = useUiStore((s) => s.online);
  const pendingSyncCount = useUiStore((s) => s.pendingSyncCount);
  const flushingQueue = useUiStore((s) => s.flushingQueue);
  const modals = useUiStore((s) => s.modals);
  const navigate = useUiStore((s) => s.navigate);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const openModal = useUiStore((s) => s.openModal);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);
  const refreshPendingCount = useUiStore((s) => s.refreshPendingCount);
  const syncOfflineQueue = useUiStore((s) => s.syncOfflineQueue);

  const activeWs = VIEW_WORKSPACE[view] ?? "overview";
  const activeGroup = WORKSPACES[activeWs];
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => readWorkoutPreferences().hiddenModules ?? []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setHiddenModules(readWorkoutPreferences().hiddenModules ?? []);
    window.addEventListener(WORKOUT_PREFS_EVENT, sync);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, sync);
  }, []);
  const dietHidden = hiddenModules.includes("diet");
  const isWorkspaceHidden = (id: WorkspaceId) =>
    (id === "badges" && hiddenModules.includes("badges"));
  const visibleDailyNav = DAILY_NAV.filter((id) => !isWorkspaceHidden(id));
  const visibleInsightNav = INSIGHT_NAV.filter((id) => !isWorkspaceHidden(id));
  const visibleMobileTabs = MOBILE_TABS.filter((t) => !isWorkspaceHidden(t.id));
  const themeIcon = theme === "dark" ? "sun" : "moon";
  const activeTabLabel = activeGroup.tabs?.find((tab) => tab.id === view)?.label ?? DESTINATIONS[view];
  const moreMenuOpen = modals.at(-1)?.layout === "menu" && modals.at(-1)?.title === "更多";
  const isGuestAuth = !userId && view !== "exercises";

  if (isGuestAuth) {
    return (
      <div className="guest-shell">
        <header className="guest-top">
          <a
            href="#overview"
            className="guest-brand"
            aria-label="铁记首页"
            onClick={(e) => {
              e.preventDefault();
              navigate("overview");
            }}
          >
            <img width={32} height={32} src="/app/icon-192.png" alt="" />
            <span className="brand-type">
              <MatrixText value="IRONLOG" />
              <strong>铁记</strong>
            </span>
          </a>
          <button
            type="button"
            className="icon-button"
            aria-label="切换浅色与深色"
            onClick={() => {
              triggerHaptic("light");
              toggleTheme();
            }}
          >
            <Icon name={themeIcon} size={19} />
          </button>
        </header>
        <main id="content" className="guest-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    );
  }

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, target: WorkspaceId) => {
    e.preventDefault();
    triggerHaptic("light");
    if (
      view === target &&
      e.currentTarget.getAttribute("aria-current") === "page" &&
      e.currentTarget.closest(".mobile-nav")
    ) {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        window.scrollTo(0, 0);
      }
      return;
    }
    navigate(target);
  };

  const renderDesktopLink = (id: WorkspaceId) => {
    if (id === "diet" && dietHidden) {
      const isWeightActive = view === "weight";
      return (
        <a
          key="weight"
          href="#weight"
          aria-label="体重记录"
          aria-current={isWeightActive ? "page" : undefined}
          onPointerEnter={() => prefetchWorkspace("diet", userId)}
          onFocus={() => prefetchWorkspace("diet", userId)}
          onClick={(e) => {
            e.preventDefault();
            navigate("weight");
          }}
        >
          <Icon name="weight" />
          <span>体重记录</span>
          {isWeightActive ? <i className="nav-dot" /> : null}
        </a>
      );
    }
    return (
      <a
        key={id}
        href={`#${id}`}
        aria-label={WORKSPACES[id].label}
        aria-current={id === activeWs ? "page" : undefined}
        onPointerEnter={() => prefetchWorkspace(id, userId)}
        onFocus={() => prefetchWorkspace(id, userId)}
        onClick={(e) => handleNavClick(e, id)}
      >
        <Icon name={WORKSPACES[id].icon} />
        <span>{WORKSPACES[id].label}</span>
        {id === activeWs ? <i className="nav-dot" /> : null}
      </a>
    );
  };

  return (
    <>
      <aside className="sidebar" id="sidebar" aria-label="铁记导航">
        <a
          href="#overview"
          className="brand"
          aria-label="铁记首页"
          onClick={(e) => handleNavClick(e, "overview")}
        >
          <span className="brand-type">
            <MatrixText value="IRONLOG" />
            <strong>铁记</strong>
          </span>
          <img width={43} height={43} src="/app/icon-192.png" alt="" />
        </a>

        {userId ? (
          <button
            type="button"
            className="primary-button sidebar-quick-cta"
            aria-label="速记"
            onClick={() => {
              triggerHaptic("light");
              openModal({
                title: "速记",
                layout: "menu",
                content: <QuickRecordSheetBody />,
              });
            }}
          >
            <Icon name="plus" size={16} />
            <span>速记</span>
          </button>
        ) : null}

        <nav className="desktop-nav">
          <span className="nav-group-label">日常</span>
          {visibleDailyNav.map(renderDesktopLink)}
          <span className="nav-divider" aria-hidden="true" />
          <span className="nav-group-label">洞察</span>
          {visibleInsightNav.map(renderDesktopLink)}
          <span className="nav-divider" aria-hidden="true" />
          <span className="nav-group-label">系统</span>
          {SECONDARY_NAV.map(renderDesktopLink)}
        </nav>

        <nav className="mobile-nav" aria-label="手机导航">
          {visibleMobileTabs.map(({ id, label }) => {
            if (id === "diet" && dietHidden) {
              return (
                <a
                  key="weight"
                  href="#weight"
                  aria-current={view === "weight" ? "page" : undefined}
                  onPointerEnter={() => prefetchWorkspace("diet", userId)}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("weight");
                  }}
                >
                  <Icon name="weight" />
                  <span>体重</span>
                </a>
              );
            }
            return (
              <a
                key={id}
                href={`#${id}`}
                aria-current={id === activeWs ? "page" : undefined}
                onPointerEnter={() => prefetchWorkspace(id, userId)}
                onClick={(e) => handleNavClick(e, id)}
              >
                <Icon name={id} />
                <span>{label}</span>
              </a>
            );
          })}
          <button
            className="mobile-more"
            type="button"
            aria-haspopup="dialog"
            aria-controls="dialog"
            aria-expanded={moreMenuOpen}
            aria-current={MORE_WORKSPACES.includes(activeWs) ? "true" : undefined}
            onClick={() => {
              triggerHaptic("light");
              openModal({
                title: "更多",
                layout: "menu",
                content: <MoreSheetBody />,
              });
            }}
          >
            <Icon name="more" />
            <span>更多</span>
          </button>
        </nav>

        <footer>
          <span className="connection">
            <i className={userId ? "online" : ""} />
            {demo ? "演示模式" : userId ? "已登录" : "未登录"}
          </span>
          <div className="sidebar-foot-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="切换浅色与深色"
              onClick={() => {
                triggerHaptic("light");
                toggleTheme();
              }}
            >
              <Icon name={themeIcon} size={19} />
            </button>
          </div>
        </footer>
      </aside>

      <div className="frame">
        <header id="top" className="top">
          <div className="breadcrumb">
            <span>铁记</span>
            <Icon name="chevron" size={14} />
            {activeGroup.tabs && userId ? (
              <>
                <a
                  className="breadcrumb-group"
                  href={`#${activeWs}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(activeWs);
                  }}
                >
                  {activeGroup.label}
                </a>
                <Icon name="chevron" size={14} />
                <strong>{activeTabLabel}</strong>
              </>
            ) : (
              <strong>{DESTINATIONS[view]}</strong>
            )}
          </div>

          <a
            href="#overview"
            className="phone-brand"
            aria-label="铁记首页"
            onClick={(e) => handleNavClick(e, "overview")}
          >
            <MatrixText value="IRONLOG" />
            <strong>铁记</strong>
          </a>

          <div className="top-actions">
            {!online || offlineBoot ? (
              <span className="offline-pill" role="status" aria-label="当前离线">
                离线
              </span>
            ) : null}
            {userId && pendingSyncCount > 0 ? (
              <button
                type="button"
                className="sync-pending-pill"
                aria-label="同步离线待上传记录"
                disabled={flushingQueue}
                onClick={() => {
                  if (flushingQueue) return;
                  if (!online || (typeof navigator !== "undefined" && navigator.onLine === false)) {
                    notify("当前处于离线状态，恢复网络后将自动同步待上传记录");
                    return;
                  }
                  void syncOfflineQueue(userId, { silent: false }).then(() => {
                    const blocked = readQueue(getOfflineStorage(), userId).filter((item) => item.failure);
                    if (!blocked.length) return;
                    const firstMsg = blocked[0]?.failure?.message || "数据版本冲突";
                    openConfirm({
                      title: `${blocked.length} 条离线记录冲突或被拒绝`,
                      message: `错误详情：${firstMsg}。可保留并在服务端手动补录后清理这些冲突项。`,
                      confirmLabel: "仅清空冲突条目",
                      onConfirm: () => {
                        const removed = clearFailedMutations(getOfflineStorage(), userId);
                        const remaining = readQueue(getOfflineStorage(), userId).length;
                        refreshPendingCount(userId);
                        notify(
                          remaining > 0
                            ? `已清理 ${removed} 条冲突记录，保留 ${remaining} 条正常待同步记录`
                            : "已清理冲突的离线记录",
                        );
                      },
                    });
                  });
                }}
              >
                {flushingQueue ? "同步中…" : `待同步 ${pendingSyncCount}`}
              </button>
            ) : null}
            <button
              type="button"
              className="cmd-trigger-pill"
              aria-label="打开命令面板与快速搜索 (Ctrl+K)"
              title="快速搜索动作 / 跳转页面 (Ctrl+K)"
              onClick={() => {
                triggerHaptic("light");
                openCommandPalette();
              }}
            >
              <Icon name="search" size={14} />
              <span>搜索</span>
              <kbd>⌘K</kbd>
            </button>
            {userId ? (
              <>
                <button
                  type="button"
                  className="quick-record-pill"
                  aria-label="速记"
                  onClick={() => {
                    triggerHaptic("light");
                    openModal({
                      title: "速记",
                      layout: "menu",
                      content: <QuickRecordSheetBody />,
                    });
                  }}
                >
                  <Icon name="plus" size={14} />
                  <span>速记</span>
                </button>
                <button
                  type="button"
                  className="icon-button top-theme"
                  aria-label="切换浅色与深色"
                  onClick={() => {
                    triggerHaptic("light");
                    toggleTheme();
                  }}
                >
                  <Icon name={themeIcon} size={19} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="icon-button top-theme"
                aria-label="切换浅色与深色"
                onClick={() => {
                  triggerHaptic("light");
                  toggleTheme();
                }}
              >
                <Icon name={themeIcon} size={19} />
              </button>
            )}
          </div>
        </header>

        <LiveWorkoutBar />

        <main id="content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
