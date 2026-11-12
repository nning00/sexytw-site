import { createElement } from "react";

const reviewedDigest = "4b071b0bd028190b7a6140ca71d742cdb33db2253f6349a0548d61ba54ff1a22";
const references = [
  { label: "Google：保護遭到入侵或有可疑活動的帳戶", href: "https://support.google.com/accounts/answer/6294825?hl=zh-Hant" },
  { label: "Google：從搜尋結果移除個人聯絡資訊", href: "https://support.google.com/websearch/answer/12719076?hl=zh-Hant" },
  { label: "中華郵政：防詐騙與165查證提醒", href: "https://www.post.gov.tw/post/internet/Anti-Fraud/anti_form.jsp" },
] as const;

type ArticleInput = { slug: string; title: string; content?: unknown };

export async function matchesReviewedArticle(article: ArticleInput): Promise<boolean> {
  if (article.slug !== "safety-and-privacy-guide" || !Array.isArray(article.content) || article.content.length !== 13) return false;
  const blocks: { type: string; text: string }[] = [];
  for (const block of article.content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    if (Object.keys(block).some(key => key !== "type" && key !== "text")) return false;
    if (typeof block.type !== "string" || typeof block.text !== "string") return false;
    blocks.push({ type: block.type, text: block.text });
  }
  // Stable object-key order, but retain exact block order, whitespace and Unicode.
  // Bind to the body being rendered, not an independently cached version lookup.
  const serialized = JSON.stringify({ slug: article.slug, title: article.title, content: blocks });
  try {
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
    const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    return digest === reviewedDigest;
  } catch {
    return false;
  }
}

export default async function ArticleReferences({ article }: { article: ArticleInput }) {
  if (!await matchesReviewedArticle(article)) return null;
  return createElement("section", { className: "article-references", "aria-labelledby": "article-references-title" },
    createElement("h2", { id: "article-references-title" }, "參考資料"),
    createElement("ul", null, references.map(({ label, href }) =>
      createElement("li", { key: href }, createElement("a", { href, rel: "noreferrer" }, label)))));
}
