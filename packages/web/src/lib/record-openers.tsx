import { lazy, useState } from "react";
import type { AppleDailyEntry, AppleWorkoutAgendaItem } from "../components/apple/AppleHealthModals";
import type { RecentFoodPreset } from "../components/diet/DietEditorModal";
import type { ShareCardModalProps } from "../components/share/ShareCardModal";
import { Icon } from "../components/Icon";

const AiAdaptWorkoutModal = lazy(() => import("../components/ai/AiModals").then((m) => ({ default: m.AiAdaptWorkoutModal })));
const AiDietModal = lazy(() => import("../components/ai/AiModals").then((m) => ({ default: m.AiDietModal })));
const AiPlanModal = lazy(() => import("../components/ai/AiModals").then((m) => ({ default: m.AiPlanModal })));
const AiReviewModal = lazy(() => import("../components/ai/AiModals").then((m) => ({ default: m.AiReviewModal })));
const AiWorkoutModal = lazy(() => import("../components/ai/AiModals").then((m) => ({ default: m.AiWorkoutModal })));

const AppleDailyDetailsModal = lazy(() => import("../components/apple/AppleHealthModals").then((m) => ({ default: m.AppleDailyDetailsModal })));
const AppleWorkoutDetailsModal = lazy(() => import("../components/apple/AppleHealthModals").then((m) => ({ default: m.AppleWorkoutDetailsModal })));
const DeviceSetupModal = lazy(() => import("../components/apple/AppleHealthModals").then((m) => ({ default: m.DeviceSetupModal })));
const HealthDataImportModal = lazy(() => import("../components/apple/AppleHealthModals").then((m) => ({ default: m.HealthDataImportModal })));
const HealthDataWebhookModal = lazy(() => import("../components/apple/AppleHealthModals").then((m) => ({ default: m.HealthDataWebhookModal })));

const BadgeDetailModal = lazy(() => import("../components/badges/BadgeDetailModal").then((m) => ({ default: m.BadgeDetailModal })));
const CalendarDayModal = lazy(() => import("../components/calendar/DayDossier").then((m) => ({ default: m.CalendarDayModal })));
const CommandPaletteModal = lazy(() => import("../components/CommandPaletteModal").then((m) => ({ default: m.CommandPaletteModal })));
const DietEditorModal = lazy(() => import("../components/diet/DietEditorModal").then((m) => ({ default: m.DietEditorModal })));
const EditMealTemplateModal = lazy(() => import("../components/diet/MealTemplateModal").then((m) => ({ default: m.EditMealTemplateModal })));
const SaveMealTemplateModal = lazy(() => import("../components/diet/MealTemplateModal").then((m) => ({ default: m.SaveMealTemplateModal })));
const CustomExerciseModal = lazy(() => import("../components/exercises/ExerciseModals").then((m) => ({ default: m.CustomExerciseModal })));
const ExerciseDetailModal = lazy(() => import("../components/exercises/ExerciseModals").then((m) => ({ default: m.ExerciseDetailModal })));
const OnboardingModal = lazy(() => import("../components/onboarding/OnboardingModal").then((m) => ({ default: m.OnboardingModal })));

const DaySchedulerModal = lazy(() => import("../components/plan/PlanModals").then((m) => ({ default: m.DaySchedulerModal })));
const PlanBuilderModal = lazy(() => import("../components/plan/PlanModals").then((m) => ({ default: m.PlanBuilderModal })));
const PlanDraftModal = lazy(() => import("../components/plan/PlanModals").then((m) => ({ default: m.PlanDraftModal })));
const RoutinePreviewModal = lazy(() => import("../components/plan/PlanModals").then((m) => ({ default: m.RoutinePreviewModal })));
const TemplateEditorModal = lazy(() => import("../components/plan/PlanModals").then((m) => ({ default: m.TemplateEditorModal })));

const BackupRestoreModal = lazy(() => import("../components/settings/DataModals").then((m) => ({ default: m.BackupRestoreModal })));
const CsvImportModal = lazy(() => import("../components/settings/DataModals").then((m) => ({ default: m.CsvImportModal })));
const IssueApiTokenModal = lazy(() => import("../components/settings/DataModals").then((m) => ({ default: m.IssueApiTokenModal })));
const PlanImportModal = lazy(() => import("../components/settings/DataModals").then((m) => ({ default: m.PlanImportModal })));

const ShareCardModal = lazy(() => import("../components/share/ShareCardModal").then((m) => ({ default: m.ShareCardModal })));
const StrengthCalcModal = lazy(() => import("../components/tools/StrengthCalcModal").then((m) => ({ default: m.StrengthCalcModal })));
const MeasurementModal = lazy(() => import("../components/weight/MeasurementModal").then((m) => ({ default: m.MeasurementModal })));
const WeightEditorModal = lazy(() => import("../components/weight/WeightEditorModal").then((m) => ({ default: m.WeightEditorModal })));
const WorkoutEditorModal = lazy(() => import("../components/workout/WorkoutEditorModal").then((m) => ({ default: m.WorkoutEditorModal })));
const WorkoutReportModal = lazy(() => import("../components/workout/WorkoutReportModal").then((m) => ({ default: m.WorkoutReportModal })));
import { apiFetch } from "./api";
import { inferAppleFitnessKind, triggerAppleFitnessLaunch } from "./apple-fitness";
import type { BadgeItem } from "./badges";
import { copyText } from "./clipboard";
import { shortDate, today } from "./date";
import {
  findLocalWorkoutDraft,
  type CatalogueExercise,
  type DietData,
  type MealKey,
  type MealTemplateData,
  type MeasurementEntry,
  type PlanData,
  type PlannedExercise,
  type ProfileGoals,
  type RecordEnvelope,
  type WeightData,
  type WorkoutData,
} from "./domain";
import { useUiStore } from "../store/useUiStore";
import { readWorkoutPreferences } from "./workout-helpers";

export interface WorkoutEditorOptions {
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
  seed?: Partial<WorkoutData>;
  skipAppleAutoLaunch?: boolean;
}

function isWorkoutEnvelope(val: unknown): val is RecordEnvelope<WorkoutData> {
  return Boolean(val && typeof val === "object" && "id" in val && "data" in val);
}

export function openWorkoutEditor(options?: WorkoutEditorOptions): void;
export function openWorkoutEditor(
  record?: RecordEnvelope<WorkoutData>,
  goals?: ProfileGoals | null,
  seed?: Partial<WorkoutData>,
): void;
export function openWorkoutEditor(
  arg1?: WorkoutEditorOptions | RecordEnvelope<WorkoutData>,
  arg2?: ProfileGoals | null,
  arg3?: Partial<WorkoutData>,
): void {
  const opts: WorkoutEditorOptions =
    arg2 !== undefined || arg3 !== undefined || arg1 === undefined || isWorkoutEnvelope(arg1)
      ? { record: arg1 as RecordEnvelope<WorkoutData> | undefined, goals: arg2, seed: arg3 }
      : (arg1 ?? {});
  const { record, goals, seed } = opts;
  const ui = useUiStore.getState();
  ui.openModal({
    title: record ? `编辑：${record.data.title}` : seed?.title ? `开始：${seed.title}` : "记录训练",
    wide: true,
    layout: "workout",
    content: (
      <WorkoutEditorModal
        record={record}
        goals={goals}
        seed={seed}
        onCompleted={(saved) => {
          ui.closeAllModals();
          openWorkoutReport({ workoutId: saved.id, record: saved, goals });
        }}
      />
    ),
  });
  if (!record && (!seed?.date || seed.date === today()) && !opts.skipAppleAutoLaunch) {
    const prefs = readWorkoutPreferences();
    if (prefs.appleFitnessAutoLaunch) {
      const kind = inferAppleFitnessKind(seed?.exercises, seed?.title);
      triggerAppleFitnessLaunch(kind, { prefs, silentNonIos: true });
    }
  }
}

export async function resumeLocalWorkoutDraft(
  userId: string,
  goals?: ProfileGoals | null,
): Promise<void> {
  if (!userId) {
    openWorkoutEditor({ goals, skipAppleAutoLaunch: true });
    return;
  }
  const found = findLocalWorkoutDraft(userId);
  if (!found) {
    openWorkoutEditor({ goals, skipAppleAutoLaunch: true });
    return;
  }
  const prefix = `ironlog-web-draft:${userId}:`;
  const suffix = found.key.startsWith(prefix) ? found.key.slice(prefix.length) : "new";
  const recordId = suffix && suffix !== "new" ? suffix : undefined;
  if (!recordId) {
    openWorkoutEditor({ goals, skipAppleAutoLaunch: true });
    return;
  }
  try {
    const rec = await apiFetch<RecordEnvelope<WorkoutData>>(
      `/api/web/records/workout/${encodeURIComponent(recordId)}`,
    );
    openWorkoutEditor({ record: rec, goals });
  } catch {
    try {
      const parsed = JSON.parse(found.raw) as Partial<WorkoutData> & {
        timing?: WorkoutData["timing"];
      };
      const fallbackRecord: RecordEnvelope<WorkoutData> = {
        id: recordId,
        kind: "workout",
        version: 0,
        deleted: false,
        updatedAt: new Date().toISOString(),
        data: {
          date: parsed.date || today(),
          title: parsed.title?.trim() || "自由训练",
          startedAt: parsed.timing?.runningSince ?? new Date().toISOString(),
          endedAt: null,
          status: "active",
          notes: parsed.notes ?? "",
          feeling: parsed.feeling ?? null,
          source: parsed.source ?? "manual",
          rawPrompt: parsed.rawPrompt,
          planId: parsed.planId ?? null,
          planVersion: parsed.planVersion ?? null,
          routineId: parsed.routineId ?? null,
          targetSnapshot: parsed.targetSnapshot,
          exercises: Array.isArray(parsed.exercises) ? parsed.exercises : [],
          timing: parsed.timing ?? null,
        },
      };
      openWorkoutEditor({ record: fallbackRecord, goals });
    } catch {
      openWorkoutEditor({ goals, skipAppleAutoLaunch: true });
    }
  }
}

export interface WorkoutReportOptions {
  workoutId: string;
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
}

export function openWorkoutReport(options: WorkoutReportOptions): void;
export function openWorkoutReport(
  workoutId: string,
  record?: RecordEnvelope<WorkoutData>,
  goals?: ProfileGoals | null,
): void;
export function openWorkoutReport(
  arg1: WorkoutReportOptions | string,
  arg2?: RecordEnvelope<WorkoutData>,
  arg3?: ProfileGoals | null,
): void {
  const opts: WorkoutReportOptions =
    typeof arg1 === "string" ? { workoutId: arg1, record: arg2, goals: arg3 } : arg1;
  const { workoutId, record, goals } = opts;
  const ui = useUiStore.getState();
  ui.openModal({
    title: record?.data.title ?? "训练复盘",
    wide: true,
    layout: "report",
    content: (
      <WorkoutReportModal
        workoutId={workoutId}
        record={record}
        goals={goals}
        onEditWorkout={(fullRecord, profGoals) => {
          ui.closeAllModals();
          openWorkoutEditor({ record: fullRecord, goals: profGoals });
        }}
        onRepeatWorkout={(seed, profGoals) => {
          ui.closeAllModals();
          openWorkoutEditor({ seed, goals: profGoals });
        }}
      />
    ),
  });
}

export function openDietEditor({
  record,
  date,
  meal,
  recentFoods,
}: {
  record?: RecordEnvelope<DietData>;
  date?: string;
  meal?: MealKey;
  recentFoods?: RecentFoodPreset[];
} = {}): void {
  useUiStore.getState().openModal({
    title: record ? "编辑饮食记录" : "记录饮食",
    content: (
      <DietEditorModal
        record={record}
        defaultDate={date}
        defaultMeal={meal}
        recentFoods={recentFoods}
      />
    ),
  });
}

export function openSaveMealTemplateModal({
  meal,
  entries,
}: {
  meal: MealKey;
  entries: Array<RecordEnvelope<DietData>>;
}): void {
  useUiStore.getState().openModal({
    title: "存为常用餐单",
    content: <SaveMealTemplateModal meal={meal} entries={entries} />,
  });
}

export function openEditMealTemplateModal(template: RecordEnvelope<MealTemplateData>): void {
  useUiStore.getState().openModal({
    title: "编辑常用餐单",
    wide: true,
    content: <EditMealTemplateModal template={template} />,
  });
}

export function openWeightEditor({
  record,
  date,
  defaultWeight,
}: {
  record?: RecordEnvelope<WeightData>;
  date?: string;
  defaultWeight?: number | null;
} = {}): void {
  useUiStore.getState().openModal({
    title: record ? `编辑 ${shortDate(record.data.date)} 体重` : "记录体重",
    content: (
      <WeightEditorModal
        record={record}
        defaultDate={date ?? today()}
        defaultWeight={defaultWeight}
      />
    ),
  });
}

export function openMeasurementModal(existing: MeasurementEntry | null = null): void {
  useUiStore.getState().openModal({
    title: existing ? `编辑 ${shortDate(existing.date)} 围度` : "记录身体围度",
    content: <MeasurementModal existing={existing} />,
  });
}

export function openStrengthCalcModal(): void {
  useUiStore.getState().openModal({
    title: "1RM 与配片计算器",
    wide: true,
    layout: "report",
    content: <StrengthCalcModal />,
  });
}

export function openDailyShareModal(arg?: string | { date?: string; onBack?: (() => void) | null }): void {
  const opts = typeof arg === "string" ? { date: arg } : (arg ?? {});
  const d = opts.date ?? today();
  useUiStore.getState().openModal({
    title: `${shortDate(d)} · 训练打卡海报`,
    layout: "report",
    content: <ShareCardModal date={d} onBack={opts.onBack ?? null} />,
  });
}

export function openWorkoutShareModal({
  singleReport = null,
  singleHealth = null,
  onBack = null,
}: Pick<ShareCardModalProps, "singleReport" | "singleHealth" | "onBack">): void {
  useUiStore.getState().openModal({
    title: singleHealth ? "生成健康体能海报" : "生成本场训练海报",
    layout: "report",
    content: <ShareCardModal singleReport={singleReport} singleHealth={singleHealth} onBack={onBack} />,
  });
}

export function openAiReviewModal(): void {
  useUiStore.getState().openModal({
    title: "AI 训练与营养周报",
    wide: true,
    content: <AiReviewModal />,
  });
}

export function openAiDietModal({ initialDate }: { initialDate?: string } = {}): void {
  useUiStore.getState().openModal({
    title: "AI 一句话记饮食",
    wide: true,
    content: <AiDietModal initialDate={initialDate} />,
  });
}

export function openAiWorkoutModal({ initialDate }: { initialDate?: string } = {}): void {
  const ui = useUiStore.getState();
  ui.openModal({
    title: "AI 文本记录训练",
    wide: true,
    content: (
      <AiWorkoutModal
        initialDate={initialDate}
        onEditParsed={(seed) => {
          ui.closeAllModals();
          openWorkoutEditor({ seed });
        }}
        onSavedReport={(saved) => {
          ui.closeAllModals();
          openWorkoutReport({ workoutId: saved.id, record: saved });
        }}
      />
    ),
  });
}

export function openAiPlanModal(activePlanId?: string | null): void {
  useUiStore.getState().openModal({
    title: "AI 智能生成周期计划",
    wide: true,
    content: <AiPlanModal activePlanId={activePlanId} />,
  });
}

export function openAiAdaptWorkoutModal({
  ensureSavedWorkout,
  onApplied,
}: {
  ensureSavedWorkout: () => Promise<RecordEnvelope<WorkoutData>>;
  onApplied: (updated: RecordEnvelope<WorkoutData>) => void;
}): void {
  useUiStore.getState().openModal({
    title: "AI 训中临场调整",
    wide: true,
    content: <AiAdaptWorkoutModal ensureSavedWorkout={ensureSavedWorkout} onApplied={onApplied} />,
  });
}

export function openCsvImportModal({ onSuccess }: { onSuccess?: () => void } = {}): void {
  useUiStore.getState().openModal({
    title: "从 Strong / Hevy CSV 导入",
    wide: true,
    content: <CsvImportModal onSuccess={onSuccess} />,
  });
}

export function openBackupRestoreModal({ onSuccess }: { onSuccess?: () => void } = {}): void {
  useUiStore.getState().openModal({
    title: "恢复完整备份",
    wide: true,
    content: <BackupRestoreModal onSuccess={onSuccess} />,
  });
}

export function openIssueApiTokenModal({ onIssued }: { onIssued?: () => void } = {}): void {
  useUiStore.getState().openModal({
    title: "新建个人 API 密钥",
    content: <IssueApiTokenModal onIssued={onIssued} />,
  });
}

export function openPlanImportModal({
  hasActivePlan,
  expectedRevision,
  onImported,
}: {
  hasActivePlan: boolean;
  expectedRevision: number;
  onImported?: () => void;
}): void {
  useUiStore.getState().openModal({
    title: "从 JSON 导入训练计划",
    wide: true,
    content: (
      <PlanImportModal
        hasActivePlan={hasActivePlan}
        expectedRevision={expectedRevision}
        onImported={onImported}
      />
    ),
  });
}

export function openHealthDataImportModal({ onImported }: { onImported?: () => void } = {}): void {
  useUiStore.getState().openModal({
    title: "导入 Apple Health 导出包",
    content: <HealthDataImportModal onImported={onImported} />,
  });
}

export function openHealthDataWebhookModal({ onRefresh }: { onRefresh?: () => void } = {}): void {
  useUiStore.getState().openModal({
    title: "Apple Health 快捷指令同步",
    content: <HealthDataWebhookModal onRefresh={onRefresh} />,
  });
}

export function openDeviceSetupModal({ onRefresh }: { onRefresh?: () => void } = {}): void {
  useUiStore.getState().openModal({
    title: "配置设备同步",
    content: <DeviceSetupModal onRefresh={onRefresh} />,
  });
}

export function openAppleDailyDetailsModal(daily: AppleDailyEntry): void {
  useUiStore.getState().openModal({
    title: `${shortDate(daily.date)} Apple Health 每日体能`,
    wide: true,
    layout: "report",
    content: <AppleDailyDetailsModal daily={daily} />,
  });
}

export function openAppleWorkoutDetailsModal(
  arg:
    | AppleWorkoutAgendaItem
    | {
        item: AppleWorkoutAgendaItem;
        back?: (() => void) | null;
        onOpenWorkout?: (workoutId: string) => void;
      },
): void {
  const opts = "item" in arg ? arg : { item: arg };
  const ui = useUiStore.getState();
  ui.openModal({
    title: opts.item.title || "Apple 体能训练",
    wide: true,
    layout: "report",
    content: (
      <AppleWorkoutDetailsModal
        item={opts.item}
        back={Boolean(opts.back)}
        onOpenWorkout={
          opts.onOpenWorkout ??
          (opts.back
            ? () => opts.back!()
            : (workoutId) => {
                ui.closeTopModal();
                openWorkoutReport({ workoutId });
              })
        }
      />
    ),
  });
}

export function openOnboardingModal({
  currentProfile = null,
  initialStep = 1,
}: {
  currentProfile?: ProfileGoals | null;
  initialStep?: number;
} = {}): void {
  useUiStore.getState().openModal({
    title: "新手引导 · 快速上手",
    wide: true,
    layout: "onboarding",
    content: <OnboardingModal currentProfile={currentProfile} initialStep={initialStep} />,
  });
}

export function openPlanBuilderModal(
  existingPlan: { id: string; version?: number; data: PlanData } | null = null,
): void {
  useUiStore.getState().openModal({
    title: existingPlan ? `编辑计划：${existingPlan.data.name}` : "新建周期计划",
    wide: true,
    layout: "report",
    content: <PlanBuilderModal existingPlan={existingPlan} />,
  });
}

export function openTemplateEditorModal(
  existingTemplate: RecordEnvelope<{ id: string; name: string; exercises: PlannedExercise[] }> | null = null,
): void {
  useUiStore.getState().openModal({
    title: existingTemplate ? `编辑训练日模板：${existingTemplate.data.name}` : "新建训练日模板",
    wide: true,
    layout: "report",
    content: <TemplateEditorModal existingTemplate={existingTemplate} />,
  });
}

export function openPlanDraftModal(
  record: RecordEnvelope<PlanData>,
  catalogueMap: Map<string, CatalogueExercise>,
  expectedRevision: number,
): void {
  useUiStore.getState().openModal({
    title: `AI 计划草稿：${record.data.name}`,
    wide: true,
    content: <PlanDraftModal record={record} catalogueMap={catalogueMap} expectedRevision={expectedRevision} />,
  });
}

export function openDayScheduler(
  date: string,
  options: { onSaved?: (savedDate: string) => void; onStartPreview?: (d: string) => void } = {},
): void {
  const ui = useUiStore.getState();
  ui.openModal({
    title: `编排 ${shortDate(date)} 训练日`,
    wide: true,
    layout: "report",
    content: (
      <DaySchedulerModal
        date={date}
        onSaved={options.onSaved}
        onStartPreview={
          options.onStartPreview ??
          ((d) => {
            ui.closeTopModal();
            openRoutinePreview({ id: d, source: "scheduled", date: d });
          })
        }
      />
    ),
  });
}

export function openRoutinePreview({
  id,
  source = "plan",
  date = today(),
}: {
  id: string;
  source?: "plan" | "template" | "scheduled";
  date?: string;
}): void {
  const ui = useUiStore.getState();
  ui.openModal({
    title: "今日训练准备",
    wide: true,
    layout: "report",
    content: (
      <RoutinePreviewModal
        id={id}
        source={source}
        date={date}
        onEditScheduledDay={(d) => {
          ui.closeTopModal();
          openDayScheduler(d);
        }}
        onLaunchWorkout={(seed, goals) => {
          ui.closeAllModals();
          openWorkoutEditor({ seed, goals });
        }}
      />
    ),
  });
}

function ExerciseCopyButton({ getTitle }: { getTitle: () => string }) {
  const notify = useUiStore((s) => s.notify);
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="quiet copy-exercise"
      onClick={() => {
        const name = getTitle();
        void copyText(name).then((ok) => {
          if (ok) {
            setCopied(true);
            notify(`已复制「${name}」`);
            window.setTimeout(() => setCopied(false), 1800);
          } else {
            notify("无法自动复制，请长按标题复制");
          }
        });
      }}
    >
      <Icon name="copy" size={14} /> {copied ? "已复制" : "复制动作名"}
    </button>
  );
}

export function openExerciseDetailModal(
  exerciseId: string,
  exerciseName?: string,
  customRecord: RecordEnvelope<CatalogueExercise> | null = null,
): void {
  const ui = useUiStore.getState();
  const titleRef = { current: customRecord?.data.name || exerciseName || exerciseId };
  ui.openModal({
    title: titleRef.current,
    wide: true,
    layout: "exercise",
    headerAction: <ExerciseCopyButton getTitle={() => titleRef.current} />,
    content: (
      <ExerciseDetailModal
        exerciseId={exerciseId}
        customRecord={customRecord}
        onResolvedTitle={(resolved) => {
          titleRef.current = resolved;
          ui.updateTopModalTitle(resolved);
        }}
        onEditCustom={(rec) => {
          ui.closeTopModal();
          openCustomExerciseModal(rec);
        }}
        onQuickStart={(seed) => {
          ui.closeAllModals();
          openWorkoutEditor({ seed });
        }}
      />
    ),
  });
}

export function openCustomExerciseModal(existing: RecordEnvelope<CatalogueExercise> | null = null): void {
  useUiStore.getState().openModal({
    title: existing ? `编辑自定义动作：${existing.data.name}` : "新建自定义动作",
    content: <CustomExerciseModal existing={existing} />,
  });
}

export function openCalendarDayModal(initialDate: string, onDateChange?: (d: string) => void): void {
  useUiStore.getState().openModal({
    title: `${shortDate(initialDate)} 训练日程`,
    wide: true,
    layout: "report",
    content: <CalendarDayModal initialDate={initialDate} onDateChange={onDateChange} />,
  });
}

export function openBadgeDetailModal(badge: BadgeItem, onPinnedChange?: (pinned: string[]) => void): void {
  useUiStore.getState().openModal({
    title: badge.title,
    layout: "badge",
    content: <BadgeDetailModal badge={badge} onPinnedChange={onPinnedChange} />,
  });
}

export function openCommandPalette(): void {
  const ui = useUiStore.getState();
  if (ui.modals.some((m) => m.title === "快速搜索与命令面板")) {
    ui.closeTopModal();
    return;
  }
  ui.openModal({
    title: "快速搜索与命令面板",
    wide: true,
    content: <CommandPaletteModal />,
  });
}
