// List/category/related cards never need full article bodies or SEO settings.
export const articleCardIndexFields = 'id,slug,title,excerpt,category,category_id,cover_image_path,cover_image_alt,article_categories(name)';
export async function queryArticleCardIndex(client, limit) {
  let query = client.from('articles').select(articleCardIndexFields)
    .eq('status', 'published').order('sort_order').order('published_at', { ascending: false }).order('id');
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid article card limit');
    query = query.limit(limit);
  }
  const { data, error } = await query;
  if (error) throw Error('Article card index query failed');
  return data ?? [];
}
