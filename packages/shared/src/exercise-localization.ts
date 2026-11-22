import type { Exercise } from "./index.js";

type Translation = readonly [
  englishName: string,
  name: string,
  aliases?: readonly string[],
];
// 保留上游ID和英文名称，补充铁记使用的中文显示名与检索别名。
export const exerciseTranslations: Readonly<Record<string, Translation>> = {
  exdb_0289: ["dumbbell bench press", "平板哑铃卧推", ["哑铃卧推"]],
  exdb_0293: ["dumbbell bent over row", "俯身哑铃划船"],
  exdb_0297: [
    "dumbbell concentration curl",
    "哑铃集中弯举",
    ["集中弯举", "康式弯举"],
  ],
  exdb_0300: ["dumbbell deadlift", "哑铃硬拉"],
  exdb_0308: ["dumbbell fly", "哑铃飞鸟"],
  exdb_1760: [
    "dumbbell goblet squat",
    "哑铃高脚杯深蹲",
    ["高脚杯深蹲", "杯式深蹲", "酒杯深蹲"],
  ],
  exdb_0313: ["dumbbell hammer curl", "哑铃锤式弯举", ["锤式弯举"]],
  exdb_0314: ["dumbbell incline bench press", "上斜哑铃卧推"],
  exdb_0318: ["dumbbell incline curl", "上斜哑铃弯举"],
  exdb_0334: ["dumbbell lateral raise", "哑铃侧平举"],
  exdb_0336: ["dumbbell lunge", "哑铃箭步蹲", ["哑铃弓步蹲"]],
  exdb_0375: ["dumbbell pullover", "仰卧哑铃上拉", ["哑铃上拉"]],
  exdb_0383: [
    "dumbbell reverse fly",
    "哑铃反向飞鸟",
    ["哑铃反向飞鸟", "反向飞鸟"],
  ],
  exdb_1459: ["dumbbell romanian deadlift", "哑铃罗马尼亚硬拉", ["哑铃RDL"]],
  exdb_1379: ["dumbbell seated calf raise", "坐姿哑铃提踵"],
  exdb_0405: [
    "dumbbell seated shoulder press",
    "坐姿哑铃推肩",
    ["坐姿哑铃肩上推举"],
  ],
  exdb_0404: [
    "dumbbell seated shoulder press (parallel grip)",
    "坐姿对握哑铃推肩",
  ],
  exdb_2188: ["dumbbell seated triceps extension", "坐姿哑铃臂屈伸"],
  exdb_0417: ["dumbbell standing calf raise", "站姿哑铃提踵"],
  exdb_0027: ["barbell bent over row", "俯身杠铃划船", ["杠铃划船"]],
  exdb_0028: ["barbell clean and press", "杠铃翻举推举"],
  exdb_0029: ["barbell clean-grip front squat", "翻举握杠铃前蹲"],
  exdb_0030: ["barbell close-grip bench press", "窄握杠铃卧推", ["窄握卧推"]],
  exdb_0031: ["barbell curl", "杠铃弯举"],
  exdb_0032: ["barbell deadlift", "杠铃硬拉", ["传统硬拉"]],
  exdb_0033: ["barbell decline bench press", "下斜杠铃卧推"],
  exdb_0038: ["barbell drag curl", "杠铃拖拉弯举", ["拖拉弯举"]],
  exdb_0042: ["barbell front squat", "杠铃前蹲", ["前蹲"]],
  exdb_0043: ["barbell full squat", "杠铃全蹲"],
  exdb_1545: [
    "barbell full zercher squat",
    "杠铃泽奇全蹲",
    ["泽奇深蹲", "Zercher深蹲"],
  ],
  exdb_1436: ["barbell high bar squat", "高杠位杠铃深蹲", ["高杠深蹲"]],
  exdb_0047: ["barbell incline bench press", "上斜杠铃卧推"],
  exdb_1719: ["barbell incline close grip bench press", "上斜窄握杠铃卧推"],
  exdb_0048: ["barbell incline reverse-grip press", "上斜反握杠铃推举"],
  exdb_0049: ["barbell incline row", "上斜凳杠铃划船"],
  exdb_0053: ["barbell jump squat", "杠铃跳跃深蹲"],
  exdb_1410: ["barbell lateral lunge", "杠铃侧弓步蹲"],
  exdb_1435: ["barbell low bar squat", "低杠位杠铃深蹲", ["低杠深蹲"]],
  exdb_0054: ["barbell lunge", "杠铃箭步蹲", ["杠铃弓步蹲"]],
  exdb_0063: ["barbell narrow stance squat", "窄站距杠铃深蹲"],
  exdb_0069: ["barbell overhead squat", "杠铃过顶深蹲"],
  exdb_3017: [
    "barbell pendlay row",
    "杠铃潘德雷划船",
    ["潘德雷划船", "Pendlay划船"],
  ],
  exdb_0070: ["barbell preacher curl", "牧师凳杠铃弯举", ["托臂杠铃弯举"]],
  exdb_0076: ["barbell rear delt row", "杠铃后三角划船"],
  exdb_0868: ["cable curl", "绳索弯举"],
  exdb_0158: ["cable decline fly", "下斜绳索飞鸟"],
  exdb_0162: ["cable front raise", "绳索前平举"],
  exdb_0171: ["cable incline fly", "上斜绳索飞鸟"],
  exdb_0175: ["cable kneeling crunch", "跪姿绳索卷腹", ["绳索卷腹"]],
  exdb_0178: ["cable lateral raise", "绳索侧平举"],
  exdb_0179: ["cable low fly", "低位绳索夹胸"],
  exdb_0180: ["cable low seated row", "坐姿低位绳索划船"],
  exdb_0188: ["cable middle fly", "中位绳索夹胸"],
  exdb_0189: ["cable one arm bent over row", "单臂绳索俯身划船"],
  exdb_0190: ["cable one arm curl", "单臂绳索弯举"],
  exdb_0192: ["cable one arm lateral raise", "单臂绳索侧平举"],
  exdb_3563: ["cable one arm pulldown", "单臂绳索高位下拉"],
  exdb_1723: ["cable one arm tricep pushdown", "单臂绳索三头下压"],
  exdb_0198: ["cable pulldown", "绳索高位下拉"],
  exdb_0201: ["cable pushdown", "绳索下压"],
  exdb_0205: ["cable rear pulldown", "绳索颈后下拉"],
  exdb_0873: ["cable reverse crunch", "绳索反向卷腹"],
  exdb_0206: ["cable reverse curl", "反握绳索弯举"],
  exdb_0210: ["cable reverse wrist curl", "绳索反向腕弯举"],
  exdb_0195: ["cable preacher curl", "牧师凳绳索弯举", ["托臂绳索弯举"]],
  exdb_0577: ["lever chest press", "器械推胸"],
  exdb_0576: ["lever chest press", "器械推胸"],
  exdb_1300: ["lever decline chest press", "下斜器械推胸"],
  exdb_0579: ["lever front pulldown", "器械前侧高位下拉"],
  exdb_0581: ["lever high row", "器械高位划船"],
  exdb_1299: ["lever incline chest press", "上斜器械推胸"],
  exdb_0582: ["lever kneeling leg curl", "跪姿器械腿弯举"],
  exdb_0585: ["lever leg extension", "器械腿屈伸", ["腿部伸展机"]],
  exdb_0586: ["lever lying leg curl", "俯卧器械腿弯举"],
  exdb_0588: ["lever narrow grip seated row", "窄握坐姿器械划船"],
  exdb_0590: ["lever one arm shoulder press", "单臂器械推肩"],
  exdb_2285: ["lever pullover", "器械上拉"],
  exdb_0599: ["lever seated leg curl", "坐姿器械腿弯举"],
  exdb_1350: ["lever seated row", "坐姿器械划船"],
  exdb_0603: ["lever shoulder press", "器械推肩", ["器械肩上推举"]],
  exdb_0606: ["lever t bar row", "器械T杆划船", ["T杠划船"]],
  exdb_0739: ["sled 45в° leg press", "45度斜板腿举", ["45度腿举"]],
  exdb_0743: ["sled hack squat", "哈克深蹲机", ["哈克深蹲"]],
  exdb_0274: ["crunch floor", "地面卷腹"],
  exdb_0276: ["dead bug", "死虫式"],
  exdb_0472: ["hanging leg raise", "悬垂举腿"],
  exdb_0872: ["reverse crunch", "反向卷腹"],
  exdb_0651: ["pull up (neutral grip)", "对握引体向上"],
  exdb_0267: ["crunch (hands overhead)", "双臂过顶卷腹"],
  exdb_1764: ["hanging leg hip raise", "悬垂举腿抬髋"],
};

export function localizeExercise(exercise: Exercise): Exercise {
  const translation = exerciseTranslations[exercise.id];
  if (
    exercise.custom ||
    exercise.source?.repository !== "hasaneyldrm/exercises-dataset" ||
    !translation ||
    exercise.englishName !== translation[0]
  )
    return exercise;
  return {
    ...exercise,
    name: translation[1],
    aliases: [...new Set([...exercise.aliases, ...(translation[2] ?? [])])],
  };
}

export function matchesExercise(exercise: Exercise, query: string) {
  const compact = (text: string) =>
    text.toLowerCase().replace(/[\s_\-‐‑–—]+/g, "");
  const names = [exercise.name, exercise.englishName, ...exercise.aliases].map(
    compact,
  );
  return query
    .trim()
    .split(/\s+/)
    .every((term) => names.some((name) => name.includes(compact(term))));
}
