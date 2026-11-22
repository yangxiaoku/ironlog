import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRestTimer,
  normalizeRestTimer,
  restProgress,
  shiftRestTimer,
} from "../web/src/workout-clock.js";

test("组间休息加减时间（-15s / +15s）按参考总时长正确更新圆环比例", () => {
  const t0 = 1_795_158_900_000;
  let rest = createRestTimer(90, "set-1", t0);
  assert.equal(rest.total, 90_000);
  assert.equal(restProgress(rest, t0).fraction, 1);

  // 刚开表 2 秒后连续点击 -15s：总参考时长保持 90s，圆环比例随之逐档缩小
  const t1 = t0 + 2_000;
  rest = shiftRestTimer(rest, -15, t1)!;
  let p = restProgress(rest, t1);
  assert.equal(p.total, 90_000);
  assert.equal(p.seconds, 73);
  assert.ok(Math.abs(p.fraction - 73 / 90) < 1e-6);

  rest = shiftRestTimer(rest, -15, t1)!;
  rest = shiftRestTimer(rest, -15, t1)!;
  p = restProgress(rest, t1);
  assert.equal(p.seconds, 43);
  assert.ok(Math.abs(p.fraction - 43 / 90) < 1e-6);

  // 在未满状态点击 +15s：剩余时间与圆环比例回升
  rest = shiftRestTimer(rest, 15, t1)!;
  p = restProgress(rest, t1);
  assert.equal(p.total, 90_000);
  assert.equal(p.seconds, 58);
  assert.ok(Math.abs(p.fraction - 58 / 90) < 1e-6);

  // 连续 +15s 超过初始 90s：扩展参考总时长且持久化 start 保持非负整数
  rest = shiftRestTimer(rest, 15, t1)!;
  rest = shiftRestTimer(rest, 15, t1)!;
  rest = shiftRestTimer(rest, 15, t1)!;
  p = restProgress(rest, t1);
  assert.equal(p.seconds, 103);
  assert.equal(p.total, 103_000);
  assert.equal(Number.isInteger(rest.start) && rest.start >= 0, true);

  // 扩展后点击 -15s：圆环立即从 100% 缩小而不是滞留在满圈
  rest = shiftRestTimer(rest, -15, t1)!;
  p = restProgress(rest, t1);
  assert.equal(p.seconds, 88);
  assert.equal(p.total, 103_000);
  assert.ok(Math.abs(p.fraction - 88 / 103) < 1e-6);

  // 减至归零后再点 +15s，以 15s 新轮次重新满格启动
  for (let i = 0; i < 6; i++) rest = shiftRestTimer(rest, -15, t1)!;
  assert.equal(restProgress(rest, t1).fraction, 0);
  assert.equal(restProgress(rest, t1).seconds, 0);

  rest = shiftRestTimer(rest, 15, t1)!;
  p = restProgress(rest, t1);
  assert.equal(p.seconds, 15);
  assert.equal(p.total, 15_000);
  assert.equal(p.fraction, 1);
});

test("恢复进行中与已过期的组间休息状态", () => {
  const now = 1_795_159_000_000;
  assert.equal(normalizeRestTimer({ start: now - 90_000, end: now }, now), null);
  const restored = normalizeRestTimer({ start: now - 30_000, end: now + 60_000 }, now);
  assert.ok(restored);
  assert.equal(restored.total, 90_000);
  assert.ok(Math.abs(restProgress(restored, now).fraction - 60 / 90) < 1e-6);
});
