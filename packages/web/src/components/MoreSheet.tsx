import { today } from "../lib/date";
import { triggerHaptic } from "../lib/haptics-audio";
import { openDietEditor, openOnboardingModal, openStrengthCalcModal, openWeightEditor, openWorkoutEditor } from "../lib/record-openers";
import { MORE_WORKSPACES, VIEW_WORKSPACE, WORKSPACES, type ViewId, type WorkspaceId } from "../lib/routes";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";
import { Icon } from "./Icon";

const SHORTCUT_PAGES: Array<{ id: ViewId; label: string }> = [
  { id: "plan", label: "训练计划" },
  { id: "weight", label: "体重记录" },
  { id: "exercises", label: "动作库" },
];

export function MoreSheetBody() {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const logout = useAuthStore((s) => s.logout);

  const view = useUiStore((s) => s.view);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const navigate = useUiStore((s) => s.navigate);
  const closeModalSilent = useUiStore((s) => s.closeModalSilent);
  const openConfirm = useUiStore((s) => s.openConfirm);

  const activeWs = VIEW_WORKSPACE[view] ?? "overview";
  const moreMeta: Record<string, string> = {
    analytics: appleHealthConnected ? "负荷、恢复、体征与周期报表" : "负荷比、肌群剂量、1RM 与周报",
    badges: "力量、连击、容量与坚持徽章",
    settings: appleHealthConnected ? "目标、Apple 健康、AI、账号" : "目标、AI 助手、导出与账号",
  };
  const isDark = theme === "dark";

  const goTo = (target: ViewId | WorkspaceId) => {
    triggerHaptic("light");
    closeModalSilent();
    navigate(target);
  };

  return (
    <div className="more-sheet-body">
      {userId ? (
        <div className="more-quick" role="group" aria-label="快速记录">
          <button
            type="button"
            className="more-quick-btn"
            onClick={() => {
              triggerHaptic("light");
              closeModalSilent();
              openWorkoutEditor();
            }}
          >
            <Icon name="workout" size={18} />
            <span>记训练</span>
          </button>
          <button
            type="button"
            className="more-quick-btn"
            onClick={() => {
              triggerHaptic("light");
              closeModalSilent();
              openDietEditor({ date: today() });
            }}
          >
            <Icon name="diet" size={18} />
            <span>记饮食</span>
          </button>
          <button
            type="button"
            className="more-quick-btn"
            onClick={() => {
              triggerHaptic("light");
              closeModalSilent();
              openWeightEditor({ date: today() });
            }}
          >
            <Icon name="weight" size={18} />
            <span>记体重</span>
          </button>
        </div>
      ) : null}

      <nav className="more-links" aria-label="更多工作区">
        {MORE_WORKSPACES.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === activeWs ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              goTo(id);
            }}
          >
            <Icon name={WORKSPACES[id].icon} />
            <span className="more-link-copy">
              <b>{WORKSPACES[id].label}</b>
              <small>{moreMeta[id] ?? ""}</small>
            </span>
            <Icon name={id === activeWs ? "check" : "chevron"} size={17} />
          </a>
        ))}
      </nav>

      <p className="more-shortcuts-head">子页面直达</p>
      <nav className="more-shortcuts" aria-label="子页面直达">
        {SHORTCUT_PAGES.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={id === view ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              goTo(id);
            }}
          >
            <Icon name={id} size={16} />
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <footer className="more-foot">
        {userId ? (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              triggerHaptic("light");
              closeModalSilent();
              openOnboardingModal({ initialStep: 1 });
            }}
          >
            <Icon name="book" size={16} /> 使用指南
          </button>
        ) : null}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            triggerHaptic("light");
            closeModalSilent();
            openStrengthCalcModal();
          }}
        >
          <Icon name="bolt" size={16} /> 力量计算器
        </button>
        {userId ? (
          <button
            type="button"
            className="quiet"
            onClick={() =>
              openConfirm({
                title: "退出账号",
                message: "确认退出当前账号吗？未同步的离线本地草稿会被清除。",
                confirmLabel: "退出登录",
                onConfirm: () => logout(),
              })
            }
          >
            <Icon name="close" size={16} /> 退出账号
          </button>
        ) : null}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            triggerHaptic("light");
            toggleTheme();
          }}
        >
          <Icon name={isDark ? "sun" : "moon"} size={16} /> 切换{isDark ? "浅色" : "深色"}外观
        </button>
      </footer>
    </div>
  );
}
