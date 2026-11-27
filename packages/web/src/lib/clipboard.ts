export async function copyText(value: string): Promise<boolean> {
  const text = String(value ?? "");
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const host = document.querySelector("dialog[open]") || document.body;
    const isIos =
      typeof navigator !== "undefined" &&
      (/iPad|iPhone|iPod/i.test(navigator.userAgent || "") ||
        (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1));
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("aria-hidden", "true");
    ta.style.cssText =
      "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:0;outline:none;box-shadow:none;background:transparent;opacity:0.01;font-size:16px";
    if (isIos) {
      ta.contentEditable = "true";
      ta.readOnly = true;
    } else {
      ta.setAttribute("readonly", "");
    }
    host.appendChild(ta);
    ta.focus({ preventScroll: true });
    if (isIos && typeof document.createRange === "function" && typeof window.getSelection === "function") {
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      ta.setSelectionRange(0, 999999);
    } else {
      ta.select();
      ta.setSelectionRange(0, text.length);
    }
    const ok = document.execCommand("copy");
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}
