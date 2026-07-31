// Forwarding to the ordinary internet.
//
// The whole point of this resolver is that pointing your laptop at it does not
// cost you the rest of the web: `.moshpit` and friends come from the registry,
// and everything else — `.com`, `.org`, all of it — is answered by upstream
// resolvers, by default Google's 8.8.8.8 and Cloudflare's 1.1.1.1.
//
// Two upstreams, staggered rather than raced: the second is only asked once the
// first has had a fair chance to answer. Racing both on every query would
// double the traffic we send (and the number of parties who see it) to shave a
// few milliseconds off the median. Staggering keeps the failover but not the
// duplication.
//
// Forwarded bytes are relayed verbatim. The response we hand back is the one
// upstream produced, so DNSSEC records, EDNS options and rcodes we have never
// heard of all survive the trip — this process is a courier, not an editor.

import dgram from "node:dgram";
import net from "node:net";

export type Upstream = { host: string; port: number };

export const DEFAULT_UPSTREAMS: Upstream[] = [
  { host: "8.8.8.8", port: 53 },
  { host: "1.1.1.1", port: 53 },
];

/** Parse `8.8.8.8, 1.1.1.1:53, [2001:4860:4860::8888]:53` into upstreams. */
export function parseUpstreams(spec: string | undefined | null): Upstream[] {
  const items = String(spec ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const upstreams: Upstream[] = [];
  for (const item of items) {
    const bracketed = item.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (bracketed) {
      upstreams.push({ host: bracketed[1], port: Number(bracketed[2] ?? 53) });
      continue;
    }
    // A bare IPv6 literal has colons of its own, so only split on the last one
    // when what follows is a port and what precedes it is not itself IPv6.
    const withPort = item.match(/^([^:]+):(\d+)$/);
    if (withPort) {
      upstreams.push({ host: withPort[1], port: Number(withPort[2]) });
      continue;
    }
    upstreams.push({ host: item, port: 53 });
  }
  return upstreams.length ? upstreams : DEFAULT_UPSTREAMS;
}

export type Forwarder = {
  query(payload: Buffer, options?: { tcp?: boolean }): Promise<Buffer>;
  close(): void;
};

function isResponseTo(payload: Buffer, response: Buffer): boolean {
  if (response.length < 12) return false;
  // Matching the id is the minimum. The random source port that node picks for
  // each outbound socket is the other half — together they are what an off-path
  // spoofer has to guess before the real answer arrives.
  if (response.readUInt16BE(0) !== payload.readUInt16BE(0)) return false;
  return (response[2] & 0x80) !== 0; // QR: this is an answer, not a query
}

function askUdp(upstream: Upstream, payload: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIPv6(upstream.host) ? "udp6" : "udp4");
    let done = false;
    const finish = (err: Error | null, response?: Buffer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closing; the result below is what matters.
      }
      if (err) reject(err);
      else resolve(response!);
    };
    const timer = setTimeout(() => finish(new Error(`${upstream.host} timed out`)), timeoutMs);

    socket.on("message", (msg) => {
      if (isResponseTo(payload, msg)) finish(null, msg);
    });
    socket.on("error", (err) => finish(err));
    socket.send(payload, upstream.port, upstream.host, (err) => {
      if (err) finish(err);
    });
  });
}

function askTcp(upstream: Upstream, payload: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: upstream.host, port: upstream.port });
    let done = false;
    let buffered = Buffer.alloc(0);
    const finish = (err: Error | null, response?: Buffer) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(response!);
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`${upstream.host} timed out`)));
    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(new Error(`${upstream.host} closed the connection`)));
    socket.on("connect", () => {
      const framed = Buffer.alloc(2 + payload.length);
      framed.writeUInt16BE(payload.length, 0);
      payload.copy(framed, 2);
      socket.write(framed);
    });
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 2) return;
      const length = buffered.readUInt16BE(0);
      if (buffered.length < 2 + length) return;
      finish(null, buffered.subarray(2, 2 + length));
    });
  });
}

export function createForwarder(options: {
  upstreams?: Upstream[];
  /** Per-upstream deadline. */
  timeoutMs?: number;
  /** How long the first upstream gets before the second is also asked. */
  staggerMs?: number;
  ask?: (upstream: Upstream, payload: Buffer, timeoutMs: number, tcp: boolean) => Promise<Buffer>;
} = {}): Forwarder {
  const upstreams = options.upstreams?.length ? options.upstreams : DEFAULT_UPSTREAMS;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const staggerMs = options.staggerMs ?? 400;
  const ask = options.ask ?? ((u, p, t, tcp) => (tcp ? askTcp(u, p, t) : askUdp(u, p, t)));

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;

  function query(payload: Buffer, opts: { tcp?: boolean } = {}): Promise<Buffer> {
    if (closed) return Promise.reject(new Error("forwarder is closed"));
    const tcp = Boolean(opts.tcp);

    const attempts = upstreams.map((upstream, index) => {
      if (index === 0) return ask(upstream, payload, timeoutMs, tcp);
      return new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          ask(upstream, payload, timeoutMs, tcp).then(resolve, reject);
        }, index * staggerMs);
        timers.add(timer);
        // A deferred attempt must not hold the process open on its own — if
        // the first upstream already answered, nobody is waiting for this.
        timer.unref?.();
      });
    });

    // `any` rather than `race`: the first *success* wins, so one upstream
    // refusing or dying does not fail a query the other could have answered.
    return Promise.any(attempts).catch((err: AggregateError) => {
      const reasons = (err?.errors ?? []).map((e: Error) => e?.message).filter(Boolean);
      throw new Error(`all upstreams failed${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
    });
  }

  return {
    query,
    close() {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
