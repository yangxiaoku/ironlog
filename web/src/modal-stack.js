import { $, esc, icon } from "./ui.js";

/**
 * Create dialog modal stack manager with browser history (`popstate`) integration,
 * nested overlay handling (alertdialog confirm overlays), and mobile sheet drag-to-dismiss.
 */
export function createModalStack({ dialog, onAfterClose }) {
  let modalSeq = 0;
  let modalHistoryDepth = 0;
  let closingFromPopstate = false;
  let suppressNextHistoryBack = false;
  let expectedProgrammaticPops = 0;
  const overlayStack = [];

  function pushOverlay(onClose) {
    const id = ++modalSeq;
    overlayStack.push({ id, onClose });
    try {
      history.pushState({ ...(history.state ?? {}), ironlogOverlay: id }, "", location.href);
      modalHistoryDepth++;
    } catch {}
    return id;
  }

  function popOverlay(id) {
    const idx = overlayStack.findIndex((item) => item.id === id);
    if (idx >= 0) overlayStack.splice(idx, 1);
    if (!closingFromPopstate && history.state?.ironlogOverlay === id) {
      modalHistoryDepth = Math.max(0, modalHistoryDepth - 1);
      expectedProgrammaticPops++;
      try { history.back(); } catch { expectedProgrammaticPops = Math.max(0, expectedProgrammaticPops - 1); }
    }
  }

  function closeModalSilent() {
    if (!dialog.open) return;
    suppressNextHistoryBack = true;
    dialog.close();
  }

  window.addEventListener("popstate", () => {
    if (expectedProgrammaticPops > 0) {
      expectedProgrammaticPops--;
      return;
    }
    if (overlayStack.length > 0) {
      const top = overlayStack.pop();
      modalHistoryDepth = Math.max(0, modalHistoryDepth - 1);
      closingFromPopstate = true;
      try { top?.onClose?.(); } finally { closingFromPopstate = false; }
      return;
    }
    if (dialog.open && modalHistoryDepth > 0) {
      modalHistoryDepth = 0;
      closingFromPopstate = true;
      try { dialog.close(); } finally { closingFromPopstate = false; }
    }
  });

  function open(title, body, wide = false, layout = "") {
    const wasOpen = dialog.open;
    dialog.classList.toggle("wide-dialog", wide);
    dialog.classList.toggle("mobile-sheet", layout === "menu");
    dialog.classList.toggle("workout-dialog", layout === "workout");
    dialog.classList.toggle("report-dialog", layout === "report");
    dialog.classList.toggle("badge-dialog", layout === "badge");
    dialog.classList.toggle("exercise-dialog", layout === "exercise");
    dialog.classList.toggle("onboarding-dialog", layout === "onboarding");
    dialog.innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>
      ${layout === "exercise" ? `<button class="quiet copy-exercise" type="button" data-action="copy-exercise" data-value="${esc(title)}">复制动作名</button>` : ""}
      <button type="button" class="icon-button" data-action="close" aria-label="关闭"${layout === "workout" ? " autofocus" : ""}>${icon("close")}</button></header>${body}`;
    if (!dialog.open) dialog.showModal();
    if (!wasOpen) {
      try {
        history.pushState({ ...(history.state ?? {}), ironlogModal: ++modalSeq }, "", location.href);
        modalHistoryDepth = 1;
      } catch {}
    } else {
      overlayStack.length = 0;
    }
    dialog.scrollTop = 0;
  }

  function openConfirmDialog({ title, message, confirmLabel = "确认删除", onConfirm }) {
    if (dialog.open) {
      let overlayToken = null;
      const overlay = document.createElement("div");
      overlay.className = "confirm-overlay";
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "confirm-overlay-title");
      overlay.innerHTML = `<div class="confirm-overlay-card">
        <h3 id="confirm-overlay-title">${esc(title)}</h3>
        <p class="confirm-dialog-message">${esc(message)}</p>
        <p class="form-error" data-confirm-error role="alert" hidden></p>
        <footer class="confirm-dialog-foot">
          <button type="button" class="quiet" data-confirm-cancel>取消</button>
          <button type="button" class="danger" data-confirm-ok>${esc(confirmLabel)}</button>
        </footer>
      </div>`;
      dialog.appendChild(overlay);
      const cancelBtn = /** @type {HTMLButtonElement | null} */ ($("[data-confirm-cancel]", overlay));
      const okBtn = /** @type {HTMLButtonElement | null} */ ($("[data-confirm-ok]", overlay));
      const errEl = $("[data-confirm-error]", overlay);
      const cleanupOverlay = () => {
        dialog.removeEventListener("cancel", onDialogCancel);
        overlay.remove();
      };
      const closeViaUser = () => {
        cleanupOverlay();
        if (overlayToken != null && dialog.open) {
          popOverlay(overlayToken);
          overlayToken = null;
        }
      };
      const onDialogCancel = (event) => {
        event.preventDefault();
        closeViaUser();
      };
      dialog.addEventListener("cancel", onDialogCancel);
      overlayToken = pushOverlay(() => {
        overlayToken = null;
        cleanupOverlay();
      });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay && !okBtn?.disabled) closeViaUser();
      });
      cancelBtn?.addEventListener("click", closeViaUser);
      okBtn?.addEventListener("click", async () => {
        if (!okBtn || okBtn.disabled) return;
        okBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        if (errEl) /** @type {HTMLElement} */ (errEl).hidden = true;
        try {
          await onConfirm();
          cleanupOverlay();
          if (overlayToken != null && dialog.open) {
            popOverlay(overlayToken);
            overlayToken = null;
          }
        } catch (error) {
          if (errEl) {
            errEl.textContent = error?.message || "操作失败，请重试";
            /** @type {HTMLElement} */ (errEl).hidden = false;
          }
          okBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
        }
      });
      cancelBtn?.focus({ preventScroll: true });
      return;
    }

    open(title, `<div class="confirm-dialog-body">
      <p class="confirm-dialog-message">${esc(message)}</p>
      <p class="form-error" data-confirm-error role="alert" hidden></p>
      <footer class="confirm-dialog-foot">
        <button type="button" class="quiet" data-confirm-cancel>取消</button>
        <button type="button" class="danger" data-confirm-ok>${esc(confirmLabel)}</button>
      </footer>
    </div>`);
    const cancelBtn = /** @type {HTMLButtonElement | null} */ ($("[data-confirm-cancel]", dialog));
    const okBtn = /** @type {HTMLButtonElement | null} */ ($("[data-confirm-ok]", dialog));
    const errEl = $("[data-confirm-error]", dialog);
    cancelBtn?.addEventListener("click", () => dialog.close());
    okBtn?.addEventListener("click", async () => {
      if (!okBtn || okBtn.disabled) return;
      okBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      if (errEl) /** @type {HTMLElement} */ (errEl).hidden = true;
      try {
        await onConfirm();
        if (dialog.open) dialog.close();
      } catch (error) {
        if (errEl) {
          errEl.textContent = error?.message || "操作失败，请重试";
          /** @type {HTMLElement} */ (errEl).hidden = false;
        }
        okBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
      }
    });
  }

  dialog.addEventListener("close", () => {
    $('[data-action="more-menu"]')?.setAttribute("aria-expanded", "false");
    dialog.style.transform = "";
    dialog.style.transition = "";
    overlayStack.length = 0;
    const depth = modalHistoryDepth;
    modalHistoryDepth = 0;
    const suppress = suppressNextHistoryBack;
    suppressNextHistoryBack = false;
    if (depth > 0 && !closingFromPopstate && !suppress && (history.state?.ironlogModal || history.state?.ironlogOverlay)) {
      expectedProgrammaticPops++;
      try { history.go(-depth); } catch { expectedProgrammaticPops = Math.max(0, expectedProgrammaticPops - 1); }
    }
    onAfterClose?.();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog || dialog.classList.contains("workout-dialog") || dialog.classList.contains("onboarding-dialog")) return;
    const isSheet = dialog.classList.contains("mobile-sheet");
    const isFormDialog = Boolean(dialog.querySelector("form"));
    if (!isSheet && isFormDialog) return;
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  });

  // Mobile bottom-sheet pull-down-to-dismiss gesture on dialog header or non-form sheets at scrollTop
  let sheetTouchY = 0;
  let sheetTouchX = 0;
  let sheetDragging = false;
  dialog.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || dialog.classList.contains("workout-dialog")) return;
    if (!matchMedia("(max-width: 630px)").matches) return;
    const targetEl = /** @type {Element | null} */ (e.target);
    const inHead = Boolean(targetEl?.closest?.(".dialog-head"));
    const hasForm = Boolean(dialog.querySelector("form"));
    const atTopScroll = dialog.scrollTop <= 2 && !targetEl?.closest?.("input, textarea, select");
    if (!inHead && (hasForm || !atTopScroll)) return;
    sheetTouchY = e.touches[0].clientY;
    sheetTouchX = e.touches[0].clientX;
    sheetDragging = true;
    dialog.style.transition = "none";
  }, { passive: true });

  dialog.addEventListener("touchmove", (e) => {
    if (!sheetDragging || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - sheetTouchY;
    const dx = e.touches[0].clientX - sheetTouchX;
    if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy)) {
      sheetDragging = false;
      dialog.style.transform = "";
      return;
    }
    if (dy > 8 && dy > Math.abs(dx) * 1.3) {
      dialog.style.transform = `translateY(${Math.min(220, dy * 0.72).toFixed(1)}px)`;
    }
  }, { passive: true });

  const endSheetDrag = (e) => {
    if (!sheetDragging) return;
    sheetDragging = false;
    const dy = e.changedTouches?.[0] ? e.changedTouches[0].clientY - sheetTouchY : 0;
    dialog.style.transition = "transform .18s ease";
    dialog.style.transform = "";
    if (dy >= 78) dialog.close();
  };
  dialog.addEventListener("touchend", endSheetDrag, { passive: true });
  dialog.addEventListener("touchcancel", endSheetDrag, { passive: true });

  return {
    pushOverlay,
    popOverlay,
    open,
    openConfirmDialog,
    closeModalSilent,
  };
}
