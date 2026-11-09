import type { Metadata } from "next";
import Link from "next/link";
import ArticleCards from "@/components/ArticleCards";
import ArticleCenterNav from "@/components/ArticleCenterNav";
import JsonLd from "@/components/JsonLd";
import SiteHeader from "@/components/SiteHeader";
import { getArticleCategories, getHomeArticleCards, getPublishedArticles } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { breadcrumbStructuredData } from "@/lib/structured-data";

const articlesTitle = "全部文章｜實用指南與熱門內容";
const articlesDescription = "瀏覽新手指南、預約指南、安全指南、舒壓知識及其他實用文章。";
export const metadata: Metadata = { title: articlesTitle, description: articlesDescription, alternates: { canonical: "/articles" }, openGraph: completeOpenGraph({ url: "/articles", title: articlesTitle, description: articlesDescription }) };
export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const featured = (await searchParams).view === "featured";
  const [displayed, categories] = await Promise.all([
    featured ? getHomeArticleCards().catch(() => []) : getPublishedArticles(),
    getArticleCategories(),
  ]);
  const title = featured ? "熱門文章" : "全部文章";
  const breadcrumbData = { "@context": "https://schema.org", ...breadcrumbStructuredData([{ name: "首頁", path: "/" }, { name: title, path: "/articles" }]) };
  return <><SiteHeader /><main className="article-center">
    <JsonLd data={breadcrumbData} />
    <header>
      <div className="article-breadcrumbs"><Link href="/">首頁</Link><span>/</span><strong>{title}</strong></div>
      <h1>{title}</h1>
      <p>{featured ? "與首頁同步顯示推薦閱讀，並非依點閱數排行。" : "依照主題瀏覽網站最新文章、實用說明與注意事項。"}</p>
    </header>
    <ArticleCenterNav categories={categories} active={featured ? "featured" : "all"} />
    {displayed.length ? <ArticleCards articles={displayed} /> : <p className="article-empty">
      {featured ? <>目前沒有可顯示的推薦文章。<Link href="/articles">瀏覽全部文章</Link></> : "目前尚無文章。"}
    </p>}
  </main></>;
}
