import { hostFromHeaders, sitemapXml } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return new Response(sitemapXml(hostFromHeaders(req.headers)), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
