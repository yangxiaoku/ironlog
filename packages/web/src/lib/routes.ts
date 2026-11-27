import type { IconName } from "../components/Icon";

export type ViewId =
  | "overview"
  | "workout"
  | "plan"
  | "exercises"
  | "diet"
  | "weight"
  | "calendar"
  | "analytics"
  | "badges"
  | "settings";

export type WorkspaceId =
  | "overview"
  | "workout"
  | "diet"
  | "calendar"
  | "analytics"
  | "badges"
  | "settings";

export const DESTINATIONS: Record<ViewId, string> = {
  overview: "首页",
  workout: "训练记录",
  plan: "训练计划",
  analytics: "数据分析",
  diet: "饮食记录",
  weight: "体重记录",
  calendar: "日历",
  badges: "成就徽章",
  exercises: "动作库",
  settings: "设置",
};

export interface WorkspaceTab {
  id: ViewId;
  label: string;
}

export interface WorkspaceDef {
  label: string;
  icon: IconName;
  views: ViewId[];
  tabs?: WorkspaceTab[];
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  overview: { label: "首页", icon: "overview", views: ["overview"] },
  workout: {
    label: "训练",
    icon: "workout",
    views: ["workout", "plan", "exercises"],
    tabs: [
      { id: "workout", label: "训练记录" },
      { id: "plan", label: "训练计划" },
      { id: "exercises", label: "动作库" },
    ],
  },
  diet: {
    label: "饮食体重",
    icon: "diet",
    views: ["diet", "weight"],
    tabs: [
      { id: "diet", label: "饮食记录" },
      { id: "weight", label: "体重记录" },
    ],
  },
  calendar: { label: "日历", icon: "calendar", views: ["calendar"] },
  analytics: { label: "数据分析", icon: "analytics", views: ["analytics"] },
  badges: { label: "成就徽章", icon: "badges", views: ["badges"] },
  settings: { label: "设置", icon: "settings", views: ["settings"] },
};

export const VIEW_WORKSPACE: Record<ViewId, WorkspaceId> = Object.fromEntries(
  (Object.entries(WORKSPACES) as Array<[WorkspaceId, WorkspaceDef]>).flatMap(([wsId, ws]) =>
    ws.views.map((viewId) => [viewId, wsId]),
  ),
) as Record<ViewId, WorkspaceId>;

export const MOBILE_TABS: Array<{ id: "overview" | "workout" | "diet" | "calendar"; label: string }> = [
  { id: "overview", label: "首页" },
  { id: "workout", label: "训练" },
  { id: "diet", label: "饮食" },
  { id: "calendar", label: "日历" },
];

export const MORE_WORKSPACES: WorkspaceId[] = ["analytics", "badges", "settings"];

export const HALFTONE_VIEWS = new Set<ViewId>([
  "workout",
  "plan",
  "diet",
  "exercises",
  "badges",
  "calendar",
]);

export const VALID_VIEWS = new Set<ViewId>(Object.keys(DESTINATIONS) as ViewId[]);

export function isValidView(raw: string): raw is ViewId {
  return VALID_VIEWS.has(raw as ViewId);
}

export function parseHashView(hash: string): ViewId {
  const raw = hash.replace(/^#/, "");
  return isValidView(raw) ? raw : "overview";
}
