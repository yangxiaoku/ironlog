import { readFileSync } from "node:fs";
import {
  exerciseSchema,
  openGymCatalogue,
  type OpenGymCatalogueData,
  type Exercise,
} from "@ironlog/shared";

const data = JSON.parse(
  readFileSync(new URL("../data/opengym-catalogue.json", import.meta.url), "utf8"),
) as OpenGymCatalogueData;
export const serverCatalogue: Exercise[] = exerciseSchema.array().parse(openGymCatalogue(data));
