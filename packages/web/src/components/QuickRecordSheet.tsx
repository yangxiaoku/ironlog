import { triggerHaptic } from "../lib/haptics-audio";
import type { ViewId } from "../lib/routes";
import { useUiStore } from "../store/useUiStore";
import { Icon, type IconName } from "./Icon";

interface QuickOption {
  kind: "workout" | "diet" | "weight" | "calc";
  title: string;
  desc: string;
  accent: string;
  icon: IconName;
  targetView: ViewId;
}

const QUICK_OPTIONS: QuickOption[] = [
  {
    kind: "workout",
    title: "记录训练",
    desc: "自选动作，或开始今天的计划（阶段二上线实时编辑器）",
    accent: "workout-accent",
    icon: "workout",
    targetView: "workout",
  },
  {
    kind: "diet",
    title: "记录饮食",
    desc: "按餐次记录食物与热量",
    accent: "diet-accent",
    icon: "diet",
    targetView: "diet",
  },
  {
    kind: "weight",
    title: "记录体重",
    desc: "称重打卡与身体围度档案",
    accent: "weight-accent",
    icon: "weight",
    targetView: "weight",
  },
  {
    kind: "calc",
    title: "1RM 与配片计算器",
    desc: "估算 1RM、百分比负荷与杠铃配片图",
    accent: "calc-accent",
    icon: "bolt",
    targetView: "plan",
  },
];

export function QuickRecordSheetBody() {
  const navigate = useUiStore((s) => s.navigate);
  const closeModalSilent = useUiStore((s) => s.closeModalSilent);
  const notify = useUiStore((s) => s.notify);

  return (
    <div className="quick-record-sheet-body">
      <div className="quick-sheet-list">
        {QUICK_OPTIONS.map((item) => (
          <button
            key={item.kind}
            type="button"
            className="quick-sheet-card"
            onClick={() => {
              triggerHaptic("light");
              closeModalSilent();
              navigate(item.targetView);
              notify(`已跳转「${item.title}」工作区，将在阶段二/三接入完整弹窗`);
            }}
          >
            <div className={`quick-sheet-icon ${item.accent}`}>
              <Icon name={item.icon} size={22} />
            </div>
            <div className="quick-sheet-info">
              <strong>{item.title}</strong>
              <small>{item.desc}</small>
            </div>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
