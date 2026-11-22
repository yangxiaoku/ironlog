import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { exerciseCatalogue, localDate } from "@ironlog/shared";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";
import { getWebBadges } from "../packages/server/src/web-badges.js";
import { shiftDay } from "../packages/server/src/web-statistics.js";

function fixture() {
  const db = openDatabase(":memory:");
  const { app, store, auth } = createApp(db);
  const owner = auth.login("badge-test-owner");
  const other = auth.login("badge-test-other");
  const call = (url: string, options: { token?: string; method?: string; body?: unknown } = {}) =>
    app.request(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: "Bearer " + (options.token ?? owner.token),
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let seq = 0;
  const save = (kind: "workout" | "diet" | "weight", id: string, data: unknown, baseVersion = 0) =>
    store.mutate(owner.userId, { id, kind, opId: "badge-op-" + seq++, data, baseVersion, deleted: false });
  return { db, app, store, call, save, owner, other };
}

test("成就徽章接口鉴权、空账户进度与账号隔离", async () => {
  const { db, app, call, other } = fixture();
  try {
    assert.equal((await app.request("/api/web/badges")).status, 401);

    const res = await call("/api/web/badges");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");

    const empty = (await res.json()) as ReturnType<typeof getWebBadges>;
    assert.equal(empty.earnedCount, 0);
    assert.equal(empty.totalCount, 105);
    assert.equal(empty.categories.length, 5);
    assert.deepEqual(
      empty.categories.map((cat) => [cat.key, cat.earned, cat.total]),
      [
        ["consistency", 0, 21],
        ["volume", 0, 21],
        ["strength", 0, 21],
        ["lifestyle", 0, 21],
        ["special", 0, 21],
      ],
    );
    for (const badge of empty.badges) {
      assert.equal(badge.unlocked, false);
      assert.equal(badge.unlockedAt, null);
      assert.equal(badge.progress, 0);
    }

    const otherRes = (await (await call("/api/web/badges", { token: other.token })).json()) as ReturnType<typeof getWebBadges>;
    assert.equal(otherRes.earnedCount, 0);
  } finally {
    db.close();
  }
});

test("成就徽章准确统计连击、PR、容量、五维分化、饮食、体重与 Apple 同步", async () => {
  const { db, call, save, other } = fixture();
  try {
    const end = shiftDay(localDate(), -1);
    const pickMuscle = (muscle: string) => {
      const found = exerciseCatalogue.find((item) => item.muscle === muscle && item.mode === "reps");
      assert.ok(found, `missing reps exercise for ${muscle}`);
      return found.id;
    };
    const chestId = "bench-press";
    const backId = pickMuscle("back");
    const legsId = pickMuscle("legs");
    const shouldersId = pickMuscle("shoulders");
    const armsId = pickMuscle("arms");

    const makeSets = (prefix: string, weight: number, reps: number, count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `${prefix}-${idx}`,
        type: "normal",
        completed: true,
        weight,
        reps,
      }));

    // 7 consecutive days of completed workouts (with early-bird hour 08:15 UTC+8, PR progression, 5-muscle split, >10t tonnage, 100kg bench)
    for (let offset = 6; offset >= 0; offset--) {
      const date = shiftDay(end, -offset);
      const liftWeight = offset === 0 ? 105 : 70 + (6 - offset) * 4;
      const exercises: unknown[] = [
        { id: "e-chest", exerciseId: chestId, restSeconds: 90, sets: makeSets(`c-${offset}`, liftWeight, 5, 4) },
        { id: "e-back", exerciseId: backId, restSeconds: 90, sets: makeSets(`b-${offset}`, 65 + (6 - offset) * 5, 8, 4) },
        { id: "e-legs", exerciseId: legsId, restSeconds: 90, sets: makeSets(`l-${offset}`, 90 + (6 - offset) * 5, 6, 4) },
        { id: "e-shoulders", exerciseId: shouldersId, restSeconds: 90, sets: makeSets(`s-${offset}`, 40, 10, 3) },
        { id: "e-arms", exerciseId: armsId, restSeconds: 90, sets: makeSets(`a-${offset}`, 30, 10, 3) },
      ];
      save("workout", `w-${offset}`, {
        date,
        title: `训练 ${date}`,
        status: "completed",
        feeling: "balanced",
        startedAt: `${date}T00:15:00Z`,
        endedAt: `${date}T01:15:00Z`,
        exercises,
      });
    }

    // 14 complete nutrition days + 30 weight entries
    for (let i = 0; i < 30; i++) {
      const date = shiftDay(end, -i);
      save("weight", `weight_${date}`, { date, weight: 72.5 - i * 0.05 });
      if (i < 14) {
        save("diet", `diet-${i}`, {
          date,
          meal: "lunch",
          name: "牛肉饭",
          calories: 650,
          protein: 45,
          carbs: 75,
          fat: 16,
        });
        const mark = await call("/api/web/nutrition-day", {
          method: "PUT",
          body: { date, opId: `nd-${i}` },
        });
        assert.equal(mark.status, 200);
      }
    }

    // 10 standalone Apple Health synced workouts (including 1 running session on `end` for double-day)
    const device = (await (
      await call("/api/integrations/apple-health/tokens", { method: "POST", body: { label: "Apple Watch" } })
    ).json()) as { token: string };
    for (let i = 0; i < 10; i++) {
      const date = i === 0 ? end : shiftDay(end, -(10 + i));
      const res = await call("/api/integrations/apple-health/workouts", {
        method: "POST",
        token: device.token,
        body: {
          schemaVersion: 1,
          captureMethod: "workout",
          activityType: "running",
          startedAt: `${date}T11:00:00Z`,
          endedAt: `${date}T11:35:00Z`,
          durationSeconds: 2100,
          durationKind: "workout_active",
          activeEnergyKcal: 340,
          energyKind: "workout",
        },
      });
      assert.equal(res.status, 201);
    }

    const summary = (await (await call("/api/web/badges")).json()) as ReturnType<typeof getWebBadges>;
    const byId = new Map(summary.badges.map((item) => [item.id, item]));

    for (const expectedUnlocked of [
      "first-spark",
      "habit-3",
      "habit-10",
      "tonnage-5t",
      "tonnage-10t",
      "tonnage-25t",
      "sets-100",
      "pr-first",
      "pr-breaker",
      "full-split",
      "bench-60",
      "bench-80",
      "bench-100",
      "squat-80",
      "squat-100",
      "squat-120",
      "diet-1",
      "diet-7",
      "diet-14",
      "weight-7",
      "weight-30",
      "apple-sync-1",
      "apple-sync",
      "early-bird",
      "early-bird-5",
      "double-day",
      "streak-3",
      "streak-7",
      "marathon-60m",
    ]) {
      const badge = byId.get(expectedUnlocked);
      assert.ok(badge, `missing badge ${expectedUnlocked}`);
      assert.equal(badge.unlocked, true, `${expectedUnlocked} should be unlocked`);
      assert.equal(badge.progress, 1, `${expectedUnlocked} progress should be 1`);
      assert.ok(badge.unlockedAt, `${expectedUnlocked} unlockedAt missing`);
    }

    // Habit-30 has 17 activities (7 manual + 10 apple) -> still locked with fractional progress
    const habit30 = byId.get("habit-30")!;
    assert.equal(habit30.unlocked, false);
    assert.equal(habit30.current, 17);
    assert.equal(habit30.target, 30);

    // Sets-300 has 126 working sets (7 * 18) -> accurate in-progress tracking
    const sets300 = byId.get("sets-300")!;
    assert.equal(sets300.unlocked, false);
    assert.equal(sets300.current, 126);
    assert.equal(sets300.target, 300);

    // Other user remains clean
    const otherSummary = (await (await call("/api/web/badges", { token: other.token })).json()) as ReturnType<typeof getWebBadges>;
    assert.equal(otherSummary.earnedCount, 0);
  } finally {
    db.close();
  }
});

test("所有 105 枚徽章纹理、打包产物与 Service Worker 缓存清单完整且规格一致", async () => {
  const db = openDatabase(":memory:");
  try {
    const { store, auth } = createApp(db);
    const { userId } = auth.login("asset-check");
    const { badges } = getWebBadges(store, userId);
    assert.equal(badges.length, 105);

    const sw = readFileSync("web/src/sw.js", "utf8");
    const distSw = readFileSync("web/dist/sw.js", "utf8");
    assert.equal(distSw, sw);
    assert.match(sw, /\.\/badges-ui\.js/);
    assert.match(sw, /\.\/analytics-ui\.js/);

    const srcModules = readdirSync("web/src").filter((name) => name.endsWith(".js") && name !== "sw.js");
    for (const mod of srcModules) {
      assert.ok(sw.includes(`./${mod}`), `sw.js missing ./${mod}`);
    }

    const allowedAssetName = /^[a-z0-9-]+\.(?:html|js|css|jpg|png|webmanifest)$/;

    for (const badge of badges) {
      const file = `badge-${badge.id}.png`;
      assert.match(file, allowedAssetName);
      const srcBytes = readFileSync(join("web/assets/badges", file));
      const distBytes = readFileSync(join("web/dist", file));
      assert.deepEqual(distBytes, srcBytes, `${file} mismatch between web/assets/badges and web/dist`);

      const meta = await sharp(srcBytes).metadata();
      assert.equal(meta.format, "png");
      assert.equal(meta.width, 360);
      assert.equal(meta.height, 360);
      assert.equal(meta.hasAlpha, true, `${file} must keep transparent alpha channel`);

      assert.ok(sw.includes(`./${file}`), `sw.js missing ./${file}`);
    }
  } finally {
    db.close();
  }
});
