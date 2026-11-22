const SHELL_CACHE = "ironlog-shell-103";
const MEDIA_CACHE = "ironlog-media-v1";
const shellAssets = [
  "./", "./styles.css", "./app.js", "./analytics-ui.js", "./charts.js", "./ui.js",
  "./modal-stack.js", "./data-modals.js", "./diet-weight-modals.js", "./settings-ui.js", "./report-share-ui.js",
  "./badges-ui.js", "./ai-ui.js", "./plan-ui.js", "./calendar-ui.js", "./calc-ui.js",
  "./editor.js", "./workout-helpers.js", "./simple-editors.js", "./workout-clock.js", "./offline-queue.js", "./display.js", "./matrix-data.js",
  "./session-ui.js", "./apple-health-ui.js", "./onboarding-ui.js", "./shortcut-gen.js",
  "./app.webmanifest", "./icon-192.png", "./icon-512.png",
];
const mediaAssets = [
  "./athlete-halftone.jpg", "./athlete-halftone-light.jpg",
  "./plate-halftone.jpg", "./plate-halftone-light.jpg",
  "./nutrition-halftone.jpg", "./nutrition-halftone-light.jpg",
  "./equipment-halftone.jpg", "./equipment-halftone-light.jpg",
  "./share-bg-paper.jpg", "./share-bg-ring.jpg", "./share-bg-mono.jpg", "./share-bg-poster.jpg",
  "./atlas-all.png", "./atlas-arms.png", "./atlas-back.png", "./atlas-chest.png", "./atlas-core.png", "./atlas-legs.png", "./atlas-neutral.png", "./atlas-shoulders.png",
  "./badge-active-days-50.png", "./badge-apple-burn-5000.png", "./badge-apple-sync.png", "./badge-apple-sync-1.png", "./badge-apple-sync-30.png",
  "./badge-bench-100.png", "./badge-bench-120.png", "./badge-bench-60.png", "./badge-bench-80.png",
  "./badge-deadlift-120.png", "./badge-deadlift-160.png", "./badge-deadlift-80.png",
  "./badge-diet-1.png", "./badge-diet-14.png", "./badge-diet-30.png", "./badge-diet-60.png", "./badge-diet-7.png",
  "./badge-double-day.png", "./badge-double-day-5.png", "./badge-early-bird.png", "./badge-early-bird-5.png",
  "./badge-equipment-4.png", "./badge-feeling-balanced-20.png", "./badge-first-spark.png", "./badge-four-meals-10.png", "./badge-friday-iron.png",
  "./badge-full-split.png", "./badge-full-split-50.png", "./badge-golden-hour-10.png", "./badge-grit-fatigued-5.png",
  "./badge-habit-10.png", "./badge-habit-20.png", "./badge-habit-3.png", "./badge-habit-30.png", "./badge-habit-45.png",
  "./badge-hours-10.png", "./badge-hours-100.png", "./badge-hours-50.png",
  "./badge-iron-150.png", "./badge-iron-200.png", "./badge-iron-365.png", "./badge-iron-60.png", "./badge-iron-80.png", "./badge-iron-century.png",
  "./badge-lunch-lifter.png", "./badge-marathon-60m.png", "./badge-meals-200.png", "./badge-meals-50.png", "./badge-monday-ignite.png",
  "./badge-month-12.png", "./badge-month-16.png", "./badge-night-owl.png", "./badge-night-owl-10.png", "./badge-ohp-50.png",
  "./badge-plan-architect.png", "./badge-pr-breaker.png", "./badge-pr-first.png", "./badge-pr-legend.png", "./badge-pr-master.png",
  "./badge-protein-14.png", "./badge-protein-30.png", "./badge-protein-7.png", "./badge-protein-total-2kg.png", "./badge-protein-total-5kg.png",
  "./badge-reps-1000.png", "./badge-reps-10000.png", "./badge-reps-5000.png", "./badge-row-70.png",
  "./badge-sbd-250.png", "./badge-sbd-400.png", "./badge-session-10t.png", "./badge-session-20sets.png", "./badge-session-5t.png",
  "./badge-sets-100.png", "./badge-sets-1000.png", "./badge-sets-2500.png", "./badge-sets-300.png", "./badge-sets-500.png",
  "./badge-squat-100.png", "./badge-squat-120.png", "./badge-squat-160.png", "./badge-squat-80.png",
  "./badge-streak-14.png", "./badge-streak-21.png", "./badge-streak-3.png", "./badge-streak-30.png", "./badge-streak-7.png",
  "./badge-tonnage-1000t.png", "./badge-tonnage-100t.png", "./badge-tonnage-10t.png", "./badge-tonnage-250t.png", "./badge-tonnage-25t.png",
  "./badge-tonnage-500t.png", "./badge-tonnage-50t.png", "./badge-tonnage-5t.png",
  "./badge-triad-day-10.png", "./badge-variety-10.png", "./badge-variety-25.png", "./badge-weekend-warrior.png",
  "./badge-week-five.png", "./badge-week-quad.png",
  "./badge-weight-30.png", "./badge-weight-60.png", "./badge-weight-7.png", "./badge-weight-90.png",
];
const scopeUrl = new URL(self.registration.scope);
const shellSet = new Set(shellAssets.map((path) => new URL(path, scopeUrl).href));
const mediaSet = new Set(mediaAssets.map((path) => new URL(path, scopeUrl).href));

self.addEventListener("install", (event) => event.waitUntil(
  caches.open(SHELL_CACHE).then((cache) => cache.addAll(shellAssets)).then(() => self.skipWaiting()),
));

self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((names) => Promise.all(
    names
      .filter((name) => (name.startsWith("ironlog-app-") || name.startsWith("ironlog-shell-")) && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)),
  )).then(() => self.clients.claim()),
));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== scopeUrl.origin) return;

  if (shellSet.has(reqUrl.href)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const clone = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone)).catch(() => {}));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  const isMedia = mediaSet.has(reqUrl.href)
    || (/\.(png|jpe?g|webp|gif|svg)$/i.test(reqUrl.pathname)
      && (reqUrl.href.startsWith(scopeUrl.href) || reqUrl.pathname.startsWith("/media/exercises/")));
  if (isMedia) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response && response.ok && response.type === "basic") {
          event.waitUntil(cache.put(event.request, response.clone()).catch(() => {}));
        }
        return response;
      }),
    );
  }
});
