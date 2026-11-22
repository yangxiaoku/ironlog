import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles";
import { App } from "./App";
import { useUiStore } from "./store/useUiStore";

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useUiStore.getState().notify("铁记已更新到最新版", {
        label: "刷新",
        onClick: () => updateSW(true),
      });
    },
  });
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
