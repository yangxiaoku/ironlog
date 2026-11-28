import type { Diet, Mutation, MutationResult } from "@ironlog/shared";
import { safeUuid } from "./domain";
import { getOfflineStorage } from "./offline-queue";

type CopyFood = Pick<Diet, "name" | "calories" | "protein" | "carbs" | "fat"> & { meal?: Diet["meal"] };
type Batch = { cursor: 0; mutations: Mutation[] };

export interface DietCopyBatchSummary {
  count: number;
  calories: number;
  names: string;
}

export class DietCopyMismatchError extends Error {
  constructor(
    public readonly pendingSummary: DietCopyBatchSummary,
    public readonly newSummary: DietCopyBatchSummary,
    public readonly pendingIds: string[] = [],
  ) {
    super("上次同来源的复制尚未确认，但当前模板或食物内容已变更，请确认是重试旧操作还是按最新内容复制");
    this.name = "DietCopyMismatchError";
  }
}

export function clearPendingDietCopyBatch(
  userId: string,
  intent: string,
  date: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = getOfflineStorage(),
): void {
  if (!userId || !storage) return;
  const key = `ironlog-diet-copy:${userId}:${date}:${encodeURIComponent(intent)}`;
  try {
    storage.removeItem(key);
  } catch {}
}

function summarizeFoods(items: readonly { name: string; calories: number }[]): DietCopyBatchSummary {
  const calories = Math.round(items.reduce((sum, item) => sum + (Number(item.calories) || 0), 0));
  const names = items.map((item) => item.name).filter(Boolean).slice(0, 3).join("、");
  return { count: items.length, calories, names };
}

function buildFingerprint(
  date: string,
  meal: Diet["meal"] | undefined,
  foods: readonly CopyFood[],
  source: Diet["source"],
): string {
  return JSON.stringify(
    foods.map((food) => ({
      date,
      meal: meal ?? food.meal ?? "lunch",
      name: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      source,
    })),
  );
}

function fingerprintFromBatch(batch: Batch): string {
  return JSON.stringify(
    batch.mutations.map((m) => {
      const d = m.data as Diet;
      return {
        date: d.date,
        meal: d.meal,
        name: d.name,
        calories: d.calories,
        protein: d.protein,
        carbs: d.carbs,
        fat: d.fat,
        source: d.source ?? "copy",
      };
    }),
  );
}

export async function copyDietBatch({
  userId, intent, date, meal, foods, source = "copy", mode = "auto", detectSourceChange = false, send, storage = getOfflineStorage(),
}: {
  userId: string;
  intent: string;
  date: string;
  meal?: Diet["meal"];
  foods: readonly CopyFood[];
  source?: Diet["source"];
  mode?: "auto" | "retry-pending" | "replace-with-new";
  detectSourceChange?: boolean;
  send: (body: Batch) => Promise<{ results: MutationResult[] }>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}): Promise<number> {
  if (!userId || !storage) throw new Error("本机无法暂存复制请求，请允许网页存储后重试");
  const key = `ironlog-diet-copy:${userId}:${date}:${encodeURIComponent(intent)}`;
  const nextFingerprint = buildFingerprint(date, meal, foods, source);
  let saved = storage.getItem(key);

  if (saved != null && mode !== "replace-with-new") {
    try {
      const parsed = JSON.parse(saved) as Batch | { batch: Batch; fingerprint?: string };
      const cachedBatch = "batch" in parsed && parsed.batch ? parsed.batch : (parsed as Batch);
      const cachedFingerprint =
        "fingerprint" in parsed && typeof parsed.fingerprint === "string"
          ? parsed.fingerprint
          : fingerprintFromBatch(cachedBatch);
      if (detectSourceChange && mode === "auto" && cachedFingerprint !== nextFingerprint) {
        const pendingFoods = cachedBatch.mutations.map((m) => m.data as Diet);
        const pendingIds = cachedBatch.mutations.map((m) => m.id).filter(Boolean);
        throw new DietCopyMismatchError(summarizeFoods(pendingFoods), summarizeFoods(foods), pendingIds);
      }
      saved = JSON.stringify({ batch: cachedBatch, fingerprint: cachedFingerprint });
    } catch (err) {
      if (err instanceof DietCopyMismatchError) throw err;
      saved = null;
    }
  }

  if (saved == null || mode === "replace-with-new") {
    if (!foods.length) return 0;
    if (foods.length > 100) throw new Error("单次最多复制 100 项饮食，请按餐次复制");
    const batch: Batch = {
      cursor: 0,
      mutations: foods.map((food) => ({
        opId: safeUuid(), id: safeUuid(), kind: "diet", baseVersion: 0, deleted: false,
        data: {
          date, meal: meal ?? food.meal ?? "lunch", name: food.name,
          calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat,
          source, rawPrompt: "",
        },
      })),
    };
    saved = JSON.stringify({ batch, fingerprint: nextFingerprint });
    storage.setItem(key, saved);
  }
  const wrapper = JSON.parse(saved) as { batch: Batch; fingerprint?: string };
  const body = wrapper.batch;
  const receipt = await send(body);
  if (!Array.isArray(receipt?.results) || receipt.results.length !== body.mutations.length ||
      receipt.results.some((item, index) => item.opId !== body.mutations[index]?.opId || item.status !== "applied")) {
    throw new Error("复制结果尚未确认，请重试同一次操作");
  }
  if (storage.getItem(key) === saved) storage.removeItem(key);
  return receipt.results.length;
}
