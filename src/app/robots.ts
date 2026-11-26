import { MetadataRoute } from 'next'
import { getAppUrl } from '@/lib/app-url'

export default function robots(): MetadataRoute.Robots {
  const shopUrl = getAppUrl()
  
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
          '/account/',
          '/checkout/',
          '/cart/',
          '/login',
          '/register',
          '/reset-password',
          '/verify-email',
          '/_next/',
        ],
      },
    ],
    sitemap: `${shopUrl}/sitemap.xml`,
    host: shopUrl,
  }
}
