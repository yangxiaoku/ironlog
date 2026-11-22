import { DietEditorModal, type RecentFoodPreset } from "../components/diet/DietEditorModal";
import { EditMealTemplateModal, SaveMealTemplateModal } from "../components/diet/MealTemplateModal";
import { MeasurementModal } from "../components/weight/MeasurementModal";
import { WeightEditorModal } from "../components/weight/WeightEditorModal";
import { WorkoutEditorModal } from "../components/workout/WorkoutEditorModal";
import { WorkoutReportModal } from "../components/workout/WorkoutReportModal";
import { shortDate, today } from "./date";
import type {
  DietData,
  MealKey,
  MealTemplateData,
  MeasurementEntry,
  ProfileGoals,
  RecordEnvelope,
  WeightData,
  WorkoutData,
} from "./domain";
import { useUiStore } from "../store/useUiStore";

export function openWorkoutEditor({
  record,
  goals,
  seed,
}: {
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
  seed?: Partial<WorkoutData>;
} = {}): void {
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
}

export function openWorkoutReport({
  workoutId,
  record,
  goals,
}: {
  workoutId: string;
  record?: RecordEnvelope<WorkoutData>;
  goals?: ProfileGoals | null;
}): void {
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
