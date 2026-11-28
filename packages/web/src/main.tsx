import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles";
import { App, setPwaUpdateRunner } from "./App";
import { useUiStore } from "./store/useUiStore";

// Ensure crypto.randomUUID works in non-HTTPS LAN / VPS origins (e.g. mobile Safari over HTTP)
if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID !== "function") {
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: () => {
        if (typeof globalThis.crypto.getRandomValues === "function") {
          const bytes = new Uint8Array(16);
          globalThis.crypto.getRandomValues(bytes);
          bytes[6] = (bytes[6]! & 0x0f) | 0x40;
          bytes[8] = (bytes[8]! & 0x3f) | 0x80;
          const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
      },
    });
  } catch {}
}

if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  const updateSW = registerSW({
    immediate: true,
    // #163: With registerType: "prompt", onNeedRefresh surfaces the non-disruptive banner until the user confirms
    onNeedRefresh() {
      setPwaUpdateRunner(() => void updateSW(true));
      useUiStore.getState().setPwaUpdateReady(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration || typeof document === "undefined") return;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void registration.update().catch(() => {});
        }
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
