/**
 * Safe clipboard copy with a legacy fallback.
 *
 * `navigator.clipboard.writeText()` rejects with NotAllowedError when the
 * browser denies clipboard permission (common in iframes, insecure origins,
 * or when the user blocked it). Calling it without awaiting/catching produces
 * an unhandled promise rejection. Always use this helper instead.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? "");

  // Modern path — only available on secure contexts.
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission denied or API unavailable — try the fallback below.
    }
  }

  // Legacy fallback (works on http and older browsers).
  if (typeof document === "undefined") return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
