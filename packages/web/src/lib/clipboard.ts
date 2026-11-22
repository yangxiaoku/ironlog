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
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px";
    host.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}
