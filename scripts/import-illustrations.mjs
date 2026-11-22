import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "everkinetic/data";
const revision = "446bb9a3d0c3beb6b84f7c9d77dfc8af707a2ab6";
const base = `https://raw.githubusercontent.com/${repository}/${revision}`;
const mappings = [
  ["exdb_0336", "0115", ["站立准备", "前跨下蹲"], ["dumbbell lunge"]],
  ["exdb_1460", "0121", ["前脚落地", "下沉弓步"], ["walking lunge"]],
  [
    "bench-press",
    "0042",
    ["下放", "推起"],
    ["Barbell Bench Press", "barbell bench press"],
  ],
  [
    "incline-dumbbell",
    "0061",
    ["下放", "推起"],
    ["Incline Dumbbell Press", "dumbbell incline bench press"],
  ],
  [
    "cable-fly",
    "0048",
    ["展开", "合拢"],
    ["Cable Fly", "cable cross-over variation"],
  ],
  ["push-up", "0077", ["下放", "撑起"], ["Push-up", "push up"]],
  [
    "seated-row",
    "0025",
    ["伸臂", "拉回"],
    ["Seated Cable Row", "cable seated row"],
  ],
  ["pull-up", "0087", ["悬垂", "拉起"], ["Pull-up", "pull up"]],
  ["squat", "0122", ["下蹲", "站起"], ["Barbell Squat", "barbell full squat"]],
  ["leg-press", "0127", ["屈膝", "蹬出"], ["Leg Press", "sled 45° leg press"]],
  ["leg-curl", "0117", ["伸腿", "屈膝"], ["Leg Curl", "lever lying leg curl"]],
  [
    "lateral-raise",
    "0018",
    ["手臂下放", "侧向抬起"],
    ["Dumbbell Lateral Raise", "dumbbell lateral raise"],
  ],
  [
    "barbell-curl",
    "0211",
    ["手臂下放", "屈肘上举"],
    ["Barbell Curl", "barbell curl"],
  ],
  [
    "hammer-curl",
    "0227",
    ["手臂下放", "屈肘上举"],
    ["Hammer Curl", "dumbbell hammer curl"],
  ],
  [
    "triceps-pushdown",
    "0206",
    ["屈肘", "向下伸肘"],
    ["Triceps Pushdown", "cable pushdown (with rope attachment)"],
  ],
  [
    "overhead-extension",
    "0198",
    ["屈肘下放", "伸肘上举"],
    ["Dumbbell Overhead Extension", "dumbbell standing triceps extension"],
  ],
  ["crunch", "0291", ["平躺", "卷起"], ["Crunch", "crunch floor"]],
];
const variations = {
  "cable-fly": "图示为高位绳索夹胸",
  "leg-curl": "图示为俯卧腿弯举",
  "triceps-pushdown": "图示使用绳索绳把",
  crunch: "图示中双脚支撑在凳上",
};

async function download(path) {
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) throw new Error(`下载失败 ${path} ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const [catalogueBytes, licenseBytes] = await Promise.all([
  download("dist/exercises.json"),
  download("LICENSE.md"),
]);
const catalogue = JSON.parse(catalogueBytes.toString("utf8"));
const license = licenseBytes.toString("utf8");
if (!license.includes("Attribution-ShareAlike 4.0 International"))
  throw new Error("插图许可与预期不符");
const originalsDirectory = join(root, "third_party/everkinetic/svg");
const imagesDirectory = join(root, "packages/server/data/exercise-media");
await mkdir(originalsDirectory, { recursive: true });
await mkdir(imagesDirectory, { recursive: true });
const illustrations = [];
for (const [exerciseId, upstreamId, captions, englishNames] of mappings) {
  const exercise = catalogue.find((item) => item.id === upstreamId);
  if (!exercise || exercise.svg.length !== 2)
    throw new Error(`缺少双姿势插图 ${upstreamId}`);
  const frames = [];
  for (const [index, path] of exercise.svg.entries()) {
    const svg = await download(`dist/${path}`);
    await writeFile(join(originalsDirectory, path.split("/").at(-1)), svg);
    const output = `${exerciseId.replaceAll("_", "-")}-${index + 1}.png`;
    const png = await sharp(svg)
      .resize(360, 360, { fit: "contain", background: "#ffffff" })
      .png({ palette: true, colours: 32 })
      .toBuffer();
    await writeFile(join(imagesDirectory, output), png);
    frames.push({
      caption: captions[index],
      path: `/assets/exercises/${output}`,
      sourceUrl: `${base}/dist/${path}`,
      sha256: createHash("sha256").update(png).digest("hex"),
    });
  }
  illustrations.push({
    exerciseId,
    upstreamId,
    upstreamName: exercise.name,
    englishNames,
    variation: variations[exerciseId] ?? "",
    frames,
  });
}
const metadata = {
  repository,
  revision,
  author: "Everkinetic / Greg Priday",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  sourceUrl: `https://github.com/${repository}/tree/${revision}`,
  modifications:
    "SVG转为360×360 PNG，等比例缩放并增加白色留边。转换后的图片继续按CC BY-SA 4.0提供。",
  illustrations,
};
await writeFile(
  join(root, "third_party/everkinetic/source.json"),
  JSON.stringify(metadata, null, 2),
);
await writeFile(
  join(root, "packages/server/data/everkinetic-poses.json"),
  JSON.stringify(metadata, null, 2),
);
await writeFile(join(root, "third_party/everkinetic/LICENSE.md"), license);
const size = (
  await Promise.all(
    illustrations.flatMap((item) =>
      item.frames.map((frame) =>
        readFile(join(imagesDirectory, frame.path.split("/").at(-1))).then(
          (file) => file.length,
        ),
      ),
    ),
  )
).reduce((sum, bytes) => sum + bytes, 0);
console.log(
  `已导入${illustrations.length}个动作的${illustrations.length * 2}张插图，共${size}字节，版本${revision}`,
);
