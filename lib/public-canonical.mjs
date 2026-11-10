const publicOrigin = "https://sexytw.cc";
const canonicalPaths = new Set(["/", "/regions/north/taipei"]);

/** @param {string} links @param {string} canonical */
function withCanonicalLink(links, canonical) {
  if (!links || links === canonical) return canonical;

  // Commas inside a target URL or quoted parameter do not separate links.
  const values = links.match(/(?:<[^>]*>|"(?:\\.|[^"\\])*"|[^<",])+|[<"]/g) ?? [];
  let replaced = false;
  const retained = values.flatMap((value) => {
    const link = value.trim();
    const targetEnd = link.indexOf(">");
    if (!link.startsWith("<") || targetEnd < 0) return [link];

    let removed = false;
    let hasOtherRelation = false;
    const params = link.slice(targetEnd + 1).replace(
      /(;\s*([\w!#$%&'*+.^`|~-]+)\s*=\s*)("(?:\\.|[^"\\])*"|[\w!#$%&'*+.^`|~-]+)/g,
      (parameter, prefix, name, raw) => {
        if (name.toLowerCase() !== "rel") return parameter;
        const relations = (raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw).split(/[ \t]+/).filter(Boolean);
        const others = relations.filter((relation) => relation.toLowerCase() !== "canonical");
        if (others.length) hasOtherRelation = true;
        if (relations.length === others.length) return parameter;
        removed = true;
        if (!others.length) return "";
        const escaped = others.join(" ").replace(/["\\]/g, "\\$&");
        return `${prefix}"${escaped}"`;
      },
    );
    if (!removed) return [link];
    replaced = true;
    return hasOtherRelation ? [link.slice(0, targetEnd + 1) + params] : [];
  });

  return replaced ? [...retained.filter(Boolean), canonical].join(", ") : `${links}, ${canonical}`;
}

/** @param {Request} request @param {URL} url @param {Response} response */
export function applyPublicCanonical(request, url, response) {
  if (url.origin !== publicOrigin || !canonicalPaths.has(url.pathname)) return;
  if ((request.method !== "GET" && request.method !== "HEAD") ||
      request.headers.has("RSC") || request.headers.has("Authorization")) return;
  if (response.status !== 200 || response.headers.has("Location") ||
      !/^text\/html(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? "")) return;

  const canonical = `<${publicOrigin}${url.pathname}>; rel="canonical"`;
  response.headers.set("Link", withCanonicalLink(response.headers.get("Link") ?? "", canonical));
}
