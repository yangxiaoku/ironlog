import type { ReactNode } from "react";
import { today } from "../lib/date";
import { findLocalWorkoutDraft } from "../lib/domain";
import { triggerHaptic } from "../lib/haptics-audio";
import { prefetchWorkspace } from "../lib/prefetch";
import { openCommandPalette, resumeLocalWorkoutDraft } from "../lib/record-openers";
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

const PRIMARY_NAV: WorkspaceId[] = ["overview", "workout", "diet", "calendar", "analytics", "badges"];
const SECONDARY_NAV: WorkspaceId[] = ["settings"];

export function AppShell({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.userId);
  const demo = useAuthStore((s) => s.demo);

  const view = useUiStore((s) => s.view);
  const theme = useUiStore((s) => s.theme);
  const online = useUiStore((s) => s.online);
  const pendingSyncCount = useUiStore((s) => s.pendingSyncCount);
  const modals = useUiStore((s) => s.modals);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const navigate = useUiStore((s) => s.navigate);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const openModal = useUiStore((s) => s.openModal);
  const syncOfflineQueue = useUiStore((s) => s.syncOfflineQueue);

  const activeWs = VIEW_WORKSPACE[view] ?? "overview";
  const activeGroup = WORKSPACES[activeWs];
  const themeIcon = theme === "dark" ? "sun" : "moon";
  const activeTabLabel = activeGroup.tabs?.find((tab) => tab.id === view)?.label ?? DESTINATIONS[view];
  const moreMenuOpen = modals.at(-1)?.layout === "menu" && modals.at(-1)?.title === "更多";
  const localDraft = userId ? (void dataEpoch, void modals.length, findLocalWorkoutDraft(userId)) : null;
  const todayStr = today();

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, target: WorkspaceId) => {
    e.preventDefault();
    triggerHaptic("light");
    if (e.currentTarget.getAttribute("aria-current") === "page" && e.currentTarget.closest(".mobile-nav")) {
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        window.scrollTo(0, 0);
      }
      return;
    }
    navigate(target);
  };

  const renderDesktopLink = (id: WorkspaceId) => (
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

        <nav className="desktop-nav">
          {PRIMARY_NAV.map(renderDesktopLink)}
          <span className="nav-divider" aria-hidden="true" />
          {SECONDARY_NAV.map(renderDesktopLink)}
        </nav>

        <nav className="mobile-nav" aria-label="手机导航">
          {MOBILE_TABS.map(({ id, label }) => (
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
          ))}
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
            {!online ? (
              <span className="offline-pill" role="status" aria-label="当前离线">
                离线
              </span>
            ) : null}
            {userId && pendingSyncCount > 0 ? (
              <button
                type="button"
                className="sync-pending-pill"
                aria-label="同步离线待上传记录"
                onClick={() => void syncOfflineQueue(userId, { silent: false })}
              >
                待同步 {pendingSyncCount}
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
            <span className="local-date">
              <Icon name="calendar" size={16} />
              <time dateTime={todayStr}>
                {todayStr.slice(0, 4)} / {todayStr.slice(5).replace("-", ".")}
              </time>
            </span>
            {userId && localDraft ? (
              <button
                type="button"
                className="live-resume-pill"
                aria-label="恢复未保存的训练草稿"
                onClick={() => {
                  triggerHaptic("light");
                  void resumeLocalWorkoutDraft(userId);
                }}
              >
                <i className="training-led" aria-hidden="true" />
                <span>草稿</span>
              </button>
            ) : null}
            {userId ? (
              <>
                <button
                  type="button"
                  className="quick-record-pill"
                  aria-label="快捷速记"
                  onClick={() => {
                    triggerHaptic("light");
                    openModal({
                      title: "快捷速记",
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
                className="icon-button"
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

        <main id="content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <LiveWorkoutBar />
    </>
  );
}
