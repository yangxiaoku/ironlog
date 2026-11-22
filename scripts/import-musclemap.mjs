import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "melihcolpan/MuscleMap";
const revision = "d53ddf4d480b65979f1008b203e6b6eda0e67e54";
const base = `https://raw.githubusercontent.com/${repository}/${revision}`;
const originals = join(root, "third_party/musclemap");
const local = process.argv.includes("--local");
const license = local ? await readFile(join(originals, "LICENSE"), "utf8") : await (await fetch(`${base}/LICENSE`)).text();
if (!license.includes("MIT License"))
  throw new Error("MuscleMap 许可证需要重新核对");
const sourceNames = ["MaleFrontPaths", "MaleBackPaths"];
const sources = await Promise.all(
  sourceNames.map(async (name) => {
    if (local) return readFile(join(originals, `${name}.swift`), "utf8");
    const result = await fetch(`${base}/Sources/MuscleMap/Data/${name}.swift`);
    if (!result.ok) throw new Error("肌肉图数据下载失败");
    return result.text();
  }),
);
const subgroups = new Set([
  "upperChest",
  "lowerChest",
  "innerQuad",
  "outerQuad",
  "upperAbs",
  "lowerAbs",
  "frontDeltoid",
  "upperTrapezius",
  "lowerTrapezius",
  "rearDeltoid",
]);
const shapes = sources.flatMap((source) =>
  [
    ...source.matchAll(
      /BodyPartPathData\(\s*slug:\s*\.(\w+),([\s\S]*?)\n\s*\),?/g,
    ),
  ]
    .filter((match) => !subgroups.has(match[1]))
    .map((match) => ({
      muscle: match[1],
      paths: [...match[2].matchAll(/"([^"]+)"/g)].map((path) => path[1]),
    })),
);
if (shapes.length < 30) throw new Error("肌肉图源数据结构发生变化");
const groups = {
  chest: ["chest", "serratus"],
  back: ["trapezius", "upperBack", "rotatorCuff", "rhomboids", "lowerBack"],
  legs: [
    "quadriceps",
    "calves",
    "adductors",
    "tibialis",
    "gluteal",
    "hamstring",
  ],
  shoulders: ["deltoids"],
  arms: ["biceps", "triceps", "forearm"],
  core: ["abs", "obliques", "hipFlexors"],
};
const output = join(root, "web/assets/muscles");
const heatmap = [];
const render = (paths) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="540" viewBox="0 70 1445 1330">${paths}</svg>`))
  .png({ palette: true, colours: 64, dither: 0, effort: 8 }).toBuffer();
await mkdir(output, { recursive: true });
const labelled = new Set(Object.values(groups).flat());
const neutral = shapes.filter((shape) => !labelled.has(shape.muscle)).map((shape) => shape.muscle);
for (const [group, muscles] of Object.entries({ neutral, ...groups })) {
  const paths = shapes.filter((shape) => muscles.includes(shape.muscle))
    .flatMap((shape) => shape.paths.map((path) => `<path d="${path}" fill="#fff"/>`)).join("");
  const filename = `atlas-${group}.png`;
  const png = await render(paths);
  await writeFile(join(output, filename), png);
  heatmap.push({ filename, sha256: createHash("sha256").update(png).digest("hex") });
}
if (!local) {
  await mkdir(originals, { recursive: true });
  for (const [index, source] of sources.entries()) {
    await writeFile(join(originals, `${sourceNames[index]}.swift`), source);
  }
  await writeFile(join(originals, "LICENSE"), license);
}
await writeFile(
  join(root, "third_party/musclemap/source.json"),
  JSON.stringify(
    {
      repository,
      revision,
      heatmap,
      sources: sources.map((source, index) => ({
        filename: `${sourceNames[index]}.swift`,
        sha256: createHash("sha256").update(source).digest("hex"),
      })),
      ...(local ? {} : { fetchedAt: new Date().toISOString() }),
      transformations: [
        "将Swift内SVG路径提取为SVG",
        "仅使用整体肌群形状，按六大分类及其余部位生成白色遮罩",
        "栅格化为600px索引色 PNG",
        "同一坐标生成透明正背面叠层，按实际数据着色",
      ],
    },
    null,
    2,
  ),
);
console.log(`已生成 ${heatmap.length} 张网页肌群遮罩，固定版本 ${revision}`);
