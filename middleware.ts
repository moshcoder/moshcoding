import { NextRequest, NextResponse } from "next/server";

// Parked domains allowed to frame the app (Porkbun masked/frameset forwarding,
// e.g. moshcode.sh). Read at RUNTIME so FRAME_ANCESTORS env changes take effect
// on redeploy without a code edit. 'self' lets the app frame itself; no other
// origin can (anti-clickjacking).
function frameAncestors(req: NextRequest): string {
  const parked = (process.env.FRAME_ANCESTORS || "https://moshcode.sh").split(/\s+/).filter(Boolean);
  const allow = ["'self'", ...parked];

  // Auto-allow the parked domain currently being rendered. A masked-forwarded
  // domain frames moshcoding.com/?dn=<self> (tenant page) or ?bid=<self> (its bid
  // page), so the frame request carries its own domain; trust it to iframe just
  // its own pages. New parked domains work without hand-editing FRAME_ANCESTORS.
  const isDomain = (d: string) =>
    d.length <= 253 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d);
  for (const key of ["dn", "bid"]) {
    const d = (req.nextUrl.searchParams.get(key) || "").trim().toLowerCase();
    if (isDomain(d)) allow.push(`https://${d}`, `https://www.${d}`);
  }
  return allow.join(" ");
}

// Redirect www.moshcoding.com → https://moshcoding.com (apex, permanent).
export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  if (host.startsWith("www.")) {
    const apex = host.slice(4);
    const url = new URL(req.url);
    url.protocol = "https:";
    url.host = apex;
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors(req)}`);

  // Referral attribution: a ?ref=<code> visit drops a 90-day cookie (first-touch
  // — the first ref a visitor arrives with sticks). Signup/waitlist read it so
  // the referral is credited whenever they convert within the window.
  // Normally ?ref=<code> is its own param. But Porkbun param-forwarding can glue
  // it onto the ?dn= value ("dn=moshscript.com?ref=abc"), so recover it there too.
  const sp = req.nextUrl.searchParams;
  const rawRef = sp.get("ref") ?? sp.get("dn")?.match(/[?&]ref=([A-Za-z0-9_-]+)/)?.[1] ?? null;
  if (rawRef && !req.cookies.get("mc_ref")?.value) {
    const ref = rawRef.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    if (ref) {
      res.cookies.set("mc_ref", ref, {
        maxAge: 60 * 60 * 24 * 90,
        path: "/",
        sameSite: "lax",
        secure: (process.env.APP_BASE_URL || "").startsWith("https://"),
      });
    }
  }
  return res;
}

export const config = {
  // run on everything except Next internals & static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
