"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type NavRegion = { slug: string; name: string; cities: Array<{ slug: string; name: string }> };
type NavArticle = { slug: string; title: string };

export default function RegionNavClient({ regions, articles, hotArticlesLabel }: { regions: NavRegion[]; articles: NavArticle[]; hotArticlesLabel: string }) {
  const [openRegion, setOpenRegion] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 116, width: 180 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!openRegion) return;

    const openedAt = { x: window.scrollX, y: window.scrollY };
    const closeMenu = () => setOpenRegion(null);
    const closeAfterScroll = () => {
      const movedHorizontally = Math.abs(window.scrollX - openedAt.x) > 1;
      const movedVertically = Math.abs(window.scrollY - openedAt.y) > 1;
      if (movedHorizontally || movedVertically) closeMenu();
    };
    const closeOnKeyboard = (event: KeyboardEvent) => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const active = document.activeElement;
      const inMenu = menu.contains(active);
      if (active !== trigger && !inMenu) return;
      const moveFocus = (element: HTMLElement | undefined) => {
        if (element === trigger) element.focus({ preventScroll: true });
        else element?.focus();
      };
      const links = [...menu.querySelectorAll<HTMLAnchorElement>('a[href]')];
      if (event.key === "Escape") {
        event.preventDefault(); closeMenu(); moveFocus(trigger); return;
      }
      if (event.key === "Tab") {
        if (active === trigger) {
          if (!event.shiftKey && links.length) { event.preventDefault(); moveFocus(links[0]); }
          else closeMenu();
        } else if (event.shiftKey && active === links[0]) {
          event.preventDefault(); closeMenu(); moveFocus(trigger);
        } else if (!event.shiftKey && active === links.at(-1)) {
          // The popup is portaled: restore its logical place in the navigation order.
          const pageControls = [...document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')]
            .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && !menu.contains(element) && element.getClientRects().length > 0);
          const triggerIndex = pageControls.indexOf(trigger);
          const next = triggerIndex >= 0 ? pageControls[triggerIndex + 1] : undefined;
          closeMenu();
          if (next) { event.preventDefault(); moveFocus(next); }
        }
        return;
      }
      if (!links.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = links.indexOf(active as HTMLAnchorElement);
        const nextIndex = index < 0 ? (event.key === "ArrowDown" ? 0 : links.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        moveFocus(links[nextIndex]);
      } else if (inMenu && (event.key === "Home" || event.key === "End")) {
        event.preventDefault(); moveFocus(event.key === "Home" ? links[0] : links.at(-1));
      }
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      if (event.target !== triggerRef.current && !menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".region-dropdown-trigger") && !target.closest(".region-dropdown-menu")) closeMenu();
    };

    window.addEventListener("scroll", closeAfterScroll, { passive: true, capture: true });
    window.addEventListener("resize", closeMenu, { passive: true });
    document.addEventListener("keydown", closeOnKeyboard);
    document.addEventListener("focusin", closeOnFocusOutside);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("scroll", closeAfterScroll, true);
      window.removeEventListener("resize", closeMenu);
      document.removeEventListener("keydown", closeOnKeyboard);
      document.removeEventListener("focusin", closeOnFocusOutside);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [openRegion]);


  function toggleRegion(event: MouseEvent<HTMLButtonElement>, slug: string) {
    if (openRegion === slug) return setOpenRegion(null);
    triggerRef.current = event.currentTarget;
    const rectangle = event.currentTarget.getBoundingClientRect();
    const menuWidth = Math.min(slug === "articles" ? 320 : 180, window.innerWidth - 16);
    const centeredLeft = rectangle.left + rectangle.width / 2 - menuWidth / 2;
    setMenuPosition({
      left: Math.min(Math.max(8, centeredLeft), Math.max(8, window.innerWidth - menuWidth - 8)),
      top: rectangle.bottom + 1,
      width: menuWidth,
    });
    setOpenRegion(slug);
  }
  const menuStyle = {
    "--dropdown-left": `${menuPosition.left}px`,
    "--dropdown-top": `${menuPosition.top}px`,
    "--dropdown-width": `${menuPosition.width}px`,
  } as CSSProperties;

  return <nav className="region-nav" aria-label="地區專區選單">
    {regions.map((region) => <div className={`region-dropdown${openRegion === region.slug ? " is-open" : ""}`} key={region.slug}>
      <button className="region-dropdown-trigger" type="button" aria-controls={openRegion === region.slug ? menuId : undefined} aria-expanded={openRegion === region.slug} onClick={(event) => toggleRegion(event, region.slug)}>{region.name}<span aria-hidden="true">⌄</span></button>
      {openRegion === region.slug && typeof document !== "undefined" && createPortal(<div ref={menuRef} id={menuId} className="region-dropdown-menu" style={menuStyle}>
        {region.cities.map((city) => <Link prefetch={false} href={`/regions/${region.slug}/${city.slug}`} key={`${region.slug}-${city.slug}`} onClick={() => setOpenRegion(null)}>{city.name}</Link>)}
      </div>, document.body)}
    </div>)}
    <div className={`region-dropdown article-dropdown${openRegion === "articles" ? " is-open" : ""}`}>
      <button className="region-dropdown-trigger" type="button" aria-controls={openRegion === "articles" ? menuId : undefined} aria-expanded={openRegion === "articles"} onClick={(event) => toggleRegion(event, "articles")}>{hotArticlesLabel}<span aria-hidden="true">⌄</span></button>
      {openRegion === "articles" && typeof document !== "undefined" && createPortal(<div ref={menuRef} id={menuId} className="region-dropdown-menu article-dropdown-menu" style={menuStyle}>
        <Link prefetch={false} href="/articles" onClick={() => setOpenRegion(null)}><strong>瀏覽全部文章</strong></Link>
        {articles.map((article) => <Link prefetch={false} href={`/articles/${article.slug}`} key={article.slug} onClick={() => setOpenRegion(null)}>{article.title}</Link>)}
      </div>, document.body)}
    </div>
  </nav>;
}
