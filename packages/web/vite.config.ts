import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const apiProxy = process.env.IRONLOG_API_PROXY ?? "http://127.0.0.1:4177";

/**
 * Rewrite relative `url("./...")` asset references inside legacy `web/src/styles/*.css`
 * to `/app/...` so Vite dev/build serves synced media from `public/` without modifying vanilla CSS.
 */
function ironlogCssUrls(): Plugin {
  return {
    name: "ironlog-css-urls",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (normalized.endsWith(".css") && normalized.includes("/web/src/styles/")) {
        return {
          code: code.replace(/url\("\.\//g, 'url("/app/'),
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig({
  base: "/app/",
  plugins: [
    ironlogCssUrls(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "铁记 · 训练工作台",
        short_name: "铁记",
        description: "铁记训练、饮食和健康记录工作台",
        start_url: "/app/",
        scope: "/app/",
        display: "standalone",
        background_color: "#09090b",
        theme_color: "#09090b",
        icons: [
          { src: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/app/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,webmanifest}", "icon-*.png"],
        navigateFallback: "/app/index.html",
        runtimeCaching: [
          {
            urlPattern: /^\/app\/.*\.(?:png|jpg|jpeg|webp|svg|woff2)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "ironlog-static-media",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /^\/media\/exercises\//i,
            handler: "CacheFirst",
            options: {
              cacheName: "ironlog-exercise-media",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 400,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "zustand"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxy,
      "/auth": apiProxy,
      "/media": apiProxy,
    },
  },
});
