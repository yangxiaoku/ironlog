import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  encodeWorkoutToFit,
  evaluateStrengthStandards,
  nextTarget,
  validateWorkoutAdjustment,
  type Workout,
} from "@ironlog/shared";
import { parseFlexibleInstant, summarizeDailyHealth } from "../packages/server/dist/apple-health-daily.js";
import { createApp } from "../packages/server/dist/app.js";
import { openDatabase } from "../packages/server/dist/db.js";
import { getTrainingContext } from "../packages/server/dist/stats.js";
import { buildCoachQuickAdvice } from "../packages/web/src/lib/coach-quick.ts";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (rel: string) => readFileSync(path.join(rootDir, rel), "utf8");

function makeServer() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  return { db, store, auth, app };
}

async function registerCookieUser(app: ReturnType<typeof createApp>["app"], username: string, password = "Password123!") {
  const res = await app.request("http://localhost/auth/web/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 201);
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie.startsWith("ironlog_session="));
  const body = (await res.json()) as { userId: string };
  return { userId: body.userId, cookie };
}

function cookieHeaders(cookie: string, userId: string, json = false): Record<string, string> {
  return {
    Cookie: cookie,
    Origin: "http://localhost",
    "X-Ironlog-Account": userId,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

test("R11 #123: FIT 2.0 developer field IDs, uint32 base type 0x86, and assisted mode excluded from totalVolumeKg", () => {
  const workout: Workout = {
    date: "2026-11-27",
    title: "推拉混合",
    startedAt: "2026-11-27T08:00:00.000Z",
    endedAt: "2026-11-27T08:45:00.000Z",
    status: "completed",
    notes: "",
    feeling: null,
    exercises: [
      {
        id: "ex_row_1",
        exerciseId: "barbell-bench-press",
        restSeconds: 90,
        snapshot: { name: "平板杠铃卧推", muscle: "chest", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
        sets: [{ id: "s1", type: "normal", weight: 100, reps: 5, seconds: 0, completed: true, rir: 2 }],
      },
      {
        id: "ex_row_2",
        exerciseId: "assisted-pull-up",
        restSeconds: 90,
        snapshot: { name: "辅助引体向上", muscle: "back", equipment: "machine", mode: "assisted", volumeMultiplier: 1 },
        sets: [{ id: "s2", type: "normal", weight: 30, reps: 10, seconds: 0, completed: true, rir: 2 }],
      },
    ],
  };

  const fitBytes = encodeWorkoutToFit(workout);
  const dv = new DataView(fitBytes.buffer, fitBytes.byteOffset, fitBytes.byteLength);
  assert.equal(fitBytes[0], 14);
  assert.equal(fitBytes[1], 0x20);

  // Locate msg 207 (local 4 -> 0x44) and msg 206 (local 5 -> 0x45)
  let msg207DefPos = -1;
  let msg206DefPos = -1;
  for (let i = 14; i < fitBytes.length - 10; i++) {
    if (fitBytes[i] === 0x44 && fitBytes[i + 1] === 0x00 && fitBytes[i + 2] === 0x00 && dv.getUint16(i + 3, true) === 207) {
      msg207DefPos = i;
    }
    if (fitBytes[i] === 0x45 && fitBytes[i + 1] === 0x00 && fitBytes[i + 2] === 0x00 && dv.getUint16(i + 3, true) === 206) {
      msg206DefPos = i;
    }
  }
  assert.ok(msg207DefPos >= 14, "msg 207 (developer_data_id) definition must exist");
  assert.ok(msg206DefPos >= 14, "msg 206 (field_description) definition must exist");

  // Msg 207 has field 1 (application_id) and field 3 (developer_data_index) — NOT field 2
  const fieldCount207 = fitBytes[msg207DefPos + 5]!;
  assert.equal(fieldCount207, 2);
  assert.equal(fitBytes[msg207DefPos + 6], 1);
  assert.equal(fitBytes[msg207DefPos + 9], 3, "developer_data_index must be FIT field number 3");

  // Msg 206 data record (local 5 -> 0x05): field 2 (fit_base_type_id) === 0x86 (134)
  const fieldCount206 = fitBytes[msg206DefPos + 5]!;
  const msg206DataStart = msg206DefPos + 6 + fieldCount206 * 3;
  assert.equal(fitBytes[msg206DataStart], 0x05, "msg 206 data header local type 5");
  assert.equal(fitBytes[msg206DataStart + 3], 0x86, "uint32 fit_base_type_id must be 0x86 (134)");

  // Session definition with dev fields flag (local 2 -> 0x62, global msg 18)
  let sessionDefPos = -1;
  for (let i = 14; i < fitBytes.length - 10; i++) {
    if (fitBytes[i] === 0x62 && fitBytes[i + 1] === 0x00 && fitBytes[i + 2] === 0x00 && dv.getUint16(i + 3, true) === 18) {
      sessionDefPos = i;
      break;
    }
  }
  assert.ok(sessionDefPos >= 14, "session definition with dev fields flag (0x62) must exist");
  const stdFieldCount = fitBytes[sessionDefPos + 5]!;
  const devCountPos = sessionDefPos + 6 + stdFieldCount * 3;
  const devFieldCount = fitBytes[devCountPos]!;
  assert.equal(devFieldCount, 1);
  const sessionDataPos = devCountPos + 1 + devFieldCount * 3;
  assert.equal(fitBytes[sessionDataPos], 0x02);
  let stdByteLen = 0;
  for (let f = 0; f < stdFieldCount; f++) stdByteLen += fitBytes[sessionDefPos + 6 + f * 3 + 1]!;
  // total_volume_kg is scaled by 10 -> 500 kg * 10 = 5000 (assisted pull-up 30x10 excluded!)
  const totalVolScaled = dv.getUint32(sessionDataPos + 1 + stdByteLen, true);
  assert.equal(totalVolScaled, 5000, "assisted pull-up 30x10 must NOT be counted in totalVolumeKg (bench 100x5 = 500 -> 5000)");
});

test("R11 #124: API Bearer tokens expire, are blocked from sensitive security/replace endpoints, and revoke on password change", async () => {
  const { db, app } = makeServer();
  const { userId, cookie } = await registerCookieUser(app, "r11_token_user", "OldPass123!");

  // Issue an API token via web session cookie
  const issueRes = await app.request("http://localhost/api/tokens", {
    method: "POST",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({ label: "MCP Client" }),
  });
  assert.equal(issueRes.status, 201);
  const issued = (await issueRes.json()) as { token: string };
  assert.ok(issued.token.startsWith("tj_"));
  const listRes = await app.request("http://localhost/api/tokens", {
    headers: cookieHeaders(cookie, userId),
  });
  assert.equal(listRes.status, 200);
  const tokenRows = (await listRes.json()) as Array<{ label: string; expiresAt: string | null }>;
  const mcpRow = tokenRows.find((t) => t.label === "MCP Client");
  assert.ok(mcpRow?.expiresAt, "API token must have a default expiry");

  // API token works on normal data endpoint
  const okToday = await app.request("http://localhost/api/web/today", {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(okToday.status, 200);

  // API token is blocked (403) on sensitive endpoints
  const blockedPairing = await app.request("http://localhost/api/web/auth/pairing-code", {
    method: "POST",
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(blockedPairing.status, 403);

  const blockedPasskeys = await app.request("http://localhost/api/web/auth/passkeys", {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(blockedPasskeys.status, 403);

  const blockedTokens = await app.request("http://localhost/api/tokens", {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(blockedTokens.status, 403);

  const blockedPwd = await app.request("http://localhost/api/web/password", {
    method: "POST",
    headers: { Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "OldPass123!", newPassword: "NewPass456!" }),
  });
  assert.equal(blockedPwd.status, 403);

  const blockedReplaceRestore = await app.request("http://localhost/api/web/restore-backup", {
    method: "POST",
    headers: { Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "commit", strategy: "replace", backup: {} }),
  });
  assert.equal(blockedReplaceRestore.status, 403);

  // Generate pairing code with real cookie session before password change
  const pairRes = await app.request("http://localhost/api/web/auth/pairing-code", {
    method: "POST",
    headers: cookieHeaders(cookie, userId),
  });
  assert.equal(pairRes.status, 201);
  const { code } = (await pairRes.json()) as { code: string };

  // Change password via web session cookie
  const chPwd = await app.request("http://localhost/api/web/password", {
    method: "POST",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({ currentPassword: "OldPass123!", newPassword: "NewPass456!" }),
  });
  assert.equal(chPwd.status, 200);

  // Previously issued API token must now be revoked (401)
  const afterPwdToken = await app.request("http://localhost/api/web/today", {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  assert.equal(afterPwdToken.status, 401);

  // Previously generated pairing code must also be revoked
  const redeemAfterPwd = await app.request("http://localhost/auth/web/pairing/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ code }),
  });
  assert.notEqual(redeemAfterPwd.status, 200);
  db.close();
});

test("R11 #125: shifting schedule into a cleared (tombstoned) date succeeds with expectedToVersion: 0", async () => {
  const { db, app } = makeServer();
  const { userId, cookie } = await registerCookieUser(app, "r11_sched_user");

  // Save & delete 2026-12-10 to create a deleted tombstone (version 2)
  const putTarget = await app.request("http://localhost/api/web/schedule/2026-12-10", {
    method: "PUT",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({ mode: "rest", title: "休息", expectedVersion: 0 }),
  });
  assert.equal(putTarget.status, 200);
  const delTarget = await app.request("http://localhost/api/web/schedule/2026-12-10", {
    method: "DELETE",
    headers: cookieHeaders(cookie, userId),
  });
  assert.equal(delTarget.status, 200);

  // GET confirms override: null (version 0 from client's view)
  const getTarget = await app.request("http://localhost/api/web/schedule/2026-12-10", {
    headers: cookieHeaders(cookie, userId),
  });
  const targetJson = (await getTarget.json()) as { override: unknown };
  assert.equal(targetJson.override, null);

  // Create workout override on 2026-12-09
  const putFrom = await app.request("http://localhost/api/web/schedule/2026-12-09", {
    method: "PUT",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({
      mode: "workout",
      title: "推举日",
      exercises: [
        {
          exerciseId: "bench-press",
          sets: 3,
          repsMin: 6,
          repsMax: 8,
          weight: 60,
          seconds: 0,
          restSeconds: 90,
          targetRir: 2,
          progression: "double",
          increment: 2.5,
        },
      ],
      expectedVersion: 0,
    }),
  });
  assert.equal(putFrom.status, 200);

  // Shift 2026-12-09 -> 2026-12-10 with expectedFromVersion: 1, expectedToVersion: 0
  const shiftRes = await app.request("http://localhost/api/web/schedule/shift", {
    method: "POST",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({
      fromDate: "2026-12-09",
      toDate: "2026-12-10",
      expectedFromVersion: 1,
      expectedToVersion: 0,
    }),
  });
  assert.equal(shiftRes.status, 200);
  db.close();
});

test("R11 #126: parseFlexibleInstant uses explicit +08:00 offset independent of TZ=UTC", () => {
  assert.equal(parseFlexibleInstant("2026年4月1日 22:30"), "2026-04-01T14:30:00.000Z");
  const timeOnlyRes = parseFlexibleInstant("22:30");
  assert.ok(timeOnlyRes && timeOnlyRes.endsWith("T14:30:00.000Z"));

  const subOut = execFileSync(
    process.execPath,
    [
      "-e",
      `import { parseFlexibleInstant } from "./packages/server/dist/apple-health-daily.js"; console.log(parseFlexibleInstant("2026年4月1日 22:30"));`,
    ],
    { cwd: rootDir, env: { ...process.env, TZ: "UTC" }, encoding: "utf8" },
  ).trim();
  assert.equal(subOut, "2026-04-01T14:30:00.000Z");
});

test("R11 #127: recovery uses per-metric sample count & flags critical SpO2/RR; body comp aligns dates & fresh BMI", () => {
  const dailyRecovery = summarizeDailyHealth(
    [
      { date: "2026-11-25", waterMl: 2000 },
      { date: "2026-11-26", waterMl: 2100 },
      {
        date: "2026-11-27",
        restingHeartRateBpm: 92,
        hrvMs: 15,
        bloodOxygenPct: 88,
        respiratoryRateBpm: 28,
      },
    ],
    { heightCm: 179 },
  );
  const rhrSig = dailyRecovery.recoveryReport.signals.find((s) => s.key === "restingHeartRateBpm");
  const hrvSig = dailyRecovery.recoveryReport.signals.find((s) => s.key === "hrvMs");
  assert.ok(rhrSig && rhrSig.score < 70, `critical single-day RHR 92 must not score 92 (got ${rhrSig?.score})`);
  assert.ok(hrvSig && hrvSig.score < 70, `critical single-day HRV 15 must not score 92 (got ${hrvSig?.score})`);
  const insightsText = (dailyRecovery.recoveryReport.insights ?? []).join(" ");
  assert.ok(
    /血氧|呼吸/.test(insightsText),
    `insights should flag critical SpO2/RR, got: ${insightsText}`,
  );

  const dailyBody = summarizeDailyHealth(
    [
      { date: "2026-11-25", weightKg: 80, bmi: 25.0, leanBodyMassKg: 64 },
      { date: "2026-11-27", weightKg: 62 },
    ],
    { heightCm: 179 },
  );
  assert.equal(dailyBody.bodyReport.bmi, 19.4, "fresh weightKg + heightCm must override stale older rawBmi");
  assert.equal(dailyBody.bodyReport.leanSharePct, null, "stale cross-day leanBodyMassKg > weightKg must not yield 103.2%");
});

test("R11 #128 & #114 server: +08:00 offset accepted in refs/PRs, invalid scheduled date returns 400, assisted history volume=0 & topReps tiebreak", async () => {
  const { db, app } = makeServer();
  const { userId, cookie } = await registerCookieUser(app, "r11_ref_user");

  const refRes = await app.request("http://localhost/api/web/exercise-references", {
    method: "POST",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({
      date: "2026-11-27",
      startedAt: "2026-11-27T10:00:00+08:00",
      exercises: [{ id: "barbell-bench-press", mode: "reps" }],
    }),
  });
  assert.equal(refRes.status, 200);

  const prRes = await app.request("http://localhost/api/web/exercise-prs", {
    method: "POST",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({
      date: "2026-11-27",
      startedAt: "2026-11-27T10:00:00+08:00",
      exercises: [{ id: "barbell-bench-press", mode: "reps" }],
    }),
  });
  assert.equal(prRes.status, 200);

  const badRoutine = await app.request("http://localhost/api/web/routine?source=scheduled&id=not-a-date", {
    headers: cookieHeaders(cookie, userId),
  });
  assert.equal(badRoutine.status, 400);

  // Assisted exercise history (#114)
  const saveAssisted = await app.request("http://localhost/api/records", {
    method: "POST",
    headers: cookieHeaders(cookie, userId, true),
    body: JSON.stringify({
      opId: "op_assisted_1",
      id: "w_assisted_1",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        date: "2026-11-27",
        title: "背",
        startedAt: "2026-11-27T08:00:00+08:00",
        endedAt: "2026-11-27T08:30:00+08:00",
        status: "completed",
        exercises: [
          {
            id: "r1",
            exerciseId: "assisted-pull-up",
            restSeconds: 90,
            snapshot: { name: "辅助引体向上", muscle: "back", equipment: "machine", mode: "assisted", volumeMultiplier: 1 },
            sets: [
              { id: "s1", type: "normal", weight: 20, reps: 6, seconds: 0, completed: true, rir: 2 },
              { id: "s2", type: "normal", weight: 20, reps: 10, seconds: 0, completed: true, rir: 1 },
            ],
          },
        ],
      },
    }),
  });
  assert.equal(saveAssisted.status, 200);

  const histRes = await app.request("http://localhost/api/web/exercise-history/assisted-pull-up", {
    headers: cookieHeaders(cookie, userId),
  });
  assert.equal(histRes.status, 200);
  const hist = (await histRes.json()) as { sessions: Array<{ volume: number; topWeight: number; topReps: number }> };
  assert.equal(hist.sessions.length, 1);
  assert.equal(hist.sessions[0]!.volume, 0);
  assert.equal(hist.sessions[0]!.topWeight, 20);
  assert.equal(hist.sessions[0]!.topReps, 10);
  db.close();
});

test("R11 #129: nextTarget ignores drop sets, adaptation rejects 0-rep clone template, strength standard compares unrounded ratio, context preserves unset sex", () => {
  const prog = nextTarget(
    {
      exerciseId: "barbell-squat",
      sets: 3,
      repsMin: 5,
      repsMax: 5,
      weight: 100,
      seconds: 0,
      restSeconds: 180,
      targetRir: 2,
      progression: "greyskull",
      increment: 2.5,
      deloadMissThreshold: 2,
    },
    {
      id: "prev_row",
      exerciseId: "barbell-squat",
      restSeconds: 180,
      snapshot: { name: "深蹲", muscle: "legs", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
      sets: [
        { id: "p1", type: "normal", weight: 100, reps: 6, seconds: 0, completed: true, rir: 2 },
        { id: "p2", type: "normal", weight: 100, reps: 6, seconds: 0, completed: true, rir: 2 },
        { id: "p3", type: "normal", weight: 100, reps: 6, seconds: 0, completed: true, rir: 2 },
        { id: "p4", type: "drop", weight: 80, reps: 10, seconds: 0, completed: true, rir: 0 },
      ],
    },
    "reps",
  );
  assert.ok(!prog.deloaded);
  assert.equal(prog.weight, 102.5);

  const openSets = [
    { id: "a", type: "normal" as const, weight: 60, reps: 10, seconds: 0, completed: false, rir: null },
    { id: "b", type: "normal" as const, weight: 60, reps: 0, seconds: 0, completed: false, rir: null },
  ];
  assert.throws(
    () =>
      validateWorkoutAdjustment(
        {
          date: "2026-11-27",
          title: "胸",
          startedAt: "2026-11-27T08:00:00Z",
          endedAt: null,
          status: "active",
          notes: "",
          feeling: null,
          exercises: [
            {
              id: "row1",
              exerciseId: "bench-press",
              restSeconds: 90,
              snapshot: { name: "卧推", muscle: "chest", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
              sets: openSets,
            },
          ],
        },
        {
          exerciseRowId: "row1",
          kind: "adjust_sets",
          summary: "加组",
          reason: "加组",
          before: {
            exerciseId: "bench-press",
            restSeconds: 90,
            openSets,
          },
          patch: {
            remainingSets: 4,
          },
        },
        [
          {
            id: "bench-press",
            name: "卧推",
            muscle: "chest",
            equipment: "barbell",
            mode: "reps",
            volumeMultiplier: 1,
          },
        ],
      ),
    /训练动作需要有效的次数/,
    "cloning a 0-rep open template set must be rejected",
  );

  const std = evaluateStrengthStandards({ squat: 79.7 }, 80, "male");
  const squatStd = std.find((e) => e.key === "squat");
  assert.equal(squatStd?.tier, "untrained", "0.99625x BW squat must NOT round up to 1.00x novice");

  const { db, store } = makeServer();
  const ctx = getTrainingContext(store, "unset_sex_user", 14);
  assert.equal(ctx.profile.energyProfile ?? null, null);
  db.close();
});

test("R11 #114 frontend: coach quick pain adjustment increases assistance weight for assisted mode", () => {
  const advice = buildCoachQuickAdvice(
    "pain",
    {
      id: "row_assisted",
      exerciseId: "assisted-pull-up",
      restSeconds: 90,
      snapshot: { name: "辅助引体向上", muscle: "back", equipment: "machine", mode: "assisted", volumeMultiplier: 1 },
      sets: [
        { id: "s1", type: "normal", weight: 30, reps: 8, seconds: 0, completed: false, rir: null },
      ],
    },
    2.5,
  );
  assert.equal(advice.actionKind, "apply_sets");
  assert.ok(advice.actionLabel.includes("增加"));
  const adjusted = advice.apply!(
    {
      id: "row_assisted",
      exerciseId: "assisted-pull-up",
      restSeconds: 90,
      snapshot: { name: "辅助引体向上", muscle: "back", equipment: "machine", mode: "assisted", volumeMultiplier: 1 },
      sets: [{ id: "s1", type: "normal", weight: 30, reps: 8, seconds: 0, completed: false, rir: null }],
    },
    2.5,
  );
  assert.ok(adjusted.sets[0]!.weight > 30, `assisted pain deload must increase assistance (got ${adjusted.sets[0]!.weight})`);
});

test("R11 #112-#122 & UX/Perf/A11y source invariants", () => {
  const editor = readSrc("packages/web/src/components/workout/WorkoutEditorModal.tsx");
  const report = readSrc("packages/web/src/components/workout/WorkoutReportModal.tsx");
  const picker = readSrc("packages/web/src/components/workout/ExercisePickerModal.tsx");
  const planList = readSrc("packages/web/src/components/plan/PlannedExerciseList.tsx");
  const planModals = readSrc("packages/web/src/components/plan/PlanModals.tsx");
  const liveBar = readSrc("packages/web/src/components/LiveWorkoutBar.tsx");
  const analytics = readSrc("packages/web/src/views/AnalyticsView.tsx");
  const charts = readSrc("packages/web/src/components/Charts.tsx");
  const api = readSrc("packages/web/src/lib/api.ts");
  const security = readSrc("packages/web/src/components/settings/AccountSecurityCards.tsx");
  const dietView = readSrc("packages/web/src/views/DietView.tsx");
  const dietModal = readSrc("packages/web/src/components/diet/DietEditorModal.tsx");
  const tplModal = readSrc("packages/web/src/components/diet/MealTemplateModal.tsx");
  const calc = readSrc("packages/web/src/components/tools/StrengthCalcModal.tsx");
  const modalHost = readSrc("packages/web/src/components/ModalHost.tsx");
  const appShell = readSrc("packages/web/src/components/AppShell.tsx");
  const moreSheet = readSrc("packages/web/src/components/MoreSheet.tsx");
  const mainTsx = readSrc("packages/web/src/main.tsx");
  const appTsx = readSrc("packages/web/src/App.tsx");
  const indexHtml = readSrc("packages/web/index.html");

  // #112: both AI onApplied callbacks advance effectiveBaseVersionRef
  assert.ok((editor.match(/effectiveBaseVersionRef\.current = updated\.version/g) ?? []).length >= 2);
  // #113: pre-computed updatedCount + exWeightStep
  assert.ok(editor.includes("exWeightStep") && editor.includes("渐进 -${exWeightStep}"));
  // #115: unit in report copy, setsMax/isDeload/deloadMissThreshold in sanitizeTargetSnapshot
  assert.ok(report.includes("formatSetValue(s, row.mode, row.weightUnit)"));
  assert.ok(editor.includes("setsMax") && editor.includes("deloadMissThreshold") && editor.includes("r.isDeload === true"));
  // #116: picker race guard, cached custom exercises, openingRevisionRef, dupRoutine isDeload
  assert.ok(picker.includes("searchGenRef"));
  assert.ok(planList.includes("customPool") && planList.includes("setsMax: Math.min(20"));
  assert.ok(planModals.includes("openingRevisionRef") && planModals.includes("currentRoutine.isDeload"));
  // #117 & UX #6: Charts role="group", touchAction pan-y, range readout
  assert.ok(!charts.includes('role="img"') && charts.includes('role="group"') && charts.includes('touchAction: "pan-y"'));
  assert.ok(analytics.includes("1.5–2.0 略单一") && analytics.includes("低于静息"));
  // #118: READ_ONLY_POST_PATHS & whDirty
  assert.ok(api.includes('"/api/web/webhook/test"') && api.includes('"/api/web/auth/pairing-code"'));
  assert.ok(security.includes("whDirty"));
  // #119 & UX #7: diet validation, step=1, skipMutateHook, string controlled template, pendingSaveRef
  assert.ok(dietView.includes("step={1}") && dietView.includes("skipMutateHook: true"));
  assert.ok(dietModal.includes("reportValidity()") && dietModal.includes('aria-label="热量 (kcal)"'));
  assert.ok(tplModal.includes("pendingSaveRef") && tplModal.includes("interface EditableTemplateFood"));
  // #121 & UX #8: platePairs & lb in StrengthCalcModal, dietHidden weight entry
  assert.ok(calc.includes("plateBreakdown(targetKg, barWeight, enabledPlates, platePairs)") && calc.includes("limitedByInventory"));
  assert.ok(appShell.includes("dietHidden") && appShell.includes("flushingQueue"));
  assert.ok(moreSheet.includes('prefetchViewChunk("analytics")'));
  // #122 & Perf #1 & UX #3 #4 #8
  assert.ok(modalHost.includes("NestedConfirmOverlay") && modalHost.includes("el.inert = true"));
  assert.ok(editor.includes("LiveElapsedClock") && editor.includes("InnerOverlayDialog") && editor.includes('enterKeyHint="next"'));
  assert.ok(!liveBar.includes("setInterval(refresh, 500)") && liveBar.includes("WORKOUT_DRAFT_EVENT"));
  assert.ok(mainTsx.includes("setPwaUpdateRunner") && appTsx.includes("ViewErrorBoundary"));
  assert.ok(!indexHtml.includes("user-scalable=no") && !indexHtml.includes("maximum-scale=1.0"));
});
