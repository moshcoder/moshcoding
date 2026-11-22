import { hostFromHeaders, robotsTxt } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(robotsTxt(hostFromHeaders(req.headers)), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
