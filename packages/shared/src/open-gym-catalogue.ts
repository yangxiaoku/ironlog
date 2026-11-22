import { exerciseCatalogue } from "./catalogue.js";
import { exerciseTranslations } from "./exercise-localization.js";
import type { Exercise } from "./index.js";

export const openGymRepository = "DuarteSantos8/openGym";
export type OpenGymCatalogueData = {
  release: string;
  revision: string;
  muscles: Exercise["muscle"][];
  equipment: Exercise["equipment"][];
  modes: Exercise["mode"][];
  categories: NonNullable<Exercise["category"]>[];
  exercises: [
    id: string, name: string, englishName: string, muscle: number, secondaryMask: number,
    equipment: number, mode: number, multiplier: number, category: number, instructions: string[],
    description?: string, oldEnglishName?: string,
  ][];
};

// Ironlog has always shown these entries under its original IDs.
const curatedIds: Readonly<Record<string, string>> = {
  "0025": "bench-press",
  "0662": "push-up",
  "0652": "pull-up",
  "0334": "lateral-raise",
  "0383": "reverse-fly",
  "0031": "barbell-curl",
  "0276": "dead-bug",
};

function distinctAliases(name: string, values: string[]) {
  return [...new Set(values)].filter((alias) => alias && alias !== name);
}

export function openGymCatalogue(data: OpenGymCatalogueData): Exercise[] {
  const base = `https://github.com/${openGymRepository}/blob/${data.revision}`;
  const imported = data.exercises.map(([
    id, chinese, englishName, muscle, mask, gear, mode, volumeMultiplier, category,
    instructions, description, oldEnglishName,
  ]): Exercise => {
    const legacyId = `exdb_${id}`;
    const translation = exerciseTranslations[legacyId];
    const local = translation?.[0] === (oldEnglishName ?? englishName) ? translation : undefined;
    const name = local?.[1] ?? chinese;
    return {
      id: curatedIds[id] ?? legacyId,
      name,
      englishName,
      aliases: distinctAliases(name, [chinese, oldEnglishName ?? "", ...(local?.[2] ?? [])]),
      muscle: data.muscles[muscle]!,
      secondaryMuscles: data.muscles.filter((_, index) => (mask & (1 << index)) !== 0).slice(0, 5),
      equipment: data.equipment[gear]!,
      mode: data.modes[mode]!,
      category: data.categories[category]!,
      volumeMultiplier,
      instructions,
      ...(description ? { description } : {}),
      mistakes: [],
      custom: false,
      source: {
        repository: openGymRepository, revision: data.revision, id, license: "AGPL-3.0-only",
        url: `${base}/catalogue/exercises/${id}.json`,
      },
    };
  });
  const byId = new Map(imported.map((item) => [item.id, item]));
  const byEnglish = new Map(imported.map((item) => [item.englishName.toLowerCase(), item]));
  const starters = exerciseCatalogue.map((exercise) => {
    const matched = byId.get(exercise.id);
    const reference = matched ?? byEnglish.get(exercise.englishName.toLowerCase());
    if (!reference) return exercise;
    if (matched) byId.delete(exercise.id);
    return {
      ...exercise,
      category: matched?.category ?? exercise.category ?? reference.category,
      ...(reference.description ? { description: reference.description } : {}),
      aliases: matched
        ? distinctAliases(exercise.name, [
            ...exercise.aliases, matched.name, matched.englishName, ...matched.aliases,
          ])
        : exercise.aliases,
    };
  });
  return [...starters, ...byId.values()];
}
