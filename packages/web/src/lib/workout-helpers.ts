export const soundPreference = "ironlog-web-rest-sound";
export const screenPreference = "ironlog-web-workout-screen";
export const rirPreference = "ironlog-web-show-rir";
export const dialPreference = "ironlog-web-auto-rest-dial";
export const notifyPreference = "ironlog-web-rest-notify";
export const barPreference = "ironlog-web-bar-weight";
export const platesPreference = "ironlog-web-plates";

export const ALL_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5] as const;
export const BAR_PRESETS: ReadonlyArray<readonly [number, string]> = [
  [20, "20kg杆"],
  [15, "15kg杆"],
  [10, "10kg曲杆"],
  [25, "25kg六角"],
  [0, "0kg纯挂片"],
];

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface PlateBreakdownResult {
  valid: boolean;
  bar: number;
  perSide: number;
  plates: number[];
  remainder: number;
  achievable: boolean;
}

export function plateBreakdown(
  totalWeight: number,
  barWeight = 20,
  availablePlates: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25],
): PlateBreakdownResult {
  const weight = Number(totalWeight);
  const rawBar = Number(barWeight);
  const bar = Number.isFinite(rawBar) && rawBar >= 0 ? rawBar : 20;
  if (!Number.isFinite(weight) || weight <= bar || weight > 5000) {
    return { valid: false, bar, perSide: 0, plates: [], remainder: 0, achievable: true };
  }
  const perSide = round2((weight - bar) / 2);
  let remaining = perSide;
  const fallback = [25, 20, 15, 10, 5, 2.5, 1.25];
  const sortedPlates = [
    ...new Set(
      (availablePlates.length ? availablePlates : fallback)
        .map(Number)
        .filter((p) => Number.isFinite(p) && p > 0),
    ),
  ].sort((a, b) => b - a);
  const plates: number[] = [];
  for (const plate of sortedPlates) {
    while (plates.length < 64 && remaining + 1e-6 >= plate) {
      plates.push(plate);
      remaining = round2(remaining - plate);
    }
    if (plates.length >= 64) break;
  }
  return { valid: true, bar, perSide, plates, remainder: remaining, achievable: remaining <= 0.01 };
}

export function plateDeltaLabel(
  prevWeight: number,
  curWeight: number,
  barWeight = 20,
  enabledPlates: readonly number[] = ALL_PLATES,
): string {
  if (!(prevWeight > barWeight) || !(curWeight > barWeight) || prevWeight === curWeight) return "";
  const prevCalc = plateBreakdown(prevWeight, barWeight, enabledPlates);
  const curCalc = plateBreakdown(curWeight, barWeight, enabledPlates);
  if (!prevCalc.valid || !curCalc.valid) return "";
  const counts = new Map<number, number>();
  for (const p of curCalc.plates) counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const p of prevCalc.plates) counts.set(p, (counts.get(p) ?? 0) - 1);
  const parts: string[] = [];
  for (const w of [...counts.keys()].sort((a, b) => a - b)) {
    const diff = counts.get(w) ?? 0;
    for (let k = 0; k < Math.abs(diff); k++) parts.push(`${diff < 0 ? "-" : "+"}${w}`);
  }
  return parts.join(" ");
}

export function snapWarmupWeight(
  target: number,
  isBarbell: boolean,
  barWeight = 20,
  enabledPlates: readonly number[] = ALL_PLATES,
): number {
  if (isBarbell) {
    if (target <= barWeight) return barWeight;
    const calc = plateBreakdown(target, barWeight, enabledPlates);
    if (!calc.valid) return barWeight;
    return Math.max(barWeight, round2(calc.bar + 2 * (calc.perSide - calc.remainder)));
  }
  const step = target < 15 ? 1 : 2.5;
  return Math.max(step, Math.round(target / step) * step);
}
