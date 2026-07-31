import type { Metadata } from "next";
import Nav from "@/components/Nav";
import { resolverConfig } from "@/lib/moshpit-resolvers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moshpit DNS — reach .moshpit without an extension",
  description:
    "Point your device at the Moshpit resolvers and custom TLDs resolve like any other name. The rest of the internet keeps working.",
};

/**
 * pit.moshcode.sh/dns — the setup instructions for the public resolvers.
 *
 * The addresses come from the environment (see lib/moshpit-resolvers.ts): a
 * page that hardcoded them would keep telling people to use a box that moved.
 * When none are configured the page says so plainly and explains how to run
 * one, because inventing an address for someone to paste into their network
 * settings is worse than admitting the resolvers are not up yet.
 */
export default function MoshpitDnsPage() {
  const { resolvers, doh, published } = resolverConfig();

  return (
    <div id="site">
      <Nav />

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="dot" /> moshpit dns
          </p>
          <h1 className="title">
            ONE SETTING.
            <br />
            <span className="acid">.ANYTHING</span> RESOLVES.
          </h1>
          <p className="pit-lede">
            Moshpit names live outside the traditional DNS root, so a normal browser has
            nowhere to look them up. These resolvers know where. Point a laptop, a phone or a
            whole router at one and <code>.moshpit</code>, <code>.eggs</code>,{" "}
            <code>.yeah</code> resolve like any other name — while <code>.com</code>,{" "}
            <code>.org</code> and the rest of the internet keep working exactly as before,
            forwarded on to 8.8.8.8 and 1.1.1.1.
          </p>
          <p className="pit-lede pit-dim">
            No extension, no app, no account. Every operating system already has this setting.
          </p>
        </div>
      </section>

      <section className="pit-how">
        <p className="tag">// the addresses</p>
        {published ? (
          <>
            <ul className="dns-addrs">
              {resolvers.map((r) => (
                <li key={r.address}>
                  <code className="dns-ip">{r.address}</code>
                  {r.name ? <span className="dns-host">{r.name}</span> : null}
                </li>
              ))}
            </ul>
            <p className="pit-lede pit-dim">
              Use both, in that order. The second is there so the first can be rebooted
              without the namespace going with it. You type the addresses, not the names —
              a resolver&apos;s own name cannot be looked up until you already have a
              working resolver.
            </p>
          </>
        ) : (
          <>
            <p className="pit-lede">
              <strong>Not published yet.</strong> The resolver is built and tested, but no
              public instance is announced here — and this page will not invent an address
              for you to paste into your network settings.
            </p>
            <p className="pit-lede pit-dim">
              You can run your own today (see below), and it works for every name in the
              namespace, not just yours.
            </p>
          </>
        )}
      </section>

      <section className="pit-how">
        <p className="tag">// set it up</p>
        <ol className="pit-steps">
          <li>
            <strong>macOS.</strong> System Settings → Network → your connection → Details →
            DNS. Add the address with <code>+</code>, drag it to the top, Save.
          </li>
          <li>
            <strong>Windows.</strong> Settings → Network &amp; Internet → your adapter → DNS
            server assignment → Edit → Manual, switch IPv4 on and set the preferred server.
          </li>
          <li>
            <strong>Linux.</strong> <code>resolvectl dns &lt;interface&gt; &lt;address&gt;</code>{" "}
            under systemd-resolved, or a <code>nameserver</code> line in{" "}
            <code>/etc/resolv.conf</code>.
          </li>
          <li>
            <strong>Router.</strong> Set it as the DNS your router hands out over DHCP and
            every device on the network gets the namespace. This is the setup it is really
            for.
          </li>
          <li>
            <strong>A locked-down machine</strong> where DNS is not yours to change: use DNS
            over HTTPS in the browser instead — Firefox under Privacy &amp; Security → DNS
            over HTTPS → custom provider, Chrome under Security → Use secure DNS → custom.
            {doh ? (
              <>
                {" "}
                The endpoint is <code>{doh}</code>.
              </>
            ) : (
              <> An endpoint is published here once a resolver is up.</>
            )}
          </li>
        </ol>
      </section>

      <section className="pit-how">
        <p className="tag">// check it worked</p>
        <pre className="dns-pre">
          <code>{`dig +short anything.moshpit     # an address, not an error
dig +short example.com          # the ordinary internet, still fine

nslookup anything.moshpit       # the Windows spelling`}</code>
        </pre>
        <p className="pit-lede pit-dim">
          A <code>TXT</code> lookup on any Moshpit name reports which registry and gateway
          answered, which is the fastest way to tell a resolver problem from a site problem.
        </p>
      </section>

      <section className="pit-how">
        <p className="tag">// what still breaks</p>
        <p className="pit-lede">
          <code>https://</code> on a Moshpit name will warn. No public certificate authority
          will issue a certificate for <code>scrambled.eggs</code>, because none of them
          recognise a namespace that does not descend from the ICANN root. Plain{" "}
          <code>http://</code> works, and so does the clearnet page for the name here on{" "}
          <code>pit.moshcode.sh</code>. A certificate authority you opt into is the real
          answer, and it is not built yet.
        </p>
        <p className="pit-lede pit-dim">
          Clearnet lookups are forwarded to Google and Cloudflare, which is what a forwarder
          does — run your own resolver if that trade is wrong for you, and point it wherever
          you like.
        </p>
      </section>

      <section className="pit-how">
        <p className="tag">// run your own</p>
        <p className="pit-lede">
          The resolver is in the open, has no dependencies and no database, and reads the
          registry over ordinary HTTPS. Nothing about it privileges ours — a private pit
          points at a different registry, a household one runs on whatever is already on the
          shelf.
        </p>
        <pre className="dns-pre">
          <code>{`git clone https://github.com/moshcoder/moshcoding
cd moshcoding && bun run dns    # port 5354, no privileges needed

dig @127.0.0.1 -p 5354 +short anything.moshpit`}</code>
        </pre>
        <p className="pit-lede pit-dim">
          Setup, deployment and the operating notes:{" "}
          <a
            className="acid"
            href="https://github.com/moshcoder/moshcoding/blob/master/docs/moshpit-dns.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs/moshpit-dns.md
          </a>
          . Claim a name first over at <a className="acid" href="/pit">the pit</a>.
        </p>
      </section>
    </div>
  );
}
