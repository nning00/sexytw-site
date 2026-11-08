// Keep full bodies and SEO metadata out of homepage card reads.
export const homeCardFields = "id,slug,title,excerpt,category,cover_image_path,cover_image_alt,article_categories(name)";

export async function queryHomeArticleCards(supabase) {
  const { data, error } = await supabase.from("articles")
    .select(homeCardFields).eq("status", "published").eq("is_featured", true)
    .order("featured_order").order("sort_order").order("published_at", { ascending: false }).limit(3);
  if (error) throw new Error("Homepage article card query failed");
  if (data?.length) return data;
  // Preserve the existing behavior: fallback only when NO featured article exists.
  const fallback = await supabase.from("articles").select(homeCardFields)
    .eq("status", "published").order("sort_order").order("published_at", { ascending: false }).limit(3);
  if (fallback.error) throw new Error("Homepage article card fallback failed");
  return fallback.data ?? [];
}
