import { useEffect } from "react";
import { AppShell } from "./components/AppShell";
import { AuthScreen } from "./components/AuthScreen";
import { ModalHost } from "./components/ModalHost";
import { ToastHost } from "./components/ToastHost";
import { useMobileGuards } from "./hooks/useMobileGuards";
import { configureApi } from "./lib/api";
import { useAuthStore } from "./store/useAuthStore";
import { useUiStore } from "./store/useUiStore";
import { OverviewBootView } from "./views/OverviewBootView";
import { WorkspaceStubView } from "./views/WorkspaceStubView";

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
  } else if (!userId) {
    mainContent = <AuthScreen />;
  } else if (view === "overview") {
    mainContent = <OverviewBootView />;
  } else {
    mainContent = <WorkspaceStubView view={view} />;
  }

  return (
    <>
      <AppShell>{mainContent}</AppShell>
      <ModalHost />
      <ToastHost />
    </>
  );
}
