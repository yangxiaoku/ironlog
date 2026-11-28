import type { Workout } from "./index.js";
import { weightToKg } from "./logic.js";

// Garmin FIT epoch: 1989-12-31T00:00:00Z
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

/**
 * Standard Garmin FIT CRC-16 checksum calculation.
 */
export function computeFitCrc(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc & 0xffff;
}

function toFitTimestamp(iso?: string | null): number {
  const ms = iso ? Date.parse(iso) : Date.now();
  const validMs = Number.isFinite(ms) ? ms : Date.now();
  return Math.max(0, Math.floor((validMs - FIT_EPOCH_MS) / 1000));
}

function pushU16(out: number[], val: number) {
  const v = Math.max(0, Math.min(0xffff, Math.round(val)));
  out.push(v & 0xff, (v >> 8) & 0xff);
}

function pushU32(out: number[], val: number) {
  const v = Math.max(0, Math.min(0xffffffff, Math.round(val)));
  out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}

export interface FitExportWorkoutInput {
  title: string;
  date: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  durationUnknown?: boolean;
  activeCaloriesKcal?: number | null;
  totalWorkJoules?: number | null;
  distanceMeters?: number | null;
  cardioMeta?: {
    activityType?: string | null;
    environment?: "indoor" | "outdoor" | "unknown" | null;
    distanceMeters?: number | null;
  } | null;
  exercises?: Workout["exercises"];
  totalSets?: number;
  totalVolumeKg?: number;
}

function resolveFitSport(input: FitExportWorkoutInput): { sport: number; subSport: number } {
  const act = (input.cardioMeta?.activityType ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  const env = input.cardioMeta?.environment ?? "unknown";
  const indoor = env === "indoor";
  const hasStrengthWork = Boolean(
    input.exercises?.some(
      (ex) =>
        (ex.snapshot?.muscle ?? "") !== "cardio" &&
        ex.sets.some((s) => s.completed && s.type !== "warmup" && s.reps > 0),
    ),
  );
  if (act && !hasStrengthWork) {
    if (act === "running" || act === "run" || act === "treadmill" || act === "indoorrunning" || act === "outdoorrunning") {
      return { sport: 1, subSport: indoor || act === "treadmill" || act === "indoorrunning" ? 45 : 0 };
    }
    if (act === "cycling" || act === "bike" || act === "indoorcycling" || act === "outdoorcycling") {
      return { sport: 2, subSport: indoor || act === "indoorcycling" ? 6 : 0 };
    }
    if (act === "walking" || act === "walk") return { sport: 11, subSport: 0 };
    if (act === "swimming" || act === "swim") return { sport: 5, subSport: indoor ? 17 : 18 };
    if (act === "rowing" || act === "indoorrowing") return { sport: 15, subSport: indoor || act === "indoorrowing" ? 14 : 0 };
    if (act === "hiking" || act === "hike") return { sport: 17, subSport: 0 };
    if (act === "elliptical") return { sport: 4, subSport: 15 };
    if (act === "stairstepper" || act === "stairclimbing" || act === "stairs") return { sport: 4, subSport: 16 };
    if (act === "hiit" || act === "highintensityintervaltraining") return { sport: 62, subSport: 0 };
    if (act === "yoga") return { sport: 10, subSport: 43 };
    return { sport: 0, subSport: 0 };
  }
  return { sport: 10, subSport: 20 }; // training / strength_training
}

export function resolveFitDurationSeconds(input: FitExportWorkoutInput): number | null {
  if (input.durationUnknown) return null;
  if (typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0) {
    return Math.round(input.durationSeconds);
  }
  if (input.startedAt && input.endedAt) {
    const startMs = Date.parse(input.startedAt);
    const endMs = Date.parse(input.endedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return Math.round((endMs - startMs) / 1000);
    }
  }
  return null;
}

function pushFixedString(out: number[], text: string, byteLen: number) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < byteLen; i++) {
    out.push(i < byteLen - 1 && i < bytes.length ? bytes[i]! : 0);
  }
}

// Fixed 16-byte developer application UUID for Ironlog FIT Developer Data fields
const IRONLOG_DEV_APP_ID = [
  0x49, 0x52, 0x4f, 0x4e, 0x4c, 0x4f, 0x47, 0x2d,
  0x46, 0x49, 0x54, 0x2d, 0x30, 0x30, 0x30, 0x31,
];

/**
 * Encodes a completed Ironlog strength training workout into a valid binary Garmin `.fit` file
 * (14-byte header with ".FIT" signature + File ID + optional Developer Data + Activity + Session + Event + CRC-16).
 * Refuses to fabricate duration, calorie, or work measurements when missing.
 */
export function encodeWorkoutToFit(input: FitExportWorkoutInput): Uint8Array {
  const timerDurationSec = resolveFitDurationSeconds(input);
  if (timerDurationSec === null) {
    throw new Error("训练缺少有效时长，无法生成符合实际记录的 .fit 文件；请先补充训练时长或改用 CSV/JSON 导出");
  }
  // #236: Never fabricate a noon UTC start time when actual startedAt is missing/unparseable
  if (!input.startedAt || !Number.isFinite(Date.parse(input.startedAt))) {
    throw new Error("训练缺少实际开始时间，无法生成符合实际记录的 .fit 文件；请刷新完整记录后重试");
  }
  const startMs = Date.parse(input.startedAt);
  const startTs = toFitTimestamp(input.startedAt);
  // #269: Preserve real wall-clock elapsed duration & endedAt when paused, while keeping active timerDurationSec separate
  const endMs = input.endedAt ? Date.parse(input.endedAt) : NaN;
  const wallClockSec =
    Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 1000) : null;
  const elapsedDurationSec = wallClockSec !== null ? Math.max(timerDurationSec, wallClockSec) : timerDurationSec;
  const endTs = startTs + elapsedDurationSec;

  const { sport, subSport } = resolveFitSport(input);
  const rawDistanceMeters = input.distanceMeters ?? input.cardioMeta?.distanceMeters ?? null;
  const measuredDistanceCm =
    typeof rawDistanceMeters === "number" && Number.isFinite(rawDistanceMeters) && rawDistanceMeters > 0
      ? Math.min(0xfffffffe, Math.round(rawDistanceMeters * 100))
      : null;

  // #270: Trust explicit catalogue-resolved totalVolumeKg when supplied (so legacy snapshot-less assisted exercises are never miscounted as reps volume)
  let totalVolumeKg = typeof input.totalVolumeKg === "number" && Number.isFinite(input.totalVolumeKg) ? input.totalVolumeKg : 0;
  if (input.totalVolumeKg === undefined && input.exercises?.length) {
    totalVolumeKg = 0;
    for (const ex of input.exercises) {
      // #123 (P1): Only count reps-mode lifts toward totalVolumeKg (never assisted counterbalance weight).
      if ((ex.snapshot?.mode ?? "reps") !== "reps") continue;
      const mult = ex.snapshot?.volumeMultiplier ?? 1;
      for (const s of ex.sets) {
        if (!s.completed || s.type === "warmup") continue;
        if (s.weight > 0 && s.reps > 0) {
          totalVolumeKg += weightToKg(s.weight, ex.weightUnit) * s.reps * mult;
        }
      }
    }
  }
  // #183 (P2): Clamp uint16 to 0xFFFE (65534) and uint32 to 0xFFFFFFFE so values never collide with FIT INVALID sentinels.
  const measuredCalories =
    typeof input.activeCaloriesKcal === "number" &&
    Number.isFinite(input.activeCaloriesKcal) &&
    input.activeCaloriesKcal > 0
      ? Math.min(0xfffe, Math.round(input.activeCaloriesKcal))
      : null;
  const measuredWorkJoules =
    typeof input.totalWorkJoules === "number" &&
    Number.isFinite(input.totalWorkJoules) &&
    input.totalWorkJoules > 0
      ? Math.min(0xfffffffe, Math.round(input.totalWorkJoules))
      : null;
  const hasVolumeDevField = Number.isFinite(totalVolumeKg) && totalVolumeKg > 0;

  const records: number[] = [];

  // 1) Local 0 -> Global 0 (file_id): type(enum=4 activity), manufacturer(u16=255 dev), product(u16=1), time_created(u32)
  records.push(
    0x40, // Definition header, local msg 0
    0x00, // reserved
    0x00, // little-endian
    0x00, 0x00, // global msg num 0 (file_id)
    0x04, // 4 fields
    0, 1, 0x00, // field 0: type (enum)
    1, 2, 0x84, // field 1: manufacturer (uint16)
    2, 2, 0x84, // field 2: product (uint16)
    4, 4, 0x86, // field 4: time_created (uint32)
  );
  records.push(0x00, 4); // data msg 0: type=4 (activity)
  pushU16(records, 255); // development manufacturer
  pushU16(records, 1); // product=1 (Ironlog)
  pushU32(records, startTs);

  if (hasVolumeDevField) {
    // Developer Data ID (global msg 207) using local msg 4 (#123: field 3 is developer_data_index per FIT 2.0 spec)
    records.push(
      0x44, 0x00, 0x00,
      207, 0x00, // global msg 207 (developer_data_id)
      0x02,
      1, 16, 0x0d, // field 1: application_id (byte[16])
      3, 1, 0x02,  // field 3: developer_data_index (uint8)
    );
    records.push(0x04, ...IRONLOG_DEV_APP_ID, 0);

    // Field Description (global msg 206) for total_volume_kg (scaled ×10, units "kg") on Session (18)
    // #123: fit_base_type_id for uint32 MUST include endianness flag 0x80 -> 0x86 (134).
    records.push(
      0x45, 0x00, 0x00,
      206, 0x00, // global msg 206 (field_description)
      0x07,
      0, 1, 0x02,  // field 0: developer_data_index (uint8)
      1, 1, 0x02,  // field 1: field_definition_number (uint8)
      2, 1, 0x02,  // field 2: fit_base_type_id (uint8: 0x86 = 134 = uint32)
      3, 16, 0x07, // field 3: field_name (string[16])
      6, 1, 0x02,  // field 6: scale (uint8 = 10)
      8, 4, 0x07,  // field 8: units (string[4])
      14, 2, 0x84, // field 14: native_mesg_num (uint16 = 18 session)
    );
    records.push(0x05, 0, 0, 0x86);
    pushFixedString(records, "total_volume_kg", 16);
    records.push(10);
    pushFixedString(records, "kg", 4);
    pushU16(records, 18);
  }

  // 2) Local 1 -> Global 21 (event): timestamp(253 u32), event(0 enum=0 timer), event_type(1 enum=0 start / 4 stop_all)
  records.push(
    0x41, 0x00, 0x00,
    21, 0x00, // global msg 21 (event)
    0x03,
    253, 4, 0x86,
    0, 1, 0x00,
    1, 1, 0x00,
  );
  // Start timer event
  records.push(0x01);
  pushU32(records, startTs);
  records.push(0, 0);
  // Stop timer event
  records.push(0x01);
  pushU32(records, endTs);
  records.push(0, 4);

  // 2.5) Local 6 -> Global 19 (lap): required by Garmin FIT Activity File specification (#183, #237, #269)
  const elapsedMs = Math.min(0xfffffffe, elapsedDurationSec * 1000);
  const timerMs = Math.min(0xfffffffe, timerDurationSec * 1000);
  const lapFields: Array<[number, number, number]> = [
    [253, 4, 0x86], // timestamp
    [2, 4, 0x86],   // start_time
    [7, 4, 0x86],   // total_elapsed_time
    [8, 4, 0x86],   // total_timer_time
    [0, 1, 0x00],   // event (9 = lap)
    [1, 1, 0x00],   // event_type (1 = stop)
    [25, 1, 0x00],  // sport
    [39, 1, 0x00],  // sub_sport
  ];
  if (measuredDistanceCm !== null) lapFields.push([9, 4, 0x86]); // total_distance (cm, scale 100)
  records.push(
    0x46, 0x00, 0x00,
    19, 0x00, // global msg 19 (lap)
    lapFields.length,
    ...lapFields.flat(),
  );
  records.push(0x06);
  pushU32(records, endTs);
  pushU32(records, startTs);
  pushU32(records, elapsedMs);
  pushU32(records, timerMs);
  records.push(9, 1, sport, subSport);
  if (measuredDistanceCm !== null) pushU32(records, measuredDistanceCm);

  // 3) Local 2 -> Global 18 (session):
  // Standard fields: timestamp(253), start_time(2), total_elapsed_time(7), total_timer_time(8),
  // event(0=9 lap), event_type(1=1 stop), sport(5), sub_sport(6), num_laps(26=1)
  // Plus ONLY genuinely measured total_distance(9), total_calories(11) / total_work(48) if supplied,
  // plus FIT 2.0 developer field 0 (total_volume_kg) when totalVolumeKg > 0.
  const sessionStdFields: Array<[number, number, number]> = [
    [253, 4, 0x86],
    [2, 4, 0x86],
    [7, 4, 0x86],
    [8, 4, 0x86],
    [0, 1, 0x00],
    [1, 1, 0x00],
    [5, 1, 0x00],
    [6, 1, 0x00],
    [26, 2, 0x84],
  ];
  if (measuredDistanceCm !== null) sessionStdFields.push([9, 4, 0x86]);
  if (measuredCalories !== null) sessionStdFields.push([11, 2, 0x84]);
  if (measuredWorkJoules !== null) sessionStdFields.push([48, 4, 0x86]);

  records.push(
    hasVolumeDevField ? 0x62 : 0x42, // definition header for local msg 2 (+0x20 dev data flag)
    0x00,
    0x00,
    18, 0x00, // global msg 18 (session)
    sessionStdFields.length,
    ...sessionStdFields.flat(),
  );
  if (hasVolumeDevField) {
    records.push(
      1, // 1 developer field
      0, 4, 0, // field_def_num=0, size=4 bytes (uint32), developer_data_index=0
    );
  }
  records.push(0x02);
  pushU32(records, endTs);
  pushU32(records, startTs);
  pushU32(records, elapsedMs);
  pushU32(records, timerMs);
  records.push(9, 1); // event: lap, event_type: stop
  records.push(sport);
  records.push(subSport);
  pushU16(records, 1); // num_laps: 1
  if (measuredDistanceCm !== null) pushU32(records, measuredDistanceCm);
  if (measuredCalories !== null) pushU16(records, measuredCalories);
  if (measuredWorkJoules !== null) pushU32(records, measuredWorkJoules);
  if (hasVolumeDevField) pushU32(records, Math.min(0xfffffffe, Math.round(totalVolumeKg * 10)));

  // 4) Local 3 -> Global 34 (activity): timestamp(253 u32), total_timer_time(0 u32 ms), num_sessions(1 u16=1),
  // type(2 enum=0 manual), event(3 enum=26 activity), event_type(4 enum=1 stop)
  records.push(
    0x43, 0x00, 0x00,
    34, 0x00, // global msg 34 (activity)
    0x06,
    253, 4, 0x86,
    0, 4, 0x86,
    1, 2, 0x84,
    2, 1, 0x00,
    3, 1, 0x00,
    4, 1, 0x00,
  );
  records.push(0x03);
  pushU32(records, endTs);
  pushU32(records, timerMs);
  pushU16(records, 1);
  records.push(0, 26, 1);

  const dataBytes = new Uint8Array(records);
  const header = new Uint8Array(14);
  header[0] = 14; // header size
  header[1] = 0x20; // protocol version 2.0
  header[2] = 0x62; // profile version LSB (2146)
  header[3] = 0x08; // profile version MSB
  const dataSize = dataBytes.length;
  header[4] = dataSize & 0xff;
  header[5] = (dataSize >> 8) & 0xff;
  header[6] = (dataSize >> 16) & 0xff;
  header[7] = (dataSize >> 24) & 0xff;
  header[8] = 0x2e; // '.'
  header[9] = 0x46; // 'F'
  header[10] = 0x49; // 'I'
  header[11] = 0x54; // 'T'
  const headerCrc = computeFitCrc(header, 0, 12);
  header[12] = headerCrc & 0xff;
  header[13] = (headerCrc >> 8) & 0xff;

  const full = new Uint8Array(14 + dataBytes.length + 2);
  full.set(header, 0);
  full.set(dataBytes, 14);
  const fileCrc = computeFitCrc(full, 0, 14 + dataBytes.length);
  full[14 + dataBytes.length] = fileCrc & 0xff;
  full[14 + dataBytes.length + 1] = (fileCrc >> 8) & 0xff;
  return full;
}
