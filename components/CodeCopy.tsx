"use client";
import { useEffect } from "react";
import { copyText } from "@/lib/clipboard";

// Progressive enhancement: adds a "Copy" button to every rendered code block
// (.code-wrap) on the page. The blocks are server-rendered HTML, so we wire this
// up on the client after mount.
export default function CodeCopy() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    document.querySelectorAll<HTMLElement>(".code-wrap").forEach((wrap) => {
      if (wrap.querySelector(".code-copy")) return;
      const pre = wrap.querySelector("pre");
      if (!pre) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.textContent = "Copy";
      const onClick = async () => {
        const ok = await copyText(pre.textContent || "");
        btn.textContent = ok ? "Copied 🤘" : "Copy failed";
        window.setTimeout(() => { btn.textContent = "Copy"; }, 1600);
      };
      btn.addEventListener("click", onClick);
      wrap.appendChild(btn);
      cleanups.push(() => { btn.removeEventListener("click", onClick); btn.remove(); });
    });
    return () => cleanups.forEach((c) => c());
  }, []);
  return null;
}
