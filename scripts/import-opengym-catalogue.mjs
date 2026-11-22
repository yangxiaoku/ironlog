import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = "DuarteSantos8/openGym";
const release = "v1.4.5";
const revision = "e4a68a94c42a3c17cbd560d66ce2e46a7048ab99";
const output = new URL("../packages/server/data/", import.meta.url);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function resolveUpstreamDir() {
  const explicit = argValue("--dir") ?? process.env.OPENGYM_DIR;
  if (explicit) return { dir: resolve(explicit), cleanup: async () => {} };

  const dir = await mkdtemp(join(tmpdir(), "opengym-catalogue-"));
  try {
    const runGit = (...args) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    runGit("init");
    runGit("remote", "add", "origin", `https://github.com/${repository}.git`);
    runGit("sparse-checkout", "init", "--no-cone");
    runGit(
      "sparse-checkout",
      "set",
      "/LICENSE",
      "/NOTICE.md",
      "/catalogue/exercises/",
      "/catalogue/i18n/zh.json",
    );
    runGit("fetch", "--depth", "1", "--filter=blob:none", "origin", revision);
    runGit("checkout", "FETCH_HEAD");
    return {
      dir,
      cleanup: async () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `无法拉取 openGym 规范目录 (${revision}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const muscleGroups = {
  chest: ["pectorals", "chest", "upper chest", "serratus anterior", "serratus"],
  back: [
    "lats", "spine", "upper back", "upper-back", "lower back", "lower-back",
    "back", "rhomboids", "traps", "trapezius", "levator scapulae", "latissimus dorsi",
  ],
  legs: [
    "quads", "quadriceps", "calves", "glutes", "gluteal", "hamstrings", "hamstring",
    "adductors", "abductors", "shins", "hip flexors", "hip-flexors",
    "inner thighs", "soleus", "groin",
  ],
  shoulders: ["front delts", "front-delts", "side delts", "side-delts", "rear delts", "rear-delts", "rotator cuff", "delts"],
  arms: ["biceps", "forearms", "forearm", "triceps", "wrist flexors", "wrist extensors", "brachialis", "grip muscles"],
  core: ["abs", "abdominals", "core", "obliques", "lower abs"],
  cardio: ["cardiovascular system"],
};
const muscles = Object.keys(muscleGroups);
const muscleIndex = new Map(Object.values(muscleGroups).flatMap((names, index) =>
  names.map((name) => [name, index])));

const equipmentGroups = {
  bodyweight: ["body weight"],
  barbell: ["barbell", "ez barbell", "olympic barbell", "trap bar"],
  dumbbell: ["dumbbell"],
  machine: [
    "stationary bike", "leverage machine", "assisted", "sled machine",
    "elliptical machine", "upper body ergometer", "smith machine",
    "skierg machine", "stepmill machine",
  ],
  cable: ["cable"],
  band: ["band", "resistance band"],
  weighted: ["weighted"],
  kettlebell: ["kettlebell"],
  balance_trainer: ["bosu ball"],
  stability_ball: ["stability ball"],
  medicine_ball: ["medicine ball"],
  ab_wheel: ["wheel roller"],
  rope: ["rope"],
  foam_roller: ["roller"],
  hammer: ["hammer"],
  tire: ["tire"],
  suspension: ["suspension trainer"],
  landmine: ["landmine"],
  plate: ["weight plate"],
  massage_ball: ["massage ball"],
  sandbag: ["sandbag"],
  macebell: ["macebell"],
};
const equipment = Object.keys(equipmentGroups);
const equipmentIndex = new Map(Object.values(equipmentGroups).flatMap((names, index) =>
  names.map((name) => [name, index])));
const modes = ["reps", "timed", "assisted"];
const categories = [
  "strength", "calisthenics", "cardio", "mobility", "stretching",
  "yoga", "pilates", "plyometrics", "isometric", "olympic", "rehab", "combat",
];

function collectSecondaryMuscles(entry, primaryMuscle, old) {
  const indices = new Set();
  for (const value of entry.secondaryMuscles ?? []) {
    if (muscleIndex.has(value)) indices.add(muscleIndex.get(value));
  }
  for (const value of old?.secondaryMuscles ?? []) {
    const idx = muscles.indexOf(value);
    if (idx >= 0) indices.add(idx);
  }
  const weights = entry.muscleMap?.weights ?? {};
  for (const slug of [...(entry.muscleMap?.primaries ?? []), ...(entry.muscleMap?.secondaries ?? [])]) {
    if ((weights[slug] ?? 0.4) <= 0) continue;
    if (muscleIndex.has(slug)) indices.add(muscleIndex.get(slug));
  }
  indices.delete(primaryMuscle);
  indices.delete(muscles.indexOf("cardio"));
  return [...indices].reduce((mask, index) => mask | (1 << index), 0);
}

const { dir, cleanup } = await resolveUpstreamDir();
try {
  const [exerciseFiles, chinese, license, notice, legacy] = await Promise.all([
    readdir(join(dir, "catalogue/exercises")).then((files) => files.filter((f) => f.endsWith(".json")).sort()),
    readFile(join(dir, "catalogue/i18n/zh.json"), "utf8").then(JSON.parse),
    readFile(join(dir, "LICENSE"), "utf8"),
    readFile(join(dir, "NOTICE.md"), "utf8"),
    readFile(new URL("exercises.json", output), "utf8").then(JSON.parse),
  ]);

  if (!license.includes("GNU AFFERO GENERAL PUBLIC LICENSE") ||
      !notice.includes("## Exercise text (names, muscles, descriptions, instructions)")) {
    throw new Error("openGym 教学数据的授权声明发生变化");
  }

  const allEntries = await Promise.all(
    exerciseFiles.map(async (file) =>
      JSON.parse(await readFile(join(dir, "catalogue/exercises", file), "utf8")),
    ),
  );
  const rows = allEntries
    .filter((entry) => !entry.variantOf)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  const variants = Object.fromEntries(
    allEntries.filter((entry) => entry.variantOf).map((entry) => [entry.id, entry.variantOf]),
  );

  const legacyIndex = new Map(legacy.map((exercise) => [exercise.source.id, exercise]));
  const ids = new Set(rows.map(({ id }) => id));
  if (ids.size !== rows.length ||
      Object.keys(variants).some((id) => ids.has(id)) ||
      Object.values(variants).some((id) => !ids.has(id)) ||
      legacy.some((entry) => !ids.has(entry.source.id))) {
    throw new Error("动作编号重复、变体目标无效或旧动作缺失");
  }

  let chineseDescriptions = 0;
  const exercises = rows.map((entry) => {
    const old = legacyIndex.get(entry.id);
    const target = muscleIndex.get(entry.target);
    const gear = equipmentIndex.get(entry.equipment);
    const category = categories.indexOf(entry.category ?? "strength");
    if (target === undefined || gear === undefined || category < 0) {
      throw new Error(`未知动作分类 ${entry.id}: ${entry.target}, ${entry.equipment}, ${entry.category}`);
    }

    // An exercise that has shipped keeps its logging semantics and classification for old records.
    const muscle = old ? muscles.indexOf(old.muscle) : target;
    const machine = old ? equipment.indexOf(old.equipment) : gear;
    const mode = old
      ? modes.indexOf(old.mode)
      : entry.hold || entry.track === "distance" || entry.category === "cardio"
        ? 1
        : /^assisted /.test(entry.name)
          ? 2
          : 0;
    const localized = chinese[entry.id];
    const steps = localized?.instructions?.length ? localized.instructions : entry.instructions;
    if (!Array.isArray(steps) || !steps.length || steps.length > 16 ||
        steps.some((step) => typeof step !== "string" || !step.trim() || step.length > 300)) {
      throw new Error(`教学步骤无效 ${entry.id}`);
    }
    const zhDesc = localized?.description?.trim();
    if (zhDesc) chineseDescriptions++;
    const description = zhDesc || entry.description?.trim();
    if (!description || description.length > 400) {
      throw new Error(`动作简介无效 ${entry.id}`);
    }
    const name = localized?.name?.trim();
    if (!name || name.length > 120 || !/^\d+$/.test(entry.id) || entry.name.length > 120 ||
        muscle < 0 || machine < 0 || mode < 0) {
      throw new Error(`动作数据无效 ${entry.id}`);
    }

    const mask = collectSecondaryMuscles(entry, muscle, old);
    const enSteps = entry.instructions?.join(" ") ?? "";
    const load = old?.volumeMultiplier ?? (entry.equipment === "dumbbell" &&
      /two dumbbells|a pair of dumbbells|dumbbell in each hand/i.test(enSteps) &&
      !/one.arm|single.arm|alternat/i.test(entry.name)
      ? 2
      : 1);

    const item = [entry.id, name, entry.name, muscle, mask, machine, mode, load, category, steps, description];
    if (old && old.englishName !== entry.name) item.push(old.englishName);
    return item;
  });

  const data = { release, revision, muscles, equipment, modes, categories, exercises };
  const provenance = {
    repository,
    release,
    revision,
    movementCount: exercises.length,
    describedCount: exercises.filter((row) => Boolean(row[10])).length,
    chineseDescriptions,
    alternateDemonstrations: Object.keys(variants).length,
    sources: ["catalogue/exercises/", "catalogue/i18n/zh.json"],
    transformations: [
      "直接读取 openGym canonical catalogue/exercises JSON 与 catalogue/i18n/zh.json",
      "保留原动作编号与既有计量方式",
      "同步动作简介 description 与肌肉权重补充（缺少中文时回退英文简介/步骤）",
      "排除仅替代演示的变体",
      "仅导入文字，保持合法开源配图来源不变",
    ],
  };

  await Promise.all([
    writeFile(new URL("opengym-catalogue.json", output), JSON.stringify(data)),
    writeFile(new URL("opengym-source.json", output), JSON.stringify(provenance, null, 2) + "\n"),
    writeFile(new URL("LICENSE.opengym.txt", output), license),
    writeFile(new URL("NOTICE.opengym.md", output), notice),
    writeFile(
      new URL("../packages/shared/src/catalogue-version.ts", import.meta.url),
      `// Generated by scripts/import-opengym-catalogue.mjs.\nexport const catalogueDataVersion = "${revision}:2";\n`,
    ),
  ]);
  console.log(
    `openGym ${release} (${revision.slice(0, 8)}): 已从 canonical catalogue/ 导入 ${exercises.length} 个动作（含 ${chineseDescriptions} 条中文简介，${Object.keys(variants).length} 个替代演示）`,
  );
} finally {
  await cleanup();
}
