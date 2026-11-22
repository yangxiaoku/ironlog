import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const file = "https://upload.wikimedia.org/wikipedia/commons/3/31/DumbbellDeadlift.JPG";
const sourceUrl = "https://commons.wikimedia.org/wiki/File:DumbbellDeadlift.JPG";
const expected = "815b20dc839c8c39c9ea405d06e31097a80022d0";
const response = await fetch(file, { headers: { "User-Agent": "Ironlog developer asset import/1.0" } });
if (!response.ok) throw new Error(`哑铃硬拉姿势原图下载失败 ${response.status}`);
const source = Buffer.from(await response.arrayBuffer());
if (createHash("sha1").update(source).digest("hex") !== expected)
  throw new Error("哑铃硬拉姿势原图校验失败");
const data = new URL("../packages/server/data/", import.meta.url);
const frames = [];
for (const [index, caption] of ["屈髋下放", "站直完成"].entries()) {
  const filename = `commons-dumbbell-deadlift-${index + 1}.png`;
  const png = await sharp(source).extract({ left: index * 256, top: 0, width: 256, height: 448 })
    .resize(360, 360, { fit: "contain", background: "#fff" }).greyscale().png().toBuffer();
  const sha256 = createHash("sha256").update(png).digest("hex");
  await writeFile(new URL(`exercise-media/${filename}`, data), png);
  frames.push({ path: `/media/exercises/${filename}?v=${sha256.slice(0, 12)}`, caption, sha256, sourceUrl });
}
const pose = {
  exerciseId: "exdb_0300", upstreamId: "DumbbellDeadlift.JPG",
  author: "GeorgeStepanek / Wikimedia Commons",
  license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  sourceUrl, modifications: "将原始对照照片分为两帧，缩放并转灰阶。", variation: "", frames,
};
await writeFile(new URL("commons-poses.json", data), JSON.stringify({ poses: [pose] }, null, 2) + "\n");
