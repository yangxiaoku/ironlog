import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { invalidateQueryCache } from "../lib/query-cache";
import { resetLocalWorkoutPreferences } from "../lib/workout-helpers";
import { useUiStore } from "./useUiStore";

export type AuthMode = "login" | "register";

export interface MeResponse {
  userId?: string;
  username?: string;
  appleHealthConnected?: boolean;
  isNewUser?: boolean;
}

export interface AuthState {
  booted: boolean;
  userId: string;
  username: string;
  demo: boolean;
  demoToken: string;
  appleHealthConnected: boolean;
  isNewUser: boolean;
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

function initialAuthMode(): AuthMode {
  if (typeof localStorage === "undefined") return "register";
  return localStorage.getItem("ironlog-web-account-seen") ? "login" : "register";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  booted: false,
  userId: "",
  username: "",
  demo: false,
  demoToken: "",
  appleHealthConnected: false,
  isNewUser: false,
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
    });
    useUiStore.getState().refreshPendingCount(account.userId ?? "");
  },

  async bootstrap() {
    let demo = false;
    let demoToken = "";
    try {
      if (typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname)) {
        const res = await apiFetch<{ token?: string }>("/auth/web-demo", { token: "" });
        if (res.token) {
          demo = true;
          demoToken = res.token;
          set({ demo, demoToken });
        }
      }
    } catch {}

    try {
      const account = await apiFetch<MeResponse>("/api/me");
      get().applyAccountMeta(account);
    } catch {
      // Guests see the auth screen cleanly
    } finally {
      set({ booted: true });
    }
  },

  async authenticate(mode, username, password) {
    set({ authenticating: true });
    try {
      await apiFetch("/auth/web/" + mode, {
        method: "POST",
        body: { username, password },
      });
      const account = await apiFetch<MeResponse>("/api/me").catch((err) => {
        if ((err as { status?: number })?.status === 401) {
          throw new Error("浏览器未保存登录状态，请允许本站使用 Cookie 后重新登录");
        }
        throw err;
      });
      get().applyAccountMeta(account);
      set({ authMode: "login" });
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
    const prevUserId = get().userId;
    invalidateQueryCache();
    resetLocalWorkoutPreferences();
    useUiStore.getState().closeModalSilent();
    if (prevUserId && typeof localStorage !== "undefined") {
      const prefix = `ironlog-web-draft:${prevUserId}:`;
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of Object.keys(storage)) {
          if (key.startsWith(prefix)) storage.removeItem(key);
        }
      }
    }
    set({
      demo: false,
      demoToken: "",
      userId: "",
      username: "",
      appleHealthConnected: false,
      isNewUser: false,
      authMode: "login",
    });
    useUiStore.getState().refreshPendingCount("");
  },

  async logout() {
    try {
      await apiFetch("/auth/web/logout", { method: "POST" });
    } catch {}
    get().clearUser();
    useUiStore.getState().bumpDataEpoch();
  },
}));
