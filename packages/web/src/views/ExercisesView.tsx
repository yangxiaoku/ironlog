import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { MuscleBodyMap } from "../components/MuscleBodyMap";
import { WorkspaceTabs } from "../components/WorkspaceTabs";
import { apiFetch } from "../lib/api";
import { safeExerciseMediaUrl } from "../lib/catalogue";
import { fmt, shortDate } from "../lib/date";
import { cachedApiFetch, peekQuery } from "../lib/query-cache";
import {
  EQUIPMENT,
  MUSCLES,
  type CatalogueExercise,
  type EquipmentKey,
  type FavoriteData,
  type MuscleKey,
  type RecordEnvelope,
  type TrainedExerciseSummary,
} from "../lib/domain";
import { triggerHaptic } from "../lib/haptics-audio";
import {
  openCustomExerciseModal,
  openExerciseDetailModal,
  openStrengthCalcModal,
} from "../lib/record-openers";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

type CatalogueScope = "all" | "trained" | "favorites" | "custom";
type TrainedSort = "recent" | "1rm" | "sessions";

type DisplayExerciseItem = Omit<CatalogueExercise, "volumeMultiplier"> & {
  volumeMultiplier?: number;
} & Partial<TrainedExerciseSummary>;

function matchesExerciseLocal(
  ex: DisplayExerciseItem,
  q: string,
  muscle: MuscleKey | "",
  equip: EquipmentKey | "" | "__mine__",
  mineSet: Set<string> | null,
): boolean {
  if (muscle && ex.muscle !== muscle) return false;
  if (equip === "__mine__") {
    if (mineSet && mineSet.size && !mineSet.has(ex.equipment)) return false;
  } else if (equip && ex.equipment !== equip) {
    return false;
  }
  if (!q) return true;
  const needle = q.toLowerCase();
  return [ex.name, ex.englishName, ...(ex.aliases ?? [])].some((t) => String(t ?? "").toLowerCase().includes(needle));
}

function prioritizeExact(items: DisplayExerciseItem[], rawQuery: string): DisplayExerciseItem[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return items;
  return [...items].sort((a, b) => {
    const score = (ex: DisplayExerciseItem) => {
      const name = String(ex.name ?? "").toLowerCase();
      if (name === q) return 0;
      if (name.startsWith(q)) return 1;
      if (String(ex.englishName ?? "").toLowerCase() === q) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
}

export function ExercisesView() {
  const userId = useAuthStore((s) => s.userId);
  const dataEpoch = useUiStore((s) => s.dataEpoch);
  const bumpDataEpoch = useUiStore((s) => s.bumpDataEpoch);
  const notify = useUiStore((s) => s.notify);

  const [queryInput, setQueryInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scope, setScope] = useState<CatalogueScope>("all");
  const [muscle, setMuscle] = useState<MuscleKey | "">("");
  const [showBodyMap, setShowBodyMap] = useState(false);
  const [equipmentFilter, setEquipmentFilter] = useState<EquipmentKey | "" | "__mine__">("");
  const [trainedSort, setTrainedSort] = useState<TrainedSort>("recent");

  const [items, setItems] = useState<DisplayExerciseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusText, setStatusText] = useState("正在查找动作…");
  const [error, setError] = useState("");

  const [favRecords, setFavRecords] = useState<Array<RecordEnvelope<FavoriteData>>>([]);
  const [customRecords, setCustomRecords] = useState<Array<RecordEnvelope<CatalogueExercise>>>([]);
  const [pendingFavIds, setPendingFavIds] = useState<Set<string>>(() => new Set());
  const composingRef = useRef(false);
  const seqRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Debounce search text cleanly (IME safe)
  useEffect(() => {
    if (composingRef.current) return;
    const timer = window.setTimeout(() => setDebouncedQuery(queryInput), 200);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  // If logged out, reset auth-only scopes
  useEffect(() => {
    if (!userId && scope !== "all") setScope("all");
    if (!userId && equipmentFilter === "__mine__") setEquipmentFilter("");
  }, [userId, scope, equipmentFilter]);

  const fetchCatalogue = useCallback(
    async (append: boolean, cursorArg: string | null = null) => {
      const seq = ++seqRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      setStatusText(append ? "正在加载更多…" : "正在查找动作…");

      try {
        const [favs, customs, mineProfile] = userId
          ? await Promise.all([
              cachedApiFetch<Array<RecordEnvelope<FavoriteData>>>("/api/records/favorite", { epoch: dataEpoch, userId }).catch(() => []),
              cachedApiFetch<Array<RecordEnvelope<CatalogueExercise>>>("/api/records/exercise", { epoch: dataEpoch, userId }).catch(() => []),
              equipmentFilter === "__mine__"
                ? cachedApiFetch<{
                    profile?: {
                      equipment?: string[];
                      activeEquipmentProfileId?: string | null;
                      equipmentProfiles?: Array<{ id: string; equipment?: string[] }>;
                    };
                  }>("/api/web/profile", { epoch: dataEpoch, userId }).catch(() => null)
                : Promise.resolve(null),
            ])
          : [[], [], null];

        if (seq !== seqRef.current) return;

        const activeFavs = favs.filter((r) => !r.deleted && r.data?.exerciseId);
        const activeCustoms = customs.filter((r) => !r.deleted && r.data?.id);
        setFavRecords(activeFavs);
        setCustomRecords(activeCustoms);

        const favIds = new Set(activeFavs.map((r) => r.data.exerciseId));
        const customList: DisplayExerciseItem[] = activeCustoms.map((r) => ({ ...r.data, custom: true }));
        const customIds = new Set(customList.map((ex) => ex.id));
        const activeEquipProfile =
          mineProfile?.profile?.activeEquipmentProfileId && Array.isArray(mineProfile?.profile?.equipmentProfiles)
            ? mineProfile.profile.equipmentProfiles.find((p) => p.id === mineProfile.profile!.activeEquipmentProfileId)
            : null;
        const mineSet =
          equipmentFilter === "__mine__"
            ? new Set(activeEquipProfile?.equipment ?? mineProfile?.profile?.equipment ?? ["barbell", "dumbbell", "machine"])
            : null;

        if (scope === "trained" && userId) {
          const trainedReply = await cachedApiFetch<{ items?: TrainedExerciseSummary[] }>("/api/web/trained-exercises", { epoch: dataEpoch, userId });
          if (seq !== seqRef.current) return;
          const metricScore = (ex: DisplayExerciseItem) =>
            ex.mode === "timed" ? ex.bestHold ?? 0 : ex.best1rm ?? ex.bestWeight ?? 0;
          let list: DisplayExerciseItem[] = (trainedReply.items ?? []).filter((ex) =>
            matchesExerciseLocal(ex, debouncedQuery, muscle, equipmentFilter, mineSet),
          );
          if (trainedSort === "1rm") {
            list = [...list].sort((a, b) => metricScore(b) - metricScore(a) || (b.sessionsCount ?? 0) - (a.sessionsCount ?? 0));
          } else if (trainedSort === "sessions") {
            list = [...list].sort(
              (a, b) => (b.sessionsCount ?? 0) - (a.sessionsCount ?? 0) || (b.totalWorkSets ?? 0) - (a.totalWorkSets ?? 0),
            );
          } else {
            list = [...list].sort(
              (a, b) =>
                ((b.lastDate ?? "") < (a.lastDate ?? "") ? -1 : (b.lastDate ?? "") > (a.lastDate ?? "") ? 1 : 0) ||
                (b.sessionsCount ?? 0) - (a.sessionsCount ?? 0),
            );
          }
          if (debouncedQuery) list = prioritizeExact(list, debouncedQuery);

          const lookupIds = list
            .filter((ex) => !ex.custom && !ex.thumbnail)
            .slice(0, 100)
            .map((ex) => ex.id);
          if (lookupIds.length) {
            const lookupKey = `catalogue:lookup:${[...lookupIds].sort().join(",")}`;
            const lookup = await cachedApiFetch<{ items?: Array<{ id: string; thumbnail?: string | null }> }>(
              "/api/catalogue/exercises/lookup",
              { method: "POST", body: { ids: lookupIds }, token: "", cacheKey: lookupKey, userId: "public", epoch: 0 },
            ).catch(() => ({ items: [] }));
            if (seq !== seqRef.current) return;
            const thumbMap = new Map((lookup.items ?? []).map((c) => [c.id, c.thumbnail]));
            list = list.map((ex) => (thumbMap.has(ex.id) ? { ...ex, thumbnail: thumbMap.get(ex.id) } : ex));
          }

          setItems(list);
          setTotal(list.length);
          setNextCursor(null);
          setStatusText(`已练过 ${fmt(list.length)} 个动作`);
          return;
        }

        if ((scope === "favorites" || scope === "custom") && userId) {
          let list: DisplayExerciseItem[] = [];
          if (scope === "custom") {
            list = customList.filter((ex) => matchesExerciseLocal(ex, debouncedQuery, muscle, equipmentFilter, mineSet));
          } else {
            const customFavs = customList.filter(
              (ex) => favIds.has(ex.id) && matchesExerciseLocal(ex, debouncedQuery, muscle, equipmentFilter, mineSet),
            );
            const builtinFavIds = [...favIds].filter((id) => !customIds.has(id)).slice(0, 100);
            let builtinFavs: DisplayExerciseItem[] = [];
            if (builtinFavIds.length) {
              const detailsKey = `catalogue:details:${[...builtinFavIds].sort().join(",")}`;
              const details = await cachedApiFetch<{ items?: CatalogueExercise[] }>("/api/catalogue/exercises/details", {
                method: "POST",
                body: { ids: builtinFavIds },
                token: "",
                cacheKey: detailsKey,
                userId: "public",
                epoch: 0,
              });
              if (seq !== seqRef.current) return;
              builtinFavs = (details.items ?? [])
                .filter((ex) => matchesExerciseLocal(ex, debouncedQuery, muscle, equipmentFilter, mineSet))
                .map((ex) => ({ ...ex, thumbnail: ex.illustration?.frames?.[0]?.path ?? null }));
            }
            list = [...customFavs, ...builtinFavs];
          }
          const sorted = prioritizeExact(list, debouncedQuery);
          setItems(sorted);
          setTotal(sorted.length);
          setNextCursor(null);
          setStatusText(scope === "favorites" ? `已收藏 ${fmt(sorted.length)} 个动作` : `自定义 ${fmt(sorted.length)} 个动作`);
          return;
        }

        const q = new URLSearchParams({
          q: debouncedQuery,
          limit: equipmentFilter === "__mine__" ? "100" : "24",
        });
        if (muscle) q.set("muscle", muscle);
        if (equipmentFilter && equipmentFilter !== "__mine__") q.set("equipment", equipmentFilter);
        if (append && cursorArg) q.set("cursor", cursorArg);

        const catalogueUrl = `/api/catalogue/exercises?${q.toString()}`;
        const data = await cachedApiFetch<{ items: CatalogueExercise[]; total: number; nextCursor: string | null }>(
          catalogueUrl,
          { token: "", userId: "public", epoch: 0 },
        );
        if (seq !== seqRef.current) return;

        const equipMatch = (ex: DisplayExerciseItem) => !mineSet || !mineSet.size || mineSet.has(ex.equipment);
        const filteredApi = data.items.filter(equipMatch);
        const customMatches = customList.filter((ex) =>
          matchesExerciseLocal(ex, debouncedQuery, muscle, equipmentFilter, mineSet),
        );

        const nextItems = append
          ? [...itemsRef.current, ...filteredApi.filter((ex) => !customIds.has(ex.id))]
          : prioritizeExact([...customMatches, ...filteredApi.filter((ex) => !customIds.has(ex.id))], debouncedQuery);
        const totalCount = equipmentFilter === "__mine__" ? nextItems.length : data.total + customMatches.length;
        setItems(nextItems);
        setTotal(totalCount);
        setStatusText(
          equipmentFilter === "__mine__"
            ? `匹配我的器械 ${fmt(nextItems.length)} 个动作${data.nextCursor ? "（可继续加载）" : ""}`
            : `已显示 ${fmt(nextItems.length)} / ${fmt(totalCount)} 个动作`,
        );
        setNextCursor(data.nextCursor);
      } catch (err) {
        if (seq !== seqRef.current) return;
        const msg = (err as Error)?.message || "加载动作失败";
        const status = (err as { status?: number })?.status;
        if (append && status === 409) {
          void fetchCatalogue(false, null);
          return;
        }
        setError(msg);
        setStatusText(msg);
      } finally {
        if (seq === seqRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [userId, scope, muscle, equipmentFilter, trainedSort, debouncedQuery, dataEpoch],
  );

  useEffect(() => {
    void fetchCatalogue(false, null);
  }, [fetchCatalogue]);

  const favMap = new Map(favRecords.map((r) => [r.data.exerciseId, r]));
  const customMap = new Map(customRecords.map((r) => [r.data.id, r]));

  const handleToggleFav = async (exerciseId: string) => {
    if (!userId || pendingFavIds.has(exerciseId)) return;
    triggerHaptic("light");
    const existing = favMap.get(exerciseId);
    const removedItem = existing && scope === "favorites" ? items.find((ex) => ex.id === exerciseId) : undefined;
    setPendingFavIds((prev) => new Set(prev).add(exerciseId));

    // Optimistic update
    if (existing) {
      setFavRecords((prev) => prev.filter((r) => r.data.exerciseId !== exerciseId));
      if (scope === "favorites") {
        setItems((prev) => prev.filter((ex) => ex.id !== exerciseId));
      }
    } else {
      const optimisticRec: RecordEnvelope<FavoriteData> = {
        id: `fav_${crypto.randomUUID().slice(0, 12)}`,
        kind: "favorite",
        version: 0,
        deleted: false,
        updatedAt: new Date().toISOString(),
        data: { exerciseId },
      };
      setFavRecords((prev) => [...prev, optimisticRec]);
    }

    try {
      const res = await apiFetch<{ record?: RecordEnvelope<FavoriteData> }>("/api/records", {
        method: "POST",
        body: {
          opId: crypto.randomUUID(),
          id: existing?.id ?? `fav_${crypto.randomUUID().slice(0, 12)}`,
          kind: "favorite",
          baseVersion: existing?.version ?? 0,
          deleted: Boolean(existing),
          data: { exerciseId },
        },
      });
      if (!existing && res.record) {
        setFavRecords((prev) => prev.map((r) => (r.data.exerciseId === exerciseId ? res.record! : r)));
      }
      bumpDataEpoch();
    } catch (err) {
      if (existing) {
        setFavRecords((prev) => [...prev, existing]);
        if (removedItem && scope === "favorites") {
          setItems((prev) => [removedItem, ...prev]);
        }
      } else {
        setFavRecords((prev) => prev.filter((r) => r.data.exerciseId !== exerciseId));
      }
      notify((err as Error)?.message || "收藏操作失败");
    } finally {
      setPendingFavIds((prev) => {
        const next = new Set(prev);
        next.delete(exerciseId);
        return next;
      });
    }
  };

  const isFiltered = Boolean(queryInput || muscle || equipmentFilter || scope !== "all");
  const remaining = Math.max(0, total - items.length);

  return (
    <>
      <WorkspaceTabs />
      <header className="page-heading masthead-exercises">
        <div>
          <h1>动作库</h1>
        </div>
        <div className="heading-actions">
          <button type="button" className="secondary-button" onClick={() => openStrengthCalcModal()}>
            <Icon name="bolt" size={15} /> 力量计算器
          </button>
          {userId ? (
            <button type="button" className="primary-button" onClick={() => openCustomExerciseModal()}>
              <Icon name="plus" size={16} /> 自定义动作
            </button>
          ) : null}
        </div>
      </header>

      <div className="catalogue-shell">
        <form
          id="catalogue-search"
          className="catalogue-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setDebouncedQuery(queryInput);
          }}
        >
          <label className="search">
            <Icon name="search" size={16} />
            <input
              name="query"
              type="search"
              enterKeyHint="search"
              maxLength={80}
              value={queryInput}
              placeholder="搜索中文、英文名或简称（如 卧推 / Bench）…"
              aria-label="搜索训练动作"
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                setDebouncedQuery(e.currentTarget.value);
              }}
              onChange={(e) => setQueryInput(e.target.value)}
            />
          </label>

          {userId ? (
            <div className="segments" role="group" aria-label="动作列表范围">
              {(
                [
                  ["all", "全部"],
                  ["trained", "练过"],
                  ["favorites", "收藏"],
                  ["custom", "自定义"],
                ] as ReadonlyArray<readonly [CatalogueScope, string]>
              ).map(([s, lbl]) => (
                <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
                  {lbl}
                </button>
              ))}
            </div>
          ) : null}

          <select
            name="equipment"
            aria-label="按器械筛选"
            value={equipmentFilter}
            onChange={(e) => setEquipmentFilter(e.target.value as EquipmentKey | "" | "__mine__")}
          >
            <option value="">全部器械</option>
            {userId ? <option value="__mine__">我的可用器械</option> : null}
            {(Object.entries(EQUIPMENT) as Array<[EquipmentKey, string]>).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="quiet"
            hidden={!isFiltered}
            onClick={() => {
              setQueryInput("");
              setDebouncedQuery("");
              setScope("all");
              setMuscle("");
              setEquipmentFilter("");
            }}
          >
            清空筛选
          </button>
        </form>

        <div className="catalogue-pills-bar">
          <div className="muscle-pills-scroll-wrap">
            <div className="muscle-pills" role="group" aria-label="按肌群筛选">
              <button type="button" aria-pressed={muscle === ""} onClick={() => setMuscle("")}>
                全部肌群
              </button>
              {(Object.entries(MUSCLES) as Array<[MuscleKey, string]>).map(([k, lbl]) => (
                <button key={k} type="button" aria-pressed={muscle === k} onClick={() => setMuscle(muscle === k ? "" : k)}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          <div className="catalogue-submeta-row">
            <p className="catalogue-status">{statusText}</p>
            <button
              type="button"
              className="secondary-button body-map-toggle-pill"
              aria-pressed={showBodyMap}
              onClick={() => setShowBodyMap((v) => !v)}
            >
              {showBodyMap ? "收起人体图" : "人体图选肌群"}
            </button>
          </div>
        </div>

        {showBodyMap ? (
          <div className="panel catalogue-body-map-panel">
            <div className="catalogue-body-map-head">
              <div>
                <strong>点击人体部位筛选动作</strong>
                <small className="muted">
                  {muscle ? `当前已选：${MUSCLES[muscle] ?? muscle}（再次点击取消）` : "支持点击正面或背面肌群快速定位动作"}
                </small>
              </div>
              {muscle ? (
                <button type="button" className="quiet" onClick={() => setMuscle("")}>
                  显示全部
                </button>
              ) : null}
            </div>
            <MuscleBodyMap
              size="md"
              showLabels
              scores={muscle ? { [muscle]: 1 } : { chest: 0.35, back: 0.35, shoulders: 0.35, arms: 0.35, core: 0.35, legs: 0.35 }}
              selectedMuscle={muscle}
              onSelectMuscle={(m) => setMuscle(muscle === m ? "" : m)}
            />
          </div>
        ) : null}

        <section id="exercise-results" aria-busy={loading || loadingMore}>
          {scope === "trained" && userId ? (
            <div className="muscle-pills trained-sort-bar" role="group" aria-label="排序方式">
              {(
                [
                  ["recent", "最近练过"],
                  ["1rm", "最高 1RM / PR"],
                  ["sessions", "场次最多"],
                ] as ReadonlyArray<readonly [TrainedSort, string]>
              ).map(([val, lbl]) => (
                <button key={val} type="button" aria-pressed={trainedSort === val} onClick={() => setTrainedSort(val)}>
                  {lbl}
                </button>
              ))}
            </div>
          ) : null}

          {error && !items.length ? (
            <div className="empty">
              <strong>暂时无法加载动作</strong>
              <p>{error}</p>
              <button type="button" className="secondary-button" onClick={() => void fetchCatalogue(false, null)}>
                重试
              </button>
            </div>
          ) : items.length ? (
            <>
              <div className="tile-grid">
                {items.map((ex) => {
                  const isFav = favMap.has(ex.id);
                  const thumb = safeExerciseMediaUrl(ex.thumbnail);
                  const prSummary = ex.sessionsCount
                    ? ex.mode === "timed"
                      ? ex.bestHold != null
                        ? `最佳 ${ex.bestHold}s`
                        : ""
                      : ex.mode === "assisted"
                        ? ex.bestAssistance != null
                          ? `最低辅助 ${fmt(ex.bestAssistance)}kg`
                          : ""
                        : ex.bestWeight != null
                          ? `最佳 ${fmt(ex.bestWeight)}kg${ex.best1rm ? ` · 1RM ${fmt(ex.best1rm)}kg` : ""}`
                          : ""
                    : "";

                  return (
                    <div key={ex.id} className={`exercise-card-shell${isFav ? " is-fav" : ""}`}>
                      <button
                        className="exercise-tile"
                        type="button"
                        onClick={() => openExerciseDetailModal(ex.id, ex.name, customMap.get(ex.id) ?? null)}
                      >
                        <span className={`exercise-art${thumb ? " has-thumb" : " no-thumb"}`} data-muscle={ex.muscle}>
                          {thumb ? (
                            <img src={thumb} width={56} height={56} loading="lazy" decoding="async" alt="" />
                          ) : (
                            <span className="exercise-muscle-glyph" aria-hidden="true">
                              {(MUSCLES[ex.muscle] ?? "练").slice(0, 1)}
                            </span>
                          )}
                          {ex.custom ? <em className="tile-custom-tag">自定义</em> : null}
                        </span>
                        <span className="exercise-tile-copy">
                          <strong>{ex.name}</strong>
                          <small>
                            {MUSCLES[ex.muscle] ?? ex.muscle} · {EQUIPMENT[ex.equipment] ?? ex.equipment}
                          </small>
                        </span>
                        {ex.sessionsCount ? (
                          <span className="exercise-tile-pr">
                            {prSummary ? <b>{prSummary}</b> : null}
                            <small>
                              {ex.sessionsCount} 场 · {shortDate(ex.lastDate ?? "")}
                            </small>
                          </span>
                        ) : null}
                      </button>

                      {userId ? (
                        <button
                          type="button"
                          className={`exercise-fav-btn${isFav ? " is-active" : ""}`}
                          aria-label={isFav ? "取消收藏" : "收藏动作"}
                          aria-pressed={isFav}
                          onClick={() => void handleToggleFav(ex.id)}
                        >
                          <Icon name={isFav ? "starFilled" : "star"} size={15} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <footer className="catalogue-foot">
                {nextCursor ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loadingMore}
                    onClick={() => void fetchCatalogue(true, nextCursor)}
                  >
                    {loadingMore ? "加载中…" : `加载更多${remaining ? ` · 还有 ${fmt(remaining)} 个` : ""}`}
                  </button>
                ) : null}
              </footer>
            </>
          ) : loading ? null : (
            <div className="empty">
              <strong>
                {scope === "trained"
                  ? "暂无匹配的已练动作"
                  : scope === "favorites"
                    ? "还没有符合筛选的收藏动作"
                    : scope === "custom"
                      ? "还没有自定义动作"
                      : "没有找到匹配的动作"}
              </strong>
              <p>
                {nextCursor && equipmentFilter === "__mine__"
                  ? "本页暂未匹配到你的可用器械，可点击下方继续向后检索。"
                  : scope === "trained"
                    ? "记录并完成几次训练后，所有已练动作的个人 PR 都会自动汇集于此。"
                    : scope === "favorites"
                      ? "点击任意动作卡片右上角星标即可快速收藏。"
                      : scope === "custom"
                        ? "点击右上角「自定义动作」录入专属器械或训练动作。"
                        : "试试简称、英文名，或新建自定义动作。"}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {nextCursor ? (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={loadingMore}
                    onClick={() => void fetchCatalogue(true, nextCursor)}
                  >
                    {loadingMore ? "加载中…" : "继续向后检索更多动作"}
                  </button>
                ) : null}
                {userId && (scope === "custom" || scope === "all") ? (
                  <button type="button" className="secondary-button" onClick={() => openCustomExerciseModal()}>
                    新建自定义动作
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
