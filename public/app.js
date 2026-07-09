/* moshcoding front-end: main site + ?dn= tenant mode + waitlist wiring */
(() => {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const params = new URLSearchParams(location.search);
  const rawDn = params.get("dn");

  const site = $("#site");
  const tenant = $("#tenant");

  const cleanDomain = (s) =>
    String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  const isDomain = (d) => /^[a-z0-9.-]{3,253}$/.test(d) && d.includes(".") && !d.includes("..");

  /* -------- waitlist submit shared by both forms -------- */
  async function submitWaitlist(form, msgEl, dn) {
    const email = form.email.value.trim();
    msgEl.className = "fmsg";
    msgEl.textContent = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      msgEl.classList.add("err");
      msgEl.textContent = "That doesn't look like an email.";
      return;
    }
    const btn = form.querySelector("button");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Summoning…";
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dn ? { email, dn } : { email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something broke.");
      msgEl.classList.add("ok");
      msgEl.textContent = data.already
        ? "You're already in the pit. 🤘"
        : "You're in. Watch your inbox. 🤘";
      form.reset();
    } catch (err) {
      msgEl.classList.add("err");
      msgEl.textContent = err.message || "Network died. Try again.";
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* -------- auth slot in the nav (Login with CoinPayPortal) -------- */
  async function renderAuth() {
    const slot = document.getElementById("authSlot");
    if (!slot) return;
    try {
      const { authEnabled, user } = await (await fetch("/api/me")).json();
      if (!authEnabled) return; // login not configured → show nothing
      if (user) {
        slot.innerHTML =
          `<span class="who" title="${user.email || ""}">${user.email || user.name || "signed in"}</span>` +
          `<button class="auth-btn" id="logoutBtn">Log out</button>`;
        slot.querySelector("#logoutBtn").addEventListener("click", async () => {
          await fetch("/auth/logout", { method: "POST" });
          location.reload();
        });
      } else {
        slot.innerHTML = `<a class="auth-btn primary" href="/auth/login">Log in with CoinPay</a>`;
      }
    } catch { /* ignore */ }
  }

  const dn = rawDn ? cleanDomain(rawDn) : null;

  if (dn && isDomain(dn)) {
    /* ---------------- TENANT MODE ---------------- */
    tenant.hidden = false;
    document.title = `${dn} — coming soon · #moshcoding`;

    const apply = (cfg) => {
      $("#tDomain").textContent = cfg.dn;
      $("#tBrand").textContent = cfg.brand || cfg.dn;
      $("#tHead").textContent = cfg.headline || "IS COMING";
      $("#tTag").textContent = cfg.tagline || "";
      $("#tSub").textContent = cfg.sub || "";
      if (cfg.cta) $("#tCta").textContent = cfg.cta;
      if (cfg.accent && /^#[0-9a-fA-F]{3,8}$/.test(cfg.accent)) {
        document.documentElement.style.setProperty("--tenant-accent", cfg.accent);
      }
      const hEl = $("#tHashtag");
      if (cfg.hashtag) { hEl.textContent = cfg.hashtag; hEl.hidden = false; }
      renderLinks(cfg.links || []);
    };

    // ---- linktree-style social list ----
    const ICONS = {
      web: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.5 2.5 3.5 6 3.5 10s-1 7.5-3.5 10m0-20c-2.5 2.5-3.5 6-3.5 10s1 7.5 3.5 10M2 12h20"/>',
      x: '<path d="M4 3l7 8.5L4.5 21H7l5-6 5 6h3l-7.5-9L20 3h-2.5L13 8.2 8.8 3H4z" stroke="none" fill="currentColor"/>',
      instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>',
      tiktok: '<path d="M14 3v10.5a3.5 3.5 0 11-3.5-3.5c.4 0 .8.06 1.1.17M14 3c.5 2.5 2 4 4.5 4.3" fill="none"/>',
      github: '<path d="M12 2a10 10 0 00-3.2 19.5c.5.1.7-.2.7-.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 015 0c1.9-1.3 2.7-1 2.7-1 .6 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0012 2z" fill="currentColor" stroke="none"/>',
      youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/>',
      spotify: '<circle cx="12" cy="12" r="10"/><path d="M7.5 9.8c3-.8 6.2-.5 8.8 1M8 13c2.4-.6 4.8-.3 6.8 1M8.6 16c1.8-.4 3.6-.2 5.1.7" fill="none"/>',
      discord: '<path d="M8 8.5A13 13 0 0112 8a13 13 0 014 .5M8 15.5A13 13 0 0012 16a13 13 0 004-.5M6 7l1-1s2-1 5-1 5 1 5 1l1 1c1.5 2 2 5 1.8 8-1.2 1.3-3 2-3 2l-1-1.5M6 7C4.5 9 4 12 4.2 15c1.2 1.3 3 2 3 2l1-1.5" fill="none"/><circle cx="9.5" cy="12.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r="1.1" fill="currentColor" stroke="none"/>',
      link: '<path d="M9 15l6-6M10 6l1-1a4 4 0 015.7 5.7l-1 1M14 18l-1 1A4 4 0 017.3 13.3l1-1" fill="none"/>',
    };
    const kindFromUrl = (url) => {
      let h = "";
      try { h = new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; }
      if (/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(h)) return "x";
      if (/instagram\.com$/.test(h)) return "instagram";
      if (/tiktok\.com$/.test(h)) return "tiktok";
      if (/github\.com$/.test(h)) return "github";
      if (/youtu\.?be(\.com)?$/.test(h)) return "youtube";
      if (/spotify\.com$/.test(h)) return "spotify";
      if (/discord\.(gg|com)$/.test(h)) return "discord";
      return "web";
    };
    function renderLinks(links) {
      const wrap = $("#tLinks");
      wrap.textContent = "";
      for (const l of links) {
        if (!l || !l.url || !l.label) continue;
        const kind = l.kind && ICONS[l.kind] ? l.kind : kindFromUrl(l.url);
        const a = document.createElement("a");
        a.className = "lt";
        a.href = l.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.innerHTML =
          `<span class="lt-i" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg></span>` +
          `<span class="lt-l"></span><span class="lt-go" aria-hidden="true">↗</span>`;
        a.querySelector(".lt-l").textContent = l.label;
        wrap.appendChild(a);
      }
    }

    // optimistic default from the domain, then refine from server config
    apply({ dn, brand: dn.split(".")[0].replace(/\b\w/g, (c) => c.toUpperCase()) });
    fetch(`/api/config?dn=${encodeURIComponent(dn)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => cfg && apply(cfg))
      .catch(() => {});

    const form = $("#tenantForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitWaitlist(form, $("#tenantMsg"), dn);
    });
  } else {
    /* ---------------- MAIN SITE ---------------- */
    site.hidden = false;
    renderAuth();

    const form = $("#siteForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitWaitlist(form, $("#siteMsg"), null);
    });

    // "summon" demo → open the tenant page for the typed domain
    const input = $("#dnInput");
    const go = () => {
      const d = cleanDomain(input.value);
      if (!isDomain(d)) {
        input.focus();
        input.style.color = "#ff4d3d";
        setTimeout(() => (input.style.color = ""), 900);
        return;
      }
      location.href = `/?dn=${encodeURIComponent(d)}`;
    };
    $("#summon").addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }
})();
