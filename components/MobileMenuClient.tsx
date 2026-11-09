"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type Region = { slug: string; name: string; cities: Array<{ slug: string; name: string }> };
type Article = { slug: string; title: string };

export default function MobileMenuClient({ regions, articles, labels }: { regions: Region[]; articles: Article[]; labels: { menu: string; regions: string; articles: string; search: string } }) {
  const [open, setOpen] = useState(false); const [tab, setTab] = useState<"regions" | "articles">("regions"); const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    // The portal is a body child. Preserve existing inert states (including other dialogs).
    const background = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog));
    const inertStates = background.map(element => [element, element.inert] as const);
    background.forEach(element => { element.inert = true; });
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    // Focusing the search input on open also opens the mobile keyboard.
    const focusClose = () => (closeRef.current ?? dialog).focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0]; const last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const containFocus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusClose(); };
    const closeOnDesktop = () => { if (window.innerWidth > 860) setOpen(false); };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("focusin", containFocus);
    window.addEventListener("resize", closeOnDesktop, { passive: true });
    focusClose();
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("focusin", containFocus);
      window.removeEventListener("resize", closeOnDesktop);
      inertStates.forEach(([element, inert]) => { element.inert = inert; });
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
    };
  }, [open]);
  const filteredRegions = useMemo(() => regions.map((region) => ({ ...region, cities: region.cities.filter((city) => `${region.name}${city.name}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((region) => !query.trim() || region.cities.length), [regions, query]);
  const filteredArticles = articles.filter((article) => article.title.toLowerCase().includes(query.trim().toLowerCase()));
  const drawer = open && typeof document !== "undefined" ? createPortal(<div className="mobile-drawer-layer"><button className="mobile-drawer-backdrop" type="button" tabIndex={-1} onClick={() => setOpen(false)} aria-label="關閉選單背景" /><aside ref={dialogRef} id={drawerId} className="mobile-drawer" tabIndex={-1} aria-label="手機導覽選單" role="dialog" aria-modal="true">
      <div className="drawer-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search} /><span aria-hidden="true">⌕</span><button ref={closeRef} className="drawer-close" type="button" onClick={() => setOpen(false)} aria-label="關閉選單">×</button></div>
      <div className="drawer-tabs"><button className={tab === "regions" ? "active" : ""} aria-pressed={tab === "regions"} type="button" onClick={() => setTab("regions")}>{labels.regions}</button><button className={tab === "articles" ? "active" : ""} aria-pressed={tab === "articles"} type="button" onClick={() => setTab("articles")}>{labels.articles}</button></div>
      <div className="drawer-list">{tab === "regions" ? filteredRegions.map((region) => <section className="drawer-region-group" key={region.slug}><h2>{region.name}</h2>{region.cities.map((city) => <Link prefetch={false} href={`/regions/${region.slug}/${city.slug}`} onClick={() => setOpen(false)} key={`${region.slug}-${city.slug}`}><span>⌖</span>{city.name}</Link>)}</section>) : <><Link prefetch={false} href="/articles" onClick={() => setOpen(false)}><span>✦</span><strong>瀏覽全部文章</strong></Link>{filteredArticles.map((article) => <Link prefetch={false} href={`/articles/${article.slug}`} onClick={() => setOpen(false)} key={article.slug}><span>✦</span>{article.title}</Link>)}</>}
      {((tab === "regions" && filteredRegions.length === 0) || (tab === "articles" && filteredArticles.length === 0)) && <p>找不到符合的內容</p>}</div>
    </aside></div>, document.body) : null;
  return <><button ref={triggerRef} className="mobile-menu-button" type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-controls={drawerId} aria-label={`開啟${labels.menu}`}><span>☰</span><strong>{labels.menu}</strong></button>{drawer}</>;
}
