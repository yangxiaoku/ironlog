import type { ReactNode } from "react";

export type IconName =
  | "overview"
  | "workout"
  | "plan"
  | "diet"
  | "calendar"
  | "exercises"
  | "weight"
  | "badges"
  | "settings"
  | "chevron"
  | "arrowUp"
  | "arrowDown"
  | "more"
  | "back"
  | "plus"
  | "close"
  | "play"
  | "pause"
  | "clock"
  | "dial"
  | "heart"
  | "check"
  | "sun"
  | "moon"
  | "search"
  | "refresh"
  | "bolt"
  | "trophy"
  | "trending"
  | "analytics"
  | "swap"
  | "rest"
  | "star"
  | "starFilled"
  | "copy"
  | "download"
  | "upload"
  | "print"
  | "bookmark"
  | "book";

const ICON_PATHS: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
    </>
  ),
  workout: <path d="m6 18 12-12M4 10l10 10m-4-16 10 10M2 12l4-4m2-2 4-4m0 20 4-4m2-2 4-4" />,
  plan: (
    <>
      <rect x="5" y="4" width="15" height="17" rx="2" />
      <path d="M3 8h4m-4 4h4m-4 4h4m4-7h5m-5 4h5m-5 4h4" />
    </>
  ),
  diet: <path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M17 21V3s-3 3-3 8h3" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4m8-4v4m-8 7h2m4 0h2m-8 3h2" />
    </>
  ),
  exercises: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9h10M7 15h10m-7-8v4m4 2v4" />
    </>
  ),
  weight: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M7 10a5 5 0 0 1 10 0m-5 1 2-3" />
    </>
  ),
  badges: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M9.5 14.5 8 22l4-2.2L16 22l-1.5-7.5" />
    </>
  ),
  settings: (
    <>
      <path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h5m4 0h9" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  arrowUp: <path d="m6 14 6-6 6 6" />,
  arrowDown: <path d="m6 10 6 6 6-6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  back: <path d="m15 6-6 6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12m0-12L6 18" />,
  play: <polygon points="6 4 20 12 6 20 6 4" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  dial: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 5v2m0 10v2M5 12h2m10 0h2m-7-2v2l2 2" />
    </>
  ),
  heart: <path d="M20.7 5.8a4.5 4.5 0 0 0-6.4 0L12 8.1 9.7 5.8a4.5 4.5 0 1 0-6.4 6.4L12 21l8.7-8.8a4.5 4.5 0 0 0 0-6.4Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 8a7 7 0 0 1 11-2l3 6M4 12l3 6a7 7 0 0 0 11-2" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  trophy: <path d="M6 4h12v4a6 6 0 0 1-12 0V4ZM6 6H3v2a3 3 0 0 0 3 3m12-5h3v2a3 3 0 0 1-3 3m-6 3v5m-4 3h8" />,
  trending: <path d="m3 17 6-6 4 4 8-8m0 0h-5m5 0v5" />,
  analytics: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 4 3 5-7" />
    </>
  ),
  swap: <path d="M7 16V4m0 0-3 3m3-3 3 3m7-1v12m0 0-3-3m3 3 3-3" />,
  rest: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
    </>
  ),
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  starFilled: (
    <polygon
      points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
      fill="currentColor"
    />
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" />,
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12" />,
  print: (
    <>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </>
  ),
  bookmark: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}
