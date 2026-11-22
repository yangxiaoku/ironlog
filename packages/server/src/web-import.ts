import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  exerciseSchema,
  getExerciseCategory,
  localDate,
  muscleNames,
  planSchema,
  validatePlanExercises,
  workoutSchema,
  type Exercise,
  type Plan,
  type Workout,
} from "@ironlog/shared";
import { DomainError, type Store } from "./store.js";

export const csvImportInput = z.object({
  csv: z.string().min(1, "请上传或粘贴 CSV 内容").max(2_000_000, "CSV 文件过大（上限 2 MB）"),
  skipDuplicates: z.boolean().default(true),
});

export type ImportFormat = "ironlog" | "hevy" | "strong" | "fitnotes";

const FORMAT_LABELS: Record<ImportFormat, string> = {
  ironlog: "铁记 (Ironlog)",
  hevy: "Hevy",
  strong: "Strong",
  fitnotes: "FitNotes",
};

const EQUIPMENT_HINTS: Array<[RegExp, Exercise["equipment"]]> = [
  [/\b(?:barbell|bb)\b|杠铃/i, "barbell"],
  [/\b(?:dumbbell|db)\b|哑铃/i, "dumbbell"],
  [/\b(?:cable|pulley)\b|绳索|龙门架/i, "cable"],
  [/\b(?:machine|smith|lever|sled|hack)\b|器械|史密斯/i, "machine"],
  [/\b(?:bodyweight|bw|calisthenics)\b|自重|徒手/i, "bodyweight"],
  [/\b(?:kettlebell|kb)\b|壶铃/i, "kettlebell"],
  [/\b(?:band|resistance band)\b|弹力带/i, "band"],
  [/\b(?:plate|weighted)\b|负重|杠铃片/i, "weighted"],
];

const FITNOTES_CATEGORY_TO_MUSCLE: Record<string, Exercise["muscle"]> = {
  chest: "chest",
  back: "back",
  legs: "legs",
  quads: "legs",
  hamstrings: "legs",
  glutes: "legs",
  calves: "legs",
  shoulders: "shoulders",
  biceps: "arms",
  triceps: "arms",
  forearms: "arms",
  arms: "arms",
  abs: "core",
  core: "core",
  cardio: "cardio",
  胸: "chest",
  背部: "back",
  背: "back",
  腿部: "legs",
  腿: "legs",
  肩部: "shoulders",
  肩: "shoulders",
  手臂: "arms",
  二头: "arms",
  三头: "arms",
  核心: "core",
  腹肌: "core",
  有氧: "cardio",
};

const MUSCLE_SHORT_ZH: Record<string, string> = {
  chest: "胸部",
  back: "背部",
  legs: "下肢",
  shoulders: "肩部",
  arms: "手臂",
  core: "核心",
  cardio: "有氧",
};

const SET_TYPE_ALIASES: Record<string, Workout["exercises"][number]["sets"][number]["type"]> = {
  normal: "normal",
  working: "normal",
  常规: "normal",
  w: "warmup",
  warmup: "warmup",
  warm_up: "warmup",
  "warm-up": "warmup",
  "warm up": "warmup",
  热身: "warmup",
  d: "drop",
  drop: "drop",
  dropset: "drop",
  drop_set: "drop",
  "drop-set": "drop",
  "drop set": "drop",
  递减: "drop",
  f: "failure",
  failure: "failure",
  to_failure: "failure",
  力竭: "failure",
  rp: "rest_pause",
  rest_pause: "rest_pause",
  "rest-pause": "rest_pause",
  "rest pause": "rest_pause",
  restpause: "rest_pause",
  休停: "rest_pause",
};

const FEELING_ALIASES: Record<string, Workout["feeling"]> = {
  easy: "easy",
  轻松: "easy",
  balanced: "balanced",
  均衡: "balanced",
  fatigued: "fatigued",
  疲惫: "fatigued",
};

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function compactName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[\s_\-‐‑–—()（）[\]【】/]+/g, "");
}

function unescapeCell(raw: string): string {
  const trimmed = raw.trim();
  // Strip spreadsheet-safe single-quote prefix emitted during Ironlog CSV formula escaping
  return trimmed;
}

function detectDelimiter(text: string): "," | ";" {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    if (!inQuotes) {
      if (ch === ",") commas++;
      else if (ch === ";") semis++;
    }
  }
  return semis > commas ? ";" : ",";
}

export function parseCsvMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(unescapeCell(cell));
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(unescapeCell(cell));
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(unescapeCell(cell));
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function detectFormat(headersLower: string[]): ImportFormat {
  const set = new Set(headersLower.map((h) => h.trim()));
  if (set.has("日期") && set.has("动作") && (set.has("重量(kg)") || set.has("次数"))) {
    return "ironlog";
  }
  if (set.has("title") && set.has("start_time") && set.has("exercise_title")) {
    return "hevy";
  }
  if (set.has("date") && set.has("workout name") && set.has("exercise name")) {
    return "strong";
  }
  if (set.has("date") && set.has("exercise") && set.has("category")) {
    return "fitnotes";
  }
  throw new DomainError("无法识别 CSV 格式，目前支持 Strong、Hevy、FitNotes 与铁记导出的训练记录 CSV", 400);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseDateAndIso(raw: string): { date: string; iso: string } | null {
  const clean = raw.trim();
  if (!clean) return null;

  // ISO YYYY-MM-DD or YYYY-MM-DD HH:mm(:ss) or YYYY/MM/DD
  const ymd = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/i);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const date = `${y}-${pad2(m)}-${pad2(d)}`;
      const parsedMs = Date.parse(clean);
      if (Number.isFinite(parsedMs) && (clean.includes("Z") || /[+-]\d{2}:?\d{2}$/.test(clean))) {
        return { date, iso: new Date(parsedMs).toISOString() };
      }
      const hh = Number(ymd[4] ?? 18);
      const mm = Number(ymd[5] ?? 0);
      const ss = Number(ymd[6] ?? 0);
      const ms = Date.UTC(y, m - 1, d, hh, mm, ss) - 8 * 3600000;
      return { date, iso: new Date(ms).toISOString() };
    }
  }

  // Hevy style: "21 Nov 2026, 09:30" or "Nov 21, 2026 9:30 AM"
  const dmy = clean.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const d = Number(dmy[1]);
    const mIdx = MONTH_MAP[dmy[2]!.toLowerCase()];
    const y = Number(dmy[3]);
    if (mIdx !== undefined && d >= 1 && d <= 31) {
      const date = `${y}-${pad2(mIdx + 1)}-${pad2(d)}`;
      const hh = Number(dmy[4] ?? 18);
      const mm = Number(dmy[5] ?? 0);
      const ss = Number(dmy[6] ?? 0);
      return { date, iso: new Date(Date.UTC(y, mIdx, d, hh, mm, ss) - 8 * 3600000).toISOString() };
    }
  }

  const mdy = clean.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?/i);
  if (mdy) {
    const mIdx = MONTH_MAP[mdy[1]!.toLowerCase()];
    const d = Number(mdy[2]);
    const y = Number(mdy[3]);
    if (mIdx !== undefined && d >= 1 && d <= 31) {
      let hh = Number(mdy[4] ?? 18);
      const mm = Number(mdy[5] ?? 0);
      const ss = Number(mdy[6] ?? 0);
      const ampm = mdy[7]?.toUpperCase();
      if (ampm === "PM" && hh < 12) hh += 12;
      if (ampm === "AM" && hh === 12) hh = 0;
      const date = `${y}-${pad2(mIdx + 1)}-${pad2(d)}`;
      return { date, iso: new Date(Date.UTC(y, mIdx, d, hh, mm, ss) - 8 * 3600000).toISOString() };
    }
  }

  const fallback = Date.parse(clean);
  if (Number.isFinite(fallback)) {
    const dt = new Date(fallback + 8 * 3600000);
    return { date: dt.toISOString().slice(0, 10), iso: new Date(fallback).toISOString() };
  }
  return null;
}

function parseDurationToSeconds(raw: string): number {
  const clean = raw.trim().toLowerCase();
  if (!clean) return 0;
  // HH:MM:SS or MM:SS
  const colon = clean.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    if (colon[3] !== undefined) {
      return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
    }
    return Number(colon[1]) * 60 + Number(colon[2]);
  }
  // Strong/FitNotes text durations: "1h 15m", "45m", "30m 15s", "3600s"
  let total = 0;
  let matched = false;
  for (const m of clean.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g)) {
    matched = true;
    const val = Number(m[1]);
    const unit = m[2]![0];
    if (unit === "h") total += val * 3600;
    else if (unit === "m") total += val * 60;
    else total += val;
  }
  if (matched) return Math.max(0, Math.round(total));
  const plain = Number(clean);
  return Number.isFinite(plain) && plain > 0 ? Math.round(plain) : 0;
}

function numVal(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundToQuarterKg(kg: number): number {
  return Math.round(kg * 4) / 4;
}

function lbsToKg(lbs: number): number {
  if (!(lbs > 0)) return 0;
  return roundToQuarterKg(lbs * 0.45359237);
}

function inferEquipment(name: string): Exercise["equipment"] {
  for (const [pattern, eq] of EQUIPMENT_HINTS) {
    if (pattern.test(name)) return eq;
  }
  return "barbell";
}

function inferMuscle(name: string, categoryHint = ""): Exercise["muscle"] {
  const cat = FITNOTES_CATEGORY_TO_MUSCLE[categoryHint.trim().toLowerCase()];
  if (cat) return cat;
  const lower = name.toLowerCase();
  if (/bench|chest|fly|pec|push.?up|dip|卧推|夹胸|胸|俯卧撑/.test(lower)) return "chest";
  if (/row|pull.?up|chin.?up|pulldown|lat|deadlift|背|引体|下拉|划船/.test(lower)) {
    return /romanian|deadlift|硬拉/.test(lower) ? "legs" : "back";
  }
  if (/squat|leg|lunge|calf|glute|hip thrust|深蹲|腿|臀|提踵|腿举/.test(lower)) return "legs";
  if (/overhead|shoulder|lateral|rear delt|upright|face pull|肩|推举|平举|面拉/.test(lower)) return "shoulders";
  if (/curl|tricep|bicep|extension|skullcrusher|preacher|弯举|臂屈伸|三头|二头/.test(lower)) return "arms";
  if (/plank|crunch|ab|core|sit.?up|twist|dead bug|核心|腹|卷腹|平板支撑/.test(lower)) return "core";
  if (/run|walk|cycl|bike|swim|elliptical|cardio|row(ing)? machine|跑|骑|游泳|有氧|跳绳/.test(lower)) return "cardio";
  return "chest";
}

function wordSignature(value: string): string {
  const words = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !["and", "the", "with", "on", "to", "of"].includes(w));
  return [...new Set(words)].sort().join(" ");
}

interface CatalogueLookup {
  exactMap: Map<string, Exercise[]>;
  wordSigMap: Map<string, Exercise[]>;
  byId: ReadonlyMap<string, Exercise>;
}

function buildLookup(catalogue: ReadonlyMap<string, Exercise>): CatalogueLookup {
  const exactMap = new Map<string, Exercise[]>();
  const wordSigMap = new Map<string, Exercise[]>();
  const push = (map: Map<string, Exercise[]>, key: string, ex: Exercise) => {
    if (!key) return;
    const list = map.get(key);
    if (list) {
      if (!list.includes(ex)) list.push(ex);
    } else {
      map.set(key, [ex]);
    }
  };
  const add = (key: string, ex: Exercise) => {
    push(exactMap, compactName(key), ex);
    push(wordSigMap, wordSignature(key), ex);
  };
  for (const ex of catalogue.values()) {
    add(ex.name, ex);
    if (ex.englishName) add(ex.englishName, ex);
    for (const alias of ex.aliases) add(alias, ex);
  }
  return { exactMap, wordSigMap, byId: catalogue };
}

function pickBestCandidate(list: Exercise[], equipHint: Exercise["equipment"] | null): Exercise {
  if (!list.length) throw new Error("empty candidates");
  if (equipHint) {
    const matched = list.find((e) => e.equipment === equipHint);
    if (matched) return matched;
  }
  const builtIn = list.find((e) => !e.custom);
  return builtIn ?? list[0]!;
}

function resolveExerciseName(rawName: string, lookup: CatalogueLookup): Exercise | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;

  // Extract trailing paren/dash equipment hint like "Bench Press (Barbell)" or "Bench Press - Barbell"
  const parenMatch = trimmed.match(/^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/)
    ?? trimmed.match(/^(.*?)\s+[-–—]\s+(barbell|dumbbell|cable|machine|bodyweight|kettlebell|band|smith machine)$/i);
  const parenText = parenMatch?.[2]?.trim() ?? "";
  let equipHint: Exercise["equipment"] | null = null;
  if (parenText) {
    for (const [pattern, eq] of EQUIPMENT_HINTS) {
      if (pattern.test(parenText)) {
        equipHint = eq;
        break;
      }
    }
  } else {
    for (const [pattern, eq] of EQUIPMENT_HINTS) {
      if (pattern.test(trimmed)) {
        equipHint = eq;
        break;
      }
    }
  }

  const direct = lookup.exactMap.get(compactName(trimmed));
  if (direct?.length) return pickBestCandidate(direct, equipHint);

  if (parenMatch) {
    const base = parenMatch[1]!.trim();
    const withPrefix = `${parenText} ${base}`;
    const prefixed = lookup.exactMap.get(compactName(withPrefix));
    if (prefixed?.length) return pickBestCandidate(prefixed, equipHint);

    const prefixedWords = lookup.wordSigMap.get(wordSignature(withPrefix));
    if (prefixedWords?.length) return pickBestCandidate(prefixedWords, equipHint);

    const baseHit = lookup.exactMap.get(compactName(base));
    if (baseHit?.length) return pickBestCandidate(baseHit, equipHint);

    const baseWords = lookup.wordSigMap.get(wordSignature(base));
    if (baseWords?.length) return pickBestCandidate(baseWords, equipHint);
  }

  const wordHit = lookup.wordSigMap.get(wordSignature(trimmed));
  if (wordHit?.length) return pickBestCandidate(wordHit, equipHint);

  return null;
}

interface NormalizedRow {
  sessionKey: string;
  title: string;
  date: string;
  startedAt: string;
  durationSeconds: number;
  feeling: Workout["feeling"];
  exerciseName: string;
  categoryHint: string;
  supersetGroup: string | null;
  setType: Workout["exercises"][number]["sets"][number]["type"];
  weightKg: number;
  reps: number;
  seconds: number;
  rir: number | null;
  completed: boolean;
  notes: string;
}

function parseSetType(raw: string | undefined): Workout["exercises"][number]["sets"][number]["type"] {
  const clean = (raw ?? "").trim().toLowerCase();
  return SET_TYPE_ALIASES[clean] ?? "normal";
}

function parseRirOrRpe(rirRaw: string | undefined, rpeRaw: string | undefined): number | null {
  if (rirRaw && rirRaw.trim() !== "") {
    const val = Number(rirRaw.trim());
    if (Number.isFinite(val) && val >= 0 && val <= 10) return Math.round(val);
  }
  if (rpeRaw && rpeRaw.trim() !== "") {
    const rpe = Number(rpeRaw.trim());
    if (Number.isFinite(rpe) && rpe >= 0 && rpe <= 10) {
      return Math.max(0, Math.min(10, Math.round(10 - rpe)));
    }
  }
  return null;
}

function buildNormalizedRows(
  format: ImportFormat,
  headersRaw: string[],
  dataRows: string[][],
  todayDate: string,
): { rows: NormalizedRow[]; warnings: string[] } {
  const idxMap = new Map<string, number>();
  headersRaw.forEach((h, i) => idxMap.set(h.trim().toLowerCase(), i));
  const col = (row: string[], ...candidates: string[]): string => {
    for (const c of candidates) {
      const idx = idxMap.get(c);
      if (idx !== undefined && idx < row.length) return row[idx] ?? "";
    }
    return "";
  };

  const rows: NormalizedRow[] = [];
  const warnings: string[] = [];
  let futureSkipped = 0;

  // Check if Strong/FitNotes header itself embeds lbs unit
  const headerWeightIsLbs = headersRaw.some((h) => /\(lbs?\)/i.test(h));
  const ironlogSessions = new Map<
    string,
    {
      seq: number;
      lastExKey: string;
      seenExKeys: Set<string>;
      lastSetNo: number;
      mins: number;
      feelingRaw: string;
    }
  >();

  for (const row of dataRows) {
    if (format === "ironlog") {
      const dateStr = col(row, "日期");
      const parsedDate = parseDateAndIso(dateStr);
      const exName = col(row, "动作").trim();
      if (!parsedDate || !exName) continue;
      if (parsedDate.date > todayDate) { futureSkipped++; continue; }
      const startRaw = col(row, "开始时间", "start_time").trim();
      const parsedStart = startRaw ? parseDateAndIso(startRaw) : null;
      const startedAt = parsedStart?.iso ?? parsedDate.iso;
      const title = col(row, "训练标题").trim() || "导入训练";
      const mins = Number(col(row, "时长(分钟)")) || 0;
      const feelingRaw = col(row, "体感").trim().toLowerCase();
      const doneRaw = col(row, "已完成").trim().toLowerCase();
      const supersetGroup = col(row, "超级组").trim().slice(0, 16) || null;
      const setNo = Number(col(row, "组号")) || 0;
      const exKey = `${exName}||${supersetGroup ?? ""}`;
      const baseKey = `${parsedDate.date}||${startRaw || dateStr.trim()}||${title}`;
      let tracker = ironlogSessions.get(baseKey);
      if (!tracker) {
        tracker = {
          seq: 0,
          lastExKey: exKey,
          seenExKeys: new Set([exKey]),
          lastSetNo: setNo,
          mins,
          feelingRaw,
        };
        ironlogSessions.set(baseKey, tracker);
      } else {
        const restartedSameEx = setNo === 1 && tracker.lastSetNo >= 1 && (tracker.lastExKey === exKey || tracker.seenExKeys.has(exKey));
        const metaChanged = tracker.mins !== mins || tracker.feelingRaw !== feelingRaw;
        if (!startRaw && (restartedSameEx || metaChanged)) {
          tracker.seq++;
          tracker.seenExKeys = new Set([exKey]);
          tracker.mins = mins;
          tracker.feelingRaw = feelingRaw;
        } else {
          tracker.seenExKeys.add(exKey);
        }
        tracker.lastExKey = exKey;
        tracker.lastSetNo = setNo;
      }
      rows.push({
        sessionKey: `${baseKey}||#${tracker.seq}`,
        title,
        date: parsedDate.date,
        startedAt,
        durationSeconds: mins > 0 ? Math.round(mins * 60) : 0,
        feeling: FEELING_ALIASES[feelingRaw] ?? null,
        exerciseName: exName,
        categoryHint: "",
        supersetGroup,
        setType: parseSetType(col(row, "组类型")),
        weightKg: numVal(col(row, "重量(kg)")),
        reps: Math.round(numVal(col(row, "次数"))),
        seconds: Math.round(numVal(col(row, "时长(秒)"))),
        rir: parseRirOrRpe(col(row, "rir"), undefined),
        completed: doneRaw === "" || doneRaw === "是" || doneRaw === "true" || doneRaw === "1",
        notes: "",
      });
      continue;
    }

    if (format === "hevy") {
      const parsedStart = parseDateAndIso(col(row, "start_time"));
      const exName = col(row, "exercise_title").trim();
      if (!parsedStart || !exName) continue;
      if (parsedStart.date > todayDate) { futureSkipped++; continue; }
      const parsedEnd = parseDateAndIso(col(row, "end_time"));
      const durSec = parsedEnd
        ? Math.max(0, Math.round((Date.parse(parsedEnd.iso) - Date.parse(parsedStart.iso)) / 1000))
        : 0;
      const title = col(row, "title").trim() || "Hevy 训练";
      const kgRaw = numVal(col(row, "weight_kg"));
      const lbsRaw = numVal(col(row, "weight_lbs"));
      const weightKg = kgRaw > 0 ? kgRaw : lbsToKg(lbsRaw);
      const ssRaw = col(row, "superset_id").trim();
      rows.push({
        sessionKey: `${parsedStart.date}||${col(row, "start_time")}||${title}`,
        title,
        date: parsedStart.date,
        startedAt: parsedStart.iso,
        durationSeconds: durSec,
        feeling: null,
        exerciseName: exName,
        categoryHint: "",
        supersetGroup: ssRaw ? `S${ssRaw}`.slice(0, 16) : null,
        setType: parseSetType(col(row, "set_type")),
        weightKg,
        reps: Math.round(numVal(col(row, "reps"))),
        seconds: Math.round(numVal(col(row, "duration_seconds"))),
        rir: parseRirOrRpe(undefined, col(row, "rpe")),
        completed: true,
        notes: col(row, "description").trim(),
      });
      continue;
    }

    if (format === "strong") {
      const dateRaw = col(row, "date");
      const parsedDate = parseDateAndIso(dateRaw);
      const exName = col(row, "exercise name").trim();
      if (!parsedDate || !exName) continue;
      if (parsedDate.date > todayDate) { futureSkipped++; continue; }
      const title = col(row, "workout name").trim() || "Strong 训练";
      const durSec = parseDurationToSeconds(col(row, "duration"));
      const unitCell = col(row, "weight unit").trim().toLowerCase();
      const useLbs = unitCell === "lbs" || unitCell === "lb" || (!unitCell && headerWeightIsLbs);
      const rawWeight = numVal(col(row, "weight", "weight (kg)", "weight (lbs)"));
      const weightKg = useLbs ? lbsToKg(rawWeight) : rawWeight;
      const setOrder = col(row, "set order", "set type");
      rows.push({
        sessionKey: `${parsedDate.date}||${dateRaw}||${title}`,
        title,
        date: parsedDate.date,
        startedAt: parsedDate.iso,
        durationSeconds: durSec,
        feeling: null,
        exerciseName: exName,
        categoryHint: "",
        supersetGroup: null,
        setType: parseSetType(col(row, "set type") || setOrder),
        weightKg,
        reps: Math.round(numVal(col(row, "reps"))),
        seconds: Math.round(numVal(col(row, "seconds", "duration_seconds"))),
        rir: parseRirOrRpe(col(row, "rir"), col(row, "rpe")),
        completed: true,
        notes: col(row, "workout notes").trim() || col(row, "notes").trim(),
      });
      continue;
    }

    // fitnotes
    const dateRaw = col(row, "date");
    const parsedDate = parseDateAndIso(dateRaw);
    const exName = col(row, "exercise").trim();
    if (!parsedDate || !exName) continue;
    if (parsedDate.date > todayDate) { futureSkipped++; continue; }
    const cat = col(row, "category").trim();
    const rawKg = numVal(col(row, "weight (kgs)", "weight"));
    const rawLbs = numVal(col(row, "weight (lbs)"));
    const weightKg = headerWeightIsLbs && !idxMap.has("weight (kgs)")
      ? lbsToKg(rawKg || rawLbs)
      : rawKg > 0 ? rawKg : lbsToKg(rawLbs);
    rows.push({
      sessionKey: parsedDate.date,
      title: "",
      date: parsedDate.date,
      startedAt: parsedDate.iso,
      durationSeconds: 0,
      feeling: null,
      exerciseName: exName,
      categoryHint: cat,
      supersetGroup: null,
      setType: "normal",
      weightKg,
      reps: Math.round(numVal(col(row, "reps"))),
      seconds: parseDurationToSeconds(col(row, "time")),
      rir: null,
      completed: true,
      notes: col(row, "comment").trim(),
    });
  }

  if (futureSkipped > 0) {
    warnings.push(`已跳过 ${futureSkipped} 行晚于今天（${todayDate}）的记录。`);
  }
  return { rows, warnings };
}

interface PreparedImport {
  format: ImportFormat;
  formatLabel: string;
  customExercisesToCreate: Exercise[];
  workoutsToCreate: Array<{ id: string; data: Workout; duplicate: boolean }>;
  matchedCount: number;
  warnings: string[];
}

function prepareImport(store: Store, userId: string, csvText: string): PreparedImport {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    throw new DomainError("CSV 缺少数据行，无法解析训练记录", 400);
  }
  const headers = matrix[0]!;
  const format = detectFormat(headers.map((h) => h.toLowerCase()));
  const todayDate = localDate();
  const { rows, warnings } = buildNormalizedRows(format, headers, matrix.slice(1), todayDate);
  if (!rows.length) {
    throw new DomainError("未解析到有效的训练组记录，请检查日期或动作列是否完整", 400);
  }

  // Group rows by session
  const sessionGroups = new Map<string, NormalizedRow[]>();
  for (const r of rows) {
    const list = sessionGroups.get(r.sessionKey);
    if (list) list.push(r);
    else sessionGroups.set(r.sessionKey, [r]);
  }
  if (sessionGroups.size > 500) {
    throw new DomainError(`单次最多导入 500 场训练（当前文件包含 ${sessionGroups.size} 场），请分段导出后再导入`, 400);
  }

  const catalogue = store.catalogueMap(userId, true);
  const lookup = buildLookup(catalogue);
  const preparedCustomByNorm = new Map<string, Exercise>();
  const matchedExercisesSet = new Set<string>();

  const resolveOrCreateExercise = (name: string, sampleRows: NormalizedRow[]): Exercise => {
    const existing = resolveExerciseName(name, lookup);
    if (existing) {
      matchedExercisesSet.add(existing.id);
      return existing;
    }
    const norm = compactName(name);
    const pending = preparedCustomByNorm.get(norm);
    if (pending) return pending;

    const hasTimed = sampleRows.every((r) => r.seconds > 0 && r.reps === 0);
    const muscle = inferMuscle(name, sampleRows[0]?.categoryHint ?? "");
    const equip = inferEquipment(name);
    const hash = createHash("sha256").update(norm || name).digest("hex").slice(0, 12);
    const id = `imp_${hash}`;
    const customEx = exerciseSchema.parse({
      id,
      name: name.slice(0, 120),
      englishName: /^[a-zA-Z0-9\s()\-_/]+$/.test(name) ? name.slice(0, 120) : "",
      aliases: [],
      muscle,
      secondaryMuscles: [],
      equipment: equip,
      category: getExerciseCategory({ muscle }),
      mode: hasTimed ? "timed" : "reps",
      volumeMultiplier: equip === "dumbbell" ? 2 : 1,
      instructions: ["导入自外部训练记录，可按个人习惯补充动作要点。"],
      mistakes: [],
      custom: true,
    });
    preparedCustomByNorm.set(norm, customEx);
    return customEx;
  };

  // Existing workouts index for duplicate detection
  const existingWorkouts = store
    .list(userId, "workout")
    .map((r) => r.data as Workout)
    .filter((w) => w.status === "completed");
  const existingTitleKeys = new Set(
    existingWorkouts.map((w) => `${w.date}||${w.title.trim().toLowerCase()}`),
  );
  const existingExSignatures = new Set(
    existingWorkouts.map((w) => `${w.date}||${w.exercises.map((e) => e.exerciseId).sort().join(",")}`),
  );

  const workoutsToCreate: Array<{ id: string; data: Workout; duplicate: boolean }> = [];

  for (const sRows of sessionGroups.values()) {
    const first = sRows[0]!;
    // Build contiguous exercise blocks inside the session
    const blocks: Array<{ name: string; supersetGroup: string | null; rows: NormalizedRow[] }> = [];
    for (const r of sRows) {
      const prev = blocks.at(-1);
      if (prev && prev.name === r.exerciseName && prev.supersetGroup === r.supersetGroup) {
        prev.rows.push(r);
      } else {
        blocks.push({ name: r.exerciseName, supersetGroup: r.supersetGroup, rows: [r] });
      }
    }

    const exercises: Workout["exercises"] = blocks.map((block) => {
      const ex = resolveOrCreateExercise(block.name, block.rows);
      const sets: Workout["exercises"][number]["sets"] = block.rows.map((r) => {
        const reps = ex.mode === "timed" ? 0 : r.reps > 0 ? Math.min(1000, r.reps) : (r.seconds > 0 ? 1 : 0);
        const seconds = Math.min(86400, Math.max(0, r.seconds));
        return {
          id: `imp_set_${randomUUID()}`,
          type: r.setType,
          weight: Math.min(100000, Math.max(0, r.weightKg)),
          reps,
          seconds,
          completed: r.completed,
          completedAt: first.startedAt,
          rir: r.rir,
        };
      });
      return {
        id: `imp_ex_${randomUUID()}`,
        exerciseId: ex.id,
        targetIndex: null,
        supersetGroup: block.supersetGroup,
        restSeconds: 90,
        snapshot: {
          name: ex.name,
          muscle: ex.muscle,
          equipment: ex.equipment,
          mode: ex.mode,
          volumeMultiplier: ex.volumeMultiplier,
        },
        sets,
      };
    });

    let title = first.title;
    if (!title && format === "fitnotes") {
      const cats = [...new Set(sRows.map((r) => {
        const cat = r.categoryHint.trim().toLowerCase();
        const m = FITNOTES_CATEGORY_TO_MUSCLE[cat];
        return (m ? MUSCLE_SHORT_ZH[m] : r.categoryHint.trim()) || "";
      }).filter(Boolean))];
      title = cats.length && cats.length <= 2 ? `${cats.join(" · ")}训练` : "FitNotes 导入训练";
    }
    if (!title) title = "导入训练";

    const durSec = first.durationSeconds;
    const startMs = Date.parse(first.startedAt);
    const endedAt = new Date(startMs + (durSec > 0 ? durSec * 1000 : 0)).toISOString();
    const notes = [...new Set(sRows.map((r) => r.notes).filter(Boolean))].join("\n").slice(0, 4000);

    const workoutData = workoutSchema.parse({
      title: title.slice(0, 120),
      date: first.date,
      startedAt: first.startedAt,
      endedAt,
      durationUnknown: durSec <= 0,
      status: "completed",
      notes,
      feeling: first.feeling,
      source: "manual",
      rawPrompt: `csv_import:${format}`,
      planId: null,
      planVersion: null,
      routineId: null,
      targetSnapshot: null,
      exercises,
      restEndsAt: null,
      adjustments: [],
    });

    const titleKey = `${workoutData.date}||${workoutData.title.trim().toLowerCase()}`;
    const sigKey = `${workoutData.date}||${workoutData.exercises.map((e) => e.exerciseId).sort().join(",")}`;
    const duplicate = existingTitleKeys.has(titleKey) || existingExSignatures.has(sigKey);

    workoutsToCreate.push({
      id: `imp_wo_${randomUUID()}`,
      data: workoutData,
      duplicate,
    });
  }

  return {
    format,
    formatLabel: FORMAT_LABELS[format],
    customExercisesToCreate: [...preparedCustomByNorm.values()],
    workoutsToCreate,
    matchedCount: matchedExercisesSet.size,
    warnings,
  };
}

export function previewWorkoutCsvImport(
  store: Store,
  userId: string,
  input: z.infer<typeof csvImportInput>,
) {
  const prepared = prepareImport(store, userId, input.csv);
  const selected = prepared.workoutsToCreate.filter((w) => !input.skipDuplicates || !w.duplicate);
  const duplicateWorkouts = prepared.workoutsToCreate.filter((w) => w.duplicate).length;
  const totalSets = selected.reduce(
    (sum, w) => sum + w.data.exercises.reduce((es, ex) => es + ex.sets.length, 0),
    0,
  );
  return {
    format: prepared.format,
    formatLabel: prepared.formatLabel,
    totalWorkouts: prepared.workoutsToCreate.length,
    importableWorkouts: selected.length,
    duplicateWorkouts,
    totalSets,
    matchedExercises: prepared.matchedCount,
    customExercisesToCreate: prepared.customExercisesToCreate.map((e) => e.name),
    sampleWorkouts: selected.slice(0, 5).map((w) => ({
      date: w.data.date,
      title: w.data.title,
      exercises: w.data.exercises.map((e) => e.snapshot?.name ?? e.exerciseId),
      sets: w.data.exercises.reduce((s, e) => s + e.sets.length, 0),
    })),
    warnings: prepared.warnings,
  };
}

export function commitWorkoutCsvImport(
  store: Store,
  userId: string,
  input: z.infer<typeof csvImportInput>,
) {
  const prepared = prepareImport(store, userId, input.csv);
  const toImport = prepared.workoutsToCreate.filter((w) => !input.skipDuplicates || !w.duplicate);
  const duplicateWorkouts = prepared.workoutsToCreate.filter((w) => w.duplicate).length;

  let importedWorkouts = 0;
  let importedSets = 0;
  let createdCustomExercises = 0;

  store.db.transaction(() => {
    const currentCatalogue = store.catalogueMap(userId, true);
    const neededCustomIds = new Set(
      toImport.flatMap((w) => w.data.exercises.map((e) => e.exerciseId)),
    );
    for (const customEx of prepared.customExercisesToCreate) {
      if (!neededCustomIds.has(customEx.id) || currentCatalogue.has(customEx.id)) continue;
      store.mutate(userId, {
        opId: randomUUID(),
        id: customEx.id,
        kind: "exercise",
        baseVersion: 0,
        deleted: false,
        data: customEx,
      });
      createdCustomExercises++;
    }
    for (const w of toImport) {
      store.mutate(userId, {
        opId: randomUUID(),
        id: w.id,
        kind: "workout",
        baseVersion: 0,
        deleted: false,
        data: w.data,
      });
      importedWorkouts++;
      importedSets += w.data.exercises.reduce((s, e) => s + e.sets.length, 0);
    }
  }).immediate();

  return {
    format: prepared.format,
    formatLabel: prepared.formatLabel,
    importedWorkouts,
    skippedDuplicates: input.skipDuplicates ? duplicateWorkouts : 0,
    createdCustomExercises,
    importedSets,
    warnings: prepared.warnings,
  };
}

export const planJsonImportInput = z.object({
  json: z.string().min(2, "请上传或粘贴计划 JSON").max(500_000, "计划文件过大（上限 500 KB）"),
  mode: z.enum(["preview", "draft", "apply"]).default("preview"),
  expectedRevision: z.number().int().min(0).optional(),
});

export function importPlanJson(
  store: Store,
  userId: string,
  input: z.infer<typeof planJsonImportInput>,
) {
  let rawObj: unknown;
  try {
    rawObj = JSON.parse(input.json);
  } catch {
    throw new DomainError("JSON 格式无效，请检查计划文件内容", 400);
  }
  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
    throw new DomainError("计划 JSON 必须为对象格式", 400);
  }
  const top = rawObj as Record<string, unknown>;
  const candidate = (top.plan && typeof top.plan === "object" && !Array.isArray(top.plan))
    ? (top.plan as Record<string, unknown>)
    : top;

  if (!Array.isArray(candidate.routines) || candidate.routines.length === 0) {
    throw new DomainError("计划至少需要包含 1 个训练日（routines）", 400);
  }
  if (candidate.routines.length > 7) {
    throw new DomainError("计划最多支持 7 个训练日", 400);
  }

  const catalogue = store.catalogueMap(userId, true);
  const lookup = buildLookup(catalogue);
  const missingExercises: string[] = [];
  const usedRoutineIds = new Set<string>();

  const resolveCandidateExercise = (exObj: Record<string, unknown>): Exercise | null => {
    const idStr = typeof exObj.exerciseId === "string" ? exObj.exerciseId.trim() : "";
    if (idStr && catalogue.has(idStr)) return catalogue.get(idStr)!;
    const candidates = [exObj.name, exObj.englishName, exObj.exerciseName, idStr]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    for (const label of candidates) {
      const hit = resolveExerciseName(label, lookup);
      if (hit) return hit;
    }
    missingExercises.push(candidates[0] ?? "未命名动作");
    return null;
  };

  const routines = candidate.routines.map((rtRaw, rIdx) => {
    if (!rtRaw || typeof rtRaw !== "object" || Array.isArray(rtRaw)) {
      throw new DomainError(`第 ${rIdx + 1} 个训练日格式不正确`, 400);
    }
    const rt = rtRaw as Record<string, unknown>;
    let rId = typeof rt.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(rt.id.trim())
      ? rt.id.trim()
      : `day_${rIdx + 1}`;
    while (usedRoutineIds.has(rId)) rId = `${rId}_${rIdx + 1}`;
    usedRoutineIds.add(rId);

    const rName = typeof rt.name === "string" && rt.name.trim()
      ? rt.name.trim().slice(0, 120)
      : `训练日 ${rIdx + 1}`;

    if (!Array.isArray(rt.exercises) || rt.exercises.length === 0) {
      throw new DomainError(`训练日「${rName}」至少需要包含 1 个动作`, 400);
    }

    const exercises = rt.exercises.map((exRaw) => {
      if (!exRaw || typeof exRaw !== "object" || Array.isArray(exRaw)) {
        throw new DomainError(`训练日「${rName}」存在无效动作条目`, 400);
      }
      const exObj = exRaw as Record<string, unknown>;
      const resolved = resolveCandidateExercise(exObj);
      if (!resolved) {
        return {
          exerciseId: "bench-press",
          sets: 3,
          repsMin: 8,
          repsMax: 12,
          weight: null,
          seconds: 0,
          restSeconds: 90,
          targetRir: 2,
          progression: "double" as const,
          increment: 2.5,
          backupExerciseId: null,
        };
      }
      const timed = resolved.mode === "timed";
      const sets = Math.max(1, Math.min(100, Math.round(Number(exObj.sets) || 3)));
      const rawRepsMin = Math.round(Number(exObj.repsMin ?? exObj.reps) || 8);
      const repsMin = timed ? 1 : Math.max(1, Math.min(1000, rawRepsMin));
      const rawRepsMax = Math.round(Number(exObj.repsMax ?? exObj.reps) || (exObj.reps ? repsMin : 12));
      const repsMax = timed ? 1 : Math.max(repsMin, Math.min(1000, rawRepsMax));
      const weightNum = exObj.weight != null && exObj.weight !== "" ? Number(exObj.weight) : NaN;
      const weight = Number.isFinite(weightNum) && weightNum >= 0 && weightNum <= 100000 ? weightNum : null;
      const seconds = timed ? Math.max(1, Math.min(86400, Math.round(Number(exObj.seconds) || 45))) : 0;
      const restNum = Number(exObj.restSeconds);
      const restSeconds = Number.isFinite(restNum) && restNum >= 0 ? Math.min(900, Math.round(restNum)) : 90;
      const rirNum = Number(exObj.targetRir);
      const targetRir = Number.isFinite(rirNum) && rirNum >= 0 ? Math.min(10, Math.round(rirNum)) : 2;
      const rawProg = String(exObj.progression ?? "");
      const progression = (["double", "linear", "greyskull", "manual"].includes(rawProg)
        ? rawProg
        : (timed ? "manual" : "double")) as Plan["routines"][number]["exercises"][number]["progression"];
      const incNum = Number(exObj.increment);
      const increment = Number.isFinite(incNum) && incNum >= 0 ? Math.min(20, incNum) : 2.5;

      let backupExerciseId: string | null = null;
      if (typeof exObj.backupExerciseId === "string" && exObj.backupExerciseId.trim()) {
        const bkStr = exObj.backupExerciseId.trim();
        const bkEx = catalogue.get(bkStr) ?? resolveExerciseName(bkStr, lookup);
        if (bkEx && bkEx.id !== resolved.id) backupExerciseId = bkEx.id;
      }

      return {
        exerciseId: resolved.id,
        sets,
        repsMin,
        repsMax,
        weight,
        seconds,
        restSeconds,
        targetRir,
        progression,
        increment,
        backupExerciseId,
        supersetGroup: typeof exObj.supersetGroup === "string" && exObj.supersetGroup.trim()
          ? exObj.supersetGroup.trim().slice(0, 16)
          : null,
      };
    });

    return { id: rId, name: rName, exercises };
  });

  if (missingExercises.length) {
    throw new DomainError(
      `计划中包含动作库未找到的动作：${[...new Set(missingExercises)].slice(0, 6).join("、")}`,
      400,
    );
  }

  const schedule: Plan["schedule"] = candidate.schedule === "weekdays" ? "weekdays" : "rotation";
  let weekdays: number[] = [];
  if (schedule === "weekdays") {
    const rawWd = Array.isArray(candidate.weekdays)
      ? candidate.weekdays.map((d) => Math.round(Number(d))).filter((d) => d >= 1 && d <= 7)
      : [];
    if (rawWd.length === routines.length && new Set(rawWd).size === rawWd.length) {
      weekdays = rawWd;
    } else {
      weekdays = routines.map((_, idx) => idx + 1);
    }
  }

  const plan = planSchema.parse({
    name: typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim().slice(0, 120)
      : "导入训练计划",
    weeks: Number.isFinite(Number(candidate.weeks))
      ? Math.max(1, Math.min(52, Math.round(Number(candidate.weeks))))
      : 8,
    schedule,
    weekdays,
    routines,
    rationale: typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim().slice(0, 8000)
      : "导入的训练计划",
    source: "manual",
    parentId: null,
  });
  validatePlanExercises(plan, catalogue);

  const trackedMuscles = new Set(["chest", "back", "legs", "shoulders", "arms", "core"]);
  const exerciseNames: Record<string, string> = {};
  const muscleMap = new Map<string, number>();
  let exerciseCount = 0;

  for (const rt of plan.routines) {
    for (const item of rt.exercises) {
      exerciseCount++;
      const ex = catalogue.get(item.exerciseId);
      if (ex) {
        exerciseNames[item.exerciseId] = ex.name;
        if (trackedMuscles.has(ex.muscle)) {
          muscleMap.set(ex.muscle, (muscleMap.get(ex.muscle) ?? 0) + item.sets);
        }
        for (const sec of ex.secondaryMuscles) {
          if (sec !== ex.muscle && trackedMuscles.has(sec)) {
            muscleMap.set(sec, (muscleMap.get(sec) ?? 0) + item.sets * 0.5);
          }
        }
      }
      if (item.backupExerciseId) {
        const bk = catalogue.get(item.backupExerciseId);
        if (bk) exerciseNames[item.backupExerciseId] = bk.name;
      }
    }
  }

  const weeklyMuscleSets = [...muscleMap.entries()]
    .map(([key, sets]) => ({
      key,
      name: muscleNames[key as keyof typeof muscleNames] ?? key,
      sets: Math.round(sets * 10) / 10,
    }))
    .sort((a, b) => b.sets - a.sets);

  if (input.mode === "preview") {
    return {
      mode: "preview" as const,
      plan,
      exerciseNames,
      weeklyMuscleSets,
      routineCount: plan.routines.length,
      exerciseCount,
    };
  }

  return store.db.transaction(() => {
    const draft = store.createDraft(userId, plan);
    if (!draft.record) throw new DomainError("创建计划草稿失败", 409);
    if (input.mode === "draft") {
      return {
        mode: "draft" as const,
        draft: draft.record,
        activePlan: store.planSchedule(userId),
        plan,
        exerciseNames,
        weeklyMuscleSets,
        routineCount: plan.routines.length,
        exerciseCount,
      };
    }
    const activePlan = store.applyPlan(
      userId,
      draft.record.id,
      draft.record.version,
      input.expectedRevision ?? (store.activePlan(userId)?.revision ?? 0),
      false,
    );
    return {
      mode: "apply" as const,
      draft: draft.record,
      activePlan,
      plan,
      exerciseNames,
      weeklyMuscleSets,
      routineCount: plan.routines.length,
      exerciseCount,
    };
  }).immediate();
}
