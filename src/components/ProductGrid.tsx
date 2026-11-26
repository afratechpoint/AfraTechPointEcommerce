"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { Plus, ShoppingCart, Search, X, Star, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useSettings } from "@/components/SettingsProvider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/lib/realtime-client";
import { isProductOutOfStock } from "@/lib/inventory";


interface Product {
  id: string;
  name: string;
  regularPrice: number;
  salePrice?: number;
  price?: number; // Legacy support
  category: string;
  image: string;
  description: string;
  productKind?: "physical" | "virtual";
  virtualType?: "social" | "account" | "license" | "software";
  variants?: any[];
}

export default function ProductGrid() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const { addItem } = useCart();
  const settings = useSettings();

  const fetchProducts = React.useCallback(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setProducts(data);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useRealtime("products", fetchProducts);

  // Count products in each category (normalized)
  const productCategoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of products) {
      if (p.category) {
        const key = p.category.trim().toLowerCase();
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, [products]);

  // Only show categories that have AT LEAST ONE product
  const activeCategories = React.useMemo(() => {
    const list: { id: string; label: string }[] = [];
    const seen = new Set<string>();

    // 1. Check categories configured in settings (only keep if product count >= 1)
    for (const cat of (settings.categories || [])) {
      if (!cat?.label) continue;
      const key = cat.label.trim().toLowerCase();
      const slugKey = cat.slug ? cat.slug.trim().toLowerCase() : "";
      const count = (productCategoryCounts[key] || 0) + (slugKey && slugKey !== key ? (productCategoryCounts[slugKey] || 0) : 0);
      if (count > 0 && !seen.has(key)) {
        list.push({ id: cat.id || key, label: cat.label });
        seen.add(key);
        if (slugKey) seen.add(slugKey);
      }
    }

    // 2. Also include any product categories from products that have >= 1 product
    for (const p of products) {
      if (!p.category) continue;
      const key = p.category.trim().toLowerCase();
      if (!seen.has(key)) {
        list.push({ id: key, label: p.category.trim() });
        seen.add(key);
      }
    }

    return list;
  }, [settings.categories, products, productCategoryCounts]);

  // Reset filter to 'All' if the selected category is no longer active
  useEffect(() => {
    if (filter !== 'All' && !activeCategories.some(c => c.label.toLowerCase() === filter.toLowerCase())) {
      setFilter('All');
    }
  }, [filter, activeCategories]);

  // Horizontal scroll controls & auto-scroll into view for category pills
  const categoryScrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = React.useCallback(() => {
    const el = categoryScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    // Initial check with a small timeout to account for font/DOM rendering
    const timer = setTimeout(checkScroll, 100);
    const el = categoryScrollRef.current;
    if (!el) return () => clearTimeout(timer);
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, activeCategories]);

  const scrollCategories = (direction: "left" | "right") => {
    if (categoryScrollRef.current) {
      categoryScrollRef.current.scrollBy({
        left: direction === "left" ? -240 : 240,
        behavior: "smooth",
      });
    }
  };

  const handleCategoryClick = (categoryLabel: string, e: React.MouseEvent<HTMLButtonElement>) => {
    setFilter(categoryLabel);
    const container = categoryScrollRef.current;
    if (!container) return;
    const btn = e.currentTarget;
    // Calculate scroll offset within the container ONLY (never affects window/document)
    const btnLeft = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;
    const containerWidth = container.clientWidth;
    const targetScroll = btnLeft - (containerWidth / 2) + (btnWidth / 2);
    container.scrollTo({
      left: Math.max(0, targetScroll),
      behavior: "smooth",
    });
  };

  const filteredProducts = React.useMemo(() => {
    if (filter === 'All') return products;
    const filterKey = filter.trim().toLowerCase();
    return products.filter((p: Product) => p.category?.trim().toLowerCase() === filterKey);
  }, [products, filter]);

  return (
    <section id="shop" className="py-8 md:py-16 w-full max-w-[1800px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 md:mb-16 gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-[2px] bg-black" aria-hidden="true"></div>
            <p className="text-[10px] md:text-xs font-black uppercase tracking-[0.3em] text-gray-500 italic">Curated Tech</p>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight uppercase mb-3">THE <br className="md:hidden"/>COLLECTION.</h2>
          <p className="text-gray-500 mt-2 text-xs md:text-sm max-w-md leading-relaxed font-medium">
            Explore our curated selection of high-end technology, combining futuristic aesthetics with unparalleled performance.
          </p>
        </div>

        {/* ── Scrollable Category Bar with Prev/Next Controls ── */}
        <div className="w-full md:w-auto relative flex items-center max-w-full min-w-0">
          {/* Scroll Left Button */}
          {canScrollLeft && (
            <button 
              type="button"
              onClick={() => scrollCategories("left")}
              aria-label="Previous categories"
              className="hidden md:flex absolute -left-4 z-20 w-8 h-8 rounded-full bg-white border border-gray-200/90 shadow-md items-center justify-center text-gray-700 hover:text-black hover:bg-gray-50 hover:scale-110 active:scale-95 transition-all"
            >
              <ChevronLeft size={16} />
            </button>
          )}

          {/* Category Pills Strip */}
          <div 
            ref={categoryScrollRef}
            className="w-full md:w-auto flex items-center gap-2 bg-white p-2 rounded-3xl shadow-sm border border-gray-100 overflow-x-auto no-scrollbar scroll-smooth min-w-0"
          >
            <button 
              onClick={(e) => handleCategoryClick('All', e)}
              aria-pressed={filter === 'All'}
              className={cn(
                 "px-6 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap shrink-0",
                filter === 'All' ? "bg-[var(--primary)] text-white" : "text-gray-500 hover:text-black"
              )}
            >
              All
            </button>
            {activeCategories.map((cat) => (
              <button 
                key={cat.id}
                onClick={(e) => handleCategoryClick(cat.label, e)}
                aria-pressed={filter.toLowerCase() === cat.label.toLowerCase()}
                className={cn(
                   "px-6 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap shrink-0",
                  filter.toLowerCase() === cat.label.toLowerCase() ? "bg-[var(--primary)] text-white" : "text-gray-500 hover:text-black"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Scroll Right Button */}
          {canScrollRight && (
            <button 
              type="button"
              onClick={() => scrollCategories("right")}
              aria-label="Next categories"
              className="hidden md:flex absolute -right-4 z-20 w-8 h-8 rounded-full bg-white border border-gray-200/90 shadow-md items-center justify-center text-gray-700 hover:text-black hover:bg-gray-50 hover:scale-110 active:scale-95 transition-all"
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={filter}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6"
        >
          {isLoading ? (
            [1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-white rounded-2xl h-[280px] md:h-[380px] animate-pulse border border-gray-100" />
            ))
          ) : filteredProducts.length === 0 ? (
            <div className="col-span-full py-16 text-center text-gray-400 text-xs md:text-sm font-medium">
              No products found in this category.
            </div>
          ) : filteredProducts.map((product, i) => {
            const outOfStock = isProductOutOfStock(product as any);
            return (
            <div
              key={product.id}
              className="group relative bg-white rounded-2xl border border-gray-100/80 hover:border-gray-200 hover:shadow-lg hover:shadow-gray-100/80 transition-all duration-300 flex flex-col overflow-hidden active:scale-[0.98]"
            >
              {/* Image */}
              <Link href={`/shop/${product.id}`} className="relative aspect-square bg-gray-100 overflow-hidden block">
                <Image
                  src={`${product.image}?tr=w-500,f-auto,q-85`}
                  alt={product.name || "Product image"}
                  fill
                  unoptimized={true}
                  loading={i < 4 ? "eager" : "lazy"}
                  fetchPriority={i < 4 ? "high" : "low"}
                  sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className={cn(
                    "object-cover group-hover:scale-105 transition-transform duration-500 ease-out",
                    outOfStock && "opacity-75"
                  )}
                />
                 {outOfStock ? (
                   <div className="absolute top-2 left-2 bg-red-600 text-white text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider z-10 shadow-xs">
                     Stock Out
                   </div>
                 ) : product.salePrice ? (
                   <div className="absolute top-2 left-2 bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider z-10">
                     SALE
                   </div>
                 ) : null}
                 {product.productKind === "virtual" && (
                   <div className="absolute top-2 right-2 bg-violet-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider z-10">
                     {product.virtualType === "software" ? "Download" : product.virtualType === "social" ? "Social" : "Digital"}
                   </div>
                 )}
              </Link>

              {/* Info */}
              <div className="flex flex-col flex-1 p-2.5 md:p-3.5">
                 <p className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5 truncate">
                   {product.category}
                 </p>
                 <Link href={`/shop/${product.id}`}>
                   <h3 className="text-[11px] md:text-[13px] font-black text-gray-900 leading-tight line-clamp-2 mb-1.5 group-hover:text-black">
                     {product.name}
                   </h3>
                 </Link>

                 <div className="flex items-baseline gap-1.5 mt-auto mb-2.5">
                    <p className="text-sm md:text-base font-black text-gray-900">
                      {settings?.currencySymbol || '৳'}{(product.salePrice || product.regularPrice || product.price || 0).toFixed(0)}
                    </p>
                    {product.salePrice && (
                      <span className="text-[9px] md:text-xs font-bold text-gray-300 line-through">
                        {settings?.currencySymbol || '৳'}{(product.regularPrice || product.price || 0).toFixed(0)}
                      </span>
                    )}
                 </div>

                 {/* Desktop Description */}
                 <p className="hidden md:block text-[10px] text-gray-400 leading-relaxed mb-3 line-clamp-2">
                   {product.description?.length > 80 ? `${product.description.substring(0, 80)}...` : (product.description || "")}
                 </p>

                 {/* Action Buttons */}
                 <div className="flex items-center gap-2 mt-auto">
                    <Link 
                      href={`/shop/${product.id}`}
                      className="hidden md:flex flex-1 py-2 bg-gray-50 hover:bg-gray-100 text-black rounded-xl text-[9px] font-black text-center transition-all uppercase tracking-widest items-center justify-center border border-gray-100"
                    >
                      Details
                    </Link>

                    {outOfStock ? (
                      <button
                        type="button"
                        disabled
                        className="flex-1 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-[9px] font-black text-center uppercase tracking-widest cursor-not-allowed"
                      >
                        Stock Out
                      </button>
                    ) : product.variants && product.variants.length > 0 ? (
                      <>
                        {/* Desktop: View to Add */}
                        <Link 
                          href={`/shop/${product.id}`}
                          className="hidden md:flex flex-1 py-2 bg-black hover:bg-gray-800 text-white rounded-xl text-[9px] font-black text-center transition-all uppercase tracking-widest items-center justify-center gap-1 shadow-sm"
                        >
                          View to Add <ArrowRight size={11} strokeWidth={2.5} />
                        </Link>
                        {/* Mobile: View to Add */}
                        <Link 
                          href={`/shop/${product.id}`}
                          className="md:hidden ml-auto px-2.5 py-1.5 bg-black hover:bg-gray-800 text-white rounded-xl text-[8px] font-black uppercase tracking-wider flex items-center gap-1 shadow-sm active:scale-95 transition-transform"
                        >
                          View to Add <ArrowRight size={10} strokeWidth={2.5} />
                        </Link>
                      </>
                    ) : (
                      <>
                        {/* Desktop: Add to cart */}
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            addItem({
                              id: product.id,
                              name: product.name,
                              price: product.salePrice || product.regularPrice || product.price || 0,
                              image: product.image,
                              quantity: 1,
                              productKind: product.productKind,
                              virtualType: product.virtualType
                            });
                            toast.success(`${product.name} added to cart!`);
                          }}
                          aria-label={`Add ${product.name} to cart`}
                          style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-text)' }}
                          className="hidden md:flex flex-1 py-2 rounded-xl text-[9px] font-black text-center transition-all uppercase tracking-widest items-center justify-center gap-1 shadow-sm hover:opacity-90"
                        >
                          <Plus size={11} strokeWidth={3} aria-hidden="true" /> Add
                        </button>
                        {/* Mobile: Add to cart */}
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            addItem({
                              id: product.id,
                              name: product.name,
                              price: product.salePrice || product.regularPrice || product.price || 0,
                              image: product.image,
                              quantity: 1,
                              productKind: product.productKind,
                              virtualType: product.virtualType
                            });
                            toast.success(`${product.name} added!`);
                          }}
                          aria-label={`Add ${product.name} to cart`}
                          className="md:hidden ml-auto w-7 h-7 bg-black text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform"
                        >
                          <Plus size={13} strokeWidth={3} aria-hidden="true" />
                        </button>
                      </>
                    )}
                 </div>
              </div>
            </div>
            );
          })}
        </motion.div>
      </AnimatePresence>

    </section>
  );
}
