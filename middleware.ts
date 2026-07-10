import { NextRequest, NextResponse } from "next/server";

// Parked domains allowed to frame the app (Porkbun masked/frameset forwarding,
// e.g. moshcode.sh). Read at RUNTIME so FRAME_ANCESTORS env changes take effect
// on redeploy without a code edit. 'self' lets the app frame itself; no other
// origin can (anti-clickjacking).
function frameAncestors(): string {
  const parked = (process.env.FRAME_ANCESTORS || "https://moshcode.sh").split(/\s+/).filter(Boolean);
  return ["'self'", ...parked].join(" ");
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
  res.headers.set("Content-Security-Policy", `frame-ancestors ${frameAncestors()}`);
  return res;
}

export const config = {
  // run on everything except Next internals & static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
