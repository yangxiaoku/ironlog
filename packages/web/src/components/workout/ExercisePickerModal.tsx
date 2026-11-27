import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import {
  EQUIPMENT,
  MUSCLES,
  type CatalogueExercise,
  type EquipmentKey,
  type FavoriteData,
  type MuscleKey,
  type RecordEnvelope,
} from "../../lib/domain";
import { triggerHaptic } from "../../lib/haptics-audio";
import { openCustomExerciseModal } from "../../lib/record-openers";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

function prioritizeExact(items: CatalogueExercise[], query: string): CatalogueExercise[] {
  const norm = (val: string) => val.normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "");
  const target = norm(query);
  if (!target) return items;
  const rank = (item: CatalogueExercise) =>
    Number(norm(item.name) === target || norm(item.englishName ?? "") === target);
  return [...items].sort((a, b) => rank(b) - rank(a));
}

export function ExercisePickerModal({
  title = "添加动作",
  multiple = false,
  onSelect,
  onSelectMany,
}: {
  title?: string;
  multiple?: boolean;
  onSelect: (exercise: CatalogueExercise) => void;
  onSelectMany?: (exercises: CatalogueExercise[]) => void;
}) {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const notify = useUiStore((s) => s.notify);

  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<MuscleKey | "">("");
  const [equip, setEquip] = useState<EquipmentKey | "" | "__fav__">("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string>("");
  const [submittingBatch, setSubmittingBatch] = useState(false);
  const [selectedItems, setSelectedItems] = useState<CatalogueExercise[]>([]);
  const [pendingFavIds, setPendingFavIds] = useState<Set<string>>(() => new Set());
  const [items, setItems] = useState<CatalogueExercise[]>([]);
  const [favRecords, setFavRecords] = useState<Array<RecordEnvelope<FavoriteData>>>([]);
  const [customExercises, setCustomExercises] = useState<CatalogueExercise[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiFetch<Array<RecordEnvelope<FavoriteData>>>("/api/records/favorite").catch(() => []),
      apiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise").catch(() => []),
    ]).then(([favs, customs]) => {
      if (!active) return;
      setFavRecords(favs.filter((r) => !r.deleted));
      setCustomExercises(
        customs
          .filter((r) => !r.deleted && r.data)
          .map((r) => ({ ...r.data, id: r.id, custom: true })),
      );
    });
    return () => {
      active = false;
    };
  }, [userId, dataEpoch]);

  const favIds = new Set(favRecords.map((r) => r.data.exerciseId));
  const selectedIds = new Set(selectedItems.map((ex) => ex.id));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNextCursor(null);
    const cleanQ = query.trim();

    const load = async (): Promise<{ list: CatalogueExercise[]; cursor: string | null }> => {
      const qLower = cleanQ.toLowerCase();
      const matchesCustom = (ex: CatalogueExercise) => {
        if (muscle && ex.muscle !== muscle) return false;
        if (equip && equip !== "__fav__" && ex.equipment !== equip) return false;
        if (!qLower) return true;
        return [ex.name, ex.englishName, ...(ex.aliases ?? [])]
          .filter(Boolean)
          .some((txt) => String(txt).toLowerCase().includes(qLower));
      };

      if (equip === "__fav__") {
        const customIds = new Set(customExercises.map((c) => c.id));
        const customFavs = customExercises.filter((ex) => favIds.has(ex.id) && matchesCustom(ex));
        const builtinFavIds = [...favIds].filter((id) => !customIds.has(id));
        let builtinFavs: CatalogueExercise[] = [];
        if (builtinFavIds.length) {
          const res = await apiFetch<{ items?: CatalogueExercise[] }>("/api/catalogue/exercises/details", {
            method: "POST",
            body: { ids: builtinFavIds },
          }).catch(() => ({ items: [] as CatalogueExercise[] }));
          builtinFavs = (res.items ?? []).filter((ex) => matchesCustom(ex));
        }
        return { list: prioritizeExact([...customFavs, ...builtinFavs], cleanQ), cursor: null };
      }

      const params = new URLSearchParams({ q: cleanQ, limit: "40" });
      if (muscle) params.set("muscle", muscle);
      if (equip) params.set("equipment", equip);
      const res = await apiFetch<{ items?: CatalogueExercise[]; nextCursor?: string | null }>(
        `/api/catalogue/exercises?${params.toString()}`,
      );
      const customMatches = customExercises.filter(matchesCustom);
      const customIdSet = new Set(customExercises.map((c) => c.id));
      let pool = [...customMatches, ...(res.items ?? []).filter((ex) => !customIdSet.has(ex.id))];
      if (!cleanQ && !muscle && favIds.size) {
        const missingFavs = [...favIds].filter((id) => !pool.some((p) => p.id === id) && !customIdSet.has(id)).slice(0, 6);
        if (missingFavs.length) {
          const favRes = await apiFetch<{ items?: CatalogueExercise[] }>("/api/catalogue/exercises/details", {
            method: "POST",
            body: { ids: missingFavs },
          }).catch(() => ({ items: [] as CatalogueExercise[] }));
          const filteredFavs = (favRes.items ?? []).filter((ex) => (!equip || ex.equipment === equip));
          pool = [...filteredFavs, ...pool];
        }
      }
      const prioritized = prioritizeExact(pool, cleanQ);
      const ordered = cleanQ ? prioritized : prioritized.sort((a, b) => Number(favIds.has(b.id)) - Number(favIds.has(a.id)));
      return { list: ordered, cursor: res.nextCursor ?? null };
    };

    const timer = window.setTimeout(() => {
      void load()
        .then(({ list, cursor }) => {
          if (active) {
            setItems(list);
            setNextCursor(cursor);
          }
        })
        .catch(() => {
          if (active) {
            setItems([]);
            setNextCursor(null);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, cleanQ ? 120 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, muscle, equip, customExercises, favRecords]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore || equip === "__fav__") return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ q: query.trim(), limit: "40", cursor: nextCursor });
      if (muscle) params.set("muscle", muscle);
      if (equip) params.set("equipment", equip);
      const res = await apiFetch<{ items?: CatalogueExercise[]; nextCursor?: string | null }>(
        `/api/catalogue/exercises?${params.toString()}`,
      );
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const extra = (res.items ?? []).filter((x) => !seen.has(x.id));
        return [...prev, ...extra];
      });
      setNextCursor(res.nextCursor ?? null);
    } catch {
      notify("加载更多动作失败");
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleFavorite = async (exId: string) => {
    if (!userId || pendingFavIds.has(exId)) return;
    triggerHaptic("light");
    const existing = favRecords.find((r) => r.data.exerciseId === exId);
    setPendingFavIds((prev) => new Set(prev).add(exId));
    try {
      if (existing) {
        await apiFetch("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id: existing.id,
            kind: "favorite",
            baseVersion: existing.version,
            deleted: true,
            data: existing.data,
          },
        });
        setFavRecords((prev) => prev.filter((r) => r.id !== existing.id));
        notify("已取消收藏");
      } else {
        const id = `fav_${crypto.randomUUID().slice(0, 12)}`;
        const res = await apiFetch<{ record?: RecordEnvelope<FavoriteData> }>("/api/records", {
          method: "POST",
          body: {
            opId: crypto.randomUUID(),
            id,
            kind: "favorite",
            baseVersion: 0,
            deleted: false,
            data: { exerciseId: exId },
          },
        });
        const rec = res.record ?? {
          id,
          kind: "favorite",
          version: 1,
          deleted: false,
          updatedAt: new Date().toISOString(),
          data: { exerciseId: exId },
        };
        setFavRecords((prev) => [...prev, rec]);
        notify("已收藏动作 · 下次优先置顶");
      }
    } catch (err) {
      notify((err as Error)?.message || "收藏操作失败");
    } finally {
      setPendingFavIds((prev) => {
        const next = new Set(prev);
        next.delete(exId);
        return next;
      });
    }
  };

  const handlePick = async (item: CatalogueExercise) => {
    if (multiple) {
      triggerHaptic("light");
      setSelectedItems((prev) =>
        prev.some((x) => x.id === item.id) ? prev.filter((x) => x.id !== item.id) : [...prev, item],
      );
      return;
    }
    if (selectingId) return;
    setSelectingId(item.id);
    try {
      const full = item.custom
        ? item
        : (await apiFetch<{ exercise: CatalogueExercise }>(`/api/catalogue/exercises/${encodeURIComponent(item.id)}`)).exercise;
      triggerHaptic("light");
      onSelect(full);
      closeTopModal();
    } catch {
      onSelect(item);
      closeTopModal();
    } finally {
      setSelectingId("");
    }
  };

  const handleConfirmBatch = async () => {
    if (!selectedItems.length || submittingBatch) return;
    setSubmittingBatch(true);
    try {
      const resolved = await Promise.all(
        selectedItems.map(async (item) => {
          if (item.custom) return item;
          try {
            return (await apiFetch<{ exercise: CatalogueExercise }>(`/api/catalogue/exercises/${encodeURIComponent(item.id)}`)).exercise;
          } catch {
            return item;
          }
        }),
      );
      triggerHaptic("success");
      if (onSelectMany) onSelectMany(resolved);
      else resolved.forEach((ex) => onSelect(ex));
      closeTopModal();
    } finally {
      setSubmittingBatch(false);
    }
  };

  return (
    <div className="dialog-form">
      <div className="picker-search">
        <input
          type="search"
          enterKeyHint="search"
          placeholder={`搜索${title}（中文、英文或别名）`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div className="muscle-pills picker-muscles" role="group" aria-label="按肌群筛选">
        <button type="button" aria-pressed={muscle === ""} onClick={() => setMuscle("")}>
          全部肌群
        </button>
        {(Object.entries(MUSCLES) as Array<[MuscleKey, string]>).map(([k, lbl]) => (
          <button key={k} type="button" aria-pressed={muscle === k} onClick={() => setMuscle(muscle === k ? "" : k)}>
            {lbl}
          </button>
        ))}
      </div>

      <div className="muscle-pills picker-equipment" role="group" aria-label="按器械或收藏筛选">
        <button type="button" aria-pressed={equip === ""} onClick={() => setEquip("")}>
          全部器械
        </button>
        <button type="button" aria-pressed={equip === "__fav__"} onClick={() => setEquip(equip === "__fav__" ? "" : "__fav__")}>
          已收藏 ({favRecords.length})
        </button>
        {(Object.entries(EQUIPMENT) as Array<[EquipmentKey, string]>).map(([k, lbl]) => (
          <button key={k} type="button" aria-pressed={equip === k} onClick={() => setEquip(equip === k ? "" : k)}>
            {lbl}
          </button>
        ))}
      </div>

      <div className="picker-results" style={{ maxHeight: "min(50dvh, 400px)", overflowY: "auto" }}>
        {loading ? (
          <p className="muted" style={{ padding: "12px 4px" }}>正在检索动作库…</p>
        ) : items.length === 0 ? (
          <div style={{ padding: "14px 4px", display: "grid", gap: 10, justifyItems: "start" }}>
            <p className="muted" style={{ margin: 0 }}>没有找到匹配动作，试试更换关键词或直接新建自定义动作。</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => openCustomExerciseModal()}
            >
              <Icon name="plus" size={14} /> 新建自定义动作
            </button>
          </div>
        ) : (
          <>
            {items.map((item) => {
              const faved = favIds.has(item.id);
              const picked = multiple && selectedIds.has(item.id);
              return (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid var(--rule)" }}>
                  <button
                    type="button"
                    style={{ flex: 1, borderBottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                    disabled={!multiple && selectingId === item.id}
                    aria-pressed={multiple ? picked : undefined}
                    onClick={() => void handlePick(item)}
                  >
                    <span className="picker-item-main">
                      <strong>
                        {faved ? "★ " : ""}
                        {item.name}
                      </strong>
                      <small>
                        {MUSCLES[item.muscle] ?? item.muscle} · {EQUIPMENT[item.equipment] ?? item.equipment}
                        {item.mode === "timed" ? " · 计时" : item.mode === "assisted" ? " · 辅助减重" : ""}
                      </small>
                    </span>
                    <span className="picker-add-chip">
                      {multiple
                        ? picked
                          ? "✓ 已选"
                          : "+ 勾选"
                        : selectingId === item.id
                          ? "添加中"
                          : "+ 添加"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={faved ? "取消收藏" : "收藏动作"}
                    aria-pressed={faved}
                    onClick={() => void toggleFavorite(item.id)}
                  >
                    <Icon name={faved ? "starFilled" : "star"} size={16} />
                  </button>
                </div>
              );
            })}
            {nextCursor ? (
              <div style={{ padding: "10px 4px", display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  className="quiet"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMore()}
                >
                  {loadingMore ? "加载中…" : "加载更多动作"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <footer className="dialog-foot" style={{ marginTop: 8 }}>
        <button type="button" className="quiet" onClick={() => openCustomExerciseModal()}>
          <Icon name="plus" size={14} /> 自定义动作
        </button>
        {multiple ? (
          <button
            type="button"
            className="primary-button"
            disabled={!selectedItems.length || submittingBatch}
            onClick={() => void handleConfirmBatch()}
          >
            {submittingBatch ? "添加中…" : `加入训练 (${selectedItems.length})`}
          </button>
        ) : (
          <button type="button" className="quiet" onClick={closeTopModal}>
            关闭
          </button>
        )}
      </footer>
    </div>
  );
}
