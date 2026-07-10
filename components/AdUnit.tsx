// CrawlProof ad slot. The loader (crawlproof.com/ad.js) is included once,
// globally, via next/script in app/layout.tsx — this component only renders the
// target <div>, which ad.js finds by the data-cp-ad attribute and fills.
export default function AdUnit({
  slot,
  format = "banner_300x250",
  className,
}: {
  slot: string;
  format?: string;
  className?: string;
}) {
  return (
    <div className={`ad-unit${className ? ` ${className}` : ""}`}>
      <div data-cp-ad data-slot={slot} data-format={format} />
    </div>
  );
}
