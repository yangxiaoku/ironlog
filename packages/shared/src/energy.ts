import type { EnergyProfile, Profile } from "./index.js";
import { localDate } from "./logic.js";

export const energyMethod = "mifflin-st-jeor-1990" as const;
export const energySources = [
  { name: "Mifflin–St Jeor 原研究", url: "https://pubmed.ncbi.nlm.nih.gov/2305711/" },
  { name: "NIDDK 活动水平与适用人群", url: "https://www.niddk.nih.gov/bwp" },
];
export type EnergyEstimate =
  | { status: "unavailable"; reason: string }
  | { status: "ready"; method: typeof energyMethod; asOf: string; age: number;
      restingKcal: number; totalKcal: number; restingDisplay: number; totalDisplay: number;
      outsideStudyAge: boolean; weightAgeDays: number | null };

function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date;
}
export function ageOnDate(birthDate: string, asOf: string): number | null {
  if (!validDate(birthDate) || !validDate(asOf) || birthDate > asOf) return null;
  return Number(asOf.slice(0, 4)) - Number(birthDate.slice(0, 4)) - (asOf.slice(5) < birthDate.slice(5) ? 1 : 0);
}

export function estimateEnergy(input: EnergyProfile | null, asOf = localDate()): EnergyEstimate {
  if (!input) return { status: "unavailable", reason: "填写身体资料后估算" };
  const age = ageOnDate(input.birthDate, asOf);
  if (age === null) return { status: "unavailable", reason: "请核对出生日期与估算日期" };
  if (age < 18) return { status: "unavailable", reason: "当前公式用于成人，未满18岁采用专门的生长发育评估" };
  if (input.context !== "general") return { status: "unavailable", reason: "孕期与哺乳期需使用对应阶段的能量评估" };
  if (![input.heightCm, input.weightKg, input.activityFactor].every(Number.isFinite) ||
    input.heightCm < 50 || input.heightCm > 250 || input.weightKg < 1 || input.weightKg > 500 ||
    input.activityFactor < 1.4 || input.activityFactor > 2.5 || !["male", "female"].includes(input.sex))
    return { status: "unavailable", reason: "请核对身高、体重、公式系数与活动水平" };
  if (input.weightDate !== null && (!validDate(input.weightDate) || input.weightDate > asOf))
    return { status: "unavailable", reason: "体重日期需为估算当日或之前的有效日期" };
  const restingKcal = 10 * input.weightKg + 6.25 * input.heightCm - 5 * age + (input.sex === "male" ? 5 : -161);
  const totalKcal = restingKcal * input.activityFactor;
  if (!Number.isFinite(totalKcal) || Math.round(restingKcal / 10) <= 0 || Math.round(totalKcal / 10) <= 0)
    return { status: "unavailable", reason: "当前身体数据超出此估算的有效范围" };
  return { status: "ready", method: energyMethod, asOf, age, restingKcal, totalKcal,
    restingDisplay: Math.round(restingKcal / 10) * 10, totalDisplay: Math.round(totalKcal / 10) * 10,
    outsideStudyAge: age < 19 || age > 78,
    weightAgeDays: input.weightDate === null ? null : Math.round((Date.parse(asOf) - Date.parse(input.weightDate)) / 86400000) };
}

export function calorieTargetOrigin(profile: Pick<Profile, "calories" | "calorieEstimate">, asOf = localDate()) {
  const snapshot = profile.calorieEstimate;
  if (!snapshot) return { estimated: false, label: "手动热量目标" };
  if (snapshot.method !== energyMethod || !validDate(asOf) || !validDate(snapshot.asOf) || snapshot.asOf > asOf)
    return { estimated: false, label: "估算依据待核对" };
  const result = estimateEnergy(snapshot.inputs, snapshot.asOf);
  if (result.status !== "ready" || result.totalDisplay !== profile.calories)
    return { estimated: false, label: "估算依据待核对" };
  return { estimated: true, label: `维持估算设定 · ${snapshot.asOf}` };
}
