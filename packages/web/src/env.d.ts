/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface CapacitorHapticsPlugin {
  impact?: (opts: { style: "LIGHT" | "MEDIUM" | "HEAVY" }) => Promise<void>;
  notification?: (opts: { type: "SUCCESS" | "WARNING" | "ERROR" }) => Promise<void>;
}

declare global {
  interface Navigator {
    audioSession?: {
      type: string;
    };
  }
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
  var Capacitor:
    | {
        Plugins?: {
          Haptics?: CapacitorHapticsPlugin;
        };
      }
    | undefined;
  var Haptics: CapacitorHapticsPlugin | undefined;
  var webkitAudioContext: typeof AudioContext | undefined;
}

export {};
