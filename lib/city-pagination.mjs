export const CITY_PAGE_SIZE = 20;
export const MAX_CITY_PAGE = 100000;

/** @param {string | string[] | undefined} value */
export function parseCityPage(value) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return null;
  const page = Number(value);
  return page <= MAX_CITY_PAGE ? page : null;
}

/** @param {string} region @param {string} city @param {number} page */
export function cityPagePath(region, city, page) {
  const base = `/regions/${encodeURIComponent(region)}/${encodeURIComponent(city)}`;
  return page === 1 ? base : `${base}?page=${page}`;
}

/** A bounded window, with first/last pages always reachable by real links. */
export function cityPageNumbers(current, total) {
  return [...new Set([1, total, current - 1, current, current + 1])]
    .filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
}

// Current catalogues have fewer than 500 pages per city. A bounded directory
// gives crawlers direct links without forcing dozens of next-page hops.
export function cityPageDirectory(total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > 500) return [];
  return Array.from({ length: total }, (_, index) => index + 1);
}

export const cityCardFields = "profiles!inner(id,slug,display_name,card_image_path,sort_order,created_at)";

/** Caller resolves a published location first. Public RLS still applies.
 * One live read, no persistent cache: withdrawals disappear next request.
 */
export async function queryCityProfilePage(client, cityId, page) {
  if (parseCityPage(String(page)) === null) throw new Error("Invalid city page");
  const offset = (page - 1) * CITY_PAGE_SIZE;
  const { data, error, count } = await client.from("profile_cities")
    .select(cityCardFields, { count: "exact" })
    .eq("city_id", cityId).eq("profiles.status", "published")
    .is("profiles.source_missing_at", null)
    // Sort parent assignments using the to-one relation, not just embedded rows.
    .order("profiles(sort_order)", { ascending: true })
    .order("profiles(created_at)", { ascending: false })
    .order("profile_id", { ascending: true })
    .range(offset, offset + CITY_PAGE_SIZE - 1);
  if (error?.code === "PGRST103") return { profiles: [], total: 0 };
  if (error) throw new Error("City profile query failed");
  return { profiles: (data ?? []).map(row => row.profiles), total: count ?? 0 };
}
