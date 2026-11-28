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
  includeSuspectedDuplicates: z.boolean().default(false),
  decimalFormat: z.enum(["auto", "dot", "comma"]).default("auto"),
  allowPartialImport: z.boolean().default(false),
  expectedPreviewSignature: z.string().min(8).max(128).optional(),
  opId: z.string().min(4).max(128).optional(),
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
  // #109: Strip spreadsheet-safe single-quote prefix emitted during Ironlog CSV formula escaping
  if (/^'[=+\-@\t\r]/.test(trimmed)) return trimmed.slice(1);
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

export interface ParsedCsvResult {
  rows: string[][];
  delimiter: "," | ";";
  unclosedQuoteLine: number | null;
}

export function parseCsvMatrixDetailed(rawText: string): ParsedCsvResult {
  const text = rawText.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let lineNo = 1;
  let quoteStartLine: number | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          quoteStartLine = null;
        }
      } else {
        if (ch === "\r") {
          if (text[i + 1] === "\n") i++;
          lineNo++;
          cell += "\n";
        } else {
          if (ch === "\n") lineNo++;
          cell += ch;
        }
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoteStartLine = lineNo;
    } else if (ch === delimiter) {
      row.push(unescapeCell(cell));
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lineNo++;
      row.push(unescapeCell(cell));
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  const unclosedQuoteLine = inQuotes ? (quoteStartLine ?? lineNo) : null;
  row.push(unescapeCell(cell));
  if (row.some((c) => c !== "")) rows.push(row);
  return { rows, delimiter, unclosedQuoteLine };
}

export function parseCsvMatrix(rawText: string): string[][] {
  return parseCsvMatrixDetailed(rawText).rows;
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

function isRealCalendarDate(y: number, m: number, d: number): boolean {
  if (y < 1902 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function parseTzOffsetMinutes(tzRaw: string | undefined): number | null {
  if (!tzRaw) return null;
  const tz = tzRaw.trim().toUpperCase();
  if (tz === "Z" || tz === "UTC" || tz === "GMT") return 0;
  const m = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  if (hh > 14 || mm > 59) return null;
  return sign * (hh * 60 + mm);
}

function applyClockHours(rawHour: string | undefined, ampmRaw: string | undefined): number | null {
  if (rawHour === undefined) return 18;
  let hh = Number(rawHour);
  const ampm = ampmRaw?.toUpperCase();
  if (ampm) {
    if (!Number.isInteger(hh) || hh < 1 || hh > 12) return null;
    if (ampm === "PM" && hh < 12) hh += 12;
    if (ampm === "AM" && hh === 12) hh = 0;
    return hh;
  }
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) return null;
  return hh;
}

function parseDateAndIso(raw: string): { date: string; iso: string; warning?: string } | null {
  const clean = raw.trim();
  if (!clean) return null;

  // ISO YYYY-MM-DD or YYYY-MM-DD HH:mm(:ss) [AM/PM] [TZ] or YYYY/MM/DD
  const ymd = clean.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*(AM|PM))?(?:\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?)?$/i,
  );
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (isRealCalendarDate(y, m, d)) {
      const hh = applyClockHours(ymd[4], ymd[7]);
      const mm = Number(ymd[5] ?? 0);
      const ss = Number(ymd[6] ?? 0);
      if (hh === null || mm > 59 || ss > 59) return null;
      const tzMin = parseTzOffsetMinutes(ymd[8]);
      if (tzMin !== null) {
        const ms = Date.UTC(y, m - 1, d, hh, mm, ss) - tzMin * 60_000;
        return { date: localDate(ms), iso: new Date(ms).toISOString() };
      }
      const date = `${y}-${pad2(m)}-${pad2(d)}`;
      const ms = Date.UTC(y, m - 1, d, hh, mm, ss) - 8 * 3600000;
      return { date, iso: new Date(ms).toISOString() };
    }
    return null;
  }

  // Hevy / European style: "21 Nov 2026, 09:30", "21 Nov 2026, 7:30 PM", "24 Nov 2026, 18:00 UTC"
  const dmy = clean.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?(?:\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?)?$/i,
  );
  if (dmy) {
    const d = Number(dmy[1]);
    const mIdx = MONTH_MAP[dmy[2]!.toLowerCase()];
    const y = Number(dmy[3]);
    if (mIdx !== undefined && isRealCalendarDate(y, mIdx + 1, d)) {
      const hh = applyClockHours(dmy[4], dmy[7]);
      const mm = Number(dmy[5] ?? 0);
      const ss = Number(dmy[6] ?? 0);
      if (hh === null || mm > 59 || ss > 59) return null;
      const tzMin = parseTzOffsetMinutes(dmy[8]);
      if (tzMin !== null) {
        const ms = Date.UTC(y, mIdx, d, hh, mm, ss) - tzMin * 60_000;
        return { date: localDate(ms), iso: new Date(ms).toISOString() };
      }
      const date = `${y}-${pad2(mIdx + 1)}-${pad2(d)}`;
      return { date, iso: new Date(Date.UTC(y, mIdx, d, hh, mm, ss) - 8 * 3600000).toISOString() };
    }
    return null;
  }

  // US style: "Nov 21, 2026 9:30 AM" or "Nov 21, 2026 7:30 PM UTC"
  const mdy = clean.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?(?:\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2}))?)?$/i,
  );
  if (mdy) {
    const mIdx = MONTH_MAP[mdy[1]!.toLowerCase()];
    const d = Number(mdy[2]);
    const y = Number(mdy[3]);
    if (mIdx !== undefined && isRealCalendarDate(y, mIdx + 1, d)) {
      const hh = applyClockHours(mdy[4], mdy[7]);
      const mm = Number(mdy[5] ?? 0);
      const ss = Number(mdy[6] ?? 0);
      if (hh === null || mm > 59 || ss > 59) return null;
      const tzMin = parseTzOffsetMinutes(mdy[8]);
      if (tzMin !== null) {
        const ms = Date.UTC(y, mIdx, d, hh, mm, ss) - tzMin * 60_000;
        return { date: localDate(ms), iso: new Date(ms).toISOString() };
      }
      const date = `${y}-${pad2(mIdx + 1)}-${pad2(d)}`;
      return { date, iso: new Date(Date.UTC(y, mIdx, d, hh, mm, ss) - 8 * 3600000).toISOString() };
    }
    return null;
  }

  const fallback = Date.parse(clean);
  if (Number.isFinite(fallback)) {
    return {
      date: localDate(fallback),
      iso: new Date(fallback).toISOString(),
      warning: `时间「${clean.slice(0, 40)}」使用宽松格式解析，请核对归档日期与上下午。`,
    };
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
  for (const m of clean.matchAll(/(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g)) {
    matched = true;
    const val = Number(m[1]!.replace(",", "."));
    const unit = m[2]![0];
    if (unit === "h") total += val * 3600;
    else if (unit === "m") total += val * 60;
    else total += val;
  }
  if (matched) return Math.max(0, Math.round(total));
  const plain = Number(clean.replace(",", "."));
  return Number.isFinite(plain) && plain > 0 ? Math.round(plain) : 0;
}

function detectFileDecimalFormat(
  delimiter: "," | ";",
  tokens: string[],
  override: "auto" | "dot" | "comma",
): { decimalSep: "." | ","; ambiguous: boolean; warnings: string[] } {
  if (override === "comma") return { decimalSep: ",", ambiguous: false, warnings: [] };
  if (override === "dot") return { decimalSep: ".", ambiguous: false, warnings: [] };

  let commaDec = 0;
  let dotDec = 0;
  let ambiguousThreeDigitComma = 0;

  for (const raw of tokens) {
    const t = raw.replace(/[\s\u00A0]+/g, "");
    if (!t) continue;
    if (/^-?\d+(?:\.\d{3})+,\d+$/.test(t)) {
      commaDec += 2;
    } else if (/^-?\d+(?:,\d{3})+\.\d+$/.test(t)) {
      dotDec += 2;
    } else if (/^-?\d+,\d{1,2}$/.test(t)) {
      commaDec++;
    } else if (/^-?\d+\.\d{1,2}$/.test(t)) {
      dotDec++;
    } else if (/^-?\d+,\d{3}$/.test(t)) {
      ambiguousThreeDigitComma++;
    } else if (/^-?\d+\.\d{3,}$/.test(t)) {
      dotDec++;
    }
  }

  const warnings: string[] = [];
  if (commaDec > 0 && dotDec > 0) {
    const decimalSep: "." | "," = delimiter === ";" ? "," : ".";
    warnings.push(
      `检测到文件混用小数点与小数逗号，当前按「${decimalSep === "," ? "小数逗号" : "小数点"}」解析，建议在预览中展开代表组核对或在下方手动切换数字格式。`,
    );
    return { decimalSep, ambiguous: true, warnings };
  }
  if (commaDec > 0) {
    return { decimalSep: ",", ambiguous: false, warnings };
  }
  if (dotDec > 0) {
    return { decimalSep: ".", ambiguous: false, warnings };
  }
  if (delimiter === ";" && ambiguousThreeDigitComma > 0) {
    warnings.push("分号分隔文件中存在如 1,250 形式的三位小数/千分位数值，默认按小数逗号解析；若为千分位请手动切换为「小数点」。");
    return { decimalSep: ",", ambiguous: true, warnings };
  }
  return { decimalSep: delimiter === ";" ? "," : ".", ambiguous: false, warnings };
}

function numVal(raw: string | undefined, decimalSep: "." | "," = "."): number {
  if (!raw) return 0;
  const s = raw.replace(/[\s\u00A0]+/g, "");
  if (!s) return 0;
  let normalized = s;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // Both separators present: whichever appears last is the decimal mark
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    if (decimalSep === ",") {
      // Single comma => decimal separator (e.g. "62,5" -> "62.5"); multiple commas => thousands
      normalized = s.indexOf(",") === s.lastIndexOf(",") ? s.replace(",", ".") : s.replace(/,/g, "");
    } else if (/^-?\d+,\d{1,2}$/.test(s)) {
      // Unambiguous European decimal comma (1–2 fractional digits, never a valid thousands group)
      normalized = s.replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasDot) {
    if (decimalSep === "," && /^-?\d+(?:\.\d{3})+$/.test(s)) {
      normalized = s.replace(/\./g, "");
    }
  }

  const parsed = Number(normalized);
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
  sourceSessionId: string | null;
  hasReliableStartTime: boolean;
  title: string;
  date: string;
  startedAt: string;
  durationSeconds: number;
  feeling: Workout["feeling"];
  exerciseName: string;
  exerciseRowId?: string | null;
  setNumber?: number;
  modeHint?: Exercise["mode"];
  muscleHint?: Exercise["muscle"];
  equipmentHint?: Exercise["equipment"];
  volumeMultiplierHint?: number;
  categoryHint: string;
  supersetGroup: string | null;
  setType: Workout["exercises"][number]["sets"][number]["type"];
  weightKg: number;
  weightUnit?: "kg" | "lb";
  rawWeight?: number;
  rawWeightText?: string;
  rawUnitLabel?: string;
  reps: number;
  seconds: number;
  rir: number | null;
  completed: boolean;
  endedAt?: string | null;
  durationUnknown?: boolean;
  setCompletedAt?: string | null;
  sessionOnly?: boolean;
  notes: string;
}

const VALID_MODES = new Set<Exercise["mode"]>(["reps", "timed", "assisted"]);
const VALID_MUSCLES = new Set<Exercise["muscle"]>(["chest", "back", "legs", "shoulders", "arms", "core", "cardio"]);
const VALID_EQUIPMENTS = new Set<Exercise["equipment"]>([
  "barbell",
  "dumbbell",
  "cable",
  "machine",
  "bodyweight",
  "kettlebell",
  "band",
  "weighted",
]);

function parseModeHint(raw: string): Exercise["mode"] | undefined {
  const clean = raw.trim().toLowerCase();
  if (VALID_MODES.has(clean as Exercise["mode"])) return clean as Exercise["mode"];
  if (clean === "辅助" || clean === "配重辅助") return "assisted";
  if (clean === "计时") return "timed";
  if (clean === "自重" || clean === "徒手" || clean === "bodyweight" || clean === "次数" || clean === "负重") return "reps";
  return undefined;
}

function parseMuscleHint(raw: string): Exercise["muscle"] | undefined {
  const clean = raw.trim().toLowerCase();
  if (VALID_MUSCLES.has(clean as Exercise["muscle"])) return clean as Exercise["muscle"];
  return FITNOTES_CATEGORY_TO_MUSCLE[clean];
}

function parseEquipmentHint(raw: string): Exercise["equipment"] | undefined {
  const clean = raw.trim().toLowerCase();
  if (VALID_EQUIPMENTS.has(clean as Exercise["equipment"])) return clean as Exercise["equipment"];
  return undefined;
}

function hasExplicitClockTime(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return /(?:T|\s)\d{1,2}:\d{2}/.test(trimmed) || /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(trimmed);
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
  decimalSep: "." | ",",
): { rows: NormalizedRow[]; warnings: string[]; skippedRows: number } {
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
  const dateWarnings = new Set<string>();
  const invalidRowNumbers: number[] = [];
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

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]!;
    const csvLineNo = rowIdx + 2;
    if (format === "ironlog") {
      const dateStr = col(row, "日期");
      const parsedDate = parseDateAndIso(dateStr);
      const exName = col(row, "动作").trim();
      const setTypeCell = col(row, "组类型").trim().toLowerCase();
      const recordTypeCell = col(row, "记录类型", "record_type").trim().toLowerCase();
      const isSessionOnly =
        !exName &&
        (recordTypeCell === "session" ||
          recordTypeCell === "session_only" ||
          setTypeCell === "场次记录" ||
          setTypeCell === "session_only");
      if (!parsedDate || (!exName && !isSessionOnly)) {
        invalidRowNumbers.push(csvLineNo);
        continue;
      }
      if (parsedDate.warning) dateWarnings.add(parsedDate.warning);
      if (parsedDate.date > todayDate) { futureSkipped++; continue; }
      const startRaw = col(row, "开始时间", "start_time").trim();
      const parsedStart = startRaw ? parseDateAndIso(startRaw) : null;
      if (startRaw && !parsedStart) {
        dateWarnings.add(`第 ${csvLineNo} 行开始时间「${startRaw.slice(0, 32)}」无法识别，已回退至日期默认时间。`);
      } else if (parsedStart?.warning) {
        dateWarnings.add(parsedStart.warning);
      }
      const startedAt = parsedStart?.iso ?? parsedDate.iso;
      const hasReliableStartTime = hasExplicitClockTime(startRaw || dateStr);
      const endRaw = col(row, "结束时间", "end_time", "ended_at").trim();
      const parsedEnd = endRaw ? parseDateAndIso(endRaw) : null;
      const endedAt = parsedEnd?.iso ?? null;
      const sourceSessionId = col(row, "训练id", "workout_id", "session_id").trim() || null;
      const exerciseRowId = col(row, "动作行id", "exercise_row_id", "exercise_entry_id").trim() || null;
      const modeHint = parseModeHint(col(row, "动作模式", "exercise_mode", "mode"));
      const muscleHint = parseMuscleHint(col(row, "主肌群", "muscle"));
      const equipmentHint = parseEquipmentHint(col(row, "器械", "equipment"));
      const rawMult = numVal(col(row, "容量系数", "volume_multiplier"), decimalSep);
      const volumeMultiplierHint = rawMult >= 0.5 && rawMult <= 4 ? rawMult : undefined;
      const title = col(row, "训练标题").trim() || "导入训练";
      const rawDurSecCell = col(row, "计时(秒)", "训练时长(秒)", "duration_seconds").trim();
      const rawDurSec = rawDurSecCell !== "" ? numVal(rawDurSecCell, decimalSep) : NaN;
      const rawMinsCell = col(row, "时长(分钟)");
      const rawMins = rawMinsCell.trim() ? numVal(rawMinsCell, decimalSep) : 0;
      const mins = Number.isFinite(rawMins) && rawMins >= 0 && rawMins <= 1440 ? rawMins : 0;
      // #263: Preserve exact seconds from 训练时长(秒) (including 2-second workouts) before falling back to rounded minutes
      const durationSeconds =
        Number.isFinite(rawDurSec) && rawDurSec >= 0 && rawDurSec <= 86400
          ? Math.round(rawDurSec)
          : mins > 0
            ? Math.round(mins * 60)
            : 0;
      const durUnknownRaw = col(row, "时长未知", "duration_unknown").trim().toLowerCase();
      const durationUnknown =
        durUnknownRaw === "是" || durUnknownRaw === "true" || durUnknownRaw === "1"
          ? true
          : durUnknownRaw === "否" || durUnknownRaw === "false" || durUnknownRaw === "0"
            ? false
            : undefined;
      const setCompletedRaw = col(row, "组完成时间", "completed_at").trim();
      const parsedSetCompleted = setCompletedRaw ? parseDateAndIso(setCompletedRaw) : null;
      const setCompletedAt = parsedSetCompleted?.iso ?? null;
      const feelingRaw = col(row, "体感").trim().toLowerCase();
      const doneRaw = col(row, "已完成").trim().toLowerCase();
      const supersetGroup = col(row, "超级组").trim().slice(0, 16) || null;
      const setNo = Math.round(numVal(col(row, "组号"), decimalSep)) || 0;
      const exKey = exerciseRowId ? `rid:${exerciseRowId}` : `${exName}||${supersetGroup ?? ""}`;
      const baseKey = sourceSessionId
        ? `${parsedDate.date}||sid:${sourceSessionId}`
        : `${parsedDate.date}||${startRaw || dateStr.trim()}||${title}`;
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
        if (!sourceSessionId && !startRaw && !exerciseRowId && (restartedSameEx || metaChanged)) {
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
      const unitRaw = col(row, "重量单位", "weight_unit", "weight unit").trim().toLowerCase();
      const rowWeightUnit: "kg" | "lb" | undefined =
        unitRaw === "lb" || unitRaw === "lbs" ? "lb" : unitRaw === "kg" || unitRaw === "kgs" ? "kg" : undefined;
      const rawWeightCell = col(row, "原始重量", "raw_weight").trim();
      const rawWeightVal = rawWeightCell !== "" ? numVal(rawWeightCell, decimalSep) : undefined;
      const colKgCell = col(row, "重量(kg)").trim();
      const colKgVal = numVal(colKgCell, decimalSep);
      // #264: Restore full-precision kg from 原始重量 when unit is explicitly kg, instead of reading rounded 重量(kg)
      const weightKg =
        rowWeightUnit === "lb" && rawWeightVal !== undefined
          ? lbsToKg(rawWeightVal)
          : rowWeightUnit === "kg" && rawWeightVal !== undefined
            ? rawWeightVal
            : colKgVal;
      rows.push({
        sessionKey: `${baseKey}||#${tracker.seq}`,
        sourceSessionId,
        hasReliableStartTime,
        title,
        date: parsedDate.date,
        startedAt,
        endedAt,
        durationSeconds,
        ...(durationUnknown !== undefined ? { durationUnknown } : {}),
        setCompletedAt,
        ...(isSessionOnly ? { sessionOnly: true } : {}),
        feeling: FEELING_ALIASES[feelingRaw] ?? null,
        exerciseName: exName,
        ...(exerciseRowId ? { exerciseRowId } : {}),
        ...(setNo > 0 ? { setNumber: setNo } : {}),
        ...(modeHint ? { modeHint } : {}),
        ...(muscleHint ? { muscleHint } : {}),
        ...(equipmentHint ? { equipmentHint } : {}),
        ...(volumeMultiplierHint !== undefined ? { volumeMultiplierHint } : {}),
        categoryHint: "",
        supersetGroup,
        setType: parseSetType(col(row, "组类型")),
        weightKg,
        ...(rowWeightUnit ? { weightUnit: rowWeightUnit } : {}),
        ...(rawWeightVal !== undefined ? { rawWeight: rawWeightVal } : {}),
        rawWeightText: rawWeightCell || colKgCell || "0",
        rawUnitLabel: rowWeightUnit ?? "kg",
        reps: Math.round(numVal(col(row, "次数"), decimalSep)),
        seconds: Math.round(numVal(col(row, "时长(秒)"), decimalSep)),
        rir: parseRirOrRpe(col(row, "rir"), undefined),
        completed: doneRaw === "" || doneRaw === "是" || doneRaw === "true" || doneRaw === "1",
        notes: "",
      });
      continue;
    }

    if (format === "hevy") {
      const startRaw = col(row, "start_time");
      const parsedStart = parseDateAndIso(startRaw);
      const exName = col(row, "exercise_title").trim();
      if (!parsedStart || !exName) {
        invalidRowNumbers.push(csvLineNo);
        if (!parsedStart && startRaw.trim()) {
          dateWarnings.add(`第 ${csvLineNo} 行开始时间「${startRaw.trim().slice(0, 32)}」无法识别，已跳过。`);
        }
        continue;
      }
      if (parsedStart.warning) dateWarnings.add(parsedStart.warning);
      if (parsedStart.date > todayDate) { futureSkipped++; continue; }
      const endRaw = col(row, "end_time");
      const parsedEnd = endRaw.trim() ? parseDateAndIso(endRaw) : null;
      if (endRaw.trim() && !parsedEnd) {
        dateWarnings.add(`第 ${csvLineNo} 行结束时间「${endRaw.trim().slice(0, 32)}」无法识别，已忽略该场结束时间。`);
      } else if (parsedEnd?.warning) {
        dateWarnings.add(parsedEnd.warning);
      }
      const durSec = parsedEnd
        ? Math.max(0, Math.round((Date.parse(parsedEnd.iso) - Date.parse(parsedStart.iso)) / 1000))
        : 0;
      const title = col(row, "title").trim() || "Hevy 训练";
      const kgCell = col(row, "weight_kg").trim();
      const lbsCell = col(row, "weight_lbs").trim();
      const kgRaw = numVal(kgCell, decimalSep);
      const lbsRaw = numVal(lbsCell, decimalSep);
      const weightKg = kgRaw > 0 ? kgRaw : lbsToKg(lbsRaw);
      const ssRaw = col(row, "superset_id").trim();
      rows.push({
        sessionKey: `${parsedStart.date}||${startRaw}||${title}`,
        sourceSessionId: null,
        hasReliableStartTime: hasExplicitClockTime(startRaw),
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
        rawWeightText: kgCell || lbsCell || "0",
        rawUnitLabel: kgRaw > 0 || !lbsCell ? "kg" : "lb",
        reps: Math.round(numVal(col(row, "reps"), decimalSep)),
        seconds: Math.round(numVal(col(row, "duration_seconds"), decimalSep)),
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
      if (!parsedDate || !exName) {
        invalidRowNumbers.push(csvLineNo);
        if (!parsedDate && dateRaw.trim()) {
          dateWarnings.add(`第 ${csvLineNo} 行日期时间「${dateRaw.trim().slice(0, 32)}」无法识别，已跳过。`);
        }
        continue;
      }
      if (parsedDate.warning) dateWarnings.add(parsedDate.warning);
      if (parsedDate.date > todayDate) { futureSkipped++; continue; }
      const title = col(row, "workout name").trim() || "Strong 训练";
      const durSec = parseDurationToSeconds(col(row, "duration"));
      const unitCell = col(row, "weight unit").trim().toLowerCase();
      const useLbs = unitCell === "lbs" || unitCell === "lb" || (!unitCell && headerWeightIsLbs);
      const weightCell = col(row, "weight", "weight (kg)", "weight (lbs)").trim();
      const rawWeight = numVal(weightCell, decimalSep);
      const weightKg = useLbs ? lbsToKg(rawWeight) : rawWeight;
      const setOrder = col(row, "set order", "set type");
      rows.push({
        sessionKey: `${parsedDate.date}||${dateRaw}||${title}`,
        sourceSessionId: null,
        hasReliableStartTime: hasExplicitClockTime(dateRaw),
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
        rawWeightText: weightCell || "0",
        rawUnitLabel: useLbs ? "lb" : "kg",
        reps: Math.round(numVal(col(row, "reps"), decimalSep)),
        seconds: Math.round(numVal(col(row, "seconds", "duration_seconds"), decimalSep)),
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
    if (!parsedDate || !exName) {
      invalidRowNumbers.push(csvLineNo);
      if (!parsedDate && dateRaw.trim()) {
        dateWarnings.add(`第 ${csvLineNo} 行日期「${dateRaw.trim().slice(0, 32)}」无法识别，已跳过。`);
      }
      continue;
    }
    if (parsedDate.warning) dateWarnings.add(parsedDate.warning);
    if (parsedDate.date > todayDate) { futureSkipped++; continue; }
    const cat = col(row, "category").trim();
    const kgCell = col(row, "weight (kgs)", "weight").trim();
    const lbsCell = col(row, "weight (lbs)").trim();
    const rawKg = numVal(kgCell, decimalSep);
    const rawLbs = numVal(lbsCell, decimalSep);
    const useLbs = headerWeightIsLbs && !idxMap.has("weight (kgs)");
    const weightKg = useLbs
      ? lbsToKg(rawKg || rawLbs)
      : rawKg > 0 ? rawKg : lbsToKg(rawLbs);
    rows.push({
      sessionKey: parsedDate.date,
      sourceSessionId: null,
      hasReliableStartTime: false,
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
      rawWeightText: kgCell || lbsCell || "0",
      rawUnitLabel: useLbs || (!rawKg && rawLbs > 0) ? "lb" : "kg",
      reps: Math.round(numVal(col(row, "reps"), decimalSep)),
      seconds: parseDurationToSeconds(col(row, "time")),
      rir: null,
      completed: true,
      notes: col(row, "comment").trim(),
    });
  }

  for (const w of [...dateWarnings].slice(0, 5)) {
    warnings.push(w);
  }
  if (invalidRowNumbers.length > 0) {
    const sample = invalidRowNumbers.slice(0, 5).map((n) => `第 ${n} 行`).join("、");
    warnings.push(
      `有 ${invalidRowNumbers.length} 行缺少有效日期或动作名已被跳过（${sample}${invalidRowNumbers.length > 5 ? " 等" : ""}）。`,
    );
  }
  if (futureSkipped > 0) {
    warnings.push(`已跳过 ${futureSkipped} 行晚于今天（${todayDate}）的记录。`);
  }
  return { rows, warnings, skippedRows: invalidRowNumbers.length };
}

type DuplicateStatus = "none" | "exact" | "suspected";

interface SampleSetPreview {
  exercise: string;
  mode: Exercise["mode"];
  rawWeightText: string;
  rawUnit: string;
  parsedWeight: number;
  parsedUnit: "kg" | "lb";
  reps: number;
  seconds: number;
}

interface PreparedImport {
  format: ImportFormat;
  formatLabel: string;
  decimalSep: "." | ",";
  ambiguousDecimal: boolean;
  unclosedQuoteLine: number | null;
  skippedRows: number;
  customExercisesToCreate: Exercise[];
  workoutsToCreate: Array<{
    id: string;
    stableKey: string;
    data: Workout;
    duplicate: boolean;
    duplicateStatus: DuplicateStatus;
    sampleSets: SampleSetPreview[];
  }>;
  matchedCount: number;
  warnings: string[];
}

function collectNumericCandidateTokens(headersRaw: string[], dataRows: string[][]): string[] {
  const numericHeaderPattern = /^(重量\(kg\)|原始重量|raw_weight|weight.*|次数|reps|时长\(分钟\)|时长\(秒\)|duration_seconds|seconds|rir|rpe|容量系数|volume_multiplier)$/i;
  const cols: number[] = [];
  headersRaw.forEach((h, i) => {
    if (numericHeaderPattern.test(h.trim())) cols.push(i);
  });
  const tokens: string[] = [];
  for (const row of dataRows) {
    for (const c of cols) {
      const v = row[c]?.trim();
      if (v) tokens.push(v);
    }
  }
  return tokens;
}

function prepareImport(
  store: Store,
  userId: string,
  csvText: string,
  decimalFormat: "auto" | "dot" | "comma" = "auto",
): PreparedImport {
  const parsedCsv = parseCsvMatrixDetailed(csvText);
  const matrix = parsedCsv.rows;
  if (matrix.length < 2) {
    if (parsedCsv.unclosedQuoteLine !== null) {
      throw new DomainError(`CSV 第 ${parsedCsv.unclosedQuoteLine} 行存在未闭合引号（"），无法解析有效记录`, 400);
    }
    throw new DomainError("CSV 缺少数据行，无法解析训练记录", 400);
  }
  const headers = matrix[0]!;
  const format = detectFormat(headers.map((h) => h.toLowerCase()));
  const dataRows = matrix.slice(1);
  const decimalDetect = detectFileDecimalFormat(
    parsedCsv.delimiter,
    collectNumericCandidateTokens(headers, dataRows),
    decimalFormat,
  );
  const todayDate = localDate();
  const { rows, warnings: rowWarnings, skippedRows } = buildNormalizedRows(
    format,
    headers,
    dataRows,
    todayDate,
    decimalDetect.decimalSep,
  );
  const warnings: string[] = [];
  if (parsedCsv.unclosedQuoteLine !== null) {
    warnings.push(
      `第 ${parsedCsv.unclosedQuoteLine} 行存在未闭合的 CSV 引号（"），后续记录可能已被截断或并入该行。请检查源文件，或在确认前明确勾选「忽略引号截断并部分导入」。`,
    );
  }
  warnings.push(...decimalDetect.warnings, ...rowWarnings);

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
    const explicitMode = sampleRows.find((r) => r.modeHint)?.modeHint;
    const explicitMuscle = sampleRows.find((r) => r.muscleHint)?.muscleHint;
    const explicitEquip = sampleRows.find((r) => r.equipmentHint)?.equipmentHint;
    const explicitMult = sampleRows.find((r) => r.volumeMultiplierHint !== undefined)?.volumeMultiplierHint;

    const existing = resolveExerciseName(name, lookup);
    if (existing) {
      matchedExercisesSet.add(existing.id);
      return existing;
    }
    const norm = compactName(name);
    const pending = preparedCustomByNorm.get(norm);
    if (pending) return pending;

    const hasTimed = sampleRows.every((r) => r.seconds > 0 && r.reps === 0);
    const muscle = explicitMuscle ?? inferMuscle(name, sampleRows[0]?.categoryHint ?? "");
    const equip = explicitEquip ?? inferEquipment(name);
    const mode = explicitMode ?? (hasTimed ? "timed" : "reps");
    const volumeMultiplier = explicitMult ?? (equip === "dumbbell" ? 2 : 1);
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
      mode,
      volumeMultiplier,
      instructions: ["导入自外部训练记录，可按个人习惯补充动作要点。"],
      mistakes: [],
      custom: true,
    });
    preparedCustomByNorm.set(norm, customEx);
    return customEx;
  };

  // Existing workouts index for duplicate detection (source session ID + date + reliable start timestamp)
  const existingWorkouts = store
    .list(userId, "workout")
    .filter((r) => (r.data as Workout).status === "completed")
    .map((r) => {
      const w = r.data as Workout;
      const sidMatch = /:sid:([^\s:]+)$/.exec(w.rawPrompt ?? "");
      const startMs = Date.parse(w.startedAt);
      const hasClock = Number.isFinite(startMs);
      return {
        id: r.id,
        rawSourceId: sidMatch?.[1] ?? null,
        date: w.date,
        startMs: hasClock ? startMs : null,
        titleKey: `${w.date}||${w.title.trim().toLowerCase()}`,
        sigKey: `${w.date}||${w.exercises.map((e) => e.exerciseId).sort().join(",")}`,
      };
    });
  const existingSourceIds = new Set<string>();
  const existingByDate = new Map<string, typeof existingWorkouts>();
  for (const ew of existingWorkouts) {
    existingSourceIds.add(ew.id);
    if (ew.rawSourceId) existingSourceIds.add(ew.rawSourceId);
    const list = existingByDate.get(ew.date) ?? [];
    list.push(ew);
    existingByDate.set(ew.date, list);
  }

  const workoutsToCreate: PreparedImport["workoutsToCreate"] = [];

  for (const sRows of sessionGroups.values()) {
    const first = sRows[0]!;
    // #217: Build contiguous exercise blocks inside the session preserving explicit exerciseRowId,
    // and falling back to set-number restart / unit switch for legacy CSV files without row IDs.
    const blocks: Array<{
      name: string;
      supersetGroup: string | null;
      exerciseRowId: string | null;
      weightUnit: "kg" | "lb" | undefined;
      lastSetNumber: number | undefined;
      rows: NormalizedRow[];
    }> = [];
    for (const r of sRows) {
      if (r.sessionOnly || !r.exerciseName) continue;
      const prev = blocks.at(-1);
      const hasRowIds = Boolean(r.exerciseRowId || prev?.exerciseRowId);
      const canMerge = Boolean(
        prev &&
          prev.name === r.exerciseName &&
          prev.supersetGroup === r.supersetGroup &&
          (hasRowIds
            ? prev.exerciseRowId === (r.exerciseRowId ?? null)
            : prev.weightUnit === r.weightUnit &&
              !(r.setNumber !== undefined && prev.lastSetNumber !== undefined && r.setNumber <= prev.lastSetNumber)),
      );
      if (canMerge && prev) {
        prev.rows.push(r);
        if (r.setNumber !== undefined) prev.lastSetNumber = r.setNumber;
      } else {
        blocks.push({
          name: r.exerciseName,
          supersetGroup: r.supersetGroup,
          exerciseRowId: r.exerciseRowId ?? null,
          weightUnit: r.weightUnit,
          lastSetNumber: r.setNumber,
          rows: [r],
        });
      }
    }

    const sampleSets: SampleSetPreview[] = [];
    const exercises: Workout["exercises"] = blocks.map((block) => {
      const ex = resolveOrCreateExercise(block.name, block.rows);
      const snapMode = block.rows.find((r) => r.modeHint)?.modeHint ?? ex.mode;
      const snapMuscle = block.rows.find((r) => r.muscleHint)?.muscleHint ?? ex.muscle;
      const snapEquip = block.rows.find((r) => r.equipmentHint)?.equipmentHint ?? ex.equipment;
      const snapMult = block.rows.find((r) => r.volumeMultiplierHint !== undefined)?.volumeMultiplierHint ?? ex.volumeMultiplier;
      const preserveLb =
        block.rows.length > 0 &&
        block.rows.every((r) => r.weightUnit === "lb" && r.rawWeight !== undefined);
      const storedUnit: "kg" | "lb" = preserveLb ? "lb" : "kg";
      const sets: Workout["exercises"][number]["sets"] = block.rows.map((r) => {
        const reps = snapMode === "timed" ? 0 : r.reps > 0 ? Math.min(1000, r.reps) : (r.seconds > 0 ? 1 : 0);
        const seconds = Math.min(86400, Math.max(0, r.seconds));
        const storedWeight = preserveLb ? r.rawWeight! : r.weightKg;
        const clampedWeight = Math.min(100000, Math.max(0, storedWeight));
        if (sampleSets.length < 6) {
          sampleSets.push({
            exercise: ex.name,
            mode: snapMode,
            rawWeightText: r.rawWeightText ?? String(clampedWeight),
            rawUnit: r.rawUnitLabel ?? storedUnit,
            parsedWeight: clampedWeight,
            parsedUnit: storedUnit,
            reps,
            seconds,
          });
        }
        return {
          id: `imp_set_${randomUUID()}`,
          type: r.setType,
          weight: clampedWeight,
          reps,
          seconds,
          completed: r.completed,
          // #265: Restore exact set completedAt when present; omit for legacy CSVs & uncompleted sets
          ...(r.completed && r.setCompletedAt ? { completedAt: r.setCompletedAt } : {}),
          rir: r.rir,
        };
      });
      return {
        id: `imp_ex_${randomUUID()}`,
        exerciseId: ex.id,
        targetIndex: null,
        supersetGroup: block.supersetGroup,
        ...(preserveLb ? { weightUnit: "lb" as const } : {}),
        restSeconds: 90,
        snapshot: {
          name: ex.name,
          muscle: snapMuscle,
          equipment: snapEquip,
          mode: snapMode,
          volumeMultiplier: snapMult,
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

    const durSec = Number.isFinite(first.durationSeconds) && first.durationSeconds > 0
      ? Math.min(86400, Math.round(first.durationSeconds))
      : 0;
    const startMs = Date.parse(first.startedAt);
    if (!Number.isFinite(startMs)) continue;
    // #263: Preserve real endedAt & paused timing when exported; compute endedAt from durSec only for legacy CSVs
    const explicitEndMs = first.endedAt ? Date.parse(first.endedAt) : NaN;
    const hasExplicitEnd = Number.isFinite(explicitEndMs) && explicitEndMs >= startMs;
    const endedAt = hasExplicitEnd
      ? first.endedAt!
      : new Date(startMs + (durSec > 0 ? durSec * 1000 : 0)).toISOString();
    const wallClockSec = hasExplicitEnd ? Math.round((explicitEndMs - startMs) / 1000) : durSec;
    const isDurationUnknown = first.durationUnknown !== undefined ? first.durationUnknown : durSec <= 0;
    const timing =
      !isDurationUnknown && durSec > 0 && hasExplicitEnd && durSec !== wallClockSec
        ? { elapsedSeconds: durSec, runningSince: null }
        : undefined;
    const notes = [...new Set(sRows.map((r) => r.notes).filter(Boolean))].join("\n").slice(0, 4000);

    const parsedWo = workoutSchema.safeParse({
      title: title.slice(0, 120),
      date: first.date,
      startedAt: first.startedAt,
      endedAt,
      ...(timing ? { timing } : {}),
      durationUnknown: isDurationUnknown,
      status: "completed",
      notes,
      feeling: first.feeling,
      source: "manual",
      rawPrompt: `csv_import:${format}${first.sourceSessionId ? `:sid:${first.sourceSessionId}` : ""}`,
      planId: null,
      planVersion: null,
      routineId: null,
      targetSnapshot: null,
      exercises,
      restEndsAt: null,
      adjustments: [],
    });
    if (!parsedWo.success) {
      throw new DomainError(`训练「${title}」（${first.date}）数据格式无效，请检查日期与数值列`, 400);
    }
    const workoutData = parsedWo.data;

    const titleKey = `${workoutData.date}||${workoutData.title.trim().toLowerCase()}`;
    const sigKey = `${workoutData.date}||${workoutData.exercises.map((e) => e.exerciseId).sort().join(",")}`;
    const sameDayExisting = existingByDate.get(workoutData.date) ?? [];
    const sameContentRows = sameDayExisting.filter(
      (ew) => ew.titleKey === titleKey || (workoutData.exercises.length > 0 && ew.sigKey === sigKey),
    );

    let duplicateStatus: DuplicateStatus = "none";
    if (first.sourceSessionId && existingSourceIds.has(first.sourceSessionId)) {
      duplicateStatus = "exact";
    } else if (sameContentRows.length > 0) {
      if (first.hasReliableStartTime && Number.isFinite(startMs)) {
        const matchedWithinWindow = sameContentRows.some(
          (ew) => ew.startMs !== null && Math.abs(startMs - ew.startMs) <= 15 * 60_000,
        );
        if (matchedWithinWindow) {
          duplicateStatus = "exact";
        }
      } else {
        duplicateStatus = "suspected";
      }
    }

    // #267: Include resolved exercise snapshot (mode/muscle/equipment/volumeMultiplier) in stableKey so mode edits between preview and commit invalidate signature
    const stableKey = createHash("sha256")
      .update(
        JSON.stringify({
          date: workoutData.date,
          title: workoutData.title,
          startedAt: workoutData.startedAt,
          endedAt: workoutData.endedAt,
          durationUnknown: Boolean(workoutData.durationUnknown),
          sid: first.sourceSessionId,
          ex: workoutData.exercises.map((e) => [
            e.exerciseId,
            e.weightUnit ?? "kg",
            e.snapshot?.mode ?? "reps",
            e.snapshot?.muscle ?? "",
            e.snapshot?.equipment ?? "",
            e.snapshot?.volumeMultiplier ?? 1,
            e.sets.map((s) => [s.weight, s.reps, s.seconds, s.type, s.completed]),
          ]),
        }),
      )
      .digest("hex")
      .slice(0, 16);

    workoutsToCreate.push({
      id: `imp_wo_${randomUUID()}`,
      stableKey,
      data: workoutData,
      duplicate: duplicateStatus === "exact",
      duplicateStatus,
      sampleSets,
    });
  }

  return {
    format,
    formatLabel: FORMAT_LABELS[format],
    decimalSep: decimalDetect.decimalSep,
    ambiguousDecimal: decimalDetect.ambiguous,
    unclosedQuoteLine: parsedCsv.unclosedQuoteLine,
    skippedRows,
    customExercisesToCreate: [...preparedCustomByNorm.values()],
    workoutsToCreate,
    matchedCount: matchedExercisesSet.size,
    warnings,
  };
}

function shouldImportPreparedWorkout(
  w: PreparedImport["workoutsToCreate"][number],
  input: Pick<z.infer<typeof csvImportInput>, "skipDuplicates" | "includeSuspectedDuplicates">,
): boolean {
  if (!input.skipDuplicates) return true;
  if (w.duplicateStatus === "exact") return false;
  if (w.duplicateStatus === "suspected" && !input.includeSuspectedDuplicates) return false;
  return true;
}

function computePreviewSignature(
  prepared: PreparedImport,
  input: Pick<z.infer<typeof csvImportInput>, "skipDuplicates" | "includeSuspectedDuplicates">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        format: prepared.format,
        decimalSep: prepared.decimalSep,
        unclosedQuoteLine: prepared.unclosedQuoteLine,
        plan: prepared.workoutsToCreate.map((w) => ({
          k: w.stableKey,
          s: w.duplicateStatus,
          i: shouldImportPreparedWorkout(w, input),
        })),
      }),
    )
    .digest("hex")
    .slice(0, 24);
}

export function previewWorkoutCsvImport(
  store: Store,
  userId: string,
  input: z.infer<typeof csvImportInput>,
) {
  const prepared = prepareImport(store, userId, input.csv, input.decimalFormat);
  const selected = prepared.workoutsToCreate.filter((w) => shouldImportPreparedWorkout(w, input));
  const duplicateWorkouts = prepared.workoutsToCreate.filter((w) => w.duplicateStatus === "exact").length;
  const suspected = prepared.workoutsToCreate.filter((w) => w.duplicateStatus === "suspected");
  const willSkipDuplicates = prepared.workoutsToCreate.length - selected.length;
  const totalSets = selected.reduce(
    (sum, w) => sum + w.data.exercises.reduce((es, ex) => es + ex.sets.length, 0),
    0,
  );
  const warnings = [...prepared.warnings];
  if (suspected.length > 0) {
    warnings.push(`检测到 ${suspected.length} 场缺少开始时间的同日类似训练（疑似重复），可按需勾选「导入疑似重复」。`);
  }
  return {
    format: prepared.format,
    formatLabel: prepared.formatLabel,
    previewSignature: computePreviewSignature(prepared, input),
    detectedDecimalSeparator: prepared.decimalSep,
    ambiguousDecimal: prepared.ambiguousDecimal,
    unclosedQuoteLine: prepared.unclosedQuoteLine,
    skippedRows: prepared.skippedRows,
    totalWorkouts: prepared.workoutsToCreate.length,
    importableWorkouts: selected.length,
    duplicateWorkouts,
    willSkipDuplicates,
    suspectedDuplicateWorkouts: suspected.length,
    totalSets,
    matchedExercises: prepared.matchedCount,
    customExercisesToCreate: prepared.customExercisesToCreate.map((e) => e.name),
    customExerciseDetails: prepared.customExercisesToCreate.map((e) => ({
      name: e.name,
      mode: e.mode,
      muscle: e.muscle,
      equipment: e.equipment,
    })),
    sampleWorkouts: selected.slice(0, 5).map((w) => ({
      date: w.data.date,
      title: w.data.title,
      exercises: w.data.exercises.map((e) => e.snapshot?.name ?? e.exerciseId),
      sets: w.data.exercises.reduce((s, e) => s + e.sets.length, 0),
      sampleSets: w.sampleSets,
    })),
    suspectedWorkouts: suspected.slice(0, 10).map((w) => ({
      date: w.data.date,
      title: w.data.title,
      exercises: w.data.exercises.map((e) => e.snapshot?.name ?? e.exerciseId),
      sets: w.data.exercises.reduce((s, e) => s + e.sets.length, 0),
    })),
    warnings,
  };
}

export function commitWorkoutCsvImport(
  store: Store,
  userId: string,
  input: z.infer<typeof csvImportInput>,
) {
  const opKey = input.opId ? `csv_import:${input.opId}` : null;
  const reqDigest = opKey
    ? createHash("sha256")
        .update(
          JSON.stringify({
            csv: input.csv,
            skipDuplicates: input.skipDuplicates,
            includeSuspectedDuplicates: input.includeSuspectedDuplicates,
            decimalFormat: input.decimalFormat,
            allowPartialImport: input.allowPartialImport,
          }),
        )
        .digest("hex")
    : null;

  // #221: Replay identical commit receipt on retry when opId already committed
  if (opKey) {
    const prior = store.db
      .prepare("SELECT request, result FROM operations WHERE user_id = ? AND op_id = ?")
      .get(userId, opKey) as { request: string; result: string } | undefined;
    if (prior) {
      if (prior.request !== reqDigest) {
        throw new DomainError("导入操作 ID 与先前的导入参数不一致，请重新预览后再确认。", 409);
      }
      return { ...(JSON.parse(prior.result) as Record<string, unknown>), replayed: true };
    }
  }

  const prepared = prepareImport(store, userId, input.csv, input.decimalFormat);
  if (prepared.unclosedQuoteLine !== null && !input.allowPartialImport) {
    throw new DomainError(
      `CSV 第 ${prepared.unclosedQuoteLine} 行存在未闭合引号（"），后续记录可能已被截断。请修复 CSV 后重试，或在预览中明确勾选「忽略引号截断并部分导入」。`,
      400,
    );
  }
  const currentSignature = computePreviewSignature(prepared, input);
  if (input.expectedPreviewSignature && input.expectedPreviewSignature !== currentSignature) {
    throw new DomainError(
      "预览后服务器中的训练记录已发生变化，待导入或跳过的场次与预览范围不一致，请重新解析预览并确认。",
      409,
    );
  }

  const toImport = prepared.workoutsToCreate.filter((w) => shouldImportPreparedWorkout(w, input));
  const duplicateWorkouts = prepared.workoutsToCreate.filter((w) => w.duplicateStatus === "exact").length;
  const suspectedWorkouts = prepared.workoutsToCreate.filter((w) => w.duplicateStatus === "suspected").length;

  let importedWorkouts = 0;
  let importedSets = 0;
  let createdCustomExercises = 0;
  const createdCustomNames: string[] = [];

  let receipt: {
    format: ImportFormat;
    formatLabel: string;
    importedWorkouts: number;
    skippedDuplicates: number;
    skippedSuspectedDuplicates: number;
    skippedRows: number;
    createdCustomExercises: number;
    createdCustomExerciseNames: string[];
    importedSets: number;
    warnings: string[];
    replayed?: boolean;
  } | null = null;

  store.db.transaction(() => {
    if (opKey) {
      const prior = store.db
        .prepare("SELECT request, result FROM operations WHERE user_id = ? AND op_id = ?")
        .get(userId, opKey) as { request: string; result: string } | undefined;
      if (prior) {
        if (prior.request !== reqDigest) {
          throw new DomainError("导入操作 ID 与先前的导入参数不一致，请重新预览后再确认。", 409);
        }
        receipt = { ...(JSON.parse(prior.result) as NonNullable<typeof receipt>), replayed: true };
        return;
      }
    }

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
      createdCustomNames.push(customEx.name);
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

    receipt = {
      format: prepared.format,
      formatLabel: prepared.formatLabel,
      importedWorkouts,
      skippedDuplicates: input.skipDuplicates ? duplicateWorkouts : 0,
      skippedSuspectedDuplicates: input.skipDuplicates && !input.includeSuspectedDuplicates ? suspectedWorkouts : 0,
      skippedRows: prepared.skippedRows,
      createdCustomExercises,
      createdCustomExerciseNames: createdCustomNames,
      importedSets,
      warnings: prepared.warnings,
    };

    if (opKey && reqDigest) {
      store.db
        .prepare("INSERT INTO operations (user_id, op_id, request, result) VALUES (?, ?, ?, ?)")
        .run(userId, opKey, reqDigest, JSON.stringify(receipt));
    }
  }).immediate();

  return receipt!;
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

  // #100 (P1): Validate against active catalogue only so preview & draft/apply use identical rules.
  const catalogue = store.catalogueMap(userId);
  const lookup = buildLookup(catalogue);
  const missingExercises: string[] = [];
  const usedRoutineIds = new Set<string>();
  const optNum = (v: unknown): number => (v === null || v === undefined || v === "" ? NaN : Number(v));

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
      const setsNum = optNum(exObj.sets);
      const sets = Number.isFinite(setsNum) && setsNum >= 1 ? Math.max(1, Math.min(100, Math.round(setsNum))) : 3;
      const rawRepsMinNum = optNum(exObj.repsMin ?? exObj.reps);
      const repsMin = timed ? 1 : Math.max(1, Math.min(1000, Number.isFinite(rawRepsMinNum) && rawRepsMinNum >= 1 ? Math.round(rawRepsMinNum) : 8));
      const rawRepsMaxNum = optNum(exObj.repsMax ?? exObj.reps);
      const repsMax = timed
        ? 1
        : Math.max(repsMin, Math.min(1000, Number.isFinite(rawRepsMaxNum) && rawRepsMaxNum >= 1 ? Math.round(rawRepsMaxNum) : (exObj.reps ? repsMin : 12)));
      const weightNum = optNum(exObj.weight);
      const weight = Number.isFinite(weightNum) && weightNum >= 0 && weightNum <= 100000 ? weightNum : null;
      const weightUnit = exObj.weightUnit === "lb" || exObj.weightUnit === "kg" ? exObj.weightUnit : undefined;
      const secNum = optNum(exObj.seconds);
      const seconds = timed ? Math.max(1, Math.min(86400, Number.isFinite(secNum) && secNum >= 1 ? Math.round(secNum) : 45)) : 0;
      const restNum = optNum(exObj.restSeconds);
      const restSeconds = Number.isFinite(restNum) && restNum >= 0 ? Math.min(900, Math.round(restNum)) : 90;
      const rirNum = optNum(exObj.targetRir);
      const targetRir = Number.isFinite(rirNum) && rirNum >= 0 ? Math.min(10, Math.round(rirNum)) : 2;
      const rawProg = String(exObj.progression ?? "");
      const progression = (["double", "triple", "linear", "greyskull", "manual"].includes(rawProg)
        ? rawProg
        : (timed ? "manual" : "double")) as Plan["routines"][number]["exercises"][number]["progression"];
      const incNum = optNum(exObj.increment);
      const defaultIncrement = weightUnit === "lb" ? 5 : 2.5;
      const increment = Number.isFinite(incNum) && incNum >= 0 ? Math.min(20, incNum) : defaultIncrement;
      const setsMaxNum = optNum(exObj.setsMax);
      const setsMax = Number.isFinite(setsMaxNum) && setsMaxNum >= sets && setsMaxNum <= 20 ? Math.round(setsMaxNum) : undefined;
      const deloadMissNum = optNum(exObj.deloadMissThreshold);
      const deloadMissThreshold = Number.isFinite(deloadMissNum) && deloadMissNum >= 2 && deloadMissNum <= 5
        ? Math.round(deloadMissNum)
        : undefined;

      let backupExerciseId: string | null = null;
      if (typeof exObj.backupExerciseId === "string" && exObj.backupExerciseId.trim()) {
        const bkStr = exObj.backupExerciseId.trim();
        const bkEx = catalogue.get(bkStr) ?? resolveExerciseName(bkStr, lookup);
        if (bkEx && bkEx.id !== resolved.id) backupExerciseId = bkEx.id;
      }

      return {
        exerciseId: resolved.id,
        sets,
        ...(setsMax !== undefined ? { setsMax } : {}),
        repsMin,
        repsMax,
        weight,
        ...(weightUnit ? { weightUnit } : {}),
        seconds,
        restSeconds,
        targetRir,
        progression,
        increment,
        ...(deloadMissThreshold !== undefined ? { deloadMissThreshold } : {}),
        ...(exObj.autoWarmup === true ? { autoWarmup: true } : {}),
        backupExerciseId,
        supersetGroup: typeof exObj.supersetGroup === "string" && exObj.supersetGroup.trim()
          ? exObj.supersetGroup.trim().slice(0, 16)
          : null,
      };
    });

    return {
      id: rId,
      name: rName,
      exercises,
      ...(rt.isDeload === true ? { isDeload: true } : {}),
    };
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

  const weeksNum = optNum(candidate.weeks);
  const plan = planSchema.parse({
    name: typeof candidate.name === "string" && candidate.name.trim()
      ? candidate.name.trim().slice(0, 120)
      : "导入训练计划",
    weeks: Number.isFinite(weeksNum) && weeksNum >= 1
      ? Math.max(1, Math.min(52, Math.round(weeksNum)))
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
