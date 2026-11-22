import { useEffect } from "react";
import { primeSharedAudio } from "../lib/haptics-audio";
import { parseHashView } from "../lib/routes";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

const REFRESH_VIEWS = new Set(["overview", "workout", "calendar", "plan", "badges"]);

export function useMobileGuards(): void {
  useEffect(() => {
    const syncHash = () => {
      if (location.hash === "#content") return;
      useUiStore.getState().setView(parseHashView(location.hash));
    };
    window.addEventListener("hashchange", syncHash);

    const unlockAudioOnce = () => {
      primeSharedAudio();
      document.removeEventListener("pointerdown", unlockAudioOnce, true);
      document.removeEventListener("touchstart", unlockAudioOnce, true);
    };
    document.addEventListener("pointerdown", unlockAudioOnce, { capture: true, passive: true });
    document.addEventListener("touchstart", unlockAudioOnce, { capture: true, passive: true });

    const onFocusIn = (event: FocusEvent) => {
      if (!matchMedia("(max-width: 630px)").matches) return;
      const target = event.target as HTMLElement | null;
      if (
        !target?.matches?.(
          'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, select',
        )
      ) {
        return;
      }
      window.setTimeout(() => {
        if (target.isConnected && document.activeElement === target) {
          try {
            (target.closest(".set-row") ?? target).scrollIntoView({ behavior: "smooth", block: "center" });
          } catch {}
        }
      }, 300);
    };
    document.addEventListener("focusin", onFocusIn);

    const onOffline = () => {
      const ui = useUiStore.getState();
      ui.setOnline(false);
      ui.notify("当前处于离线模式，训练进度仍会保存在本地");
    };
    const onOnline = () => {
      const ui = useUiStore.getState();
      const userId = useAuthStore.getState().userId;
      ui.setOnline(true);
      ui.notify("网络已恢复");
      if (userId) {
        void ui.syncOfflineQueue(userId, { silent: false }).then(() => {
          const cur = useUiStore.getState();
          if (cur.modals.length === 0 && !cur.confirm) cur.bumpDataEpoch();
        });
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const userId = useAuthStore.getState().userId;
      const ui = useUiStore.getState();
      if (userId && ui.modals.length === 0 && !ui.confirm && REFRESH_VIEWS.has(ui.view)) {
        ui.bumpDataEpoch();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("hashchange", syncHash);
      document.removeEventListener("pointerdown", unlockAudioOnce, true);
      document.removeEventListener("touchstart", unlockAudioOnce, true);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
