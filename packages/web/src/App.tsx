import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { AuthScreen } from "./components/AuthScreen";
import { ModalHost } from "./components/ModalHost";
import { ToastHost } from "./components/ToastHost";
import { useMobileGuards } from "./hooks/useMobileGuards";
import { apiFetch, configureApi } from "./lib/api";
import type { ProfileGoals } from "./lib/domain";
import { prefetchViewChunk, viewLoaders } from "./lib/prefetch";
import { cachedApiFetch, configureQueryCache, invalidateQueryCache } from "./lib/query-cache";
import { getOfflineStorage, readQueue } from "./lib/offline-queue";
import { openCommandPalette } from "./lib/record-openers";
import {
  PROFILE_VERSION_EVENT,
  WORKOUT_PREFS_EVENT,
  applyRemoteWorkoutPreferences,
  configureWorkoutPrefsSync,
} from "./lib/workout-helpers";
import { useAuthStore } from "./store/useAuthStore";
import { useUiStore } from "./store/useUiStore";

const OverviewView = lazy(viewLoaders.overview);
const WorkoutView = lazy(viewLoaders.workout);
const DietView = lazy(viewLoaders.diet);
const WeightView = lazy(viewLoaders.weight);
const PlanView = lazy(viewLoaders.plan);
const ExercisesView = lazy(viewLoaders.exercises);
const CalendarView = lazy(viewLoaders.calendar);
const AnalyticsView = lazy(viewLoaders.analytics);
const BadgesView = lazy(viewLoaders.badges);
const SettingsView = lazy(viewLoaders.settings);

configureApi({
  getDemoToken: () => useAuthStore.getState().demoToken,
  getUserId: () => useAuthStore.getState().userId,
  onMutate: () => {
    useUiStore.getState().bumpDataEpoch();
  },
});

configureQueryCache({
  getUserId: () => useAuthStore.getState().userId,
  getDataEpoch: () => useUiStore.getState().dataEpoch,
});

configureWorkoutPrefsSync(async (prefs) => {
  const uid = useAuthStore.getState().userId;
  if (!uid || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  const res = await apiFetch<{ version?: number }>("/api/web/profile/workout-prefs", {
    method: "PUT",
    body: prefs,
    skipMutateHook: true,
  });
  invalidateQueryCache(uid, "/api/web/profile");
  invalidateQueryCache(uid, "view:settings");
  if (typeof res?.version === "number" && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PROFILE_VERSION_EVENT, { detail: res.version }));
  }
});

let pwaUpdateRunner: (() => void) | null = null;

export function setPwaUpdateRunner(fn: () => void): void {
  pwaUpdateRunner = fn;
}

class ViewErrorBoundary extends Component<
  { resetKey: string; onGoHome: () => void; children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || "页面渲染发生意外错误" };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Handled gracefully by fallback UI
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: "" });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="empty" role="alert">
          <strong>当前页面出现异常</strong>
          <p>{this.state.message}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 12 }}>
            <button
              type="button"
              className="primary-button"
              onClick={() => this.setState({ hasError: false, message: "" })}
            >
              重新加载本页
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                this.setState({ hasError: false, message: "" });
                this.props.onGoHome();
              }}
            >
              返回首页
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  useMobileGuards();

  const booted = useAuthStore((s) => s.booted);
  const userId = useAuthStore((s) => s.userId);
  const offlineBoot = useAuthStore((s) => s.offlineBoot);
  const view = useUiStore((s) => s.view);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [view]);

  useEffect(() => {
    prefetchViewChunk(useUiStore.getState().view);
    void useAuthStore.getState().bootstrap().then(() => {
      const uid = useAuthStore.getState().userId;
      if (uid && navigator.onLine && !useAuthStore.getState().offlineBoot) {
        void useUiStore.getState().syncOfflineQueue(uid, { silent: true });
      }
    });
    const onOnline = () => {
      if (useAuthStore.getState().offlineBoot) {
        void useAuthStore.getState().bootstrap().then(() => {
          const uid = useAuthStore.getState().userId;
          if (uid && !useAuthStore.getState().offlineBoot) {
            void useUiStore.getState().syncOfflineQueue(uid, { silent: true });
            useUiStore.getState().bumpDataEpoch();
          }
        });
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Auto-flush offline queue whenever an account becomes authenticated while online (password / passkey / pairing code / bootstrap)
  useEffect(() => {
    if (!userId || offlineBoot) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const pendingBefore = readQueue(getOfflineStorage(), userId).length;
    if (pendingBefore === 0) return;
    void useUiStore.getState().syncOfflineQueue(userId, { silent: true }).then(() => {
      const pendingAfter = readQueue(getOfflineStorage(), userId).length;
      if (pendingAfter < pendingBefore) {
        useUiStore.getState().bumpDataEpoch();
      }
    });
  }, [userId, offlineBoot]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let editedLocally = false;
    const onLocalEdit = () => {
      editedLocally = true;
    };
    if (typeof window !== "undefined") {
      window.addEventListener(WORKOUT_PREFS_EVENT, onLocalEdit);
    }
    void cachedApiFetch<{ profile?: ProfileGoals }>("/api/web/profile", { userId })
      .then((res) => {
        if (active && !editedLocally && res?.profile?.workoutPrefs) {
          applyRemoteWorkoutPreferences(res.profile.workoutPrefs);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (typeof window !== "undefined") {
        window.removeEventListener(WORKOUT_PREFS_EVENT, onLocalEdit);
      }
    };
  }, [userId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!useAuthStore.getState().userId) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  let mainContent: React.ReactNode;
  if (!booted) {
    mainContent = <p className="empty">正在加载铁记…</p>;
  } else if (!userId && view !== "exercises") {
    mainContent = <AuthScreen />;
  } else if (view === "overview") {
    mainContent = <OverviewView />;
  } else if (view === "workout") {
    mainContent = <WorkoutView />;
  } else if (view === "diet") {
    mainContent = <DietView />;
  } else if (view === "weight") {
    mainContent = <WeightView />;
  } else if (view === "plan") {
    mainContent = <PlanView />;
  } else if (view === "exercises") {
    mainContent = <ExercisesView />;
  } else if (view === "calendar") {
    mainContent = <CalendarView />;
  } else if (view === "analytics") {
    mainContent = <AnalyticsView />;
  } else if (view === "badges") {
    mainContent = <BadgesView />;
  } else if (view === "settings") {
    mainContent = <SettingsView />;
  } else {
    mainContent = <OverviewView />;
  }

  const pwaUpdateReady = useUiStore((s) => s.pwaUpdateReady);
  const setPwaUpdateReady = useUiStore((s) => s.setPwaUpdateReady);
  const navigate = useUiStore((s) => s.navigate);
  const dataEpoch = useUiStore((s) => s.dataEpoch);

  return (
    <>
      <AppShell>
        {pwaUpdateReady ? (
          <div
            className="panel"
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
              padding: "10px 14px",
              flexWrap: "wrap",
            }}
          >
            <span>发现新版本可用，可在当前操作完成后随时刷新生效</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="primary-button"
                style={{ minHeight: 34, padding: "4px 12px" }}
                onClick={() => {
                  setPwaUpdateReady(false);
                  if (pwaUpdateRunner) pwaUpdateRunner();
                  else window.location.reload();
                }}
              >
                立即更新
              </button>
              <button
                type="button"
                className="quiet"
                style={{ minHeight: 34, padding: "4px 10px" }}
                onClick={() => setPwaUpdateReady(false)}
              >
                稍后
              </button>
            </div>
          </div>
        ) : null}
        <ViewErrorBoundary resetKey={`${view}:${userId}:${dataEpoch}`} onGoHome={() => navigate("overview")}>
          <Suspense fallback={<div className="empty loading" role="status">正在加载页面…</div>}>
            {mainContent}
          </Suspense>
        </ViewErrorBoundary>
      </AppShell>
      <ModalHost />
      <ToastHost />
    </>
  );
}
