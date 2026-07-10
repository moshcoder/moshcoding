import BidForm from "./BidForm";
import { getAuction, highBid } from "@/lib/db";

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default async function BidPage({ dn }: { dn: string }) {
  const [auction, hb] = await Promise.all([
    getAuction(dn).catch(() => null),
    highBid(dn).catch(() => null),
  ]);
  const closed = auction?.status === "closed";
  const buyNowCents = auction?.buy_now_cents ?? null;
  const reserveSet = auction?.reserve_cents != null;
  const reserveMet = reserveSet && hb ? hb.amount_cents >= (auction!.reserve_cents as number) : false;

  return (
    <div className="tenant">
      <div className="tenant-wrap">
        <a className="powered" href="https://moshcoding.com" target="_blank" rel="noopener noreferrer">
          ⚡ powered by <b>#moshcoding</b>
        </a>
        <p className="t-domain">{dn}</p>
        <h1 className="t-headline">Bid on <em>{dn}</em></h1>

        {closed ? (
          <>
            <p className="t-tag">This auction is closed.</p>
            <p className="t-sub">The owner has accepted a bid for this domain. Want one like it? Point your domain at moshcoding.</p>
          </>
        ) : (
          <>
            <p className="t-tag">Make an offer to buy this domain. Bids stay open until the owner accepts one.</p>

            <dl className="bid-stats">
              <div>
                <dt>Current high bid</dt>
                <dd>{hb ? money(hb.amount_cents) : "No bids yet"}</dd>
              </div>
              {buyNowCents != null && (
                <div>
                  <dt>Buy it now</dt>
                  <dd>{money(buyNowCents)}</dd>
                </div>
              )}
              {reserveSet && (
                <div>
                  <dt>Reserve</dt>
                  <dd>{reserveMet ? "met ✓" : "not yet met"}</dd>
                </div>
              )}
            </dl>

            <BidForm dn={dn} buyNowCents={buyNowCents} highBidCents={hb?.amount_cents ?? null} />
          </>
        )}

        <footer className="t-foot">
          <a href={`/?dn=${encodeURIComponent(dn)}`}>← back to {dn}</a> · &copy; 2026{" "}
          <a href="https://moshcoding.com" target="_blank" rel="noopener noreferrer">powered by moshcoding.com</a>
        </footer>
      </div>
    </div>
  );
}
