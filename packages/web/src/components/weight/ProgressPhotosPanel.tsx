import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { shortDate, today } from "../../lib/date";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

export interface ProgressPhotoItem {
  id: string;
  date: string;
  pose: "front" | "side" | "back" | "free";
  mime: string;
  imageData: string;
  note: string;
  createdAt: string;
}

const POSE_LABELS: Record<ProgressPhotoItem["pose"], string> = {
  front: "正面",
  side: "侧面",
  back: "背面",
  free: "自由",
};

async function compressImageToDataUrl(file: File): Promise<string> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("无法读取该图片文件"));
      el.src = bitmapUrl;
    });
    const maxEdge = 1080;
    const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持画布压缩");
    ctx.drawImage(img, 0, 0, w, h);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
    if (dataUrl.length > 900_000) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export function ProgressPhotosPanel() {
  const notify = useUiStore((s) => s.notify);
  const openConfirm = useUiStore((s) => s.openConfirm);

  const [photos, setPhotos] = useState<ProgressPhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [poseFilter, setPoseFilter] = useState<ProgressPhotoItem["pose"] | "all">("all");
  const [uploadPose, setUploadPose] = useState<ProgressPhotoItem["pose"]>("front");
  const [uploadDate, setUploadDate] = useState(() => today());
  const [uploadNote, setUploadNote] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await apiFetch<ProgressPhotoItem[]>("/api/web/progress-photos");
      setPhotos(Array.isArray(list) ? list : []);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const imageData = await compressImageToDataUrl(file);
      const saved = await apiFetch<ProgressPhotoItem>("/api/web/progress-photos", {
        method: "POST",
        body: {
          date: uploadDate || today(),
          pose: uploadPose,
          mime: "image/jpeg",
          imageData,
          note: uploadNote.trim(),
        },
      });
      setPhotos((prev) => [saved, ...prev]);
      setUploadNote("");
      notify("体态进度照片已保存");
    } catch (err) {
      notify((err as Error)?.message || "保存进度照片失败");
    } finally {
      setUploading(false);
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
  const compared = compareIds
    .map((id) => photos.find((p) => p.id === id))
    .filter((p): p is ProgressPhotoItem => Boolean(p))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="panel progress-photos-panel" aria-label="体态进度照片">
      <header className="panel-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2>体态进度照片</h2>
          <p className="muted">本地压缩上传留档，点击任意两张可开启 Before / After 并排对比</p>
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
                <img src={item.imageData} alt={`${item.date} ${POSE_LABELS[item.pose]}`} />
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

      {loading ? (
        <p className="muted">正在加载体态照片…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">暂无体态照片，可上传正面/侧面/背面照片按月追踪变化。</p>
      ) : (
        <div className="progress-photo-grid">
          {filtered.map((item) => {
            const selected = compareIds.includes(item.id);
            return (
              <article key={item.id} className={`progress-photo-card${selected ? " is-selected" : ""}`}>
                <img
                  src={item.imageData}
                  alt={`${item.date} ${POSE_LABELS[item.pose]}`}
                  loading="lazy"
                  onClick={() => toggleCompare(item.id)}
                />
                <div className="progress-photo-meta">
                  <div>
                    <strong>{shortDate(item.date)}</strong>
                    <small className="muted">{POSE_LABELS[item.pose]}{item.note ? ` · ${item.note}` : ""}</small>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
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
