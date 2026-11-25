import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { duration, fmt, formatWeekdayZh, shortDate, today } from "../packages/web/src/lib/date.ts";
import { clearQueue, enqueueMutation, flushQueue, readQueue } from "../packages/web/src/lib/offline-queue.ts";
import { parseHashView, VIEW_WORKSPACE } from "../packages/web/src/lib/routes.ts";
import {
  ALL_PLATES,
  plateBreakdown,
  plateDeltaLabel,
  round2,
  snapWarmupWeight,
} from "../packages/web/src/lib/workout-helpers.ts";

const repoRoot = resolve(import.meta.dirname, "..");

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

test("packages/web/src/lib date and route helpers preserve Ironlog conventions", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(shortDate("2026-11-22"), "11/22");
  assert.equal(fmt(1234.56, 1), "1,234.6");
  assert.equal(fmt(null), "—");
  assert.equal(duration(45), "45 秒");
  assert.equal(duration(900), "15 分钟");
  assert.equal(duration(5400), "1.5 小时");
  assert.equal(formatWeekdayZh("2026-11-22"), "周日");

  assert.equal(parseHashView(""), "overview");
  assert.equal(parseHashView("#workout"), "workout");
  assert.equal(parseHashView("#nonexistent"), "overview");
  assert.equal(VIEW_WORKSPACE.exercises, "workout");
  assert.equal(VIEW_WORKSPACE.weight, "diet");
});

test("packages/web/src/lib offline queue deduplicates by opId and flushes FIFO", async () => {
  const storage = createMemoryStorage();
  enqueueMutation(storage, "u1", { opId: "op1", path: "/api/records", body: { n: 1 } });
  enqueueMutation(storage, "u1", { opId: "op1", path: "/api/records", body: { n: 2 } });
  enqueueMutation(storage, "u1", { opId: "op2", path: "/api/records", body: { n: 3 } });
  assert.equal(readQueue(storage, "u1").length, 2);

  const sent: unknown[] = [];
  const res1 = await flushQueue(storage, "u1", async (_path, opts) => {
    sent.push(opts.body);
    if (sent.length === 2) throw new Error("network down");
  });
  assert.equal(res1.synced, 1);
  assert.equal(res1.stoppedOffline, true);
  assert.equal(readQueue(storage, "u1").length, 1);

  const res2 = await flushQueue(storage, "u1", async (_path, opts) => {
    sent.push(opts.body);
  });
  assert.equal(res2.synced, 1);
  assert.equal(res2.remaining, 0);
  clearQueue(storage, "u1");
  assert.equal(readQueue(storage, "u1").length, 0);
});

test("packages/web/src/lib workout helpers match domain math", () => {
  assert.equal(round2(12.345), 12.35);
  assert.equal(plateDeltaLabel(60, 70, 20, ALL_PLATES), "-20 +25");
  assert.equal(plateDeltaLabel(70, 75, 20, ALL_PLATES), "+2.5");
  assert.equal(snapWarmupWeight(15, true, 20, ALL_PLATES), 20);
  assert.equal(snapWarmupWeight(17, false, 20, ALL_PLATES), 17.5);

  // Exact DP solves non-canonical plate subsets where greedy gets stuck
  const nonCanon80 = plateBreakdown(80, 20, [25, 15, 10]);
  assert.equal(nonCanon80.achievable, true);
  assert.equal(nonCanon80.remainder, 0);
  assert.deepEqual(nonCanon80.plates, [15, 15]);

  const nonCanon90 = plateBreakdown(90, 20, [25, 20, 15]);
  assert.equal(nonCanon90.achievable, true);
  assert.equal(nonCanon90.remainder, 0);
  assert.deepEqual(nonCanon90.plates, [20, 15]);

  // Preserves heavier-plates-first tie-breaking when plate counts match
  const tie80 = plateBreakdown(80, 20, [25, 20, 15, 10]);
  assert.deepEqual(tie80.plates, [20, 10]);

  // Warmup snapping picks nearest achievable weight (59.5 -> 60 instead of rounding down to 55)
  assert.equal(snapWarmupWeight(59.5, true, 20, [25, 20, 15, 10, 5, 2.5]), 60);
  assert.equal(snapWarmupWeight(31.2, true, 20, [20, 15, 10, 5, 2.5, 1.25]), 30);
});

test("packages/web/dist Vite + PWA build outputs index, manifest, sw, and rewritten /app/ CSS URLs", async () => {
  const distDir = resolve(repoRoot, "packages/web/dist");
  const assetsDir = resolve(distDir, "assets");
  assert.equal(existsSync(resolve(distDir, "index.html")), true, "expected Vite index.html");
  assert.equal(existsSync(resolve(distDir, "manifest.webmanifest")), true, "expected PWA manifest");
  assert.equal(existsSync(resolve(distDir, "sw.js")), true, "expected Workbox sw.js");

  const assetFiles = await readdir(assetsDir);
  const cssFile = assetFiles.find((name) => /^index-.*\.css$/.test(name));
  assert.ok(cssFile, "expected built CSS bundle in packages/web/dist/assets");
  const css = await readFile(resolve(assetsDir, cssFile), "utf8");
  assert.equal(css.includes("./athlete-halftone.jpg"), false, "expected relative ./ asset URLs to be rewritten");
  assert.equal(css.includes("/app/athlete-halftone.jpg"), true, "expected /app/ public URLs in built CSS");
});
