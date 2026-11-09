"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function cityPath() {
  // Fragments preserve the canonical profile URL and never create a redirect.
  const match = /^#from-city=([a-z0-9-]{1,64})\/([a-z0-9-]{1,64})$/.exec(window.location.hash);
  return match ? "/regions/" + match[1] + "/" + match[2] : null;
}

export default function ProfileBackLink({ className }: { className?: string }) {
  const city = useSyncExternalStore(subscribe, cityPath, () => null);
  return <Link className={className} href={city ?? "/#gallery"} prefetch={false}>
    {city ? "返回城市列表" : "返回首頁相簿"}
  </Link>;
}
