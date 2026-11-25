import { triggerAppleFitnessLaunch } from "../lib/apple-fitness";
import { today } from "../lib/date";
import { triggerHaptic } from "../lib/haptics-audio";
import { openDietEditor, openStrengthCalcModal, openTextLogModal, openWeightEditor, openWorkoutEditor } from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";
import { Icon, type IconName } from "./Icon";

interface QuickOption {
  kind: "workout" | "cardio" | "diet" | "weight" | "textLog" | "calc";
  title: string;
  desc: string;
  accent: string;
  icon: IconName;
}

const BASE_QUICK_OPTIONS: QuickOption[] = [
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
    desc: "打开 Apple 健身记录有氧",
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
    icon: "dial",
  },
];

const TEXT_LOG_OPTION: QuickOption = {
  kind: "textLog",
  title: "用文字记录",
  desc: "输入一句话记录训练或饮食",
  accent: "calc-accent",
  icon: "book",
};

export function QuickRecordSheetBody() {
  const aiReady = useAuthStore((s) => s.aiReady);
  const closeModalSilent = useUiStore((s) => s.closeModalSilent);
  const notify = useUiStore((s) => s.notify);

  const options = aiReady
    ? [...BASE_QUICK_OPTIONS.slice(0, 4), TEXT_LOG_OPTION, BASE_QUICK_OPTIONS[4]!]
    : BASE_QUICK_OPTIONS;

  return (
    <div className="quick-record-sheet-body">
      <div className="quick-sheet-list">
        {options.map((item) => (
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
              } else if (item.kind === "textLog") {
                openTextLogModal({ initialDate: today() });
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
