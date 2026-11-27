import type { ReactNode } from "react";
import { create } from "zustand";
import { ApiError, apiFetch } from "../lib/api";
import { copyText } from "../lib/clipboard";
import { flushQueue, getOfflineStorage, readQueue } from "../lib/offline-queue";
import { isValidView, parseHashView, type ViewId } from "../lib/routes";
import { useAuthStore } from "./useAuthStore";

export type ThemeMode = "dark" | "light";
export type ModalLayout = "" | "menu" | "workout" | "cardio" | "report" | "badge" | "exercise" | "onboarding";
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
  innerOverlayDismiss: (() => void) | null;
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
  syncOfflineQueue: (userId: string, opts?: { silent?: boolean; attempt?: number }) => Promise<void>;
  bumpDataEpoch: () => void;
  notify: (message: string, action?: ToastAction | null) => void;
  dismissToast: (id?: number) => void;
  openModal: (entry: Omit<ModalEntry, "id">) => number;
  updateTopModalTitle: (title: string) => void;
  closeTopModal: () => void;
  closeAllModals: () => void;
  closeModalSilent: () => void;
  openConfirm: (entry: ConfirmEntry) => void;
  closeConfirm: () => void;
  setInnerOverlayDismiss: (fn: (() => void) | null) => void;
}

function getInitialTheme(): ThemeMode {
  if (typeof localStorage === "undefined") return "dark";
  return localStorage.getItem("ironlog-web-theme") === "light" ? "light" : "dark";
}

export function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f6f6f3" : "#09090b";
  try {
    localStorage.setItem("ironlog-web-theme", theme);
  } catch {}
}

let modalCounter = 0;
let toastCounter = 0;
let toastTimer: number | undefined;
const flushingAccounts = new Set<string>();
const retryTimersByAccount = new Map<string, number>();
const OFFLINE_RETRY_DELAYS_MS = [1500, 4000, 10000] as const;

function clearRetryTimer(userId: string): void {
  const existing = retryTimersByAccount.get(userId);
  if (existing !== undefined && typeof window !== "undefined") {
    window.clearTimeout(existing);
  }
  retryTimersByAccount.delete(userId);
}

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
  innerOverlayDismiss: null,
  silentCloseSeq: 0,

  setView(view) {
    set({ view: isValidView(view) ? view : "overview" });
  },

  navigate(view) {
    const safeView: ViewId = isValidView(view) ? view : "overview";
    set({ view: safeView });
    if (typeof location !== "undefined" && location.hash.slice(1) !== safeView) {
      try {
        if (typeof history !== "undefined" && typeof history.replaceState === "function") {
          const nextUrl = `${location.pathname}${location.search}#${safeView}`;
          history.replaceState(history.state, "", nextUrl);
        } else {
          location.hash = safeView;
        }
      } catch {
        location.hash = safeView;
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
    set({ pendingSyncCount: readQueue(getOfflineStorage(), userId).length });
  },

  async syncOfflineQueue(userId, { silent = false, attempt = 0 } = {}) {
    if (!userId || flushingAccounts.has(userId) || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const { demoToken } = useAuthStore.getState();
    const isCurrentAccount = () => {
      const current = useAuthStore.getState();
      return current.userId === userId && current.demoToken === demoToken;
    };
    if (!isCurrentAccount()) return;
    const storage = getOfflineStorage();
    if (!storage) return;
    clearRetryTimer(userId);
    const before = readQueue(storage, userId);
    flushingAccounts.add(userId);
    set({ flushingQueue: true });
    try {
      const res = await flushQueue(storage, userId, (path, opts) => {
        if (!isCurrentAccount()) throw new ApiError("账号已切换", 401);
        return apiFetch(path, { ...opts, accountId: userId, token: demoToken, skipMutateHook: true });
      });
      if (!isCurrentAccount()) return;
      get().refreshPendingCount(userId);
      if (res.synced > 0) get().bumpDataEpoch();
      const unblockedRemaining = Math.max(0, res.remaining - res.blocked.length);
      // #69: Bounded backoff auto-retry on transient 5xx/429/408 errors, isolated per account
      if (
        res.transientFailure &&
        unblockedRemaining > 0 &&
        attempt < OFFLINE_RETRY_DELAYS_MS.length &&
        typeof window !== "undefined"
      ) {
        const delayMs = OFFLINE_RETRY_DELAYS_MS[attempt]!;
        const timerId = window.setTimeout(() => {
          retryTimersByAccount.delete(userId);
          if (!isCurrentAccount()) return;
          if (typeof navigator !== "undefined" && !navigator.onLine) return;
          void get().syncOfflineQueue(userId, { silent: true, attempt: attempt + 1 });
        }, delayMs);
        retryTimersByAccount.set(userId, timerId);
      }
      if (res.storageError) {
        if (!silent || before.length > 0) get().notify("浏览器暂时无法读取或更新离线记录");
      } else if (res.blocked.length > 0 && (!silent || res.blocked.length > before.filter((item) => item.failure).length)) {
        get().notify(`${res.blocked.length} 条离线记录待处理，原内容保存在本机`, {
          label: "复制记录",
          onClick: async () => {
            if (!isCurrentAccount()) return;
            const copied = await copyText(JSON.stringify(res.blocked, null, 2));
            get().notify(copied ? "待处理的记录已复制" : "浏览器无法复制，记录仍保存在本机");
          },
        });
      } else if (res.synced > 0) {
        get().notify(`已自动同步 ${res.synced} 条离线记录`);
      } else if (!silent && res.stoppedOffline) {
        get().notify("网络仍不稳定，待恢复后继续自动同步");
      } else if (!silent && res.authRequired) {
        get().notify("登录已过期，请重新登录后同步离线记录");
      } else if (!silent && res.remaining > 0) {
        get().notify(`服务器暂时无法接收（剩 ${res.remaining} 条待同步），将自动重试`);
      }
    } finally {
      flushingAccounts.delete(userId);
      set({ flushingQueue: flushingAccounts.size > 0 });
      // #70: If user switched to another account while this flush was in flight, re-check the active account's queue!
      const active = useAuthStore.getState();
      if (
        active.userId &&
        active.userId !== userId &&
        !active.offlineBoot &&
        !flushingAccounts.has(active.userId) &&
        (typeof navigator === "undefined" || navigator.onLine)
      ) {
        const activePending = readQueue(getOfflineStorage(), active.userId).filter((item) => !item.failure).length;
        if (activePending > 0) {
          void get().syncOfflineQueue(active.userId, { silent: true });
        }
      }
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

  updateTopModalTitle(title) {
    set((s) => {
      if (!s.modals.length) return s;
      const next = [...s.modals];
      const top = next[next.length - 1]!;
      next[next.length - 1] = { ...top, title };
      return { modals: next };
    });
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
    set({ modals: [], confirm: null, innerOverlayDismiss: null });
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
      innerOverlayDismiss: null,
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

  setInnerOverlayDismiss(fn) {
    set({ innerOverlayDismiss: fn });
  },
}));
