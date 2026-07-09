import { NextRequest, NextResponse } from "next/server";

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
  return NextResponse.next();
}

export const config = {
  // run on everything except Next internals & static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
