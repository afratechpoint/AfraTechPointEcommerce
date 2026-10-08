import { MetadataRoute } from 'next'
import { storage } from '@/lib/storage'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const shopUrl = process.env.NEXT_PUBLIC_SHOP_URL || 'https://afratechpoint.shop'
  const lastModified = new Date()

  // Base routes with optimal SEO priority weights
  const routes: MetadataRoute.Sitemap = [
    {
      url: `${shopUrl}`,
      lastModified,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${shopUrl}/shop`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${shopUrl}/about`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${shopUrl}/contact`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${shopUrl}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.5,
    },
  ];

  try {
    const products = await storage.getProducts()
    const productRoutes: MetadataRoute.Sitemap = products.map((product: any) => {
      let productDate = lastModified;
      if (product.updatedAt) {
        try {
          const parsed = new Date(product.updatedAt?.seconds ? product.updatedAt.seconds * 1000 : product.updatedAt);
          if (!isNaN(parsed.getTime())) {
            productDate = parsed;
          }
        } catch(e) {}
      }
      return {
        url: `${shopUrl}/shop/${product.id}`,
        lastModified: productDate,
        changeFrequency: 'weekly' as const,
        priority: 0.85,
      };
    })

    return [...routes, ...productRoutes]
  } catch (error) {
    console.error('[Sitemap] Fetch error:', error)
    return routes
  }
}
