import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../store/useUiStore";
import { Icon } from "./Icon";

let overlaySeq = 0;

export function ModalHost() {
  const modals = useUiStore((s) => s.modals);
  const confirm = useUiStore((s) => s.confirm);
  const innerOverlayDismiss = useUiStore((s) => s.innerOverlayDismiss);
  const silentCloseSeq = useUiStore((s) => s.silentCloseSeq);
  const closeTopModal = useUiStore((s) => s.closeTopModal);
  const closeAllModals = useUiStore((s) => s.closeAllModals);
  const closeConfirm = useUiStore((s) => s.closeConfirm);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const depthRef = useRef(0);
  const prevModalsLenRef = useRef(0);
  const closingFromPopstateRef = useRef(false);
  const expectedPopsRef = useRef(0);
  const lastSilentSeqRef = useRef(silentCloseSeq);
  const overlayTokenRef = useRef<number | null>(null);
  const innerOverlayTokenRef = useRef<number | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, inHead: false, hasForm: false, dragging: false });
  const savedScrollYRef = useRef(0);
  const scrollLockedRef = useRef(false);

  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const activeModal = modals.at(-1) ?? null;
  const standaloneConfirm = !activeModal && Boolean(confirm);
  const nestedConfirm = Boolean(activeModal && confirm);
  const isOpen = Boolean(activeModal || confirm);

  const unlockBackgroundScroll = useCallback(() => {
    if (!scrollLockedRef.current || typeof document === "undefined") return;
    scrollLockedRef.current = false;
    const scrollY = savedScrollYRef.current;
    document.documentElement.classList.remove("modal-scroll-lock");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    if (typeof window !== "undefined") {
      window.scrollTo(0, scrollY);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isOpen) {
      if (!scrollLockedRef.current) {
        const scrollY =
          (typeof window !== "undefined" ? window.scrollY : 0) || document.documentElement.scrollTop || 0;
        savedScrollYRef.current = scrollY;
        document.documentElement.classList.add("modal-scroll-lock");
        document.body.style.position = "fixed";
        document.body.style.top = `-${scrollY}px`;
        document.body.style.left = "0";
        document.body.style.right = "0";
        document.body.style.width = "100%";
        scrollLockedRef.current = true;
      }
    } else {
      unlockBackgroundScroll();
    }
  }, [isOpen, unlockBackgroundScroll]);

  useEffect(() => unlockBackgroundScroll, [unlockBackgroundScroll]);

  useEffect(() => {
    setConfirmBusy(false);
    setConfirmError("");
  }, [confirm]);

  // Synchronize native <dialog>, history stack per stacked modal, and silent closures
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const prevLen = prevModalsLenRef.current;
    prevModalsLenRef.current = modals.length;

    if (isOpen) {
      lastSilentSeqRef.current = silentCloseSeq;
      const wasOpen = dialog.open;
      if (!wasOpen) {
        try {
          dialog.showModal();
        } catch {}
        dialog.scrollTop = 0;
        try {
          history.pushState({ ...(history.state ?? {}), ironlogModal: ++overlaySeq }, "", location.href);
          depthRef.current = 1;
        } catch {}
      } else if (modals.length > prevLen && prevLen > 0) {
        // Pushed another stacked modal on top (e.g. ExercisePickerModal over WorkoutEditorModal)
        try {
          history.pushState({ ...(history.state ?? {}), ironlogStackedModal: modals.at(-1)?.id }, "", location.href);
          depthRef.current++;
        } catch {}
      } else if (modals.length < prevLen && !closingFromPopstateRef.current && depthRef.current > modals.length) {
        const drop = depthRef.current - Math.max(1, modals.length);
        depthRef.current = Math.max(1, depthRef.current - drop);
        expectedPopsRef.current += 1;
        try {
          history.go(-drop);
        } catch {
          expectedPopsRef.current = Math.max(0, expectedPopsRef.current - 1);
        }
      }
      dialog.scrollTop = 0;
    } else {
      if (dialog.open) {
        dialog.close();
      }
      dialog.style.transform = "";
      dialog.style.transition = "";
      const suppressed = lastSilentSeqRef.current !== silentCloseSeq;
      lastSilentSeqRef.current = silentCloseSeq;
      overlayTokenRef.current = null;
      innerOverlayTokenRef.current = null;
      const depth = depthRef.current;
      depthRef.current = 0;
      if (
        depth > 0 &&
        !closingFromPopstateRef.current &&
        !suppressed &&
        typeof history !== "undefined" &&
        (history.state?.ironlogModal ||
          history.state?.ironlogOverlay ||
          history.state?.ironlogInnerOverlay ||
          history.state?.ironlogStackedModal)
      ) {
        expectedPopsRef.current++;
        try {
          history.go(-depth);
        } catch {
          expectedPopsRef.current = Math.max(0, expectedPopsRef.current - 1);
        }
      }
    }
  }, [isOpen, modals.length, silentCloseSeq]);

  // Inner overlay (e.g. Workout settings/history/coach drawer) pushes its own history entry
  // so mobile Back gesture or ESC closes ONLY the inner drawer instead of dismissing the whole workout.
  const hasInnerOverlay = Boolean(activeModal && innerOverlayDismiss);
  useEffect(() => {
    if (hasInnerOverlay) {
      if (innerOverlayTokenRef.current == null) {
        const id = ++overlaySeq;
        innerOverlayTokenRef.current = id;
        try {
          history.pushState({ ...(history.state ?? {}), ironlogInnerOverlay: id }, "", location.href);
          depthRef.current++;
        } catch {}
      }
      return;
    }
    const token = innerOverlayTokenRef.current;
    if (token != null) {
      innerOverlayTokenRef.current = null;
      if (!closingFromPopstateRef.current && history.state?.ironlogInnerOverlay === token) {
        depthRef.current = Math.max(0, depthRef.current - 1);
        expectedPopsRef.current++;
        try {
          history.back();
        } catch {
          expectedPopsRef.current = Math.max(0, expectedPopsRef.current - 1);
        }
      }
    }
  }, [hasInnerOverlay]);

  // Nested confirm pushes its own overlay history entry so Back dismisses confirm first
  useEffect(() => {
    if (!nestedConfirm) return;
    const id = ++overlaySeq;
    overlayTokenRef.current = id;
    try {
      history.pushState({ ...(history.state ?? {}), ironlogOverlay: id }, "", location.href);
      depthRef.current++;
    } catch {}
  }, [nestedConfirm]);

  const dismissNestedConfirm = useCallback(() => {
    const token = overlayTokenRef.current;
    overlayTokenRef.current = null;
    closeConfirm();
    if (token != null && !closingFromPopstateRef.current && history.state?.ironlogOverlay === token) {
      depthRef.current = Math.max(0, depthRef.current - 1);
      expectedPopsRef.current++;
      try {
        history.back();
      } catch {
        expectedPopsRef.current = Math.max(0, expectedPopsRef.current - 1);
      }
    }
  }, [closeConfirm]);

  useEffect(() => {
    const onPopState = () => {
      if (expectedPopsRef.current > 0) {
        expectedPopsRef.current--;
        return;
      }
      const ui = useUiStore.getState();
      if (ui.confirm && overlayTokenRef.current != null) {
        overlayTokenRef.current = null;
        depthRef.current = Math.max(0, depthRef.current - 1);
        closingFromPopstateRef.current = true;
        try {
          ui.closeConfirm();
        } finally {
          closingFromPopstateRef.current = false;
        }
        return;
      }
      if (ui.innerOverlayDismiss && innerOverlayTokenRef.current != null) {
        innerOverlayTokenRef.current = null;
        depthRef.current = Math.max(0, depthRef.current - 1);
        closingFromPopstateRef.current = true;
        try {
          ui.innerOverlayDismiss();
        } finally {
          closingFromPopstateRef.current = false;
        }
        return;
      }
      if (ui.modals.length > 1) {
        depthRef.current = Math.max(0, depthRef.current - 1);
        closingFromPopstateRef.current = true;
        try {
          ui.closeTopModal();
        } finally {
          closingFromPopstateRef.current = false;
        }
        return;
      }
      if (depthRef.current > 0 && (ui.modals.length > 0 || ui.confirm)) {
        depthRef.current = 0;
        closingFromPopstateRef.current = true;
        try {
          ui.closeAllModals();
        } finally {
          closingFromPopstateRef.current = false;
        }
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const mq = matchMedia("(max-width: 630px)");
    const onMqChange = (e: MediaQueryListEvent) => {
      if (!e.matches && activeModal?.layout === "menu") {
        closeAllModals();
      }
    };
    mq.addEventListener("change", onMqChange);
    return () => mq.removeEventListener("change", onMqChange);
  }, [activeModal?.layout, closeAllModals]);

  const runConfirmOk = async () => {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError("");
    try {
      await confirm.onConfirm();
      const ui = useUiStore.getState();
      if (!ui.confirm) return;
      if (ui.modals.length > 0 && overlayTokenRef.current != null) {
        dismissNestedConfirm();
      } else {
        closeConfirm();
      }
    } catch (error) {
      setConfirmError((error as Error)?.message || "操作失败，请重试");
      setConfirmBusy(false);
    }
  };

  const layout = activeModal?.layout ?? "";
  const dialogClasses = [
    activeModal?.wide ? "wide-dialog" : "",
    layout === "menu" ? "mobile-sheet" : "",
    layout === "workout" ? "workout-dialog" : "",
    layout === "cardio" ? "cardio-dialog" : "",
    layout === "report" ? "report-dialog" : "",
    layout === "badge" ? "badge-dialog" : "",
    layout === "exercise" ? "exercise-dialog" : "",
    layout === "onboarding" ? "onboarding-dialog" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const dialogTitle = activeModal ? activeModal.title : confirm?.title ?? "";

  return (
    <dialog
      ref={dialogRef}
      id="dialog"
      aria-labelledby="dialog-title"
      className={dialogClasses}
      onCancel={(e) => {
        e.preventDefault();
        if (nestedConfirm) {
          if (!confirmBusy) dismissNestedConfirm();
          return;
        }
        if (standaloneConfirm) {
          if (!confirmBusy) closeConfirm();
          return;
        }
        if (innerOverlayDismiss) {
          innerOverlayDismiss();
          return;
        }
        if (modals.length > 1) closeTopModal();
        else closeAllModals();
      }}
      onClick={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || e.target !== dialog) return;
        if (layout === "workout" || layout === "cardio" || layout === "onboarding") return;
        const isSheet = dialog.classList.contains("mobile-sheet");
        const hasForm = Boolean(dialog.querySelector("form"));
        if (!isSheet && hasForm) return;
        const rect = dialog.getBoundingClientRect();
        const outside =
          e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
        if (outside) {
          if (standaloneConfirm) {
            if (!confirmBusy) closeConfirm();
          } else if (modals.length > 1) {
            closeTopModal();
          } else {
            closeAllModals();
          }
        }
      }}
      onTouchStart={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || e.touches.length !== 1 || layout === "workout" || layout === "cardio") return;
        if (!matchMedia("(max-width: 630px)").matches) return;
        const target = e.target as Element | null;
        const inHead = Boolean(target?.closest(".dialog-head"));
        const hasForm = Boolean(dialog.querySelector("form"));
        const atTopScroll = dialog.scrollTop <= 1 && !target?.closest("input, textarea, select");
        if (!inHead && (hasForm || !atTopScroll)) return;
        const t = e.touches[0];
        if (!t) return;
        dragRef.current = { active: true, x: t.clientX, y: t.clientY, inHead, hasForm, dragging: false };
      }}
      onTouchMove={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || !dragRef.current.active || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (!t) return;
        const dy = t.clientY - dragRef.current.y;
        const dx = t.clientX - dragRef.current.x;
        if (dy < 0 || (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy))) {
          dragRef.current.active = false;
          dragRef.current.dragging = false;
          dialog.style.transform = "";
          dialog.style.transition = "";
          return;
        }
        const canDragClose =
          dragRef.current.inHead || (!dragRef.current.hasForm && dialog.scrollTop <= 1 && dy > 10);
        if (canDragClose && dy > 10 && dy > Math.abs(dx) * 1.3) {
          dragRef.current.dragging = true;
          dialog.style.transition = "none";
          dialog.style.transform = `translateY(${Math.min(220, dy * 0.72).toFixed(1)}px)`;
        }
      }}
      onTouchEnd={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || !dragRef.current.active) return;
        const wasDragging = dragRef.current.dragging;
        dragRef.current.active = false;
        dragRef.current.dragging = false;
        const dy = e.changedTouches[0] ? e.changedTouches[0].clientY - dragRef.current.y : 0;
        dialog.style.transition = "transform .18s ease";
        dialog.style.transform = "";
        if (wasDragging && dy >= 78) {
          if (confirmBusy) return;
          if (nestedConfirm) dismissNestedConfirm();
          else if (standaloneConfirm) closeConfirm();
          else if (modals.length > 1) closeTopModal();
          else closeAllModals();
        }
      }}
      onTouchCancel={() => {
        const dialog = dialogRef.current;
        if (!dialog || !dragRef.current.active) return;
        dragRef.current.active = false;
        dragRef.current.dragging = false;
        dialog.style.transition = "transform .18s ease";
        dialog.style.transform = "";
      }}
    >
      {isOpen ? (
        <>
          <header className="dialog-head">
            <h2 id="dialog-title">{dialogTitle}</h2>
            {activeModal?.headerAction ?? null}
            <button
              type="button"
              className="icon-button"
              aria-label="关闭"
              autoFocus={layout === "workout"}
              disabled={(standaloneConfirm || nestedConfirm) && confirmBusy}
              onClick={() => {
                if ((standaloneConfirm || nestedConfirm) && confirmBusy) return;
                if (nestedConfirm) dismissNestedConfirm();
                else if (standaloneConfirm) closeConfirm();
                else if (innerOverlayDismiss) innerOverlayDismiss();
                else if (modals.length > 1) closeTopModal();
                else closeAllModals();
              }}
            >
              <Icon name="close" />
            </button>
          </header>

          {modals.map((modal, idx) => {
            const isTop = idx === modals.length - 1;
            return (
              <div key={modal.id} style={isTop ? { display: "contents" } : { display: "none" }} aria-hidden={!isTop}>
                <Suspense fallback={<div className="dialog-form"><p className="muted" style={{ padding: "18px 0" }}>正在加载窗口…</p></div>}>
                  {modal.content}
                </Suspense>
              </div>
            );
          })}

          {standaloneConfirm && confirm ? (
            <div className="confirm-dialog-body">
              <p className="confirm-dialog-message">{confirm.message}</p>
              <p className="form-error" role="alert" hidden={!confirmError}>
                {confirmError}
              </p>
              <footer className="confirm-dialog-foot">
                <button type="button" className="quiet" disabled={confirmBusy} onClick={() => closeConfirm()}>
                  取消
                </button>
                <button type="button" className="danger" disabled={confirmBusy} onClick={() => void runConfirmOk()}>
                  {confirm.confirmLabel ?? "确认删除"}
                </button>
              </footer>
            </div>
          ) : null}

          {nestedConfirm && confirm ? (
            <div
              className="confirm-overlay"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-overlay-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && !confirmBusy) dismissNestedConfirm();
              }}
            >
              <div className="confirm-overlay-card">
                <h3 id="confirm-overlay-title">{confirm.title}</h3>
                <p className="confirm-dialog-message">{confirm.message}</p>
                <p className="form-error" role="alert" hidden={!confirmError}>
                  {confirmError}
                </p>
                <footer className="confirm-dialog-foot">
                  <button
                    type="button"
                    className="quiet"
                    disabled={confirmBusy}
                    autoFocus
                    onClick={dismissNestedConfirm}
                  >
                    取消
                  </button>
                  <button type="button" className="danger" disabled={confirmBusy} onClick={() => void runConfirmOk()}>
                    {confirm.confirmLabel ?? "确认删除"}
                  </button>
                </footer>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
