import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import {
  APPLE_CARDIO_PRESETS,
  APPLE_STRENGTH_PRESETS,
  getAppleCardioPreset,
  getAppleStrengthPreset,
  openAppleShortcutCreator,
  readLastCardioPreset,
  resolveCardioShortcutName,
  resolveStrengthShortcutName,
  triggerAppleCardioLaunch,
  triggerAppleHubAction,
  triggerAppleStrengthLaunch,
  type AppleCardioPresetId,
  type AppleStrengthPresetId,
} from "../../lib/apple-fitness";
import { copyText } from "../../lib/clipboard";
import { triggerHaptic } from "../../lib/haptics-audio";
import {
  WORKOUT_PREFS_EVENT,
  readWorkoutPreferences,
  writeWorkoutPreference,
  type AppleFitnessLaunchMode,
} from "../../lib/workout-helpers";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

const LAUNCH_MODES: ReadonlyArray<readonly [AppleFitnessLaunchMode, string]> = [
  ["shortcut", "按项目直开"],
  ["hub", "全能联动"],
  ["fitness_app", "仅开健身App"],
];

export function CardioLauncherModal({
  initialTab = "cardio",
  initialPresetId,
  initialStrengthPresetId,
  onOpenDeviceSetup,
}: {
  initialTab?: "cardio" | "strength";
  initialPresetId?: AppleCardioPresetId;
  initialStrengthPresetId?: AppleStrengthPresetId;
  onOpenDeviceSetup?: () => void;
}) {
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const updateTopModalTitle = useUiStore((s) => s.updateTopModalTitle);
  const notify = useUiStore((s) => s.notify);
  const [tab, setTab] = useState<"cardio" | "strength">(initialTab);
  const [prefs, setPrefs] = useState(() => readWorkoutPreferences());
  const [lastPreset] = useState<AppleCardioPresetId | null>(() => readLastCardioPreset());
  const [selectedId, setSelectedId] = useState<AppleCardioPresetId>(
    () => initialPresetId ?? readLastCardioPreset() ?? "outdoor_run",
  );
  const [selectedStrengthId, setSelectedStrengthId] = useState<AppleStrengthPresetId>(
    () => initialStrengthPresetId ?? "traditional_strength",
  );
  const [setupOpen, setSetupOpen] = useState(() => initialTab === "strength");
  const [copiedName, setCopiedName] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setPrefs(readWorkoutPreferences());
    window.addEventListener(WORKOUT_PREFS_EVENT, sync);
    return () => window.removeEventListener(WORKOUT_PREFS_EVENT, sync);
  }, []);

  const isStrength = tab === "strength";
  const selectedCardio = getAppleCardioPreset(selectedId) ?? APPLE_CARDIO_PRESETS[0]!;
  const selectedStrength = getAppleStrengthPreset(selectedStrengthId) ?? APPLE_STRENGTH_PRESETS[0]!;
  const selected = isStrength ? selectedStrength : selectedCardio;

  const mode = isStrength ? prefs.appleStrengthLaunch : prefs.appleCardioLaunch;
  const prefKey = isStrength ? "appleStrengthLaunch" : "appleCardioLaunch";
  const shortcutName = isStrength
    ? resolveStrengthShortcutName(selectedStrength, prefs.appleStrengthShortcutName)
    : resolveCardioShortcutName(selectedCardio, prefs.appleCardioShortcutName);
  const hubParam = isStrength
    ? selectedStrength.id === "traditional_strength"
      ? "strength"
      : selectedStrength.id === "functional_strength"
        ? "strength:functional"
        : "strength:core"
    : `cardio:${selectedCardio.id}`;

  const handleTabChange = (nextTab: "cardio" | "strength") => {
    triggerHaptic("light");
    setTab(nextTab);
    updateTopModalTitle(nextTab === "strength" ? "启动 Apple 力量训练" : "选择有氧方式");
  };

  const handleModeChange = (nextMode: AppleFitnessLaunchMode) => {
    triggerHaptic("light");
    writeWorkoutPreference(prefKey, nextMode);
    setPrefs(readWorkoutPreferences());
  };

  const handleSelectCardio = (presetId: AppleCardioPresetId) => {
    triggerHaptic("light");
    setSelectedId(presetId);
    const preset = getAppleCardioPreset(presetId) ?? APPLE_CARDIO_PRESETS[0]!;
    if (prefs.appleCardioLaunch === "shortcut" || prefs.appleCardioLaunch === "fitness_app") {
      void apiFetch("/api/integrations/apple-health/session-start", {
        method: "POST",
        body: { activityType: preset.activityType, environment: preset.environment },
      }).catch(() => {});
    }
    const res = triggerAppleCardioLaunch(presetId, { prefs, notify });
    if (res.launched) {
      closeTopModal();
    }
  };

  const handleSelectStrength = (presetId: AppleStrengthPresetId) => {
    triggerHaptic("light");
    setSelectedStrengthId(presetId);
    const preset = getAppleStrengthPreset(presetId) ?? APPLE_STRENGTH_PRESETS[0]!;
    if (prefs.appleStrengthLaunch === "shortcut" || prefs.appleStrengthLaunch === "fitness_app") {
      void apiFetch("/api/integrations/apple-health/session-start", {
        method: "POST",
        body: { activityType: preset.activityType, environment: preset.environment },
      }).catch(() => {});
    }
    const res = triggerAppleStrengthLaunch(presetId, { prefs, notify });
    if (res.launched) {
      closeTopModal();
    }
  };

  return (
    <div className="dialog-form cardio-launcher">
      <div className="segments" role="group" aria-label="选择运动类别">
        <button type="button" aria-pressed={tab === "cardio"} onClick={() => handleTabChange("cardio")}>
          有氧方式
        </button>
        <button type="button" aria-pressed={tab === "strength"} onClick={() => handleTabChange("strength")}>
          力量训练
        </button>
      </div>

      <div className="field">
        <span>跳转方式</span>
        <div className="segments" role="group" aria-label={isStrength ? "选择力量跳转方式" : "选择有氧跳转方式"}>
          {LAUNCH_MODES.map(([itemMode, label]) => (
            <button
              key={itemMode}
              type="button"
              aria-pressed={mode === itemMode}
              onClick={() => handleModeChange(itemMode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="cardio-mode-note">
        {mode === "shortcut" ? (
          <p className="muted">
            点击下方项目，直接运行对应快捷指令（如 <code>{shortcutName}</code>）跳过健身首页立即开练。
          </p>
        ) : mode === "hub" ? (
          <p className="muted">
            点击下方项目，通过全能快捷指令上报 <code>{selected.label}</code> 开练事件并按对应分支启动。
          </p>
        ) : (
          <div className="cardio-mode-warn">
            <p className="muted">
              受 iOS 限制，直接跳健身 App 只能打开首页。切换到「按项目直开」或「全能联动」配好快捷指令后，点选即可直接开练。
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                handleModeChange("shortcut");
                setSetupOpen(true);
              }}
            >
              切到按项目直开
            </button>
          </div>
        )}
      </div>

      {isStrength ? (
        <div className="cardio-preset-grid" role="group" aria-label="选择力量训练方式">
          {APPLE_STRENGTH_PRESETS.map((preset) => {
            const isSelected = preset.id === selectedStrength.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`cardio-preset-card${isSelected ? " is-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectStrength(preset.id)}
              >
                <div className="cardio-preset-head">
                  <strong>{preset.label}</strong>
                </div>
                <small>{preset.subtitle}</small>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="cardio-preset-grid" role="group" aria-label="选择有氧方式">
          {APPLE_CARDIO_PRESETS.map((preset) => {
            const isSelected = preset.id === selectedCardio.id;
            const isLast = preset.id === lastPreset;
            return (
              <button
                key={preset.id}
                type="button"
                className={`cardio-preset-card${isSelected ? " is-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectCardio(preset.id)}
              >
                <div className="cardio-preset-head">
                  <strong>{preset.label}</strong>
                  {isLast ? <span className="cardio-last-tag">上次</span> : null}
                </div>
                <small>{preset.subtitle}</small>
              </button>
            );
          })}
        </div>
      )}

      <details
        className="settings-accordion"
        open={setupOpen}
        onToggle={(e) => setSetupOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <span>
            直开设置：{selected.label} → Apple 健身「{selected.appleWorkoutLabel}」
          </span>
          <span className="settings-accordion-meta">
            <span>配置指引</span>
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="settings-accordion-body cardio-setup-box">
          {mode === "hub" ? (
            <>
              <div className="cardio-setup-meta">
                <span>全能快捷指令</span>
                <code className="cardio-setup-name">{prefs.appleHubShortcutName}</code>
                <span>传入参数</span>
                <code className="cardio-setup-name">{hubParam}</code>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                全能快捷指令内置对应分支（自动上报开始事件）；在该分支末尾把「打开 Fitness」换成
                <strong>「开始体能训练 → {selected.appleWorkoutLabel}」</strong>即可 1 步直开。
              </p>
              <div className="cardio-setup-actions">
                {onOpenDeviceSetup ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      triggerHaptic("light");
                      onOpenDeviceSetup();
                    }}
                  >
                    <Icon name="download" size={15} /> 导出新版全能快捷指令
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="cardio-setup-meta">
                <span>快捷指令名称</span>
                <code className="cardio-setup-name">{shortcutName}</code>
              </div>
              <ol className="shortcut-steps" style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  打开 iPhone 快捷指令，添加动作 <b>「开始体能训练」</b> → 选 <b>「{selected.appleWorkoutLabel}」</b> · 开放式目标；
                </li>
                <li>
                  将快捷指令改名为 <code>{shortcutName}</code> 点完成即可（以后点对应项目自动直接开始）。
                </li>
              </ol>
              <div className="cardio-setup-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    triggerHaptic("light");
                    void copyText(shortcutName).then((ok) => {
                      if (ok) setCopiedName(shortcutName);
                      notify(ok ? `已复制「${shortcutName}」` : `请手动复制：${shortcutName}`);
                    });
                  }}
                >
                  <Icon name="copy" size={15} /> {copiedName === shortcutName ? "已复制名称" : "复制指令名"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    triggerHaptic("light");
                    openAppleShortcutCreator(notify);
                  }}
                >
                  <Icon name="plus" size={15} /> 去快捷指令新建
                </button>
              </div>
            </>
          )}
        </div>
      </details>

      <footer>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            triggerHaptic("light");
            triggerAppleHubAction("end", { prefs, notify });
          }}
        >
          <Icon name="upload" size={14} /> 完练回传数据
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            triggerHaptic("light");
            if (isStrength) {
              triggerAppleStrengthLaunch(selectedStrength.id, { prefs, forceMode: "fitness_app", notify });
            } else {
              triggerAppleCardioLaunch(selectedCardio.id, { prefs, forceMode: "fitness_app", notify });
            }
          }}
        >
          仅打开健身 App
        </button>
        <button type="button" className="secondary-button" onClick={closeTopModal}>
          关闭
        </button>
      </footer>
    </div>
  );
}
