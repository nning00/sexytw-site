import { prebuiltSitemapResponse } from '@/lib/prebuilt-sitemap.mjs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
function sitemapEnv() {
  return {
    SITE_URL: process.env.SITE_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_SCHEMA: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA,
    NEXT_PUBLIC_MEDIA_PREFIX: process.env.NEXT_PUBLIC_MEDIA_PREFIX,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}
export async function GET(request: Request) { return prebuiltSitemapResponse(request, sitemapEnv()); }
export async function HEAD(request: Request) { return prebuiltSitemapResponse(request, sitemapEnv()); }
