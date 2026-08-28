import type { Metadata } from "next";
import Nav from "@/components/Nav";
import PitSearch from "@/components/PitSearch";
import { listTlds } from "@/lib/moshpit";
import { payConfigured, claimPriceUsd, formatUsd } from "@/lib/coinpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moshpit — buy .anything, sell anything.yourthing",
  description:
    "Register your own top-level domain on the Moshpit network. No registrar, no approval, no waiting list.",
};

/**
 * pit.moshcode.sh — the clearnet entry point (PRD 0001 R11).
 *
 * Deliberately readable without the extension or a node: this is the page a
 * normal browser lands on, so it has to explain the network and let you claim
 * a name over ordinary HTTPS. A bootstrap that needed the thing it bootstraps
 * would be no bootstrap at all.
 */
/** The claim price for the copy, or null when this deployment charges nothing. */
function claimPrice(): string | null {
  if (!payConfigured()) return null;
  try {
    return formatUsd(claimPriceUsd());
  } catch {
    return null;
  }
}

export default async function PitPage() {
  const tlds = await listTlds(24);
  const price = claimPrice();
  const priceLabel = price ? `$${price.replace(/\.00$/, "")}` : null;

  return (
    <div id="site">
      <Nav />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="dot" /> the moshpit network
          </p>
          <h1 className="title">
            BUY <span className="acid">.ANYTHING</span>
            <br />
            SELL ANYTHING<span className="acid">.YOURTHING</span>
          </h1>
          <p className="pit-lede">
            The internet ran out of good names because a handful of registries decide which
            endings exist. Here you take the ending itself. Claim <code>.eggs</code> and{" "}
            <code>scrambled.eggs</code>, <code>poached.eggs</code> and everything else under it
            is yours to keep or sell.
          </p>
          <PitSearch />
        </div>
      </section>

      <section className="pit-how">
        <p className="tag">// how it works</p>
        <ol className="pit-steps">
          <li>
            <strong>Claim an ending.</strong>{" "}
            {priceLabel ? (
              <>
                {priceLabel} once, in USDC on Polygon. First come, first served — nobody approves
                it and nobody can take it back.
              </>
            ) : (
              <>First come, first served. Nobody approves it and nobody can take it back.</>
            )}
          </li>
          <li>
            <strong>Sell what&apos;s under it.</strong> You set the prices for{" "}
            <code>anything.yourthing</code>, and you keep the revenue.
          </li>
          <li>
            <strong>Point it anywhere.</strong> A site, an app, a redirect — your namespace,
            your rules.
          </li>
        </ol>
      </section>

      <section className="pit-how">
        <p className="tag">// reaching a .moshpit address</p>
        <p className="pit-lede">
          These names live outside the traditional DNS root, so a normal browser doesn&apos;t
          know where to look. This page is the way in until the resolver ships: names are
          registered and looked up here over ordinary HTTPS, and{" "}
          <code>pit.moshcode.sh</code> stays a working entry point for anyone without it.
        </p>
        <p className="pit-lede pit-dim">
          The browser extension that resolves <code>.anything</code> natively is not out yet.
          Nothing on this page needs it.
        </p>
      </section>

      <section className="pit-how">
        <p className="tag">// already claimed</p>
        {tlds.length === 0 ? (
          <p className="pit-lede pit-dim">Nothing yet. The good ones are all still free.</p>
        ) : (
          <ul className="pit-list">
            {tlds.map((t) => (
              <li key={t.tld}>
                <span className="acid">.{t.tld}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="pit-lede pit-dim">
          Names that trade on someone else&apos;s trust — banks, brands, governments — are
          reserved and cannot be claimed.
        </p>
      </section>
    </div>
  );
}
