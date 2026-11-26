"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Check, X, Wand2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpellIssue {
  id: string;
  offset: number;
  length: number;
  word: string;
  message: string;
  replacements: string[];
}

const STORAGE_ENABLED_KEY = "afra_admin_spellcheck_enabled";
const STORAGE_DICT_KEY = "afra_admin_custom_dictionary";
export const SPELLCHECK_TOGGLE_EVENT = "afra-spellcheck-toggle";

export function getSpellCheckEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const saved = localStorage.getItem(STORAGE_ENABLED_KEY);
  return saved === null ? true : saved === "true";
}

export function setSpellCheckEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_ENABLED_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent(SPELLCHECK_TOGGLE_EVENT, { detail: enabled }));
}

function isCheckableElement(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    if (type !== "text") return false;
    if (el.readOnly || el.disabled) return false;
    // Skip code/key/URL/search inputs where spellcheck isn't helpful
    const ph = (el.placeholder || "").toLowerCase();
    if (
      el.classList.contains("font-mono") ||
      ph.includes("http") ||
      ph.includes("xxxx") ||
      ph.includes("search")
    ) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Updates the value of a React-controlled <input> or <textarea> cleanly
 * so React's internal value tracker and onChange state stay 100% in sync.
 */
function setReactInputValue(el: HTMLInputElement | HTMLTextAreaElement, nextValue: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(el, nextValue);
  } else {
    el.value = nextValue;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function AdminSpellChecker() {
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [activeEl, setActiveEl] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [issues, setIssues] = useState<SpellIssue[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [badgePos, setBadgePos] = useState<{ top: number; left: number; visible: boolean }>({
    top: 0,
    left: 0,
    visible: false,
  });
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 320,
  });

  const customDictRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    setEnabled(getSpellCheckEnabled());
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_DICT_KEY) || "[]");
      if (Array.isArray(saved)) {
        customDictRef.current = new Set(saved.map((w: string) => w.toLowerCase()));
      }
    } catch {}

    const handleToggle = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setEnabled(next);
      if (!next) {
        setIsPopoverOpen(false);
        setIssues([]);
      }
    };
    window.addEventListener(SPELLCHECK_TOGGLE_EVENT, handleToggle);
    return () => window.removeEventListener(SPELLCHECK_TOGGLE_EVENT, handleToggle);
  }, []);

  const updatePositions = useCallback(
    (target: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (!target || !document.body.contains(target)) {
        setBadgePos((p) => ({ ...p, visible: false }));
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 24 || rect.bottom < 0 || rect.top > window.innerHeight) {
        setBadgePos((p) => ({ ...p, visible: false }));
        return;
      }

      const isTextarea = target instanceof HTMLTextAreaElement;
      const top = isTextarea ? rect.bottom - 30 : rect.top + rect.height / 2 - 11;
      const left = rect.right - 8;

      setBadgePos({ top, left, visible: true });

      const popWidth = Math.min(340, window.innerWidth - 24);
      const popLeft = Math.max(12, Math.min(rect.right - popWidth, window.innerWidth - popWidth - 12));
      const spaceBelow = window.innerHeight - rect.bottom;
      const popTop = spaceBelow > 240 ? rect.bottom + 8 : Math.max(12, rect.top - 8);

      setPopoverPos({
        top: spaceBelow > 240 ? popTop : -popTop, // negative signals "anchor above"
        left: popLeft,
        width: popWidth,
      });
    },
    []
  );

  const runCheck = useCallback(
    async (target: HTMLInputElement | HTMLTextAreaElement) => {
      if (!enabled) return;
      const text = target.value || "";
      if (text.trim().length < 3) {
        setIssues([]);
        setHasChecked(false);
        setIsChecking(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsChecking(true);
      try {
        const res = await fetch("/api/admin/spellcheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            isMultiline: target instanceof HTMLTextAreaElement,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        const filtered = (data.issues || []).filter(
          (iss: SpellIssue) => !customDictRef.current.has(iss.word.toLowerCase())
        );
        setIssues(filtered);
        setHasChecked(true);
        if (filtered.length === 0) setIsPopoverOpen(false);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setIsChecking(false);
        }
        return;
      }
      setIsChecking(false);
    },
    [enabled]
  );

  const scheduleCheck = useCallback(
    (target: HTMLInputElement | HTMLTextAreaElement, immediate = false) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!target.value || target.value.trim().length < 3) {
        setIssues([]);
        setHasChecked(false);
        setIsChecking(false);
        return;
      }
      debounceRef.current = setTimeout(
        () => runCheck(target),
        immediate ? 80 : 520
      );
    },
    [runCheck]
  );

  // Track focus, typing, scroll, resize, and outside clicks globally in Admin
  useEffect(() => {
    if (!enabled) return;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (isCheckableElement(target)) {
        setActiveEl(target);
        setIsPopoverOpen(false);
        updatePositions(target);
        scheduleCheck(target, true);
      }
    };

    const onInput = (e: Event) => {
      const target = e.target as Element | null;
      if (target && target === activeEl && isCheckableElement(target)) {
        updatePositions(target);
        scheduleCheck(target, false);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current?.contains(t) ||
        badgeRef.current?.contains(t)
      ) {
        return;
      }
      setIsPopoverOpen(false);
      if (activeEl && !activeEl.contains(t) && !isCheckableElement(t as Element)) {
        setActiveEl(null);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "g" && activeEl && issues.length > 0) {
        e.preventDefault();
        updatePositions(activeEl);
        setIsPopoverOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setIsPopoverOpen(false);
      }
    };

    const onScrollOrResize = () => {
      if (activeEl) updatePositions(activeEl);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("input", onInput);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("input", onInput);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [enabled, activeEl, issues.length, scheduleCheck, updatePositions]);

  const applyReplacement = (issue: SpellIssue, replacement: string) => {
    if (!activeEl) return;
    const currentText = activeEl.value;
    // Verify the word is still at the expected slice
    if (currentText.slice(issue.offset, issue.offset + issue.length) !== issue.word) {
      runCheck(activeEl);
      return;
    }

    const nextText =
      currentText.slice(0, issue.offset) +
      replacement +
      currentText.slice(issue.offset + issue.length);

    const delta = replacement.length - issue.length;
    setReactInputValue(activeEl, nextText);
    activeEl.focus();

    // Shift remaining issue offsets immediately so user can click more fixes without waiting
    setIssues((prev) => {
      const next = prev
        .filter((item) => item.id !== issue.id)
        .map((item) =>
          item.offset > issue.offset ? { ...item, offset: item.offset + delta } : item
        );
      if (next.length === 0) setIsPopoverOpen(false);
      return next;
    });
  };

  const applyFixAll = () => {
    if (!activeEl || issues.length === 0) return;
    let nextText = activeEl.value;
    // Apply from end to start so earlier offsets remain valid
    const sorted = [...issues].sort((a, b) => b.offset - a.offset);
    for (const iss of sorted) {
      const top = iss.replacements[0];
      if (!top) continue;
      if (nextText.slice(iss.offset, iss.offset + iss.length) === iss.word) {
        nextText =
          nextText.slice(0, iss.offset) + top + nextText.slice(iss.offset + iss.length);
      }
    }
    setReactInputValue(activeEl, nextText);
    activeEl.focus();
    setIssues([]);
    setIsPopoverOpen(false);
  };

  const ignoreWord = (word: string) => {
    const lower = word.toLowerCase();
    customDictRef.current.add(lower);
    try {
      localStorage.setItem(STORAGE_DICT_KEY, JSON.stringify(Array.from(customDictRef.current)));
    } catch {}
    setIssues((prev) => {
      const next = prev.filter((i) => i.word.toLowerCase() !== lower);
      if (next.length === 0) setIsPopoverOpen(false);
      return next;
    });
  };

  if (!mounted || !enabled || !activeEl || !badgePos.visible) return null;
  if (!isChecking && !hasChecked && issues.length === 0) return null;

  const anchorAbove = popoverPos.top < 0;
  const resolvedPopTop = Math.abs(popoverPos.top);

  return createPortal(
    <>
      {/* Grammarly-style Floating Badge inside Active Input */}
      <button
        ref={badgeRef}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          updatePositions(activeEl);
          if (issues.length > 0) setIsPopoverOpen((p) => !p);
          else runCheck(activeEl);
        }}
        title={
          isChecking
            ? "Checking spelling…"
            : issues.length > 0
            ? `${issues.length} spelling suggestion${issues.length > 1 ? "s" : ""} (Alt+G)`
            : "No spelling issues found"
        }
        style={{
          position: "fixed",
          top: badgePos.top,
          left: badgePos.left,
          transform: "translateX(-100%)",
          zIndex: 9998,
        }}
        className={cn(
          "h-[22px] rounded-full flex items-center justify-center gap-1 px-2 text-[11px] font-bold shadow-sm border transition-all cursor-pointer select-none",
          isChecking
            ? "bg-white border-gray-200 text-gray-400"
            : issues.length > 0
            ? "bg-red-500 hover:bg-red-600 border-red-500 text-white shadow-red-500/20 animate-in fade-in zoom-in-95 duration-150"
            : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100"
        )}
      >
        {isChecking ? (
          <Loader2 size={11} className="animate-spin" />
        ) : issues.length > 0 ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            <span>{issues.length}</span>
          </>
        ) : (
          <Check size={11} strokeWidth={3} />
        )}
      </button>

      {/* Grammarly-style Quick Fix Popover */}
      {isPopoverOpen && issues.length > 0 && (
        <div
          ref={popoverRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            top: anchorAbove ? undefined : resolvedPopTop,
            bottom: anchorAbove ? window.innerHeight - resolvedPopTop : undefined,
            left: popoverPos.left,
            width: popoverPos.width,
            zIndex: 9999,
          }}
          className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.22)] overflow-hidden select-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-100 bg-gray-50/70">
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-emerald-600" />
              <span className="text-xs font-bold text-gray-900">
                {issues.length} Suggestion{issues.length > 1 ? "s" : ""}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {issues.length > 1 && (
                <button
                  type="button"
                  onClick={applyFixAll}
                  className="h-6 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Wand2 size={11} /> Fix All
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsPopoverOpen(false)}
                className="w-6 h-6 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Issue List */}
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
            {issues.map((issue) => (
              <div key={issue.id} className="p-3 space-y-2 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-red-500 line-through decoration-red-400 truncate">
                      {issue.word}
                    </span>
                    <span className="text-[11px] text-gray-400 truncate">{issue.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => ignoreWord(issue.word)}
                    title="Add to dictionary / ignore"
                    className="text-[10px] font-semibold text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-100 shrink-0 cursor-pointer"
                  >
                    Ignore
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {issue.replacements.map((rep) => (
                    <button
                      key={rep}
                      type="button"
                      onClick={() => applyReplacement(issue, rep)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white border border-emerald-200/80 hover:border-emerald-600 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {rep}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
