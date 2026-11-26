"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface AdminSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

export default function AdminSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  name,
  className,
  disabled = false,
  size = "md",
}: AdminSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {name && <input type="hidden" name={name} value={value} />}

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "w-full bg-white border border-gray-200 outline-none transition-all flex items-center justify-between gap-2 text-left",
          size === "sm" ? "h-8 px-3 rounded-lg text-xs" : "h-10 px-3.5 rounded-xl text-sm",
          disabled
            ? "opacity-60 cursor-not-allowed bg-gray-50"
            : "hover:border-gray-300 cursor-pointer",
          isOpen && !disabled && "border-black ring-2 ring-black/5"
        )}
      >
        <span
          className={cn(
            "truncate",
            selectedOption ? "text-gray-900 font-medium" : "text-gray-400"
          )}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={size === "sm" ? 13 : 15}
          className={cn(
            "text-gray-400 shrink-0 transition-transform duration-200",
            isOpen && "rotate-180 text-gray-900"
          )}
        />
      </button>

      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: 4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white rounded-xl border border-gray-200 shadow-lg py-1 max-h-60 overflow-y-auto min-w-[140px]"
          >
            {options.length === 0 ? (
              <div className="px-3.5 py-2.5 text-xs text-gray-400">No options available</div>
            ) : (
              options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "w-full px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer",
                      size === "sm" ? "text-xs" : "text-sm",
                      isSelected
                        ? "bg-gray-100 text-gray-950 font-semibold"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && (
                      <Check size={13} strokeWidth={2.5} className="text-black shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
