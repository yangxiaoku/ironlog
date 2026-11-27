import { useEffect, useMemo, useRef, useState } from "react";
import { today } from "../lib/date";
import { EQUIPMENT, MUSCLES, type CatalogueExercise, type RecordEnvelope } from "../lib/domain";
import { triggerHaptic } from "../lib/haptics-audio";
import { cachedApiFetch } from "../lib/query-cache";
import {
  openAiDietModal,
  openAiPlanModal,
  openAiReviewModal,
  openAiWorkoutModal,
  openDailyShareModal,
  openDietEditor,
  openExerciseDetailModal,
  openOnboardingModal,
  openStrengthCalcModal,
  openWeightEditor,
  openWorkoutEditor,
} from "../lib/record-openers";
import { DESTINATIONS, type ViewId } from "../lib/routes";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";
import { Icon, type IconName } from "./Icon";

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  keywords: string;
  icon: IconName;
  run: () => void;
}

export function CommandPaletteModal() {
  const userId = useAuthStore((s) => s.userId);
  const aiReady = useAuthStore((s) => s.aiReady);
  const navigate = useUiStore((s) => s.navigate);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const theme = useUiStore((s) => s.theme);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const dataEpoch = useUiStore((s) => s.dataEpoch);

  const [query, setQuery] = useState("");
  const [exResults, setExResults] = useState<CatalogueExercise[]>([]);
  const [customExercises, setCustomExercises] = useState<CatalogueExercise[]>([]);
  const [searchingEx, setSearchingEx] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!userId) {
      setCustomExercises([]);
      return;
    }
    let active = true;
    void cachedApiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise", { userId, epoch: dataEpoch })
      .then((rows) => {
        if (!active || !Array.isArray(rows)) return;
        setCustomExercises(
          rows.filter((r) => !r.deleted && r.data).map((r) => ({ ...r.data, id: r.id, custom: true })),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setExResults([]);
      setSearchingEx(false);
      return;
    }
    let active = true;
    setSearchingEx(true);
    const qLower = trimmed.toLowerCase();
    const timer = window.setTimeout(() => {
      const qs = new URLSearchParams({ q: trimmed, limit: "8" }).toString();
      void cachedApiFetch<{ items: CatalogueExercise[] }>(`/api/catalogue/exercises?${qs}`, {
        token: "",
        userId: "public",
        epoch: 0,
      })
        .then((res) => {
          if (!active) return;
          const customHits = customExercises.filter((ex) =>
            [ex.name, ex.englishName, ...(ex.aliases ?? [])]
              .filter(Boolean)
              .some((t) => String(t).toLowerCase().includes(qLower)),
          );
          const seen = new Set(customHits.map((c) => c.id));
          setExResults([...customHits, ...(res.items ?? []).filter((ex) => !seen.has(ex.id))].slice(0, 10));
        })
        .catch(() => {
          if (active) setExResults([]);
        })
        .finally(() => {
          if (active) setSearchingEx(false);
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, customExercises]);

  const staticItems = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      ...(userId
        ? [
            {
              id: "act:workout",
              group: "快捷操作",
              label: "开始自由训练",
              hint: "打开训练计时与组数记录",
              keywords: "workout train log start 训练 记录",
              icon: "workout" as const,
              run: () => {
                closeAllModals();
                openWorkoutEditor();
              },
            },
            {
              id: "act:diet",
              group: "快捷操作",
              label: "记录饮食 / 热量",
              hint: "按餐次添加今日饮食",
              keywords: "diet meal calories protein 饮食 热量 蛋白质",
              icon: "diet" as const,
              run: () => {
                closeAllModals();
                openDietEditor({ date: today() });
              },
            },
            {
              id: "act:weight",
              group: "快捷操作",
              label: "记录体重与体脂",
              hint: "更新今日体重走势",
              keywords: "weight scale bodyfat 体重 体脂",
              icon: "weight" as const,
              run: () => {
                closeAllModals();
                openWeightEditor({ date: today() });
              },
            },
          ]
        : []),
      {
        id: "act:calc",
        group: "实用工具",
        label: "1RM 与杠铃配片计算器",
        hint: "估算最大肌力与单边配片组合",
        keywords: "1rm calc plate barbell 计算器 配片 杠铃",
        icon: "bolt",
        run: () => {
          closeAllModals();
          openStrengthCalcModal();
        },
      },
      ...(userId && aiReady
        ? [
            {
              id: "act:ai-workout",
              group: "AI 助手",
              label: "AI 一句话记训练",
              hint: "自然语言解析成结构化训练组",
              keywords: "ai workout parse 训练 智能",
              icon: "bolt" as const,
              run: () => {
                closeAllModals();
                openAiWorkoutModal();
              },
            },
            {
              id: "act:ai-diet",
              group: "AI 助手",
              label: "AI 一句话记饮食",
              hint: "自然语言估算餐食营养宏量",
              keywords: "ai diet parse 饮食 智能",
              icon: "bolt" as const,
              run: () => {
                closeAllModals();
                openAiDietModal();
              },
            },
            {
              id: "act:ai-review",
              group: "AI 助手",
              label: "AI 训练与营养周报",
              hint: "生成训练负荷与恢复点评",
              keywords: "ai review report 周报 复盘",
              icon: "bolt" as const,
              run: () => {
                closeAllModals();
                openAiReviewModal();
              },
            },
            {
              id: "act:ai-plan",
              group: "AI 助手",
              label: "AI 生成周期训练计划",
              hint: "按设备与每周天数定制周期",
              keywords: "ai plan 计划",
              icon: "plan" as const,
              run: () => {
                closeAllModals();
                openAiPlanModal();
              },
            },
          ]
        : []),
      ...(userId
        ? [
            {
              id: "act:share",
              group: "实用工具",
              label: "生成今日打卡海报",
              hint: "导出高清竖版训练分享图",
              keywords: "share poster card 海报 分享",
              icon: "download" as const,
              run: () => {
                closeAllModals();
                openDailyShareModal({ date: today() });
              },
            },
            {
              id: "act:guide",
              group: "实用工具",
              label: "打开新手使用指南",
              hint: "查看 5 步上手设置与训练流程",
              keywords: "onboarding guide help 新手 指南",
              icon: "book" as const,
              run: () => {
                closeAllModals();
                openOnboardingModal({ initialStep: 1 });
              },
            },
          ]
        : []),
      {
        id: "act:theme",
        group: "外观与界面",
        label: `切换为${theme === "dark" ? "浅色" : "深色"}外观`,
        hint: "即时切换主题配色",
        keywords: "theme dark light 主题 深色 浅色",
        icon: theme === "dark" ? "sun" : "moon",
        run: () => {
          toggleTheme();
          closeAllModals();
        },
      },
    ];

    const navViews: ViewId[] = userId
      ? ["overview", "workout", "plan", "diet", "weight", "calendar", "exercises", "analytics", "badges", "settings"]
      : ["exercises"];

    const navItems: PaletteItem[] = navViews.map((id) => ({
      id: `nav:${id}`,
      group: "页面跳转",
      label: `前往「${DESTINATIONS[id]}」`,
      hint: `#${id}`,
      keywords: `${id} ${DESTINATIONS[id]} 页面 跳转`,
      icon: id,
      run: () => {
        closeAllModals();
        navigate(id);
      },
    }));

    return [...actions, ...navItems];
  }, [userId, aiReady, theme, navigate, toggleTheme, closeAllModals]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const matchedStatic = q
      ? staticItems.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.hint.toLowerCase().includes(q) ||
            item.keywords.toLowerCase().includes(q),
        )
      : staticItems;

    const exItems: PaletteItem[] = exResults.map((ex) => ({
      id: `ex:${ex.id}`,
      group: ex.custom ? "自定义动作" : "动作百科",
      label: ex.name,
      hint: `${MUSCLES[ex.muscle] ?? ex.muscle} · ${EQUIPMENT[ex.equipment] ?? ex.equipment}`,
      keywords: ex.id,
      icon: "exercises",
      run: () => {
        closeAllModals();
        openExerciseDetailModal(ex.id, ex.name);
      },
    }));

    return [...exItems, ...matchedStatic].slice(0, 30);
  }, [query, staticItems, exResults, closeAllModals]);

  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, allItems.length]);

  useEffect(() => {
    optionRefs.current[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!allItems.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % allItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + allItems.length) % allItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = allItems[activeIdx];
      if (target) {
        triggerHaptic("light");
        target.run();
      }
    }
  };

  return (
    <div className="dialog-form cmdk-modal">
      <label className="search cmdk-search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="go"
          maxLength={80}
          value={query}
          placeholder="搜索动作（如 卧推 / Squat）、功能或页面跳转…"
          aria-label="全局命令搜索"
          onKeyDown={handleKeyDown}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchingEx ? <small className="muted">搜索动作中…</small> : <kbd className="cmdk-kbd">Esc</kbd>}
      </label>

      <div className="cmdk-list" role="listbox" aria-label="命令建议列表">
        {allItems.length ? (
          allItems.map((item, idx) => (
            <button
              key={item.id}
              ref={(el) => {
                optionRefs.current[idx] = el;
              }}
              type="button"
              role="option"
              aria-selected={idx === activeIdx}
              className={`cmdk-item${idx === activeIdx ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => {
                triggerHaptic("light");
                item.run();
              }}
            >
              <span className="cmdk-item-icon">
                <Icon name={item.icon} size={16} />
              </span>
              <span className="cmdk-item-copy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
              <span className="cmdk-item-group">{item.group}</span>
            </button>
          ))
        ) : (
          <p className="empty">未找到匹配的页面、功能或动作。</p>
        )}
      </div>
    </div>
  );
}
