import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as signData } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateExerciseProgression,
  evaluateWeightChangeRate,
  localDate,
  resolveRoutineWithTelemetry,
  type Workout,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { readHealthDataExport } from "../packages/server/src/health-data-export.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import { getWebBadges } from "../packages/server/src/web-badges.js";
import { previewWorkoutCsvImport } from "../packages/server/src/web-import.js";
import { getWebStatistics, shiftDay } from "../packages/server/src/web-statistics.js";
import { getWebWorkoutReport } from "../packages/server/src/web-workout-report.js";
import { deliverWebhookEvent, isPrivateIpAddress, isPrivateWebhookUrl } from "../packages/server/src/webhook.js";
import {
  buildCardioWorkoutMutation,
  estimateCardioCalories,
  formatCardioPaceOrSpeed,
  parseCardioDistanceKm,
  recordCardioLap,
  type LiveCardioSession,
} from "../packages/web/src/lib/cardio-session.js";
import { triggerRestFinalCountdownBeep } from "../packages/web/src/lib/haptics-audio.js";
import { buildDailySharePayload } from "../packages/web/src/lib/share-card.js";

function makeCtx(config: Parameters<typeof createApp>[1] = {}) {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db, config);
  const userA = auth.login("r8910_a");
  const userB = auth.login("r8910_b");
  const call = (
    path: string,
    opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) =>
    app.request(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(opts.token !== "" ? { Authorization: `Bearer ${opts.token ?? userA.token}` } : {}),
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  return { db, store, auth, userA, userB, app, call };
}

function makePasskeyKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  return { publicKey, privateKey, spki };
}

function makeAuthData(rpId: string, signCount: number): Buffer {
  const rpHash = createHash("sha256").update(rpId).digest();
  const flags = Buffer.from([0x05]); // UP + UV
  const cnt = Buffer.alloc(4);
  cnt.writeUInt32BE(signCount, 0);
  return Buffer.concat([rpHash, flags, cnt]);
}

// ============================================================
// Round 10 Security & Auth (#96 P0, #97 P1, #98 P2, #99 P2)
// ============================================================

test("#96 (P0) & #98 (P2) 通行密钥拒绝跨账号凭据覆盖、不泄露 allowCredentials、拦截 signCount=0 克隆与畸形 clientDataJSON", async () => {
  const { db, app, userA, userB } = makeCtx();
  try {
    const origin = "http://localhost";
    const rpId = "localhost";
    const victimCredId = "victim-passkey-cred-001";
    const victimKeys = makePasskeyKeyPair();
    const attackerKeys = makePasskeyKeyPair();

    // Register victim's passkey on userA
    const regOptA = await app.request(`${origin}/api/web/auth/passkey/register/options`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA.token}`, Origin: origin },
    });
    assert.equal(regOptA.status, 200);
    const { challenge: chA } = (await regOptA.json()) as { challenge: string };
    const clientDataA = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: chA, origin })).toString("base64url");
    const regVerA = await app.request(`${origin}/api/web/auth/passkey/register/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA.token}`, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ credentialId: victimCredId, publicKeySpki: victimKeys.spki, clientDataJSON: clientDataA }),
    });
    assert.equal(regVerA.status, 201);

    // #96a: Unauthenticated login/options MUST NOT leak allowCredentials for any username
    const loginOptLeak = await app.request(`${origin}/auth/web/passkey/login/options`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "r8910_a" }),
    });
    assert.equal(loginOptLeak.status, 200);
    const loginOptBody = (await loginOptLeak.json()) as { allowCredentials?: unknown; challenge: string };
    assert.equal(loginOptBody.allowCredentials, undefined);

    // #96b: Attacker userB tries to register the SAME credentialId with attacker's public key -> MUST be rejected 409!
    const regOptB = await app.request(`${origin}/api/web/auth/passkey/register/options`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userB.token}`, Origin: origin },
    });
    const { challenge: chB } = (await regOptB.json()) as { challenge: string };
    const clientDataB = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: chB, origin })).toString("base64url");
    const takeoverAttempt = await app.request(`${origin}/api/web/auth/passkey/register/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userB.token}`, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ credentialId: victimCredId, publicKeySpki: attackerKeys.spki, clientDataJSON: clientDataB }),
    });
    assert.equal(takeoverAttempt.status, 409);

    // #98a: Malformed clientDataJSON ("bnVsbA" -> JSON null) returns 400 (NOT 500!)
    const badClientRes = await app.request(`${origin}/auth/web/passkey/login/verify`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialId: victimCredId,
        authenticatorData: makeAuthData(rpId, 1).toString("base64url"),
        clientDataJSON: Buffer.from("null").toString("base64url"),
        signature: "AAAA",
      }),
    });
    assert.equal(badClientRes.status, 400);

    // #98b: Valid login with signCount=10 succeeds, then signCount=0 MUST be rejected 401 (no clone bypass!)
    const doLogin = async (count: number) => {
      const optRes = await app.request(`${origin}/auth/web/passkey/login/options`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const { challenge } = (await optRes.json()) as { challenge: string };
      const cdBuf = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin }));
      const authData = makeAuthData(rpId, count);
      const sig = signData("sha256", Buffer.concat([authData, createHash("sha256").update(cdBuf).digest()]), victimKeys.privateKey);
      return app.request(`${origin}/auth/web/passkey/login/verify`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: victimCredId,
          authenticatorData: authData.toString("base64url"),
          clientDataJSON: cdBuf.toString("base64url"),
          signature: sig.toString("base64url"),
        }),
      });
    };
    assert.equal((await doLogin(10)).status, 200);
    assert.equal((await doLogin(9)).status, 401);
    assert.equal((await doLogin(0)).status, 401);
    assert.equal((await doLogin(11)).status, 200);
  } finally {
    db.close();
  }
});

test("#97 (P1) & #99 (P2) Webhook 拦尾点域名与 IPv4 嵌入型 IPv6；反代多级 X-Forwarded-Proto/:443 与非法 Origin 正确处理", async () => {
  const { db, app, userA } = makeCtx({ trustProxy: true, allowPrivateWebhooks: false });
  try {
    // #97: Trailing dots & IPv6 bypass variants MUST all be flagged private & rejected with 400
    assert.equal(isPrivateIpAddress("0:0:0:0:0:0:0:1"), true);
    assert.equal(isPrivateIpAddress("64:ff9b::169.254.169.254"), true);
    assert.equal(isPrivateIpAddress("::127.0.0.1"), true);
    assert.equal(isPrivateIpAddress("fec0::1"), true);
    assert.equal(isPrivateIpAddress("2002:7f00:1::"), true);
    assert.equal(isPrivateIpAddress("2606:4700:4700::1111"), false);

    const bypassUrls = [
      "http://localhost.:8080/hook",
      "http://metadata.google.internal./latest",
      "http://redis.:6379/",
      "http://[64:ff9b::169.254.169.254]/latest",
      "http://[::127.0.0.1]:8080/hook",
      "http://[fec0::1]/hook",
    ];
    for (const url of bypassUrls) {
      assert.equal(isPrivateWebhookUrl(url), true, `Expected private: ${url}`);
      const res = await app.request("http://localhost/api/web/profile/webhook", {
        method: "PUT",
        headers: { Authorization: `Bearer ${userA.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, url, secret: "", allowPrivateNetwork: true }),
      });
      assert.equal(res.status, 400, `Expected 400 for ${url}`);
    }
    const deliv = await deliverWebhookEvent(
      { enabled: true, url: "http://[64:ff9b::169.254.169.254]/latest", secret: "", allowPrivateNetwork: false },
      "webhook.test",
      {},
      async () => { throw new Error("should not reach fetcher"); },
      { allowPrivateNetwork: false },
    );
    assert.equal(deliv.delivered, false);

    // #99a: Multi-hop X-Forwarded-Proto & :443 default port work behind trusted proxy (no 403!)
    const regMultiProto = await app.request("http://ironlog.example.com/auth/web/register", {
      method: "POST",
      headers: {
        "X-Forwarded-Proto": "https, http",
        Origin: "https://ironlog.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "proxy_user_1", password: "StrongPassword123!" }),
    });
    assert.equal(regMultiProto.status, 201);

    const regPort443 = await app.request("http://ironlog.example.com:443/auth/web/register", {
      method: "POST",
      headers: {
        "X-Forwarded-Proto": "https",
        Origin: "https://ironlog.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "proxy_user_2", password: "StrongPassword123!" }),
    });
    assert.equal(regPort443.status, 201);

    // #99b: Bearer + Origin: null on passkey register options returns 400 (NOT 500!)
    const badOriginRes = await app.request("http://localhost/api/web/auth/passkey/register/options", {
      method: "POST",
      headers: { Authorization: `Bearer ${userA.token}`, Origin: "null" },
    });
    assert.equal(badOriginRes.status, 400);
  } finally {
    db.close();
  }
});

// ============================================================
// Round 10 Plan, Adherence, Deload, Badges, Stats & Imports (#100-#109)
// ============================================================

test("#100 (P1), #102, #103, #104 (P1), #105, #106, #107, #109 计划导入、执行率、减载阈值、徽章磅制、统计与导入边界", async () => {
  const { db, store, userA, call } = makeCtx();
  try {
    const today = localDate();
    const yest = shiftDay(today, -1);

    // #100: Plan JSON import preserves weightUnit, triple, setsMax, deloadMissThreshold, isDeload, null->defaults, rejects soft-deleted custom exercise in preview
    const importRes = await call("/api/web/plans/import-json", {
      body: {
        mode: "preview",
        json: JSON.stringify({
          name: "三重磅制测试",
          weeks: null,
          schedule: "rotation",
          routines: [
            {
              id: "d1",
              name: "推日减载",
              isDeload: true,
              exercises: [
                {
                  exerciseId: "bench-press",
                  sets: 3,
                  setsMax: 5,
                  repsMin: 8,
                  repsMax: 12,
                  weight: 135,
                  weightUnit: "lb",
                  progression: "triple",
                  deloadMissThreshold: 4,
                  restSeconds: null,
                  targetRir: null,
                  increment: null,
                },
              ],
            },
          ],
        }),
      },
    });
    assert.equal(importRes.status, 200);
    const imp = (await importRes.json()) as { plan: { weeks: number; routines: Array<{ isDeload?: boolean; exercises: Array<Record<string, unknown>> }> } };
    assert.equal(imp.plan.weeks, 8);
    assert.equal(imp.plan.routines[0]!.isDeload, true);
    const ex0 = imp.plan.routines[0]!.exercises[0]!;
    assert.equal(ex0.weightUnit, "lb");
    assert.equal(ex0.progression, "triple");
    assert.equal(ex0.setsMax, 5);
    assert.equal(ex0.deloadMissThreshold, 4);
    assert.equal(ex0.restSeconds, 90);
    assert.equal(ex0.targetRir, 2);
    assert.equal(ex0.increment, 5);

    // Soft-deleted custom exercise MUST fail in preview too
    store.mutate(userA.userId, {
      opId: "del_ex_create",
      id: "cust_del_100",
      kind: "exercise",
      baseVersion: 0,
      deleted: false,
      data: {
        id: "cust_del_100", name: "已删动作", englishName: "Deleted", aliases: [],
        muscle: "chest", secondaryMuscles: [], equipment: "barbell", category: "strength", mode: "reps",
        volumeMultiplier: 1, instructions: ["测试"], mistakes: [], custom: true,
      },
    });
    store.mutate(userA.userId, {
      opId: "del_ex_remove",
      id: "cust_del_100",
      kind: "exercise",
      baseVersion: 1,
      deleted: true,
      data: store.get(userA.userId, "exercise", "cust_del_100")!.data,
    });
    const badPrev = await call("/api/web/plans/import-json", {
      body: {
        mode: "preview",
        json: JSON.stringify({
          name: "坏计划",
          routines: [{ id: "r1", name: "R1", exercises: [{ exerciseId: "cust_del_100", sets: 3 }] }],
        }),
      },
    });
    assert.equal(badPrev.status, 400);

    // #103: deloadMissThreshold=5 does NOT trigger after 2 misses, and resolveRoutineWithTelemetry inspects >=5 sessions
    const missRow = {
      id: "r", exerciseId: "bench-press", restSeconds: 90,
      sets: [{ id: "s1", type: "normal" as const, weight: 60, reps: 5, seconds: 0, completed: true, rir: 2 }],
    };
    const prog2 = evaluateExerciseProgression(
      { exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, deloadMissThreshold: 5, backupExerciseId: null },
      missRow,
      missRow,
      [{ feeling: "balanced", row: missRow }, { feeling: "balanced", row: missRow }],
      "reps",
    );
    assert.notEqual(prog2.status, "plateau_deload");

    const fiveMissWorkouts: Workout[] = Array.from({ length: 5 }, (_, idx) => ({
      title: "推日",
      date: shiftDay(today, -(idx + 2)),
      startedAt: `${shiftDay(today, -(idx + 2))}T10:00:00Z`,
      endedAt: `${shiftDay(today, -(idx + 2))}T10:45:00Z`,
      status: "completed",
      notes: "",
      feeling: "balanced",
      source: "manual",
      rawPrompt: "",
      planId: "p1",
      planVersion: 1,
      routineId: "rt1",
      targetSnapshot: null,
      restEndsAt: null,
      adjustments: [],
      exercises: [missRow],
    }));
    const tele = resolveRoutineWithTelemetry({
      routine: {
        id: "rt1",
        name: "推日",
        exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, deloadMissThreshold: 5, backupExerciseId: null }],
      },
      workouts: fiveMissWorkouts,
      catalogue: store.catalogueMap(userA.userId),
      date: today,
      planId: "p1",
    });
    assert.equal(tele.exercises[0]!.progression.consecutiveMisses, 5);
    assert.equal(tele.exercises[0]!.progression.status, "plateau_deload");

    // #104 & #105: 135 lb x 1 bench (~61.23 kg) unlocks bench-60 ONLY (NOT 80/100/120!), and 3575s does NOT unlock marathon-60m
    store.mutate(userA.userId, {
      opId: "wo_lb_104",
      id: "wo_lb_104",
      kind: "workout",
      baseVersion: 0,
      deleted: false,
      data: {
        title: "磅制卧推",
        date: yest,
        startedAt: `${yest}T10:00:00+08:00`,
        endedAt: `${yest}T10:59:35+08:00`, // 3575 seconds (< 60 min)
        status: "completed",
        exercises: [
          {
            id: "e1",
            exerciseId: "bench-press",
            weightUnit: "lb",
            restSeconds: 90,
            sets: [{ id: "s1", type: "normal", weight: 135, reps: 1, seconds: 0, completed: true, rir: 2 }],
          },
        ],
      },
    });
    // Also upload outdoorRunning on same day for #105 double-day test
    const dev = (await (await call("/api/integrations/apple-health/tokens", { body: { label: "Watch" } })).json()) as { token: string };
    await call("/api/integrations/apple-health/workouts", {
      token: dev.token,
      body: {
        schemaVersion: 1, captureMethod: "workout", externalWorkoutId: "run_105",
        activityType: "outdoorRunning", environment: "outdoor",
        startedAt: `${yest}T17:00:00+08:00`, endedAt: `${yest}T17:30:00+08:00`,
        durationSeconds: 1800, durationKind: "workout_active",
      },
    });
    const badges = getWebBadges(store, userA.userId, today);
    const byId = new Map(badges.badges.map((b) => [b.id, b]));
    assert.equal(byId.get("bench-60")?.unlocked, true);
    assert.equal(byId.get("bench-80")?.unlocked, false);
    assert.equal(byId.get("bench-120")?.unlocked, false);
    assert.equal(byId.get("marathon-60m")?.unlocked, false);
    assert.equal(byId.get("double-day")?.unlocked, true);

    // #106: Share card converts 225 lb x 5 x 3 to ~1530.9 kg and keeps lb in summary
    const share = buildDailySharePayload({
      date: yest,
      workouts: [
        {
          title: "磅制推",
          date: yest,
          startedAt: `${yest}T10:00:00Z`,
          endedAt: `${yest}T10:30:00Z`,
          status: "completed",
          exercises: [
            {
              id: "r1",
              exerciseId: "bench-press",
              weightUnit: "lb",
              restSeconds: 90,
              snapshot: { name: "杠铃卧推", muscle: "chest", equipment: "barbell", mode: "reps", volumeMultiplier: 1 },
              sets: [
                { id: "s1", type: "normal", weight: 225, reps: 5, seconds: 0, completed: true, rir: 2 },
                { id: "s2", type: "normal", weight: 225, reps: 5, seconds: 0, completed: true, rir: 2 },
                { id: "s3", type: "normal", weight: 225, reps: 5, seconds: 0, completed: true, rir: 2 },
              ],
            },
          ],
        } as any,
      ],
    });
    assert.ok(share.strength.totalVolumeKg > 1525 && share.strength.totalVolumeKg < 1536);
    assert.match(share.strength.exercises[0]!.summary, /225 lb/);

    // #107: Same-day weigh-ins & weight=0 return null in evaluateWeightChangeRate
    assert.equal(evaluateWeightChangeRate([{ date: yest, weight: 75 }, { date: yest, weight: 76 }]), null);
    assert.equal(evaluateWeightChangeRate([{ date: shiftDay(today, -7), weight: 0 }, { date: yest, weight: 75 }]), null);

    // #102: Same-day plan sync-routine preserves today's plan adherence
    const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
    const planWd = store.createDraft(userA.userId, {
      name: "星期计划", weeks: 4, schedule: "weekdays", weekdays: [todayDow], rationale: "test", source: "manual", parentId: null,
      routines: [{ id: "rt_today", name: "今日推", exercises: [{ exerciseId: "bench-press", sets: 3, repsMin: 8, repsMax: 12, weight: 60, seconds: 0, restSeconds: 90, targetRir: 2, progression: "double", increment: 2.5, backupExerciseId: null }] }],
    });
    store.applyPlan(userA.userId, planWd.record!.id, 1, 0);
    store.mutate(userA.userId, {
      opId: "wo_102", id: "wo_102", kind: "workout", baseVersion: 0, deleted: false,
      data: {
        title: "今日推", date: today, startedAt: `${today}T00:01:00+08:00`, endedAt: `${today}T00:02:00+08:00`,
        status: "completed", planId: planWd.record!.id, planVersion: 1, routineId: "rt_today",
        exercises: [{ id: "e1", exerciseId: "bench-press", restSeconds: 90, sets: [{ id: "s1", type: "normal", weight: 65, reps: 8, seconds: 0, completed: true, rir: 2 }] }],
      },
    });
    const sync102 = await call("/api/web/plans/sync-routine", { body: { workoutId: "wo_102" } });
    assert.equal(sync102.status, 200);
    const ana102 = getWebAnalytics(store, userA.userId, { days: 30, through: today });
    assert.equal(ana102.planAdherence.completedSessions, 1);

    // #109a: Ironlog CSV formula unescape + Infinity duration + invalid calendar date 2026-02-31
    const csvPreview = previewWorkoutCsvImport(store, userA.userId, {
      csv: [
        "日期,训练标题,动作,组号,重量(kg),次数,时长(分钟),已完成",
        `${yest},'+5kg 突破日,杠铃卧推,1,60,8,Infinity,是`,
        "2026-02-31,坏日期,杠铃卧推,1,60,8,30,是",
      ].join("\n"),
    });
    assert.equal(csvPreview.sampleWorkouts[0]!.title, "+5kg 突破日");
    assert.equal(csvPreview.totalWorkouts, 1);

    // #109b: Health Data Export skips empty `data: []` to find `records` & ignores 0 bpm heart rate
    const parsedExport = readHealthDataExport({
      data: [],
      records: [
        {
          activityType: "running",
          startDate: `${yest}T07:00:00+08:00`,
          endDate: `${yest}T07:30:00+08:00`,
          durationSeconds: 1800,
          averageHeartRateBpm: 0,
        },
      ],
    });
    assert.equal(parsedExport.length, 1);
    assert.equal(parsedExport[0]!.heartRate, undefined);
  } finally {
    db.close();
  }
});

// ============================================================
// Round 9 Measurements, Photos & Backup Restore (#87, #88, #92, #93, #95 + UX-2)
// ============================================================

test("#87, #88, #92, #93, #95 与照片缩略图接口：围度删除并发冲突、已删照片重放不伪造成功、覆盖删除清单、照片去重与容量统计", async () => {
  const { db, store, userA, userB, call } = makeCtx();
  try {
    const today = localDate();
    const yest = shiftDay(today, -1);
    const img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

    // #87: Measurement delete checks expectedUpdatedAt and returns 409 with latest row when changed on another device
    const m1 = (await (await call("/api/web/measurements", { method: "PUT", body: { date: today, waistCm: 78 } })).json()) as { updatedAt: string };
    await new Promise((r) => setTimeout(r, 10));
    const m2 = (await (await call("/api/web/measurements", { method: "PUT", body: { date: today, chestCm: 96 } })).json()) as { updatedAt: string };
    assert.notEqual(m1.updatedAt, m2.updatedAt);
    const staleDel = await call(`/api/web/measurements/${today}?expectedUpdatedAt=${encodeURIComponent(m1.updatedAt)}`, { method: "DELETE" });
    assert.equal(staleDel.status, 409);
    const freshDel = await call(`/api/web/measurements/${today}?expectedUpdatedAt=${encodeURIComponent(m2.updatedAt)}`, { method: "DELETE" });
    assert.equal(freshDel.status, 200);

    // #88 & R9 UX-2: Photo summary mode omits full imageData, single GET fetches it, and replaying opId of deleted photo returns deleted: true (200)
    const upRes = await call("/api/web/progress-photos", {
      body: { opId: "photo_op_88", date: today, pose: "front", mime: "image/jpeg", imageData: img, thumbnailData: img, note: "正面" },
    });
    assert.equal(upRes.status, 201);
    const uploaded = (await upRes.json()) as { id: string };
    const sumList = (await (await call("/api/web/progress-photos?mode=summary")).json()) as Array<Record<string, unknown>>;
    assert.equal(sumList.length, 1);
    assert.equal("imageData" in sumList[0]!, false);
    const fullSingle = (await (await call(`/api/web/progress-photos/${uploaded.id}`)).json()) as { imageData: string };
    assert.equal(fullSingle.imageData, img);

    assert.equal((await call(`/api/web/progress-photos/${uploaded.id}`, { method: "DELETE" })).status, 200);
    const replayDeleted = await call("/api/web/progress-photos", {
      body: { opId: "photo_op_88", date: today, pose: "front", mime: "image/jpeg", imageData: img, thumbnailData: img, note: "正面" },
    });
    assert.equal(replayDeleted.status, 200);
    assert.equal(((await replayDeleted.json()) as { deleted?: boolean }).deleted, true);
    assert.equal(((await (await call("/api/web/progress-photos")).json()) as unknown[]).length, 0);

    // #92: Replace preview accurately counts soon-to-be-deleted records & measurements
    await call("/api/web/measurements", { method: "PUT", body: { date: yest, waistCm: 80 } });
    const backupWithYestOnly = store.export(userA.userId);
    await call("/api/web/measurements", { method: "PUT", body: { date: today, waistCm: 79 } });
    store.mutate(userA.userId, {
      opId: "w_today_92", id: `weight_${today}`, kind: "weight", baseVersion: 0, deleted: false,
      data: { date: today, weight: 74, bodyFat: null },
    });
    const prev92 = store.restoreBackup(userA.userId, backupWithYestOnly, { mode: "preview", strategy: "replace" }) as any;
    assert.equal(prev92.diff.deletions.measurements, 1);
    assert.equal(prev92.diff.deletions.records, 1);
    assert.ok(prev92.diff.toDelete >= 2);

    // #93: Repeated cross-account merges of same photo backup do NOT duplicate photos in userB!
    await call("/api/web/progress-photos", {
      body: { date: today, pose: "side", mime: "image/jpeg", imageData: img, note: "去重测试" },
    });
    const backupWithPhoto = store.export(userA.userId);
    store.restoreBackup(userB.userId, backupWithPhoto, { mode: "commit", strategy: "merge", opId: "merge_93_1" });
    store.restoreBackup(userB.userId, backupWithPhoto, { mode: "commit", strategy: "merge", opId: "merge_93_2" });
    const bPhotos93 = (await (await call("/api/web/progress-photos", { token: userB.token })).json()) as unknown[];
    assert.equal(bPhotos93.length, 1);

    // #95: Capacity check when userB has 59 photos and incoming backup has 2 new photos -> preview & commit report skippedCapacity: 1 & skipped >= 1
    for (let i = 0; i < 58; i++) {
      db.prepare(
        "INSERT INTO progress_photos (id, user_id, date, pose, mime, image_data, note, created_at, source_key) VALUES (?, ?, ?, 'front', 'image/jpeg', ?, '', ?, ?)",
      ).run(`fill_b_${i}`, userB.userId, yest, img, new Date().toISOString(), `fill_b_${i}`);
    }
    const backupTwoMore = structuredClone(backupWithPhoto);
    backupTwoMore.progressPhotos = [
      { id: "cap_p_1", date: yest, pose: "front", mime: "image/jpeg", imageData: img, note: "1", createdAt: new Date().toISOString() },
      { id: "cap_p_2", date: today, pose: "back", mime: "image/jpeg", imageData: img, note: "2", createdAt: new Date().toISOString() },
    ];
    const prev95 = store.restoreBackup(userB.userId, backupTwoMore, { mode: "preview", strategy: "merge" }) as any;
    assert.equal(prev95.photos.remainingCapacity, 1);
    assert.equal(prev95.photos.toImport, 1);
    assert.equal(prev95.photos.skippedCapacity, 1);
    const commit95 = store.restoreBackup(userB.userId, backupTwoMore, { mode: "commit", strategy: "merge", opId: "merge_95" }) as any;
    assert.equal(commit95.photos.imported, 1);
    assert.equal(commit95.photos.skippedCapacity, 1);
    assert.ok(commit95.skipped >= 1);
  } finally {
    db.close();
  }
});

// ============================================================
// Round 8 Report, Cardio Analytics, Distance/Laps/Calories/Beeps & Static Guards (#76-#85, #86-#95, #101, #110, #111)
// ============================================================

test("#77, #79, #80, #81, #82, #83 与前端护栏：复盘同计划比对、手录跑步进统计、逗号小数、0秒分段防重、体重估算热量与末3秒提示音", async () => {
  const { db, store, userA } = makeCtx();
  try {
    const today = localDate();
    const d1 = shiftDay(today, -5);
    const d2 = shiftDay(today, -3);
    const d3 = shiftDay(today, -1);

    // #81: Plan A routine `a` MUST compare against Plan A routine `a`, NOT Plan B routine `a` in between!
    const mkPlanWo = (id: string, date: string, planId: string, exerciseId: string, weight: number) =>
      store.mutate(userA.userId, {
        opId: `op_${id}`, id, kind: "workout", baseVersion: 0, deleted: false,
        data: {
          title: "训练A", date, startedAt: `${date}T10:00:00Z`, endedAt: `${date}T10:40:00Z`,
          status: "completed", planId, planVersion: 1, routineId: "a",
          exercises: [{ id: `e_${id}`, exerciseId, restSeconds: 90, sets: [{ id: `s_${id}`, type: "normal", weight, reps: 8, seconds: 0, completed: true, rir: 2 }] }],
        },
      });
    mkPlanWo("wo_pa_1", d1, "plan_A", "bench-press", 75);
    mkPlanWo("wo_pb_1", d2, "plan_B", "squat", 120);
    mkPlanWo("wo_pa_2", d3, "plan_A", "bench-press", 80);
    const rep81 = getWebWorkoutReport(store, userA.userId, "wo_pa_2");
    assert.equal(rep81.previousComparison?.workoutId, "wo_pa_1");
    assert.equal(rep81.previousComparison?.volumeDelta, 40);

    // #79 & #80 & #82: Comma decimal, 0-second paused lap guard, weight-based calorie estimation
    assert.deepEqual(parseCardioDistanceKm("5,5"), { valid: true, valueKm: 5.5, normalized: "5.5" });
    assert.equal(parseCardioDistanceKm("5,5,5").valid, false);
    assert.equal(formatCardioPaceOrSpeed("running", 1800, "5,5")?.value, formatCardioPaceOrSpeed("running", 1800, "5.5")?.value);
    assert.ok(estimateCardioCalories("running", 1800, 100) > estimateCardioCalories("running", 1800, 50) * 1.9);

    const pausedSession: LiveCardioSession = {
      id: "sess_80", presetId: "outdoor-run", label: "户外跑", appleWorkoutLabel: "户外跑步",
      activityType: "running", environment: "outdoor", startedAt: `${d3}T07:00:00+08:00`,
      timing: { elapsedSeconds: 600, runningSince: null },
      targetMinutes: null, laps: [], distanceKm: "5,5", feeling: "balanced", notes: "",
    };
    const lap1 = recordCardioLap(pausedSession, Date.now());
    assert.equal(lap1.laps.length, 1);
    assert.equal(lap1.laps[0]!.splitSeconds, 600);
    const lap2 = recordCardioLap(lap1, Date.now());
    assert.equal(lap2.laps.length, 1, "must not record 0-second lap while paused");

    // #77: Manual cardio workout saved with cardioMeta enters WHO Cardio & Pace Trend analytics
    const manualCardioMut = buildCardioWorkoutMutation(
      { ...pausedSession, timing: { elapsedSeconds: 1800, runningSince: null }, distanceKm: "5,0" },
      Date.parse(`${d3}T07:30:00+08:00`),
      { weightKg: 80 },
    );
    store.mutate(userA.userId, manualCardioMut);
    const ana77 = getWebAnalytics(store, userA.userId, { days: 30, through: today });
    assert.ok(ana77.appleWorkouts.whoCardio.equivalentMinutes >= 30);
    assert.equal(ana77.appleWorkouts.paceTrend.length, 1);
    assert.equal(ana77.appleWorkouts.paceTrend[0]!.paceMinPerKm, 6);

    // #83: Shared final 3-2-1 countdown beep deduplicates across WorkoutEditorModal and LiveWorkoutBar
    let plays = 0;
    const mockAudio = { play: (complete: boolean) => { if (!complete) plays++; } };
    const endMs = Date.now() + 99999;
    assert.equal(triggerRestFinalCountdownBeep(endMs, 3, mockAudio), true);
    assert.equal(triggerRestFinalCountdownBeep(endMs, 3, mockAudio), false);
    assert.equal(triggerRestFinalCountdownBeep(endMs, 2, mockAudio), true);
    assert.equal(triggerRestFinalCountdownBeep(endMs, 1, mockAudio), true);
    assert.equal(plays, 3);

    // #107b: Weekly streak not truncated to 52 weeks on days=30, and yearInReview.dietDays clamped to through
    for (let w = 0; w < 60; w++) {
      const wd = shiftDay(today, -w * 7);
      store.mutate(userA.userId, {
        opId: `wk_${w}`, id: `wk_${w}`, kind: "workout", baseVersion: 0, deleted: false,
        data: {
          title: "打卡", date: wd, startedAt: `${wd}T09:00:00Z`, endedAt: `${wd}T09:30:00Z`,
          status: "completed", exercises: [],
        },
      });
    }
    const st30 = getWebStatistics(store, userA.userId, { days: 30, through: today });
    assert.ok(st30.weeklyStreak.currentWeeks >= 60);

    // Static guards for UI fixes (#76, #78, #84, #85, #86, #89, #90, #91, #94, #101, #110, #111 + 6 UX items)
    assert.match(readFileSync("packages/web/src/components/weight/WeightEditorModal.tsx", "utf8"), /bodyFatDirtyRef/);
    assert.match(readFileSync("packages/web/src/components/weight/MeasurementModal.tsx", "utf8"), /dirtyFieldsRef/);
    assert.match(readFileSync("packages/web/src/components/weight/ProgressPhotosPanel.tsx", "utf8"), /mode=summary/);
    assert.match(readFileSync("packages/web/src/components/weight/ProgressPhotosPanel.tsx", "utf8"), /progress-photo-compare-bar/);
    assert.match(readFileSync("packages/web/src/components/settings/DataModals.tsx", "utf8"), /armedApplyJson/);
    assert.match(readFileSync("packages/web/src/components/settings/DataModals.tsx", "utf8"), /已编辑内容（原自/);
    assert.match(readFileSync("packages/web/src/components/apple/CardioSessionModal.tsx", "utf8"), /setInnerOverlayDismiss/);
    assert.match(readFileSync("packages/web/src/components/apple/CardioSessionModal.tsx", "utf8"), /bg\.inert = activeSheet !== "none"/);
    assert.match(readFileSync("packages/web/src/components/apple/CardioSessionModal.tsx", "utf8"), /保存到铁记/);
    assert.match(readFileSync("packages/web/src/components/apple/CardioSessionModal.tsx", "utf8"), /填距离/);
    assert.match(readFileSync("packages/web/src/components/workout/WorkoutReportModal.tsx", "utf8"), /查看原记录/);
    assert.match(readFileSync("packages/web/src/lib/record-openers.tsx", "utf8"), /isFuturePlan/);
    assert.match(readFileSync("packages/web/src/views/WorkoutView.tsx", "utf8"), /includeDeleted=1/);
    assert.match(readFileSync("packages/web/src/components/CommandPaletteModal.tsx", "utf8"), /epoch: dataEpoch/);
    assert.match(readFileSync("packages/web/src/store/useAuthStore.ts", "utf8"), /verifySessionAfterLogin/);
  } finally {
    db.close();
  }
});
