import { appleWorkoutInput, type AppleWorkoutInput } from "./apple-health.js";
import { DomainError } from "./store.js";

type Fields = Record<string, unknown>;
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const asFields = (value: unknown): Fields =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([name, item]) => [key(name), item]))
    : {};
function read(fields: Fields, ...names: string[]) {
  for (const name of names) {
    const value = fields[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
const str = (value: unknown) => typeof value === "string" ? value.trim() : undefined;
function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = str(value);
  return text && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined;
}

const workouts = ["workouts", "hkworkouts", "workoutsamples", "workoutrecords", "workoutsummary"];
const starts = ["startedat", "startdate", "starttime", "start", "startdatetime"];
const ends = ["endedat", "enddate", "endtime", "end", "enddatetime"];
const types = ["workoutactivitytype", "activitytype", "workouttype", "activitytyperawvalue",
  "workoutactivitytyperawvalue", "activitytypeid", "workouttypename", "activity"];

function hasWorkoutFields(fields: Fields, workoutGroup: boolean) {
  return (types.some((name) => Object.hasOwn(fields, name)) || (workoutGroup && read(fields, "type", "name") !== undefined)) &&
    read(fields, ...starts) !== undefined && read(fields, ...ends) !== undefined;
}
function isWorkoutLabel(value: unknown) {
  return typeof value === "string" && [...workouts, "workout", "hkworkout", "hkworkouttypeidentifier"].includes(key(value));
}
function findWorkouts(value: unknown, depth = 0, workoutGroup = false): unknown[] | undefined {
  if (depth > 5) return undefined;
  if (Array.isArray(value)) {
    const workoutDatasets = value.filter((item) => isWorkoutLabel(read(asFields(item), "type", "identifier", "name")));
    if (workoutDatasets.length) {
      const lists = workoutDatasets.map((item) => findWorkouts(item, depth + 1, true));
      return lists.every((list) => list !== undefined) ? lists.flatMap((list) => list!) : undefined;
    }
    if (workoutGroup || value.length === 0 || value.some((item) => hasWorkoutFields(asFields(item), false))) return value;
    return undefined;
  }

  const fields = asFields(value);
  for (const name of [...workouts, "workout", "data", "payload", "exports", "datasets", "records", "samples", "items", "metrics"]) {
    if (!Object.hasOwn(fields, name)) continue;
    const list = findWorkouts(fields[name], depth + 1, workoutGroup || workouts.includes(name) || name === "workout");
    if (list) return list;
  }
  return hasWorkoutFields(fields, workoutGroup) ? [value] : undefined;
}

// HealthKit raw values for the workouts that Ironlog classifies explicitly.
// https://learn.microsoft.com/en-us/dotnet/api/healthkit.hkworkoutactivitytype
const healthKitTypes: Record<number, string> = {
  2: "badminton", 6: "basketball", 11: "crossTraining", 13: "cycling", 14: "dance", 16: "elliptical",
  20: "functionalStrengthTraining", 24: "hiking", 30: "mixedCardio", 33: "preparationAndRecovery", 35: "rowing",
  37: "running", 41: "soccer", 44: "stairClimbing", 46: "swimming", 48: "tennis", 50: "traditionalStrengthTraining",
  52: "walking", 57: "yoga", 59: "coreTraining", 62: "flexibility", 63: "highIntensityIntervalTraining",
  64: "jumpRope", 66: "pilates", 68: "stairs", 73: "mixedCardio", 74: "cycling", 78: "socialDance", 80: "cooldown",
  3000: "other",
};
const localizedTypes: Record<string, string> = {
  "传统力量训练": "traditionalStrengthTraining", "传统肌力訓練": "traditionalStrengthTraining", "傳統肌力訓練": "traditionalStrengthTraining",
  "功能性力量训练": "functionalStrengthTraining", "功能性肌力訓練": "functionalStrengthTraining",
  "户外跑步": "outdoorRunning", "戶外跑步": "outdoorRunning", "室内跑步": "indoorRunning", "室內跑步": "indoorRunning", "跑步": "running",
  "步行": "walking", "骑行": "cycling", "單車": "cycling", "踏步机": "stairClimbing", "踏步機": "stairClimbing",
  "楼梯机": "stairClimbing", "爬楼梯": "stairs", "椭圆机": "elliptical", "橢圓機": "elliptical",
  "划船": "rowing", "游泳": "swimming", "跳绳": "jumpRope", "徒步": "hiking", "瑜伽": "yoga",
  "普拉提": "pilates", "高强度间歇训练": "highIntensityIntervalTraining",
};

function activityCode(value: unknown) {
  const descriptor = asFields(value);
  const input = read(descriptor, "rawvalue", "id", "code", "identifier", "name", "value") ?? value;
  const raw = number(input);
  if (raw !== undefined && Number.isSafeInteger(raw) && raw > 0) return healthKitTypes[raw] ?? `healthkit-${raw}`;
  const label = str(input);
  if (!label || isWorkoutLabel(label)) return undefined;
  if (Object.hasOwn(localizedTypes, label)) return localizedTypes[label];
  const code = key(label).replace(/^hkworkoutactivitytype/, "");
  const oriented = /^(running|walking|cycling)(indoor|outdoor)$/.exec(code);
  if (oriented) return oriented[2]! + oriented[1]!;
  return code || "other";
}

function dateString(value: unknown) {
  return str(value)?.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
    .replace(/\s+(?=[+-]\d{2}:?\d{2}$)/, "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

function amount(
  fields: Fields, fixedFields: string[], quantityFields: string[], unitFields: string[],
  units: Record<string, number>, defaultUnitFactor?: number,
) {
  const fixed = number(read(fields, ...fixedFields));
  if (fixed !== undefined) return fixed;
  const quantity = read(fields, ...quantityFields);
  const object = asFields(quantity);
  const value = number(read(object, "value", "quantity", "amount", "qty") ?? quantity);
  const unit = str(read(object, "unit", "units") ?? read(fields, ...unitFields))?.toLowerCase();
  if (value === undefined) return undefined;
  if (unit && Object.hasOwn(units, unit)) return value * units[unit]!;
  return !unit ? (defaultUnitFactor === undefined ? undefined : value * defaultUnitFactor) : undefined;
}

function workout(value: unknown, index: number): AppleWorkoutInput {
  const fields = asFields(value);
  const reported = asFields(fields.reportedtotals);
  const derived = asFields(fields.derivedtotals);
  const type = activityCode(read(fields, ...types, "type", "name"));
  const environment = read(fields, "isindoor", "indoor", "isindoorworkout", "hkindoorworkout",
    "environment", "locationtype") ?? read(asFields(fields.metadata), "hkindoorworkout", "indoorworkout");
  const location = str(environment)?.toLowerCase();
  const durationUnits = {
    s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
    min: 60, mins: 60, minute: 60, minutes: 60,
    h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  };
  const energyUnits = {
    kcal: 1, cal: 1, kilocalorie: 1, kilocalories: 1,
    kj: 1 / 4.184, kilojoule: 1 / 4.184, kilojoules: 1 / 4.184, j: 1 / 4184,
  };
  const distanceUnits = {
    m: 1, meter: 1, meters: 1, km: 1000, kilometer: 1000, kilometers: 1000,
    mi: 1609.344, mile: 1609.344, miles: 1609.344, yd: 0.9144, yard: 0.9144, yards: 0.9144,
  };
  const duration = amount(fields, ["durationseconds", "durationsec", "durationinseconds", "durations", "activedurationseconds", "movingduration"],
    ["duration", "activeduration"], ["durationunit", "durationunits"], durationUnits, 1) ??
    amount(reported, ["durationseconds", "durationsec"], ["duration", "activeduration"], ["durationunit", "unit", "units"], durationUnits, 1) ??
    amount(derived, ["movingduration", "elapsedduration", "durationseconds"], ["duration"], ["durationunit", "unit", "units"], durationUnits, 1);
  const rawEnergy = amount(fields, ["activeenergykcal", "activeenergyburnedkcal", "energykcal"],
    ["activeenergyburned", "activeenergy", "energyburned", "activecalories", "energy", "totalenergyburned", "calories"],
    ["activeenergyunit", "energyunit", "energyburnedunit", "caloriesunit"], energyUnits) ??
    amount(reported, ["activeenergykcal", "energykcal"], ["activeenergyburned", "activeenergy", "energyburned", "energy"],
      ["activeenergyunit", "energyunit", "unit", "units"], energyUnits,
      str(read(fields, "activeenergyunit", "energyunit", "energyburnedunit"))?.toLowerCase() === "kcal" ? 1 : undefined);
  const distance = amount(fields, ["distancemeters", "totaldistancemeters", "distancem", "distanceinmeters"],
    ["distance", "totaldistance"], ["distanceunit", "distanceunits"], distanceUnits) ??
    amount(reported, ["distancemeters", "totaldistancemeters"], ["distance", "totaldistance"],
      ["distanceunit", "unit", "units"], distanceUnits,
      str(read(fields, "distanceunit", "distanceunits"))?.toLowerCase() === "m" ? 1 : undefined);

  const hr = asFields(read(fields, "heartrate", "heartratesummary", "heartratestatistics"));
  const bpm = { bpm: 1, "count/min": 1, "beats/min": 1 };
  function rate(fixed: string[], nested: string[], names: string[]) {
    return amount(fields, fixed, names, ["heartrateunit"], bpm) ??
      number(read(hr, ...nested.map((name) => name + "bpm"))) ??
      amount(hr, [], nested, ["unit", "units"], bpm);
  }
  const avg = rate(["averageheartratebpm", "avgheartratebpm"], ["average", "avg"], ["averageheartrate", "avgheartrate"]);
  const min = rate(["minheartratebpm", "minimumheartratebpm"], ["minimum", "min"], ["minimumheartrate", "minheartrate"]);
  const max = rate(["maxheartratebpm", "maximumheartratebpm"], ["maximum", "max"], ["maximumheartrate", "maxheartrate"]);
  const parsed = appleWorkoutInput.safeParse({
    schemaVersion: 1, captureMethod: "workout", activityType: type,
    startedAt: dateString(read(fields, ...starts)), endedAt: dateString(read(fields, ...ends)),
    environment: environment === true || ["1", "true", "indoor"].includes(location ?? "") || type?.startsWith("indoor") ? "indoor"
      : environment === false || ["0", "false", "outdoor"].includes(location ?? "") || type?.startsWith("outdoor") ? "outdoor" : "unknown",
    externalWorkoutId: str(read(fields, "uuid", "workoutuuid", "healthkituuid", "workoutid", "externalworkoutid", "id")),
    timeZone: str(read(fields, "timezone", "timezoneidentifier")),
    durationSeconds: duration == null ? undefined : Math.round(duration),
    durationKind: duration == null ? undefined : "workout_active",
    activeEnergyKcal: rawEnergy, energyKind: rawEnergy == null ? undefined : "workout",
    distanceMeters: distance,
    heartRate: avg == null && min == null && max == null ? undefined :
      { avgBpm: avg, minBpm: min, maxBpm: max, method: "workout_statistics" },
  });
  if (!parsed.success) throw new DomainError(`第 ${index + 1} 条训练的类型、日期或数值格式有误，请检查导出文件。时间需要包含时区。`);
  return parsed.data;
}

export function readHealthDataExport(payload: unknown, webhook = false): AppleWorkoutInput[] {
  const list = findWorkouts(payload);
  if (list) {
    if (list.length > 1000) throw new DomainError("一次最多导入 1000 条训练，请缩短导出的日期范围");
    if (list.length || webhook) return list.map(workout);
    throw new DomainError("这个文件没有训练记录，请在 Health Data Export 选择 Workouts 后重新导出");
  }
  const fields = asFields(payload);
  const test = str(read(fields, "event", "type", "kind"));
  if (webhook && (fields.test === true || fields.istest === true || (test && ["test", "webhooktest", "ping"].includes(key(test)))) &&
    ![...workouts, "workout", "data", "payload", "samples", "records"].some((name) => Object.hasOwn(fields, name))) return [];
  throw new DomainError("未识别到体能训练数据。请在 Health Data Export 选择 Workouts 并导出 JSON");
}
