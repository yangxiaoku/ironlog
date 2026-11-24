import { apiFetch } from "./api";
import type { CatalogueExercise, RecordEnvelope } from "./domain";

export function safeExerciseMediaUrl(path?: string | null): string {
  const raw = String(path ?? "");
  return raw.startsWith("/media/exercises/") ? raw : "";
}

export function safeExternalUrl(url?: string | null): string {
  const raw = String(url ?? "");
  return raw.startsWith("https://") ? raw : "";
}

export async function resolveCatalogueMap(ids: string[]): Promise<Map<string, CatalogueExercise>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, CatalogueExercise>();
  if (!uniqueIds.length) return map;

  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    try {
      const res = await apiFetch<{ items?: CatalogueExercise[] }>("/api/catalogue/exercises/details", {
        method: "POST",
        token: "",
        body: { ids: chunk },
      });
      for (const item of res.items ?? []) {
        map.set(item.id, item);
      }
    } catch {}
  }

  const missing = uniqueIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    try {
      const customs = await apiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise");
      for (const rec of customs) {
        if (!rec.deleted && rec.data?.id) {
          map.set(rec.data.id, { ...rec.data, custom: true });
        }
      }
    } catch {}
  }

  return map;
}
