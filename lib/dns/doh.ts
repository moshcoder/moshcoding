// DNS over HTTPS, and a health endpoint, on the same policy as port 53.
//
// Port 53 is the resolver people set on a laptop or a router. DoH is for
// everywhere that is not possible: a phone, a locked-down work machine, a
// browser configured with a custom "secure DNS" provider — exactly the
// audience PRD 0004 cares about, the people who cannot install an extension.
//
// Served over plain HTTP here on purpose: this process sits behind the same
// terminator as the rest of `pit.moshcode.sh`, which already holds the
// certificate. Two places to renew certs is one place too many.

import http from "node:http";

import type { DnsServer } from "./server";

const DNS_MESSAGE = "application/dns-message";
const MAX_BODY = 8_192;

export function createDohServer(options: {
  dns: DnsServer;
  path?: string;
  log?: (line: string) => void;
}): http.Server {
  const path = options.path ?? "/dns-query";
  const log = options.log ?? (() => {});

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, ...options.dns.stats() }));
      return;
    }

    if (url.pathname !== path) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }

    try {
      let query: Buffer | null = null;

      if (req.method === "GET") {
        // RFC 8484: the query is base64url in `?dns=`, unpadded.
        const dns = url.searchParams.get("dns");
        if (dns) query = Buffer.from(dns, "base64url");
      } else if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          // A DNS message cannot legitimately exceed 64KB, and this endpoint
          // has no reason to buffer even that much from an unauthenticated
          // caller.
          if (size > MAX_BODY) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk as Buffer);
        }
        query = Buffer.concat(chunks);
      } else {
        res.writeHead(405, { allow: "GET, POST" }).end();
        return;
      }

      if (!query?.length) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("expected a DNS message\n");
        return;
      }

      const remote = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress;
      const answer = await options.dns.handle(query, { transport: "doh", remote });
      if (!answer) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("malformed DNS message\n");
        return;
      }

      res.writeHead(200, {
        "content-type": DNS_MESSAGE,
        "content-length": String(answer.length),
        // The answer carries its own TTLs; letting an HTTP cache add its own
        // opinion on top is how stale addresses outlive the name that moved.
        "cache-control": "no-store",
      });
      res.end(answer);
    } catch (err) {
      log(`doh error: ${(err as Error)?.message ?? err}`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("resolver error\n");
    }
  });
}
