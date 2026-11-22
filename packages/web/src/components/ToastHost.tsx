import { useUiStore } from "../store/useUiStore";

export function ToastHost() {
  const toast = useUiStore((s) => s.toast);
  const dismissToast = useUiStore((s) => s.dismissToast);
  const hasAction = Boolean(toast?.action?.label);

  return (
    <div
      id="toast"
      role="status"
      aria-live="polite"
      className={`${toast ? "shown" : ""}${hasAction ? " has-action" : ""}`}
    >
      {toast ? (
        <>
          <span>{toast.message}</span>
          {hasAction && toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(toast.id);
                void toast.action?.onClick();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
