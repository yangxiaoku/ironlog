const numberFmtCache = new Map<number, Intl.NumberFormat>();
const weekdayFmt = new Intl.DateTimeFormat("zh-CN", {
  weekday: "long",
  timeZone: "Asia/Hong_Kong",
});
const ZH_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

export function fmt(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  let nf = numberFmtCache.get(digits);
  if (!nf) {
    nf = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits });
    numberFmtCache.set(digits, nf);
  }
  return nf.format(value);
}

/** Return current UTC+8 (Beijing) calendar date as `YYYY-MM-DD`. */
export function today(): string {
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function shortDate(iso: string): string {
  if (!iso || iso.length < 10) return iso || "";
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

export function duration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${fmt(seconds)} 秒`;
  if (seconds < 3600) return `${fmt(Math.round(seconds / 60))} 分钟`;
  return `${fmt(seconds / 3600, 1)} 小时`;
}

export function formatWeekdayZh(iso: string): string {
  if (!iso) return "";
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return ZH_WEEKDAYS[(day + 6) % 7] ?? "";
}

export function displayWeekday(iso: string): string {
  if (!iso) return "";
  return weekdayFmt.format(new Date(`${iso}T12:00:00+08:00`));
}

export function monthDays(ym: string): { beginning: number; days: number } {
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr) || new Date().getUTCFullYear();
  const m = Number(mStr) || 1;
  const first = new Date(Date.UTC(y, m - 1, 1));
  const beginning = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { beginning, days };
}

export function guessMeal(): "breakfast" | "lunch" | "snack" | "dinner" {
  const hour = new Date(Date.now() + 8 * 3_600_000).getUTCHours();
  return hour < 10 ? "breakfast" : hour < 14 ? "lunch" : hour < 17 ? "snack" : "dinner";
}
