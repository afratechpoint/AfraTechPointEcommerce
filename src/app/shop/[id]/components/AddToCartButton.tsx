"use client";

// ── AddToCartButton Component ──────────────────────────────────
// Handles all cart-related click logic. Uses the custom useCart
// hook for client-side cart state AND calls the Server Action for
// any server-side persistence / analytics.

import React, { useState } from "react";
import { ShoppingBag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/lib/cart";
import { addToCartAction } from "../actions";
import { Variant } from "../types";
import type { VirtualCustomField } from "@/types/product";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface AddToCartButtonProps {
  productId: string;
  productName: string;
  activePrice: number;
  displayImage: string;
  selectedVariant: Variant | null;
  hasVariants: boolean;
  quantity: number;
  currencySymbol?: string;
  productKind?: "physical" | "virtual";
  virtualType?: "social" | "account" | "license" | "software";
  customFields?: VirtualCustomField[];
  customFieldValues?: Record<string, string>;
  isOutOfStock?: boolean;
  maxStock?: number | null;
}

export default function AddToCartButton({
  productId,
  productName,
  activePrice,
  displayImage,
  selectedVariant,
  hasVariants,
  quantity,
  currencySymbol = "৳",
  productKind,
  virtualType,
  customFields = [],
  customFieldValues = {},
  isOutOfStock = false,
  maxStock = null,
}: AddToCartButtonProps) {
  const { items, addItem } = useCart();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleAddToCart = async (isBuyNow = false) => {
    if (isOutOfStock) {
      toast.error("This product is Stock Out.");
      return;
    }

    // Guard: require variant selection when variants exist
    if (hasVariants && !selectedVariant) {
      toast.error("Please select a variant first!");
      return;
    }

    if (maxStock !== null && maxStock !== undefined) {
      const existingInCart =
        items.find((i) => i.id === productId && i.variantName === selectedVariant?.name)
          ?.quantity || 0;
      if (existingInCart + quantity > maxStock) {
        toast.error(`Only ${maxStock} available in stock.`);
        return;
      }
    }

    const missingField = customFields.find(f => !(customFieldValues[f.id] || "").trim());
    if (missingField) {
      toast.error(`Please fill ${missingField.label}`);
      return;
    }

    setIsLoading(true);

    const cartItem = {
      id: productId,
      name: productName,
      price: activePrice,
      image: displayImage,
      variantName: selectedVariant?.name,
      quantity,
      productKind: productKind || "physical",
      virtualType,
      customFieldAnswers: customFields.map(f => ({
        label: f.label,
        value: (customFieldValues[f.id] || "").trim(),
      })),
    };

    // 1. Optimistic update — instant client-side cart
    addItem(cartItem);

    // 2. Server Action — persistence / logging
    const result = await addToCartAction(cartItem);

    setIsLoading(false);

    if (result.success) {
      toast.success(result.message);
      if (isBuyNow) {
        router.push("/checkout");
      }
      // If not BuyNow, let the user stay on the page (or open a sidebar if you have one)
    } else {
      toast.error(result.message);
    }
  };

  const handleBuyNow = async () => {
    await handleAddToCart(true);
  };

  const isSelectionRequired = !isOutOfStock && hasVariants && !selectedVariant;
  const isDisabled = isLoading || isSelectionRequired || isOutOfStock;

  if (isOutOfStock) {
    return (
      <div className="mt-2">
        <button
          type="button"
          disabled
          className="w-full h-11 rounded-xl bg-red-50 text-red-600 border border-red-200 font-black text-xs uppercase tracking-widest flex items-center justify-center cursor-not-allowed"
        >
          Stock Out
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      {/* Add to Cart */}
      <button
        onClick={() => handleAddToCart(false)}
        disabled={isDisabled}
        style={{
          backgroundColor: isSelectionRequired ? "#e5e7eb" : "var(--primary)",
          color: isSelectionRequired ? "#9ca3af" : "var(--primary-text)",
          boxShadow: isSelectionRequired ? "none" : "0 10px 15px -3px var(--primary-accent)",
        }}
        className="h-9 md:h-11 rounded-xl font-black text-[8px] md:text-[9px] uppercase tracking-widest flex items-center justify-center gap-2 hover:scale-[1.03] active:scale-[0.97] transition-all group overflow-hidden relative disabled:opacity-80 disabled:cursor-not-allowed disabled:hover:scale-100"
      >
        {!isSelectionRequired && (
          <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
        )}
        {isLoading ? (
          <Loader2 size={12} className="animate-spin relative z-10" />
        ) : (
          <ShoppingBag size={12} className="relative z-10" />
        )}
        <span className="relative z-10">
          {isLoading ? "Adding…" : isSelectionRequired ? "Select Variant" : "Add to Cart"}
        </span>
      </button>

      {/* Buy Now */}
      <button
        onClick={handleBuyNow}
        disabled={isDisabled}
        className={cn(
          "h-9 md:h-11 rounded-xl font-black text-[8px] md:text-[9px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed",
          isSelectionRequired
            ? "bg-gray-100 text-gray-400 border border-transparent"
            : "bg-white text-black border md:border-2 border-black hover:bg-black hover:text-white hover:scale-[1.03] active:scale-[0.97]"
        )}
      >
        {isSelectionRequired ? "Pick Options" : "Buy Now"}
      </button>
    </div>
  );
}
