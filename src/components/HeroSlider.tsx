"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSettings } from "@/components/SettingsProvider";

interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  imageUrl: string;
  linkUrl?: string;
}

interface HeroSliderProps {
  banners: Banner[];
}

export default function HeroSlider({ banners }: HeroSliderProps) {
  const settings = useSettings();
  const liveBanners: Banner[] =
    Array.isArray(settings?.banners) && settings.banners.length > 0
      ? (settings.banners as any)
      : banners;

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const slides = liveBanners.map((b, i) => ({
    id: b.id || String(i),
    title: b.title,
    description: (b.description || b.subtitle || "").replace(/\s*\n+\s*/g, " ").trim(),
    image: b.imageUrl,
    linkUrl: b.linkUrl || "/shop",
  }));

  const nextSlide = useCallback(() => {
    if (slides.length <= 1) return;
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  }, [slides.length]);

  const prevSlide = useCallback(() => {
    if (slides.length <= 1) return;
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || isPaused) return;
    const timer = setInterval(nextSlide, 5000);
    return () => clearInterval(timer);
  }, [currentSlide, slides.length, isPaused, nextSlide]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setIsPaused(true);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current !== null && slides.length > 1) {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(delta) > 45) {
        if (delta < 0) nextSlide();
        else prevSlide();
      }
    }
    touchStartX.current = null;
    setIsPaused(false);
  };

  if (slides.length === 0) return null;

  const slide = slides[currentSlide];

  return (
    <div
      className="w-full bg-white border-b border-gray-100 select-none"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12">
        {/* Slide Content */}
        <div className="min-h-[420px] md:min-h-0 md:h-[400px] lg:h-[430px] flex items-center py-6 md:py-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={slide.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="w-full grid grid-cols-1 md:grid-cols-12 items-center gap-6 md:gap-10 lg:gap-16"
            >
              {/* Left: Text & Actions */}
              <div className="order-2 md:order-1 md:col-span-7 flex flex-col items-center md:items-start text-center md:text-left">
                <h2 className="text-2xl sm:text-3xl md:text-[34px] lg:text-[40px] font-bold text-gray-900 leading-[1.2] tracking-tight line-clamp-2 max-w-xl">
                  {slide.title}
                </h2>

                {slide.description && (
                  <p className="mt-3 text-sm md:text-[15px] text-gray-500 leading-relaxed max-w-lg line-clamp-2 md:line-clamp-3">
                    {slide.description}
                  </p>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-3 justify-center md:justify-start">
                  <Link
                    href={slide.linkUrl}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-black text-white text-xs sm:text-sm font-semibold hover:bg-gray-800 transition-colors active:scale-[0.98]"
                  >
                    Shop Now <ArrowRight size={15} />
                  </Link>
                  <Link
                    href="/shop"
                    className="inline-flex items-center px-5 py-3 rounded-xl border border-gray-200 text-gray-700 text-xs sm:text-sm font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors active:scale-[0.98]"
                  >
                    Browse Store
                  </Link>
                </div>
              </div>

              {/* Right: Clean Rounded Image */}
              <div className="order-1 md:order-2 md:col-span-5 flex justify-center md:justify-end">
                <Link
                  href={slide.linkUrl}
                  aria-label={slide.title}
                  className="relative block aspect-square w-full max-w-[210px] sm:max-w-[250px] md:max-w-[320px] lg:max-w-[360px] rounded-2xl overflow-hidden bg-gray-50 border border-gray-100"
                >
                  <Image
                    src={`${slide.image}${slide.image.includes("?") ? "&" : "?"}tr=w-900,f-auto,q-85`}
                    alt={slide.title}
                    fill
                    unoptimized={true}
                    loading={currentSlide === 0 ? "eager" : "lazy"}
                    fetchPriority={currentSlide === 0 ? "high" : "low"}
                    sizes="(max-width: 640px) 60vw, (max-width: 1024px) 38vw, 360px"
                    className="object-cover transition-transform duration-500 hover:scale-[1.03]"
                  />
                </Link>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Simple Bottom Controls (No Overlap) */}
        {slides.length > 1 && (
          <div className="flex items-center justify-between pb-5 md:pb-6">
            {/* Minimal Dots */}
            <div className="flex items-center gap-2">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCurrentSlide(i)}
                  aria-label={`Slide ${i + 1}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300 cursor-pointer",
                    currentSlide === i
                      ? "w-6 bg-gray-900"
                      : "w-1.5 bg-gray-300 hover:bg-gray-400"
                  )}
                />
              ))}
            </div>

            {/* Clean Prev / Next Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prevSlide}
                aria-label="Previous slide"
                className="w-9 h-9 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-gray-900 hover:text-gray-900 transition-colors flex items-center justify-center active:scale-95 cursor-pointer"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                type="button"
                onClick={nextSlide}
                aria-label="Next slide"
                className="w-9 h-9 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-gray-900 hover:text-gray-900 transition-colors flex items-center justify-center active:scale-95 cursor-pointer"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
