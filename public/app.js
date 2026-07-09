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
    };

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
