import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOnDate, estimateEnergy, calorieTargetOrigin, energyMethod, profileSchema, workoutSchema, localDate, type EnergyProfile } from "@ironlog/shared";
import { openDatabase } from "../packages/server/src/db.js";
import { createApp } from "../packages/server/src/app.js";
import { getTrainingContext } from "../packages/server/src/stats.js";

const body: EnergyProfile = {
  heightCm: 175, weightKg: 70, weightDate: null, birthDate: "1996-11-17",
  sex: "male", activityFactor: 1.6, context: "general",
};
const asOf = "2026-11-17";

test("Mifflin简化公式逐项校验男女系数与单位，总消耗乘完整精度后取整", () => {
  const male = estimateEnergy(body, asOf);
  assert.equal(male.status, "ready");
  if (male.status !== "ready") return;
  assert.equal(male.age, 30);
  assert.equal(male.restingKcal, 1648.75);
  assert.equal(male.totalKcal, 2638);
  assert.equal(male.restingDisplay, 1650);
  assert.equal(male.totalDisplay, 2640);
  const female = estimateEnergy({ ...body, sex: "female" }, asOf);
  assert.equal(female.status, "ready");
  if (female.status !== "ready") return;
  assert.equal(male.restingKcal - female.restingKcal, 166);
  for (const sex of ["male", "female"] as const) for (const weightKg of [40, 70.25, 150]) for (const heightCm of [145, 175.5, 200]) for (const activityFactor of [1.4, 1.55, 2.5]) {
    const input = { ...body, sex, weightKg, heightCm, activityFactor };
    const before = structuredClone(input);
    const result = estimateEnergy(input, asOf);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") continue;
    const resting = 10 * weightKg + 6.25 * heightCm - 5 * 30 + (sex === "male" ? 5 : -161);
    assert.equal(result.restingKcal, resting);
    assert.equal(result.totalKcal, resting * activityFactor);
    assert.equal(result.totalDisplay, Math.round(resting * activityFactor / 10) * 10);
    assert.deepEqual(input, before);
  }
});

test("周岁依据指定本地日期计算，生日、跨年、闰日和非法日期明确处理", () => {
  assert.equal(ageOnDate("1996-11-17", "2026-11-16"), 29);
  assert.equal(ageOnDate("1996-11-17", "2026-11-17"), 30);
  assert.equal(ageOnDate("2000-12-31", "2026-01-01"), 25);
  assert.equal(ageOnDate("2000-02-29", "2025-02-28"), 24);
  assert.equal(ageOnDate("2000-02-29", "2025-03-01"), 25);
  assert.equal(ageOnDate("2000-02-29", "2024-02-29"), 24);
  for (const date of ["2026-02-29", "2000-13-01", "", "2026-1-1", "2027-01-01"]) assert.equal(ageOnDate(date, asOf), null);
  assert.equal(ageOnDate(body.birthDate, "2026-02-30"), null);
});

test("资料缺失、未来体重与成人公式适用范围不产生猜测结果，样本年龄外附带标记", () => {
  assert.equal(estimateEnergy(null, asOf).status, "unavailable");
  assert.equal(estimateEnergy({ ...body, birthDate: "2010-01-01" }, asOf).status, "unavailable");
  for (const context of ["pregnant", "breastfeeding"] as const) assert.equal(estimateEnergy({ ...body, context }, asOf).status, "unavailable");
  assert.equal(estimateEnergy({ ...body, weightDate: "2026-11-18" }, asOf).status, "unavailable");
  assert.equal(estimateEnergy({ ...body, weightDate: "2026-02-30" }, asOf).status, "unavailable");
  const dated = estimateEnergy({ ...body, weightDate: "2026-11-10" }, asOf);
  assert.equal(dated.status === "ready" && dated.weightAgeDays, 7);
  for (const birthDate of ["2008-11-17", "1946-11-17"]) {
    const result = estimateEnergy({ ...body, birthDate }, asOf);
    assert.equal(result.status === "ready" && result.outsideStudyAge, true);
  }
  for (const invalid of [{ weightKg: NaN }, { heightCm: 1.75 }, { heightCm: Infinity }, { activityFactor: 0 }, { activityFactor: 2.6 }, { sex: "" }, { weightKg: 1, heightCm: 50, birthDate: "1900-01-01" }])
    assert.equal(estimateEnergy({ ...body, ...invalid } as EnergyProfile, asOf).status, "unavailable");
});

test("旧目标默认补齐空身体资料，热量来源快照可重算并识别不一致与未来日期", () => {
  const profile = profileSchema.parse({ calories: 2200 });
  assert.equal(profile.energyProfile, null);
  assert.equal(profile.calorieEstimate, null);
  assert.equal(calorieTargetOrigin(profile, asOf).estimated, false);
  profile.energyProfile = { ...body };
  profile.calorieEstimate = { method: energyMethod, asOf, inputs: { ...body } };
  profile.calories = 2640;
  assert.equal(calorieTargetOrigin(profile, asOf).estimated, true);
  assert.equal(calorieTargetOrigin({ ...profile, calories: 2500 }, asOf).label, "估算依据待核对");
  assert.equal(calorieTargetOrigin(profile, "2026-11-16").estimated, false);
  const nextYear = estimateEnergy(body, "2027-11-17");
  assert.equal(nextYear.status === "ready" && nextYear.age, 31);
  assert.equal(calorieTargetOrigin(profile, "2027-11-17").estimated, true);
  assert.equal(profile.calories, 2640);
});

test("后端统计、Agent上下文与共享估算一致，历史统计排除所选日之后的训练体重", async () => {
  const db = openDatabase(":memory:");
  const { app, auth, store } = createApp(db);
  try {
    const user = auth.login("energy-owner");
    const other = auth.login("energy-other");
    const profile = profileSchema.parse({ calories: 2640, energyProfile: body, calorieEstimate: { method: energyMethod, asOf, inputs: body } });
    const saved = await app.request("/api/records", { method: "POST", headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ opId: "body", id: "settings", kind: "profile", data: profile, baseVersion: 0, deleted: false }) });
    assert.equal(saved.status, 200);
    for (const date of ["2026-11-15", "2026-11-20"]) {
      store.mutate(user.userId, { opId: `weight_${date}`, id: `weight_${date}`, kind: "weight", data: { date, weight: 70, bodyFat: null }, baseVersion: 0, deleted: false });
      const workout = workoutSchema.parse({ date, title: "训练", status: "completed", startedAt: `${date}T08:00:00Z`, endedAt: `${date}T09:00:00Z`, exercises: [{ id: "row", exerciseId: "bench-press", restSeconds: 90, sets: [{ id: "set", type: "normal", weight: 40, reps: 8, completed: true }] }] });
      store.mutate(user.userId, { opId: `training_${date}`, id: `training_${date}`, kind: "workout", data: workout, baseVersion: 0, deleted: false });
    }
    const response = await app.request(`/api/stats?date=${asOf}`, { headers: { Authorization: `Bearer ${user.token}` } });
    assert.equal(response.status, 200);
    const stats = await response.json() as any;
    assert.deepEqual(stats.energy, estimateEnergy(body, asOf));
    assert.equal(stats.weights.length, 1);
    assert.equal(stats.series["bench-press"].length, 1);
    assert.equal(stats.remaining, 2640);
    const previous = await app.request("/api/stats?date=2026-11-16", { headers: { Authorization: `Bearer ${user.token}` } });
    assert.equal((await previous.json() as any).energy.status, "unavailable");
    assert.deepEqual(getTrainingContext(store, user.userId).energy, estimateEnergy(body, localDate()));
    assert.equal(getTrainingContext(store, other.userId).energy.status, "unavailable");
    const backup = store.export(user.userId).records.find((record) => record.kind === "profile")!.data as typeof profile;
    assert.deepEqual(backup.calorieEstimate, profile.calorieEstimate);
    const historyDate = new Date(Date.parse(localDate()) - 86400000).toISOString().slice(0, 10);
    const historic = estimateEnergy(body, historyDate);
    assert.equal(historic.status, "ready");
    if (historic.status !== "ready") return;
    const updatedBody = { ...body, weightKg: 80, weightDate: localDate() };
    store.mutate(user.userId, { opId: "body-updated", id: "settings", kind: "profile", baseVersion: store.get(user.userId, "profile", "settings")!.version, deleted: false,
      data: { ...profile, calories: historic.totalDisplay, energyProfile: updatedBody, calorieEstimate: { method: energyMethod, asOf: historyDate, inputs: body } } });
    const historicResponse = await app.request(`/api/stats?date=${historyDate}`, { headers: { Authorization: `Bearer ${user.token}` } });
    assert.deepEqual((await historicResponse.json() as any).energy, historic);
    assert.deepEqual(getTrainingContext(store, user.userId).energy, estimateEnergy(updatedBody, localDate()));
  } finally { db.close(); }
});
