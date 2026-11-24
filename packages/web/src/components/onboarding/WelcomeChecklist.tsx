import { useState } from "react";
import { today } from "../../lib/date";
import type { OverviewStatsResponse, TodayResponse } from "../../lib/domain";
import { openDietEditor, openOnboardingModal, openWeightEditor, openWorkoutEditor } from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export const onboardingSeenKey = (userId: string) => "ironlog-web-onboarding-done:" + (userId || "anon");
export const welcomeDismissedKey = (userId: string) => "ironlog-web-welcome-dismissed:" + (userId || "anon");
export const setupSavedKey = (userId: string) => "ironlog-web-setup-saved:" + (userId || "anon");

export function WelcomeChecklist({
  stats,
  currentDay,
  hasPlan = false,
}: {
  stats: OverviewStatsResponse;
  currentDay: TodayResponse | null;
  hasPlan?: boolean;
}) {
  const userId = useAuthStore((s) => s.userId);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const openPlanSection = useUiStore((s) => s.openPlanSection);

  const [dismissed, setDismissed] = useState(() =>
    typeof localStorage !== "undefined" && Boolean(userId) && localStorage.getItem(welcomeDismissedKey(userId)) === "1",
  );

  if (!userId || dismissed) return null;

  const setupDone =
    (typeof localStorage !== "undefined" && localStorage.getItem(setupSavedKey(userId)) === "1") ||
    Boolean(stats.goals?.targetWeight != null) ||
    Boolean(
      typeof localStorage !== "undefined" &&
        localStorage.getItem(onboardingSeenKey(userId)) === "1" &&
        stats.goals?.calories &&
        stats.goals.calories !== 2200,
    );
  const trainingDone = Boolean(
    hasPlan || (stats.totals?.workouts ?? 0) > 0 || currentDay?.active || (currentDay?.completed ?? 0) > 0,
  );
  const bodyDone = Boolean(
    (currentDay?.nutrition?.count ?? 0) > 0 || currentDay?.weight != null || (stats.weights?.length ?? 0) > 0,
  );
  const doneCount = [setupDone, trainingDone, bodyDone].filter(Boolean).length;

  return (
    <section className="panel welcome-checklist" aria-label="新手快速上手清单">
      <header className="panel-head">
        <div>
          <h2>
            快速上手清单 <span className="atlas-pill">{doneCount} / 3</span>
          </h2>
          <p>
            {appleHealthConnected
              ? "已完成 Apple 健康对接，按以下 3 步快速建档开练。"
              : "无需 Apple Watch 也能完整使用，按以下 3 步快速开启训练闭环。"}
          </p>
        </div>
        <div className="heading-actions">
          <button type="button" className="quiet" onClick={() => openOnboardingModal({ currentProfile: stats.goals, initialStep: 1 })}>
            <Icon name="book" size={14} /> 查看完整指南
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              try {
                localStorage.setItem(welcomeDismissedKey(userId), "1");
              } catch {}
              setDismissed(true);
            }}
          >
            不再提示
          </button>
        </div>
      </header>

      <div className="welcome-checklist-items">
        <div className={`welcome-item${setupDone ? " is-done" : ""}`}>
          <span className="welcome-check" aria-hidden="true">
            {setupDone ? <Icon name="check" size={14} /> : "01"}
          </span>
          <div className="welcome-copy">
            <strong>设定器械与每日目标</strong>
            <small>选择健身房 / 居家器械与热量蛋白参考，后续选动作更精准</small>
          </div>
          <button
            type="button"
            className={setupDone ? "quiet" : "secondary-button"}
            onClick={() => openOnboardingModal({ currentProfile: stats.goals, initialStep: 2 })}
          >
            {setupDone ? "修改设置" : "去设置"}
          </button>
        </div>

        <div className={`welcome-item${trainingDone ? " is-done" : ""}`}>
          <span className="welcome-check" aria-hidden="true">
            {trainingDone ? <Icon name="check" size={14} /> : "02"}
          </span>
          <div className="welcome-copy">
            <strong>启用经典计划或记首场训练</strong>
            <small>直接套用经典分化方案，或自由添加动作记录组数与重量</small>
          </div>
          <div className="welcome-item-actions">
            <button type="button" className="secondary-button" onClick={() => openPlanSection("starters")}>
              选方案
            </button>
            <button type="button" className="primary-button" onClick={() => openWorkoutEditor(undefined, stats.goals)}>
              记训练
            </button>
          </div>
        </div>

        <div className={`welcome-item${bodyDone ? " is-done" : ""}`}>
          <span className="welcome-check" aria-hidden="true">
            {bodyDone ? <Icon name="check" size={14} /> : "03"}
          </span>
          <div className="welcome-copy">
            <strong>记录今日饮食或体重</strong>
            <small>记录首餐蛋白热量或晨起体重，点亮今日进度与变化趋势</small>
          </div>
          <div className="welcome-item-actions">
            <button type="button" className="secondary-button" onClick={() => openDietEditor({ date: today() })}>
              记饮食
            </button>
            <button type="button" className="quiet" onClick={() => openWeightEditor({ date: today() })}>
              记体重
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
