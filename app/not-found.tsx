import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-card">
        <p className="eyebrow">404</p>
        <h1>找不到這個頁面</h1>
        <p>網址可能有誤，或這個頁面已移動或下架。你可以返回首頁，或到文章區繼續瀏覽。</p>
        <div className="not-found-actions">
          <Link className="button primary" href="/" prefetch={false}>返回首頁</Link>
          <Link className="button secondary" href="/articles" prefetch={false}>瀏覽文章</Link>
        </div>
      </div>
    </main>
  );
}
