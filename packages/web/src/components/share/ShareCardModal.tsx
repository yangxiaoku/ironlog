import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { resolveCatalogueMap } from "../../lib/catalogue";
import { today } from "../../lib/date";
import type { DietData, RecordEnvelope, TodayResponse, WorkoutData, WorkoutReportResponse } from "../../lib/domain";
import {
  buildDailySharePayload,
  getSavedShareStyle,
  renderDailyShareCard,
  saveShareStyle,
  SHARE_STYLES,
  type DailySharePayload,
  type RenderedShareCard,
  type ShareAppleEntry,
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

export function ShareCardModal({ date, singleReport = null, singleHealth = null, onBack = null }: ShareCardModalProps) {
  const username = useAuthStore((s) => s.username);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const notify = useUiStore((s) => s.notify);

  const [styleKey, setStyleKey] = useState<ShareStyleId>(() => getSavedShareStyle());
  const [payload, setPayload] = useState<DailySharePayload | null>(null);
  const [rendered, setRendered] = useState<RenderedShareCard | null>(null);
  const [loadingPayload, setLoadingPayload] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const renderSeqRef = useRef(0);

  const targetDate = date || singleReport?.date || today();

  useEffect(() => {
    let active = true;
    setLoadingPayload(true);
    setError("");
    void (async () => {
      try {
        const [workoutsAll, dietsAll, appleDay, todayRes] = await Promise.all([
          singleReport ? Promise.resolve([] as Array<RecordEnvelope<WorkoutData>>) : apiFetch<Array<RecordEnvelope<WorkoutData>>>("/api/records/workout").catch(() => []),
          apiFetch<Array<RecordEnvelope<DietData>>>("/api/records/diet").catch(() => []),
          apiFetch<ShareAppleEntry[]>(`/api/integrations/apple-health/agenda?from=${encodeURIComponent(targetDate)}&through=${encodeURIComponent(targetDate)}`).catch(() => []),
          apiFetch<TodayResponse>("/api/web/today").catch(() => null),
        ]);
        const dayWorkouts = workoutsAll.filter((r) => !r.deleted && r.data?.status === "completed" && r.data?.date === targetDate);
        const dayDiets = dietsAll.filter((r) => !r.deleted && r.data?.date === targetDate);
        const exerciseIds = dayWorkouts.flatMap((w) => (w.data.exercises ?? []).map((e) => e.exerciseId));
        const catalogueMap = exerciseIds.length ? await resolveCatalogueMap(exerciseIds) : null;
        if (!active) return;
        const built = buildDailySharePayload({
          date: targetDate,
          todayKey: today(),
          workouts: singleReport ? [] : dayWorkouts,
          appleEntries: appleDay,
          diets: dayDiets,
          nutrition: todayRes && targetDate === todayRes.date ? todayRes.nutrition : null,
          catalogueMap,
          username,
          singleReport,
          singleHealth,
        });
        setPayload(built);
      } catch (err) {
        if (active) setError((err as Error)?.message || "生成分享数据失败");
      } finally {
        if (active) setLoadingPayload(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [targetDate, singleReport, singleHealth, username]);

  useEffect(() => {
    if (!payload) return;
    const seq = ++renderSeqRef.current;
    setRendering(true);
    void renderDailyShareCard(payload, styleKey)
      .then((res) => {
        if (seq !== renderSeqRef.current) return;
        setRendered(res);
      })
      .catch((err) => {
        if (seq === renderSeqRef.current) notify((err as Error)?.message || "渲染分享图失败");
      })
      .finally(() => {
        if (seq === renderSeqRef.current) setRendering(false);
      });
  }, [payload, styleKey, notify]);

  if (loadingPayload) {
    return (
      <div className="dialog-form share-card-modal">
        <p className="muted" style={{ padding: "20px 0" }}>
          正在整理 {targetDate} 的训练与饮食摘要…
        </p>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="dialog-form share-card-modal">
        <p className="form-error" role="alert">
          {error || "无法生成分享记录卡片"}
        </p>
      </div>
    );
  }

  const canNativeShare = Boolean(
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

  return (
    <div className="dialog-form share-card-modal">
      <div className="share-style-tabs" role="tablist" aria-label="切换分享记录样式">
        {SHARE_STYLES.map((st) => {
          const active = st.id === styleKey;
          return (
            <button
              key={st.id}
              type="button"
              role="tab"
              className={`share-style-tab${active ? " is-active" : ""}`}
              aria-selected={active}
              onClick={() => {
                if (st.id === styleKey) return;
                setStyleKey(st.id);
                saveShareStyle(st.id);
              }}
            >
              <strong>{st.label}</strong>
              <small>{st.desc}</small>
            </button>
          );
        })}
      </div>

      <div className="share-card-frame" aria-busy={rendering}>
        {rendered ? (
          <img className="share-card-preview" id="share-card-preview-img" src={rendered.dataUrl} alt="今日记录分享图预览" />
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
          {rendered ? (
            <a className="primary-button" id="download-share-card" href={rendered.dataUrl} download={rendered.filename}>
              <Icon name="download" size={15} /> 下载 PNG 图片
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
