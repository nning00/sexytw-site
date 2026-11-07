export async function collectCatalog({ fetchPage, normalizeProduct, selectedCity = "", limit = 0, onPage = () => {} }) {
  const rawKeys = new Set();
  const profiles = new Map();
  let total = null;
  let totalPages = null;
  let page = 1;
  do {
    const { data, headers } = await fetchPage(page);
    const currentTotal = Number(headers.get("x-wp-total"));
    const currentPages = Number(headers.get("x-wp-totalpages"));
    if (!headers.has("x-wp-total") || !headers.has("x-wp-totalpages") || !Array.isArray(data)
      || !Number.isInteger(currentTotal) || currentTotal < 1 || currentTotal > 50000
      || !Number.isInteger(currentPages) || currentPages !== Math.ceil(currentTotal / 100)
      || (total !== null && (total !== currentTotal || totalPages !== currentPages))
      || data.length !== (page < currentPages ? 100 : currentTotal - (page - 1) * 100)) {
      throw new Error("Source pagination is incomplete or changed during the crawl; no writes or cleanup allowed.");
    }
    total = currentTotal;
    totalPages = currentPages;
    for (const product of data) {
      const key = String(product.id ?? "");
      if (!/^[0-9]{1,80}$/.test(key) || rawKeys.has(key)) {
        throw new Error("Missing/duplicate source identity; no writes or cleanup allowed.");
      }
      rawKeys.add(key);
      const profile = normalizeProduct(product);
      // Keep raw IDs even if a record cannot be mapped to a city/parsed. Its
      // continued existence at the source must prevent accidental deletion.
      if (profile && (!selectedCity || profile.cityName === selectedCity)) profiles.set(key, profile);
    }
    onPage(page, totalPages, profiles.size);
    if (limit > 0 && profiles.size >= limit) break;
    page += 1;
  } while (page <= totalPages);
  const complete = !selectedCity && limit === 0 && page > totalPages && rawKeys.size === total;
  if (!selectedCity && limit === 0 && !complete) throw new Error("Source count mismatch; cleanup refused.");
  return {
    profiles: limit > 0 ? [...profiles.values()].slice(0, limit) : [...profiles.values()],
    sourceKeys: [...rawKeys],
    snapshotProof: { complete, sourceTotal: total, sourcePages: totalPages, pagesFetched: Math.min(page, totalPages), rawCount: rawKeys.size },
  };
}
