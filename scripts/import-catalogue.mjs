import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "hasaneyldrm/exercises-dataset";
const commitResponse = await fetch(
  `https://api.github.com/repos/${repository}/commits/main`,
);
if (!commitResponse.ok)
  throw new Error(`无法读取上游版本 ${commitResponse.status}`);
const { sha } = await commitResponse.json();
const base = `https://raw.githubusercontent.com/${repository}/${sha}`;
const [dataResponse, licenseResponse] = await Promise.all([
  fetch(`${base}/data/exercises.json`),
  fetch(`${base}/LICENSE`),
]);
if (!dataResponse.ok || !licenseResponse.ok)
  throw new Error("动作库或许可证下载失败");
const data = await dataResponse.json();
const license = await licenseResponse.text();
if (!license.includes("MIT License"))
  throw new Error("上游许可证发生变化，需要重新核对");
const groups = {
  abs: "core",
  quads: "legs",
  lats: "back",
  calves: "legs",
  pectorals: "chest",
  glutes: "legs",
  hamstrings: "legs",
  adductors: "legs",
  triceps: "arms",
  spine: "back",
  "upper back": "back",
  biceps: "arms",
  delts: "shoulders",
  forearms: "arms",
  traps: "back",
  "serratus anterior": "chest",
  abductors: "legs",
  "levator scapulae": "back",
  "cardiovascular system": "cardio",
};
const equipment = {
  "body weight": "bodyweight",
  cable: "cable",
  "leverage machine": "machine",
  assisted: "machine",
  barbell: "barbell",
  dumbbell: "dumbbell",
  "ez barbell": "barbell",
  "sled machine": "machine",
  "olympic barbell": "barbell",
  "smith machine": "machine",
  "trap bar": "barbell",
  band: "band",
  "resistance band": "band",
  kettlebell: "kettlebell",
  weighted: "weighted",
  "stability ball": "stability_ball",
  "bosu ball": "balance_trainer",
  "medicine ball": "medicine_ball",
  rope: "rope",
  roller: "foam_roller",
  "wheel roller": "ab_wheel",
  "upper body ergometer": "machine",
  "skierg machine": "machine",
  "stationary bike": "machine",
  "elliptical machine": "machine",
  "stepmill machine": "machine",
  hammer: "hammer",
  tire: "tire",
};
const secondaryGroups = {
  ...groups,
  abdominals: "core",
  core: "core",
  "lower abs": "core",
  obliques: "core",
  back: "back",
  "lower back": "back",
  "latissimus dorsi": "back",
  rhomboids: "back",
  trapezius: "back",
  brachialis: "arms",
  "grip muscles": "arms",
  "wrist extensors": "arms",
  "wrist flexors": "arms",
  quadriceps: "legs",
  "hip flexors": "legs",
  "inner thighs": "legs",
  shins: "legs",
  soleus: "legs",
  chest: "chest",
  "upper chest": "chest",
  deltoids: "shoulders",
  "rear deltoids": "shoulders",
  "rotator cuff": "shoulders",
  shoulders: "shoulders",
};
for (const item of data) {
  if (!Object.hasOwn(groups, item.target) || !Object.hasOwn(equipment, item.equipment))
    throw new Error(`动作 ${item.id} 分类尚未映射: ${item.target}, ${item.equipment}`);
}
if (new Set(data.map((item) => item.id)).size !== data.length)
  throw new Error("上游动作编号重复");

const exercises = data
  .map((item) => ({
    id: `exdb_${item.id}`,
    name: item.name,
    englishName: item.name,
    aliases: [],
    muscle: groups[item.target],
    secondaryMuscles: [
      ...new Set(
        item.secondary_muscles
          .map((muscle) => secondaryGroups[muscle])
          .filter((muscle) => muscle && muscle !== groups[item.target]),
      ),
    ],
    equipment: equipment[item.equipment],
    mode: groups[item.target] === "cardio" || /^(front plank|side plank)$/.test(item.name)
      ? "timed"
      : /^assisted /.test(item.name)
        ? "assisted"
        : "reps",
    volumeMultiplier:
      item.equipment === "dumbbell" &&
      !/one arm|one-arm|single arm|single-arm|alternate|alternating/.test(
        item.name,
      )
        ? 2
        : 1,
    instructions: item.instruction_steps.zh?.length
      ? item.instruction_steps.zh
      : item.instruction_steps.en,
    mistakes: [],
    custom: false,
    source: {
      repository,
      revision: sha,
      id: item.id,
      license: "MIT",
      url: `https://github.com/${repository}/blob/${sha}/data/exercises.json`,
    },
  }));
await mkdir(join(root, "packages/server/data"), { recursive: true });
await mkdir(join(root, "third_party/exercisedb"), { recursive: true });
await writeFile(
  join(root, "packages/server/data/exercises.json"),
  JSON.stringify(exercises),
);
await writeFile(join(root, "third_party/exercisedb/LICENSE"), license);
await writeFile(join(root, "packages/server/data/LICENSE.exercisedb.txt"), license);
await writeFile(
  join(root, "third_party/exercisedb/source.json"),
  JSON.stringify(
    {
      repository,
      revision: sha,
      fetchedAt: new Date().toISOString(),
      upstreamCount: data.length,
      importedCount: exercises.length,
      dataUrl: `${base}/data/exercises.json`,
      transformations: [
        "映射器械与肌群分类",
        "保留上游中文步骤并以英文回退",
        "使用独立ID前缀",
        "有氧动作按时长记录",
        "仅导入文本",
      ],
    },
    null,
    2,
  ),
);
console.log(`已导入 ${exercises.length} 个动作，固定版本 ${sha}`);
const starterNames = {
  exdb_1760: "哑铃高脚杯深蹲", exdb_0293: "俯身哑铃划船", exdb_0289: "平板哑铃卧推",
  exdb_0300: "哑铃硬拉", exdb_0336: "哑铃箭步蹲", exdb_1460: "行走弓步蹲",
};
const offlineExercises = Object.entries(starterNames).map(([id, name]) => {
  const exercise = exercises.find((item) => item.id === id);
  if (!exercise) throw new Error(`基础模板动作已变化 ${id}`);
  return { ...exercise, name, volumeMultiplier: id === "exdb_1760" ? 1 : exercise.volumeMultiplier };
});
await writeFile(join(root, "packages/shared/src/starter-exercises.ts"),
  `// 由 scripts/import-catalogue.mjs 从固定版本数据选取，保留教学和素材来源。\nimport type { Exercise } from "./index.js";\n\nexport const starterExercises: Exercise[] = ${JSON.stringify(offlineExercises, null, 2)};\n`);
