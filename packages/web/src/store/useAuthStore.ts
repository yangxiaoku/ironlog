import { create } from "zustand";
import { ApiError, apiFetch } from "../lib/api";
import { invalidateQueryCache } from "../lib/query-cache";
import { resetLocalWorkoutPreferences } from "../lib/workout-helpers";
import { useUiStore } from "./useUiStore";

export type AuthMode = "login" | "register";

export interface MeResponse {
  userId?: string;
  username?: string;
  appleHealthConnected?: boolean;
  isNewUser?: boolean;
  aiReady?: boolean;
}

export interface AuthState {
  booted: boolean;
  offlineBoot: boolean;
  userId: string;
  username: string;
  demo: boolean;
  demoToken: string;
  appleHealthConnected: boolean;
  isNewUser: boolean;
  aiReady: boolean;
  authMode: AuthMode;
  authenticating: boolean;
  setAuthMode: (mode: AuthMode) => void;
  applyAccountMeta: (account: MeResponse | null | undefined) => void;
  bootstrap: () => Promise<void>;
  authenticate: (mode: AuthMode, username: string, password: string) => Promise<MeResponse>;
  refreshAccountMeta: () => Promise<void>;
  logout: () => Promise<void>;
  clearUser: () => void;
}

const browserSession = { token: "", accountId: "" };
const LAST_ACCOUNT_KEY = "ironlog-web-last-account";

function readCachedAccountMeta(): MeResponse | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeResponse | null;
    if (!parsed || typeof parsed.userId !== "string" || !parsed.userId.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedAccountMeta(account: MeResponse | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (!account?.userId) {
      localStorage.removeItem(LAST_ACCOUNT_KEY);
      return;
    }
    localStorage.setItem(
      LAST_ACCOUNT_KEY,
      JSON.stringify({
        userId: account.userId,
        username: account.username ?? "",
        appleHealthConnected: Boolean(account.appleHealthConnected),
        isNewUser: Boolean(account.isNewUser),
        aiReady: Boolean(account.aiReady),
      }),
    );
  } catch {}
}

function initialAuthMode(): AuthMode {
  if (typeof localStorage === "undefined") return "register";
  return localStorage.getItem("ironlog-web-account-seen") ? "login" : "register";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  booted: false,
  offlineBoot: false,
  userId: "",
  username: "",
  demo: false,
  demoToken: "",
  appleHealthConnected: false,
  isNewUser: false,
  aiReady: false,
  authMode: initialAuthMode(),
  authenticating: false,

  setAuthMode(authMode) {
    set({ authMode });
  },

  applyAccountMeta(account) {
    if (!account) return;
    set({
      userId: account.userId ?? "",
      username: account.username ?? "",
      appleHealthConnected: Boolean(account.appleHealthConnected),
      isNewUser: Boolean(account.isNewUser),
      aiReady: Boolean(account.aiReady),
    });
    if (!get().demo && account.userId) {
      writeCachedAccountMeta(account);
    }
    useUiStore.getState().refreshPendingCount(account.userId ?? "");
  },

  async bootstrap() {
    try {
      const account = await apiFetch<MeResponse>("/api/me", browserSession);
      set({ demo: false, demoToken: "", offlineBoot: false });
      get().applyAccountMeta(account);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        writeCachedAccountMeta(null);
        let loggedDemo = false;
        if (typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname)) {
          try {
            const { token } = await apiFetch<{ token?: string }>("/auth/web-demo", browserSession);
            if (token) {
              const account = await apiFetch<MeResponse>("/api/me", { ...browserSession, token });
              set({ demo: true, demoToken: token, offlineBoot: false });
              get().applyAccountMeta(account);
              loggedDemo = true;
            }
          } catch { /* Show the sign-in screen when there is no demo session. */ }
        }
        if (!loggedDemo) {
          set({ offlineBoot: false });
          resetLocalWorkoutPreferences();
        }
      } else {
        // Offline / network timeout cold start: preserve last signed-in user so local drafts & offline queue remain accessible.
        const cached = readCachedAccountMeta();
        if (cached?.userId) {
          set({ demo: false, demoToken: "", offlineBoot: true });
          get().applyAccountMeta(cached);
        }
      }
    } finally {
      set({ booted: true });
    }
  },

  async authenticate(mode, username, password) {
    set({ authenticating: true });
    const prevUserId = get().userId;
    try {
      await apiFetch("/auth/web/" + mode, {
        ...browserSession,
        method: "POST",
        body: { username, password },
      });
      const account = await apiFetch<MeResponse>("/api/me", browserSession).catch((err) => {
        if ((err as { status?: number })?.status === 401) {
          throw new Error("浏览器未保存登录状态，请允许本站使用 Cookie 后重新登录");
        }
        throw err;
      });
      if (account.userId !== prevUserId) {
        resetLocalWorkoutPreferences();
      }
      set({ demo: false, demoToken: "", authMode: "login" });
      get().applyAccountMeta(account);
      try {
        localStorage.setItem("ironlog-web-account-seen", "1");
      } catch {}
      invalidateQueryCache();
      useUiStore.getState().bumpDataEpoch();
      return account;
    } finally {
      set({ authenticating: false });
    }
  },

  async refreshAccountMeta() {
    if (!get().userId) return;
    try {
      const account = await apiFetch<MeResponse>("/api/me");
      get().applyAccountMeta(account);
    } catch {}
  },

  clearUser() {
    writeCachedAccountMeta(null);
    invalidateQueryCache();
    resetLocalWorkoutPreferences();
    useUiStore.getState().closeModalSilent();
    set({
      demo: false,
      demoToken: "",
      offlineBoot: false,
      userId: "",
      username: "",
      appleHealthConnected: false,
      isNewUser: false,
      aiReady: false,
      authMode: "login",
    });
    useUiStore.getState().refreshPendingCount("");
  },

  async logout() {
    if (!get().demo) {
      try {
        await apiFetch("/auth/web/logout", { method: "POST" });
      } catch {
        throw new Error("服务器尚未确认退出，请检查网络后重试");
      }
    }
    get().clearUser();
    useUiStore.getState().bumpDataEpoch();
  },
}));
