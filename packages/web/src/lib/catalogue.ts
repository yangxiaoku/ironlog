import { apiFetch } from "./api";
import type { CatalogueExercise, RecordEnvelope } from "./domain";
import { cachedApiFetch } from "./query-cache";

const builtinExerciseCache = new Map<string, CatalogueExercise>();

export function safeExerciseMediaUrl(path?: string | null): string {
  const raw = String(path ?? "");
  return raw.startsWith("/media/exercises/") ? raw : "";
}

export function safeExternalUrl(url?: string | null): string {
  const raw = String(url ?? "");
  return raw.startsWith("https://") ? raw : "";
}

export function clearBuiltinCatalogueCache(): void {
  builtinExerciseCache.clear();
}

export async function resolveCatalogueMap(ids: string[]): Promise<Map<string, CatalogueExercise>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, CatalogueExercise>();
  if (!uniqueIds.length) return map;

  const missingBuiltin: string[] = [];
  for (const id of uniqueIds) {
    const hit = builtinExerciseCache.get(id);
    if (hit) map.set(id, hit);
    else missingBuiltin.push(id);
  }

  for (let i = 0; i < missingBuiltin.length; i += 100) {
    const chunk = missingBuiltin.slice(i, i + 100);
    try {
      const res = await apiFetch<{ items?: CatalogueExercise[] }>("/api/catalogue/exercises/details", {
        method: "POST",
        token: "",
        body: { ids: chunk },
      });
      for (const item of res.items ?? []) {
        builtinExerciseCache.set(item.id, item);
        map.set(item.id, item);
      }
    } catch {}
  }

  const missingCustom = uniqueIds.filter((id) => !map.has(id));
  if (missingCustom.length > 0) {
    try {
      const customs = await cachedApiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise");
      for (const rec of customs) {
        if (!rec.deleted && rec.data?.id) {
          map.set(rec.data.id, { ...rec.data, custom: true });
        }
      }
    } catch {}
  }

  return map;
}
