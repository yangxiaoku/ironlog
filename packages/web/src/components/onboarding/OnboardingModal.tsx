import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { today } from "../../lib/date";
import { EQUIPMENT, type EquipmentKey, type ProfileGoals } from "../../lib/domain";
import { openDietEditor, openWeightEditor, openWorkoutEditor } from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";
import { onboardingSeenKey, setupSavedKey } from "./WelcomeChecklist";

const EQUIP_PRESETS: Record<"gym" | "home" | "bodyweight", EquipmentKey[]> = {
  gym: ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
  home: ["dumbbell", "bodyweight", "band"],
  bodyweight: ["bodyweight"],
};

const EQUIP_KEYS: EquipmentKey[] = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "kettlebell",
  "band",
  "weighted",
];

const STEPS = [
  { id: 1, label: "认识铁记" },
  { id: 2, label: "目标器械" },
  { id: 3, label: "记录训练" },
  { id: 4, label: "饮食体重" },
  { id: 5, label: "立即开练" },
] as const;

export function OnboardingModal({
  currentProfile = null,
  initialStep = 1,
}: {
  currentProfile?: ProfileGoals | null;
  initialStep?: number;
}) {
  const userId = useAuthStore((s) => s.userId);
  const username = useAuthStore((s) => s.username);
  const demo = useAuthStore((s) => s.demo);
  const appleHealthConnected = useAuthStore((s) => s.appleHealthConnected);

  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const openPlanSection = useUiStore((s) => s.openPlanSection);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [step, setStep] = useState(() => Math.max(1, Math.min(STEPS.length, Number(initialStep) || 1)));
  const [profileRes, setProfileRes] = useState<{ version: number; profile: ProfileGoals } | null>(null);
  const [equipment, setEquipment] = useState<Set<EquipmentKey>>(
    () =>
      new Set(
        Array.isArray(currentProfile?.equipment) && currentProfile.equipment.length
          ? currentProfile.equipment
          : ["barbell", "dumbbell", "machine", "cable", "bodyweight"],
      ),
  );
  const [daysPerWeek, setDaysPerWeek] = useState<number>(Number(currentProfile?.daysPerWeek) || 4);
  const [restSeconds, setRestSeconds] = useState<number>(Number(currentProfile?.restSeconds) || 90);
  const [calories, setCalories] = useState<string>(String(Math.round(Number(currentProfile?.calories) || 2200)));
  const [protein, setProtein] = useState<string>(String(Math.round(Number(currentProfile?.protein) || 140)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiFetch<{ version: number; profile: ProfileGoals }>("/api/web/profile")
      .then((res) => {
        if (!active || !res?.profile) return;
        setProfileRes(res);
        if (!currentProfile) {
          setDaysPerWeek(Number(res.profile.daysPerWeek) || 4);
          setRestSeconds(Number(res.profile.restSeconds) || 90);
          setCalories(String(Math.round(Number(res.profile.calories) || 2200)));
          setProtein(String(Math.round(Number(res.profile.protein) || 140)));
          if (Array.isArray(res.profile.equipment) && res.profile.equipment.length) {
            setEquipment(new Set(res.profile.equipment));
          }
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentProfile]);

  const markSeen = () => {
    if (userId) {
      try {
        localStorage.setItem(onboardingSeenKey(userId), "1");
      } catch {}
    }
  };

  const handleSaveNext = async () => {
    setError("");
    if (demo) {
      notify("演示模式不写入演示库，已为你继续浏览设置指南");
      setStep(3);
      return;
    }
    const cal = Number(calories);
    const pro = Number(protein);
    if (!Number.isFinite(cal) || cal < 500 || cal > 20000) {
      setError("请输入合理的每日热量目标（500–20000 kcal）。");
      return;
    }
    if (!Number.isFinite(pro) || pro < 0 || pro > 1000) {
      setError("请输入合理的每日蛋白目标（0–1000 g）。");
      return;
    }
    setSaving(true);
    try {
      const current = profileRes ?? (await apiFetch<{ version: number; profile: ProfileGoals }>("/api/web/profile"));
      const prev = current.profile ?? ({} as ProfileGoals);
      const updated = await apiFetch<{ version: number; profile: ProfileGoals }>("/api/web/profile", {
        method: "PUT",
        body: {
          calories: Math.round(cal),
          protein: Math.round(pro),
          carbs: Number(prev.carbs ?? 240),
          fat: Number(prev.fat ?? 70),
          daysPerWeek,
          restSeconds,
          targetWeight: prev.targetWeight ?? null,
          equipment: [...equipment],
          energyProfile: prev.energyProfile ?? null,
          version: current.version ?? 0,
          opId: crypto.randomUUID(),
        },
      });
      setProfileRes(updated);
      if (userId) {
        try {
          localStorage.setItem(setupSavedKey(userId), "1");
        } catch {}
      }
      bumpDataEpoch();
      notify("初始目标与器械已保存");
      setStep(3);
    } catch (err) {
      setError((err as Error)?.message || "保存失败，请稍后再试");
    } finally {
      setSaving(false);
    }
  };

  const handleLaunch = (kind: "browse-plans" | "start-workout" | "log-diet" | "log-weight") => {
    markSeen();
    closeAllModals();
    if (kind === "browse-plans") {
      openPlanSection("starters");
    } else if (kind === "start-workout") {
      openWorkoutEditor(undefined, profileRes?.profile ?? currentProfile);
    } else if (kind === "log-diet") {
      openDietEditor({ date: today() });
    } else {
      openWeightEditor({ date: today() });
    }
  };

  return (
    <div className="onboarding-shell">
      <div className="onboarding-top">
        <div className="onboarding-steps" role="tablist" aria-label="入门引导步骤">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              className={`onboarding-step-dot${s.id < step ? " is-visited" : ""}`}
              aria-selected={step === s.id}
              onClick={() => setStep(s.id)}
            >
              <span>0{s.id}</span>
              <b>{s.label}</b>
            </button>
          ))}
        </div>
        <span className="onboarding-step-counter">
          第 {step} / {STEPS.length} 步
        </span>
      </div>

      <div className="onboarding-panels">
        {step === 1 ? (
          <section className="onboarding-panel">
            <div className="onboarding-hero">
              <span className="atlas-pill">{demo ? "演示体验" : username ? `欢迎你，${username}` : "欢迎使用铁记"}</span>
              <h3>开始使用铁记</h3>
              <p className="muted">记录训练、饮食和体重，手机和电脑同步。</p>
            </div>
            <div className="onboarding-feature-grid">
              <article className="onboarding-card">
                <strong><Icon name="workout" size={16} /> 训练计划与实时开练</strong>
                <small>支持 PPL/上下肢经典方案直接启用；训练中自带组间休息表盘、杠铃配片计算与动作动图要领。</small>
              </article>
              <article className="onboarding-card">
                <strong><Icon name="diet" size={16} /> 饮食热量与每日饮水</strong>
                <small>常用健身餐快速填入、多食物连续录入、常用餐单整餐复刻，实时跟踪蛋白与热量缺口。</small>
              </article>
              <article className="onboarding-card">
                <strong><Icon name="weight" size={16} /> 体重趋势与围度比例</strong>
                <small>记录每日体重、体脂与胸腰臀臂围，自动绘制 7 日滚动均值线，平滑掉单日水分波动。</small>
              </article>
              <article className="onboarding-card">
                <strong><Icon name="analytics" size={16} /> 训练负荷与成就</strong>
                <small>计算 ACWR 急慢负荷比、肌群周有效组数与估算 1RM。</small>
              </article>
            </div>
            <div className="onboarding-note-box">
              <strong><Icon name="heart" size={15} /> 不连手表也能用</strong>
              <small>
                {appleHealthConnected
                  ? "当前账号已连接 Apple 健康数据，首页与分析页将结合心率、睡眠与日常体征展示恢复数据。"
                  : "未对接 Apple 健康时相关模块会自动隐藏，需要时可在「设置 → Apple 健康」开启。"}
              </small>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="onboarding-panel">
            <div className="onboarding-subhead">
              <h3>设定基础目标与常用器械</h3>
              <p className="muted">选好后「动作库」与「训练编辑器」会优先展示匹配器械的动作，日后可在设置里修改。</p>
            </div>
            <div className="onboarding-setup-form">
              <div className="onboarding-field-block">
                <span className="onboarding-field-label">常用场景预设</span>
                <div className="onboarding-pill-row">
                  <button type="button" className="quiet" onClick={() => setEquipment(new Set(EQUIP_PRESETS.gym))}>
                    商业健身房
                  </button>
                  <button type="button" className="quiet" onClick={() => setEquipment(new Set(EQUIP_PRESETS.home))}>
                    居家哑铃
                  </button>
                  <button type="button" className="quiet" onClick={() => setEquipment(new Set(EQUIP_PRESETS.bodyweight))}>
                    徒手训练
                  </button>
                </div>
                <div className="equip-check-grid">
                  {EQUIP_KEYS.map((key) => (
                    <label key={key} className="equip-check-pill">
                      <input
                        type="checkbox"
                        checked={equipment.has(key)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setEquipment((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                      />
                      <span>{EQUIPMENT[key] ?? key}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="onboarding-two-cols">
                <div className="onboarding-field-block">
                  <span className="onboarding-field-label">每周计划训练天数</span>
                  <div className="onboarding-pill-row">
                    {[3, 4, 5, 6].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="stepper-pill"
                        aria-pressed={daysPerWeek === d}
                        onClick={() => setDaysPerWeek(d)}
                      >
                        {d} 天/周
                      </button>
                    ))}
                  </div>
                </div>
                <div className="onboarding-field-block">
                  <span className="onboarding-field-label">默认组间休息计时</span>
                  <div className="onboarding-pill-row">
                    {[60, 90, 120].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        className="stepper-pill"
                        aria-pressed={restSeconds === sec}
                        onClick={() => setRestSeconds(sec)}
                      >
                        {sec} 秒
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="onboarding-two-cols">
                <label className="field">
                  <span>每日热量目标 (kcal)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={800}
                    max={15000}
                    step={10}
                    value={calories}
                    onChange={(e) => setCalories(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>
                    每日蛋白目标 (g) <small className="muted">建议 1.6–2.2 g/kg 体重</small>
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={20}
                    max={600}
                    step={1}
                    value={protein}
                    onChange={(e) => setProtein(e.target.value)}
                  />
                </label>
              </div>
              <p className="form-error" role="alert" hidden={!error}>
                {error}
              </p>
              <div className="onboarding-save-bar">
                <button type="button" className="primary-button" disabled={saving} onClick={() => void handleSaveNext()}>
                  {demo ? "演示预览，进入下一步" : saving ? "保存中…" : "保存设置并下一步"}
                </button>
                <button type="button" className="quiet" onClick={() => setStep(3)}>
                  暂不修改，跳过
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="onboarding-panel">
            <div className="onboarding-subhead">
              <h3>怎么选计划 & 手机上快速记训练</h3>
              <p className="muted">铁记为健身房单手操作做了专门优化，不用每次打字输入。</p>
            </div>
            <ul className="onboarding-tip-list">
              <li>
                <strong>1. 从「经典方案」或「+ 速记」开始</strong>
                <small>进入「训练计划 → 经典方案」可一键启用 PPL、上下肢四分化或全身新手方案；也可以点顶部「+ 速记 → 记录训练」自由开练。</small>
              </li>
              <li>
                <strong>2. 组行左右滑动，少按一次是一次</strong>
                <small>
                  在实时训练窗口中：组行<b>右滑直接勾选完成</b>并自动启动组间倒计时；<b>左滑删除该组</b>
                  （支持 5 秒撤销）；点左侧组号可切换热身 / 递减 / 力竭组。
                </small>
              </li>
              <li>
                <strong>3. 动作示范、杠铃配片与防丢失草稿</strong>
                <small>点击「动作示范」展开标准动图与发力要点；点击「配片」自动换算杠铃片数；误关弹窗也会保留草稿，顶部随时点红点「草稿 / 训练中」回到现场。</small>
              </li>
              <li>
                <strong>4. 键盘快捷键</strong>
                <small>在重量框输完按手机键盘「下一项」直接跳至次数框，按「完成」自动勾选本组。</small>
              </li>
            </ul>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="onboarding-panel">
            <div className="onboarding-subhead">
              <h3>饮食、体重、日历与科学数据分析</h3>
              <p className="muted">把每日恢复、吃与练串联起来，及时看出状态拐点。</p>
            </div>
            <div className="onboarding-feature-grid">
              <article className="onboarding-card">
                <strong>饮食快录与模板</strong>
                <small>内置常见健身餐快捷填入与「复刻昨日」，新建食物时点「保存并继续」可一次连录整顿饭；列表右滑再来一份、左滑可撤销删除。</small>
              </article>
              <article className="onboarding-card">
                <strong>体重跨日补录与围度</strong>
                <small>体重弹窗顶部点「今天 / 昨天 / 前天」无缝补录与修改历史体重；搭配围度记录自动算腰臀比与腰高比。</small>
              </article>
              <article className="onboarding-card">
                <strong>训练日历与月度总览</strong>
                <small>月历一格看清每日训练标题、饮食完整标记与未来排期，点击任意一天查看动作与热量明细。</small>
              </article>
              <article className="onboarding-card">
                <strong>负荷比与肌群均衡</strong>
                <small>在「数据分析」查看急慢负荷比（0.8–1.3 甜区）、各部位每周有效组数（10–20 组参考）以及单动作 1RM 估算曲线。</small>
              </article>
            </div>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="onboarding-panel">
            <div className="onboarding-subhead">
              <h3>准备好了！选一个方式开启你的第一条记录</h3>
              <p className="muted">随时可以在桌面侧栏底部、手机底部「更多」菜单或「设置 → 账号与数据」重新打开本指南。</p>
            </div>
            <div className="onboarding-launch-grid">
              <button type="button" className="onboarding-launch-card" onClick={() => handleLaunch("browse-plans")}>
                <span><Icon name="plan" size={20} /></span>
                <div><strong>浏览经典训练方案</strong><small>挑一套分化直接开启周期计划</small></div>
                <Icon name="chevron" size={16} />
              </button>
              <button type="button" className="onboarding-launch-card" onClick={() => handleLaunch("start-workout")}>
                <span><Icon name="workout" size={20} /></span>
                <div><strong>开始第一场训练</strong><small>打开实时训练弹窗记录动作与组数</small></div>
                <Icon name="chevron" size={16} />
              </button>
              <button type="button" className="onboarding-launch-card" onClick={() => handleLaunch("log-diet")}>
                <span><Icon name="diet" size={20} /></span>
                <div><strong>记录今天第一餐</strong><small>点亮今日热量与蛋白质进度</small></div>
                <Icon name="chevron" size={16} />
              </button>
              <button type="button" className="onboarding-launch-card" onClick={() => handleLaunch("log-weight")}>
                <span><Icon name="weight" size={20} /></span>
                <div><strong>记录今日体重</strong><small>建立属于你的 7 日体重均值曲线</small></div>
                <Icon name="chevron" size={16} />
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <footer className="onboarding-foot">
        <button
          type="button"
          className="quiet"
          onClick={() => {
            markSeen();
            closeAllModals();
          }}
        >
          跳过指南
        </button>
        <div className="onboarding-foot-nav">
          <button type="button" className="secondary-button" hidden={step <= 1} onClick={() => setStep((s) => Math.max(1, s - 1))}>
            上一步
          </button>
          <button
            type="button"
            className="primary-button"
            hidden={step >= STEPS.length || step === 2}
            onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
          >
            下一步
          </button>
          <button
            type="button"
            className="primary-button"
            hidden={step !== STEPS.length}
            onClick={() => {
              markSeen();
              closeAllModals();
            }}
          >
            进入首页工作台
          </button>
        </div>
      </footer>
    </div>
  );
}
