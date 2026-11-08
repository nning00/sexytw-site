// Browser-safe media helper. Do not import server CMS/cache modules in editors.
export function mediaUrl(path: string | null | undefined) {
  if (!path) return "/placeholders/hero.svg";
  if (/^https?:\/\//.test(path) || path.startsWith("/")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/site-media/${path}` : "/placeholders/hero.svg";
}
