import { lazy, Suspense, useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { AuthScreen } from "./components/AuthScreen";
import { ModalHost } from "./components/ModalHost";
import { ToastHost } from "./components/ToastHost";
import { useMobileGuards } from "./hooks/useMobileGuards";
import { apiFetch, configureApi } from "./lib/api";
import type { ProfileGoals } from "./lib/domain";
import { prefetchViewChunk, viewLoaders } from "./lib/prefetch";
import { cachedApiFetch, configureQueryCache, invalidateQueryCache } from "./lib/query-cache";
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

export function App() {
  useMobileGuards();

  const booted = useAuthStore((s) => s.booted);
  const userId = useAuthStore((s) => s.userId);
  const view = useUiStore((s) => s.view);

  useEffect(() => {
    prefetchViewChunk(useUiStore.getState().view);
    void useAuthStore.getState().bootstrap().then(() => {
      const uid = useAuthStore.getState().userId;
      if (uid && navigator.onLine) {
        void useUiStore.getState().syncOfflineQueue(uid, { silent: true });
      }
    });
  }, []);

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

  return (
    <>
      <AppShell>
        <Suspense fallback={<div className="empty loading" role="status">正在加载页面…</div>}>
          {mainContent}
        </Suspense>
      </AppShell>
      <ModalHost />
      <ToastHost />
    </>
  );
}
