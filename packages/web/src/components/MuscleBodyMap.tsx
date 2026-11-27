import type { MuscleKey } from "../lib/domain";
import { MUSCLES } from "../lib/domain";

export type BodyMapDisplayMode = "heat" | "retention";

export interface MuscleBodyMapProps {
  /** Normalized 0..1 intensity (heat mode) or 0.5..1.0 retention (retention mode) per muscle */
  scores: Partial<Record<MuscleKey, number>>;
  mode?: BodyMapDisplayMode;
  size?: "mini" | "sm" | "md";
  selectedMuscle?: MuscleKey | "";
  onSelectMuscle?: (muscle: MuscleKey) => void;
  showLabels?: boolean;
  className?: string;
}

const CLICKABLE_MUSCLES: MuscleKey[] = ["chest", "back", "shoulders", "arms", "core", "legs"];

function fillForMuscle(
  muscle: MuscleKey,
  scores: Partial<Record<MuscleKey, number>>,
  mode: BodyMapDisplayMode,
  selected: MuscleKey | "",
): { fill: string; opacity: number; stroke?: string } {
  const val = scores[muscle];
  const isSelected = selected === muscle;

  if (mode === "retention") {
    if (val == null) return { fill: "var(--line-strong, #3a3d45)", opacity: 0.35 };
    if (val >= 0.88) return { fill: "#22c55e", opacity: 0.88, ...(isSelected ? { stroke: "#ffffff" } : {}) };
    if (val >= 0.68) return { fill: "#f59e0b", opacity: 0.82, ...(isSelected ? { stroke: "#ffffff" } : {}) };
    return { fill: "#ef4444", opacity: 0.72, ...(isSelected ? { stroke: "#ffffff" } : {}) };
  }

  if (isSelected) {
    return { fill: "var(--accent, #22c55e)", opacity: 0.96, stroke: "var(--ink, #111)" };
  }
  if (val == null || val <= 0) {
    return { fill: "var(--line-strong, rgba(128,128,128,0.28))", opacity: 0.42 };
  }
  const clamped = Math.min(1, Math.max(0.24, val));
  return { fill: "var(--accent, #22c55e)", opacity: Number((0.28 + clamped * 0.68).toFixed(2)) };
}

/**
 * Clean dual-silhouette (Front + Back) anatomical SVG muscle map reusable across:
 * 1. Today's workout & Plan routine mini silhouettes
 * 2. Live Workout "本次练到哪里" muscle set progress sheet
 * 3. Exercise Library interactive muscle filter
 * 4. Analytics muscle strength-retention heatmap
 */
export function MuscleBodyMap({
  scores,
  mode = "heat",
  size = "sm",
  selectedMuscle = "",
  onSelectMuscle,
  showLabels = false,
  className = "",
}: MuscleBodyMapProps) {
  const interactive = typeof onSelectMuscle === "function";
  const dims =
    size === "mini"
      ? { w: 72, h: 46 }
      : size === "sm"
        ? { w: 164, h: 112 }
        : { w: 236, h: 164 };

  const styleOf = (m: MuscleKey) => fillForMuscle(m, scores, mode, selectedMuscle);

  const partProps = (m: MuscleKey) => ({
    className: `body-map-zone${interactive ? " is-clickable" : ""}${selectedMuscle === m ? " is-selected" : ""}`,
    role: interactive ? ("button" as const) : undefined,
    tabIndex: interactive ? 0 : undefined,
    "aria-label": `${MUSCLES[m] ?? m}`,
    "aria-pressed": interactive ? selectedMuscle === m : undefined,
    onClick: interactive
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          onSelectMuscle(m);
        }
      : undefined,
    onKeyDown: interactive
      ? (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onSelectMuscle(m);
          }
        }
      : undefined,
  });

  const chest = styleOf("chest");
  const back = styleOf("back");
  const shoulders = styleOf("shoulders");
  const arms = styleOf("arms");
  const core = styleOf("core");
  const legs = styleOf("legs");

  return (
    <div className={`muscle-body-map size-${size}${interactive ? " is-interactive" : ""}${className ? ` ${className}` : ""}`}>
      <svg
        viewBox="0 0 220 156"
        width={dims.w}
        height={dims.h}
        role="img"
        aria-label="正背面人体肌群分布图"
      >
        {/* === FRONT SILHOUETTE (centered x=55) === */}
        <g transform="translate(0, 2)">
          {/* Head & neck */}
          <circle cx="55" cy="14" r="9.5" fill="var(--line-strong, #888)" opacity="0.34" />
          <rect x="50" y="23" width="10" height="6" rx="2.5" fill="var(--line-strong, #888)" opacity="0.3" />

          {/* Shoulders (Front Delts) */}
          <g {...partProps("shoulders")}>
            <path d="M35 31 C28 32 25 38 26 45 L34 45 L36 33 Z" fill={shoulders.fill} fillOpacity={shoulders.opacity} stroke={shoulders.stroke} strokeWidth={shoulders.stroke ? 1.5 : 0} />
            <path d="M75 31 C82 32 85 38 84 45 L76 45 L74 33 Z" fill={shoulders.fill} fillOpacity={shoulders.opacity} stroke={shoulders.stroke} strokeWidth={shoulders.stroke ? 1.5 : 0} />
            <title>肩部</title>
          </g>

          {/* Chest (Pectorals) */}
          <g {...partProps("chest")}>
            <path d="M37 32 L54 32 L54 51 C46 52 38 49 36 44 Z" fill={chest.fill} fillOpacity={chest.opacity} stroke={chest.stroke} strokeWidth={chest.stroke ? 1.5 : 0} />
            <path d="M73 32 L56 32 L56 51 C64 52 72 49 74 44 Z" fill={chest.fill} fillOpacity={chest.opacity} stroke={chest.stroke} strokeWidth={chest.stroke ? 1.5 : 0} />
            <title>胸部</title>
          </g>

          {/* Core (Abs & Obliques) */}
          <g {...partProps("core")}>
            <rect x="43" y="53" width="24" height="27" rx="5" fill={core.fill} fillOpacity={core.opacity} stroke={core.stroke} strokeWidth={core.stroke ? 1.5 : 0} />
            <path d="M38 52 L42 54 L42 77 L39 75 Z" fill={core.fill} fillOpacity={core.opacity * 0.85} />
            <path d="M72 52 L68 54 L68 77 L71 75 Z" fill={core.fill} fillOpacity={core.opacity * 0.85} />
            <title>核心</title>
          </g>

          {/* Arms (Biceps & Forearms) */}
          <g {...partProps("arms")}>
            <path d="M26 46 L34 46 L32 66 L25 65 Z" fill={arms.fill} fillOpacity={arms.opacity} stroke={arms.stroke} strokeWidth={arms.stroke ? 1.4 : 0} />
            <path d="M24 67 L31 67 L28 85 L22 84 Z" fill={arms.fill} fillOpacity={arms.opacity * 0.82} />
            <path d="M84 46 L76 46 L78 66 L85 65 Z" fill={arms.fill} fillOpacity={arms.opacity} stroke={arms.stroke} strokeWidth={arms.stroke ? 1.4 : 0} />
            <path d="M86 67 L79 67 L82 85 L88 84 Z" fill={arms.fill} fillOpacity={arms.opacity * 0.82} />
            <title>手臂</title>
          </g>

          {/* Legs (Quads & Calves Front) */}
          <g {...partProps("legs")}>
            <path d="M39 81 L54 81 L52 114 L40 113 Z" fill={legs.fill} fillOpacity={legs.opacity} stroke={legs.stroke} strokeWidth={legs.stroke ? 1.5 : 0} />
            <path d="M71 81 L56 81 L58 114 L70 113 Z" fill={legs.fill} fillOpacity={legs.opacity} stroke={legs.stroke} strokeWidth={legs.stroke ? 1.5 : 0} />
            <path d="M41 116 L51 116 L49 144 L42 144 Z" fill={legs.fill} fillOpacity={legs.opacity * 0.82} />
            <path d="M69 116 L59 116 L61 144 L68 144 Z" fill={legs.fill} fillOpacity={legs.opacity * 0.82} />
            <title>腿部</title>
          </g>

          {showLabels ? (
            <text x="55" y="153" textAnchor="middle" fontSize="9" fill="var(--muted, #888)">
              正面
            </text>
          ) : null}
        </g>

        {/* === BACK SILHOUETTE (centered x=165) === */}
        <g transform="translate(110, 2)">
          {/* Head & neck */}
          <circle cx="55" cy="14" r="9.5" fill="var(--line-strong, #888)" opacity="0.34" />
          <rect x="50" y="23" width="10" height="6" rx="2.5" fill="var(--line-strong, #888)" opacity="0.3" />

          {/* Shoulders (Rear Delts) */}
          <g {...partProps("shoulders")}>
            <path d="M35 31 C28 32 25 38 26 45 L34 45 L36 33 Z" fill={shoulders.fill} fillOpacity={shoulders.opacity} stroke={shoulders.stroke} strokeWidth={shoulders.stroke ? 1.5 : 0} />
            <path d="M75 31 C82 32 85 38 84 45 L76 45 L74 33 Z" fill={shoulders.fill} fillOpacity={shoulders.opacity} stroke={shoulders.stroke} strokeWidth={shoulders.stroke ? 1.5 : 0} />
            <title>肩部</title>
          </g>

          {/* Back (Traps, Lats, Mid/Lower Back) */}
          <g {...partProps("back")}>
            <path d="M45 27 L65 27 L73 34 L72 56 L64 76 L46 76 L38 56 L37 34 Z" fill={back.fill} fillOpacity={back.opacity} stroke={back.stroke} strokeWidth={back.stroke ? 1.5 : 0} />
            <title>背部</title>
          </g>

          {/* Arms (Triceps & Forearms) */}
          <g {...partProps("arms")}>
            <path d="M26 46 L34 46 L32 66 L25 65 Z" fill={arms.fill} fillOpacity={arms.opacity} stroke={arms.stroke} strokeWidth={arms.stroke ? 1.4 : 0} />
            <path d="M24 67 L31 67 L28 85 L22 84 Z" fill={arms.fill} fillOpacity={arms.opacity * 0.82} />
            <path d="M84 46 L76 46 L78 66 L85 65 Z" fill={arms.fill} fillOpacity={arms.opacity} stroke={arms.stroke} strokeWidth={arms.stroke ? 1.4 : 0} />
            <path d="M86 67 L79 67 L82 85 L88 84 Z" fill={arms.fill} fillOpacity={arms.opacity * 0.82} />
            <title>手臂</title>
          </g>

          {/* Legs (Glutes, Hamstrings, Calves) */}
          <g {...partProps("legs")}>
            <path d="M39 78 L54 78 L54 93 C46 95 40 92 39 87 Z" fill={legs.fill} fillOpacity={legs.opacity} stroke={legs.stroke} strokeWidth={legs.stroke ? 1.4 : 0} />
            <path d="M71 78 L56 78 L56 93 C64 95 70 92 71 87 Z" fill={legs.fill} fillOpacity={legs.opacity} stroke={legs.stroke} strokeWidth={legs.stroke ? 1.4 : 0} />
            <path d="M40 94 L53 94 L51 115 L41 115 Z" fill={legs.fill} fillOpacity={legs.opacity * 0.92} />
            <path d="M70 94 L57 94 L59 115 L69 115 Z" fill={legs.fill} fillOpacity={legs.opacity * 0.92} />
            <path d="M41 117 L51 117 L49 144 L42 144 Z" fill={legs.fill} fillOpacity={legs.opacity * 0.82} />
            <path d="M69 117 L59 117 L61 144 L68 144 Z" fill={legs.fill} fillOpacity={legs.opacity * 0.82} />
            <title>腿部</title>
          </g>

          {showLabels ? (
            <text x="55" y="153" textAnchor="middle" fontSize="9" fill="var(--muted, #888)">
              背面
            </text>
          ) : null}
        </g>
      </svg>

      {interactive && showLabels ? (
        <div className="body-map-quick-chips" role="group" aria-label="快速切换肌群">
          {CLICKABLE_MUSCLES.map((m) => (
            <button
              key={m}
              type="button"
              className={`body-map-chip${selectedMuscle === m ? " is-active" : ""}`}
              aria-pressed={selectedMuscle === m}
              onClick={() => onSelectMuscle?.(m)}
            >
              {MUSCLES[m]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
