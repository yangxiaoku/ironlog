import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import esbuild from "esbuild";
import {
  ALL_PLATES,
  BAR_PRESETS,
  plateDeltaLabel,
  round2,
  snapWarmupWeight,
  numeric,
} from "../web/src/workout-helpers.js";

const repoRoot = resolve(import.meta.dirname, "..");

test("web/src ES module graph links cleanly via esbuild (static + dynamic imports)", async () => {
  const matrixPath = resolve(repoRoot, "packages/shared/src/matrix.ts");
  const entryPath = resolve(repoRoot, "web/src/app.js");

  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2020",
    outdir: resolve(repoRoot, "web/.link-check-out"),
    write: false,
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "resolve-matrix-data",
        setup(build) {
          build.onResolve({ filter: /^\.\/matrix-data\.js$/ }, () => ({
            path: matrixPath,
          }));
        },
      },
    ],
  });

  assert.equal(result.errors.length, 0, "expected zero esbuild link errors");
  assert.ok(result.outputFiles.length > 0, "expected non-empty bundled ESM outputs");

  const inputs = Object.keys(result.metafile?.inputs ?? {}).map((p) => p.replace(/\\/g, "/"));
  for (const mod of [
    "web/src/app.js",
    "web/src/editor.js",
    "web/src/workout-helpers.js",
    "web/src/simple-editors.js",
    "web/src/modal-stack.js",
    "web/src/data-modals.js",
    "web/src/diet-weight-modals.js",
    "web/src/settings-ui.js",
    "web/src/report-share-ui.js",
    "packages/shared/src/matrix.ts",
  ]) {
    assert.ok(
      inputs.some((entry) => entry.endsWith(mod)),
      `expected module ${mod} in linked graph`,
    );
  }
});

test("bundled web/dist/styles.css preserves all 7 ordered CSS sections without @import", async () => {
  const css = await readFile(resolve(repoRoot, "web/dist/styles.css"), "utf8");
  assert.ok(css.length > 50_000, "expected bundled minified stylesheet");
  assert.equal(css.includes("@import"), false, "expected zero unresolved @import directives");

  for (const marker of [
    ":root",
    ".dialog-head",
    ".analytics-hero",
    ".matrix",
    ".badge-subtoolbar",
    ".exercise-tile-pr",
    ".skeleton-page",
    ".confirm-overlay",
  ]) {
    assert.ok(css.includes(marker), `expected bundled CSS to include ${marker}`);
  }
});

test("workout-helpers rounding, numeric, plate delta labels, and warmup snapping", () => {
  assert.equal(round2(12.345), 12.35);
  assert.equal(round2(0), 0);

  assert.equal(typeof numeric, "string");
  assert.ok(numeric.includes('inputmode="decimal"'));
  assert.deepEqual(BAR_PRESETS.map(([w]) => w), [20, 15, 10, 25, 0]);
  assert.equal(ALL_PLATES.includes(20), true);

  assert.equal(plateDeltaLabel(60, 60, 20, ALL_PLATES), "");
  assert.equal(plateDeltaLabel(60, 70, 20, ALL_PLATES), "-20 +25");
  assert.equal(plateDeltaLabel(70, 75, 20, ALL_PLATES), "+2.5");
  assert.equal(plateDeltaLabel(40, 60, 20, ALL_PLATES), "-10 +20");

  assert.equal(snapWarmupWeight(31.2, true, 20, [20, 15, 10, 5, 2.5, 1.25]), 30);
  assert.equal(snapWarmupWeight(15, true, 20, ALL_PLATES), 20);
  assert.equal(snapWarmupWeight(17, false, 20, ALL_PLATES), 17.5);
});
