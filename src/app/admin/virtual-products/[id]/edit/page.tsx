"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import VirtualProductForm from "@/components/admin/VirtualProductForm";
import { authenticatedFetch } from "@/lib/api-helper";

export default function EditVirtualProductPage() {
  const params = useParams();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      authenticatedFetch(`/api/products/${params.id}`, { cache: "no-store" })
        .then(r => r.json())
        .then(data => { setProduct(data); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [params.id]);

  if (loading) return <div className="flex h-64 items-center justify-center text-gray-400"><Loader2 className="animate-spin" size={32} /></div>;
  if (!product?.id) return <div className="flex h-64 items-center justify-center text-gray-400 font-bold">Product not found</div>;

  return <VirtualProductForm initialData={product} />;
}
