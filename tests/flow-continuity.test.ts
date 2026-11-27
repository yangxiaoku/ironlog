import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildWorkoutSeedFromRoutine,
  isBackfillWorkoutDate,
  resolveAutoAdvanceDelayMs,
  type RoutineLaunchPayload,
} from "../packages/web/src/lib/routine-launch.js";
import { DEFAULT_WORKOUT_PREFERENCES } from "../packages/web/src/lib/workout-helpers.js";
import { useUiStore } from "../packages/web/src/store/useUiStore.js";

describe("Flow Continuity Polish (7 items)", () => {
  it("Item 1: buildWorkoutSeedFromRoutine builds direct-launch seed with deload scaling, weightUnit & autoWarmup", () => {
    let seq = 0;
    const payload: RoutineLaunchPayload = {
      name: "上肢推日",
      routineId: "r_push",
      planId: "plan_1",
      planVersion: 2,
      exercises: [
        {
          exerciseId: "bench",
          targetIndex: 0,
          restSeconds: 120,
          supersetGroup: "A",
          weightUnit: "kg",
          autoWarmup: true,
          snapshot: {
            name: "杠铃卧推",
            muscle: "chest",
            equipment: "barbell",
            mode: "reps",
            volumeMultiplier: 1,
          },
          sets: 4,
          weight: 100,
          reps: 6,
          seconds: 0,
          backup: { id: "db_bench", name: "哑铃卧推" },
        },
      ],
    };

    const normalSeed = buildWorkoutSeedFromRoutine(payload, {
      date: "2026-11-27",
      prefs: { ...DEFAULT_WORKOUT_PREFERENCES, deloadMode: false },
      makeId: () => `id_${++seq}`,
    });
    assert.equal(normalSeed.title, "上肢推日");
    assert.equal(normalSeed.date, "2026-11-27");
    assert.equal(normalSeed.exercises?.length, 1);
    const ex = normalSeed.exercises![0]!;
    assert.equal(ex.backupExerciseId, "db_bench");
    assert.equal(ex.weightUnit, "kg");
    const warmups = ex.sets.filter((s) => s.type === "warmup");
    const work = ex.sets.filter((s) => s.type === "normal");
    assert.ok(warmups.length >= 2, "autoWarmup prepends scaled warmup sets");
    assert.equal(work.length, 4);
    assert.equal(work[0]!.weight, 100);

    const deloadSeed = buildWorkoutSeedFromRoutine(payload, {
      prefs: { ...DEFAULT_WORKOUT_PREFERENCES, deloadMode: true, deloadWeightPct: 80, deloadSetsPct: 60 },
      makeId: () => `dl_${++seq}`,
    });
    const dlWork = deloadSeed.exercises![0]!.sets.filter((s) => s.type === "normal");
    assert.ok(dlWork.length < 4, "deload reduces working sets");
    assert.equal(dlWork[0]!.weight, 80);
  });

  it("Item 2: useUiStore tracks innerOverlayDismiss and clears it on closeAllModals/closeModalSilent", () => {
    let dismissed = false;
    useUiStore.getState().setInnerOverlayDismiss(() => {
      dismissed = true;
    });
    assert.equal(typeof useUiStore.getState().innerOverlayDismiss, "function");
    useUiStore.getState().innerOverlayDismiss?.();
    assert.equal(dismissed, true);

    useUiStore.getState().closeAllModals();
    assert.equal(useUiStore.getState().innerOverlayDismiss, null);

    useUiStore.getState().setInnerOverlayDismiss(() => {});
    useUiStore.getState().closeModalSilent();
    assert.equal(useUiStore.getState().innerOverlayDismiss, null);
  });

  it("Item 4 & 5: backfill mode detection and PR auto-advance delay buffer behave accurately", () => {
    assert.equal(isBackfillWorkoutDate("2026-11-26", "2026-11-27", false), true);
    assert.equal(isBackfillWorkoutDate("2026-11-27", "2026-11-27", false), false);
    assert.equal(isBackfillWorkoutDate("2026-11-26", "2026-11-27", true), false);

    assert.equal(resolveAutoAdvanceDelayMs(false), 320);
    assert.equal(resolveAutoAdvanceDelayMs(true), 1300);
  });

  it("Regression guard: WorkoutEditorModal calls real /api/web/exercise-history/:id route & wires innerOverlayDismiss", () => {
    const editorSrc = readFileSync("packages/web/src/components/workout/WorkoutEditorModal.tsx", "utf8");
    assert.ok(
      editorSrc.includes("/api/web/exercise-history/"),
      "Quick history drawer must hit /api/web/exercise-history/:id",
    );
    assert.ok(
      !editorSrc.includes("/api/web/exercises/${encodeURIComponent(exerciseId)}/history"),
      "Old broken /api/web/exercises/:id/history URL must not exist",
    );
    assert.ok(editorSrc.includes("setInnerOverlayDismiss"), "WorkoutEditorModal must register innerOverlayDismiss");

    const reportSrc = readFileSync("packages/web/src/components/workout/WorkoutReportModal.tsx", "utf8");
    assert.ok(reportSrc.includes("justCompleted"), "WorkoutReportModal should adapt primary CTA when justCompleted");
    assert.ok(reportSrc.includes("report-sync-banner"), "WorkoutReportModal should highlight active plan sync banner");
  });
});
