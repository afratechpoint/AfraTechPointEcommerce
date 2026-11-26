"use client";

import React, { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
    const msg = error?.message || "";
    if (
      typeof window !== "undefined" &&
      (error?.name === "ChunkLoadError" ||
        msg.includes("ChunkLoadError") ||
        msg.includes("Failed to fetch dynamically imported module") ||
        msg.includes("Failed to fetch") ||
        msg.includes("Loading chunk"))
    ) {
      const key = "afra_chunk_reload_ts";
      const last = Number(sessionStorage.getItem(key) || "0");
      if (Date.now() - last > 8000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error]);

  const handleRetry = () => {
    try {
      reset();
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="max-w-md w-full text-center space-y-6 border border-gray-200 rounded-2xl p-8">
        <div className="space-y-3">
          <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle size={26} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
          <p className="text-gray-500 text-xs sm:text-sm leading-relaxed">
            A temporary connection or page update interrupted loading. Click retry to continue.
          </p>
          {process.env.NODE_ENV !== "production" && error?.message && (
            <p className="text-[11px] font-mono text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5 break-all text-left">
              {error.message}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={handleRetry}
            className="w-full sm:w-auto h-10 px-6 bg-black text-white rounded-xl font-semibold text-xs sm:text-sm hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw size={14} />
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto h-10 px-6 bg-white text-gray-900 border border-gray-200 rounded-xl font-semibold text-xs sm:text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            Hard Reload
          </button>
          <Link
            href="/"
            className="w-full sm:w-auto h-10 px-5 bg-white text-gray-600 border border-gray-200 rounded-xl font-semibold text-xs sm:text-sm hover:text-black transition-colors flex items-center justify-center gap-2"
          >
            <Home size={14} />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
