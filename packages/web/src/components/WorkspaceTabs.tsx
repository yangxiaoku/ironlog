import { HALFTONE_VIEWS, VIEW_WORKSPACE, WORKSPACES, type ViewId } from "../lib/routes";
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
  const hasBrackets = HALFTONE_VIEWS.has(view);
  return (
    <div className={`page-heading masthead-${view}`}>
      {hasBrackets ? (
        <>
          <span className="vf-c tl" aria-hidden="true" />
          <span className="vf-c tr" aria-hidden="true" />
          <span className="vf-c bl" aria-hidden="true" />
          <span className="vf-c br" aria-hidden="true" />
        </>
      ) : null}
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {controls}
    </div>
  );
}
