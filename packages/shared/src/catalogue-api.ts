import type { Exercise } from "./index.js";

export type CatalogueItem = Pick<Exercise,
  "id" | "name" | "englishName" | "muscle" | "equipment" | "category" | "mode"> & { thumbnail?: string };

export interface ExerciseIllustration {
  exerciseId: string;
  upstreamId: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  modifications: string;
  variation: string;
  gifPath?: string;
  frames: { path: string; caption: string; sha256: string; sourceUrl: string }[];
}

export type CatalogueExercise = Exercise & { illustration?: ExerciseIllustration | null };

export interface CataloguePage {
  version: string;
  total: number;
  items: CatalogueItem[];
  nextCursor: string | null;
}

export interface CatalogueFilters {
  q?: string;
  muscle?: string;
  equipment?: string;
  category?: string;
}
