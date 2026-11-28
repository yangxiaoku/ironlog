import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  computeFitCrc,
  encodeWorkoutToFit,
  evaluateStrengthStandards,
  evaluateStructuralBalance,
} from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { computeWeeklyStreak, isoWeekKey } from "../packages/server/src/web-statistics.js";
import { getWebAnalytics } from "../packages/server/src/web-analytics.js";
import {
  deliverWebhookEvent,
  isPrivateWebhookUrl,
  signWebhookPayload,
  validateWebhookTarget,
} from "../packages/server/src/webhook.js";

function makeFixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("batch3-owner");
  const other = auth.login("batch3-other");
  const call = (
    url: string,
    options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token === "" ? {} : { Authorization: "Bearer " + (options.token ?? owner.token) }),
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  return { db, app, store, owner, other, call };
}

test("3.1 evaluateStrengthStandards & evaluateStructuralBalance diagnose Poliquin / Powerlifting ratios and bodyweight tiers", () => {
  const best1RM = new Map<string, number>([
    ["squat", 140],
    ["bench-press", 100],
    ["exdb_0032", 180], // deadlift
    ["overhead-press", 50], // weak relative to 100kg bench (50% < 60%)
    ["barbell-row", 90], // balanced relative to 100kg bench (90% in 80-100%)
  ]);

  const maleStandards = evaluateStrengthStandards(best1RM, 80, "male");
  assert.equal(maleStandards.length, 5);
  const benchStd = maleStandards.find((s) => s.key === "bench")!;
  assert.equal(benchStd.ratioToBw, 1.25);
  assert.equal(benchStd.tier, "intermediate");
  assert.equal(benchStd.nextTierLabel, "熟练");

  const femaleStandards = evaluateStrengthStandards(best1RM, 60, "female");
  const femaleBench = femaleStandards.find((s) => s.key === "bench")!;
  assert.equal(femaleBench.tier, "elite");
  assert.equal(femaleBench.nextTierLabel, null);

  assert.deepEqual(evaluateStrengthStandards(best1RM, null, "male"), []);

  const balance = evaluateStructuralBalance(best1RM);
  assert.equal(balance.ratios.length, 4);
  const ohpRatio = balance.ratios.find((r) => r.id === "ohp_to_bench")!;
  assert.equal(ohpRatio.status, "weak");
  const rowRatio = balance.ratios.find((r) => r.id === "row_to_bench")!;
  assert.equal(rowRatio.status, "balanced");
  const dlSquat = balance.ratios.find((r) => r.id === "deadlift_to_squat")!;
  assert.equal(dlSquat.status, "balanced");
});

test("3.2 progress photos CRUD enforces user isolation & valid data URL; streak freeze preserves weekly streak & monthly limit", async () => {
  const { call, other, store, owner } = makeFixture();
  const sampleDataUrl = "data:image/jpeg;base64," + Buffer.from("fake-jpeg-payload-for-test-1234567890").toString("base64");

  const badRes = await call("/api/web/progress-photos", {
    method: "POST",
    body: { date: "2026-11-27", pose: "front", mime: "image/jpeg", imageData: "not-a-data-url" },
  });
  assert.equal(badRes.status, 400);

  const createRes = await call("/api/web/progress-photos", {
    method: "POST",
    body: { date: "2026-11-27", pose: "front", mime: "image/jpeg", imageData: sampleDataUrl, note: "晨起空腹" },
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string; note: string };
  assert.equal(created.note, "晨起空腹");

  // Other user cannot see or delete owner's photo
  const otherList = (await (await call("/api/web/progress-photos", { token: other.token })).json()) as unknown[];
  assert.equal(otherList.length, 0);
  const otherDel = await call(`/api/web/progress-photos/${created.id}`, { method: "DELETE", token: other.token });
  assert.equal(otherDel.status, 404);

  const ownerDel = await call(`/api/web/progress-photos/${created.id}`, { method: "DELETE" });
  assert.equal(ownerDel.status, 200);

  // Streak freeze preserves unbroken streak across an otherwise missed week
  const todayStr = "2026-11-27";
  const wkCurr = isoWeekKey(todayStr);
  const wkPrev = isoWeekKey("2026-11-20");
  const wkTwoAgo = isoWeekKey("2026-11-13");
  assert.notEqual(wkCurr, wkPrev);
  assert.notEqual(wkPrev, wkTwoAgo);

  const activeDays = new Set<string>(["2026-11-27", "2026-11-13"]); // missed 2026-11-20 week
  const broken = computeWeeklyStreak(activeDays, todayStr, []);
  assert.equal(broken.currentWeeks, 1);

  const preserved = computeWeeklyStreak(activeDays, todayStr, [wkPrev]);
  assert.equal(preserved.currentWeeks, 3);

  // API monthly freeze allowance: first freeze succeeds, second in same month fails with 400
  const f1 = await call("/api/web/streak-freeze", { method: "POST", body: {} });
  assert.equal(f1.status, 200);
  const f2 = await call("/api/web/streak-freeze", { method: "POST", body: { weekKey: "2026-W01" } });
  assert.equal(f2.status, 400);

  // Analytics exposes yearInReview cleanly
  const analytics = getWebAnalytics(store, owner.userId, { through: "2026-11-27", period: 30 });
  assert.equal(analytics.yearInReview.year, 2026);
});

test("3.3 FIT binary encoder produces valid .FIT header & CRC-16, and webhook enforces SSRF guard + HMAC signature", async () => {
  const bytes = encodeWorkoutToFit({
    title: "胸三头训练",
    date: "2026-11-27",
    startedAt: "2026-11-27T10:00:00Z",
    endedAt: "2026-11-27T10:50:00Z",
    durationSeconds: 3000,
    totalSets: 16,
    totalVolumeKg: 6400,
  });
  assert.ok(bytes.length > 40);
  assert.equal(bytes[0], 14); // 14-byte FIT header
  assert.equal(String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!), ".FIT");
  const expectedHeaderCrc = computeFitCrc(bytes, 0, 12);
  const actualHeaderCrc = bytes[12]! | (bytes[13]! << 8);
  assert.equal(actualHeaderCrc, expectedHeaderCrc);
  const expectedFileCrc = computeFitCrc(bytes, 0, bytes.length - 2);
  const actualFileCrc = bytes[bytes.length - 2]! | (bytes[bytes.length - 1]! << 8);
  assert.equal(actualFileCrc, expectedFileCrc);

  // Webhook SSRF protection & HMAC signature
  assert.equal(isPrivateWebhookUrl("http://127.0.0.1:5678/hook"), true);
  assert.equal(isPrivateWebhookUrl("http://192.168.6.238:8123/api/webhook"), true);
  assert.equal(isPrivateWebhookUrl("https://hooks.example.com/ironlog"), false);

  const blocked = validateWebhookTarget({ url: "http://192.168.1.10/hook", allowPrivateNetwork: false });
  assert.equal(blocked.ok, false);
  const allowedLocal = validateWebhookTarget({ url: "http://192.168.1.10/hook", allowPrivateNetwork: true });
  assert.equal(allowedLocal.ok, true);

  let capturedSig = "";
  let capturedBody = "";
  const mockFetch: typeof fetch = async (_input, init) => {
    capturedSig = (init?.headers as Record<string, string>)["X-Ironlog-Signature"] ?? "";
    capturedBody = String(init?.body ?? "");
    return new Response("ok", { status: 200 });
  };
  const delivery = await deliverWebhookEvent(
    { enabled: true, url: "https://hooks.example.com/ironlog", secret: "my-secret", allowPrivateNetwork: false },
    "workout.completed",
    { title: "推日", volumeKg: 5000 },
    mockFetch,
  );
  assert.equal(delivery.delivered, true);
  assert.equal(capturedSig, signWebhookPayload(capturedBody, "my-secret"));
});

test("3.4 one-time 8-char alphanumeric pairing code and Passkey (WebAuthn ECDSA P-256) register & login end-to-end", async () => {
  const { call } = makeFixture();
  const origin = "https://ironlog.example.com";
  const rpId = "ironlog.example.com";

  // 1) Pairing code issue -> redeem -> single-use burn on second attempt
  const pairRes = await call("/api/web/auth/pairing-code", { method: "POST" });
  assert.equal(pairRes.status, 201);
  const { code } = (await pairRes.json()) as { code: string; expiresAt: string };
  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);

  const loginRes = await call(`${origin}/auth/web/pairing-login`, {
    method: "POST",
    token: "",
    headers: { Origin: origin },
    body: { code },
  });
  assert.equal(loginRes.status, 200);
  assert.ok((loginRes.headers.get("set-cookie") ?? "").includes("ws_"));

  const replayRes = await call(`${origin}/auth/web/pairing-login`, {
    method: "POST",
    token: "",
    headers: { Origin: origin },
    body: { code },
  });
  assert.equal(replayRes.status, 401);

  // 2) Passkey WebAuthn ECDSA P-256 registration & login verification
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spkiB64Url = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
  const credId = "cred_test_p256_001";

  const regOptsRes = await call(`${origin}/api/web/auth/passkey/register/options`, {
    method: "POST",
    headers: { Origin: origin },
  });
  assert.equal(regOptsRes.status, 200);
  const regOpts = (await regOptsRes.json()) as { challenge: string; rp: { id: string } };
  assert.equal(regOpts.rp.id, rpId);

  const regClientData = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge: regOpts.challenge, origin }),
    "utf8",
  ).toString("base64url");

  const regVerifyRes = await call(`${origin}/api/web/auth/passkey/register/verify`, {
    method: "POST",
    headers: { Origin: origin },
    body: {
      credentialId: credId,
      publicKeySpki: spkiB64Url,
      clientDataJSON: regClientData,
      label: "测试 iPhone",
    },
  });
  assert.equal(regVerifyRes.status, 201);

  // Now perform WebAuthn login assertion
  const loginOptsRes = await call(`${origin}/auth/web/passkey/login/options`, {
    method: "POST",
    token: "",
    headers: { Origin: origin },
    body: {},
  });
  assert.equal(loginOptsRes.status, 200);
  const loginOpts = (await loginOptsRes.json()) as { challenge: string };

  const loginClientDataBuf = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge: loginOpts.challenge, origin }),
    "utf8",
  );
  const rpIdHash = createHash("sha256").update(rpId).digest();
  const flagsAndCounter = Buffer.from([0x05, 0x00, 0x00, 0x00, 0x01]); // UP + UV, signCount = 1
  const authData = Buffer.concat([rpIdHash, flagsAndCounter]);
  const clientDataHash = createHash("sha256").update(loginClientDataBuf).digest();
  const signedData = Buffer.concat([authData, clientDataHash]);
  const sig = cryptoSign("sha256", signedData, privateKey);

  const loginVerifyRes = await call(`${origin}/auth/web/passkey/login/verify`, {
    method: "POST",
    token: "",
    headers: { Origin: origin },
    body: {
      credentialId: credId,
      authenticatorData: authData.toString("base64url"),
      clientDataJSON: loginClientDataBuf.toString("base64url"),
      signature: sig.toString("base64url"),
    },
  });
  assert.equal(loginVerifyRes.status, 200);
  assert.ok((loginVerifyRes.headers.get("set-cookie") ?? "").includes("ws_"));
});
