import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { AuthScreen } from "./components/AuthScreen";
import { ModalHost } from "./components/ModalHost";
import { ToastHost } from "./components/ToastHost";
import { useMobileGuards } from "./hooks/useMobileGuards";
import { configureApi } from "./lib/api";
import { useAuthStore } from "./store/useAuthStore";
import { useUiStore } from "./store/useUiStore";
import { AnalyticsView } from "./views/AnalyticsView";
import { BadgesView } from "./views/BadgesView";
import { CalendarView } from "./views/CalendarView";
import { DietView } from "./views/DietView";
import { ExercisesView } from "./views/ExercisesView";
import { OverviewView } from "./views/OverviewView";
import { PlanView } from "./views/PlanView";
import { SettingsView } from "./views/SettingsView";
import { WeightView } from "./views/WeightView";
import { WorkoutView } from "./views/WorkoutView";

configureApi({
  getDemoToken: () => useAuthStore.getState().demoToken,
  getUserId: () => useAuthStore.getState().userId,
  onMutate: () => {
    useUiStore.getState().bumpDataEpoch();
  },
});

export function App() {
  useMobileGuards();

  const booted = useAuthStore((s) => s.booted);
  const userId = useAuthStore((s) => s.userId);
  const view = useUiStore((s) => s.view);

  useEffect(() => {
    void useAuthStore.getState().bootstrap().then(() => {
      const uid = useAuthStore.getState().userId;
      if (uid && navigator.onLine) {
        void useUiStore.getState().syncOfflineQueue(uid, { silent: true });
      }
    });
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
      <AppShell>{mainContent}</AppShell>
      <ModalHost />
      <ToastHost />
    </>
  );
}
