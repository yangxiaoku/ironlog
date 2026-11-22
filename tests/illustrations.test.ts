import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import sharp from "sharp";
import { exerciseCatalogue } from "@ironlog/shared";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("网页肌群遮罩保留来源与哈希，打包后维持透明背景", async () => {
  const source = JSON.parse(readFileSync("third_party/musclemap/source.json", "utf8"));
  assert.equal(source.revision, "d53ddf4d480b65979f1008b203e6b6eda0e67e54");
  for (const file of source.sources)
    assert.equal(sha256(readFileSync(join("third_party/musclemap", file.filename))), file.sha256);
  assert.equal(source.heatmap.length, 7);
  for (const file of source.heatmap) {
    const png = readFileSync(join("web/assets/muscles", file.filename));
    assert.equal(sha256(png), file.sha256);
    assert.deepEqual(readFileSync(join("web/dist", file.filename)), png);
    const { width, height, hasAlpha } = await sharp(png).metadata();
    assert.deepEqual([width, height, hasAlpha], [600, 540, true]);
  }
  const atlas = await sharp("web/dist/atlas-all.png").metadata();
  assert.deepEqual([atlas.width, atlas.height, atlas.hasAlpha], [600, 540, true]);
});

test("网页首页与各页面头图的深浅素材从独立资源目录打包", () => {
  const manifest = JSON.parse(readFileSync("web/assets/visuals/manifest.json", "utf8"));
  assert.equal(manifest.assets.length, 8);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(asset.output);
    assert.equal(sha256(bytes), asset.sha256);
    assert.deepEqual(readFileSync(join("web/dist", basename(asset.output))), bytes);
  }
});

test("服务端双姿势图保留原始出处、许可和哈希", async () => {
  const data = JSON.parse(readFileSync("packages/server/data/everkinetic-poses.json", "utf8"));
  assert.equal(data.illustrations.length, 17);
  assert.match(readFileSync("third_party/everkinetic/LICENSE.md", "utf8"), /Attribution-ShareAlike 4.0 International/);
  for (const item of data.illustrations) {
    assert.ok(exerciseCatalogue.some((exercise) => exercise.id === item.exerciseId));
    assert.equal(item.frames.length, 2);
    assert.notEqual(item.frames[0].sha256, item.frames[1].sha256);
    for (const frame of item.frames) {
      const png = readFileSync(join("packages/server/data/exercise-media", basename(frame.path)));
      const source = readFileSync(join("third_party/everkinetic/svg", basename(frame.sourceUrl)), "utf8");
      assert.match(source, /<svg/);
      assert.ok(frame.sourceUrl.includes(data.revision));
      assert.equal(sha256(png), frame.sha256);
      const metadata = await sharp(png).metadata();
      assert.equal(metadata.width, 360);
      assert.equal(metadata.height, 360);
    }
  }
});
