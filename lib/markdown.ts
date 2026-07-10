// Minimal, safe Markdown → HTML for user-authored content blocks.
//
// Security model: every character of user input is HTML-escaped FIRST, so raw
// HTML/<script> can never survive. We then re-introduce a small, fixed set of
// tags for markdown constructs. Link/image URLs are scheme-checked so a
// `javascript:` (or `data:`) URI can't sneak through. No parser deps.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Only http(s), mailto, and site-relative links are allowed as hrefs/srcs.
function safeUrl(raw: string): string | null {
  const u = raw.trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^\/(?!\/)/.test(u)) return u; // "/path" but not "//host"
  if (/^#/.test(u)) return u;
  return null;
}

// ---- lightweight syntax highlighting (bun.sh-ish) --------------------------
// Tokenizes, then escapes each token — so highlighted code is still XSS-safe.
const JS_KW = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case",
  "break", "continue", "new", "class", "extends", "import", "from", "export", "default", "async",
  "await", "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "this", "super",
  "yield", "void", "delete", "null", "undefined", "true", "false", "type", "interface", "enum",
  "implements", "public", "private", "readonly", "static", "as", "keyof", "namespace",
]);

function highlightJS(code: string): string {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));
    if (m[1]) out += `<span class="tk-c">${escapeHtml(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-s">${escapeHtml(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-n">${escapeHtml(m[3])}</span>`;
    else {
      const w = m[4];
      if (JS_KW.has(w)) out += `<span class="tk-k">${escapeHtml(w)}</span>`;
      else if (/^\s*\(/.test(code.slice(re.lastIndex))) out += `<span class="tk-f">${escapeHtml(w)}</span>`;
      else out += escapeHtml(w);
    }
    last = re.lastIndex;
  }
  if (last < code.length) out += escapeHtml(code.slice(last));
  return out;
}

function highlightSh(code: string): string {
  const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$\w+|\$\{[^}]*\})|(-{1,2}[A-Za-z0-9][\w-]*)/g;
  let out = "", last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));
    if (m[1]) out += `<span class="tk-c">${escapeHtml(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-s">${escapeHtml(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-v">${escapeHtml(m[3])}</span>`;
    else out += `<span class="tk-flag">${escapeHtml(m[4])}</span>`;
    last = re.lastIndex;
  }
  if (last < code.length) out += escapeHtml(code.slice(last));
  return out;
}

/** Highlights a code block by language, or escapes it plainly. Returns HTML. */
function highlightCode(code: string, lang: string): string {
  switch (lang) {
    case "js": case "jsx": case "javascript": case "ts": case "tsx": case "typescript": case "json":
      return highlightJS(code);
    case "sh": case "bash": case "shell": case "zsh": case "console":
      return highlightSh(code);
    default:
      return escapeHtml(code);
  }
}

/** Inline: operates on ALREADY-escaped text; emits only safe tags. */
function inline(escaped: string): string {
  let s = escaped;
  // `code` (before other inlines so their markers inside code are literal)
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
    const safe = safeUrl(url);
    return safe ? `<img src="${safe}" alt="${alt}" loading="lazy" />` : alt;
  });
  // links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
  });
  // bold then italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>").replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
  return s;
}

export function renderMarkdown(md: string): string {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let listType: "ul" | "ol" | null = null;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block ```lang
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // consume closing fence
      const lang = (fence[1] || "").toLowerCase();
      out.push(
        `<div class="code-wrap"><pre class="hl" data-lang="${escapeHtml(lang || "text")}">` +
        `<code>${highlightCode(body.join("\n"), lang)}</code></pre></div>`,
      );
      continue;
    }

    if (/^\s*$/.test(line)) { closeList(); i++; continue; }

    // hr
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push("<hr />"); i++; continue; }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const n = h[1].length; out.push(`<h${n}>${inline(escapeHtml(h[2].trim()))}</h${n}>`); i++; continue; }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      closeList();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${inline(escapeHtml(quote.join(" ")))}</blockquote>`);
      continue;
    }

    // lists
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (listType && listType !== want) closeList();
      if (!listType) { listType = want as "ul" | "ol"; out.push(`<${want}>`); }
      out.push(`<li>${inline(escapeHtml((ul ? ul[1] : ol![1]).trim()))}</li>`);
      i++; continue;
    }

    // paragraph (gather consecutive non-blank, non-structural lines)
    closeList();
    const para: string[] = [line];
    i++;
    while (
      i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*+]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
    ) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(escapeHtml(para.join("\n"))).replace(/\n/g, "<br />")}</p>`);
  }
  closeList();
  return out.join("\n");
}
