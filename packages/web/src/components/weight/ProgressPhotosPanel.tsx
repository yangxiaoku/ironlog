import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { shortDate, today } from "../../lib/date";
import { safeUuid } from "../../lib/domain";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export interface ProgressPhotoItem {
  id: string;
  date: string;
  pose: "front" | "side" | "back" | "free";
  mime: string;
  imageData?: string;
  thumbnailData?: string | null;
  note: string;
  createdAt: string;
}

const POSE_LABELS: Record<ProgressPhotoItem["pose"], string> = {
  front: "正面",
  side: "侧面",
  back: "背面",
  free: "自由",
};

async function compressImageWithThumbnail(file: File): Promise<{ imageData: string; thumbnailData: string }> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("无法读取该图片文件"));
      el.src = bitmapUrl;
    });
    const renderScaled = (maxEdge: number, quality: number) => {
      const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持画布压缩");
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", quality);
    };
    let imageData = renderScaled(1080, 0.78);
    if (imageData.length > 900_000) {
      imageData = renderScaled(1080, 0.6);
    }
    const thumbnailData = renderScaled(280, 0.68);
    return { imageData, thumbnailData };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export function ProgressPhotosPanel() {
  const notify = useUiStore((s) => s.notify);
  const openConfirm = useUiStore((s) => s.openConfirm);

  const [photos, setPhotos] = useState<ProgressPhotoItem[]>([]);
  const [fullImageById, setFullImageById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [poseFilter, setPoseFilter] = useState<ProgressPhotoItem["pose"] | "all">("all");
  const [uploadPose, setUploadPose] = useState<ProgressPhotoItem["pose"]>("front");
  const [uploadDate, setUploadDate] = useState(() => today());
  const [uploadNote, setUploadNote] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    opId: string;
    date: string;
    pose: ProgressPhotoItem["pose"];
    mime: "image/jpeg";
    imageData: string;
    thumbnailData: string;
    note: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fetchingIdsRef = useRef<Set<string>>(new Set());

  const ensureFullImage = (id: string) => {
    if (fullImageById[id] || fetchingIdsRef.current.has(id)) return;
    fetchingIdsRef.current.add(id);
    void apiFetch<ProgressPhotoItem>(`/api/web/progress-photos/${encodeURIComponent(id)}`)
      .then((full) => {
        if (full?.imageData) {
          setFullImageById((prev) => ({ ...prev, [id]: full.imageData! }));
        }
      })
      .catch(() => {})
      .finally(() => {
        fetchingIdsRef.current.delete(id);
      });
  };

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      // R9 UX-2: Fetch lightweight summary (date, pose, note, thumbnailData) first instead of all full-res Base64s.
      const list = await apiFetch<ProgressPhotoItem[]>("/api/web/progress-photos?mode=summary");
      const safeList = Array.isArray(list) ? list : [];
      setPhotos(safeList);
      for (const item of safeList) {
        if (item.imageData) {
          setFullImageById((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: item.imageData! }));
        }
      }
    } catch (err) {
      // #89: Preserve last visible photos and surface load error with retry instead of claiming empty gallery.
      setLoadError((err as Error)?.message || "体态照片加载失败，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Load full-res images lazily for selected compare items, active viewer, or legacy items lacking thumbnailData
  useEffect(() => {
    for (const id of compareIds) ensureFullImage(id);
    if (viewingId) ensureFullImage(viewingId);
  }, [compareIds, viewingId]);

  useEffect(() => {
    const visibleMissingThumb = photos.filter((p) => !p.thumbnailData && !p.imageData && !fullImageById[p.id]).slice(0, 6);
    for (const item of visibleMissingThumb) ensureFullImage(item.id);
  }, [photos, fullImageById]);

  const submitPhotoUpload = async (req: {
    opId: string;
    date: string;
    pose: ProgressPhotoItem["pose"];
    mime: "image/jpeg";
    imageData: string;
    thumbnailData: string;
    note: string;
  }) => {
    setUploading(true);
    try {
      const saved = await apiFetch<ProgressPhotoItem & { deleted?: boolean; message?: string }>(
        "/api/web/progress-photos",
        {
          method: "POST",
          body: req,
        },
      );
      if (saved.deleted) {
        // #88: Original upload was already deleted on another device; refresh gallery instead of faking success.
        setPendingUpload(null);
        void load();
        notify(saved.message || "该照片已在其他设备删除，如需保留请重新选择上传");
        return;
      }
      setPhotos((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      if (saved.imageData) {
        setFullImageById((prev) => ({ ...prev, [saved.id]: saved.imageData! }));
      }
      setPendingUpload(null);
      setUploadNote("");
      setLoadError("");
      notify("体态进度照片已保存");
    } catch (err) {
      setPendingUpload(req);
      notify((err as Error)?.message || "保存进度照片失败，可点击重试（不会重复生成）");
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { imageData, thumbnailData } = await compressImageWithThumbnail(file);
      const req = {
        opId: safeUuid(),
        date: uploadDate || today(),
        pose: uploadPose,
        mime: "image/jpeg" as const,
        imageData,
        thumbnailData,
        note: uploadNote.trim(),
      };
      setPendingUpload(req);
      await submitPhotoUpload(req);
    } catch (err) {
      setUploading(false);
      notify((err as Error)?.message || "保存进度照片失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = (item: ProgressPhotoItem) => {
    openConfirm({
      title: "删除体态照片",
      message: `确定删除 ${shortDate(item.date)}（${POSE_LABELS[item.pose]}）的进度照片吗？`,
      confirmLabel: "删除照片",
      onConfirm: async () => {
        await apiFetch(`/api/web/progress-photos/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        setPhotos((prev) => prev.filter((p) => p.id !== item.id));
        setCompareIds((prev) => prev.filter((id) => id !== item.id));
        if (viewingId === item.id) setViewingId(null);
        notify("已删除体态照片");
      },
    });
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  };

  const filtered = poseFilter === "all" ? photos : photos.filter((p) => p.pose === poseFilter);
  const selectedItems = compareIds
    .map((id) => photos.find((p) => p.id === id))
    .filter((p): p is ProgressPhotoItem => Boolean(p));
  const compared = [...selectedItems].sort((a, b) => a.date.localeCompare(b.date));
  const viewingItem = viewingId ? photos.find((p) => p.id === viewingId) ?? null : null;

  return (
    <section className="panel progress-photos-panel" aria-label="体态进度照片">
      <header className="panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2>体态进度照片</h2>
          <p className="muted">本地压缩上传留档，点击卡片查看大图，勾选任意两张开启 Before / After 并排对比</p>
        </div>
        <div className="progress-photo-upload-controls">
          <input
            type="date"
            value={uploadDate}
            max={today()}
            onChange={(e) => setUploadDate(e.target.value)}
            aria-label="照片日期"
          />
          <select
            value={uploadPose}
            onChange={(e) => setUploadPose(e.target.value as ProgressPhotoItem["pose"])}
            aria-label="拍照姿势"
          >
            {(Object.entries(POSE_LABELS) as Array<[ProgressPhotoItem["pose"], string]>).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>
          <input
            type="text"
            maxLength={100}
            value={uploadNote}
            placeholder="备注（选填）"
            onChange={(e) => setUploadNote(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => void handleFileChange(e.target.files?.[0])}
          />
          <button
            type="button"
            className="primary-button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={14} /> {uploading ? "压缩保存中…" : "上传照片"}
          </button>
        </div>
      </header>

      {pendingUpload && !uploading ? (
        <div
          className="form-error"
          role="status"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}
        >
          <span>上次上传未收到确认回执，点击重试将沿用同一操作 ID 防止重复保存</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="micro-chip"
              onClick={() => void submitPhotoUpload(pendingUpload)}
            >
              重试原上传
            </button>
            <button type="button" className="quiet" onClick={() => setPendingUpload(null)}>
              取消
            </button>
          </span>
        </div>
      ) : null}

      {loadError ? (
        <div
          className="form-error"
          role="alert"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}
        >
          <span>{loadError}</span>
          <button type="button" className="micro-chip" onClick={() => void load()}>
            重新加载
          </button>
        </div>
      ) : null}

      {viewingItem ? (
        <div className="photo-compare-box" style={{ marginBottom: 12 }}>
          <div className="photo-compare-head">
            <strong>
              {shortDate(viewingItem.date)} · {POSE_LABELS[viewingItem.pose]}
              {viewingItem.note ? ` · ${viewingItem.note}` : ""}
            </strong>
            <button type="button" className="quiet" onClick={() => setViewingId(null)}>
              关闭原图
            </button>
          </div>
          <figure className="photo-compare-item" style={{ maxWidth: 420, margin: "8px auto 0" }}>
            <img
              src={fullImageById[viewingItem.id] || viewingItem.imageData || viewingItem.thumbnailData || ""}
              alt={`${viewingItem.date} ${POSE_LABELS[viewingItem.pose]}`}
            />
          </figure>
        </div>
      ) : null}

      {compared.length === 2 ? (
        <div className="photo-compare-box">
          <div className="photo-compare-head">
            <strong>前后对比（Before → After）</strong>
            <button type="button" className="quiet" onClick={() => setCompareIds([])}>
              退出对比
            </button>
          </div>
          <div className="photo-compare-grid">
            {compared.map((item, idx) => (
              <figure key={item.id} className="photo-compare-item">
                <img
                  src={fullImageById[item.id] || item.imageData || item.thumbnailData || ""}
                  alt={`${item.date} ${POSE_LABELS[item.pose]}`}
                />
                <figcaption>
                  <b>{idx === 0 ? "Before" : "After"} · {shortDate(item.date)}</b>
                  <span>{POSE_LABELS[item.pose]}{item.note ? ` · ${item.note}` : ""}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      <div className="segments" role="group" aria-label="按姿势筛选" style={{ marginBottom: 12 }}>
        {(["all", "front", "side", "back", "free"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={poseFilter === k} onClick={() => setPoseFilter(k)}>
            {k === "all" ? `全部 (${photos.length})` : POSE_LABELS[k]}
          </button>
        ))}
      </div>

      {/* R9 UX-1: Keep selected compare photos visible with pose & remove/clear actions across pose filter switches */}
      {selectedItems.length > 0 ? (
        <div className="progress-photo-compare-bar" role="status">
          <span>已选对比 {selectedItems.length}/2：</span>
          {selectedItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="micro-chip"
              title="点击移除该对比项"
              onClick={() => toggleCompare(item.id)}
            >
              {shortDate(item.date)} · {POSE_LABELS[item.pose]} ×
            </button>
          ))}
          <button type="button" className="quiet" onClick={() => setCompareIds([])}>
            清空已选
          </button>
        </div>
      ) : null}

      {loading && photos.length === 0 ? (
        <p className="muted">正在加载体态照片…</p>
      ) : !loadError && filtered.length === 0 ? (
        <p className="muted">
          {photos.length === 0
            ? "暂无体态照片，可上传正面/侧面/背面照片按月追踪变化。"
            : `当前「${poseFilter === "all" ? "全部" : POSE_LABELS[poseFilter]}」筛选下暂无照片。`}
        </p>
      ) : (
        <div className="progress-photo-grid">
          {filtered.map((item) => {
            const selected = compareIds.includes(item.id);
            const previewSrc = item.thumbnailData || fullImageById[item.id] || item.imageData || "";
            return (
              <article key={item.id} className={`progress-photo-card${selected ? " is-selected" : ""}`}>
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt={`${item.date} ${POSE_LABELS[item.pose]}`}
                    loading="lazy"
                    onClick={() => setViewingId(item.id)}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "3 / 4",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      color: "var(--muted)",
                    }}
                    onClick={() => setViewingId(item.id)}
                  >
                    加载中…
                  </div>
                )}
                <div className="progress-photo-meta">
                  <div className="progress-photo-meta-text">
                    <strong>{shortDate(item.date)}</strong>
                    <small className="muted" title={item.note || undefined}>
                      {POSE_LABELS[item.pose]}{item.note ? ` · ${item.note}` : ""}
                    </small>
                  </div>
                  <div className="progress-photo-actions">
                    <button
                      type="button"
                      className="quiet"
                      aria-pressed={selected}
                      onClick={() => toggleCompare(item.id)}
                    >
                      {selected ? "已选" : "对比"}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="删除照片"
                      onClick={() => handleDelete(item)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
