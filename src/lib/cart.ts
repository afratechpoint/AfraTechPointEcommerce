import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  variantName?: string;
  productKind?: "physical" | "virtual";
  virtualType?: "social" | "account" | "license" | "software";
  customFieldAnswers?: { label: string; value: string }[];
}

interface CartStore {
  items: CartItem[];
  addItem: (product: CartItem) => void;
  removeItem: (id: string, variantName?: string) => void;
  updateQuantity: (id: string, variantName: string | undefined, quantity: number) => void;
  syncCatalog: (products: any[]) => void;
  clearCart: () => void;
}

export const useCart = create<CartStore>()(
  persist(
    (set) => ({
      items: [],
      addItem: (product) => set((state) => {
        const existing = state.items.find((i) => i.id === product.id && i.variantName === product.variantName);
        if (existing) {
          return {
            items: state.items.map((i) => 
              (i.id === product.id && i.variantName === product.variantName) ? { ...i, quantity: i.quantity + 1, price: product.price } : i
            ),
          };
        }
        return { items: [...state.items, { ...product, quantity: product.quantity || 1 }] };
      }),
      removeItem: (id, variantName) => set((state) => ({
        items: state.items.filter((i) => !(i.id === id && i.variantName === variantName)),
      })),
      updateQuantity: (id, variantName, quantity) => set((state) => ({
        items: state.items.map((i) =>
          (i.id === id && i.variantName === variantName) ? { ...i, quantity } : i
        ),
      })),
      syncCatalog: (products) => set((state) => {
        if (!Array.isArray(products) || state.items.length === 0) return state;
        const map = new Map(products.map((p: any) => [p.id, p]));
        let changed = false;
        const nextItems = state.items
          .filter((item) => {
            if (!map.has(item.id)) {
              changed = true;
              return false;
            }
            return true;
          })
          .map((item) => {
            const p = map.get(item.id)!;
            let livePrice = p.salePrice ?? p.regularPrice ?? p.price ?? item.price;
            if (item.variantName && Array.isArray(p.variants)) {
              const v = p.variants.find((vr: any) => vr.name === item.variantName);
              if (v) {
                livePrice = v.salePrice ?? v.regularPrice ?? livePrice;
              }
            }
            if (livePrice !== item.price || p.name !== item.name || (p.image && p.image !== item.image)) {
              changed = true;
              return { ...item, price: livePrice, name: p.name, image: p.image || item.image };
            }
            return item;
          });
        return changed ? { items: nextItems } : state;
      }),
      clearCart: () => set({ items: [] }),
    }),
    {
      name: 'cart-storage',
    }
  )
);
