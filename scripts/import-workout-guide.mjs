import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { serverCatalogue } from "../packages/server/dist/catalogue.js";

const packageRoot = resolve(process.argv[2] ?? "");
const version = "1.0.0";
const revision = "9d900120b6a4cb4b067d06e6554d90ee6456124a";
const repository = "bryllim/workout-guide";
const sourceRoot = `https://github.com/${repository}/tree/${revision}/packages/workout-guide`;
const licenseUrl = "https://creativecommons.org/licenses/by-sa/4.0/";
const destination = new URL("../packages/server/data/", import.meta.url);
const assets = new URL("exercise-media/", destination);
const existing = JSON.parse(await readFile(new URL("../third_party/everkinetic/source.json", import.meta.url), "utf8"));
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (metadata.name !== "@bryllim/workout-guide" || metadata.version !== version)
  throw new Error(`需要 @bryllim/workout-guide@${version} 的 npm 包解压目录`);
const [manifest, license, attribution] = await Promise.all([
  readFile(join(packageRoot, "manifest.json"), "utf8").then(JSON.parse),
  readFile(join(packageRoot, "LICENSE-ASSETS"), "utf8"),
  readFile(join(packageRoot, "ATTRIBUTION.md"), "utf8"),
]);
if (manifest.length !== 302 || !license.includes("Attribution-ShareAlike 4.0"))
  throw new Error("Workout Guide 素材清单或授权有变化");

const gear = {
  Barbell: ["barbell"], Dumbbell: ["dumbbell"], Cable: ["cable"], Machine: ["machine"],
  Bodyweight: ["bodyweight"], Cardio: ["bodyweight", "machine", "rope"],
  Plate: ["plate", "weighted"], Kettlebell: ["kettlebell"],
  "Pull-up Bar": ["bodyweight"], Bench: ["bodyweight"], Wall: ["bodyweight"],
  Chair: ["bodyweight"], Doorway: ["bodyweight"], Towel: ["bodyweight"], Box: ["bodyweight"],
  "Stability Ball": ["stability_ball"], "Resistance Band": ["band"],
};
const gearWords = {
  barbell: /\bbarbell\b/g, dumbbell: /\bdumbbell\b/g, cable: /\bcable\b/g,
  machine: /\b(?:lever|machine)\b/g, bodyweight: /\bbody\s?weight\b/g,
  band: /\b(?:resistance )?band\b/g, kettlebell: /\bkettlebell\b/g,
  stability_ball: /\bstability ball\b/g, plate: /\b(?:weight )?plate\b/g, weighted: /\bweighted\b/g,
};
const ignoredWords = new Set(["with", "on", "using", "the", "male", "female", "a"]);
function canonicalName(name, equipment) {
  const stripped = name.toLowerCase().normalize("NFKD").replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bpushups?\b/g, "push up").replace(/\bpullups?\b/g, "pull up")
    .replace(/\bpulldowns?\b/g, "pull down")
    .replace(/\bbiceps\b/g, "bicep").replace(/\btriceps\b/g, "tricep")
    .replace(/\b(?:single|one) (arm|leg)\b/g, "one $1")
    .replace(/\bbanded\b/g, "band")
    .replace(gearWords[equipment] ?? /^$/g, " ");
  return stripped.trim().split(/\s+/).filter((word) => !ignoredWords.has(word)).sort().join(" ");
}

// Explicit English synonyms and confirmed variants. The catalogue ID remains the stable reference.
const reviewed = {
  "rear-delt-fly": ["reverse-fly"],
  "pec-deck": ["exdb_1030"],
  "romanian-deadlift": ["romanian-deadlift", "exdb_0085"],
  "one-arm-dumbbell-row": ["exdb_0292"],
  "seated-row": ["exdb_0861"],
  "lat-pulldown": ["lat-pulldown"],
  "close-grip-lat-pulldown": ["exdb_1047"],
  "weighted-pull-up": ["exdb_0841"],
  squat: ["exdb_3593"],
  "glute-bridge": ["exdb_2471"],
  "hammer-curl": ["exdb_0313"],
  "skull-crusher": ["exdb_0060"],
  "ab-wheel": ["exdb_0857"],
  running: ["exdb_2197"],
  rowing: ["exdb_1161"],
  "stair-climber": ["exdb_2311"],
  "decline-dumbbell-press": ["exdb_0301"],
  "landmine-press": ["exdb_5074"],
  "standing-dumbbell-press": ["exdb_0426"],
  "weighted-chin-up": ["exdb_4102"],
  "hip-abduction-machine": ["exdb_0597"],
  "hip-adduction-machine": ["exdb_0598"],
  "deficit-reverse-lunge": ["exdb_7326"],
  "dumbbell-curtsy-lunge": ["exdb_0881"],
  "landmine-squat": ["exdb_7626"],
  "landmine-romanian-deadlift": ["exdb_4113"],
  "glute-focused-back-extension": ["exdb_4937"],
  "leg-press-calf-raise": ["exdb_1391"],
  "farmer-carry": ["exdb_2917"],
  "pallof-press": ["exdb_1202"],
  "hanging-knee-raise": ["hanging-knee-raise", "exdb_9819"],
  "weighted-russian-twist": ["exdb_3449"],
  elliptical: ["exdb_2192", "exdb_2141"],
  "assault-bike": ["exdb_3893"],
  "treadmill-incline-walk": ["exdb_3666"],
  "battle-ropes": ["exdb_0128"],
  "wide-push-up": ["exdb_1311"],
  "doorway-row": ["exdb_3506"],
  "prone-t-raise": ["exdb_5041"],
  "reverse-snow-angel": ["exdb_10045"],
  "l-sit-pull-up": ["exdb_3418"],
  "bodyweight-squat": ["bodyweight-squat", "exdb_1197"],
  "curtsy-lunge": ["exdb_6318"],
  "calf-raise": ["exdb_1373"],
  "side-lying-hip-abduction": ["exdb_0710"],
  "stability-ball-hamstring-curl": ["exdb_0569"],
  "banded-glute-bridge": ["exdb_2154"],
  "banded-hip-thrust": ["exdb_2760"],
  "banded-lateral-walk": ["exdb_6607"],
  "banded-seated-hip-abduction": ["exdb_3006"],
  "banded-standing-hip-abduction": ["exdb_3853"],
  "band-pull-apart": ["exdb_1503", "exdb_4568"],
  "banded-face-pull": ["exdb_5607"],
  "hollow-body-hold": ["exdb_1246"],
  "flutter-kick": ["exdb_9321"],
  "plank-shoulder-tap": ["exdb_3699"],
  "plank-jack": ["exdb_1478", "exdb_3930"],
  "l-sit-hold": ["exdb_1402"],
  "skater-hop": ["exdb_3361"],
  "arm-circles": ["exdb_3905", "exdb_3996"],
  "childs-pose": ["exdb_0945"],
  "cross-body-shoulder-stretch": ["exdb_1793"],
  "wall-calf-stretch": ["exdb_1377"],
};

const byId = new Map(serverCatalogue.map((exercise) => [exercise.id, exercise]));
const assigned = new Set(existing.illustrations.map((exercise) => exercise.exerciseId));
const poses = [];
const pngs = new Set();
const rejected = [];
await mkdir(assets, { recursive: true });
for (const item of manifest) {
  if (!/^[a-z0-9-]+$/.test(item.slug) || !Array.isArray(item.frames) || item.frames.length !== 3)
    throw new Error(`无法识别姿势图 ${item.slug}`);
  const candidates = serverCatalogue.filter((exercise) =>
    gear[item.equipment]?.includes(exercise.equipment) &&
    canonicalName(item.name, exercise.equipment) === canonicalName(exercise.englishName, exercise.equipment));
  const ids = reviewed[item.slug] ?? (candidates.length === 1 ? [candidates[0].id] : []);
  const mapped = ids.filter((id) => {
    if (!byId.has(id)) throw new Error(`待配图动作不存在 ${id}`);
    return !assigned.has(id);
  });
  if (!mapped.length) continue;

  const converted = [];
  for (const [index, frame] of item.frames.entries()) {
    if (frame.path !== `assets/${item.slug}/frame-${index + 1}.png` ||
        frame.attribution?.license !== "CC BY-SA 4.0")
      throw new Error(`姿势图路径或授权无效 ${item.slug}`);
    const filename = `wg-${item.slug}-${index + 1}.png`;
    const input = await readFile(join(packageRoot, frame.path));
    const properties = await sharp(input).metadata();
    if (!properties.hasAlpha) throw new Error(`姿势图缺少透明通道 ${frame.path}`);
    // The original white strokes are the alpha mask. Export a white-backed monochrome figure.
    let png = await sharp(input).extractChannel("alpha").negate().resize(360, 360)
      .png({ palette: true, colours: 32 }).toBuffer();
    const hasContrast = async (bytes) => {
      const { channels: [gray] } = await sharp(bytes).stats();
      return gray.min <= 64 && gray.max >= 240 && gray.stdev >= 8;
    };
    if (!(await hasContrast(png))) {
      png = await sharp(input).flatten({ background: "#fff" }).greyscale().resize(360, 360)
        .png({ palette: true, colours: 32 }).toBuffer();
    }
    if (!(await hasContrast(png))) {
      rejected.push(frame.path);
      break;
    }
    const sha256 = createHash("sha256").update(png).digest("hex");
    converted.push({ filename, png, pose: {
      path: `/media/exercises/${filename}?v=${sha256.slice(0, 12)}`,
      caption: `姿势 ${index + 1}`, sha256,
      sourceUrl: frame.attribution.source?.url ?? `${sourceRoot}/${frame.path}`,
    } });
  }
  if (converted.length !== item.frames.length) continue;
  for (const { filename, png } of converted) {
    await writeFile(new URL(filename, assets), png);
    pngs.add(filename);
  }
  for (const exerciseId of mapped) {
    assigned.add(exerciseId);
    poses.push({
      exerciseId, upstreamId: item.slug,
      author: "Bryl Lim / Workout Guide（部分原图来自 Everkinetic）",
      license: "CC BY-SA 4.0", licenseUrl,
      sourceUrl: `${sourceRoot}/assets/${item.slug}`,
      modifications: "转为白底黑线，缩放至 360×360，保留原帧顺序。",
      variation: "", frames: converted.map((frame) => frame.pose),
    });
  }
}
for (const filename of await readdir(assets)) {
  if (/^wg-[a-z0-9-]+-[1-3]\.png$/.test(filename) && !pngs.has(filename))
    await unlink(new URL(filename, assets));
}

await Promise.all([
  writeFile(new URL("workout-guide-poses.json", destination), JSON.stringify({ version, revision, repository, poses }) + "\n"),
  writeFile(new URL("LICENSE.workout-guide-assets.txt", destination), license),
  writeFile(new URL("NOTICE.workout-guide.md", destination), attribution),
]);
console.log(`新增 ${poses.length} 个动作姿势图，${pngs.size} 张服务端 PNG。`);
if (rejected.length) console.log("未导入的对比度异常素材", rejected);
