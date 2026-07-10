"use client";

import { useEffect } from "react";

/**
 * CrawlProof ad unit. Renders the real <div data-cp-ad …> as JSX (so React
 * keeps the data-* attributes and there's no dangerouslySetInnerHTML / inline
 * <script>, both of which silently no-op in React), then loads ad.js once —
 * the loader scans the DOM for [data-cp-ad] and fills them in. The div is in
 * the SSR HTML, so it exists before the async loader runs.
 */
export default function CrawlProofAd({ slot, format }: { slot: string; format: string }) {
  useEffect(() => {
    if (document.querySelector("script[data-cp-loader]")) return;
    const s = document.createElement("script");
    s.src = "https://crawlproof.com/ad.js";
    s.async = true;
    s.setAttribute("data-cp-loader", "1");
    document.body.appendChild(s);
  }, []);

  return (
    <div className="t-ad" aria-label="Advertisement">
      <div data-cp-ad data-slot={slot} data-format={format} />
    </div>
  );
}
