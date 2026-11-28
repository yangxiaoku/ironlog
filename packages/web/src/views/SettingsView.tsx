import { useEffect, useMemo, useRef, useState } from "react";
import { BACKUP_REQUEST_TIMEOUT_MS } from "@ironlog/shared";
import { Icon } from "../components/Icon";
import { AiSettingsCard } from "../components/ai/AiSettingsCard";
import type { AiStatus } from "../components/ai/AiModals";
import { AppleAutomationCopyPanel, AppleSyncStatusCard } from "../components/apple/AppleHealthModals";
import { AccountSecurityAndEcosystemCards } from "../components/settings/AccountSecurityCards";
import { apiFetch } from "../lib/api";
import { triggerAppleHubAction } from "../lib/apple-fitness";
import { today } from "../lib/date";
import { EQUIPMENT, INTERVALS, type EquipmentKey, type PeriodDays, type ProfileGoals } from "../lib/domain";
import { createRestAudio, speakCue, triggerHaptic } from "../lib/haptics-audio";
import { cachedApiFetch, peekQuery, writeQueryCache } from "../lib/query-cache";
import {
  ALL_PLATES,
  BAR_PRESETS,
  DEFAULT_APPLE_HUB_SHORTCUT,
  DEFAULT_EQUIPMENT_PROFILES,
  PROFILE_VERSION_EVENT,
  readWorkoutPreferences,
  REST_SOUND_PRESETS,
  REST_STEP_PRESETS,
  WARMUP_REST_PRESETS,
  WARMUP_SCHEMES,
  WEIGHT_STEP_PRESETS,
  WORKOUT_LAYOUT_PRESETS,
  WORKOUT_PREFS_EVENT,
  writeWorkoutPreference,
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
  weight: "体重趋势",
  apple: "Apple 健康",
};
const PRIMARY_OVERVIEW_PANELS = new Set(["load", "muscle", "weight"]);
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
  scope?: "api" | "session";
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
  const restAudio = useMemo(() => createRestAudio(() => true), []);

  useEffect(() => {
    setHubShortcutInput(workoutPrefs.appleHubShortcutName);
  }, [workoutPrefs.appleHubShortcutName]);

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

  // Statistics form state (#206/#207: independent dirty state & edit sequence per form)
  const [prefRevision, setPrefRevision] = useState(0);
  const [savedPrefDays, setSavedPrefDays] = useState<PeriodDays>(30);
  const [prefDays, setPrefDays] = useState<PeriodDays>(30);
  const [includeWarmups, setIncludeWarmups] = useState(true);
  const [panelOrder, setPanelOrder] = useState<string[]>(Object.keys(PANEL_NAMES));
  const [selectedPanels, setSelectedPanels] = useState<Set<string>>(() => new Set(Object.keys(PANEL_NAMES)));
  const [prefDirty, setPrefDirty] = useState(false);
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefError, setPrefError] = useState("");
  const prefDirtyRef = useRef(false);
  const prefEditSeqRef = useRef(0);
  const markPrefDirty = () => {
    prefEditSeqRef.current += 1;
    prefDirtyRef.current = true;
    setPrefDirty(true);
  };

  // Profile form state (#206/#207: independent dirty state & edit sequence per form)
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
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileGoalObj, setProfileGoalObj] = useState<ProfileGoals | null>(null);
  const profileDirtyRef = useRef(false);
  const profileEditSeqRef = useRef(0);
  const markProfileDirty = () => {
    profileEditSeqRef.current += 1;
    profileDirtyRef.current = true;
    setProfileDirty(true);
  };
  const lastSettingsUserRef = useRef(userId);

  // Devices / AI / Account
  const [devices, setDevices] = useState<AppleDeviceToken[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [apiTokens, setApiTokens] = useState<ApiTokenItem[]>([]);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState("");

  useEffect(() => {
    let active = true;
    const userChanged = lastSettingsUserRef.current !== userId;
    lastSettingsUserRef.current = userId;
    if (userChanged) {
      prefDirtyRef.current = false;
      profileDirtyRef.current = false;
      setPrefDirty(false);
      setProfileDirty(false);
    }

    const applySettings = (
      [prefs, profRes, devs, ai, toks]: [
        PreferencesRes,
        { version: number; profile: ProfileGoals },
        AppleDeviceToken[],
        AiStatus,
        ApiTokenItem[],
      ],
      forceReset = false,
    ) => {
      setPrefRevision(prefs.revision);
      setSavedPrefDays(prefs.days);
      // #206/#207: Never wipe unsaved local edits in one form when another form triggers refresh
      if (forceReset || !prefDirtyRef.current) {
        setPrefDays(prefs.days);
        setIncludeWarmups(Boolean(prefs.includeWarmups));
        const validKnown = prefs.panels.filter((id) => id in PANEL_NAMES);
        const chosen = new Set(validKnown.length ? validKnown : Object.keys(PANEL_NAMES));
        setSelectedPanels(chosen);
        setPanelOrder([...validKnown, ...Object.keys(PANEL_NAMES).filter((id) => !validKnown.includes(id))]);
      }

      const g = profRes.profile;
      setProfileVersion(profRes.version);
      setProfileGoalObj(g);
      if (forceReset || !profileDirtyRef.current) {
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
      applySettings(cachedSettings, userChanged);
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
        applySettings(bundle, userChanged);
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
  const primaryPanelOrder = visiblePanelOrder.filter((id) => PRIMARY_OVERVIEW_PANELS.has(id));
  const morePanelOrder = visiblePanelOrder.filter((id) => !PRIMARY_OVERVIEW_PANELS.has(id));
  // #162: Display ALL API tokens (including expiring ones with scope === "api") so users can view & revoke them
  const persistentTokens = apiTokens.filter((t) => (t.scope ? t.scope === "api" : !t.expiresAt));

  const reorderPanel = (panelId: string, dir: -1 | 1) => {
    const groupList = PRIMARY_OVERVIEW_PANELS.has(panelId) ? primaryPanelOrder : morePanelOrder;
    const gIdx = groupList.indexOf(panelId);
    const targetId = groupList[gIdx + dir];
    if (gIdx < 0 || !targetId) return;
    const idx = visiblePanelOrder.indexOf(panelId);
    const nextIdx = visiblePanelOrder.indexOf(targetId);
    if (idx < 0 || nextIdx < 0) return;
    const nextVisible = [...visiblePanelOrder];
    [nextVisible[idx], nextVisible[nextIdx]] = [nextVisible[nextIdx]!, nextVisible[idx]!];
    const nextFull = appleHealthConnected
      ? nextVisible
      : [...nextVisible, ...(panelOrder.includes("apple") ? ["apple"] : [])];
    setPanelOrder(nextFull);
    markPrefDirty();
  };

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefError("");
    // #208: Validate at least 1 *currently visible* panel so hidden Apple panel cannot leave Overview empty
    const visibleSelected = visiblePanelOrder.filter((id) => selectedPanels.has(id));
    if (!visibleSelected.length) {
      setPrefError("至少保留一张当前可见的统计卡片。");
      return;
    }
    const panels = appleHealthConnected
      ? visibleSelected
      : [...visibleSelected, ...(selectedPanels.has("apple") ? ["apple"] : [])];
    const submitSeq = prefEditSeqRef.current;
    const submittedDays = prefDays;
    setPrefSaving(true);
    try {
      const updated = await apiFetch<PreferencesRes>("/api/web/preferences", {
        method: "PUT",
        body: { revision: prefRevision, days: submittedDays, includeWarmups, panels },
      });
      setPrefRevision(updated.revision);
      setSavedPrefDays(updated.days);
      // #207: If user edited fields while request was in flight, preserve their newer edits & keep dirty flag!
      const editedWhileSaving = prefEditSeqRef.current !== submitSeq;
      if (!editedWhileSaving) {
        prefDirtyRef.current = false;
        setPrefDirty(false);
      }
      bumpDataEpoch();
      notify(
        editedWhileSaving
          ? `已保存之前的设置（默认 ${updated.days} 天）；你刚做的新改动尚未保存，请再次点击保存`
          : `统计设置已保存（默认 ${updated.days} 天 · v${updated.revision}）`,
      );
    } catch (err) {
      setPrefError((err as Error)?.message || "保存统计设置失败");
    } finally {
      setPrefSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    const submitSeq = profileEditSeqRef.current;
    setProfileSaving(true);
    try {
      const currentProfiles = profileGoalObj?.equipmentProfiles?.length
        ? profileGoalObj.equipmentProfiles
        : DEFAULT_EQUIPMENT_PROFILES;
      const eqArr = [...equipment].sort();
      const matchedPreset = currentProfiles.find(
        (gp) =>
          gp.equipment.length === eqArr.length &&
          [...gp.equipment].sort().every((v, idx) => v === eqArr[idx]),
      );
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
          activeEquipmentProfileId: matchedPreset ? matchedPreset.id : null,
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
      const editedWhileSaving = profileEditSeqRef.current !== submitSeq;
      if (!editedWhileSaving) {
        profileDirtyRef.current = false;
        setProfileDirty(false);
      }
      bumpDataEpoch();
      notify(
        editedWhileSaving
          ? "已保存先前的目标配置；保存期间的新编辑已保留，请再次保存"
          : "目标与器械配置已保存",
      );
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
    if (newPassword.length < 10 || !/^[\x21-\x7E]+$/.test(newPassword)) {
      setPwdError("新密码需为 10–128 位英文字母、数字或常见符号（不含空格）");
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
      const data = await apiFetch<unknown>("/api/export", { timeout: BACKUP_REQUEST_TIMEOUT_MS });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
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
      message: "确认退出当前账号吗？本机草稿和离线记录会保留，重新登录同一账号后可以继续。",
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
              <header className="panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h2>统计布局与口径</h2>
                  <p className="muted" style={{ fontSize: 12 }}>
                    当前生效：默认近 {savedPrefDays} 天 · 配置 v{prefRevision}
                  </p>
                </div>
                {prefDirty ? (
                  <span className="atlas-pill is-caution" role="status">
                    有未保存更改
                  </span>
                ) : null}
              </header>
              <form className="settings-form" onSubmit={(e) => void handleSavePrefs(e)}>
                <label className="field">
                  <span>默认统计周期</span>
                  <select
                    value={String(prefDays)}
                    onChange={(e) => {
                      setPrefDays(Number(e.target.value) as PeriodDays);
                      markPrefDirty();
                    }}
                  >
                    {INTERVALS.map((i) => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="toggle-row">
                  <span>
                    热身组计入完成组数与容量
                    <small className="muted">最高重量与估算 1RM 仍只统计工作组</small>
                  </span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={includeWarmups}
                    onChange={(e) => {
                      setIncludeWarmups(e.target.checked);
                      markPrefDirty();
                    }}
                  />
                </label>

                <section className="form-section">
                  <h3 className="form-section-title">显示卡片与顺序</h3>
                  {(
                    [
                      ["首页主区", primaryPanelOrder],
                      ["更多数据", morePanelOrder],
                    ] as const
                  ).map(([groupTitle, groupIds]) => (
                    <div key={groupTitle} className="panel-group-block">
                      <h4 className="panel-group-heading">{groupTitle}</h4>
                      <div className="panel-options">
                        {groupIds.map((id, position) => (
                          <div key={id} className="panel-option-row">
                            <span className="panel-option-label">{PANEL_NAMES[id]}</span>
                            <div className="panel-option-controls">
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
                                  disabled={position === groupIds.length - 1}
                                  onClick={() => reorderPanel(id, 1)}
                                >
                                  <Icon name="arrowDown" size={16} />
                                </button>
                              </div>
                              <input
                                className="switch"
                                type="checkbox"
                                aria-label={PANEL_NAMES[id]}
                                checked={selectedPanels.has(id)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSelectedPanels((prev) => {
                                    const next = new Set(prev);
                                    if (checked) next.add(id);
                                    else next.delete(id);
                                    return next;
                                  });
                                  markPrefDirty();
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
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
              <header className="panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
                <h2>训练与饮食目标</h2>
                {profileDirty ? (
                  <span className="atlas-pill is-caution" role="status">
                    有未保存更改
                  </span>
                ) : null}
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
                            onChange={(e) => {
                              setter(e.target.value);
                              markProfileDirty();
                            }}
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
                          onChange={(e) => {
                            setDaysPerWeek(e.target.value);
                            markProfileDirty();
                          }}
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
                          onChange={(e) => {
                            setRestSeconds(e.target.value);
                            markProfileDirty();
                          }}
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
                          onChange={(e) => {
                            setTargetWeight(e.target.value);
                            markProfileDirty();
                          }}
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
                      <button type="button" className="quiet" onClick={() => { setEquipment(new Set(EQUIP_PRESET_MAP.gym)); markProfileDirty(); }}>
                        商业健身房
                      </button>
                      <button type="button" className="quiet" onClick={() => { setEquipment(new Set(EQUIP_PRESET_MAP.home)); markProfileDirty(); }}>
                        居家哑铃
                      </button>
                      <button type="button" className="quiet" onClick={() => { setEquipment(new Set(EQUIP_PRESET_MAP.bodyweight)); markProfileDirty(); }}>
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
                              markProfileDirty();
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
                      <span>启用能量估算</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={energyEnabled}
                        onChange={(e) => {
                          setEnergyEnabled(e.target.checked);
                          markProfileDirty();
                        }}
                      />
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
                              onChange={(e) => {
                                setHeightCm(e.target.value);
                                markProfileDirty();
                              }}
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
                              onChange={(e) => {
                                setEnergyWeightKg(e.target.value);
                                markProfileDirty();
                              }}
                            />
                            <span>kg</span>
                          </div>
                        </label>
                        <label className="field">
                          <span>测量日期</span>
                          <input type="date" max={today()} required value={weightDate} onChange={(e) => { setWeightDate(e.target.value); markProfileDirty(); }} />
                        </label>
                        <label className="field">
                          <span>出生日期</span>
                          <input type="date" max={today()} required value={birthDate} onChange={(e) => { setBirthDate(e.target.value); markProfileDirty(); }} />
                        </label>
                        <label className="field">
                          <span>性别</span>
                          <select value={sex} onChange={(e) => { setSex(e.target.value as "male" | "female"); markProfileDirty(); }}>
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
                            onChange={(e) => {
                              setActivityFactor(e.target.value);
                              markProfileDirty();
                            }}
                          />
                        </label>
                        <label className="field">
                          <span>生理状态</span>
                          <select value={context} onChange={(e) => { setContext(e.target.value); markProfileDirty(); }}>
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
                    <label className="switch-chip">
                      <span>完成动作自动折叠</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.collapseCompletedExercises}
                        onChange={(e) => updateWorkoutPref("collapseCompletedExercises", e.target.checked)}
                      />
                    </label>
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <span>默认训练界面布局</span>
                    <div className="segments">
                      {WORKOUT_LAYOUT_PRESETS.map((lay) => (
                        <button
                          key={lay.id}
                          type="button"
                          aria-pressed={workoutPrefs.workoutLayout === lay.id}
                          onClick={() => updateWorkoutPref("workoutLayout", lay.id, `默认布局已切换为「${lay.label}」`)}
                        >
                          {lay.label}
                        </button>
                      ))}
                    </div>
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
                    <label className="switch-chip">
                      <span>休息语音播报（剩10秒/下组目标）</span>
                      <input
                        className="switch"
                        type="checkbox"
                        checked={workoutPrefs.voiceRestCues}
                        onChange={(e) => {
                          const next = e.target.checked;
                          updateWorkoutPref("voiceRestCues", next, next ? "已开启语音播报" : "已关闭语音播报");
                          if (next) speakCue("语音播报已开启，休息结束将提示下一组目标", { enabled: true });
                        }}
                      />
                    </label>
                  </div>
                  {workoutPrefs.voiceRestCues ? (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => {
                          const ok = speakCue("休息结束，下一组平板杠铃卧推，60 公斤 8 次", { enabled: true });
                          if (!ok) notify("当前浏览器不支持语音合成，将自动使用提示音");
                        }}
                      >
                        试听语音播报
                      </button>
                    </div>
                  ) : null}
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
                      <span>多场馆器械预设（一键切换杆重与片数库存）</span>
                      <div className="segments">
                        {(profileGoalObj?.equipmentProfiles?.length
                          ? profileGoalObj.equipmentProfiles
                          : DEFAULT_EQUIPMENT_PROFILES
                        ).map((gp) => (
                          <button
                            key={gp.id}
                            type="button"
                            aria-pressed={
                              profileGoalObj?.activeEquipmentProfileId
                                ? profileGoalObj.activeEquipmentProfileId === gp.id
                                : workoutPrefs.barWeight === gp.barWeight &&
                                  JSON.stringify(workoutPrefs.enabledPlates) === JSON.stringify(gp.enabledPlates)
                            }
                            onClick={() => {
                              updateWorkoutPref("barWeight", gp.barWeight);
                              updateWorkoutPref("enabledPlates", gp.enabledPlates);
                              if (gp.platePairs) updateWorkoutPref("platePairs", gp.platePairs);
                              setEquipment(new Set(gp.equipment as EquipmentKey[]));
                              notify(`已套用「${gp.name}」配置（${gp.barWeight}kg 杆），记得点击上方保存目标以同步器械筛选`);
                            }}
                          >
                            {gp.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <span>可用杠铃片（每侧自动配片与对数上限）</span>
                      <div className="plate-chip-grid">
                        {ALL_PLATES.map((plate) => {
                          const active = workoutPrefs.enabledPlates.includes(plate);
                          const pairs = workoutPrefs.platePairs?.[String(plate)];
                          return (
                            <div key={plate} className="plate-pair-cell">
                              <button
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
                              {active ? (
                                <button
                                  type="button"
                                  className="plate-pair-count-btn"
                                  title="点击循环设置单侧可用对数（无限 / 1对 / 2对 / 4对）"
                                  onClick={() => {
                                    const cycle = [undefined, 1, 2, 4] as const;
                                    const curIdx = cycle.indexOf(pairs as 1 | 2 | 4 | undefined);
                                    const nextVal = cycle[(curIdx + 1) % cycle.length];
                                    const nextMap = { ...(workoutPrefs.platePairs ?? {}) };
                                    if (nextVal === undefined) delete nextMap[String(plate)];
                                    else nextMap[String(plate)] = nextVal;
                                    updateWorkoutPref("platePairs", Object.keys(nextMap).length ? nextMap : undefined);
                                  }}
                                >
                                  {pairs == null ? "∞对" : `${pairs}对`}
                                </button>
                              ) : null}
                            </div>
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
                      没有 Apple Watch 也能完整使用铁记，相关入口已自动隐藏。如需同步，下方一键配置快捷指令即可开启。
                    </small>
                  </div>
                ) : null}

                {/* 1. 统一主控区：状态 + 快捷指令向导 + 手动同步 */}
                <section className="form-section">
                  <h3 className="form-section-title">主指令与同步状态</h3>
                  <p className="muted">
                    仅需 1 个纯后台主指令：手表原生开练与结束，iPhone 自动静默上报心率、热量、距离、步数与睡眠。
                  </p>
                  <AppleSyncStatusCard />
                  <button type="button" className="primary-button settings-hero-cta" onClick={() => openDeviceSetupModal()}>
                    <Icon name="plus" size={16} /> 配置 / 导出主快捷指令
                  </button>
                  <div className="settings-quick-grid">
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
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        triggerHaptic("light");
                        triggerAppleHubAction("end", { prefs: workoutPrefs, notify });
                      }}
                    >
                      <Icon name="upload" size={14} /> 补传刚结束训练
                    </button>
                  </div>
                </section>

                {/* 2. 自动化快捷指令一键导出 */}
                <section className="form-section">
                  <h3 className="form-section-title">iPhone 自动化快捷指令</h3>
                  <AppleAutomationCopyPanel shortcutName={hubShortcutInput.trim() || DEFAULT_APPLE_HUB_SHORTCUT} />
                </section>

                {/* 3. 设备管理、名称与高级工具统一折叠 */}
                <section className="form-section">
                  <details className="settings-accordion">
                    <summary>
                      <span>已绑定设备、指令名称与高级工具</span>
                      <span className="settings-accordion-meta">
                        <span>{devices.length} 台设备</span>
                        <Icon name="chevron" size={14} />
                      </span>
                    </summary>
                    <div className="settings-accordion-body apple-advanced-stack">
                      <div className="field">
                        <span>主快捷指令名称（在手机上改过名请同步修改）</span>
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

                      <div className="apple-advanced-block">
                        <strong>已绑定上传设备（{devices.length}）</strong>
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
                          <p className="muted" style={{ margin: "4px 0 0" }}>暂未绑定设备，点上方「配置 / 导出主快捷指令」自动生成。</p>
                        )}
                      </div>

                      <div className="apple-advanced-block">
                        <strong>第三方导入（Health Data Export）</strong>
                        <div className="health-import-actions">
                          <button type="button" className="secondary-button" onClick={() => openHealthDataImportModal()}>
                            导入训练 JSON
                          </button>
                          <button type="button" className="secondary-button" onClick={() => openHealthDataWebhookModal()}>
                            Webhook 自动同步
                          </button>
                        </div>
                      </div>

                      <div className="apple-advanced-block">
                        <strong>开发者接口地址</strong>
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
                            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span>新密码</span>
                              <button
                                type="button"
                                className="quiet"
                                style={{ padding: "0 4px", minHeight: 22, fontSize: 12 }}
                                onClick={() => setShowPwd((v) => !v)}
                              >
                                {showPwd ? "隐藏" : "显示"}
                              </button>
                            </span>
                            <input
                              type={showPwd ? "text" : "password"}
                              autoComplete="new-password"
                              minLength={10}
                              maxLength={128}
                              pattern="[!-~]{10,128}"
                              required
                              placeholder="至少 10 位，支持字母、数字及符号"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span>确认新密码</span>
                            <input
                              type={showPwd ? "text" : "password"}
                              autoComplete="new-password"
                              minLength={10}
                              maxLength={128}
                              pattern="[!-~]{10,128}"
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

                <AccountSecurityAndEcosystemCards initialWebhook={profileGoalObj?.webhookConfig} demo={demo} />

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
                              <small>
                                创建于 {(tok.createdAt ?? "").slice(0, 10)} ·{" "}
                                {tok.expiresAt ? `有效期至 ${tok.expiresAt.slice(0, 10)}` : "永久有效"}
                              </small>
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
