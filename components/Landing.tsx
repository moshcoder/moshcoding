import AuthSlot from "./AuthSlot";
import SummonDemo from "./SummonDemo";
import WaitlistForm from "./WaitlistForm";

const TICKER = ["BUILD. BREAK. REPEAT.", "NO BUGS, JUST FEATURES", "DEADLINES ARE FOR THE WEAK", "PUSH CODE, START PITS"];

export default function Landing() {
  return (
    <div id="site">
      <header className="nav">
        <a className="wm" href="/">#MOSH<span>CODING</span></a>
        <nav>
          <a href="#chaos">The one-liner</a>
          <a href="#waitlist">Waitlist</a>
          <a href="/badges">Badges</a>
          <a className="ghost" href="https://github.com/moshcoder/moshcoding" target="_blank" rel="noopener noreferrer">GitHub</a>
          <AuthSlot />
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="dot" /> A Spotify playlist for developers</p>
          <h1 className="title">CODE HARD.<br /><span className="acid">MOSH HARDER.</span></h1>
          <pre className="code" aria-hidden="true">
            <span className="c-kw">while</span>{" (alive) {\n  "}
            <span className="c-fn">code</span>{"();\n  "}
            <span className="c-fn">mosh</span>{"();\n  "}
            <span className="c-fn">repeat</span>{"();\n}"}
            <span className="c-cm"> // no bugs, only features</span>
          </pre>
          <div className="cta-row">
            <a href="#waitlist" className="btn btn-acid">Join the pit</a>
            <a href="#chaos" className="btn btn-ghost">Give a domain its page →</a>
          </div>
        </div>
        <div className="hero-art">
          <img src="/assets/mascot-hero.png" alt="Moshcoding skeleton coder mascot" />
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i}>{t}<span className="sep" style={{ marginLeft: 26 }}>✦</span></span>
          ))}
        </div>
      </div>

      <section id="chaos" className="chaos">
        <p className="tag">// turn any domain into chaos</p>
        <h2>One line. A metal coming-soon page.</h2>
        <p className="lede">Point any domain at moshcoding and it gets a blacked-out, poison-green launch page with a working email waitlist. No build, no deploy.</p>
        <SummonDemo />
        <p className="hint">Try it: <a href="/?dn=example.com">example.com</a> · <a href="/?dn=killer-startup.io">killer-startup.io</a></p>
      </section>

      <section className="badges">
        <figure><img src="/assets/badge-code-hard.png" alt="Code Hard badge" /><figcaption>Code Hard</figcaption></figure>
        <figure><img src="/assets/badge-no-bugs.png" alt="No Bugs, Just Features badge" /><figcaption>No Bugs, Just Features</figcaption></figure>
        <figure><img src="/assets/badge-push-code.png" alt="Push Code, Start Pits badge" /><figcaption>Push Code, Start Pits</figcaption></figure>
      </section>

      <section id="waitlist" className="waitlist">
        <h2>Get in the pit</h2>
        <p className="lede">Drop your email. We&apos;ll hit you when the playlist and the merch drop.</p>
        <WaitlistForm />
      </section>

      <footer className="foot">
        <a className="wm sm" href="/">#MOSHCODING</a>
        <p className="legal">
          &copy; 2026 <a href="https://moshcoding.com" rel="noopener noreferrer">powered by moshcoding.com</a> ·
          Profullstack, Inc. (dba moshcoding)
        </p>
      </footer>
    </div>
  );
}
