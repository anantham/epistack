"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function NavigationProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [label, setLabel] = useState("Loading the next stage…");

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      setLabel(anchor.dataset.loadingLabel || "Loading the next page…");
      setPending(true);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(false), 450);
    return () => window.clearTimeout(timer);
  }, [pathname, pending]);

  if (!pending) return null;

  return (
    <div className="navigation-progress" role="status" aria-live="polite" aria-label={label}>
      <span className="navigation-progress-rail" aria-hidden="true"><i /></span>
      <span>{label}</span>
    </div>
  );
}
