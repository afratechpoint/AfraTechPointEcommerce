"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUI } from "@/lib/ui";

/**
 * NOTE: This component intentionally avoids `useSearchParams()`.
 * Using it here (in the root layout) makes React suspend this boundary during
 * SSR, which emits a hidden wrapper/template in the HTML. On the client the
 * hook resolves immediately, so the tree shape differs and React reports a
 * hydration mismatch at <div id="main-content">. Reading the pathname only
 * keeps server and client markup identical.
 */
export default function NavigationObserver() {
  const pathname = usePathname();
  const { setIsLoading } = useUI();

  // Navigation finished (pathname changed) — clear the loading overlay.
  useEffect(() => {
    setIsLoading(false);
  }, [pathname, setIsLoading]);

  // Back/forward navigation also needs to clear the overlay.
  useEffect(() => {
    const handlePopState = () => setIsLoading(false);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setIsLoading]);

  useEffect(() => {
    const handleAnchorClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest("a");

      if (
        anchor &&
        anchor.href &&
        anchor.target !== "_blank" &&
        anchor.origin === window.location.origin && // Internal link
        anchor.pathname !== pathname // Different page
      ) {
        // Only trigger for real navigations, not hash changes or same page clicks
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          setIsLoading(true);
        }
      }
    };

    document.addEventListener("click", handleAnchorClick);
    return () => document.removeEventListener("click", handleAnchorClick);
  }, [setIsLoading, pathname]);

  return null;
}
