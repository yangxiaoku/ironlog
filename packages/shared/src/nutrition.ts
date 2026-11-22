import type { Diet, NutritionDay, StoredRecord } from "./index.js";

export function nutritionTotals(foods: readonly Diet[]) {
  return foods.reduce((sum, food) => ({
    calories: sum.calories + food.calories,
    protein: sum.protein + food.protein,
    carbs: sum.carbs + food.carbs,
    fat: sum.fat + food.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

// Store the canonical food snapshot so edits from any client invalidate confirmation.
export function nutritionFingerprint(date: string, records: StoredRecord[]) {
  return JSON.stringify(records
    .filter((record) => record.kind === "diet" && !record.deleted && (record.data as Diet).date === date)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record) => {
      const food = record.data as Diet;
      return [record.id, food.date, food.meal, food.name, food.calories, food.protein, food.carbs, food.fat];
    }));
}

export function nutritionDayComplete(marker: NutritionDay | undefined, records: StoredRecord[]) {
  return !!marker?.complete && marker.fingerprint === nutritionFingerprint(marker.date, records);
}
