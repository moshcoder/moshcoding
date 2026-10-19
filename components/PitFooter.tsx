// The pit.world global footer: fetched server-side, cached for an hour,
// rendered last in <body>. Any failure renders nothing. Many routes here are
// force-dynamic (fetch caching off), so the snippet is also kept
// in module scope and served stale while pit.world is slow or down.
const PIT_FOOTER_URL = "https://pit.world/snippets/footer.html?site=moshcoding.com";
const TTL_MS = 60 * 60 * 1000;
const cache = { html: "", fetchedAt: 0 };

async function loadPitFooter(): Promise<string> {
  if (Date.now() - cache.fetchedAt < TTL_MS) return cache.html;
  cache.fetchedAt = Date.now();
  try {
    const res = await fetch(PIT_FOOTER_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const html = await res.text();
      if (html.includes("data-pit-footer")) cache.html = html;
    }
  } catch {
    // keep the last good copy
  }
  return cache.html;
}

export default async function PitFooter() {
  const html = await loadPitFooter();
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
