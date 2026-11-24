import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { AiSettingsCard } from "../components/ai/AiSettingsCard";
import type { AiStatus } from "../components/ai/AiModals";
import { apiFetch } from "../lib/api";
import { openAppleShortcutCreator, triggerAppleFitnessLaunch, triggerAppleHubAction } from "../lib/apple-fitness";
import { today } from "../lib/date";
import { EQUIPMENT, INTERVALS, type EquipmentKey, type PeriodDays, type ProfileGoals } from "../lib/domain";
import { createRestAudio, triggerHaptic } from "../lib/haptics-audio";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import {
  ALL_PLATES,
  BAR_PRESETS,
  DEFAULT_APPLE_CARDIO_SHORTCUT,
  DEFAULT_APPLE_HUB_SHORTCUT,
  DEFAULT_APPLE_STRENGTH_SHORTCUT,
  PROFILE_VERSION_EVENT,
  readWorkoutPreferences,
  REST_SOUND_PRESETS,
  REST_STEP_PRESETS,
  WARMUP_REST_PRESETS,
  WARMUP_SCHEMES,
  WEIGHT_STEP_PRESETS,
  WORKOUT_PREFS_EVENT,
  writeWorkoutPreference,
  type AppleFitnessLaunchMode,
  type WorkoutPreferences,
} from "../lib/workout-helpers";
import {
  openBackupRestoreModal,
  openCsvImportModal,
  openDeviceSetupModal,
  openHealthDataImportModal,
  openHealthDataWebhookModal,
  openIssueApiTokenModal,
  openOnboardingModal,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore, type SettingsTab } from "../store/useUiStore";

const PANEL_NAMES: Record<string, string> = {
  load: "训练趋势",
  muscle: "肌群分布",
  consistency: "训练日历",
  strength: "动作进步",
  weight: "体重趋势",
  nutrition: "饮食趋势",
  apple: "Apple 健康",
  feeling: "训练体感",
};
const PRIMARY_OVERVIEW_PANELS = new Set(["load", "muscle", "strength", "weight"]);
const ALL_EQUIP_KEYS: EquipmentKey[] = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "kettlebell",
  "band",
  "weighted",
];
const EQUIP_PRESET_MAP: Record<"gym" | "home" | "bodyweight", EquipmentKey[]> = {
  gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
  home: ["dumbbell", "bodyweight", "band"],
  bodyweight: ["bodyweight"],
};

interface PreferencesRes {
  revision: number;
  days: PeriodDays;
  includeWarmups: boolean;
  panels: string[];
}

interface AppleDeviceToken {
  id: string;
  label: string;
  expiresAt: string;
}

interface ApiTokenItem {
  id: string;
  label: string;
  createdAt?: string;
  expiresAt?: string | null;
}

export function SettingsView() {
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const demo = useAuthStore((s) => s.demo);
  const demoToken = useAuthStore((s) => s.demoToken);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);
  const logout = useAuthStore((s) => s.logout);

  const settingsTab = useUiStore((s) => s.settingsTab);
  const setSettingsTab = useUiStore((s) => s.setSettingsTab);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const openConfirm = useUiStore((s) => s.openConfirm);
  const notify = useUiStore((s) => s.notify);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workoutPrefs, setWorkoutPrefs] = useState<WorkoutPreferences>(() => readWorkoutPreferences());
  const [hubShortcutInput, setHubShortcutInput] = useState(
    () => readWorkoutPreferences().appleHubShortcutName,
  );
  const [strengthShortcutInput, setStrengthShortcutInput] = useState(
    () => readWorkoutPreferences().appleStrengthShortcutName,
  );
  const [cardioShortcutInput, setCardioShortcutInput] = useState(
    () => readWorkoutPreferences().appleCardioShortcutName,
  );
  const restAudio = useMemo(() => createRestAudio(() => true), []);

  useEffect(() => {
    setHubShortcutInput(workoutPrefs.appleHubShortcutName);
  }, [workoutPrefs.appleHubShortcutName]);

  useEffect(() => {
    setStrengthShortcutInput(workoutPrefs.appleStrengthShortcutName);
  }, [workoutPrefs.appleStrengthShortcutName]);

  useEffect(() => {
    setCardioShortcutInput(workoutPrefs.appleCardioShortcutName);
  }, [workoutPrefs.appleCardioShortcutName]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncPrefs = () => setWorkoutPrefs(readWorkoutPreferences());
    const syncVersion = (ev: Event) => {
      const nextVersion = (ev as CustomEvent<number>).detail;
      if (typeof nextVersion === "number") {
        setProfileVersion(nextVersion);
      }
    };
    window.addEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
    window.addEventListener(PROFILE_VERSION_EVENT, syncVersion);
    return () => {
      window.removeEventListener(WORKOUT_PREFS_EVENT, syncPrefs);
      window.removeEventListener(PROFILE_VERSION_EVENT, syncVersion);
    };
  }, []);

  const updateWorkoutPref = <K extends keyof WorkoutPreferences>(
    key: K,
    value: WorkoutPreferences[K],
    toastText?: string,
  ) => {
    writeWorkoutPreference(key, value);
    setWorkoutPrefs(readWorkoutPreferences());
    if (toastText) notify(toastText);
  };

  // Statistics form state
  const [prefRevision, setPrefRevision] = useState(0);
  const [prefDays, setPrefDays] = useState<PeriodDays>(30);
  const [includeWarmups, setIncludeWarmups] = useState(true);
  const [panelOrder, setPanelOrder] = useState<string[]>(Object.keys(PANEL_NAMES));
  const [selectedPanels, setSelectedPanels] = useState<Set<string>>(() => new Set(Object.keys(PANEL_NAMES)));
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError, setPrefError] = useState("");

  // Profile form state
  const [profileVersion, setProfileVersion] = useState(0);
  const [calories, setCalories] = useState("2200");
  const [protein, setProtein] = useState("150");
  const [carbs, setCarbs] = useState("240");
  const [fat, setFat] = useState("70");
  const [daysPerWeek, setDaysPerWeek] = useState("4");
  const [restSeconds, setRestSeconds] = useState("90");
  const [targetWeight, setTargetWeight] = useState("");
  const [equipment, setEquipment] = useState<Set<EquipmentKey>>(() => new Set(["barbell", "dumbbell", "machine"]));
  const [energyEnabled, setEnergyEnabled] = useState(false);
  const [energyDetailsOpen, setEnergyDetailsOpen] = useState(false);
  const [heightCm, setHeightCm] = useState("175");
  const [energyWeightKg, setEnergyWeightKg] = useState("70");
  const [weightDate, setWeightDate] = useState(() => today());
  const [birthDate, setBirthDate] = useState("1995-01-01");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [activityFactor, setActivityFactor] = useState("1.55");
  const [context, setContext] = useState("general");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileGoalObj, setProfileGoalObj] = useState<ProfileGoals | null>(null);

  // Devices / AI / Account
  const [devices, setDevices] = useState<AppleDeviceToken[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [apiTokens, setApiTokens] = useState<ApiTokenItem[]>([]);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState("");

  useEffect(() => {
    let active = true;
    const applySettings = ([prefs, profRes, devs, ai, toks]: [
      PreferencesRes,
      { version: number; profile: ProfileGoals },
      AppleDeviceToken[],
      AiStatus,
      ApiTokenItem[],
    ]) => {
      setPrefRevision(prefs.revision);
      setPrefDays(prefs.days);
      setIncludeWarmups(Boolean(prefs.includeWarmups));
      const chosen = new Set(prefs.panels);
      setSelectedPanels(chosen);
      setPanelOrder([...prefs.panels, ...Object.keys(PANEL_NAMES).filter((id) => !chosen.has(id))]);

      const g = profRes.profile;
      setProfileVersion(profRes.version);
      setProfileGoalObj(g);
      setCalories(String(g.calories ?? 2200));
      setProtein(String(g.protein ?? 150));
      setCarbs(String(g.carbs ?? 240));
      setFat(String(g.fat ?? 70));
      setDaysPerWeek(String(g.daysPerWeek ?? 4));
      setRestSeconds(String(g.restSeconds ?? 90));
      setTargetWeight(g.targetWeight != null ? String(g.targetWeight) : "");
      setEquipment(new Set((g.equipment ?? ["barbell", "dumbbell", "machine"]) as EquipmentKey[]));
      const ep = g.energyProfile;
      setEnergyEnabled(Boolean(ep));
      setEnergyDetailsOpen(Boolean(ep));
      if (ep) {
        setHeightCm(String(ep.heightCm));
        setEnergyWeightKg(String(ep.weightKg));
        setWeightDate(ep.weightDate ?? today());
        setBirthDate(ep.birthDate);
        setSex(ep.sex);
        setActivityFactor(String(ep.activityFactor));
        setContext(ep.context);
      }

      setDevices(devs);
      setAiStatus(ai);
      setApiTokens(toks);
    };

    const cachedSettings = peekQuery<[
      PreferencesRes,
      { version: number; profile: ProfileGoals },
      AppleDeviceToken[],
      AiStatus,
      ApiTokenItem[],
    ]>("view:settings", userId)?.data;

    if (cachedSettings) {
      applySettings(cachedSettings);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");
    void Promise.all([
      cachedApiFetch<PreferencesRes>("/api/web/preferences", { epoch: dataEpoch, userId }),
      cachedApiFetch<{ version: number; profile: ProfileGoals }>("/api/web/profile", { epoch: dataEpoch, userId }),
      cachedApiFetch<AppleDeviceToken[]>("/api/integrations/apple-health/tokens", { epoch: dataEpoch, userId }).catch(() => []),
      cachedApiFetch<AiStatus>("/api/ai/status", { epoch: dataEpoch, userId }).catch(() => ({ ready: false, mode: "unconfigured" as const, model: null })),
      cachedApiFetch<ApiTokenItem[]>("/api/tokens", { epoch: dataEpoch, userId }).catch(() => []),
    ])
      .then((bundle) => {
        if (!active) return;
        writeQueryCache("view:settings", bundle, { userId, epoch: dataEpoch });
        applySettings(bundle);
      })
      .catch((err) => {
        if (active) setError((err as Error)?.message || "加载设置失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  if (loading && !profileGoalObj) {
    return (
      <div className="empty loading" role="status">
        正在读取个人目标与系统设置…
      </div>
    );
  }

  if (error && !profileGoalObj) {
    return (
      <div className="empty">
        <strong>设置加载失败</strong>
        <p>{error}</p>
        <button type="button" className="primary-button" onClick={bumpDataEpoch}>
          重试
        </button>
      </div>
    );
  }

  const visiblePanelOrder = appleHealthConnected ? panelOrder : panelOrder.filter((id) => id !== "apple");
  const persistentTokens = apiTokens.filter((t) => !t.expiresAt);

  const reorderPanel = (panelId: string, dir: -1 | 1) => {
    const idx = visiblePanelOrder.indexOf(panelId);
    const nextIdx = idx + dir;
    if (idx < 0 || nextIdx < 0 || nextIdx >= visiblePanelOrder.length) return;
    const nextVisible = [...visiblePanelOrder];
    [nextVisible[idx], nextVisible[nextIdx]] = [nextVisible[nextIdx]!, nextVisible[idx]!];
    const nextFull = appleHealthConnected
      ? nextVisible
      : [...nextVisible, ...(panelOrder.includes("apple") ? ["apple"] : [])];
    setPanelOrder(nextFull);
  };

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefError("");
    const panels = panelOrder.filter((id) => selectedPanels.has(id));
    if (!panels.length) {
      setPrefError("至少保留一张统计卡片。");
      return;
    }
    setPrefSaving(true);
    try {
      const updated = await apiFetch<PreferencesRes>("/api/web/preferences", {
        method: "PUT",
        body: { revision: prefRevision, days: prefDays, includeWarmups, panels },
      });
      setPrefRevision(updated.revision);
      bumpDataEpoch();
      notify("统计设置已保存");
    } catch (err) {
      setPrefError((err as Error)?.message || "保存统计设置失败");
    } finally {
      setPrefSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    setProfileSaving(true);
    try {
      const updated = await apiFetch<{ version: number; profile: ProfileGoals }>("/api/web/profile", {
        method: "PUT",
        body: {
          calories: Number(calories),
          protein: Number(protein),
          carbs: Number(carbs),
          fat: Number(fat),
          daysPerWeek: Number(daysPerWeek),
          restSeconds: Number(restSeconds),
          targetWeight: targetWeight.trim() ? Number(targetWeight) : null,
          equipment: [...equipment],
          energyProfile: energyEnabled
            ? {
                heightCm: Number(heightCm),
                weightKg: Number(energyWeightKg),
                weightDate,
                birthDate,
                sex,
                context,
                activityFactor: Number(activityFactor),
              }
            : null,
          version: profileVersion,
          opId: crypto.randomUUID(),
        },
      });
      setProfileVersion(updated.version);
      setProfileGoalObj(updated.profile);
      bumpDataEpoch();
      notify("目标与器械配置已保存");
    } catch (err) {
      setProfileError((err as Error)?.message || "保存目标失败");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError("");
    if (newPassword !== confirmPassword) {
      setPwdError("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < 10 || /[^A-Za-z0-9]/.test(newPassword)) {
      setPwdError("新密码需为 10–128 位英文字母和数字");
      return;
    }
    setPwdSaving(true);
    try {
      await apiFetch("/api/web/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify("登录密码已更新");
    } catch (err) {
      setPwdError((err as Error)?.message || "更新密码失败");
    } finally {
      setPwdSaving(false);
    }
  };

  const handleRevokeDevice = (dev: AppleDeviceToken) => {
    openConfirm({
      title: "撤销设备令牌",
      message: `确定要撤销设备「${dev.label}」的上传令牌吗？撤销后对应捷径将无法上传数据。`,
      confirmLabel: "撤销设备",
      onConfirm: async () => {
        await apiFetch(`/api/integrations/apple-health/tokens/${encodeURIComponent(dev.id)}`, { method: "DELETE" });
        setDevices((prev) => prev.filter((d) => d.id !== dev.id));
        bumpDataEpoch();
        notify("已撤销设备令牌");
      },
    });
  };

  const handleRevokeApiToken = (tok: ApiTokenItem) => {
    openConfirm({
      title: "撤销访问令牌",
      message: `确定撤销 API / MCP 令牌「${tok.label}」吗？`,
      confirmLabel: "撤销令牌",
      onConfirm: async () => {
        await apiFetch(`/api/tokens/${encodeURIComponent(tok.id)}`, { method: "DELETE" });
        setApiTokens((prev) => prev.filter((t) => t.id !== tok.id));
        notify("已撤销访问令牌");
      },
    });
  };

  const handleExportCsv = async (kind: "workouts" | "diet" | "weight" | "measurements") => {
    try {
      const response = await fetch(`/api/web/export-csv/${encodeURIComponent(kind)}`, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          ...(demoToken ? { Authorization: `Bearer ${demoToken}` } : {}),
          ...(userId ? { "X-Ironlog-Account": userId } : {}),
        },
        cache: "no-store",
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? "导出 CSV 失败");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ironlog-${kind}-${today()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      notify((err as Error)?.message || "导出 CSV 失败");
    }
  };

  const handleExportJson = async () => {
    try {
      const data = await apiFetch<unknown>("/api/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `ironlog-${today()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      notify((err as Error)?.message || "导出备份失败");
    }
  };

  const handleLogout = () => {
    openConfirm({
      title: "退出登录",
      message: "确定要退出当前铁记账号吗？未同步的离线记录将保存在本地等待下次同步。",
      confirmLabel: "退出账号",
      onConfirm: async () => {
        await logout();
      },
    });
  };

  return (
    <>
      <header className="page-heading">
        <div>
          <h1>设置</h1>
        </div>
      </header>

      <div className="settings-layout">
        <div className="page-sections settings-sections" role="group" aria-label="设置分类">
          <div className="segments">
            {(
              [
                ["statistics", "统计与布局"],
                ["profile", "目标与器械"],
                ["devices", "Apple 健康"],
                ["ai", "AI 助手"],
                ["account", "账号与数据"],
              ] as ReadonlyArray<readonly [SettingsTab, string]>
            ).map(([tabId, label]) => (
              <button key={tabId} type="button" aria-pressed={settingsTab === tabId} onClick={() => setSettingsTab(tabId)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-content">
          {settingsTab === "statistics" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>统计布局与口径</h2>
              </header>
              <form className="settings-form" onSubmit={(e) => void handleSavePrefs(e)}>
                <label className="field">
                  <span>默认统计周期</span>
                  <select value={String(prefDays)} onChange={(e) => setPrefDays(Number(e.target.value) as PeriodDays)}>
                    {INTERVALS.map((i) => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="toggle-row">
                  <input
                    className="switch"
                    type="checkbox"
                    checked={includeWarmups}
                    onChange={(e) => setIncludeWarmups(e.target.checked)}
                  />
                  <span>
                    热身组计入完成组数与容量
                    <small className="muted">最高重量与估算 1RM 仍只统计工作组</small>
                  </span>
                </label>

                <section className="form-section">
                  <h3 className="form-section-title">显示卡片与顺序</h3>
                  <p className="muted panel-order-hint">主区 4 张核心图卡常驻首页，其余已启用卡片收进首页底部「更多数据」折叠区。</p>
                  <div className="panel-options">
                    {visiblePanelOrder.map((id, position) => (
                      <div key={id} className="panel-option-row">
                        <label className="toggle-inline">
                          <input
                            className="switch"
                            type="checkbox"
                            checked={selectedPanels.has(id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSelectedPanels((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(id);
                                else next.delete(id);
                                return next;
                              });
                            }}
                          />
                          <span>{PANEL_NAMES[id]}</span>
                          <em className="panel-slot-tag">{PRIMARY_OVERVIEW_PANELS.has(id) ? "首页主区" : "更多数据"}</em>
                        </label>
                        <div className="panel-option-order">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`上移${PANEL_NAMES[id]}`}
                            disabled={position === 0}
                            onClick={() => reorderPanel(id, -1)}
                          >
                            <Icon name="arrowUp" size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`下移${PANEL_NAMES[id]}`}
                            disabled={position === visiblePanelOrder.length - 1}
                            onClick={() => reorderPanel(id, 1)}
                          >
                            <Icon name="arrowDown" size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <p className="form-error" role="alert" hidden={!prefError}>
                  {prefError}
                </p>
                <footer className="form-foot">
                  <button type="submit" className="primary-button" disabled={prefSaving}>
                    {prefSaving ? "保存中…" : "保存设置"}
                  </button>
                </footer>
              </form>
            </section>
          ) : null}

          {settingsTab === "profile" ? (
            <>
            <section className="panel">
              <header className="panel-head">
                <h2>训练与饮食目标</h2>
              </header>
              <form className="settings-form" onSubmit={(e) => void handleSaveProfile(e)}>
                <section className="form-section">
                  <h3 className="form-section-title">饮食目标</h3>
                  <div className="fields">
                    {(
                      [
                        ["每日热量", "kcal", calories, setCalories, 1, 20000],
                        ["每日蛋白质", "g", protein, setProtein, 0, 100000],
                        ["每日碳水", "g", carbs, setCarbs, 0, 100000],
                        ["每日脂肪", "g", fat, setFat, 0, 100000],
                      ] as const
                    ).map(([label, unit, val, setter, min, max]) => (
                      <label key={label} className="field">
                        <span>{label}</span>
                        <div className="input-group">
                          <input
                            type="number"
                            inputMode="decimal"
                            min={min}
                            max={max}
                            step="any"
                            required
                            value={val}
                            onChange={(e) => setter(e.target.value)}
                          />
                          <span>{unit}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="form-section">
                  <h3 className="form-section-title">训练与体重</h3>
                  <div className="fields">
                    <label className="field">
                      <span>每周训练</span>
                      <div className="input-group">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={7}
                          step={1}
                          required
                          value={daysPerWeek}
                          onChange={(e) => setDaysPerWeek(e.target.value)}
                        />
                        <span>天</span>
                      </div>
                    </label>
                    <label className="field">
                      <span>默认休息</span>
                      <div className="input-group">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={900}
                          step={1}
                          required
                          value={restSeconds}
                          onChange={(e) => setRestSeconds(e.target.value)}
                        />
                        <span>秒</span>
                      </div>
                    </label>
                    <label className="field">
                      <span>目标体重</span>
                      <div className="input-group">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={500}
                          step="any"
                          value={targetWeight}
                          onChange={(e) => setTargetWeight(e.target.value)}
                        />
                        <span>kg</span>
                      </div>
                    </label>
                  </div>
                </section>

                <details className="settings-accordion">
                  <summary>
                    <span>我的训练器械</span>
                    <span className="settings-accordion-meta">
                      已选 {equipment.size} 项
                      <Icon name="chevron" size={14} />
                    </span>
                  </summary>
                  <div className="settings-accordion-body">
                    <small className="muted">保存后，训练编辑器的「我的器械」筛选会优先展示匹配的动作。</small>
                    <div className="equip-presets">
                      <button type="button" className="quiet" onClick={() => setEquipment(new Set(EQUIP_PRESET_MAP.gym))}>
                        商业健身房
                      </button>
                      <button type="button" className="quiet" onClick={() => setEquipment(new Set(EQUIP_PRESET_MAP.home))}>
                        居家哑铃
                      </button>
                      <button type="button" className="quiet" onClick={() => setEquipment(new Set(EQUIP_PRESET_MAP.bodyweight))}>
                        徒手街头
                      </button>
                    </div>
                    <div className="equip-check-grid">
                      {ALL_EQUIP_KEYS.map((eqKey) => (
                        <label key={eqKey} className="equip-check-pill">
                          <input
                            type="checkbox"
                            checked={equipment.has(eqKey)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setEquipment((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(eqKey);
                                else next.delete(eqKey);
                                return next;
                              });
                            }}
                          />
                          <span>{EQUIPMENT[eqKey] ?? eqKey}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </details>

                <details
                  className="settings-accordion"
                  open={energyDetailsOpen}
                  onToggle={(e) => setEnergyDetailsOpen(e.currentTarget.open)}
                >
                  <summary>
                    <span>能量估算资料</span>
                    <span className="settings-accordion-meta">
                      {energyEnabled ? "已开启" : "未开启"}
                      <Icon name="chevron" size={14} />
                    </span>
                  </summary>
                  <div className="settings-accordion-body">
                    <label className="toggle-row">
                      <input
                        className="switch"
                        type="checkbox"
                        checked={energyEnabled}
                        onChange={(e) => setEnergyEnabled(e.target.checked)}
                      />
                      <span>启用能量估算</span>
                    </label>
                    <fieldset className="form-fieldset" disabled={!energyEnabled}>
                      <div className="fields">
                        <label className="field">
                          <span>身高</span>
                          <div className="input-group">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={50}
                              max={250}
                              step={0.1}
                              required
                              value={heightCm}
                              onChange={(e) => setHeightCm(e.target.value)}
                            />
                            <span>cm</span>
                          </div>
                        </label>
                        <label className="field">
                          <span>参考体重</span>
                          <div className="input-group">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={1}
                              max={500}
                              step={0.01}
                              required
                              value={energyWeightKg}
                              onChange={(e) => setEnergyWeightKg(e.target.value)}
                            />
                            <span>kg</span>
                          </div>
                        </label>
                        <label className="field">
                          <span>测量日期</span>
                          <input type="date" max={today()} required value={weightDate} onChange={(e) => setWeightDate(e.target.value)} />
                        </label>
                        <label className="field">
                          <span>出生日期</span>
                          <input type="date" max={today()} required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                        </label>
                        <label className="field">
                          <span>性别</span>
                          <select value={sex} onChange={(e) => setSex(e.target.value as "male" | "female")}>
                            <option value="male">男</option>
                            <option value="female">女</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>活动系数</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.01}
                            min={1.4}
                            max={2.5}
                            required
                            value={activityFactor}
                            onChange={(e) => setActivityFactor(e.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span>生理状态</span>
                          <select value={context} onChange={(e) => setContext(e.target.value)}>
                            <option value="general">一般成人</option>
                            <option value="pregnant">妊娠期</option>
                            <option value="breastfeeding">哺乳期</option>
                          </select>
                        </label>
                      </div>
                    </fieldset>
                  </div>
                </details>

                <p className="form-error" role="alert" hidden={!profileError}>
                  {profileError}
                </p>
                <footer className="form-foot">
                  <button type="submit" className="primary-button" disabled={profileSaving}>
                    {profileSaving ? "保存中…" : "保存目标"}
                  </button>
                </footer>
              </form>
            </section>

            <section className="panel settings-workout-prefs-panel">
              <header className="panel-head">
                <div>
                  <h2>训练记录与器械偏好</h2>
                  <p className="muted panel-order-hint">
                    改动即时生效并云端同步，跨设备登录自动沿用，也可在训中随时修改。
                  </p>
                </div>
              </header>
              <div className="settings-form">
                <section className="form-section">
                  <h3 className="form-section-title">记录与自动联动</h3>
                  <div className="session-options">
                    <label className="switch-chip">
                      <span>默认同步后续组</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.autoSyncSubsequent}
                        onChange={(e) =>
                          updateWorkoutPref(
                            "autoSyncSubsequent",
                            e.target.checked,
                            e.target.checked ? "已开启默认同步后续组" : "已关闭默认同步后续组",
                          )
                        }
                      />
                    </label>
                    <label className="switch-chip">
                      <span>自动沿用上次重量</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.autoPrefillLast}
                        onChange={(e) =>
                          updateWorkoutPref(
                            "autoPrefillLast",
                            e.target.checked,
                            e.target.checked ? "已开启自动沿用上次重量" : "已关闭自动沿用上次重量",
                          )
                        }
                      />
                    </label>
                    <label className="switch-chip">
                      <span>完组自动跳下一动作</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.autoAdvanceExercise}
                        onChange={(e) =>
                          updateWorkoutPref(
                            "autoAdvanceExercise",
                            e.target.checked,
                            e.target.checked ? "已开启完组自动跳转下一动作" : "已关闭完组自动跳转",
                          )
                        }
                      />
                    </label>
                    <label className="switch-chip">
                      <span>显示 RIR 储备</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.showRir}
                        onChange={(e) => updateWorkoutPref("showRir", e.target.checked)}
                      />
                    </label>
                    <label className="switch-chip">
                      <span>杠铃配片实时提示</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.showPlateMath}
                        onChange={(e) => updateWorkoutPref("showPlateMath", e.target.checked)}
                      />
                    </label>
                  </div>
                </section>

                <section className="form-section">
                  <h3 className="form-section-title">休息计时与提醒</h3>
                  <div className="session-options">
                    <label className="switch-chip">
                      <span>完组自动倒计时</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.autoStartRestTimer}
                        onChange={(e) => updateWorkoutPref("autoStartRestTimer", e.target.checked)}
                      />
                    </label>
                    <label className="switch-chip">
                      <span>休息结束提示音</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.soundOn}
                        onChange={(e) => {
                          const next = e.target.checked;
                          updateWorkoutPref("soundOn", next);
                          if (next) restAudio.preview(workoutPrefs.soundStyle);
                        }}
                      />
                    </label>
                    <label className="switch-chip">
                      <span>触感震动反馈</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.hapticsOn}
                        onChange={(e) => {
                          const next = e.target.checked;
                          updateWorkoutPref("hapticsOn", next);
                          if (next) triggerHaptic("light");
                        }}
                      />
                    </label>
                    <label className="switch-chip">
                      <span>训练防息屏</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.screenAwake}
                        onChange={(e) => updateWorkoutPref("screenAwake", e.target.checked)}
                      />
                    </label>
                    <label className="switch-chip">
                      <span>到期通知</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.notifyRest}
                        onChange={(e) => {
                          const next = e.target.checked;
                          if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
                            void Notification.requestPermission();
                          }
                          updateWorkoutPref("notifyRest", next);
                        }}
                      />
                    </label>
                  </div>
                  {workoutPrefs.soundOn ? (
                    <div className="field">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>休息结束提示音色</span>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => restAudio.preview(workoutPrefs.soundStyle)}
                        >
                          试听
                        </button>
                      </div>
                      <div className="segments">
                        {REST_SOUND_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={workoutPrefs.soundStyle === preset.id}
                            onClick={() => {
                              updateWorkoutPref("soundStyle", preset.id);
                              restAudio.preview(preset.id);
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>

                <details className="settings-accordion">
                  <summary>
                    <span>热身时长、递增步长与杠铃配片</span>
                    <span className="settings-accordion-meta">
                      {workoutPrefs.barWeight}kg杆 · ±{workoutPrefs.weightStepKg}kg ·{" "}
                      {WARMUP_SCHEMES.find((s) => s.id === workoutPrefs.warmupScheme)?.label ?? ""}
                      <Icon name="chevron" size={14} />
                    </span>
                  </summary>
                  <div className="settings-accordion-body">
                    <div className="fields">
                      <div className="field">
                        <span>热身组休息时长</span>
                        <div className="segments">
                          {WARMUP_REST_PRESETS.map((sec) => (
                            <button
                              key={sec}
                              type="button"
                              aria-pressed={workoutPrefs.warmupRestSeconds === sec}
                              onClick={() => updateWorkoutPref("warmupRestSeconds", sec)}
                            >
                              {sec === 0 ? "免休" : `${sec}s`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="field">
                        <span>休息计时增减步长</span>
                        <div className="segments">
                          {REST_STEP_PRESETS.map((stepSec) => (
                            <button
                              key={stepSec}
                              type="button"
                              aria-pressed={workoutPrefs.restAdjustStep === stepSec}
                              onClick={() => updateWorkoutPref("restAdjustStep", stepSec)}
                            >
                              ±{stepSec}s
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="field">
                      <span>重量递增步长</span>
                      <div className="segments">
                        {WEIGHT_STEP_PRESETS.map((step) => (
                          <button
                            key={step}
                            type="button"
                            aria-pressed={workoutPrefs.weightStepKg === step}
                            onClick={() => updateWorkoutPref("weightStepKg", step, `默认递增步长已设为 ±${step}kg`)}
                          >
                            ±{step}kg
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <span>杠铃空杆规格</span>
                      <div className="segments">
                        {BAR_PRESETS.map(([bw, lbl]) => (
                          <button
                            key={bw}
                            type="button"
                            aria-pressed={workoutPrefs.barWeight === bw}
                            onClick={() => updateWorkoutPref("barWeight", bw, `杠铃空杆已设为 ${lbl}`)}
                          >
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <span>可用杠铃片（每侧自动配片）</span>
                      <div className="plate-chip-grid">
                        {ALL_PLATES.map((plate) => {
                          const active = workoutPrefs.enabledPlates.includes(plate);
                          return (
                            <button
                              key={plate}
                              type="button"
                              className="plate-chip"
                              aria-pressed={active}
                              onClick={() => {
                                if (active) {
                                  if (workoutPrefs.enabledPlates.length <= 1) {
                                    notify("至少保留一种杠铃片规格");
                                    return;
                                  }
                                  updateWorkoutPref(
                                    "enabledPlates",
                                    workoutPrefs.enabledPlates.filter((p) => p !== plate),
                                  );
                                } else {
                                  updateWorkoutPref("enabledPlates", [...workoutPrefs.enabledPlates, plate]);
                                }
                              }}
                            >
                              {plate}kg
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="field">
                      <span>热身组坡度方案</span>
                      <div className="segments">
                        {WARMUP_SCHEMES.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            aria-pressed={workoutPrefs.warmupScheme === item.id}
                            onClick={() => updateWorkoutPref("warmupScheme", item.id, `热身方案已切换为「${item.label}」`)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <small className="muted">
                        当前梯度：{WARMUP_SCHEMES.find((s) => s.id === workoutPrefs.warmupScheme)?.desc ?? ""}
                      </small>
                    </div>
                  </div>
                </details>
              </div>
            </section>
            </>
          ) : null}

          {settingsTab === "devices" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>Apple 健康</h2>
              </header>
              <div className="settings-form">
                {!appleHealthConnected ? (
                  <div className="apple-optin-banner">
                    <strong>暂未对接 Apple 健康</strong>
                    <small>
                      没有 Apple Watch 也能完整使用铁记，首页、数据分析、日历与徽章中的苹果健康模块已自动为你隐藏。日后如需同步，在下方导出快捷指令或导入数据即可自动开启。
                    </small>
                  </div>
                ) : null}

                <section className="form-section">
                  <h3 className="form-section-title">全能智能联动</h3>
                  <p className="muted">
                    1 个全能快捷指令整合开练打卡与跳转健身、完练回传心率热量与每日健康上传，可用网页在线签名免 Mac 导入。
                  </p>
                  <button type="button" className="primary-button settings-hero-cta" onClick={() => openDeviceSetupModal()}>
                    <Icon name="plus" size={16} /> 导出全能快捷指令（1 个文件）
                  </button>
                  <div className="settings-quick-grid">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        triggerHaptic("light");
                        triggerAppleFitnessLaunch("strength", { prefs: workoutPrefs, notify });
                      }}
                    >
                      <Icon name="heart" size={14} /> 开始传统力量
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        triggerHaptic("light");
                        triggerAppleFitnessLaunch("cardio", { prefs: workoutPrefs, notify });
                      }}
                    >
                      <Icon name="heart" size={14} /> 打开有氧健身
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        triggerHaptic("light");
                        triggerAppleHubAction("end", { prefs: workoutPrefs, notify });
                      }}
                    >
                      <Icon name="upload" size={14} /> 回传刚结束训练
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        triggerHaptic("light");
                        triggerAppleHubAction("daily", { prefs: workoutPrefs, notify });
                      }}
                    >
                      <Icon name="refresh" size={14} /> 同步今日健康
                    </button>
                  </div>
                </section>

                <section className="form-section">
                  <h3 className="form-section-title">自动跳转行为</h3>
                  <div className="session-options">
                    <label className="switch-chip">
                      <span>新建今日训练时自动跳转 Apple 健身</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.appleFitnessAutoLaunch}
                        onChange={(e) => updateWorkoutPref("appleFitnessAutoLaunch", e.target.checked)}
                      />
                    </label>
                  </div>
                  <small className="muted">
                    仅在 iPhone / iPad 上新建当日训练时生效，补录历史或恢复草稿不会触发。
                  </small>

                  <div className="field">
                    <span>力量训练</span>
                    <div className="segments">
                      {(
                        [
                          ["hub", "全能联动"],
                          ["shortcut", "独立快捷指令"],
                          ["fitness_app", "健身 App"],
                          ["off", "关闭"],
                        ] as ReadonlyArray<readonly [AppleFitnessLaunchMode, string]>
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={workoutPrefs.appleStrengthLaunch === mode}
                          onClick={() => updateWorkoutPref("appleStrengthLaunch", mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {workoutPrefs.appleStrengthLaunch === "shortcut" ? (
                    <div className="field">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>独立力量快捷指令名称</span>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            triggerAppleFitnessLaunch("strength", {
                              prefs: {
                                ...workoutPrefs,
                                appleStrengthShortcutName: strengthShortcutInput.trim() || DEFAULT_APPLE_STRENGTH_SHORTCUT,
                              },
                              notify,
                            })
                          }
                        >
                          测试跳转
                        </button>
                      </div>
                      <input
                        value={strengthShortcutInput}
                        maxLength={80}
                        placeholder={DEFAULT_APPLE_STRENGTH_SHORTCUT}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStrengthShortcutInput(val);
                          if (val.trim()) updateWorkoutPref("appleStrengthShortcutName", val.trim().slice(0, 80));
                        }}
                        onBlur={() => {
                          const normalized = strengthShortcutInput.trim().slice(0, 80) || DEFAULT_APPLE_STRENGTH_SHORTCUT;
                          setStrengthShortcutInput(normalized);
                          updateWorkoutPref("appleStrengthShortcutName", normalized);
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="field">
                    <span>有氧运动</span>
                    <div className="segments">
                      {(
                        [
                          ["fitness_app", "健身 App"],
                          ["hub", "全能联动"],
                          ["shortcut", "独立快捷指令"],
                          ["off", "关闭"],
                        ] as ReadonlyArray<readonly [AppleFitnessLaunchMode, string]>
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={workoutPrefs.appleCardioLaunch === mode}
                          onClick={() => updateWorkoutPref("appleCardioLaunch", mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {workoutPrefs.appleCardioLaunch === "shortcut" ? (
                    <div className="field">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>独立有氧快捷指令名称</span>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            triggerAppleFitnessLaunch("cardio", {
                              prefs: {
                                ...workoutPrefs,
                                appleCardioShortcutName: cardioShortcutInput.trim() || DEFAULT_APPLE_CARDIO_SHORTCUT,
                              },
                              notify,
                            })
                          }
                        >
                          测试跳转
                        </button>
                      </div>
                      <input
                        value={cardioShortcutInput}
                        maxLength={80}
                        placeholder={DEFAULT_APPLE_CARDIO_SHORTCUT}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCardioShortcutInput(val);
                          if (val.trim()) updateWorkoutPref("appleCardioShortcutName", val.trim().slice(0, 80));
                        }}
                        onBlur={() => {
                          const normalized = cardioShortcutInput.trim().slice(0, 80) || DEFAULT_APPLE_CARDIO_SHORTCUT;
                          setCardioShortcutInput(normalized);
                          updateWorkoutPref("appleCardioShortcutName", normalized);
                        }}
                      />
                    </div>
                  ) : null}

                  <details className="settings-accordion">
                    <summary>
                      <span>快捷指令名称与导入说明</span>
                      <span className="settings-accordion-meta">
                        <span>{hubShortcutInput.trim() || DEFAULT_APPLE_HUB_SHORTCUT}</span>
                        <Icon name="chevron" size={14} />
                      </span>
                    </summary>
                    <div className="settings-accordion-body">
                      <div className="field">
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span>全能快捷指令名称</span>
                          <button
                            type="button"
                            className="quiet"
                            onClick={() =>
                              triggerAppleHubAction("daily", {
                                prefs: {
                                  ...workoutPrefs,
                                  appleHubShortcutName: hubShortcutInput.trim() || DEFAULT_APPLE_HUB_SHORTCUT,
                                },
                                notify,
                              })
                            }
                          >
                            测试唤起同步
                          </button>
                        </div>
                        <input
                          value={hubShortcutInput}
                          maxLength={80}
                          placeholder={DEFAULT_APPLE_HUB_SHORTCUT}
                          onChange={(e) => {
                            const val = e.target.value;
                            setHubShortcutInput(val);
                            if (val.trim()) updateWorkoutPref("appleHubShortcutName", val.trim().slice(0, 80));
                          }}
                          onBlur={() => {
                            const normalized = hubShortcutInput.trim().slice(0, 80) || DEFAULT_APPLE_HUB_SHORTCUT;
                            setHubShortcutInput(normalized);
                            updateWorkoutPref("appleHubShortcutName", normalized);
                          }}
                        />
                      </div>
                      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 13 }}>
                        <li>
                          点击上方 <b>「导出全能快捷指令（1 个文件）」</b> → 选「通用安全模板」下载 <code>.shortcut</code> → 用{" "}
                          <a href="https://sign.shortcuty.app" target="_blank" rel="noopener noreferrer">
                            sign.shortcuty.app
                          </a>{" "}
                          或 Mac 签名导入 iPhone，按弹窗粘贴地址与令牌即可完成绑定。
                        </li>
                        <li>
                          如希望在点击力量训练时直接跳过「健身」App 启动 Apple Watch「传统力量训练」：可在全能快捷指令{" "}
                          <code>strength</code> 分支末尾将「打开 URL」替换为 <strong>「开始体能训练 → 传统力量训练」</strong>，或切到「独立快捷指令」并点下方新建名为{" "}
                          <strong>{strengthShortcutInput.trim() || DEFAULT_APPLE_STRENGTH_SHORTCUT}</strong> 的快捷指令。
                        </li>
                      </ol>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button type="button" className="secondary-button" onClick={() => openAppleShortcutCreator(notify)}>
                          去快捷指令新建
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            triggerAppleFitnessLaunch("cardio", {
                              prefs: workoutPrefs,
                              forceMode: "fitness_app",
                              notify,
                            })
                          }
                        >
                          直接打开苹果健身 App
                        </button>
                      </div>
                    </div>
                  </details>
                </section>

                <section className="form-section">
                  <h3 className="form-section-title">Health Data Export</h3>
                  <p className="muted">导入已有体能训练，或连接 iPhone 定时同步。</p>
                  <div className="health-import-actions">
                    <button type="button" className="secondary-button" onClick={() => openHealthDataImportModal()}>
                      导入训练 JSON
                    </button>
                    <button type="button" className="secondary-button" onClick={() => openHealthDataWebhookModal()}>
                      设置自动同步
                    </button>
                  </div>
                </section>

                <section className="form-section">
                  <h3 className="form-section-title">已绑定上传设备</h3>
                  {devices.length ? (
                    <ul className="device-list">
                      {devices.map((device) => (
                        <li key={device.id}>
                          <span>
                            <strong>{device.label}</strong>
                            <small>{device.expiresAt.slice(0, 10)} 到期</small>
                          </span>
                          <button type="button" className="quiet" onClick={() => handleRevokeDevice(device)}>
                            撤销
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">暂未添加设备。</p>
                  )}
                  <details className="settings-accordion">
                    <summary>
                      <span>查看接口地址</span>
                      <span className="settings-accordion-meta">
                        3 个接口
                        <Icon name="chevron" size={14} />
                      </span>
                    </summary>
                    <div className="settings-accordion-body">
                      <p className="device-endpoint">
                        <code>{typeof location !== "undefined" ? location.origin : ""}/api/integrations/apple-health/daily</code>
                      </p>
                      <p className="device-endpoint">
                        <code>{typeof location !== "undefined" ? location.origin : ""}/api/integrations/apple-health/events</code>
                      </p>
                      <p className="device-endpoint">
                        <code>{typeof location !== "undefined" ? location.origin : ""}/api/integrations/apple-health/workouts</code>
                      </p>
                    </div>
                  </details>
                </section>
              </div>
            </section>
          ) : null}

          {settingsTab === "ai" ? <AiSettingsCard status={aiStatus} /> : null}

          {settingsTab === "account" ? (
            <section className="panel">
              <header className="panel-head">
                <h2>账号与数据</h2>
              </header>
              <div className="settings-form">
                <div className="settings-account-bar">
                  <div>
                    <strong>{demo ? "演示账号" : username || "已登录铁记"}</strong>
                    <small className="muted" style={{ display: "block" }}>
                      {demo ? "当前为演示模式，修改仅保留在本次会话。" : "账号已同步云端"}
                    </small>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openOnboardingModal({ currentProfile: profileGoalObj, initialStep: 1 })}
                    >
                      <Icon name="book" size={14} /> 新手指南
                    </button>
                    <button type="button" className="quiet" onClick={handleLogout}>
                      退出账号
                    </button>
                  </div>
                </div>

                <section className="form-section csv-export-section">
                  <h3 className="form-section-title">数据备份与迁移</h3>
                  <p className="muted">全量 JSON 支持跨实例完整备份恢复；CSV 可直接用 Excel / WPS 打开分析。</p>
                  <div className="settings-backup-grid">
                    <button type="button" className="secondary-button" onClick={() => void handleExportJson()}>
                      <Icon name="download" size={14} /> 导出全量 JSON
                    </button>
                    <button type="button" className="secondary-button" onClick={() => openBackupRestoreModal()}>
                      <Icon name="upload" size={14} /> 恢复全量 JSON
                    </button>
                    <button type="button" className="secondary-button" onClick={() => openCsvImportModal()}>
                      <Icon name="upload" size={14} /> 导入历史 CSV
                    </button>
                  </div>
                  <div className="csv-export-grid">
                    <button type="button" className="secondary-button" onClick={() => void handleExportCsv("workouts")}>
                      <Icon name="download" size={14} /> 训练记录 CSV
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleExportCsv("diet")}>
                      <Icon name="download" size={14} /> 饮食记录 CSV
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleExportCsv("weight")}>
                      <Icon name="download" size={14} /> 体重记录 CSV
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void handleExportCsv("measurements")}>
                      <Icon name="download" size={14} /> 身体围度 CSV
                    </button>
                  </div>
                </section>

                {!demo && username ? (
                  <details className="settings-accordion">
                    <summary>
                      <span>修改登录密码</span>
                      <span className="settings-accordion-meta">
                        登录安全
                        <Icon name="chevron" size={14} />
                      </span>
                    </summary>
                    <div className="settings-accordion-body">
                      <p className="muted">密码需为 10–128 位英文字母或数字。修改后其他设备的旧登录会话将自动失效。</p>
                      <form className="settings-form" onSubmit={(e) => void handleChangePassword(e)}>
                        <div className="fields">
                          <label className="field">
                            <span>当前密码</span>
                            <input
                              type="password"
                              autoComplete="current-password"
                              minLength={1}
                              maxLength={128}
                              required
                              placeholder="输入当前登录密码"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span>新密码</span>
                            <input
                              type="password"
                              autoComplete="new-password"
                              minLength={10}
                              maxLength={128}
                              pattern="[A-Za-z0-9]{10,128}"
                              required
                              placeholder="至少 10 位字母或数字"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span>确认新密码</span>
                            <input
                              type="password"
                              autoComplete="new-password"
                              minLength={10}
                              maxLength={128}
                              pattern="[A-Za-z0-9]{10,128}"
                              required
                              placeholder="再次输入新密码"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                          </label>
                        </div>
                        <p className="form-error" role="alert" hidden={!pwdError}>
                          {pwdError}
                        </p>
                        <footer className="form-foot">
                          <button type="submit" className="secondary-button" disabled={pwdSaving}>
                            {pwdSaving ? "更新中…" : "更新登录密码"}
                          </button>
                        </footer>
                      </form>
                    </div>
                  </details>
                ) : null}

                <details className="settings-accordion api-tokens-section">
                  <summary>
                    <span>MCP 与 API 访问令牌</span>
                    <span className="settings-accordion-meta">
                      {persistentTokens.length} 个有效
                      <Icon name="chevron" size={14} />
                    </span>
                  </summary>
                  <div className="settings-accordion-body">
                    <p className="muted">
                      用于连接 Claude Desktop / Cursor MCP 服务（<code>IRONLOG_TOKEN</code>）或脚本调用 REST API。令牌仅在生成时完整展示一次。
                    </p>
                    <div className="health-import-actions">
                      <button type="button" className="secondary-button" onClick={() => openIssueApiTokenModal()}>
                        <Icon name="plus" size={14} /> 生成 MCP / API 令牌
                      </button>
                    </div>
                    {persistentTokens.length ? (
                      <ul className="device-list">
                        {persistentTokens.map((tok) => (
                          <li key={tok.id}>
                            <span>
                              <strong>{tok.label}</strong>
                              <small>创建于 {(tok.createdAt ?? "").slice(0, 10)} · 永久有效</small>
                            </span>
                            <button type="button" className="quiet" onClick={() => handleRevokeApiToken(tok)}>
                              撤销
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">暂未生成 MCP / API 访问令牌。</p>
                    )}
                  </div>
                </details>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
