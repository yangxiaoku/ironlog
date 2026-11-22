import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  catalogueDataVersion, getExerciseCategory, type Exercise,
  type CatalogueExercise, type CataloguePage, type CatalogueFilters, type CatalogueItem, type ExerciseIllustration,
} from "@ironlog/shared";
import { serverCatalogue } from "./catalogue.js";
import type { Db } from "./db.js";
import { DomainError } from "./store.js";

const clause = z.string().trim().max(60).optional();
const filters = { q: z.string().trim().max(120).optional(), muscle: clause, equipment: clause, category: clause };
export const catalogueQuery = z.object({
  ...filters, cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const catalogueLookup = z.object({
  ...filters, ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)).max(100),
});
const cursorSchema = z.tuple([z.string(), z.string(), z.number().int().nonnegative()]);
const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s_\-‐‑–—]+/g, "");
const poseManifest = readFileSync(new URL("../data/workout-guide-poses.json", import.meta.url), "utf8");
const commonsManifest = readFileSync(new URL("../data/commons-poses.json", import.meta.url), "utf8");
const legacyManifest = readFileSync(new URL("../data/everkinetic-poses.json", import.meta.url), "utf8");
const gifManifest = readFileSync(new URL("../data/exercise-gifs.json", import.meta.url), "utf8");
const { gifs } = JSON.parse(gifManifest) as {
  gifs: Record<string, { path: string; sha256: string; licenseUrl: string }>;
};
const poses = [poseManifest, commonsManifest].flatMap((source) =>
  (JSON.parse(source) as { poses: ExerciseIllustration[] }).poses);
const poseById = new Map(poses.map((pose) => [pose.exerciseId, pose]));
const { illustrations: legacyPoses, author, license, licenseUrl, sourceUrl, modifications } = JSON.parse(legacyManifest) as
  Pick<ExerciseIllustration, "author" | "license" | "licenseUrl" | "sourceUrl" | "modifications"> & {
    illustrations: (Pick<ExerciseIllustration, "exerciseId" | "upstreamId" | "variation" | "frames"> &
      { englishNames: string[] })[];
  };
const legacyName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const legacyById = new Map<string, (typeof legacyPoses)[number]>();
const legacyByName = new Map<string, (typeof legacyPoses)[number]>();
for (const item of legacyPoses) {
  if (item.exerciseId && !legacyById.has(item.exerciseId)) legacyById.set(item.exerciseId, item);
  for (const name of item.englishNames) {
    const key = legacyName(name);
    if (key && !legacyByName.has(key)) legacyByName.set(key, item);
  }
}
for (const exercise of serverCatalogue) {
  if (poseById.has(exercise.id)) continue;
  const pose = legacyById.get(exercise.id) ?? legacyByName.get(legacyName(exercise.englishName));
  if (!pose) continue;
  poseById.set(exercise.id, {
    exerciseId: exercise.id, upstreamId: pose.upstreamId, variation: pose.variation,
    author, license, licenseUrl, sourceUrl, modifications,
    frames: pose.frames.map((frame) => ({
      ...frame, path: `/media/exercises/${frame.path.split("/").at(-1)}?v=${frame.sha256.slice(0, 12)}`,
    })),
  });
}

const serverCatalogueById = new Map(serverCatalogue.map((exercise) => [exercise.id, exercise]));
const cleanWords = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter((w) => w.length > 2);

const posesByBucket = new Map<string, { pose: ExerciseIllustration; baseEx: Exercise; slugWords: string[] }[]>();
for (const basePose of poses) {
  const baseEx = serverCatalogueById.get(basePose.exerciseId);
  if (!baseEx) continue;
  const slugWords = basePose.upstreamId.split("-").filter((w) => w.length > 2);
  if (slugWords.length < 2) continue;
  const bucketKey = `${baseEx.muscle}:${baseEx.equipment}`;
  const bucket = posesByBucket.get(bucketKey) ?? [];
  bucket.push({ pose: basePose, baseEx, slugWords });
  posesByBucket.set(bucketKey, bucket);
}

for (const exercise of serverCatalogue) {
  if (poseById.has(exercise.id)) continue;
  const candidates = posesByBucket.get(`${exercise.muscle}:${exercise.equipment}`);
  if (!candidates) continue;
  const engWords = new Set(cleanWords(exercise.englishName));
  for (const { pose: basePose, baseEx, slugWords } of candidates) {
    if (slugWords.every((w) => engWords.has(w))) {
      const baseGif = gifs[basePose.exerciseId];
      poseById.set(exercise.id, {
        ...basePose,
        exerciseId: exercise.id,
        variation: `动作示范参考：${baseEx.name}`,
        ...(baseGif ? { gifPath: baseGif.path } : {}),
      });
      break;
    }
  }
}

for (const [exerciseId, pose] of poseById) {
  if (pose.gifPath) continue;
  const gif = gifs[exerciseId];
  if (gif) poseById.set(exerciseId, { ...pose, gifPath: gif.path });
}
const frameLicenses = new Map([
  ...[...poseById.values()].flatMap((pose) => pose.frames.map((frame) =>
    [frame.path.split("/").at(-1)!.split("?")[0]!, pose.licenseUrl] as const)),
  ...Object.values(gifs).map((gif) =>
    [gif.path.split("/").at(-1)!.split("?")[0]!, gif.licenseUrl] as const),
]);
const poseRevision = createHash("sha256").update(poseManifest).update(commonsManifest)
  .update(legacyManifest).update(gifManifest).digest("hex").slice(0, 12);
const dataVersion = `${catalogueDataVersion}:cloud1:${poseRevision}`;
export const catalogueETag = `"${dataVersion}"`;
const summary = ({ id, name, englishName, muscle, equipment, category, mode }: Exercise): CatalogueItem =>
  ({ id, name, englishName, muscle, equipment, category, mode, thumbnail: poseById.get(id)?.frames[0]?.path });

interface IndexedCatalogueEntry {
  ordinal: number;
  id: string;
  category: string;
  muscle: string;
  equipment: string;
  searchNames: string;
  item: CatalogueItem;
}

const indexedCatalogue: IndexedCatalogueEntry[] = [];
const indexedById = new Map<string, IndexedCatalogueEntry>();
const byMuscle = new Map<string, IndexedCatalogueEntry[]>();
const byEquipment = new Map<string, IndexedCatalogueEntry[]>();
const byCategory = new Map<string, IndexedCatalogueEntry[]>();

function pushBucket(map: Map<string, IndexedCatalogueEntry[]>, key: string, entry: IndexedCatalogueEntry) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  bucket.push(entry);
}

serverCatalogue.forEach((exercise, ordinal) => {
  const category = getExerciseCategory(exercise);
  const entry: IndexedCatalogueEntry = {
    ordinal,
    id: exercise.id,
    category,
    muscle: exercise.muscle,
    equipment: exercise.equipment,
    searchNames: [exercise.name, exercise.englishName, ...exercise.aliases].map(compact).join("\n"),
    item: summary(exercise),
  };
  indexedCatalogue.push(entry);
  indexedById.set(entry.id, entry);
  pushBucket(byMuscle, entry.muscle, entry);
  pushBucket(byEquipment, entry.equipment, entry);
  pushBucket(byCategory, entry.category, entry);
});

function selectCandidates(
  muscle: string | undefined,
  equipment: string | undefined,
  category: string | undefined,
): readonly IndexedCatalogueEntry[] {
  let candidates: readonly IndexedCatalogueEntry[] = indexedCatalogue;
  if (muscle) {
    const bucket = byMuscle.get(muscle);
    if (!bucket) return [];
    if (bucket.length < candidates.length) candidates = bucket;
  }
  if (equipment) {
    const bucket = byEquipment.get(equipment);
    if (!bucket) return [];
    if (bucket.length < candidates.length) candidates = bucket;
  }
  if (category) {
    const bucket = byCategory.get(category);
    if (!bucket) return [];
    if (bucket.length < candidates.length) candidates = bucket;
  }
  return candidates;
}

export class CloudCatalogue {
  private ready = false;
  private publishedAt = "";

  constructor(private db: Db) {}

  private seed() {
    if (this.ready) return;
    const find = this.db.prepare("SELECT published_at FROM catalogue_releases WHERE version=?");
    let existing = find.get(dataVersion) as { published_at: string } | undefined;
    if (!existing) {
      this.db.transaction(() => {
        existing = find.get(dataVersion) as { published_at: string } | undefined;
        if (existing) return;
        const publishedAt = new Date().toISOString();
        this.db.prepare("INSERT INTO catalogue_releases VALUES (?, ?)").run(dataVersion, publishedAt);
        const insert = this.db.prepare(`INSERT INTO catalogue_exercises VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET version=excluded.version, ordinal=excluded.ordinal,
            category=excluded.category, equipment=excluded.equipment, muscle=excluded.muscle,
            search_names=excluded.search_names, data=excluded.data`);
        serverCatalogue.forEach((exercise, position) => {
          const indexed = indexedCatalogue[position]!;
          insert.run(
            exercise.id, dataVersion, position, indexed.category, indexed.equipment,
            indexed.muscle, indexed.searchNames, JSON.stringify(exercise),
          );
        });
        existing = { published_at: publishedAt };
      }).immediate();
    }
    this.publishedAt = existing!.published_at;
    this.ready = true;
  }

  version() {
    this.seed();
    return { version: dataVersion, publishedAt: this.publishedAt, total: serverCatalogue.length };
  }

  detail(id: string) {
    this.seed();
    const base = serverCatalogueById.get(id);
    if (!base) throw new DomainError("未找到动作", 404);
    const exercise: CatalogueExercise = { ...base, illustration: poseById.get(id) ?? null };
    return { version: dataVersion, exercise };
  }

  page(query: z.infer<typeof catalogueQuery>): CataloguePage {
    this.seed();
    const { where, values, words, muscle, equipment, category } = this.filterSpec(query);
    const signature = createHash("sha256").update(JSON.stringify([where, values])).digest("base64url");
    let ordinal = -1;
    if (query.cursor) {
      let decoded: z.infer<typeof cursorSchema>;
      try { decoded = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
      catch { throw new DomainError("动作翻页参数无效", 400); }
      if (decoded[0] !== dataVersion) throw new DomainError("动作目录已更新，请重试搜索", 409);
      if (decoded[1] !== signature) throw new DomainError("动作翻页参数与筛选条件不一致", 400);
      ordinal = decoded[2];
    }
    const candidates = selectCandidates(muscle, equipment, category);
    let total = 0;
    const matched: IndexedCatalogueEntry[] = [];
    for (const entry of candidates) {
      if (muscle && entry.muscle !== muscle) continue;
      if (equipment && entry.equipment !== equipment) continue;
      if (category && entry.category !== category) continue;
      if (words.length && !words.every((word) => entry.searchNames.includes(word))) continue;
      total++;
      if (entry.ordinal > ordinal && matched.length <= query.limit) matched.push(entry);
    }
    const page = matched.slice(0, query.limit);
    const nextCursor = matched.length > query.limit
      ? Buffer.from(JSON.stringify([dataVersion, signature, page.at(-1)!.ordinal])).toString("base64url") : null;
    return { version: dataVersion, total, items: page.map((entry) => entry.item), nextCursor };
  }

  lookup(query: z.infer<typeof catalogueLookup>) {
    this.seed();
    if (!query.ids.length) return { version: dataVersion, items: [] as CatalogueItem[] };
    const { words, muscle, equipment, category } = this.filterSpec(query);
    const found: IndexedCatalogueEntry[] = [];
    for (const id of new Set(query.ids)) {
      const entry = indexedById.get(id);
      if (!entry) continue;
      if (muscle && entry.muscle !== muscle) continue;
      if (equipment && entry.equipment !== equipment) continue;
      if (category && entry.category !== category) continue;
      if (words.length && !words.every((word) => entry.searchNames.includes(word))) continue;
      found.push(entry);
    }
    found.sort((a, b) => a.ordinal - b.ordinal);
    return { version: dataVersion, items: found.map((entry) => entry.item) };
  }

  details(ids: string[]) {
    this.seed();
    const items: CatalogueExercise[] = [];
    for (const id of ids) {
      const base = serverCatalogueById.get(id);
      if (base) items.push({ ...base, illustration: poseById.get(id) ?? null });
    }
    return { version: dataVersion, items };
  }

  private filterSpec(query: CatalogueFilters) {
    const where = ["version=?"];
    const values = [dataVersion];
    for (const key of ["muscle", "equipment", "category"] as const) {
      const value = query[key];
      if (value) { where.push(`${key}=?`); values.push(value); }
    }
    const words = (query.q ?? "").split(/\s+/u).map(compact).filter(Boolean).slice(0, 12);
    for (const word of words) {
      where.push("instr(search_names, ?) > 0");
      values.push(word);
    }
    return {
      where: where.join(" AND "),
      values,
      words,
      muscle: query.muscle || undefined,
      equipment: query.equipment || undefined,
      category: query.category || undefined,
    };
  }
}

const frames = new Map<string, { bytes: Buffer; hash: string; licenseUrl: string; contentType: "image/png" | "image/gif" }>();
export function exerciseFrame(filename: string) {
  const isGif = /^anim-[A-Za-z0-9_-]+\.gif$/.test(filename);
  if (!isGif && !/^[a-z0-9-]+-[1-3]\.png$/.test(filename)) throw new DomainError("动作图不存在", 404);
  const cached = frames.get(filename);
  if (cached) {
    frames.delete(filename);
    frames.set(filename, cached);
    return cached;
  }
  try {
    const bytes = readFileSync(new URL(`../data/exercise-media/${filename}`, import.meta.url));
    const frame = {
      bytes, hash: createHash("sha256").update(bytes).digest("hex").slice(0, 12),
      licenseUrl: frameLicenses.get(filename) ?? "https://creativecommons.org/licenses/by-sa/4.0/",
      contentType: (isGif ? "image/gif" : "image/png") as "image/png" | "image/gif",
    };
    if (frames.size >= 128) frames.delete(frames.keys().next().value!);
    frames.set(filename, frame);
    return frame;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DomainError("动作图不存在", 404);
    throw error;
  }
}
