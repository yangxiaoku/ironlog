import type { ComponentType } from "react";
import { today } from "./date";
import { cachedApiFetch } from "./query-cache";
import { isValidView, type ViewId, type WorkspaceId } from "./routes";

export const viewLoaders: Record<ViewId, () => Promise<{ default: ComponentType<any> }>> = {
  overview: () => import("../views/OverviewView").then((m) => ({ default: m.OverviewView })),
  workout: () => import("../views/WorkoutView").then((m) => ({ default: m.WorkoutView })),
  diet: () => import("../views/DietView").then((m) => ({ default: m.DietView })),
  weight: () => import("../views/WeightView").then((m) => ({ default: m.WeightView })),
  plan: () => import("../views/PlanView").then((m) => ({ default: m.PlanView })),
  exercises: () => import("../views/ExercisesView").then((m) => ({ default: m.ExercisesView })),
  calendar: () => import("../views/CalendarView").then((m) => ({ default: m.CalendarView })),
  analytics: () => import("../views/AnalyticsView").then((m) => ({ default: m.AnalyticsView })),
  badges: () => import("../views/BadgesView").then((m) => ({ default: m.BadgesView })),
  settings: () => import("../views/SettingsView").then((m) => ({ default: m.SettingsView })),
};

const prefetchedChunks = new Set<string>();

export function prefetchViewChunk(view: ViewId | WorkspaceId): void {
  const key: ViewId = isValidView(view) && Object.hasOwn(viewLoaders, view) ? view : "overview";
  const loader = viewLoaders[key];
  if (prefetchedChunks.has(key)) return;
  prefetchedChunks.add(key);
  void loader().catch(() => {
    prefetchedChunks.delete(key);
  });
}

export function prefetchWorkspace(target: ViewId | WorkspaceId, userId = ""): void {
  prefetchViewChunk(target);
  if (!userId && target !== "exercises") return;

  if (target === "overview") {
    const t = today();
    void cachedApiFetch("/api/web/today", { ttlMs: 60_000 }).catch(() => {});
    void cachedApiFetch(`/api/web/statistics?through=${t}`, { ttlMs: 60_000 }).catch(() => {});
  } else if (target === "workout") {
    void cachedApiFetch("/api/records/workout").catch(() => {});
    void cachedApiFetch("/api/web/profile").catch(() => {});
  } else if (target === "diet") {
    void cachedApiFetch("/api/records/diet").catch(() => {});
    void cachedApiFetch("/api/web/profile").catch(() => {});
  } else if (target === "weight") {
    void cachedApiFetch("/api/records/weight").catch(() => {});
    void cachedApiFetch("/api/web/measurements").catch(() => {});
  } else if (target === "plan") {
    void cachedApiFetch("/api/plans/active").catch(() => {});
    void cachedApiFetch("/api/web/schedule").catch(() => {});
  } else if (target === "calendar") {
    void cachedApiFetch("/api/records/workout").catch(() => {});
    void cachedApiFetch("/api/records/diet").catch(() => {});
    void cachedApiFetch("/api/records/weight").catch(() => {});
    void cachedApiFetch("/api/records/nutritionDay").catch(() => {});
    void cachedApiFetch("/api/web/profile").catch(() => {});
  } else if (target === "analytics") {
    const t = today();
    void cachedApiFetch(`/api/web/analytics?days=30&through=${t}`, { ttlMs: 60_000 }).catch(() => {});
  } else if (target === "badges") {
    void cachedApiFetch("/api/web/badges").catch(() => {});
  } else if (target === "settings") {
    void cachedApiFetch("/api/web/preferences").catch(() => {});
    void cachedApiFetch("/api/web/profile").catch(() => {});
  } else if (target === "exercises") {
    void cachedApiFetch("/api/catalogue/exercises?q=&limit=24", { token: "", userId: "public", epoch: 0 }).catch(() => {});
  }
}
