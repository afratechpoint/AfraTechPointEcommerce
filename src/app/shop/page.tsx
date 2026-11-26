"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { ShoppingCart, ArrowRight, Plus, RotateCcw, CalendarDays, Tag, ArrowUpDown, Sparkles, Wallet, Check, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCart } from "@/lib/cart";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { useSettings } from "@/components/SettingsProvider";
import { Suspense } from "react";
import PremiumLoader from "@/components/PremiumLoader";
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
  createdAt?: string;
  stock?: number;
  variants?: any[];
}

type SortId = "default" | "name-asc" | "name-desc" | "date-desc" | "date-asc" | "price-asc" | "price-desc";


const SORT_OPTIONS: { id: SortId; label: string; icon: any }[] = [
  { id: "default", label: "Recommended", icon: Sparkles },
  { id: "name-asc", label: "Name: A to Z", icon: Tag },
  { id: "name-desc", label: "Name: Z to A", icon: Tag },
  { id: "date-desc", label: "Newest first", icon: CalendarDays },
  { id: "date-asc", label: "Oldest first", icon: CalendarDays },
  { id: "price-asc", label: "Price: Low to High", icon: Wallet },
  { id: "price-desc", label: "Price: High to Low", icon: Wallet },
];

function ShopContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category');
  
    const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(categoryParam || "All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortId>("default");
  
  const { addItem } = useCart();

  const priceOf = (p: Product) => p.salePrice || p.regularPrice || p.price || 0;

  useEffect(() => {
    if (categoryParam) {
      setSelectedCategory(categoryParam);
    }
  }, [categoryParam]);

  const loadProducts = React.useCallback(() => {
    fetch("/api/products", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useRealtime("products", loadProducts);

  useEffect(() => {
    let result = [...products];
    
    if (searchQuery) {
      result = result.filter(p => 
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    if (selectedCategory !== "All") {
      result = result.filter(p => p.category?.trim().toLowerCase() === selectedCategory.trim().toLowerCase());
    }

    if (sortOrder === "price-asc") {
      result.sort((a, b) => priceOf(a) - priceOf(b));
    } else if (sortOrder === "price-desc") {
      result.sort((a, b) => priceOf(b) - priceOf(a));
    } else if (sortOrder === "name-asc") {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOrder === "name-desc") {
      result.sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortOrder === "date-desc") {
      result.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    } else if (sortOrder === "date-asc") {
      result.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    }

    setFilteredProducts(result);
  }, [selectedCategory, searchQuery, sortOrder, products]);

  const settings = useSettings();
  
  // Only show categories that have AT LEAST ONE product
  const categories = React.useMemo(() => {
    const list = ["All"];
    const seen = new Set<string>(["all"]);

    const counts: Record<string, number> = {};
    for (const p of products) {
      if (p.category) {
        const key = p.category.trim().toLowerCase();
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    // 1. Configured categories from settings with >= 1 product
    for (const cat of (settings.categories || [])) {
      if (!cat?.label) continue;
      const key = cat.label.trim().toLowerCase();
      const slugKey = cat.slug ? cat.slug.trim().toLowerCase() : "";
      const count = (counts[key] || 0) + (slugKey && slugKey !== key ? (counts[slugKey] || 0) : 0);
      if (count > 0 && !seen.has(key)) {
        list.push(cat.label);
        seen.add(key);
        if (slugKey) seen.add(slugKey);
      }
    }

    // 2. Any additional product categories with >= 1 product
    for (const p of products) {
      if (!p.category) continue;
      const key = p.category.trim().toLowerCase();
      if (!seen.has(key)) {
        list.push(p.category.trim());
        seen.add(key);
      }
    }

    return list;
  }, [settings.categories, products]);

  // Reset selected category to "All" if it no longer exists
  useEffect(() => {
    if (selectedCategory !== "All" && !categories.some(c => c.toLowerCase() === selectedCategory.toLowerCase())) {
      setSelectedCategory("All");
    }
  }, [selectedCategory, categories]);

  // Horizontal scroll controls for category strip
  const desktopCatScrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeftCat, setCanScrollLeftCat] = useState(false);
  const [canScrollRightCat, setCanScrollRightCat] = useState(false);

  // Custom sort dropdown state
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setIsSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const checkCatScroll = React.useCallback(() => {
    const el = desktopCatScrollRef.current;
    if (!el) return;
    setCanScrollLeftCat(el.scrollLeft > 2);
    setCanScrollRightCat(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const timer = setTimeout(checkCatScroll, 100);
    const el = desktopCatScrollRef.current;
    if (!el) return () => clearTimeout(timer);
    el.addEventListener("scroll", checkCatScroll, { passive: true });
    window.addEventListener("resize", checkCatScroll);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", checkCatScroll);
      window.removeEventListener("resize", checkCatScroll);
    };
  }, [checkCatScroll, categories]);

  const scrollShopCategories = (direction: "left" | "right") => {
    if (desktopCatScrollRef.current) {
      desktopCatScrollRef.current.scrollBy({
        left: direction === "left" ? -240 : 240,
        behavior: "smooth",
      });
    }
  };

  const handleShopCategorySelect = (
    cat: string,
    e: React.MouseEvent<HTMLButtonElement>,
    containerRef: React.RefObject<HTMLDivElement | null>
  ) => {
    setSelectedCategory(cat);
    const container = containerRef.current;
    if (!container) return;
    const btn = e.currentTarget;
    const btnLeft = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;
    const containerWidth = container.clientWidth;
    const targetScroll = btnLeft - (containerWidth / 2) + (btnWidth / 2);
    container.scrollTo({
      left: Math.max(0, targetScroll),
      behavior: "smooth",
    });
  };

  const hasActiveFilters = searchQuery.trim() !== "" || selectedCategory !== "All" || sortOrder !== "default";

  const resetFilters = () => {
    setSearchQuery("");
    setSelectedCategory("All");
    setSortOrder("default");
  };

  return (
    <div className="flex flex-col w-full min-h-screen pb-20 md:pb-0">
      <Navbar 
        searchEnabled={true} 
        searchQuery={searchQuery} 
        setSearchQuery={setSearchQuery} 
      />
      
      {/* Constraints for centered content */}
      <div className="w-full max-w-[1800px] mx-auto flex flex-col relative px-4 sm:px-6 md:px-8 lg:px-12">

        {/* ── Shop Header ────────────────────────────────────────── */}
        <header className="mb-6 mt-4 w-full flex flex-col">
          {/* Level 1: Category Navigation Strip */}
          <div className="relative w-full flex items-center mb-4">
            {canScrollLeftCat && (
              <button
                type="button"
                onClick={() => scrollShopCategories("left")}
                aria-label="Previous categories"
                className="hidden md:flex absolute -left-4 z-20 w-8 h-8 rounded-full bg-white border border-gray-200/90 shadow-md items-center justify-center text-gray-700 hover:text-black hover:bg-gray-50 hover:scale-110 active:scale-95 transition-all"
              >
                <ChevronLeft size={16} />
              </button>
            )}

            <div
              ref={desktopCatScrollRef}
              className="flex items-center gap-2 p-1.5 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto no-scrollbar scroll-smooth w-full min-w-0"
            >
              {categories.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={(e) => handleShopCategorySelect(cat, e, desktopCatScrollRef)}
                    className={cn(
                      "shrink-0 px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                      isSelected
                        ? "bg-black text-white shadow-md shadow-black/10"
                        : "bg-gray-50/80 hover:bg-gray-100 text-gray-600 hover:text-black"
                    )}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {canScrollRightCat && (
              <button
                type="button"
                onClick={() => scrollShopCategories("right")}
                aria-label="Next categories"
                className="hidden md:flex absolute -right-4 z-20 w-8 h-8 rounded-full bg-white border border-gray-200/90 shadow-md items-center justify-center text-gray-700 hover:text-black hover:bg-gray-50 hover:scale-110 active:scale-95 transition-all"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          {/* Level 2: Toolbar (Title, Count & Sort / Filter controls) */}
          <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100">
            {/* Left: Category Heading & Items Count */}
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h1 className="text-sm sm:text-base font-black uppercase tracking-tight text-gray-900 truncate">
                {selectedCategory === "All" ? "All Products" : selectedCategory}
              </h1>
              <span className="text-xs font-bold text-gray-400 shrink-0">
                ({filteredProducts.length} {filteredProducts.length === 1 ? "item" : "items"})
              </span>

              {/* Reset Filters chip */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold uppercase tracking-wider transition-colors ml-1"
                >
                  <RotateCcw size={11} /> Reset
                </button>
              )}
            </div>

            {/* Right: Custom Animated Sort Dropdown */}
            <div className="flex items-center gap-2.5 shrink-0">
              {/* Custom Sort Dropdown */}
              <div className="relative" ref={sortRef}>
                <button
                  type="button"
                  onClick={() => setIsSortOpen(!isSortOpen)}
                  className="h-10 px-3.5 sm:px-4 rounded-xl bg-white border border-gray-200/90 hover:border-gray-400 text-xs font-bold text-gray-800 flex items-center gap-1.5 sm:gap-2 transition-all shadow-sm active:scale-95"
                >
                  <ArrowUpDown size={13} className="text-gray-400 shrink-0" />
                  <span className="text-gray-500 font-medium hidden sm:inline">Sort:</span>
                  <span className="text-gray-900 font-bold max-w-[120px] truncate">
                    {SORT_OPTIONS.find(o => o.id === sortOrder)?.label || "Recommended"}
                  </span>
                  <ChevronDown size={14} className={cn("text-gray-400 transition-transform duration-200 shrink-0", isSortOpen && "rotate-180")} />
                </button>

                <AnimatePresence>
                  {isSortOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-2xl border border-gray-100 shadow-xl py-1.5 z-50 overflow-hidden"
                    >
                      {SORT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const isSelected = sortOrder === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSortOrder(opt.id);
                              setIsSortOpen(false);
                            }}
                            className={cn(
                              "w-full px-3.5 py-2.5 text-xs font-bold flex items-center justify-between text-left transition-colors",
                              isSelected ? "bg-gray-50 text-black font-black" : "text-gray-600 hover:bg-gray-50/80 hover:text-black"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={14} className={isSelected ? "text-black" : "text-gray-400"} />
                              <span>{opt.label}</span>
                            </div>
                            {isSelected && <Check size={14} strokeWidth={2.5} className="text-black" />}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-4 mt-2 md:mt-4 relative w-full">
          
          {/* Products Grid */}
          <main className="w-full">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${selectedCategory}-${sortOrder}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-6 lg:gap-8 auto-rows-fr"
              >
                {isLoading ? (
                  [1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <div key={i} className="bg-white rounded-2xl h-[280px] md:h-[380px] animate-pulse border border-gray-100" />
                  ))
                ) : filteredProducts.length > 0 ? (
                  filteredProducts.map((product, i) => {
                    const outOfStock = isProductOutOfStock(product as any);
                    return (
                    <div
                      key={product.id}
                      className="group relative bg-white rounded-2xl border border-gray-100/80 hover:border-gray-200 hover:shadow-lg hover:shadow-gray-100/80 transition-all duration-300 flex flex-col overflow-hidden active:scale-[0.98]"
                    >
                      {/* Image */}
                      <Link href={`/shop/${product.id}`} className="relative aspect-square bg-gray-100 overflow-hidden block">
                        <Image
                          src={product.image}
                          alt={product.name}
                          fill
                          priority={i < 4}
                          sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                          className={cn(
                            "object-cover group-hover:scale-105 transition-transform duration-500 ease-out",
                            outOfStock && "opacity-75"
                          )}
                        />
                        {/* Out of Stock / Sale Badge */}
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
                                    quantity: 1, productKind: product.productKind, virtualType: product.virtualType
                                  });
                                  toast.success(`${product.name} added to cart!`);
                                }}
                                style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-text)' }}
                                className="hidden md:flex flex-1 py-2 rounded-xl text-[9px] font-black text-center transition-all uppercase tracking-widest items-center justify-center gap-1 shadow-sm hover:opacity-90"
                              >
                                <Plus size={11} strokeWidth={3} /> Add
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
                                    quantity: 1, productKind: product.productKind, virtualType: product.virtualType
                                  });
                                  toast.success(`${product.name} added!`);
                                }}
                                className="md:hidden ml-auto w-7 h-7 bg-black text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform"
                              >
                                <Plus size={13} strokeWidth={3} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })
                ) : (
                  <div className="col-span-full py-20 text-center">
                    <p className="text-gray-400 font-bold text-sm md:text-base">No products found for this category or filter.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

      </div>

      <Footer />
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<PremiumLoader />}>
      <ShopContent />
    </Suspense>
  );
}
