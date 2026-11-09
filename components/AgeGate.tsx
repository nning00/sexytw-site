"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const storageKey = "site-age-confirmed";

export default function AgeGate() {
  const [visible, setVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setVisible(window.localStorage.getItem(storageKey) !== "yes"); }
      catch { setVisible(true); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    // Keep the portal interactive while excluding every background body child.
    const background = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog));
    const inertStates = background.map(element => [element, element.inert] as const);
    background.forEach(element => { element.inert = true; });
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const containKeyboard = (event: KeyboardEvent) => {
      // Escape must never bypass the age decision or record adult confirmation.
      if (event.key === "Escape") { event.preventDefault(); return; }
      if (event.key !== "Tab") return;
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !buttons.some(button => button === document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) titleRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", containKeyboard);
    document.addEventListener("focusin", containFocus);
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", containKeyboard);
      document.removeEventListener("focusin", containFocus);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      inertStates.forEach(([element, inert]) => { element.inert = inert; });
      if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus({ preventScroll: true });
    };
  }, [visible]);

  function confirmAge() {
    try { window.localStorage.setItem(storageKey, "yes"); }
    catch { /* Storage can be disabled; the explicit decision still applies to this page. */ }
    setVisible(false);
  }

  function leaveSite() {
    window.location.href = "https://www.google.com/";
  }

  if (!visible) return null;

  return createPortal(
    <div ref={dialogRef} className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title" tabIndex={-1}>
      <div className="age-card">
        <div className="age-mark">18+</div>
        <p className="eyebrow">ADULTS ONLY</p>
        <h2 ref={titleRef} id="age-title" tabIndex={-1}>年齡確認</h2>
        <p>本網站包含成人形象內容，僅供年滿 18 歲的成年人瀏覽。進入即表示你已達法定成年年齡。</p>
        <div className="age-actions">
          <button className="button primary" type="button" onClick={confirmAge}>我已年滿 18 歲</button>
          <button className="age-exit" type="button" onClick={leaveSite}>未滿 18 歲，離開網站</button>
        </div>
        <small>我們重視合法、尊重、隱私與雙方同意。</small>
      </div>
    </div>, document.body
  );
}
