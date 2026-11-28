import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { resolveCatalogueMap } from "../../lib/catalogue";
import { today } from "../../lib/date";
import type { CatalogueExercise, DietData, RecordEnvelope, TodayResponse, WorkoutData, WorkoutReportResponse } from "../../lib/domain";
import {
  buildDailySharePayload,
  getSavedShareStyle,
  renderDailyShareCard,
  saveShareStyle,
  SHARE_STYLES,
  type RenderedShareCard,
  type ShareAppleEntry,
  type SharePrivacyOptions,
  type ShareStyleId,
} from "../../lib/share-card";
import { useAuthStore } from "../../store/useAuthStore";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export interface ShareCardModalProps {
  date?: string;
  singleReport?: WorkoutReportResponse | null;
  singleHealth?: ShareAppleEntry | null;
  onBack?: (() => void) | null;
}

interface ShareSourceBundle {
  workouts: Array<RecordEnvelope<WorkoutData>>;
  diets: Array<RecordEnvelope<DietData>>;
  appleEntries: ShareAppleEntry[];
  todayRes: TodayResponse | null;
  catalogueMap: Map<string, CatalogueExercise> | null;
  failedSources: string[];
}

export function ShareCardModal({ date, singleReport = null, singleHealth = null, onBack = null }: ShareCardModalProps) {
  const username = useAuthStore((s) => s.username);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const notify = useUiStore((s) => s.notify);

  const [styleKey, setStyleKey] = useState<ShareStyleId>(() => getSavedShareStyle());
  const [bundle, setBundle] = useState<ShareSourceBundle | null>(null);
  const [rendered, setRendered] = useState<RenderedShareCard | null>(null);
  const [loadingPayload, setLoadingPayload] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [allowPartialExport, setAllowPartialExport] = useState(false);
  const [privacy, setPrivacy] = useState<SharePrivacyOptions>({
    hideUsername: false,
    hideDiet: false,
    hideHeartRate: false,
  });
  const [statusAnnouncement, setStatusAnnouncement] = useState("");
  const renderSeqRef = useRef(0);
  const lastObjectUrlRef = useRef<string | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const targetDate = date || singleReport?.date || singleHealth?.date || today();
  const isSingleHealth = Boolean(singleHealth && !singleReport);
  const isSingleReport = Boolean(singleReport);

  useEffect(() => {
    let active = true;
    setLoadingPayload(true);
    setError("");
    setAllowPartialExport(false);
    void (async () => {
      try {
        if (isSingleHealth) {
          // #136: Single Apple Health workout poster strictly uses only singleHealth
          if (!active) return;
          setBundle({
            workouts: [],
            diets: [],
            appleEntries: [],
            todayRes: null,
            catalogueMap: null,
            failedSources: [],
          });
          return;
        }

        const failedSources: string[] = [];

        if (isSingleReport && singleReport) {
          // #136: Single workout poster never fetches day's diets or other workouts; only checks linked Apple entry
          const appleDay = await apiFetch<ShareAppleEntry[]>(
            `/api/integrations/apple-health/agenda?from=${encodeURIComponent(targetDate)}&through=${encodeURIComponent(targetDate)}`,
          ).catch(() => {
            failedSources.push("Apple 健康联动指标");
            return [] as ShareAppleEntry[];
          });
          const exIds = (singleReport.exercises ?? []).map((e) => e.exerciseId).filter(Boolean);
          const catalogueMap = exIds.length ? await resolveCatalogueMap(exIds).catch(() => null) : null;
          if (!active) return;
          setBundle({
            workouts: [],
            diets: [],
            appleEntries: appleDay,
            todayRes: null,
            catalogueMap,
            failedSources,
          });
          return;
        }

        // Daily share mode: track per-source errors instead of silently swallowing (#143)
        const [workoutsRes, dietsRes, appleRes, todayRes] = await Promise.all([
          apiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout")
            .then((data) => ({ ok: true as const, data }))
            .catch(() => ({ ok: false as const, data: [] as Array<RecordEnvelope<WorkoutData>> })),
          apiFetch<Array<RecordEnvelope<DietData>>>("/api/records/diet")
            .then((data) => ({ ok: true as const, data }))
            .catch(() => ({ ok: false as const, data: [] as Array<RecordEnvelope<DietData>> })),
          apiFetch<ShareAppleEntry[]>(
            `/api/integrations/apple-health/agenda?from=${encodeURIComponent(targetDate)}&through=${encodeURIComponent(targetDate)}`,
          )
            .then((data) => ({ ok: true as const, data }))
            .catch(() => ({ ok: false as const, data: [] as ShareAppleEntry[] })),
          apiFetch<TodayResponse>("/api/web/today").catch(() => null),
        ]);

        if (!workoutsRes.ok) failedSources.push("训练记录");
        if (!dietsRes.ok) failedSources.push("饮食记录");
        if (!appleRes.ok) failedSources.push("Apple 健康活动");

        const dayWorkouts = workoutsRes.data.filter(
          (r) => !r.deleted && r.data?.status === "completed" && r.data?.date === targetDate,
        );
        const dayDiets = dietsRes.data.filter((r) => !r.deleted && r.data?.date === targetDate);
        const exerciseIds = dayWorkouts.flatMap((w) => (w.data.exercises ?? []).map((e) => e.exerciseId));
        const catalogueMap = exerciseIds.length ? await resolveCatalogueMap(exerciseIds).catch(() => null) : null;
        if (!active) return;
        setBundle({
          workouts: dayWorkouts,
          diets: dayDiets,
          appleEntries: appleRes.data,
          todayRes,
          catalogueMap,
          failedSources,
        });
      } catch (err) {
        if (active) setError((err as Error)?.message || "生成分享数据失败");
      } finally {
        if (active) setLoadingPayload(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [targetDate, singleReport, singleHealth, isSingleHealth, isSingleReport, retryNonce]);

  const payload = useMemo(() => {
    if (!bundle) return null;
    return buildDailySharePayload({
      date: targetDate,
      todayKey: today(),
      workouts: isSingleReport ? [] : bundle.workouts,
      appleEntries: bundle.appleEntries,
      diets: bundle.diets,
      nutrition: bundle.todayRes && targetDate === bundle.todayRes.date ? bundle.todayRes.nutrition : null,
      catalogueMap: bundle.catalogueMap,
      username,
      singleReport,
      singleHealth,
      privacy,
    });
  }, [bundle, targetDate, isSingleReport, username, singleReport, singleHealth, privacy]);

  useEffect(() => {
    if (!payload) return;
    const seq = ++renderSeqRef.current;
    setRendering(true);
    setStatusAnnouncement(`正在绘制「${SHARE_STYLES.find((s) => s.id === styleKey)?.label ?? styleKey}」海报…`);
    void renderDailyShareCard(payload, styleKey)
      .then((res) => {
        if (seq !== renderSeqRef.current) {
          if (res.dataUrl.startsWith("blob:")) URL.revokeObjectURL(res.dataUrl);
          return;
        }
        const prevUrl = lastObjectUrlRef.current;
        if (prevUrl && prevUrl !== res.dataUrl && prevUrl.startsWith("blob:")) {
          URL.revokeObjectURL(prevUrl);
        }
        lastObjectUrlRef.current = res.dataUrl;
        setRendered(res);
        setStatusAnnouncement(`「${SHARE_STYLES.find((s) => s.id === styleKey)?.label ?? styleKey}」海报已就绪`);
      })
      .catch((err) => {
        if (seq === renderSeqRef.current) {
          setStatusAnnouncement("海报渲染失败");
          notify((err as Error)?.message || "渲染分享图失败");
        }
      })
      .finally(() => {
        if (seq === renderSeqRef.current) setRendering(false);
      });
  }, [payload, styleKey, notify]);

  // Revoke final blob URL on unmount
  useEffect(() => {
    return () => {
      if (lastObjectUrlRef.current && lastObjectUrlRef.current.startsWith("blob:")) {
        URL.revokeObjectURL(lastObjectUrlRef.current);
        lastObjectUrlRef.current = null;
      }
    };
  }, []);

  if (loadingPayload) {
    return (
      <div className="dialog-form share-card-modal">
        <p className="muted" style={{ padding: "20px 0" }}>
          正在整理 {targetDate} 的分享摘要…
        </p>
      </div>
    );
  }

  if (error || !payload || !bundle) {
    return (
      <div className="dialog-form share-card-modal">
        <p className="form-error" role="alert">
          {error || "无法生成分享记录卡片"}
        </p>
        <div className="report-foot-actions">
          <button type="button" className="secondary-button" onClick={() => setRetryNonce((n) => n + 1)}>
            重试
          </button>
        </div>
      </div>
    );
  }

  const hasFailures = bundle.failedSources.length > 0;
  // #142: Lock download & share until the rendered PNG matches the currently selected styleKey (and partial export confirmed if any source failed)
  const styleMatched = Boolean(rendered && !rendering && rendered.styleKey === styleKey);
  const exportUnlocked = styleMatched && (!hasFailures || allowPartialExport);

  const canNativeShare = Boolean(
    exportUnlocked &&
      rendered &&
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      (() => {
        try {
          return navigator.canShare({ files: [new File([rendered.blob], rendered.filename, { type: "image/png" })] });
        } catch {
          return false;
        }
      })(),
  );

  const selectStyle = (nextId: ShareStyleId, focusIdx?: number) => {
    if (nextId !== styleKey) {
      setStyleKey(nextId);
      saveShareStyle(nextId);
    }
    if (typeof focusIdx === "number") {
      tabRefs.current[focusIdx]?.focus();
    }
  };

  return (
    <div className="dialog-form share-card-modal">
      {hasFailures ? (
        <div className="form-error" role="alert" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--red)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span>部分数据加载失败：{bundle.failedSources.join("、")}，当前海报内容可能不完整。</span>
            <button type="button" className="micro-chip" onClick={() => setRetryNonce((n) => n + 1)}>
              重试加载
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={allowPartialExport}
              onChange={(e) => setAllowPartialExport(e.target.checked)}
            />
            <span>我已知晓以上缺项，仍按当前已获取范围导出海报</span>
          </label>
        </div>
      ) : null}

      <div
        className="share-style-tabs"
        role="tablist"
        aria-label="切换分享记录样式"
        onKeyDown={(e) => {
          const curIdx = SHARE_STYLES.findIndex((s) => s.id === styleKey);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            const next = (curIdx + 1) % SHARE_STYLES.length;
            selectStyle(SHARE_STYLES[next]!.id, next);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            const prev = (curIdx - 1 + SHARE_STYLES.length) % SHARE_STYLES.length;
            selectStyle(SHARE_STYLES[prev]!.id, prev);
          } else if (e.key === "Home") {
            e.preventDefault();
            selectStyle(SHARE_STYLES[0]!.id, 0);
          } else if (e.key === "End") {
            e.preventDefault();
            const last = SHARE_STYLES.length - 1;
            selectStyle(SHARE_STYLES[last]!.id, last);
          }
        }}
      >
        {SHARE_STYLES.map((st, idx) => {
          const active = st.id === styleKey;
          return (
            <button
              key={st.id}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              type="button"
              role="tab"
              tabIndex={active ? 0 : -1}
              className={`share-style-tab${active ? " is-active" : ""}`}
              aria-selected={active}
              onClick={() => selectStyle(st.id)}
            >
              <strong>{st.label}</strong>
              <small>{st.desc}</small>
            </button>
          );
        })}
      </div>

      {/* R13 UX: Privacy toggles before exporting */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12.5 }}>
        <span className="muted">隐私选项：</span>
        <label className="micro-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={Boolean(privacy.hideUsername)}
            onChange={(e) => setPrivacy((p) => ({ ...p, hideUsername: e.target.checked }))}
          />
          <span>隐藏账号名</span>
        </label>
        {!isSingleReport && !isSingleHealth ? (
          <label className="micro-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={Boolean(privacy.hideDiet)}
              onChange={(e) => setPrivacy((p) => ({ ...p, hideDiet: e.target.checked }))}
            />
            <span>隐藏饮食</span>
          </label>
        ) : null}
        <label className="micro-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={Boolean(privacy.hideHeartRate)}
            onChange={(e) => setPrivacy((p) => ({ ...p, hideHeartRate: e.target.checked }))}
          />
          <span>隐藏心率</span>
        </label>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {statusAnnouncement}
      </span>

      <div className="share-card-frame" aria-busy={rendering}>
        {rendered ? (
          <img
            className="share-card-preview"
            id="share-card-preview-img"
            src={rendered.dataUrl}
            alt="记录分享图预览"
            style={rendering || rendered.styleKey !== styleKey ? { opacity: 0.55 } : undefined}
          />
        ) : (
          <p className="muted" style={{ padding: "40px 0", textAlign: "center" }}>
            正在绘制海报…
          </p>
        )}
      </div>

      <footer className="report-foot-actions">
        <div className="report-foot-secondary">
          {onBack ? (
            <button type="button" className="quiet" onClick={onBack}>
              返回
            </button>
          ) : (
            <button type="button" className="quiet" onClick={closeAllModals}>
              关闭
            </button>
          )}
        </div>
        <div className="share-card-actions">
          {canNativeShare && rendered ? (
            <button
              type="button"
              className="secondary-button"
              disabled={!exportUnlocked}
              onClick={() => {
                void (async () => {
                  try {
                    const file = new File([rendered.blob], rendered.filename, { type: "image/png" });
                    await navigator.share({ title: `${payload.dateDot} ${payload.headline}`, files: [file] });
                  } catch {}
                })();
              }}
            >
              系统分享
            </button>
          ) : null}
          {exportUnlocked && rendered && !canNativeShare ? (
            <small className="muted" style={{ fontSize: 11.5 }}>
              手机可长按上方海报直接存相册
            </small>
          ) : null}
          {exportUnlocked && rendered ? (
            <a className="primary-button" id="download-share-card" href={rendered.dataUrl} download={rendered.filename}>
              <Icon name="download" size={15} /> 下载 PNG 图片
            </a>
          ) : (
            <button type="button" className="primary-button" id="download-share-card" disabled>
              <Icon name="download" size={15} /> {rendering || !styleMatched ? "正在生成新样式…" : "请先确认缺项或重试"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
