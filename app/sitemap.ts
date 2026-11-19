import type { MetadataRoute } from "next";
import { createPublicClient } from "@/lib/supabase/public";
import { readLiveSitemap } from "@/lib/live-sitemap.mjs";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A single read-only RPC, under the public client's existing RLS. No page
  // caches, demo fallbacks or retained snapshots can revive unpublished rows.
  const configured = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://sexytw.cc").replace(/\/$/, "");
  return await readLiveSitemap(createPublicClient({ noStore: true }), configured) as MetadataRoute.Sitemap;
}
