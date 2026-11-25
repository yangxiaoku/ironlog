import { prefetchWorkspace } from "../lib/prefetch";
import { VIEW_WORKSPACE, WORKSPACES, type ViewId } from "../lib/routes";
import { useAuthStore } from "../store/useAuthStore";
import { useUiStore } from "../store/useUiStore";

export function WorkspaceTabs() {
  const userId = useAuthStore((s) => s.userId);
  const view = useUiStore((s) => s.view);
  const navigate = useUiStore((s) => s.navigate);

  if (!userId) return null;
  const ws = WORKSPACES[VIEW_WORKSPACE[view]];
  if (!ws?.tabs?.length) return null;

  return (
    <nav className="workspace-tabs" aria-label={`${ws.label}子页面`}>
      {ws.tabs.map((tab) => (
        <a
          key={tab.id}
          href={`#${tab.id}`}
          aria-current={tab.id === view ? "page" : undefined}
          onPointerEnter={() => prefetchWorkspace(tab.id, userId)}
          onFocus={() => prefetchWorkspace(tab.id, userId)}
          onClick={(e) => {
            e.preventDefault();
            navigate(tab.id);
          }}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}

export function PageHeading({
  title,
  sub,
  view,
  controls,
}: {
  title: string;
  sub?: string;
  view: ViewId;
  controls?: React.ReactNode;
}) {
  return (
    <div className={`page-heading masthead-${view}`}>
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {controls}
    </div>
  );
}
