"use client";
import { useRef, useState } from "react";

const clean = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const isDomain = (d: string) => /^[a-z0-9.-]{3,253}$/.test(d) && d.includes(".") && !d.includes("..");

export default function SummonDemo() {
  const [val, setVal] = useState("");
  const [bad, setBad] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function go() {
    const d = clean(val);
    if (!isDomain(d)) {
      setBad(true);
      inputRef.current?.focus();
      setTimeout(() => setBad(false), 900);
      return;
    }
    location.href = `/?dn=${encodeURIComponent(d)}`;
  }

  return (
    <div className="url-demo">
      <code className="u">
        moshcoding.com/?dn=
        <input
          ref={inputRef}
          type="text" spellCheck={false} placeholder="yourdomain.com" aria-label="your domain"
          value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
          style={bad ? { color: "#ff4d3d" } : undefined}
        />
      </code>
      <button className="btn btn-acid" onClick={go}>Summon it</button>
    </div>
  );
}
