import type { ReactNode } from "react";
import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { flushQueue, readQueue } from "../lib/offline-queue";
import { parseHashView, type ViewId } from "../lib/routes";

export type ThemeMode = "dark" | "light";
export type ModalLayout = "" | "menu" | "workout" | "report" | "badge" | "exercise" | "onboarding";
export type PlanTab = "current" | "horizon" | "starters" | "templates" | "drafts";
export type SettingsTab = "statistics" | "profile" | "devices" | "ai" | "account";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastState {
  id: number;
  message: string;
  action?: ToastAction | null;
}

export interface ModalEntry {
  id: number;
  title: string;
  wide?: boolean;
  layout?: ModalLayout;
  headerAction?: ReactNode;
  onClose?: () => void;
  content: ReactNode;
}

export interface ConfirmEntry {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}

export interface UiState {
  view: ViewId;
  planTab: PlanTab;
  settingsTab: SettingsTab;
  theme: ThemeMode;
  online: boolean;
  pendingSyncCount: number;
  flushingQueue: boolean;
  dataEpoch: number;
  toast: ToastState | null;
  modals: ModalEntry[];
  confirm: ConfirmEntry | null;
  silentCloseSeq: number;
  setView: (view: ViewId) => void;
  navigate: (view: ViewId) => void;
  setPlanTab: (tab: PlanTab) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  openPlanSection: (tab: PlanTab) => void;
  openSettingsSection: (tab: SettingsTab) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setOnline: (online: boolean) => void;
  refreshPendingCount: (userId: string) => void;
  syncOfflineQueue: (userId: string, opts?: { silent?: boolean }) => Promise<void>;
  bumpDataEpoch: () => void;
  notify: (message: string, action?: ToastAction | null) => void;
  dismissToast: (id?: number) => void;
  openModal: (entry: Omit<ModalEntry, "id">) => number;
  closeTopModal: () => void;
  closeAllModals: () => void;
  closeModalSilent: () => void;
  openConfirm: (entry: ConfirmEntry) => void;
  closeConfirm: () => void;
}

function getInitialTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "dark";
  return localStorage.getItem("ironlog-web-theme") === "light" ? "light" : "dark";
}

export function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f4f4f1" : "#000000";
  try {
    localStorage.setItem("ironlog-web-theme", theme);
  } catch {}
}

let modalCounter = 0;
let toastCounter = 0;
let toastTimer: number | undefined;

const initialTheme = getInitialTheme();
applyThemeToDom(initialTheme);

export const useUiStore = create<UiState>((set, get) => ({
  view: typeof location !== "undefined" ? parseHashView(location.hash) : "overview",
  planTab: "current",
  settingsTab: "statistics",
  theme: initialTheme,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  pendingSyncCount: 0,
  flushingQueue: false,
  dataEpoch: 0,
  toast: null,
  modals: [],
  confirm: null,
  silentCloseSeq: 0,

  setView(view) {
    set({ view });
  },

  navigate(view) {
    set({ view });
    if (typeof location !== "undefined" && location.hash.slice(1) !== view) {
      try {
        if (typeof history !== "undefined" && typeof history.replaceState === "function") {
          const nextUrl = `${location.pathname}${location.search}#${view}`;
          history.replaceState(history.state, "", nextUrl);
        } else {
          location.hash = view;
        }
      } catch {
        location.hash = view;
      }
    }
  },

  setPlanTab(planTab) {
    set({ planTab });
  },

  setSettingsTab(settingsTab) {
    set({ settingsTab });
  },

  openPlanSection(planTab) {
    set({ planTab });
    get().navigate("plan");
  },

  openSettingsSection(settingsTab) {
    set({ settingsTab });
    get().navigate("settings");
  },

  setTheme(theme) {
    applyThemeToDom(theme);
    set({ theme });
  },

  toggleTheme() {
    const next: ThemeMode = get().theme === "dark" ? "light" : "dark";
    applyThemeToDom(next);
    set({ theme: next });
  },

  setOnline(online) {
    set({ online });
  },

  refreshPendingCount(userId) {
    if (typeof localStorage === "undefined" || !userId) {
      set({ pendingSyncCount: 0 });
      return;
    }
    set({ pendingSyncCount: readQueue(localStorage, userId).length });
  },

  async syncOfflineQueue(userId, { silent = false } = {}) {
    if (!userId || get().flushingQueue || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    if (typeof localStorage === "undefined") return;
    if (readQueue(localStorage, userId).length === 0) {
      set({ pendingSyncCount: 0 });
      return;
    }
    set({ flushingQueue: true });
    try {
      const res = await flushQueue(localStorage, userId, (path, opts) => apiFetch(path, opts));
      get().refreshPendingCount(userId);
      if (res.synced > 0) {
        get().bumpDataEpoch();
        get().notify(`已自动同步 ${res.synced} 条离线记录`);
      } else if (!silent && res.stoppedOffline) {
        get().notify("网络仍不稳定，待恢复后继续自动同步");
      } else if (!silent && res.authRequired) {
        get().notify("登录已过期，请重新登录后同步离线记录");
      }
      if (res.dropped.length > 0) {
        get().notify(`${res.dropped.length} 条离线记录与服务端冲突，已保留最新服务端版本`);
      }
    } finally {
      set({ flushingQueue: false });
    }
  },

  bumpDataEpoch() {
    set((s) => ({ dataEpoch: s.dataEpoch + 1 }));
  },

  notify(message, action = null) {
    const id = ++toastCounter;
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    set({ toast: { id, message, action } });
    if (typeof window !== "undefined") {
      const ms = action?.label ? 4500 : 1900;
      toastTimer = window.setTimeout(() => {
        if (get().toast?.id === id) {
          set({ toast: null });
        }
      }, ms);
    }
  },

  dismissToast(id) {
    if (id !== undefined && get().toast?.id !== id) return;
    set({ toast: null });
  },

  openModal(entry) {
    const id = ++modalCounter;
    set((s) => ({ modals: [...s.modals, { ...entry, id }] }));
    return id;
  },

  closeTopModal() {
    const closing = get().modals.at(-1);
    set((s) => ({
      modals: s.modals.slice(0, -1),
      confirm: null,
    }));
    try {
      closing?.onClose?.();
    } catch {}
  },

  closeAllModals() {
    const closing = get().modals;
    set({ modals: [], confirm: null });
    for (const entry of closing) {
      try {
        entry.onClose?.();
      } catch {}
    }
  },

  closeModalSilent() {
    const closing = get().modals;
    set((s) => ({
      modals: [],
      confirm: null,
      silentCloseSeq: s.silentCloseSeq + 1,
    }));
    for (const entry of closing) {
      try {
        entry.onClose?.();
      } catch {}
    }
  },

  openConfirm(entry) {
    set({ confirm: entry });
  },

  closeConfirm() {
    set({ confirm: null });
  },
}));
