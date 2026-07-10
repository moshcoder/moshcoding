"use client";
import { useState } from "react";
import AuthSlot from "./AuthSlot";

// Landing header with a mobile hamburger. On desktop the links sit inline; on
// small screens (and installed PWA) they collapse into a toggled drawer.
export default function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="nav">
      <a className="wm" href="/">#MOSH<span>CODING</span></a>
      <button
        type="button"
        className="nav-burger"
        aria-label="Toggle menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span /><span /><span />
      </button>
      <nav className={open ? "open" : ""} onClick={() => setOpen(false)}>
        <a href="#chaos">The one-liner</a>
        <a href="#waitlist">Waitlist</a>
        <a href="/badges">Badges</a>
        <a href="/videos">Videos</a>
        <a className="ghost" href="https://github.com/moshcoder/moshcoding" target="_blank" rel="noopener noreferrer">GitHub</a>
        <AuthSlot />
      </nav>
    </header>
  );
}
