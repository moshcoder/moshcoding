// The resolver itself: UDP and TCP on port 53, Moshpit names from the
// registry, everything else from the upstreams.
//
// `handle()` is deliberately transport-free — bytes in, bytes out — so the same
// policy serves plain DNS, DNS over TCP, and DNS over HTTPS without three
// copies of the decision-making that could drift apart.

import dgram from "node:dgram";
import net from "node:net";

import { moshpitAnswer, type GatewayAddresses } from "./answers";
import type { GatewayResolver } from "./gateway";
import { clearnetAnswered, planQuery, type ResolveMode } from "./policy";
import type { RateLimiter } from "./ratelimit";
import type { RegistryClient } from "./registry";
import type { Forwarder } from "./upstream";
import {
  CLASS,
  RCODE,
  TYPE,
  decodeMessage,
  encodeMessage,
  setMessageId,
  udpPayloadSize,
  type Message,
} from "./wire";

export type ServerStats = {
  queries: number;
  moshpit: number;
  forwarded: number;
  refused: number;
  failed: number;
  dropped: number;
  malformed: number;
};

export type QueryContext = {
  transport: "udp" | "tcp" | "doh";
  /** Client address, for logging and rate limiting. */
  remote?: string;
  /** Whether the response has to fit in a datagram. */
  udp?: boolean;
};

export type DnsServerOptions = {
  registry: RegistryClient;
  forwarder: Forwarder;
  gateway: GatewayResolver;
  mode?: ResolveMode;
  /** TTL on synthesized Moshpit answers. Short: names change hands. */
  ttl?: number;
  address?: string;
  port?: number;
  rateLimiter?: RateLimiter;
  log?: (line: string) => void;
  randomId?: () => number;
};

export type DnsServer = {
  handle(query: Buffer, ctx?: QueryContext): Promise<Buffer | null>;
  listen(): Promise<{ udp: number; tcp: number }>;
  close(): Promise<void>;
  stats(): ServerStats;
};

const MAX_TCP_MESSAGE = 65_535;
const TCP_IDLE_MS = 15_000;

export function createDnsServer(options: DnsServerOptions): DnsServer {
  const { registry, forwarder, gateway } = options;
  const mode: ResolveMode = options.mode ?? "clearnet";
  const ttl = options.ttl ?? 60;
  // Not const: binding to port 0 (tests, and anyone running unprivileged) means
  // the kernel picks the UDP port, and TCP then has to follow it.
  let port = options.port ?? 53;
  const address = options.address ?? "0.0.0.0";
  const log = options.log ?? (() => {});
  const randomId = options.randomId ?? (() => Math.floor(Math.random() * 0x10000));

  const stats: ServerStats = {
    queries: 0,
    moshpit: 0,
    forwarded: 0,
    refused: 0,
    failed: 0,
    dropped: 0,
    malformed: 0,
  };

  let udpSocket: dgram.Socket | null = null;
  let tcpServer: net.Server | null = null;
  const connections = new Set<net.Socket>();

  /** An answer-less response that still echoes the question, as clients expect. */
  function errorResponse(query: Message, rcode: number): Buffer {
    return encodeMessage({
      id: query.id,
      flags: {
        qr: true,
        opcode: query.flags.opcode,
        aa: false,
        tc: false,
        rd: query.flags.rd,
        ra: true,
        z: false,
        ad: false,
        cd: query.flags.cd,
        rcode,
      },
      questions: query.questions,
      additionals: echoOpt(query),
    });
  }

  /**
   * Echo the client's EDNS0 OPT record on a synthesized answer.
   *
   * A client that announced EDNS support and gets a reply without an OPT
   * record concludes the server does not speak it, and some downgrade to
   * 512-byte UDP for everything afterwards. Cheap to keep, annoying to debug.
   */
  function echoOpt(query: Message) {
    const opt = query.additionals?.find((r) => r.type === TYPE.OPT);
    if (!opt) return [];
    return [
      {
        name: "",
        type: TYPE.OPT,
        class: Math.min(Math.max(opt.class || 512, 512), 1232),
        ttl: 0,
        rdata: Buffer.alloc(0),
      },
    ];
  }

  /** Shrink an over-sized datagram to a TC=1 hint that means "ask me over TCP". */
  function fitDatagram(message: Message, encoded: Buffer, limit: number): Buffer {
    if (encoded.length <= limit) return encoded;
    return encodeMessage({ ...message, flags: { ...message.flags, tc: true }, answers: [], authorities: [] });
  }

  async function forwardQuery(payload: Buffer, ctx: QueryContext): Promise<Buffer> {
    // A fresh random id upstream, restored on the way back: the client's id is
    // predictable to whoever sent it, and reusing it would let them predict
    // ours too.
    const clientId = payload.readUInt16BE(0);
    const masked = setMessageId(payload, randomId());
    const response = await forwarder.query(masked, { tcp: ctx.transport === "tcp" });
    return setMessageId(response, clientId);
  }

  async function moshpitResponse(query: Message, name: string): Promise<{ buffer: Buffer; message: Message } | null> {
    const lookup = await registry.lookup(name);
    if (!lookup?.registered) return null;

    let addresses: GatewayAddresses;
    try {
      addresses = await gateway.addresses();
    } catch {
      addresses = gateway.current();
    }
    // A registered name with nowhere to point is worse than no answer: it
    // would be cached as "this name has no address". Fall through instead.
    if (!addresses.ipv4.length && !addresses.ipv6.length) return null;

    const message = moshpitAnswer({
      id: query.id,
      question: query.questions[0],
      rd: query.flags.rd,
      lookup,
      gateway: addresses,
      ttl,
    });
    if (!message) return null;
    message.additionals = echoOpt(query);
    return { buffer: encodeMessage(message), message };
  }

  async function handle(rawQuery: Buffer, ctx: QueryContext = { transport: "udp" }): Promise<Buffer | null> {
    stats.queries++;
    const started = Date.now();

    let query: Message;
    try {
      query = decodeMessage(rawQuery);
    } catch {
      stats.malformed++;
      // Not enough of a message to reply to. Answering unparseable bytes with a
      // FORMERR still requires an id, and without one there is nobody to answer.
      if (rawQuery.length < 12) return null;
      return encodeMessage({
        id: rawQuery.readUInt16BE(0),
        flags: { qr: true, opcode: 0, aa: false, tc: false, rd: false, ra: true, z: false, ad: false, cd: false, rcode: RCODE.FORMERR },
      });
    }

    if (query.flags.qr) {
      // A response arriving on a listening socket is either a mistake or an
      // attempt to use us as a reflector. Neither deserves a reply.
      stats.dropped++;
      return null;
    }

    const question = query.questions[0];
    const plan = planQuery({
      question: question ?? { name: "", type: 0, class: CLASS.IN },
      rd: query.flags.rd,
      opcode: query.flags.opcode,
      questionCount: query.questions.length,
      mode,
    });

    const finish = (outcome: string, buffer: Buffer | null) => {
      log(
        `${ctx.transport} ${ctx.remote ?? "-"} ${question?.name ?? "?"} ${question?.type ?? "?"} ` +
          `${outcome} ${Date.now() - started}ms`,
      );
      if (!buffer) return null;
      const limit = ctx.transport === "udp" ? udpPayloadSize(query) : MAX_TCP_MESSAGE;
      if (ctx.transport !== "udp" || buffer.length <= limit) return buffer;
      // Only our own answers can be re-encoded; a forwarded one is relayed as
      // it came, and upstream already respected the client's advertised size.
      try {
        return fitDatagram(decodeMessage(buffer), buffer, limit);
      } catch {
        return buffer;
      }
    };

    try {
      if (plan.action === "refuse") {
        stats.refused++;
        return finish(`refused(${plan.reason})`, errorResponse(query, plan.rcode));
      }

      if (plan.action === "forward") {
        stats.forwarded++;
        return finish("forwarded", await forwardQuery(rawQuery, ctx));
      }

      if (plan.action === "moshpit-first") {
        const answer = await moshpitResponse(query, plan.name);
        if (answer) {
          stats.moshpit++;
          return finish("moshpit", answer.buffer);
        }
        if (!query.flags.rd) {
          stats.refused++;
          return finish("refused(not registered, no recursion)", errorResponse(query, RCODE.REFUSED));
        }
        stats.forwarded++;
        return finish("forwarded(not registered)", await forwardQuery(rawQuery, ctx));
      }

      // forward-first: clearnet owns the name if clearnet can answer for it.
      const relayed = await forwardQuery(rawQuery, ctx);
      let upstream: Message | null = null;
      try {
        upstream = decodeMessage(relayed);
      } catch {
        upstream = null;
      }
      if (!upstream || clearnetAnswered(upstream)) {
        stats.forwarded++;
        return finish("forwarded", relayed);
      }

      const answer = await moshpitResponse(query, plan.name);
      if (answer) {
        stats.moshpit++;
        return finish("moshpit(backfill)", answer.buffer);
      }
      stats.forwarded++;
      return finish("forwarded(no moshpit name)", relayed);
    } catch (err) {
      stats.failed++;
      log(`error ${question?.name ?? "?"}: ${(err as Error)?.message ?? err}`);
      return finish("servfail", errorResponse(query, RCODE.SERVFAIL));
    }
  }

  function allowed(remote: string | undefined): boolean {
    if (!options.rateLimiter || !remote) return true;
    if (options.rateLimiter.allow(remote)) return true;
    stats.dropped++;
    return false;
  }

  function listenUdp(): Promise<number> {
    return new Promise((resolve, reject) => {
      // `udp6` with dual-stack would serve both families from one socket, but
      // not every host has IPv6 configured, and a resolver that refuses to
      // start on an IPv4-only box is worse than one that only serves IPv4.
      const socket = dgram.createSocket({ type: net.isIPv6(address) ? "udp6" : "udp4", reuseAddr: true });
      socket.on("error", reject);
      socket.on("message", (msg, rinfo) => {
        if (!allowed(rinfo.address)) return;
        handle(msg, { transport: "udp", remote: rinfo.address })
          .then((response) => {
            if (response) socket.send(response, rinfo.port, rinfo.address, () => {});
          })
          .catch(() => {
            stats.failed++;
          });
      });
      socket.bind(port, address, () => {
        socket.off("error", reject);
        socket.on("error", (err) => log(`udp error: ${err.message}`));
        udpSocket = socket;
        resolve(socket.address().port);
      });
    });
  }

  function listenTcp(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        const remote = socket.remoteAddress ?? undefined;
        if (!allowed(remote)) {
          socket.destroy();
          return;
        }
        connections.add(socket);
        socket.setTimeout(TCP_IDLE_MS, () => socket.destroy());
        socket.on("error", () => socket.destroy());
        socket.on("close", () => connections.delete(socket));

        let buffered = Buffer.alloc(0);
        socket.on("data", (chunk) => {
          buffered = Buffer.concat([buffered, chunk]);
          // A connection may carry several queries back to back, each framed
          // by a two-byte length (RFC 7766).
          for (;;) {
            if (buffered.length < 2) return;
            const length = buffered.readUInt16BE(0);
            if (buffered.length < 2 + length) return;
            const message = buffered.subarray(2, 2 + length);
            buffered = buffered.subarray(2 + length);
            if (!allowed(remote)) {
              socket.destroy();
              return;
            }
            handle(message, { transport: "tcp", remote })
              .then((response) => {
                if (!response || socket.destroyed) return;
                const framed = Buffer.alloc(2 + response.length);
                framed.writeUInt16BE(response.length, 0);
                response.copy(framed, 2);
                socket.write(framed);
              })
              .catch(() => socket.destroy());
          }
        });
      });
      server.on("error", reject);
      server.listen(port, address, () => {
        server.off("error", reject);
        server.on("error", (err) => log(`tcp error: ${err.message}`));
        tcpServer = server;
        resolve((server.address() as net.AddressInfo).port);
      });
    });
  }

  return {
    handle,
    async listen() {
      const udp = await listenUdp();
      // Port 0 means "pick one" — TCP then has to land on whatever UDP got, or
      // the two halves of the resolver answer on different ports.
      if (port === 0) port = udp;
      const tcp = await listenTcp();
      return { udp, tcp };
    },
    async close() {
      for (const socket of connections) socket.destroy();
      connections.clear();
      forwarder.close();
      await Promise.all([
        new Promise<void>((resolve) => (udpSocket ? udpSocket.close(() => resolve()) : resolve())),
        new Promise<void>((resolve) => (tcpServer ? tcpServer.close(() => resolve()) : resolve())),
      ]);
      udpSocket = null;
      tcpServer = null;
    },
    stats: () => ({ ...stats }),
  };
}
