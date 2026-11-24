import { triggerAppleFitnessLaunch } from "../lib/apple-fitness";
import { today } from "../lib/date";
import { triggerHaptic } from "../lib/haptics-audio";
import { openDietEditor, openStrengthCalcModal, openWeightEditor, openWorkoutEditor } from "../lib/record-openers";
import { useUiStore } from "../store/useUiStore";
import { Icon, type IconName } from "./Icon";

interface QuickOption {
  kind: "workout" | "cardio" | "diet" | "weight" | "calc";
  title: string;
  desc: string;
  accent: string;
  icon: IconName;
}

const QUICK_OPTIONS: QuickOption[] = [
  {
    kind: "workout",
    title: "记录训练",
    desc: "自选动作，实时计时与杠铃配片",
    accent: "workout-accent",
    icon: "workout",
  },
  {
    kind: "cardio",
    title: "有氧运动（Apple 健身）",
    desc: "一键跳转苹果健身 / 有氧快捷指令开始记录",
    accent: "workout-accent",
    icon: "heart",
  },
  {
    kind: "diet",
    title: "记录饮食",
    desc: "按餐次记录食物与热量",
    accent: "diet-accent",
    icon: "diet",
  },
  {
    kind: "weight",
    title: "记录体重",
    desc: "快速记录体重与体脂率",
    accent: "weight-accent",
    icon: "weight",
  },
  {
    kind: "calc",
    title: "1RM 与配片计算器",
    desc: "估算 1RM、百分比负荷与杠铃配片图",
    accent: "calc-accent",
    icon: "bolt",
  },
];

export function QuickRecordSheetBody() {
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
              if (item.kind === "workout") {
                openWorkoutEditor();
              } else if (item.kind === "cardio") {
                triggerAppleFitnessLaunch("cardio", { notify });
              } else if (item.kind === "diet") {
                openDietEditor({ date: today() });
              } else if (item.kind === "weight") {
                openWeightEditor({ date: today() });
              } else {
                openStrengthCalcModal();
              }
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
