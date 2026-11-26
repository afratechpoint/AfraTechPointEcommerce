"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2, ArrowLeft } from "lucide-react";
import ProductForm from "@/components/admin/ProductForm";
import { authenticatedFetch } from "@/lib/api-helper";

export default function EditProductPage() {
  const params = useParams();
  const [product, setProduct] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      authenticatedFetch(`/api/products/${params.id}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          setProduct(data?.id ? data : null);
          setIsLoading(false);
        })
        .catch((err) => {
          console.error("Error fetching product:", err);
          setIsLoading(false);
        });
    }
  }, [params.id]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        <Loader2 className="animate-spin" size={26} />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200/80 p-10 text-center space-y-3">
        <p className="text-sm font-semibold text-gray-900">Product not found</p>
        <p className="text-xs text-gray-500">
          This product may have been deleted or moved.
        </p>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-black text-white text-xs font-semibold hover:bg-gray-900 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Products
        </Link>
      </div>
    );
  }

  return <ProductForm initialData={product} />;
}
