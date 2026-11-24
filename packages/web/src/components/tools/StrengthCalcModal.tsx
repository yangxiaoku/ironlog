import { useEffect, useState } from "react";
import { fmt } from "../../lib/date";
import { estimated1RM } from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import {
  ALL_PLATES,
  WORKOUT_PREFS_EVENT,
  plateBreakdown,
  readWorkoutPreferences,
  writeWorkoutPreference,
} from "../../lib/workout-helpers";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

const CALC_BAR_PRESETS: ReadonlyArray<readonly [number, string]> = [
  [20, "20kg标杆"],
  [15, "15kg女杆"],
  [10, "10kg曲杆"],
  [25, "25kg六角"],
  [0, "0kg纯挂片"],
];

const KG_TO_LB = 2.20462262;
const PCT_ZONES: ReadonlyArray<readonly [number, string, number]> = [
  [100, "1 次", 1.0],
  [95, "2 次", 0.95],
  [90, "3–4 次", 0.9],
  [85, "5–6 次", 0.85],
  [80, "8 次", 0.8],
  [75, "10 次", 0.75],
  [70, "12 次", 0.7],
  [65, "15 次", 0.65],
  [60, "热身", 0.6],
];

export function StrengthCalcModal() {
  const closeAllModals = useUiStore((s) => s.closeAllModals);

  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [weightInput, setWeightInput] = useState("80");
  const [repsInput, setRepsInput] = useState("5");
  const [rir, setRir] = useState(0);
  const [targetInput, setTargetInput] = useState("80");
  const [barWeight, setBarWeight] = useState<number>(() => readWorkoutPreferences().barWeight);
  const [enabledPlates, setEnabledPlates] = useState<number[]>(() => readWorkoutPreferences().enabledPlates);
  const [activePct, setActivePct] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => {
      const next = readWorkoutPreferences();
      setBarWeight(next.barWeight);
      setEnabledPlates(next.enabledPlates);
    };
    window.addEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
  }, []);

  const rawW = Math.max(0, Number(weightInput) || 0);
  const wKg = unit === "lb" ? rawW / KG_TO_LB : rawW;
  const reps = Math.max(1, Math.min(15, Math.round(Number(repsInput) || 1)));
  const effReps = Math.max(1, Math.min(15, reps + Math.max(0, Math.min(4, rir))));
  const rmKg = estimated1RM(wKg, effReps);
  const rmRoundedKg = Math.round(rmKg * 10) / 10;
  const rmLb = Math.round(rmKg * KG_TO_LB * 10) / 10;

  const targetKg = Math.min(2000, Math.max(0, Number(targetInput) || 0));
  const bd = plateBreakdown(targetKg, barWeight, enabledPlates);

  const counts = new Map<number, number>();
  for (const p of bd.plates) counts.set(p, (counts.get(p) ?? 0) + 1);
  const breakdownText = bd.plates.length
    ? [...counts.entries()].map(([p, c]) => `${p}kg×${c}`).join(" + ")
    : "无需挂片（差额小于最小片）";
  const actualKg = Math.round((barWeight + bd.plates.reduce((s, p) => s + p * 2, 0)) * 100) / 100;
  const actualLb = Math.round(actualKg * KG_TO_LB * 10) / 10;

  const handleUnitChange = (next: "kg" | "lb") => {
    if (next === unit) return;
    triggerHaptic("light");
    const cur = Number(weightInput) || 0;
    const converted = next === "lb" ? Math.round(cur * KG_TO_LB * 2) / 2 : Math.round((cur / KG_TO_LB) * 2) / 2;
    setWeightInput(String(converted));
    setUnit(next);
  };

  const togglePlate = (plate: number) => {
    const exists = enabledPlates.includes(plate);
    if (exists && enabledPlates.length <= 1) return;
    triggerHaptic("light");
    const next = exists ? enabledPlates.filter((p) => p !== plate) : [...enabledPlates, plate].sort((a, b) => b - a);
    setEnabledPlates(next);
    writeWorkoutPreference("enabledPlates", next);
  };

  return (
    <div className="dialog-form calc-modal">
      <section className="calc-card" aria-label="1RM 估算与百分比负荷">
        <header className="calc-card-head">
          <div>
            <h3>估算 1RM 与百分比训练表</h3>
            <small>Epley + RIR 储备次修正 · 点击任意百分比自动带入下方配片</small>
          </div>
          <div className="segments calc-unit-seg" role="group" aria-label="重量单位">
            <button type="button" aria-pressed={unit === "kg"} onClick={() => handleUnitChange("kg")}>
              kg
            </button>
            <button type="button" aria-pressed={unit === "lb"} onClick={() => handleUnitChange("lb")}>
              lb
            </button>
          </div>
        </header>

        <div className="calc-inputs">
          <label className="field">
            <span>训练重量 ({unit})</span>
            <input
              id="calc-weight"
              type="number"
              inputMode="decimal"
              min={1}
              max={2000}
              step={0.5}
              value={weightInput}
              onChange={(e) => {
                setActivePct(null);
                setWeightInput(e.target.value);
              }}
            />
          </label>
          <label className="field">
            <span>完成次数</span>
            <input
              id="calc-reps"
              type="number"
              inputMode="numeric"
              min={1}
              max={15}
              step={1}
              value={repsInput}
              onChange={(e) => {
                setActivePct(null);
                setRepsInput(e.target.value);
              }}
            />
          </label>
          <label className="field">
            <span>RIR 余力</span>
            <select
              id="calc-rir"
              value={String(rir)}
              onChange={(e) => {
                setActivePct(null);
                setRir(Number(e.target.value) || 0);
              }}
            >
              <option value="0">0（力竭）</option>
              <option value="1">1 次余力</option>
              <option value="2">2 次余力</option>
              <option value="3">3 次余力</option>
              <option value="4">4 次余力</option>
            </select>
          </label>
        </div>

        <div className="calc-1rm-hero">
          {rmRoundedKg > 0 ? (
            <>
              <div className="calc-1rm-main">
                <span>估算极限 1RM</span>
                <strong>
                  {fmt(rmRoundedKg)} <small>kg</small>
                </strong>
              </div>
              <div className="calc-1rm-sub">
                <span>≈ {fmt(rmLb)} lb</span>
                {rir > 0 ? <span>按有效次数 {effReps} 次折算</span> : null}
              </div>
            </>
          ) : (
            <small className="muted">请输入有效重量与次数计算估算 1RM</small>
          )}
        </div>

        <div className="calc-pct-grid">
          {rmRoundedKg > 0
            ? PCT_ZONES.map(([pct, repTxt, ratio]) => {
                const loadKg = Math.max(2.5, Math.round((rmKg * ratio) / 2.5) * 2.5);
                return (
                  <button
                    key={pct}
                    type="button"
                    className={`calc-pct-btn${activePct === pct ? " is-active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setActivePct(pct);
                      setTargetInput(String(loadKg));
                    }}
                  >
                    <span className="calc-pct-top">
                      <b>{pct}%</b>
                      <small>{repTxt}</small>
                    </span>
                    <strong>{fmt(loadKg)} kg</strong>
                  </button>
                );
              })
            : null}
        </div>
      </section>

      <section className="calc-card" aria-label="杠铃可视化配片模拟器">
        <header className="calc-card-head">
          <div>
            <h3>杠铃可视化配片</h3>
            <small>与训练编辑器共享杠重与可用杠片库存设置</small>
          </div>
          <div className="calc-target-steppers">
            {([-10, -5, -2.5, 2.5, 5, 10] as const).map((delta) => (
              <button
                key={delta}
                type="button"
                className="stepper-pill"
                onClick={() => {
                  triggerHaptic("light");
                  const cur = Number(targetInput) || 0;
                  setActivePct(null);
                  setTargetInput(String(Math.max(0, Math.round((cur + delta) * 100) / 100)));
                }}
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
          </div>
        </header>

        <div className="calc-bar-controls">
          <label className="field">
            <span>目标总重 (kg)</span>
            <input
              id="calc-bar-target"
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step={0.5}
              value={targetInput}
              onChange={(e) => {
                setActivePct(null);
                setTargetInput(e.target.value);
              }}
            />
          </label>
          <div className="calc-bar-presets" role="group" aria-label="杠铃杆规格">
            {CALC_BAR_PRESETS.map(([w, lbl]) => (
              <button
                key={w}
                type="button"
                className="stepper-pill"
                aria-pressed={barWeight === w}
                onClick={() => {
                  triggerHaptic("light");
                  setBarWeight(w);
                  writeWorkoutPreference("barWeight", w);
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="calc-barbell-viz">
          {!bd.valid ? (
            <div className="calc-barbell-empty">
              <Icon name="workout" size={18} />
              <span>
                {targetKg > 0 && targetKg <= barWeight
                  ? `目标重 (${fmt(targetKg)} kg) 不高于当前杠重 (${barWeight} kg)，空杆或无需额外配片`
                  : "输入高于杠重的目标重量后，将在此展示两侧杠片装配图"}
              </span>
            </div>
          ) : (
            <div className="calc-barbell-stage" role="img" aria-label={`双侧配片示意图：每侧 ${breakdownText}`}>
              <div className="calc-sleeve left">
                {[...bd.plates].reverse().map((p, idx) => (
                  <i key={`l-${idx}`} className="calc-plate" data-plate={p} title={`${p} kg`}>
                    <span>{p}</span>
                  </i>
                ))}
                <span className="calc-collar" />
              </div>
              <div className="calc-bar-shaft">
                <span>{barWeight > 0 ? `${barWeight}kg杆` : "纯挂片"}</span>
              </div>
              <div className="calc-sleeve right">
                <span className="calc-collar" />
                {bd.plates.map((p, idx) => (
                  <i key={`r-${idx}`} className="calc-plate" data-plate={p} title={`${p} kg`}>
                    <span>{p}</span>
                  </i>
                ))}
              </div>
            </div>
          )}
        </div>

        {bd.valid ? (
          <div className="calc-plate-summary">
            <div className="calc-summary-row">
              <span>
                每侧装配：<b>{breakdownText}</b>（共 {fmt(bd.perSide, 2)} kg/侧）
              </span>
              <span>
                实得总重：<b>{fmt(actualKg, 2)} kg</b> <small>({fmt(actualLb)} lb)</small>
              </span>
            </div>
            {!bd.achievable ? (
              <p className="calc-remainder-warn">
                受当前可用杠片最小规格限制，每侧差 {fmt(bd.remainder, 2)} kg（可勾选 0.5kg / 1.25kg 小片）
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="calc-plate-inv">
          <span>可用单侧杠片 (kg)</span>
          <div className="plate-inv-pills" role="group" aria-label="可用杠片规格">
            {ALL_PLATES.map((p) => (
              <button
                key={p}
                type="button"
                className="stepper-pill"
                aria-pressed={enabledPlates.includes(p)}
                onClick={() => togglePlate(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer>
        <button type="button" className="primary-button" onClick={closeAllModals}>
          完成
        </button>
      </footer>
    </div>
  );
}
