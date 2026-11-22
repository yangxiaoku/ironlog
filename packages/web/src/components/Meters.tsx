export function DotMeter({
  ratio,
  count = 16,
  label = "",
}: {
  ratio: number;
  count?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const lit = clamped > 0 ? Math.max(1, Math.round(clamped * count)) : 0;

  return (
    <span
      className="dot-meter"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i < lit ? "lit" : undefined} />
      ))}
    </span>
  );
}

export function ThinMeter({ ratio, label = "" }: { ratio: number; label?: string }) {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  const pct = clamped > 0 ? Math.max(4, Math.round(clamped * 1000) / 10) : 0;

  return (
    <span
      className="thin-meter"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

export function DotPlayIcon({ size = 24 }: { size?: number }) {
  const points: ReadonlyArray<readonly [number, number]> = [
    [7.7, 5.6], [7.7, 8.8], [7.7, 12.0], [7.7, 15.2], [7.7, 18.4],
    [10.7, 7.2], [10.7, 10.4], [10.7, 13.6], [10.7, 16.8],
    [13.7, 8.8], [13.7, 12.0], [13.7, 15.2],
    [16.7, 10.4], [16.7, 13.6],
    [19.7, 12.0],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {points.map(([cx, cy], idx) => (
        <circle key={idx} cx={cx} cy={cy} r={1.08} />
      ))}
    </svg>
  );
}

export function DotCheckIcon({ size = 24 }: { size?: number }) {
  const points: ReadonlyArray<readonly [number, number]> = [
    [5.2, 12.5], [7.4, 14.7], [9.6, 16.9],
    [11.8, 14.7], [14.0, 12.5], [16.2, 10.3], [18.4, 8.1],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {points.map(([cx, cy], idx) => (
        <circle key={idx} cx={cx} cy={cy} r={1.1} />
      ))}
    </svg>
  );
}
