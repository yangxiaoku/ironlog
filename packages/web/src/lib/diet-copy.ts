import type { Diet, Mutation, MutationResult } from "@ironlog/shared";
import { getOfflineStorage } from "./offline-queue";

type CopyFood = Pick<Diet, "name" | "calories" | "protein" | "carbs" | "fat"> & { meal?: Diet["meal"] };
type Batch = { cursor: 0; mutations: Mutation[] };

export async function copyDietBatch({
  userId, intent, date, meal, foods, source = "copy", send, storage = getOfflineStorage(),
}: {
  userId: string;
  intent: string;
  date: string;
  meal?: Diet["meal"];
  foods: readonly CopyFood[];
  source?: Diet["source"];
  send: (body: Batch) => Promise<{ results: MutationResult[] }>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}): Promise<number> {
  if (!userId || !storage) throw new Error("本机无法暂存复制请求，请允许网页存储后重试");
  const key = `ironlog-diet-copy:${userId}:${date}:${encodeURIComponent(intent)}`;
  let saved = storage.getItem(key);
  if (saved == null) {
    if (!foods.length) return 0;
    if (foods.length > 100) throw new Error("单次最多复制 100 项饮食，请按餐次复制");
    const batch: Batch = {
      cursor: 0,
      mutations: foods.map((food) => ({
        opId: crypto.randomUUID(), id: crypto.randomUUID(), kind: "diet", baseVersion: 0, deleted: false,
        data: {
          date, meal: meal ?? food.meal ?? "lunch", name: food.name,
          calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat,
          source, rawPrompt: "",
        },
      })),
    };
    saved = JSON.stringify(batch);
    storage.setItem(key, saved);
  }
  const body = JSON.parse(saved) as Batch;
  const receipt = await send(body);
  if (!Array.isArray(receipt?.results) || receipt.results.length !== body.mutations.length ||
      receipt.results.some((item, index) => item.opId !== body.mutations[index]?.opId || item.status !== "applied")) {
    throw new Error("复制结果尚未确认，请重试同一次操作");
  }
  if (storage.getItem(key) === saved) storage.removeItem(key);
  return receipt.results.length;
}
