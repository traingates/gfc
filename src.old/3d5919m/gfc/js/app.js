/* ============================================================================
   GFC — GLOBAL FIGHT CLUB  ·  APPLICATION LOGIC
   ----------------------------------------------------------------------------
   Reads content from js/data.js and renders the whole site. You should not
   need to edit this file to change content — do that in js/data.js.

   Sections below (search the ALL-CAPS headers):
     HELPERS · EMBLEM · RENDER (home / fighters / rankings / history / info)
     MODAL · ROUTER · PARTICLES · COUNTDOWN · SEARCH · REVEAL · BOOT
   ============================================================================ */

(function () {
  "use strict";

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ====================================================== STATE / STORAGE == */
  // The site renders from D. On first load D = the seed in data.js. Any edits
  // made in the admin panel are saved to the browser (localStorage) and reload
  // automatically next time. If storage is unavailable (e.g. a sandboxed
  // preview), the site still works — edits just won't persist across reloads.
  const DEFAULTS = window.GFC_DATA;
  const LS_KEY   = "gfc_state_v2";
  const LOGO     = window.GFC_LOGO || "assets/logo.png";
  const clone    = (o) => JSON.parse(JSON.stringify(o));

  // Ensure a loaded state has every key the current version expects.
  function withDefaults(s) {
    const base = clone(DEFAULTS);
    if (!s || typeof s !== "object") return base;
    const out = Object.assign(base, s);
    out.org = Object.assign(clone(DEFAULTS.org), s.org || {});
    out.org.stats = Object.assign(clone(DEFAULTS.org.stats), (s.org && s.org.stats) || {});
    out.info = Object.assign(clone(DEFAULTS.info), s.info || {});
    out.livestream = Object.assign(clone(DEFAULTS.livestream), s.livestream || {});
    out.commerce = Object.assign(clone(DEFAULTS.commerce), s.commerce || {});
    if (!Array.isArray(out.videos)) out.videos = clone(DEFAULTS.videos);
    if (!Array.isArray(out.membershipPlans)) out.membershipPlans = clone(DEFAULTS.membershipPlans);
    if (!Array.isArray(out.upcomingFights)) out.upcomingFights = [];
    out.upcomingFights = out.upcomingFights.map((f) => Object.assign({}, f, {
      tickets: Object.assign({ enabled:false, venue:"", rows:"A,B,C,D,E,F", seatsPerRow:10, price:0, unavailableSeats:"", checkoutUrl:"" }, f.tickets || {})
    }));
    return out;
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return withDefaults(JSON.parse(raw));
    } catch (_) {}
    return clone(DEFAULTS);
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(D)); return true; }
    catch (_) { return false; }
  }
  function storageAvailable() {
    try { const k = "__gfc_t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; }
    catch (_) { return false; }
  }
  let D = loadState();

  /* ====================================================== CLOUD (SUPABASE) = */
  /* Optional shared backend. When a Project URL + anon key are set in
     index.html (window.GFC_CLOUD) and the Supabase library has loaded, the
     admin panel saves to a shared database that every visitor reads from — no
     redeploy needed. Writes require a real login (Supabase Auth), so this also
     replaces the client-side password. If the cloud is unconfigured or
     unreachable, the site falls back to local (browser) saving automatically. */
  const CLOUD = window.GFC_CLOUD || { url: "", key: "" };
  let supa = null;
  let currentUser = null;
  function cloudEnabled() { return !!(CLOUD.url && CLOUD.key && window.supabase && supa); }
  function initCloud() {
    if (!(CLOUD.url && CLOUD.key && window.supabase)) return;
    try { supa = window.supabase.createClient(CLOUD.url, CLOUD.key); } catch (_) { supa = null; }
  }

  async function initPublicAuth() {
    if (!supa) return;
    try {
      const { data } = await supa.auth.getSession();
      currentUser = data && data.session ? data.session.user : null;
      renderChrome();
      renderTickets();
      renderMemberships();
      supa.auth.onAuthStateChange((_event, session) => {
        currentUser = session ? session.user : null;
        renderChrome();
        renderTickets();
        renderMemberships();
      });
    } catch (_) { currentUser = null; }
  }

  function publicUserName() {
    if (!currentUser) return "";
    const m = currentUser.user_metadata || {};
    return m.full_name || m.name || m.preferred_username || m.user_name || currentUser.email || "Member";
  }

  async function discordSignIn() {
    if (!supa) { toast("Discord sign-in needs the cloud connection"); return; }
    try {
      const { error } = await supa.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo: location.origin + location.pathname + location.hash }
      });
      if (error) toast("Discord sign-in could not start");
    } catch (_) { toast("Discord sign-in could not start"); }
  }

  async function publicSignOut() {
    if (!supa) return;
    try { await supa.auth.signOut(); } catch (_) {}
    currentUser = null;
    adminAuthed = false;
    renderChrome(); renderTickets(); renderMemberships();
  }

  async function verifyAdminSession(user) {
    if (!supa || !user) return false;
    try {
      const { data, error } = await supa.from("gfc_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      return !error && !!data;
    } catch (_) { return false; }
  }
  // Read the shared data blob (row id=1) and adopt it as the live data.
  async function pullFromCloud() {
    if (!supa) return false;
    try {
      const { data, error } = await supa.from("site").select("data").eq("id", 1).single();
      if (error || !data || !data.data) return false;
      D = withDefaults(data.data);
      saveState(); // keep a local cache too
      return true;
    } catch (_) { return false; }
  }
  // Publish the current data to the shared table (admin only; needs a session).
  async function pushToCloud() {
    if (!cloudEnabled() || !adminAuthed) return;
    setCloudStatus("saving");
    try {
      const { error } = await supa.from("site").upsert({ id: 1, data: D, updated_at: new Date().toISOString() });
      if (error) { setCloudStatus("fail"); toast("Cloud save failed — saved on this device only"); }
      else { setCloudStatus("ok"); toast("Saved & published to everyone"); }
    } catch (_) { setCloudStatus("fail"); toast("Cloud save failed — saved on this device only"); }
  }
  // Small "Publishing… / Published ✓" indicator in the admin header.
  function setCloudStatus(state) {
    const el = $("#cloudStatus");
    if (!el) return;
    clearTimeout(el._t);
    if (state === "saving") { el.textContent = "Publishing…"; el.className = "cloud-status saving"; }
    else if (state === "ok") {
      el.textContent = "Published ✓"; el.className = "cloud-status ok";
      el._t = setTimeout(() => { el.textContent = ""; el.className = "cloud-status"; }, 3000);
    } else {
      el.textContent = "Publish failed — saved locally"; el.className = "cloud-status fail";
      el._t = setTimeout(() => { el.textContent = ""; el.className = "cloud-status"; }, 5000);
    }
  }

  // Upload an image to the public "media" bucket and return its public URL.
  // A unique filename is used each time, so re-uploading keeps the old file
  // and just points at the newest one.
  const MAX_UPLOAD = 5 * 1024 * 1024; // 5 MB
  async function uploadImage(file, folder) {
    const ext = ((file.name || "").split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supa.storage.from("media").upload(key, file, { cacheControl: "3600", upsert: false });
    if (error) throw error;
    const { data } = supa.storage.from("media").getPublicUrl(key);
    return data.publicUrl;
  }
  // Images the admin removed, deleted from storage only when the edit is Saved
  // (so hitting Remove then Cancel doesn't lose anything).
  let pendingImageDeletes = [];
  function urlToMediaKey(url) {
    const m = String(url || "").match(/\/storage\/v1\/object\/public\/media\/([^?]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function flushImageDeletes() {
    if (!cloudEnabled() || !pendingImageDeletes.length) return;
    const keys = pendingImageDeletes.map(urlToMediaKey).filter(Boolean);
    pendingImageDeletes = [];
    if (keys.length) { try { supa.storage.from("media").remove(keys); } catch (_) {} }
  }

  // Handle a file chosen in any admin image field.
  document.addEventListener("change", async (e) => {
    const inp = e.target;
    if (!inp || !inp.matches || !inp.matches('input[type="file"][data-upload]')) return;
    const file = inp.files && inp.files[0];
    if (!file) return;
    const path = inp.getAttribute("data-upload");
    const folder = inp.getAttribute("data-folder") || "media";
    const st = document.getElementById("imgst-" + slugify(path));
    const setS = (t, c) => { if (st) { st.textContent = t; st.className = "img-status " + (c || ""); } };
    if (!/^image\//.test(file.type)) { setS("Not an image file", "err"); return; }
    if (file.size > MAX_UPLOAD) { setS("Too big — 5 MB max", "err"); return; }
    if (!cloudEnabled()) { setS("Connect the cloud first", "err"); return; }
    setS("Uploading…", "up");
    try {
      const url = await uploadImage(file, folder);
      const draft = activeDraft();
      if (draft) setByPath(draft, path, url);
      renderAdmin();       // re-render form to show the new preview
      toast("Image uploaded");
    } catch (_) { setS("Upload failed — try again", "err"); }
  });

  // Logo image markup (used in nav, hero, footer, loader, empty states).
  const logoImg = (cls = "") => `<img class="brand-logo ${cls}" src="${LOGO}" alt="GFC">`;

  // Reusable empty-state block for sections with nothing logged yet.
  const emptyState = (title, sub = "") => `
    <div class="empty-state reveal in">
      <div class="empty-mark">${logoImg("empty-logo")}</div>
      <div class="empty-title">${esc(title)}</div>
      ${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ""}
    </div>`;

  /* ====================================================== HELPERS ========== */

  // Minecraft skin render (full body) from a username, via mc-heads.net.
  // Change any fighter's "skin" in data.js to swap their look.
  const skinBody = (user) =>
    `https://mc-heads.net/body/${encodeURIComponent(user)}/300`;

  // Look up a full fighter object by their display username.
  const byName = (name) => D.fighters.find((f) => f.username === name);

  // Record string like  18-4
  const rec = (f) => `${f.wins}-${f.losses}`;

  // 1-based rank for a fighter (from the rankingOrder list).
  const rankOf = (name) => D.rankingOrder.indexOf(name) + 1;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Fallback skin if a username has no custom skin (renders default Steve).
  const onSkinError = `onerror="this.onerror=null;this.src='https://mc-heads.net/body/MHF_Steve/300'"`;

  /* ---- Image probing: look for a png/jpg/jpeg named after an item ----------- */
  // Turns "Acme Corp" into "acme-corp" so files can be named predictably.
  const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Candidate file paths to probe, in order (png first, then jpg, then jpeg).
  function imgCandidates(folder, name, exts) {
    const slug = slugify(name);
    return slug ? exts.map((e) => `${folder}/${slug}.${e}`) : [];
  }
  // A banner <img> that tries each candidate; if none load, its wrapper collapses.
  // An explicit uploaded URL (from Supabase Storage) takes priority over probing.
  function bannerHTML(name, cls, url) {
    if (url) {
      return `<div class="${cls}"><img src="${esc(url)}" data-hide=".${cls}" alt="" loading="lazy" style="display:none" onload="gfcImgOk(this)" onerror="gfcImgNext(this)"></div>`;
    }
    const cands = imgCandidates("assets/banners", name, ["png", "jpg", "jpeg"]);
    if (!cands.length) return "";
    return `<div class="${cls}"><img src="${cands[0]}" data-cands="${cands.join("|")}" data-i="0" data-hide=".${cls}" alt="" loading="lazy" style="display:none" onload="gfcImgOk(this)" onerror="gfcImgNext(this)"></div>`;
  }
  // Global handlers (inline onload/onerror attributes run in global scope).
  window.gfcImgNext = function (img) {
    const cands = (img.getAttribute("data-cands") || "").split("|").filter(Boolean);
    const i = (parseInt(img.getAttribute("data-i") || "0", 10) || 0) + 1;
    if (i < cands.length) { img.setAttribute("data-i", String(i)); img.src = cands[i]; return; }
    img.style.display = "none";
    const hideSel = img.getAttribute("data-hide");
    if (hideSel) { const el = img.closest(hideSel); if (el) el.style.display = "none"; }
  };
  window.gfcImgOk = function (img, hideSel) {
    img.style.display = "";
    if (hideSel) { const p = img.parentElement; const s = p && p.querySelector(hideSel); if (s) s.style.display = "none"; }
  };

  /* ====================================================== EMBLEM =========== */
  // Reusable voxel crest: angular shield + crossed swords, square (pixel) caps.
  function emblem(size, cls = "") {
    return `
    <svg class="${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="gfcShield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#22222a"/><stop offset="1" stop-color="#0b0b0f"/>
        </linearGradient>
        <linearGradient id="gfcBlade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f2f0ed"/><stop offset="1" stop-color="#8f8f98"/>
        </linearGradient>
      </defs>
      <path d="M50 6 L86 20 L86 48 L68 90 L50 96 L32 90 L14 48 L14 20 Z"
            fill="url(#gfcShield)" stroke="#d32f2f" stroke-width="3" stroke-linejoin="miter"/>
      <g stroke-linecap="square">
        <line x1="30" y1="74" x2="72" y2="26" stroke="url(#gfcBlade)" stroke-width="5"/>
        <line x1="70" y1="74" x2="28" y2="26" stroke="url(#gfcBlade)" stroke-width="5"/>
        <line x1="23" y1="63" x2="39" y2="72" stroke="#d32f2f" stroke-width="4"/>
        <line x1="77" y1="63" x2="61" y2="72" stroke="#d32f2f" stroke-width="4"/>
        <rect x="47" y="70" width="6" height="6" fill="#d32f2f"/>
      </g>
    </svg>`;
  }

  /* ================================================ RENDER: NAV + CHROME === */
  function renderChrome() {
    const navItems = [["home","Home"],["fighters","Fighters"],["rankings","Rankings"],["history","Results"],["videos","Videos"],["tickets","Tickets"],["memberships","Memberships"],["info","Info"]];
    const account = currentUser
      ? `<span class="nav-user" title="Signed in with Discord">${esc(publicUserName())}</span><button class="nav-auth" data-public-logout>Log out</button>`
      : `<button class="nav-auth" data-discord-login>Discord login</button>`;
    // Fixed navigation
    $("#nav").innerHTML = `
      <a class="nav-brand" href="#home" data-route="home" aria-label="GFC home">
        ${logoImg("nav-logo")}
      </a>
      <nav class="nav-links" id="navLinks">
        ${navItems.map(([r, label]) =>
          `<a class="nav-link" href="#${r}" data-route="${r}">${label}</a>`).join("")}
        <span class="nav-account">${account}</span>
      </nav>
      <button class="nav-toggle" id="navToggle" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>`;

    // Footer
    $("#footer").innerHTML = `
      <div class="f-brand">${logoImg("foot-logo")}</div>
      <div class="f-links">
        ${navItems.map(([r, label]) => `<a href="#${r}" data-route="${r}">${label}</a>`).join("")}
      </div>
      <div class="f-copy">© 2026 GLOBAL FIGHT CLUB · <span class="pix">NOT AFFILIATED WITH MOJANG</span>
        · <a href="#admin" data-route="admin" class="admin-link">Admin</a></div>`;
  }

  /* ================================================ RENDER: HOME =========== */
  function renderHome() {
    const s = D.org.stats;
    const main = D.upcomingFights.find((f) => f.main) || D.upcomingFights[0] || null;
    const featured = D.featuredFighter ? byName(D.featuredFighter) : null;

    // --- Upcoming fight + countdown block (or empty state) ---
    let fightBlock;
    if (main) {
      const f1 = byName(main.fighter1), f2 = byName(main.fighter2);
      const vsFighter = (f, fallbackName) => f ? `
        <div class="vs-fighter">
          <div class="skin-frame"><img src="${skinBody(f.skin || f.username)}" ${onSkinError} alt="${esc(f.username)}"></div>
          <div class="name">${esc(f.username)}</div>
          <div class="rec">${rec(f)}${rankOf(f.username) ? " · #" + rankOf(f.username) : ""}</div>
        </div>` : `
        <div class="vs-fighter">
          <div class="skin-frame"><img src="${skinBody(fallbackName || "MHF_Steve")}" ${onSkinError} alt="${esc(fallbackName || "TBD")}"></div>
          <div class="name">${esc(fallbackName || "TBD")}</div>
          <div class="rec">—</div>
        </div>`;
      fightBlock = `
        <div class="fight-grid">
          <div class="card main-event reveal">
            ${bannerHTML(main.event, "evt-banner", main.banner)}
            <div class="event-name">${esc(main.event)}</div>
            <div class="belt">◆ ${esc(main.belt || "")}</div>
            <div class="versus">
              ${vsFighter(f1, main.fighter1)}
              <div class="vs-mark">VS</div>
              ${vsFighter(f2, main.fighter2)}
            </div>
            <div class="when"><span>${fmtDate(main.date)}</span><span>·</span><b>${esc(main.time || "")}</b></div>
            ${main.tickets && main.tickets.enabled ? `<div style="margin-top:18px"><a class="btn btn-primary" href="#tickets" data-route="tickets">Buy tickets</a></div>` : ""}
          </div>
          <div class="card countdown-card reveal">
            <h3>Time Until Main Event</h3>
            <div class="countdown" id="countdown">
              ${["Days", "Hrs", "Min", "Sec"].map((u) =>
                `<div class="cd-unit"><div class="num" data-cd="${u}">--</div><div class="lbl">${u}</div></div>`).join("")}
            </div>
            <div class="upnext-list">
              ${D.upcomingFights.filter((fx) => fx !== main).map((fx) => `
                <div class="upnext">
                  <div class="pair">${esc(fx.fighter1)}<em>vs</em>${esc(fx.fighter2)}</div>
                  <div class="d">${shortDate(fx.date)}</div>
                </div>`).join("")}
            </div>
          </div>
        </div>`;
    } else {
      fightBlock = emptyState("No events scheduled yet", "Booked fights will appear here once they're added in the admin panel.");
    }

    // --- Featured fighter block (or empty state) ---
    let featuredBlock;
    if (featured) {
      featuredBlock = `
        <div class="card featured reveal" data-fighter="${esc(featured.username)}" role="button" tabindex="0">
          <div class="fl"><div class="skin-frame"><img src="${skinBody(featured.skin || featured.username)}" ${onSkinError} alt="${esc(featured.username)}"></div></div>
          <div class="fr">
            ${featured.champion ? `<div style="margin-bottom:14px"><span class="champ-badge">★ Champion</span></div>` : ""}
            <div class="name">${esc(featured.username)}</div>
            <div class="style">${esc(featured.nickname)}</div>
            <p class="bio">${esc(featured.bio)}</p>
            <div class="stat-row">
              <div class="stat-box"><div class="n w">${featured.wins}</div><div class="k-lbl">Wins</div></div>
              <div class="stat-box"><div class="n l">${featured.losses}</div><div class="k-lbl">Losses</div></div>
              <div class="stat-box"><div class="n k">${featured.koPercent}%</div><div class="k-lbl">KO Rate</div></div>
            </div>
          </div>
        </div>`;
    } else {
      featuredBlock = emptyState("No featured fighter yet", "Pick a fighter to spotlight from the admin panel.");
    }

    // --- Optional sections only shown when they have content ---
    const newsBlock = D.news.length ? `
      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">The Wire</span>
          <h2 class="section-title">Latest <span class="hl">News</span></h2>
        </div>
        <div class="news-grid">
          ${D.news.map((n, i) => `
            <article class="card news-card reveal" data-news="${i}">
              <span class="tag">${esc(n.tag)}</span>
              <h3 class="n-title">${esc(n.title)}</h3>
              <p class="n-ex">${esc(n.excerpt)}</p>
              <div class="n-date">${esc(n.date)}</div>
              <span class="read">Read More →</span>
            </article>`).join("")}
        </div>
      </section>` : "";

    const hofBlock = D.hallOfFame.length ? `
      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">Legends</span>
          <h2 class="section-title">Hall of <span class="hl" style="color:var(--gold)">Fame</span></h2>
        </div>
        <div class="hof-grid">
          ${D.hallOfFame.map((h) => `
            <div class="card hof-card reveal">
              <div class="skin-frame"><img src="${skinBody(h.skin || h.username)}" ${onSkinError} alt="${esc(h.username)}"></div>
              <div class="hof-name">${esc(h.username)}</div>
              <div class="hof-year">Inducted ${esc(h.year)}</div>
              <div class="hof-note">${esc(h.note)}</div>
            </div>`).join("")}
        </div>
      </section>` : "";

    const sponsorBlock = D.sponsors.length ? `
      <section class="sponsors reveal">
        <div class="sponsors-inner">
          <div class="lbl">OFFICIAL PARTNERS</div>
          <div class="sponsor-row">
            ${D.sponsors.map((sp) => {
              let logo = "";
              if (sp.logo) {
                logo = `<img class="sponsor-logo" src="${esc(sp.logo)}" alt="${esc(sp.name)}" loading="lazy" style="display:none" onload="gfcImgOk(this,'.sponsor-name')" onerror="this.style.display='none'">`;
              } else {
                const cands = imgCandidates("assets/sponsors", sp.name, ["png", "jpg", "jpeg"]);
                if (cands.length) logo = `<img class="sponsor-logo" src="${cands[0]}" data-cands="${cands.join("|")}" data-i="0" alt="${esc(sp.name)}" loading="lazy" style="display:none" onload="gfcImgOk(this,'.sponsor-name')" onerror="gfcImgNext(this)">`;
              }
              return `<span class="sponsor">${logo}<span class="sponsor-name">${esc(sp.name)}</span></span>`;
            }).join("")}
          </div>
        </div>
      </section>` : "";

    // News headlines flanking the hero — rendered ONLY when articles exist
    // (no empty lines otherwise). Newest first, capped so they can't overflow.
    const heroNews = (() => {
      const idx = D.news.map((_, i) => i).reverse().slice(0, 12);
      if (!idx.length) return "";
      const rail = (arr, side) => arr.length ? `<div class="hero-news ${side}">${arr.map((i) => {
        const n = D.news[i];
        return `<button class="hn-item" data-news="${i}"><div class="hn-title">${esc(n.title)}</div><div class="hn-more">read more</div></button>`;
      }).join("")}</div>` : "";
      const left = idx.filter((_, k) => k % 2 === 0);
      const right = idx.filter((_, k) => k % 2 === 1);
      return rail(left, "left") + rail(right, "right");
    })();

    $("#view-home").innerHTML = `
      <header class="hero">
        ${heroNews}
        <div class="hero-logo-wrap">${logoImg("hero-logo")}</div>
        <span class="kicker hero-kicker">Est. 2026 · Minecraft PvP</span>
        <h1 class="hero-title">Global Fighting<span class="line2">Championship</span></h1>
        ${D.org.tagline ? `<p class="hero-sub">${esc(D.org.tagline)}</p>` : ""}
        <div class="hero-cta">
          <a class="btn btn-primary" href="#fighters" data-route="fighters">View Fighters <span class="arrow">→</span></a>
          <a class="btn btn-ghost" href="#rankings" data-route="rankings">Current Rankings</a>
          ${ticketEvents().length ? `<a class="btn btn-ghost" href="#tickets" data-route="tickets">Buy Tickets</a>` : ""}
        </div>
        <div class="hero-scroll"><span>SCROLL</span><span class="dot"></span></div>
      </header>

      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">Next Event</span>
          <h2 class="section-title">Upcoming <span class="hl">Fight</span></h2>
        </div>
        ${fightBlock}
      </section>

      <section class="section" style="padding-top:0">
        <div class="stats-strip reveal">
          ${[[s.totalFights,"Total Fights"],[s.totalKOs,"Knockouts"],[s.championsCrowned,"Champions"],[s.eventsHeld,"Events Held"]]
            .map(([n,l]) => `<div class="stat-cell"><div class="num" data-count="${n}">0</div><div class="lbl">${l}</div></div>`).join("")}
        </div>
      </section>

      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">Spotlight</span>
          <h2 class="section-title">Featured <span class="hl">Fighter</span></h2>
        </div>
        ${featuredBlock}
      </section>

      ${newsBlock}
      ${hofBlock}
      ${sponsorBlock}`;
  }

  /* ================================================ RENDER: FIGHTERS ======= */
  function renderFighters() {
    if (!D.fighters.length) {
      $("#view-fighters").innerHTML = `
        <section class="section">
          <div class="section-head reveal in">
            <span class="kicker">The Roster</span>
            <h2 class="section-title">The <span class="hl">Fighters</span></h2>
          </div>
          ${emptyState("No fighters logged yet", "Add your roster from the admin panel and they'll show up here.")}
        </section>`;
      return;
    }
    $("#view-fighters").innerHTML = `
      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">The Roster</span>
          <h2 class="section-title">The <span class="hl">Fighters</span></h2>
          <p class="section-sub">Every sanctioned competitor in the league. Click any fighter to open their full profile, record, and fight history.</p>
        </div>
        <div class="fighters-toolbar reveal">
          <label class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input id="fighterSearch" type="text" placeholder="Search fighters or styles…" autocomplete="off">
          </label>
          <div class="roster-count" id="rosterCount">${D.fighters.length} fighters</div>
        </div>
        <div class="roster" id="roster"></div>
      </section>`;
    drawRoster(D.fighters);
  }

  // Draw the fighter grid (used again by search).
  function drawRoster(list) {
    const wrap = $("#roster");
    if (!list.length) { wrap.innerHTML = `<div class="no-results">No fighters match that search</div>`; return; }
    // Sort the displayed roster by rank so the champ leads; unranked go last.
    const rk = (n) => { const r = rankOf(n); return r > 0 ? r : 9999; };
    const sorted = [...list].sort((a, b) => rk(a.username) - rk(b.username));
    wrap.innerHTML = sorted.map((f) => `
      <article class="card fighter-card reveal in" data-fighter="${esc(f.username)}" role="button" tabindex="0">
        ${rankOf(f.username) ? `<span class="rank-tag">#${rankOf(f.username)}</span>` : ""}
        ${f.champion ? `<span class="champ-mini champ-badge">★</span>` : ""}
        <div class="skin-frame"><img src="${skinBody(f.skin || f.username)}" ${onSkinError} alt="${esc(f.username)}"></div>
        <div class="fc-name">${esc(f.username)}</div>
        <div class="fc-style">${esc(f.nickname)}</div>
        <div class="fc-foot">
          <span class="record"><span class="w">${f.wins}</span>-<span class="l">${f.losses}</span></span>
          <span class="fc-rank">${f.koPercent}% KO</span>
        </div>
      </article>`).join("");
  }

  /* ================================================ RENDER: RANKINGS ======= */
  function renderRankings() {
    const rows = D.rankingOrder.map((name) => byName(name)).filter(Boolean);
    if (!rows.length) {
      $("#view-rankings").innerHTML = `
        <section class="section">
          <div class="section-head reveal in">
            <span class="kicker">The Ladder</span>
            <h2 class="section-title">Official <span class="hl">Rankings</span></h2>
          </div>
          ${emptyState("No rankings yet", "Once fighters are logged, set the ladder order in the admin panel.")}
        </section>`;
      return;
    }
    $("#view-rankings").innerHTML = `
      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">The Ladder</span>
          <h2 class="section-title">Official <span class="hl">Rankings</span></h2>
          <p class="section-sub">Updated after every event. The #1 fighter holds the belt — everyone below is chasing it.</p>
        </div>
        <div class="rank-list">
          ${D.rankingOrder.map((name, i) => {
            const f = byName(name); if (!f) return "";
            const champ = !!f.champion;
            return `
            <div class="card rank-row ${champ ? "champ" : ""} reveal" data-fighter="${esc(name)}" role="button" tabindex="0">
              <div class="r-num">${i + 1}</div>
              <div class="r-skin"><img src="${skinBody(f.skin || f.username)}" ${onSkinError} alt="${esc(name)}"></div>
              <div>
                <div class="r-name">${esc(name)} ${champ ? '<span class="champ-badge" style="vertical-align:middle;margin-left:8px">★ Champ</span>' : ""}</div>
                <div class="r-style">${esc(f.nickname)}</div>
              </div>
              <div class="r-rec record"><span class="w">${f.wins}</span>-<span class="l">${f.losses}</span></div>
              <div class="r-ko">${f.koPercent}% KO<br>${f.streak > 0 ? "W" + f.streak + " streak" : "—"}</div>
            </div>`;
          }).join("")}
        </div>
      </section>`;
  }

  /* ================================================ RENDER: HISTORY ======== */
  function renderHistory() {
    const timelineHTML = D.history.length
      ? `<div class="timeline">
          ${D.history.map((h, i) => `
            <div class="tl-item reveal" data-tl="${i}">
              <div class="tl-head">
                <div>
                  <div class="tl-event">${esc(h.event)}</div>
                  <div class="tl-date">${esc(h.date)}</div>
                </div>
                <div class="tl-result">
                  <span class="win">${esc(h.winner)}</span>
                  <span class="via ${String(h.method).toLowerCase()}">${esc(h.method)}</span>
                </div>
                <svg class="tl-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>
              </div>
              <div class="tl-body"><div class="tl-body-inner">
                ${bannerHTML(h.event, "evt-banner", h.banner)}
                <p><b>${esc(h.winner)}</b> def. <span class="lose">${esc(h.loser)}</span> by <b>${esc(h.method)}</b>.</p>
                ${h.details ? `<p style="margin-top:10px">${esc(h.details)}</p>` : ""}
              </div></div>
            </div>`).join("")}
        </div>`
      : emptyState("No events logged yet", "Recorded fight results will build the timeline here.");

    // Posters: only include ones whose two headliners are on the roster.
    const validPosters = D.posters.filter((p) => byName(p.a) && byName(p.b));
    const posterHTML = validPosters.length ? `
      <section class="section" style="padding-top:0">
        <div class="section-head reveal">
          <span class="kicker">The Vault</span>
          <h2 class="section-title">Event <span class="hl">Posters</span></h2>
        </div>
        <div class="poster-grid">
          ${validPosters.map((p) => {
            const a = byName(p.a), b = byName(p.b);
            return `
            <div class="poster reveal" data-route="history">
              ${bannerHTML(p.event, "evt-banner", p.banner)}
              <div class="p-top"><div class="p-event">${esc(p.event)}</div><div class="p-sub">${esc(p.subtitle)}</div></div>
              <div class="p-fighters">
                <img src="${skinBody((a && a.skin) || p.a)}" ${onSkinError} alt="${esc(p.a)}">
                <img src="${skinBody((b && b.skin) || p.b)}" ${onSkinError} alt="${esc(p.b)}">
              </div>
              <div class="p-vs">VS</div>
              <div class="p-date">${esc(p.date)}</div>
            </div>`;
          }).join("")}
        </div>
      </section>` : "";

    $("#view-history").innerHTML = `
      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">The Record Books</span>
          <h2 class="section-title">Event <span class="hl">History</span></h2>
          ${D.history.length ? `<p class="section-sub">Every sanctioned event, newest first. Click a result to expand the full undercard.</p>` : ""}
        </div>
        ${timelineHTML}
      </section>
      ${posterHTML}`;
  }

  /* ================================================ RENDER: INFO =========== */
  function renderInfo() {
    const info = D.info;
    const aboutBlock = info.about ? `<div class="info-block reveal"><p class="info-lead">${esc(info.about)}</p></div>` : "";

    const howBlock = (info.howItWorks && info.howItWorks.length) ? `
      <div class="info-block">
        <div class="section-head reveal" style="margin-bottom:28px">
          <span class="kicker">The Format</span>
          <h3 class="section-title" style="font-size:clamp(28px,4vw,44px)">How Fights <span class="hl">Work</span></h3>
        </div>
        <div class="how-grid">
          ${info.howItWorks.map((h, i) => `
            <div class="card how-card reveal">
              <div class="idx">${String(i + 1).padStart(2, "0")}</div>
              <h4>${esc(h.step)}</h4>
              <p>${esc(h.text)}</p>
            </div>`).join("")}
        </div>
      </div>` : "";

    const joinBlock = info.howToJoin ? `
      <div class="info-block">
        <div class="section-head reveal" style="margin-bottom:22px">
          <span class="kicker">Recruitment</span>
          <h3 class="section-title" style="font-size:clamp(28px,4vw,44px)">How to <span class="hl">Join</span></h3>
        </div>
        <p class="info-lead reveal">${esc(info.howToJoin)}</p>
      </div>` : "";

    const rulesBlock = (info.rules && info.rules.length) ? `
      <div class="info-block">
        <div class="section-head reveal" style="margin-bottom:22px">
          <span class="kicker">The Code</span>
          <h3 class="section-title" style="font-size:clamp(28px,4vw,44px)">The <span class="hl">Rules</span></h3>
        </div>
        <div class="rules-list">
          ${info.rules.map((r, i) => `
            <div class="rule-item reveal"><span class="rn">${String(i + 1).padStart(2, "0")}</span><p>${esc(r)}</p></div>`).join("")}
        </div>
      </div>` : "";

    const faqBlock = (info.faq && info.faq.length) ? `
      <div class="info-block">
        <div class="section-head reveal" style="margin-bottom:22px">
          <span class="kicker">Answers</span>
          <h3 class="section-title" style="font-size:clamp(28px,4vw,44px)">Frequently <span class="hl">Asked</span></h3>
        </div>
        <div class="faq-list">
          ${info.faq.map((f) => `
            <div class="faq-item reveal">
              <div class="faq-q">${esc(f.q)}<span class="pm">+</span></div>
              <div class="faq-a"><p>${esc(f.a)}</p></div>
            </div>`).join("")}
        </div>
      </div>` : "";

    const staffBlock = (info.staff && info.staff.length) ? `
      <div class="info-block">
        <div class="section-head reveal" style="margin-bottom:28px">
          <span class="kicker">Behind the League</span>
          <h3 class="section-title" style="font-size:clamp(28px,4vw,44px)">The <span class="hl">Staff</span></h3>
        </div>
        <div class="staff-grid">
          ${info.staff.map((s) => `
            <div class="card staff-card reveal">
              <div class="skin-frame"><img src="${skinBody(s.skin || s.name)}" ${onSkinError} alt="${esc(s.name)}"></div>
              <div class="s-name">${esc(s.name)}</div>
              <div class="s-role">${esc(s.role)}</div>
              <div class="s-note">${esc(s.note)}</div>
            </div>`).join("")}
        </div>
      </div>` : "";

    const hasInfo = !!(info.about || info.howToJoin
      || (info.howItWorks && info.howItWorks.length)
      || (info.rules && info.rules.length)
      || (info.faq && info.faq.length)
      || (info.staff && info.staff.length));

    $("#view-info").innerHTML = `
      <section class="section">
        <div class="section-head reveal">
          <span class="kicker">The League</span>
          <h2 class="section-title">What is <span class="hl">GFC?</span></h2>
        </div>
        ${hasInfo ? `
        ${aboutBlock}
        ${howBlock}
        ${joinBlock}
        ${rulesBlock}
        ${faqBlock}
        ${staffBlock}
        <div class="info-cta reveal">
          <h3>Think You've Got It?</h3>
          <p>Recruitment opens between seasons. Prove you belong in the arena.</p>
          <a class="btn btn-primary" href="#fighters" data-route="fighters">Meet the Roster <span class="arrow">→</span></a>
        </div>` : emptyState("No league info yet", "Add your About, how-it-works, rules, FAQ, and staff from the admin panel’s Info Text tab.")}
      </section>`;
  }

  /* ================================================ RENDER: TICKETS ======== */
  let activeTicketId = "";
  let selectedSeats = [];
  let reservedSeats = [];
  let seatsLoading = false;

  const ticketEvents = () => D.upcomingFights.filter((f) => f.tickets && f.tickets.enabled);
  const ticketEventId = (f) => f.ticketId || slugify(`${f.event}-${f.date}`);
  const seatRows = (f) => String((f.tickets && f.tickets.rows) || "A,B,C,D,E,F")
    .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  const money = (n) => `${Number(n || 0).toFixed(2)} ${esc((D.commerce && D.commerce.currency) || "DCR")}`;
  function checkoutWithContext(url, params) {
    try {
      const out = new URL(url, location.href);
      Object.keys(params || {}).forEach((key) => out.searchParams.set(key, String(params[key])));
      return out.toString();
    } catch (_) { return url; }
  }

  function renderTickets() {
    const host = $("#view-tickets");
    if (!host) return;
    const events = ticketEvents();
    const active = events.find((f) => ticketEventId(f) === activeTicketId) || null;
    const cards = events.map((f) => {
      const t = f.tickets || {};
      return `<article class="ticket-event card ${active === f ? "selected" : ""}">
        ${bannerHTML(f.event, "ticket-banner", f.banner)}
        <div class="ticket-event-body">
          <span class="kicker">${esc(shortDate(f.date))}</span>
          <h3>${esc(f.event)}</h3>
          <p>${esc(f.fighter1)} <b>vs</b> ${esc(f.fighter2)}</p>
          <div class="ticket-meta"><span>${esc(t.venue || "Venue TBA")}</span><span>From ${money(t.price)}</span></div>
          <button class="btn btn-primary" data-ticket-event="${esc(ticketEventId(f))}">${active === f ? "Choosing seats" : "Choose seats"}</button>
        </div>
      </article>`;
    }).join("");

    host.innerHTML = `<section class="section commerce-page">
      <div class="section-head reveal in"><span class="kicker">Live events</span><h1 class="section-title">Fight <span class="hl">Tickets</span></h1>
        <p class="section-sub">${esc((D.commerce && D.commerce.ticketHelp) || "Choose an event and reserve your seats.")}</p></div>
      ${events.length ? `<div class="ticket-events">${cards}</div>` : emptyState("No tickets on sale", "Ticketed events will appear here when sales open.")}
      ${active ? seatPickerHTML(active) : ""}
    </section>`;
  }

  function seatPickerHTML(f) {
    const t = f.tickets || {};
    const rows = seatRows(f);
    const count = Math.max(1, Math.min(30, Number(t.seatsPerRow) || 10));
    const manual = String(t.unavailableSeats || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const unavailable = new Set([...manual, ...reservedSeats]);
    const seats = rows.map((row) => `<div class="seat-row"><span class="seat-row-label">${esc(row)}</span><div class="seat-row-seats">${Array.from({ length: count }, (_, i) => {
      const id = `${row}${i + 1}`;
      const blocked = unavailable.has(id);
      const on = selectedSeats.includes(id);
      return `<button class="seat ${blocked ? "unavailable" : ""} ${on ? "selected" : ""}" data-seat="${esc(id)}" ${blocked ? "disabled" : ""} aria-label="Seat ${esc(id)}">${i + 1}</button>`;
    }).join("")}</div></div>`).join("");
    const total = (Number(t.price) || 0) * selectedSeats.length;
    return `<div class="seat-picker reveal in">
      <div class="seat-picker-head"><div><span class="kicker">${esc(f.event)}</span><h2>Select your seats</h2></div>
        <button class="btn-sm btn-ghost" data-ticket-close>Close map</button></div>
      <div class="arena-screen"><span>ARENA</span></div>
      <div class="seat-map" aria-label="Seat map">${seats}</div>
      <div class="seat-legend"><span><i class="seat-demo"></i>Available</span><span><i class="seat-demo selected"></i>Selected</span><span><i class="seat-demo unavailable"></i>Taken</span></div>
      <div class="ticket-summary">
        <div><span>Seats</span><strong>${selectedSeats.length ? esc(selectedSeats.join(", ")) : "None selected"}</strong></div>
        <div><span>Total</span><strong>${money(total)}</strong></div>
        <button class="btn btn-primary" data-reserve-tickets ${selectedSeats.length ? "" : "disabled"}>${currentUser ? "Reserve & continue" : "Sign in with Discord"}</button>
      </div>
      ${seatsLoading ? `<div class="ticket-status">Checking live availability…</div>` : ""}
      <p class="commerce-note">Seats are held for 15 minutes after reservation. Payment confirmation requires the configured checkout provider.</p>
    </div>`;
  }

  async function loadSeatAvailability(f) {
    reservedSeats = [];
    if (!supa || !f) { seatsLoading = false; renderTickets(); return; }
    seatsLoading = true; renderTickets();
    try {
      const { data, error } = await supa.rpc("get_gfc_reserved_seats", { p_event_id: ticketEventId(f) });
      if (!error && Array.isArray(data)) reservedSeats = data.map((x) => String(x.seat || x).toUpperCase());
    } catch (_) {}
    seatsLoading = false; renderTickets();
  }

  async function reserveSelectedTickets() {
    const f = ticketEvents().find((x) => ticketEventId(x) === activeTicketId);
    if (!f || !selectedSeats.length) return;
    if (!currentUser) { discordSignIn(); return; }
    if (!supa) { toast("Ticket reservations need the cloud connection"); return; }
    const btn = $("[data-reserve-tickets]");
    if (btn) { btn.disabled = true; btn.textContent = "Reserving…"; }
    try {
      const { data, error } = await supa.rpc("reserve_gfc_tickets", { p_event_id: ticketEventId(f), p_seats: selectedSeats });
      if (error) throw error;
      const ref = Array.isArray(data) ? data[0] : data;
      toast(`Seats held · ${String((ref && (ref.booking_ref || ref.id)) || "booking created").slice(0, 18)}`);
      const checkout = (f.tickets && f.tickets.checkoutUrl) || "";
      const bookedSeats = selectedSeats.join(",");
      selectedSeats = [];
      await loadSeatAvailability(f);
      if (checkout) window.open(checkoutWithContext(checkout, {
        booking_ref: (ref && (ref.booking_ref || ref.id)) || "",
        event: ticketEventId(f), seats: bookedSeats
      }), "_blank", "noopener");
    } catch (_) {
      toast("Those seats could not be reserved — refresh and try again");
      await loadSeatAvailability(f);
    }
  }

  /* ============================================ RENDER: MEMBERSHIPS ======== */
  function renderMemberships() {
    const host = $("#view-memberships");
    if (!host) return;
    const plans = Array.isArray(D.membershipPlans) ? D.membershipPlans : [];
    host.innerHTML = `<section class="section commerce-page memberships-page">
      <div class="section-head reveal in"><span class="kicker">Join the corner</span><h1 class="section-title">GFC <span class="hl">Memberships</span></h1>
        <p class="section-sub">${esc((D.commerce && D.commerce.membershipHelp) || "Choose the membership that fits you.")}</p></div>
      ${plans.length ? `<div class="membership-grid">${plans.map((p, i) => `<article class="membership-card card ${p.featured ? "featured-plan" : ""}">
        ${p.featured ? `<span class="plan-badge">Most popular</span>` : ""}
        <span class="kicker">${esc(p.eyebrow || "GFC MEMBER")}</span><h2>${esc(p.name)}</h2>
        <div class="plan-price"><strong>${money(p.price)}</strong><span>${esc(p.period || "one time")}</span></div>
        <p>${esc(p.description || "")}</p>
        <ul>${(Array.isArray(p.perks) ? p.perks : []).map((x) => `<li>${esc(x.text || x)}</li>`).join("")}</ul>
        <button class="btn ${p.featured ? "btn-primary" : "btn-ghost"}" data-buy-membership="${i}">${currentUser ? "Continue to checkout" : "Sign in with Discord"}</button>
      </article>`).join("")}</div>` : emptyState("Memberships coming soon", "Plans will appear here once the league publishes them.")}
    </section>`;
  }

  async function buyMembership(index) {
    const plan = D.membershipPlans[index];
    if (!plan) return;
    if (!currentUser) { discordSignIn(); return; }
    if (!plan.checkoutUrl) { toast("Checkout is not configured for this plan yet"); return; }
    let orderId = "";
    if (supa) {
      try {
        const { data } = await supa.rpc("start_gfc_membership", { p_plan_id: plan.id || slugify(plan.name) });
        orderId = data || "";
      } catch (_) {}
    }
    window.open(checkoutWithContext(plan.checkoutUrl, { membership_order: orderId, plan: plan.id || slugify(plan.name) }), "_blank", "noopener");
  }

  /* ====================================================== MODAL ============ */
  function openFighterModal(name) {
    const f = byName(name); if (!f) return;
    const hist = f.history || [];
    $("#modal .modal-box").innerHTML = `
      <button class="modal-close" aria-label="Close">×</button>
      <div class="modal-hero">
        <div class="ml"><div class="skin-frame"><img src="${skinBody(f.skin || f.username)}" ${onSkinError} alt="${esc(f.username)}"></div></div>
        <div class="mr">
          ${f.champion ? `<div style="margin-bottom:12px"><span class="champ-badge">★ Champion</span></div>` : (rankOf(f.username) ? `<div style="margin-bottom:12px"><span class="kicker">Ranked #${rankOf(f.username)}</span></div>` : `<div style="margin-bottom:12px"><span class="kicker">Unranked</span></div>`)}
          <div class="m-name">${esc(f.username)}</div>
          <div class="m-style">${esc(f.nickname)}</div>
          <p class="m-bio">${esc(f.bio)}</p>
          <div class="m-stats">
            <div class="m-stat"><div class="n w">${f.wins}</div><div class="l2">Wins</div></div>
            <div class="m-stat"><div class="n l">${f.losses}</div><div class="l2">Losses</div></div>
            <div class="m-stat"><div class="n k">${f.koPercent}%</div><div class="l2">KO Rate</div></div>
            <div class="m-stat"><div class="n s">${f.streak > 0 ? "W" + f.streak : "—"}</div><div class="l2">Streak</div></div>
          </div>
        </div>
      </div>
      ${hist.length ? `<div class="modal-history">
        <h4>Fight History</h4>
        ${hist.map((h) => `
          <div class="hist-row">
            <div class="badge ${String(h.result).toLowerCase()}">${esc(h.result)}</div>
            <div class="op">${h.result === "W" ? "def." : "lost to"} ${esc(h.opponent)}</div>
            <div class="mth">${esc(h.method)}</div>
            <div class="ev">${esc(h.event)} · ${esc(h.date)}</div>
          </div>`).join("")}
      </div>` : ""}`;
    showModal();
  }

  // Dedicated full-page fighter profile (route: #fighter=Username).
  function renderFighterProfile(name) {
    const host = $("#view-fighter");
    if (!host) return;
    const f = byName(name);
    if (!f) {
      host.innerHTML = `<section class="section"><div class="fp-back"><button class="btn-sm btn-ghost" data-route="fighters">← Back to roster</button></div>${emptyState("Fighter not found", "This fighter isn't on the roster.")}</section>`;
      return;
    }
    const hist = f.history || [];
    const r = rankOf(f.username);
    const streakTxt = f.streak > 0 ? "W" + f.streak : (f.streak < 0 ? "L" + Math.abs(f.streak) : "—");
    const next = D.upcomingFights.find((x) => x.fighter1 === f.username || x.fighter2 === f.username);
    host.innerHTML = `
      <section class="section fp">
        <div class="fp-back"><button class="btn-sm btn-ghost" data-route="fighters">← Back to roster</button></div>
        <div class="fp-hero">
          <div class="fp-skin"><div class="skin-frame"><img src="${skinBody(f.skin || f.username)}" ${onSkinError} alt="${esc(f.username)}"></div></div>
          <div class="fp-meta">
            ${f.champion ? `<span class="champ-badge">★ Champion</span>` : (r ? `<span class="kicker">Ranked #${r}</span>` : `<span class="kicker">Unranked</span>`)}
            <h1 class="fp-name">${esc(f.username)}</h1>
            ${f.nickname ? `<div class="fp-nick">${esc(f.nickname)}</div>` : ""}
            <div class="fp-record">${rec(f)}<span class="fp-record-l"> W–L</span></div>
            <div class="fp-stats">
              <div class="fp-stat"><div class="n w">${f.wins || 0}</div><div class="l2">Wins</div></div>
              <div class="fp-stat"><div class="n l">${f.losses || 0}</div><div class="l2">Losses</div></div>
              <div class="fp-stat"><div class="n k">${f.koPercent || 0}%</div><div class="l2">KO Rate</div></div>
              <div class="fp-stat"><div class="n s">${streakTxt}</div><div class="l2">Streak</div></div>
            </div>
            ${f.bio ? `<p class="fp-bio">${esc(f.bio)}</p>` : ""}
          </div>
        </div>
        ${next ? `<div class="fp-next"><span class="kicker">Next fight</span><div class="fp-next-row"><b>${esc(next.event || "Upcoming")}</b> — ${esc(next.fighter1)} vs ${esc(next.fighter2)}${next.date ? ` · ${esc(next.date)}` : ""}</div></div>` : ""}
        <div class="fp-history">
          <h3 class="fp-h">Fight History</h3>
          ${hist.length ? hist.map((h) => `
            <div class="hist-row">
              <div class="badge ${String(h.result).toLowerCase()}">${esc(h.result)}</div>
              <div class="op">${h.result === "W" ? "def." : "lost to"} ${esc(h.opponent)}</div>
              <div class="mth">${esc(h.method)}</div>
              <div class="ev">${esc(h.event)}${h.date ? ` · ${esc(h.date)}` : ""}</div>
            </div>`).join("") : `<div class="admin-empty">No fights on record yet.</div>`}
        </div>
      </section>`;
  }

  function openNewsModal(i) {
    const n = D.news[i]; if (!n) return;
    $("#modal .modal-box").innerHTML = `
      <button class="modal-close" aria-label="Close">×</button>
      <div style="padding:44px">
        <span class="tag" style="display:inline-block;font-family:var(--f-pixel);font-size:8px;color:var(--blood);border:1px solid rgba(211,47,47,0.4);padding:6px 8px;border-radius:3px;letter-spacing:0.5px;text-transform:uppercase">${esc(n.tag)}</span>
        <h2 style="font-family:var(--f-display);font-size:clamp(30px,5vw,52px);text-transform:uppercase;line-height:0.95;margin:20px 0 8px">${esc(n.title)}</h2>
        <div style="font-family:var(--f-data);font-size:12px;color:var(--faint);margin-bottom:22px">${esc(n.date)}</div>
        <p style="color:var(--silver);font-size:16px;line-height:1.7">${esc(n.body)}</p>
      </div>`;
    showModal();
  }

  function showModal() {
    const m = $("#modal");
    m.classList.add("open");
    m.scrollTop = 0;
    $(".modal-box", m).scrollTop = 0;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    // Stop any embedded video so audio doesn't keep playing after close.
    const ifr = $("#modal iframe"); if (ifr) ifr.src = "";
    $("#modal").classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ====================================================== ROUTER =========== */
  const VIEWS = ["home", "fighters", "rankings", "history", "videos", "tickets", "memberships", "info"];
  const ROUTES = [...VIEWS, "admin"]; // admin is reachable but not in the nav

  function route(name, push = true) {
    // Dedicated fighter profile — name looks like "fighter=Username".
    if (name.indexOf("fighter=") === 0) {
      const who = decodeURIComponent(name.slice(8));
      renderFighterProfile(who);
      $$(".view").forEach((v) => v.classList.remove("active"));
      $("#view-fighter").classList.add("active");
      $$(".nav-link").forEach((l) => l.classList.remove("active"));
      document.body.classList.remove("in-admin");
      closeMobileNav();
      if (push && location.hash !== "#" + name) {
        try { history.pushState(null, "", "#" + name); } catch (_) {}
      }
      window.scrollTo({ top: 0, behavior: "auto" });
      requestAnimationFrame(() => revealInView($("#view-fighter")));
      stopLivePoll();
      return;
    }
    if (!ROUTES.includes(name)) name = "home";
    if (name === "admin") renderAdmin(); // build/refresh admin before showing it
    $$(".view").forEach((v) => v.classList.remove("active"));
    $("#view-" + name).classList.add("active");
    $$(".nav-link").forEach((l) => l.classList.toggle("active", l.dataset.route === name));
    document.body.classList.toggle("in-admin", name === "admin");
    closeMobileNav();
    // Sync the URL for back-button / deep-linking support. Wrapped in try/catch
    // because sandboxed iframes (about:srcdoc, e.g. some preview panes) forbid
    // pushState and would otherwise throw a SecurityError. Navigation works
    // regardless — route() is driven directly by clicks, not by the URL.
    if (push && location.hash !== "#" + name) {
      try { history.pushState(null, "", "#" + name); } catch (_) { /* sandboxed: ignore */ }
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    // Reveal above-the-fold content of the newly shown view, keep the rest for scroll.
    requestAnimationFrame(() => revealInView($("#view-" + name)));
    // Kick off view-specific behaviors.
    if (name === "home") { startCountdown(); animateCounters(); }
    if (name === "videos") { startVideoCountdown(); startLivePoll(); } else { stopLivePoll(); }
    if (name === "tickets") renderTickets();
    if (name === "memberships") renderMemberships();
  }

  // Re-render every public view (used after admin edits are saved).
  function renderAll() {
    renderChrome();
    renderHome();
    renderFighters();
    renderRankings();
    renderHistory();
    renderVideos();
    renderTickets();
    renderMemberships();
    renderInfo();
    countersDone = false; // allow the stats to re-animate with new numbers
  }

  // Global click delegation for routing + interactions.
  document.addEventListener("click", (e) => {
    const login = e.target.closest("[data-discord-login]");
    if (login) { discordSignIn(); return; }
    const logout = e.target.closest("[data-public-logout]");
    if (logout) { publicSignOut(); return; }

    const ticketEvent = e.target.closest("[data-ticket-event]");
    if (ticketEvent) {
      activeTicketId = ticketEvent.dataset.ticketEvent;
      selectedSeats = [];
      reservedSeats = [];
      const f = ticketEvents().find((x) => ticketEventId(x) === activeTicketId);
      renderTickets(); loadSeatAvailability(f); return;
    }
    if (e.target.closest("[data-ticket-close]")) { activeTicketId = ""; selectedSeats = []; reservedSeats = []; renderTickets(); return; }
    const seat = e.target.closest("[data-seat]");
    if (seat && !seat.disabled) {
      const id = seat.dataset.seat;
      selectedSeats = selectedSeats.includes(id) ? selectedSeats.filter((x) => x !== id) : [...selectedSeats, id].slice(0, 8);
      renderTickets(); return;
    }
    if (e.target.closest("[data-reserve-tickets]")) { reserveSelectedTickets(); return; }
    const membership = e.target.closest("[data-buy-membership]");
    if (membership) { buyMembership(+membership.dataset.buyMembership); return; }

    const routeEl = e.target.closest("[data-route]");
    if (routeEl) { e.preventDefault(); route(routeEl.dataset.route); return; }

    const fighterEl = e.target.closest("[data-fighter]");
    if (fighterEl) { route("fighter=" + encodeURIComponent(fighterEl.dataset.fighter)); return; }

    const newsEl = e.target.closest("[data-news]");
    if (newsEl) { openNewsModal(+newsEl.dataset.news); return; }

    const videoEl = e.target.closest("[data-video]");
    if (videoEl) { openVideoModal(videoEl.dataset.video); return; }

    const liveEl = e.target.closest("[data-watch-live]");
    if (liveEl) { watchLive(); return; }

    const caroBtn = e.target.closest("[data-caro]");
    if (caroBtn) { scrollCarousel(caroBtn.dataset.caro); return; }

    const tl = e.target.closest(".tl-item");
    if (tl) { tl.classList.toggle("open"); return; }

    const faq = e.target.closest(".faq-item");
    if (faq) { faq.classList.toggle("open"); return; }

    if (e.target.closest(".modal-close")) { closeModal(); return; }
    if (e.target.id === "modal") { closeModal(); return; } // click backdrop
  });

  // Keyboard: Enter/Space activates cards; Esc closes modal.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if ((e.key === "Enter" || e.key === " ") && document.activeElement) {
      const el = document.activeElement;
      if (el.dataset && el.dataset.fighter) { e.preventDefault(); route("fighter=" + encodeURIComponent(el.dataset.fighter)); }
      if (el.dataset && el.dataset.video != null) { e.preventDefault(); openVideoModal(el.dataset.video); }
    }
  });

  window.addEventListener("popstate", () => route((location.hash || "#home").slice(1), false));

  /* ====================================================== MOBILE NAV ======= */
  function toggleMobileNav() {
    $("#navLinks").classList.toggle("open");
    $("#navToggle").classList.toggle("open");
  }
  function closeMobileNav() {
    $("#navLinks").classList.remove("open");
    $("#navToggle").classList.remove("open");
  }

  /* ====================================================== PARTICLES ======== */
  // Square "lava embers" drifting upward — the Minecraft-flavored signature.
  function initEmbers() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cv = $("#emberCanvas"), ctx = cv.getContext("2d");
    let w, h, embers = [];
    const COLORS = ["#d32f2f", "#ff5a2c", "#ff8a3d", "#7a1414"];

    function resize() {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
      const count = Math.min(70, Math.floor(w / 22));
      embers = Array.from({ length: count }, spawn);
    }
    function spawn() {
      const size = 2 + Math.random() * 4; // small square pixels
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        s: Math.round(size),
        vy: 0.25 + Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 0.35,
        a: 0.15 + Math.random() * 0.55,
        tw: Math.random() * Math.PI * 2,
        c: COLORS[(Math.random() * COLORS.length) | 0],
      };
    }
    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const e of embers) {
        e.y -= e.vy; e.x += e.vx; e.tw += 0.05;
        if (e.y < -8) { e.y = h + 8; e.x = Math.random() * w; }
        const flick = e.a * (0.6 + 0.4 * Math.sin(e.tw));
        ctx.globalAlpha = flick;
        ctx.fillStyle = e.c;
        ctx.fillRect(e.x | 0, e.y | 0, e.s, e.s); // square = pixel ember
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    resize();
    window.addEventListener("resize", resize);
    tick();
  }

  /* ====================================================== COUNTDOWN ======== */
  let cdTimer = null;
  function startCountdown() {
    clearInterval(cdTimer);
    const main = D.upcomingFights.find((f) => f.main) || D.upcomingFights[0];
    if (!main || !main.date) return; // nothing scheduled — no countdown to run
    const target = new Date(main.date).getTime();
    if (isNaN(target)) return;
    const set = (u, v) => { const el = document.querySelector(`[data-cd="${u}"]`); if (el) el.textContent = String(v).padStart(2, "0"); };
    function upd() {
      const diff = target - Date.now();
      if (diff <= 0) { ["Days","Hrs","Min","Sec"].forEach((u) => set(u, 0)); clearInterval(cdTimer); return; }
      const d = Math.floor(diff / 864e5);
      const hrs = Math.floor((diff % 864e5) / 36e5);
      const min = Math.floor((diff % 36e5) / 6e4);
      const sec = Math.floor((diff % 6e4) / 1e3);
      set("Days", d); set("Hrs", hrs); set("Min", min); set("Sec", sec);
    }
    upd();
    cdTimer = setInterval(upd, 1000);
  }

  /* ====================================================== COUNTERS ========= */
  // Count-up animation for the stats strip (runs once when Home shows).
  let countersDone = false;
  function animateCounters() {
    if (countersDone) return; countersDone = true;
    $$("[data-count]").forEach((el) => {
      const end = +el.dataset.count; const dur = 1400; const t0 = performance.now();
      (function step(now) {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      })(performance.now());
    });
  }

  /* ====================================================== SEARCH =========== */
  document.addEventListener("input", (e) => {
    if (e.target.id !== "fighterSearch") return;
    const q = e.target.value.trim().toLowerCase();
    const list = D.fighters.filter((f) =>
      f.username.toLowerCase().includes(q) || (f.nickname || "").toLowerCase().includes(q));
    drawRoster(list);
    $("#rosterCount").textContent = `${list.length} fighter${list.length === 1 ? "" : "s"}`;
  });

  /* ====================================================== REVEAL =========== */
  let io;
  function initReveal() {
    if (typeof IntersectionObserver === "undefined") { io = null; return; }
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  }
  // Observe reveal elements in a view; instantly reveal ones already on screen.
  function revealInView(view) {
    $$(".reveal", view).forEach((el) => {
      if (el.classList.contains("in")) return;
      if (!io) { el.classList.add("in"); return; } // no observer support → just show it
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.92) el.classList.add("in");
      else io.observe(el);
    });
  }

  /* ====================================================== NAV SCROLL ======= */
  function initNavScroll() {
    const nav = $("#nav");
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ====================================================== VIDEOS =========== */
  /* The media hub (Videos page). Fully data-driven from D.livestream + D.videos
     so new recordings appear just by adding data (admin › Videos) — the layout
     never needs editing. Supports embedded YouTube livestreams and recordings. */

  // Search / sort / filter state for the archive (search filters instantly).
  const videoFilters = { q: "", sort: "newest", year: "", event: "" };

  // Live status. `active` is the manual flag; optional auto-detect can flip
  // liveAuto when a YouTube API key + channel are configured.
  let liveAuto = null;        // null = using manual flag; true/false = API result
  let livePollTimer = null;
  let vCdTimer = null;

  function liveInfo() {
    const ls = D.livestream || {};
    const active = liveAuto === null ? !!ls.active : (liveAuto || !!ls.active);
    return { ...ls, active };
  }

  // --- YouTube helpers ---
  function ytThumb(id, custom) { return custom ? custom : (id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : ""); }
  const ytThumbFallback = `onerror="this.onerror=null;this.style.display='none';this.parentNode.classList.add('no-thumb')"`;
  function liveEmbedSrc(ls) {
    if (ls.youtubeId) return `https://www.youtube.com/embed/${encodeURIComponent(ls.youtubeId)}?autoplay=1&rel=0`;
    if (ls.channelId) return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(ls.channelId)}&autoplay=1`;
    return "";
  }
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso); if (isNaN(d)) return "";
    return d.toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  }
  function fmtViews(v) {
    if (v === "" || v == null) return "";
    const n = Number(v); return isNaN(n) ? String(v) : n.toLocaleString("en-US");
  }

  // --- Featured / live block ---
  function featuredBlockHTML() {
    const ls = liveInfo();
    if (ls.active) {
      const thumb = ytThumb(ls.youtubeId, ls.thumbnail);
      const viewers = fmtViews(ls.viewers), started = fmtTime(ls.startedAt);
      return `
        <div class="live-wrap reveal in">
          <div class="live-player" id="livePlayer" data-src="${esc(liveEmbedSrc(ls))}">
            ${thumb ? `<img class="live-thumb" src="${esc(thumb)}" ${ytThumbFallback} alt="">` : ""}
            <button class="live-play" data-watch-live aria-label="Play live stream"><span class="tri"></span></button>
            <span class="live-badge"><span class="live-dot"></span>LIVE NOW</span>
            <span class="live-ring" aria-hidden="true"></span>
          </div>
          <div class="live-meta">
            <div class="live-kicker">Broadcasting now</div>
            <h2 class="live-title">${esc(ls.title || "Live Broadcast")}</h2>
            <div class="live-facts">
              ${viewers ? `<span class="lf"><span class="lf-i">◉</span>${viewers} watching</span>` : ""}
              ${started ? `<span class="lf"><span class="lf-i">◷</span>Started ${esc(started)}</span>` : ""}
            </div>
            <button class="btn btn-primary live-cta" data-watch-live>Watch Live <span class="arrow">→</span></button>
          </div>
        </div>`;
    }
    // Offline — placeholder + next scheduled fight with countdown.
    const main = D.upcomingFights.find((f) => f.main) || D.upcomingFights[0];
    const nextBlock = (main && main.date) ? `
      <div class="next-event reveal">
        <div class="ne-kicker">Next scheduled event</div>
        <div class="ne-title">${esc(main.event || "Upcoming fight")}</div>
        ${(main.fighter1 || main.fighter2) ? `<div class="ne-vs">${esc(main.fighter1 || "TBD")} <em>vs</em> ${esc(main.fighter2 || "TBD")}</div>` : ""}
        <div class="ne-countdown" id="vCountdown">
          ${["Days","Hrs","Min","Sec"].map((u) => `<div class="cd-unit"><div class="num" data-vcd="${u}">--</div><div class="lbl">${u}</div></div>`).join("")}
        </div>
      </div>` : `
      <div class="next-event ne-empty reveal">
        <div class="ne-kicker">Next scheduled event</div>
        <p class="ne-none">No upcoming events booked yet — check back soon.</p>
      </div>`;
    return `
      <div class="live-off reveal in">
        <div class="off-plate">
          ${logoImg("off-logo")}
          <div class="off-title">No live event currently</div>
          <div class="off-sub">When GFC goes live, the broadcast pins here automatically.</div>
        </div>
        ${nextBlock}
      </div>`;
  }

  // --- Featured Events carousel ---
  function carouselHTML() {
    const feat = D.videos.filter((v) => v.featured);
    if (!feat.length) return "";
    return `
      <section class="section vsection">
        <div class="section-head reveal">
          <span class="kicker">The Vault</span>
          <h2 class="section-title">Featured <span class="hl">Events</span></h2>
        </div>
        <div class="caro-wrap reveal">
          <button class="caro-arrow left" data-caro="left" aria-label="Scroll left">‹</button>
          <div class="caro-track" id="caroTrack">${feat.map((v) => vcardHTML(v, true)).join("")}</div>
          <button class="caro-arrow right" data-caro="right" aria-label="Scroll right">›</button>
        </div>
      </section>`;
  }
  function scrollCarousel(dir) {
    const t = $("#caroTrack"); if (!t) return;
    t.scrollBy({ left: dir === "left" ? -t.clientWidth * 0.8 : t.clientWidth * 0.8, behavior: "smooth" });
  }

  // --- Recording card ---
  function vcardHTML(v, isCaro = false) {
    const id = D.videos.indexOf(v);
    const thumb = ytThumb(v.youtubeId, v.thumbnail);
    return `
      <article class="vcard ${isCaro ? "vcard-caro" : "reveal"}" data-video="${id}" role="button" tabindex="0" aria-label="Play ${esc(v.title || "video")}">
        <div class="vthumb">
          ${thumb ? `<img src="${esc(thumb)}" ${ytThumbFallback} loading="lazy" alt="">` : ""}
          <span class="vplay"><span class="tri"></span></span>
          ${v.duration ? `<span class="vdur">${esc(v.duration)}</span>` : ""}
          ${v.category ? `<span class="vcat">${esc(v.category)}</span>` : ""}
        </div>
        <div class="vbody">
          <h3 class="vtitle">${esc(v.title || "Untitled")}</h3>
          <div class="vmeta">
            ${v.date ? `<span>${esc(v.date)}</span>` : ""}
            ${(v.views !== "" && v.views != null && v.views !== 0) ? `<span>· ${fmtViews(v.views)} views</span>` : ""}
          </div>
          ${v.description ? `<p class="vdesc">${esc(v.description)}</p>` : ""}
          <span class="vwatch">Watch <span class="arrow">→</span></span>
        </div>
      </article>`;
  }

  // --- Archive filter / sort ---
  function filteredVideos() {
    const f = videoFilters;
    let list = D.videos.slice();
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter((v) => [v.title, v.description, v.event, v.category].some((s) => String(s || "").toLowerCase().includes(q)));
    }
    if (f.year)  list = list.filter((v) => String(v.date || "").includes(f.year));
    if (f.event) list = list.filter((v) => v.event === f.event);
    const num = (x) => Number(x) || 0;
    const time = (v) => { const t = new Date(v.date).getTime(); return isNaN(t) ? 0 : t; };
    if (f.sort === "newest")      list.sort((a, b) => time(b) - time(a));
    else if (f.sort === "oldest") list.sort((a, b) => time(a) - time(b));
    else if (f.sort === "views")  list.sort((a, b) => num(b.views) - num(a.views));
    return list;
  }
  function yearsInVideos() {
    const yrs = new Set();
    D.videos.forEach((v) => { const m = String(v.date || "").match(/\d{4}/); if (m) yrs.add(m[0]); });
    return [...yrs].sort((a, b) => b - a);
  }
  function eventsInVideos() {
    const evs = new Set();
    D.videos.forEach((v) => { if (v.event) evs.add(v.event); });
    return [...evs].sort();
  }
  function toolbarHTML() {
    const years = yearsInVideos(), events = eventsInVideos();
    return `
      <div class="v-toolbar reveal">
        <div class="v-search">
          <span class="v-search-i">⌕</span>
          <input type="search" id="videoSearch" placeholder="Search broadcasts…" value="${esc(videoFilters.q)}" autocomplete="off">
        </div>
        <div class="v-selects">
          <select id="videoSort" aria-label="Sort recordings">
            <option value="newest" ${videoFilters.sort==="newest"?"selected":""}>Newest first</option>
            <option value="oldest" ${videoFilters.sort==="oldest"?"selected":""}>Oldest first</option>
            <option value="views"  ${videoFilters.sort==="views"?"selected":""}>Most viewed</option>
          </select>
          <select id="videoYear" aria-label="Filter by year">
            <option value="">All years</option>
            ${years.map((y) => `<option ${videoFilters.year===y?"selected":""}>${y}</option>`).join("")}
          </select>
          <select id="videoEvent" aria-label="Filter by event">
            <option value="">All events</option>
            ${events.map((ev) => `<option ${videoFilters.event===ev?"selected":""}>${esc(ev)}</option>`).join("")}
          </select>
        </div>
      </div>`;
  }
  function drawRecordings(list) {
    const grid = $("#vGrid"); if (!grid) return;
    const count = $("#vCount"); if (count) count.textContent = `${list.length} broadcast${list.length===1?"":"s"}`;
    grid.innerHTML = list.length
      ? list.map((v) => vcardHTML(v)).join("")
      : emptyState("No broadcasts found", D.videos.length ? "Try clearing the search or filters." : "Recordings you add in the admin panel will appear here.");
    requestAnimationFrame(() => revealInView($("#view-videos")));
  }
  function applyVideoFilters() { drawRecordings(filteredVideos()); }

  // --- Main render ---
  function renderVideos() {
    const host = $("#view-videos"); if (!host) return;
    host.innerHTML = `
      <section class="section v-hero-sec">
        <div class="section-head reveal">
          <span class="kicker">GFC Media</span>
          <h1 class="section-title">The <span class="hl">Broadcast</span> Hub</h1>
        </div>
        ${featuredBlockHTML()}
      </section>
      ${carouselHTML()}
      <section class="section vsection">
        <div class="section-head reveal" style="margin-bottom:22px">
          <span class="kicker">The Archive</span>
          <h2 class="section-title">Past <span class="hl">Broadcasts</span></h2>
          <div class="v-count" id="vCount"></div>
        </div>
        ${toolbarHTML()}
        <div class="v-grid" id="vGrid"></div>
      </section>`;
    drawRecordings(filteredVideos());
  }

  // --- Video modal (embedded player) ---
  function openVideoModal(idx) {
    const v = D.videos[+idx]; if (!v) return;
    const src = v.youtubeId ? `https://www.youtube.com/embed/${encodeURIComponent(v.youtubeId)}?autoplay=1&rel=0` : "";
    $("#modal .modal-box").innerHTML = `
      <button class="modal-close" aria-label="Close">×</button>
      <div class="vmodal">
        <div class="vmodal-player">
          ${src ? `<iframe src="${src}" title="${esc(v.title)}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>` : `<div class="vmodal-noembed">No video linked to this broadcast yet.</div>`}
        </div>
        <div class="vmodal-info">
          ${v.category ? `<span class="vmodal-cat">${esc(v.category)}</span>` : ""}
          <h2>${esc(v.title || "Untitled")}</h2>
          <div class="vmodal-meta">
            ${v.date ? `<span>${esc(v.date)}</span>` : ""}
            ${v.duration ? `<span>· ${esc(v.duration)}</span>` : ""}
            ${(v.views!=="" && v.views!=null && v.views!==0) ? `<span>· ${fmtViews(v.views)} views</span>` : ""}
            ${v.event ? `<span>· ${esc(v.event)}</span>` : ""}
          </div>
          ${v.description ? `<p>${esc(v.description)}</p>` : ""}
        </div>
      </div>`;
    showModal();
  }
  // Live "Watch" — swap the poster for the live iframe in place.
  function watchLive() {
    const p = $("#livePlayer");
    if (p && p.dataset.src && !$("iframe", p)) {
      p.innerHTML = `<iframe src="${p.dataset.src}" title="Live stream" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        <span class="live-badge"><span class="live-dot"></span>LIVE NOW</span>`;
    }
  }

  // --- Offline countdown (scoped to the Videos page) ---
  function startVideoCountdown() {
    clearInterval(vCdTimer);
    if (liveInfo().active) return;
    const main = D.upcomingFights.find((f) => f.main) || D.upcomingFights[0];
    if (!main || !main.date) return;
    const target = new Date(main.date).getTime(); if (isNaN(target)) return;
    const set = (u, val) => { const el = document.querySelector(`[data-vcd="${u}"]`); if (el) el.textContent = String(val).padStart(2, "0"); };
    const upd = () => {
      const diff = target - Date.now();
      if (diff <= 0) { ["Days","Hrs","Min","Sec"].forEach((u) => set(u, 0)); clearInterval(vCdTimer); return; }
      set("Days", Math.floor(diff/864e5)); set("Hrs", Math.floor((diff%864e5)/36e5));
      set("Min", Math.floor((diff%36e5)/6e4)); set("Sec", Math.floor((diff%6e4)/1e3));
    };
    upd(); vCdTimer = setInterval(upd, 1000);
  }

  // --- Optional live auto-detection (progressive enhancement) ---
  // Runs ONLY if a YouTube Data API key + channel ID are configured; otherwise
  // the manual "active" flag drives everything. Never throws on failure.
  function startLivePoll() {
    stopLivePoll();
    const ls = D.livestream || {};
    if (!ls.apiKey || !ls.channelId) return; // no key → manual flag only
    const poll = async () => {
      try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(ls.channelId)}&eventType=live&type=video&key=${encodeURIComponent(ls.apiKey)}`;
        const res = await fetch(url); if (!res.ok) return;
        const data = await res.json();
        const item = data.items && data.items[0];
        const wasActive = liveInfo().active;
        liveAuto = !!item;
        if (item && item.id && item.id.videoId) D.livestream.youtubeId = item.id.videoId;
        if (item && item.snippet && item.snippet.title && !D.livestream.title) D.livestream.title = item.snippet.title;
        if (liveInfo().active !== wasActive) renderVideos();
      } catch (_) { /* offline / blocked / quota — keep manual flag */ }
    };
    poll();
    livePollTimer = setInterval(poll, 60000);
  }
  function stopLivePoll() { if (livePollTimer) { clearInterval(livePollTimer); livePollTimer = null; } }

  // Instant search + filter/sort wiring (delegated, attached once).
  document.addEventListener("input", (e) => {
    if (e.target.id === "videoSearch") { videoFilters.q = e.target.value.trim(); applyVideoFilters(); }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "videoSort")  { videoFilters.sort  = e.target.value; applyVideoFilters(); }
    if (e.target.id === "videoYear")  { videoFilters.year  = e.target.value; applyVideoFilters(); }
    if (e.target.id === "videoEvent") { videoFilters.event = e.target.value; applyVideoFilters(); }
  });

  /* ====================================================== ADMIN PANEL ====== */
  /* A password-gated content manager. It edits the SAME data object (D) that
     the public site renders from, saves changes to the browser (localStorage),
     refreshes the live site instantly, and can EXPORT a fresh data.js for
     backup or deployment.

     SECURITY NOTE: the password check happens in the browser, so anyone who
     digs through the page source can read it. It keeps casual visitors out of
     the editor — it is NOT real security. For true access control the site
     would need a server. */

  const ADMIN_PW = "5LiXFCZy8Qxy3o7nGpce";

  let adminAuthed = false;
  try { adminAuthed = sessionStorage.getItem("gfc_admin_ok") === "1"; } catch (_) {}

  let adminTab  = "fighters";
  let adminForm = null;   // { schemaId, index, draft }  · index -1 = new item
  let resultForm = null;  // { fightIndex, draft } while logging a scheduled fight's result
  let infoDraft = null;   // working copy of D.info while the Info tab is open
  let setDraft  = null;   // working copy of settings while the Settings tab is open
  let liveDraft = null;   // working copy of D.livestream while the Livestream tab is open

  // Tabs across the top of the panel: [id, label].
  const ADMIN_TABS = [
    ["fighters",   "Fighters"],
    ["fights",     "Upcoming"],
    ["rankings",   "Rankings"],
    ["history",    "Results"],
    ["news",       "News"],
    ["hallOfFame", "Hall of Fame"],
    ["posters",    "Posters"],
    ["sponsors",   "Sponsors"],
    ["memberships","Memberships"],
    ["videos",     "Videos"],
    ["livestream", "Livestream"],
    ["info",       "Info Text"],
    ["settings",   "Settings"]
  ];

  // Schemas drive the list + add/edit form for each simple collection.
  const ADMIN_SCHEMAS = {
    fighters: {
      label: "Fighters", coll: "fighters",
      title: (x) => x.username || "New fighter",
      blank: () => ({ username:"", skin:"", nickname:"", wins:0, losses:0, koPercent:0, streak:0, champion:false, bio:"", history:[] }),
      fields: [
        { key:"username",  label:"Username (Minecraft name)", type:"text", hint:"Their skin is drawn from this name." },
        { key:"skin",      label:"Skin name (optional)", type:"text", hint:"Leave blank to use the username." },
        { key:"nickname",  label:"Nickname", type:"text", hint:"e.g. “The Reaper” — shown under their name." },
        { key:"wins",      label:"Wins (optional starting record)", type:"number", hint:"Leave at 0 to build the record automatically from logged fights. Fill it in to seed an existing record." },
        { key:"losses",    label:"Losses (optional)", type:"number" },
        { key:"koPercent", label:"KO rate % (optional)", type:"number", hint:"Auto-recalculated as you log KO wins." },
        { key:"streak",    label:"Current streak (+ win / − loss, optional)", type:"number" },
        { key:"champion",  label:"Reigning champion", type:"bool", hint:"Usually set from the Rankings tab instead." },
        { key:"bio",       label:"Bio", type:"textarea" },
        { key:"history",   label:"Fight history (auto-filled when you log results)", type:"rows",
          blank: () => ({ result:"W", opponent:"", method:"KO", event:"", date:"" }),
          cols: [
            { key:"result",   label:"Result", type:"select", options:["W","L"] },
            { key:"opponent", label:"Opponent", type:"text" },
            { key:"method",   label:"Method", type:"select", options:["KO","Decision","Forfeit"] },
            { key:"event",    label:"Event", type:"text" },
            { key:"date",     label:"Date", type:"text", hint:"e.g. 2026-05-10" }
          ] }
      ]
    },
    fights: {
      label: "Upcoming fights", coll: "upcomingFights",
      title: (x) => x.event || "New fight",
      blank: () => ({ event:"", belt:"", fighter1:"", fighter2:"", date:"", time:"", main:false, banner:"", ticketId:"", tickets:{ enabled:false, venue:"", rows:"A,B,C,D,E,F", seatsPerRow:10, price:0, unavailableSeats:"", checkoutUrl:"" } }),
      fields: [
        { key:"event",    label:"Event name", type:"text" },
        { key:"belt",     label:"Belt / stakes (optional)", type:"text" },
        { key:"fighter1", label:"Fighter 1", type:"fighter", hint:"Choose a registered fighter (add them in the Fighters tab first)." },
        { key:"fighter2", label:"Fighter 2", type:"fighter" },
        { key:"date",     label:"Date", type:"text", hint:"YYYY-MM-DD — the main event drives the countdown." },
        { key:"time",     label:"Time (optional)", type:"text", hint:"e.g. 8:00 PM EST" },
        { key:"main",     label:"Main event (drives the home-page countdown)", type:"bool" },
        { key:"banner",   label:"Event banner", type:"image", folder:"banners" },
        { key:"ticketId", label:"Ticket event ID (optional)", type:"text", hint:"Stable internal ID. Leave blank on a new event and it will be generated when saved." },
        { key:"tickets", label:"Ticket sales", type:"group", fields:[
          { key:"enabled", label:"Tickets on sale", type:"bool" },
          { key:"venue", label:"Venue / arena", type:"text" },
          { key:"rows", label:"Seat rows", type:"text", hint:"Comma-separated, e.g. A,B,C,D,E,F" },
          { key:"seatsPerRow", label:"Seats per row", type:"number" },
          { key:"price", label:"Price per seat", type:"number" },
          { key:"unavailableSeats", label:"Manually unavailable seats", type:"text", hint:"Comma-separated, e.g. A1,A2,F10" },
          { key:"checkoutUrl", label:"Checkout URL", type:"text", hint:"Your Stripe/PayPal/other hosted checkout link." }
        ] }
      ]
    },
    history: {
      label: "Past results", coll: "history",
      title: (x) => x.event || "New result",
      blank: () => ({ event:"", date:"", winner:"", loser:"", method:"KO", details:"", banner:"" }),
      fields: [
        { key:"event",   label:"Event name", type:"text" },
        { key:"date",    label:"Date", type:"text", hint:"YYYY-MM-DD" },
        { key:"winner",  label:"Winner", type:"fighter", hint:"Choose a registered fighter." },
        { key:"loser",   label:"Loser", type:"fighter" },
        { key:"method",  label:"Method", type:"select", options:["KO","Decision","Forfeit"] },
        { key:"details", label:"Details (optional)", type:"textarea" },
        { key:"banner",  label:"Event banner", type:"image", folder:"banners" }
      ]
    },
    news: {
      label: "News", coll: "news",
      title: (x) => x.title || "New post",
      blank: () => ({ tag:"", title:"", date:"", excerpt:"", body:"" }),
      fields: [
        { key:"tag",     label:"Tag / category", type:"text" },
        { key:"title",   label:"Headline", type:"text" },
        { key:"date",    label:"Date", type:"text" },
        { key:"excerpt", label:"Short excerpt (shown on the card)", type:"textarea" },
        { key:"body",    label:"Full story", type:"textarea" }
      ]
    },
    hallOfFame: {
      label: "Hall of Fame", coll: "hallOfFame",
      title: (x) => x.username || "New inductee",
      blank: () => ({ username:"", skin:"", year:"", note:"" }),
      fields: [
        { key:"username", label:"Username", type:"text" },
        { key:"skin",     label:"Skin name (optional)", type:"text" },
        { key:"year",     label:"Year inducted", type:"text" },
        { key:"note",     label:"Note", type:"textarea" }
      ]
    },
    posters: {
      label: "Event posters", coll: "posters",
      title: (x) => x.event || "New poster",
      blank: () => ({ event:"", subtitle:"", a:"", b:"", date:"", banner:"" }),
      fields: [
        { key:"event",    label:"Event name", type:"text" },
        { key:"subtitle", label:"Subtitle", type:"text" },
        { key:"a",        label:"Fighter A", type:"fighter", hint:"Both must be on the roster to appear." },
        { key:"b",        label:"Fighter B", type:"fighter" },
        { key:"date",     label:"Date", type:"text" },
        { key:"banner",   label:"Event banner", type:"image", folder:"banners" }
      ]
    },
    sponsors: {
      label: "Sponsors", coll: "sponsors",
      title: (x) => x.name || "New sponsor",
      blank: () => ({ name:"", logo:"" }),
      fields: [
        { key:"name", label:"Sponsor name", type:"text" },
        { key:"logo", label:"Logo image", type:"image", folder:"sponsors" }
      ]
    },
    memberships: {
      label: "Membership plans", coll: "membershipPlans",
      title: (x) => x.name || "New membership",
      blank: () => ({ id:"", eyebrow:"GFC MEMBER", name:"", price:0, period:"per month", description:"", perks:[], checkoutUrl:"", featured:false }),
      fields: [
        { key:"id", label:"Plan ID", type:"text", hint:"Stable ID used for orders, e.g. contender." },
        { key:"eyebrow", label:"Small label", type:"text" },
        { key:"name", label:"Plan name", type:"text" },
        { key:"price", label:"Price", type:"number" },
        { key:"period", label:"Billing period", type:"text", hint:"e.g. per month or one time" },
        { key:"description", label:"Description", type:"textarea" },
        { key:"perks", label:"Benefits", type:"rows", blank:() => ({ text:"" }), cols:[{ key:"text", label:"Benefit", type:"text" }] },
        { key:"checkoutUrl", label:"Checkout URL", type:"text" },
        { key:"featured", label:"Feature this plan", type:"bool" }
      ]
    },
    videos: {
      label: "Video recordings", coll: "videos",
      title: (x) => x.title || "New recording",
      blank: () => ({ title:"", youtubeId:"", date:"", duration:"", description:"", event:"", views:0, category:"", featured:false }),
      fields: [
        { key:"title",       label:"Title", type:"text" },
        { key:"youtubeId",   label:"YouTube video ID", type:"text", hint:"The part after watch?v= — e.g. dQw4w9WgXcQ" },
        { key:"date",        label:"Date", type:"text", hint:"YYYY-MM-DD (used for sorting + the year filter)" },
        { key:"duration",    label:"Duration", type:"text", hint:"e.g. 1:24:30" },
        { key:"event",       label:"Event", type:"text", hint:"Groups it under the event filter." },
        { key:"category",    label:"Category", type:"select", options:["","Championship","Historic","Highlights","Full Event"] },
        { key:"views",       label:"View count", type:"number" },
        { key:"featured",    label:"Show in Featured Events carousel", type:"bool" },
        { key:"description", label:"Short description", type:"textarea" }
      ]
    }
  };

  // ---- Path helpers (draft mutation) ----------------------------------------
  const isIdx = (k) => /^\d+$/.test(k);
  function getByPath(obj, path) {
    if (!path) return obj;
    return path.split(".").reduce((o, k) => (o == null ? o : o[isIdx(k) ? +k : k]), obj);
  }
  function setByPath(obj, path, val) {
    const parts = path.split(".");
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]; o = o[isIdx(k) ? +k : k]; if (o == null) return;
    }
    const last = parts[parts.length - 1];
    o[isIdx(last) ? +last : last] = val;
  }
  // Which draft object do live [data-path] inputs write into right now?
  function activeDraft() {
    if (adminTab === "info")     return infoDraft;
    if (adminTab === "settings") return setDraft;
    if (adminTab === "livestream") return liveDraft;
    if (resultForm)              return resultForm.draft;
    if (adminForm)               return adminForm.draft;
    return null;
  }

  // ---- Field engine ---------------------------------------------------------
  function fieldHTML(f, value, path) {
    const v = value == null ? "" : value;
    const hint = f.hint ? `<span class="afield-hint">${esc(f.hint)}</span>` : "";
    if (f.type === "textarea")
      return `<label class="afield"><span class="afield-label">${esc(f.label)}</span>${hint}<textarea data-path="${path}" rows="3">${esc(v)}</textarea></label>`;
    if (f.type === "bool")
      return `<label class="afield afield-bool"><input type="checkbox" data-path="${path}" ${v ? "checked" : ""}><span>${esc(f.label)}</span></label>`;
    if (f.type === "select")
      return `<label class="afield"><span class="afield-label">${esc(f.label)}</span>${hint}<select data-path="${path}">${f.options.map((o) => `<option ${String(v) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    if (f.type === "fighter") {
      const names = D.fighters.map((x) => x.username);
      const onRoster = names.includes(v);
      return `<label class="afield"><span class="afield-label">${esc(f.label)}</span>${hint}<select data-path="${path}">`
        + `<option value="">${names.length ? "— select a fighter —" : "— register a fighter first —"}</option>`
        + names.map((n) => `<option ${v === n ? "selected" : ""}>${esc(n)}</option>`).join("")
        + ((!onRoster && v) ? `<option value="${esc(v)}" selected>${esc(v)} (not on roster)</option>` : "")
        + `</select></label>`;
    }
    if (f.type === "image") {
      const url = v;
      const prev = url ? `<div class="img-preview"><img src="${esc(url)}" alt=""></div>` : "";
      if (!cloudEnabled()) {
        return `<div class="afield"><span class="afield-label">${esc(f.label)}</span>${prev}`
          + `<span class="afield-hint">Uploads need the cloud connection. Without it, drop a file in <code>assets/${esc(f.folder || "")}</code> named after the item (see that folder's README).</span></div>`;
      }
      return `<div class="afield"><span class="afield-label">${esc(f.label)}</span>`
        + `<div class="img-field">${prev}`
        + `<label class="img-upload">${url ? "Replace image" : "Upload image"}<input type="file" accept="image/*" data-upload="${path}" data-folder="${esc(f.folder || "media")}"></label>`
        + (url ? `<button type="button" class="btn-xs btn-danger" data-imgrm="${path}" data-url="${esc(url)}">Remove</button>` : "")
        + `<span class="img-status" id="imgst-${slugify(path)}"></span></div>`
        + `<span class="afield-hint">${url ? "Uploaded. Picking a new file keeps the old one and uses the newest." : "PNG or JPG, up to 5 MB."}</span></div>`;
    }
    if (f.type === "group") {
      const obj = value && typeof value === "object" ? value : {};
      return `<fieldset class="afield-group"><legend>${esc(f.label)}</legend>${(f.fields || []).map((sub) => fieldHTML(sub, obj[sub.key], `${path}.${sub.key}`)).join("")}</fieldset>`;
    }
    if (f.type === "rows")
      return rowsHTML(f, Array.isArray(value) ? value : [], path);
    const t = f.type === "number" ? "number" : "text";
    return `<label class="afield"><span class="afield-label">${esc(f.label)}</span>${hint}<input type="${t}" data-path="${path}" value="${esc(v)}"></label>`;
  }
  function rowsHTML(f, arr, path) {
    const blankEnc = encodeURIComponent(JSON.stringify(f.blank ? f.blank() : {}));
    const rows = arr.map((row, i) => `
      <div class="arow-sub">
        <div class="arow-sub-grid">
          ${f.cols.map((c) => fieldHTML(c, row[c.key], `${path}.${i}.${c.key}`)).join("")}
        </div>
        <button class="btn-xs btn-danger" data-del-row="${path}.${i}">Remove</button>
      </div>`).join("");
    return `
      <div class="afield afield-rows">
        <span class="afield-label">${esc(f.label)}</span>
        <div class="rows-wrap">${rows || `<div class="admin-empty sm">None yet.</div>`}</div>
        <button class="btn-xs" data-add-row="${path}" data-blank="${blankEnc}">+ Add row</button>
      </div>`;
  }

  // ---- Top-level render ------------------------------------------------------
  function renderAdmin() {
    const host = $("#view-admin");
    if (!host) return;
    if (!adminAuthed) { host.innerHTML = adminLoginHTML(); return; }
    host.innerHTML = `
      <div class="admin">
        <div class="admin-head">
          <div class="admin-brand">${logoImg("admin-logo")}<span>Control Room</span></div>
          <div class="admin-head-actions">
            ${cloudEnabled() ? `<span id="cloudStatus" class="cloud-status" aria-live="polite"></span>` : ""}
            <button class="btn-sm" data-route="home">↗ View site</button>
            <button class="btn-sm btn-ghost" data-admin="logout">Log out</button>
          </div>
        </div>
        ${storageAvailable() ? "" : `<div class="admin-warn">⚠ This preview can't save to the browser, so edits won't survive a reload here. Open the actual HTML file in your browser (or deploy it) to make changes stick. You can still use <b>Export</b> under Settings to download your work.</div>`}
        <div class="admin-tabs">
          ${ADMIN_TABS.map(([id, label]) => `<button class="atab ${adminTab === id ? "on" : ""}" data-admin-tab="${id}">${label}</button>`).join("")}
        </div>
        <div class="admin-body">${adminBody()}</div>
      </div>`;
  }

  function adminBody() {
    if (adminTab === "info") { if (!infoDraft) infoDraft = clone(D.info); return infoEditorHTML(); }
    if (adminTab === "settings") { if (!setDraft) setDraft = settingsFromD(); return settingsEditorHTML(); }
    if (adminTab === "livestream") { if (!liveDraft) liveDraft = clone(D.livestream); return livestreamEditorHTML(); }
    if (adminTab === "rankings") return rankingsEditorHTML();
    return collectionHTML(adminTab);
  }

  function settingsFromD() {
    return { name: D.org.name, tagline: D.org.tagline, stats: clone(D.org.stats), featuredFighter: D.featuredFighter, commerce: clone(D.commerce) };
  }

  // ---- Collection list + form -----------------------------------------------
  function collectionHTML(id) {
    const s = ADMIN_SCHEMAS[id];
    const editing = adminForm && adminForm.schemaId === id;
    if (editing) return formHTML(id);
    if (id === "fights" && resultForm) return resultFormHTML();
    const list = D[s.coll];
    const listHTML = list.length ? list.map((x, i) => {
      const isFight = id === "fights";
      const badge = (isFight && needsResult(x)) ? ` <span class="needs-result">⚠ needs result</span>` : "";
      const logBtn = isFight ? `<button class="btn-xs btn-result" data-logresult="${i}">Log result</button>` : "";
      const moveBtns = (id === "fighters") ? `
          <button class="btn-xs" data-move="fighters:up:${i}" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
          <button class="btn-xs" data-move="fighters:down:${i}" ${i === list.length - 1 ? "disabled" : ""} title="Move down">↓</button>` : "";
      return `
      <div class="arow">
        <div class="arow-title">${esc(s.title(x))}${badge}</div>
        <div class="arow-actions">
          ${moveBtns}${logBtn}
          <button class="btn-xs" data-edit="${id}:${i}">Edit</button>
          <button class="btn-xs btn-danger" data-del="${id}:${i}">Delete</button>
        </div>
      </div>`;
    }).join("") : `<div class="admin-empty">Nothing logged yet. Use “+ Add” to create the first one.</div>`;
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>${esc(s.label)}</h3>
          <button class="btn-sm" data-add="${id}">+ Add</button>
        </div>
        <div class="alist">${listHTML}</div>
      </div>`;
  }
  function formHTML(id) {
    const s = ADMIN_SCHEMAS[id];
    const isNew = adminForm.index === -1;
    const body = s.fields.map((f) => fieldHTML(f, adminForm.draft[f.key], f.key)).join("");
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>${isNew ? "Add" : "Edit"} — ${esc(s.label)}</h3>
          <button class="btn-sm btn-ghost" data-cancel="1">← Back</button>
        </div>
        <div class="admin-form">${body}</div>
        <div class="form-actions">
          <button class="btn" data-save="1">Save</button>
          <button class="btn-ghost" data-cancel="1">Cancel</button>
        </div>
      </div>`;
  }
  function saveForm() {
    if (!adminForm) return;
    const s = ADMIN_SCHEMAS[adminForm.schemaId];
    const coll = D[s.coll];
    if (adminForm.schemaId === "fights" && !adminForm.draft.ticketId) {
      adminForm.draft.ticketId = `${slugify(adminForm.draft.event || "event")}-${adminForm.draft.date || todayStr()}-${Math.random().toString(36).slice(2, 7)}`;
    }
    if (adminForm.schemaId === "memberships" && !adminForm.draft.id) adminForm.draft.id = slugify(adminForm.draft.name);
    if (adminForm.index === -1) coll.push(adminForm.draft);
    else coll[adminForm.index] = adminForm.draft;
    if (adminForm.schemaId === "fighters") syncAfterFighterChange();
    adminForm = null;
    commit(); flushImageDeletes(); toast("Saved");
  }
  // Keep rankings + featured pointing only at fighters that still exist.
  function syncAfterFighterChange() {
    const names = D.fighters.map((f) => f.username);
    D.rankingOrder = D.rankingOrder.filter((n) => names.includes(n));
    if (D.featuredFighter && !names.includes(D.featuredFighter)) D.featuredFighter = "";
  }

  // ---- Log a scheduled fight's result → cascades into fighter profiles ------
  const todayStr = () => new Date().toISOString().slice(0, 10);
  function needsResult(fx) {
    if (!fx || !fx.date) return false;
    const t = Date.parse(fx.date);
    return !isNaN(t) && t < Date.now();
  }
  function resultFormHTML() {
    const fx = D.upcomingFights[resultForm.fightIndex];
    if (!fx) { resultForm = null; return collectionHTML("fights"); }
    const d = resultForm.draft;
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>Log result</h3>
          <button class="btn-sm btn-ghost" data-cancel-result="1">← Back</button>
        </div>
        <p class="admin-note">${esc(fx.event || "Fight")} — <b>${esc(fx.fighter1)}</b> vs <b>${esc(fx.fighter2)}</b>. Logging updates both fighters' records automatically and moves this into Results.</p>
        <label class="afield"><span class="afield-label">Winner</span>
          <select data-path="winner">
            <option value="">— select winner —</option>
            <option ${d.winner === fx.fighter1 ? "selected" : ""}>${esc(fx.fighter1)}</option>
            <option ${d.winner === fx.fighter2 ? "selected" : ""}>${esc(fx.fighter2)}</option>
          </select></label>
        ${fieldHTML({ label: "Method", type: "select", options: ["KO", "Decision", "Forfeit"] }, d.method, "method")}
        ${fieldHTML({ label: "Date", type: "text", hint: "YYYY-MM-DD" }, d.date, "date")}
        ${fieldHTML({ label: "Details (optional)", type: "textarea" }, d.details, "details")}
        <div class="form-actions">
          <button class="btn" data-logresult-save="1">Log result &amp; update fighters</button>
          <button class="btn-ghost" data-cancel-result="1">Cancel</button>
        </div>
      </div>`;
  }
  // Apply one fight result to both fighters' profiles.
  function applyResult(winnerName, loserName, method, event, date) {
    const w = byName(winnerName), l = byName(loserName);
    if (w) {
      const oldWins = w.wins || 0;
      const koWinsOld = Math.round((w.koPercent || 0) / 100 * oldWins); // implied prior KO wins
      w.wins = oldWins + 1;
      const koWinsNew = koWinsOld + (method === "KO" ? 1 : 0);
      w.koPercent = w.wins ? Math.round(koWinsNew / w.wins * 100) : 0;
      w.streak = (w.streak || 0) >= 0 ? (w.streak || 0) + 1 : 1;   // win extends/flips streak
      if (!Array.isArray(w.history)) w.history = [];
      w.history.unshift({ result: "W", opponent: loserName, method, event, date });
    }
    if (l) {
      l.losses = (l.losses || 0) + 1;
      l.streak = (l.streak || 0) <= 0 ? (l.streak || 0) - 1 : -1;   // loss extends/flips streak
      if (!Array.isArray(l.history)) l.history = [];
      l.history.unshift({ result: "L", opponent: winnerName, method, event, date });
    }
  }
  function logResult() {
    if (!resultForm) return;
    const fx = D.upcomingFights[resultForm.fightIndex];
    if (!fx) { resultForm = null; renderAdmin(); return; }
    const d = resultForm.draft;
    const winner = d.winner;
    if (!winner || (winner !== fx.fighter1 && winner !== fx.fighter2)) { toast("Pick the winner first"); return; }
    const loser = winner === fx.fighter1 ? fx.fighter2 : fx.fighter1;
    const method = d.method || "KO";
    const date = d.date || todayStr();
    applyResult(winner, loser, method, fx.event || "", date);
    D.history.unshift({ event: fx.event || "", date, winner, loser, method, details: d.details || "", banner: fx.banner || "" });
    D.upcomingFights.splice(resultForm.fightIndex, 1);
    resultForm = null;
    commit();
    toast("Result logged — fighter records updated");
  }

  // ---- Rankings editor -------------------------------------------------------
  function rankingsEditorHTML() {
    const ranked = D.rankingOrder.filter((n) => byName(n));
    const unranked = D.fighters.map((f) => f.username).filter((n) => !ranked.includes(n));
    const rows = ranked.length ? ranked.map((n, i) => {
      const f = byName(n);
      const champ = f && f.champion;
      return `
      <div class="ra-row ${champ ? "is-champ" : ""}">
        <div class="ra-rank">#${i + 1}${champ ? ` <span class="ra-champ">★</span>` : ""}</div>
        <div class="ra-name">${esc(n)}<span class="ra-rec">${f ? rec(f) : ""}</span></div>
        <div class="ra-actions">
          <button class="btn-xs ${champ ? "btn-champ-on" : ""}" data-rank="champ:${i}" title="Toggle reigning champion">${champ ? "★ Champ" : "☆ Champ"}</button>
          <button class="btn-xs" data-rank="up:${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn-xs" data-rank="down:${i}" ${i === ranked.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn-xs btn-danger" data-rank="rm:${i}">✕</button>
        </div>
      </div>`;
    }).join("") : `<div class="admin-empty">No ranked fighters yet. Add fighters to the ladder below.</div>`;
    const adder = unranked.length ? `
      <div class="ra-add">
        <select id="raAdd"><option value="">Add a fighter to the ladder…</option>${unranked.map((n) => `<option>${esc(n)}</option>`).join("")}</select>
        <button class="btn-sm" data-rank="add">Add</button>
      </div>` : (D.fighters.length ? `<div class="admin-empty sm">Every fighter is already on the ladder.</div>` : `<div class="admin-empty sm">Log some fighters first (Fighters tab).</div>`);
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>Rankings ladder</h3>
          <button class="btn-sm btn-ghost" data-rank="auto">Auto-sort by record</button>
        </div>
        <p class="admin-note">Use the arrows to reorder. Tap <b>★ Champ</b> to crown the reigning champion (they get the gold badge site-wide) — the champion is set here, independent of ladder position.</p>
        <div class="ra-list">${rows}</div>
        ${adder}
      </div>`;
  }
  function handleRank(cmd) {
    const [op, iRaw] = cmd.split(":");
    const i = +iRaw;
    let ord = D.rankingOrder.filter((n) => byName(n));
    if (op === "champ") {
      const f = byName(ord[i]);
      if (f) {
        const makeChamp = !f.champion;
        // One reigning champion at a time: crowning one clears the rest.
        if (makeChamp) D.fighters.forEach((x) => { x.champion = false; });
        f.champion = makeChamp;
      }
      commit();
      return;
    }
    if (op === "up" && i > 0) { [ord[i - 1], ord[i]] = [ord[i], ord[i - 1]]; }
    else if (op === "down" && i < ord.length - 1) { [ord[i], ord[i + 1]] = [ord[i + 1], ord[i]]; }
    else if (op === "rm") { ord.splice(i, 1); }
    else if (op === "add") { const sel = $("#raAdd"); const n = sel && sel.value; if (n && !ord.includes(n)) ord.push(n); }
    else if (op === "auto") {
      ord.sort((a, b) => {
        const fa = byName(a), fb = byName(b);
        const da = fa ? fa.wins - fa.losses : -1e9, db = fb ? fb.wins - fb.losses : -1e9;
        if (db !== da) return db - da;
        return (fb ? fb.wins : 0) - (fa ? fa.wins : 0);
      });
    }
    D.rankingOrder = ord;
    commit();
  }

  // ---- Info-text editor ------------------------------------------------------
  function infoEditorHTML() {
    const d = infoDraft;
    const rowBlock = (label, key, cols, blank, addLabel) => `
      <div class="afield afield-rows">
        <span class="afield-label">${label}</span>
        <div class="rows-wrap">
          ${(d[key] || []).map((r, i) => `
            <div class="arow-sub">
              <div class="arow-sub-grid">
                ${cols.map((c) => fieldHTML(c, (typeof r === "object" ? r[c.key] : r), c.key ? `${key}.${i}.${c.key}` : `${key}.${i}`)).join("")}
              </div>
              <button class="btn-xs btn-danger" data-del-row="${key}.${i}">Remove</button>
            </div>`).join("") || `<div class="admin-empty sm">None yet.</div>`}
        </div>
        <button class="btn-xs" data-add-row="${key}" data-blank="${encodeURIComponent(JSON.stringify(blank))}">+ ${addLabel}</button>
      </div>`;
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>Info page text</h3>
          <button class="btn" data-save-info="1">Save info text</button>
        </div>
        <p class="admin-note">Every word on the Info page is editable here. Clear a whole section to hide it on the site.</p>
        ${fieldHTML({ label: "About the league", type: "textarea" }, d.about, "about")}
        ${rowBlock("How fights work (cards)", "howItWorks",
          [{ key:"step", label:"Step title", type:"text" }, { key:"text", label:"Text", type:"textarea" }],
          { step:"", text:"" }, "Add step")}
        ${fieldHTML({ label: "How to join", type: "textarea" }, d.howToJoin, "howToJoin")}
        ${rowBlock("Rules", "rules",
          [{ key:null, label:"Rule", type:"text" }],
          "", "Add rule")}
        ${rowBlock("FAQ", "faq",
          [{ key:"q", label:"Question", type:"text" }, { key:"a", label:"Answer", type:"textarea" }],
          { q:"", a:"" }, "Add question")}
        ${rowBlock("Staff", "staff",
          [{ key:"name", label:"Name", type:"text" }, { key:"role", label:"Role", type:"text" }, { key:"skin", label:"Skin name", type:"text" }, { key:"note", label:"Note", type:"textarea" }],
          { name:"", role:"", skin:"", note:"" }, "Add staff")}
        <div class="form-actions"><button class="btn" data-save-info="1">Save info text</button></div>
      </div>`;
  }

  // ---- Settings editor -------------------------------------------------------
  function settingsEditorHTML() {
    const d = setDraft;
    const names = D.fighters.map((f) => f.username);
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>Settings</h3>
          <button class="btn" data-save-settings="1">Save settings</button>
        </div>
        ${fieldHTML({ label: "League name", type: "text" }, d.name, "name")}
        ${fieldHTML({ label: "Tagline", type: "text" }, d.tagline, "tagline")}
        <span class="afield-label" style="display:block;margin:14px 0 2px">Stat strip (the big numbers on the home page)</span>
        <div class="arow-sub-grid">
          ${fieldHTML({ label:"Total fights", type:"number" }, d.stats.totalFights, "stats.totalFights")}
          ${fieldHTML({ label:"Total KOs", type:"number" }, d.stats.totalKOs, "stats.totalKOs")}
          ${fieldHTML({ label:"Champions crowned", type:"number" }, d.stats.championsCrowned, "stats.championsCrowned")}
          ${fieldHTML({ label:"Events held", type:"number" }, d.stats.eventsHeld, "stats.eventsHeld")}
        </div>
        <label class="afield"><span class="afield-label">Featured fighter (home-page spotlight)</span>
          <select data-path="featuredFighter">
            <option value="">— none —</option>
            ${names.map((n) => `<option ${d.featuredFighter === n ? "selected" : ""}>${esc(n)}</option>`).join("")}
          </select>
        </label>
        <hr class="admin-hr">
        <div class="admin-panel-head"><h3>Tickets &amp; memberships</h3></div>
        ${fieldHTML({ label:"Currency label", type:"text", hint:"Display-only, e.g. DCR, USD, EUR." }, d.commerce.currency, "commerce.currency")}
        ${fieldHTML({ label:"Ticket page intro", type:"textarea" }, d.commerce.ticketHelp, "commerce.ticketHelp")}
        ${fieldHTML({ label:"Membership page intro", type:"textarea" }, d.commerce.membershipHelp, "commerce.membershipHelp")}
        ${fieldHTML({ label:"Discord invite URL (optional)", type:"text" }, d.commerce.discordInvite, "commerce.discordInvite")}
        <div class="form-actions"><button class="btn" data-save-settings="1">Save settings</button></div>
        <hr class="admin-hr">
        <div class="admin-panel-head"><h3>Backup &amp; data</h3></div>
        <p class="admin-note">${cloudEnabled()
          ? "Your edits publish to everyone automatically. <b>Export</b> just downloads a <code>data.js</code> backup you can keep for safekeeping."
          : "Your edits live in this browser only. <b>Export</b> downloads a <code>data.js</code> you can keep as a backup, or drop into the site's <code>js/</code> folder (replacing the old one) to deploy with your content baked in."}</p>
        <div class="form-actions">
          <button class="btn-sm" data-export="1">⬇ Export data.js</button>
          <button class="btn-sm btn-danger" data-reset="1">Reset everything to empty</button>
        </div>
      </div>`;
  }
  function applySettings() {
    D.org.name = setDraft.name;
    D.org.tagline = setDraft.tagline;
    D.org.stats = clone(setDraft.stats);
    D.featuredFighter = setDraft.featuredFighter;
    D.commerce = clone(setDraft.commerce);
    commit(); toast("Settings saved");
  }

  // ---- Livestream editor (single object, not a collection) -------------------
  function livestreamEditorHTML() {
    const d = liveDraft;
    return `
      <div class="admin-panel">
        <div class="admin-panel-head">
          <h3>Livestream</h3>
          <button class="btn" data-save-live="1">Save livestream</button>
        </div>
        <p class="admin-note">Flip <b>Live now</b> on when you go live and the Videos page pins a big animated player at the top. Turn it off when the stream ends — add the recording under the <b>Videos</b> tab and it drops into Past Broadcasts.</p>
        <label class="afield afield-bool" style="margin-bottom:14px">
          <input type="checkbox" data-path="active" ${d.active ? "checked" : ""}>
          <span>Live now — pin the broadcast to the top of the Videos page</span>
        </label>
        ${fieldHTML({ label:"Stream title", type:"text" }, d.title, "title")}
        ${fieldHTML({ label:"YouTube video ID (the live broadcast)", type:"text", hint:"The part after watch?v= — powers the embedded player." }, d.youtubeId, "youtubeId")}
        ${fieldHTML({ label:"Viewer count (optional)", type:"text", hint:"Leave blank to hide it." }, d.viewers, "viewers")}
        ${fieldHTML({ label:"Started at (optional)", type:"text", hint:"ISO datetime, e.g. 2026-07-20T19:00" }, d.startedAt, "startedAt")}
        ${fieldHTML({ label:"Thumbnail URL (optional)", type:"text", hint:"Poster shown before the player loads. Defaults to the YouTube thumbnail." }, d.thumbnail, "thumbnail")}
        <hr class="admin-hr">
        <div class="admin-panel-head"><h3>Auto-detect (optional)</h3></div>
        <p class="admin-note">Advanced: with a YouTube channel ID and a YouTube Data API key, the page checks every minute and flips itself live automatically — no manual toggle needed. Leave blank to just use the switch above. Note the API key is visible in the page source, so use a restricted key.</p>
        ${fieldHTML({ label:"Channel ID (optional)", type:"text", hint:"Enables the channel live-embed and auto-detect." }, d.channelId, "channelId")}
        ${fieldHTML({ label:"YouTube Data API key (optional)", type:"text" }, d.apiKey, "apiKey")}
        <div class="form-actions"><button class="btn" data-save-live="1">Save livestream</button></div>
      </div>`;
  }

  // ---- Login screen ----------------------------------------------------------
  function adminLoginHTML() {
    const cloud = cloudEnabled();
    return `
      <div class="admin-login">
        <div class="al-card">
          <div class="al-logo">${logoImg("al-logo-img")}</div>
          <h2>Control Room</h2>
          <p>${cloud ? "Sign in to manage the league." : "Enter the admin password to manage the league."}</p>
          ${cloud ? `<input type="email" id="adminEmail" placeholder="Email" autocomplete="username" spellcheck="false">` : ""}
          <input type="password" id="adminPw" placeholder="Password" autocomplete="current-password" spellcheck="false">
          <button class="btn" data-admin="login">${cloud ? "Sign in" : "Enter"}</button>
          <div class="al-err" id="alErr"></div>
          <button class="al-back btn-ghost" data-route="home">← Back to site</button>
        </div>
      </div>`;
  }
  async function adminLogin() {
    const err = $("#alErr");
    if (cloudEnabled()) {
      const email = (($("#adminEmail") || {}).value || "").trim();
      const pw = ($("#adminPw") || {}).value || "";
      if (err) err.textContent = "Signing in…";
      try {
        const { data, error } = await supa.auth.signInWithPassword({ email, password: pw });
        if (error) { if (err) err.textContent = "Sign-in failed — check your email and password."; return; }
        adminAuthed = await verifyAdminSession(data && data.user);
        if (!adminAuthed) { if (err) err.textContent = "This account is not a GFC administrator."; return; }
        renderAdmin();
      } catch (_) { if (err) err.textContent = "Sign-in failed — are you online?"; }
      return;
    }
    // Local fallback (no cloud configured): client-side password.
    const el = $("#adminPw");
    if (el && el.value === ADMIN_PW) {
      adminAuthed = true;
      try { sessionStorage.setItem("gfc_admin_ok", "1"); } catch (_) {}
      renderAdmin();
    } else if (err) { err.textContent = "Wrong password — try again."; }
  }
  function adminLogout() {
    adminAuthed = false;
    try { sessionStorage.removeItem("gfc_admin_ok"); } catch (_) {}
    if (cloudEnabled()) { try { supa.auth.signOut(); } catch (_) {} }
    adminForm = null; resultForm = null; infoDraft = null; setDraft = null; liveDraft = null; pendingImageDeletes = [];
    renderAdmin();
  }

  // ---- Save / export / reset -------------------------------------------------
  function commit() { saveState(); renderAll(); renderAdmin(); pushToCloud(); }

  function exportData() {
    const js = "/* GFC data — exported from the admin panel.\n"
      + "   To deploy your content, replace js/data.js with this file. */\n\n"
      + "const GFC_DATA = " + JSON.stringify(D, null, 2) + ";\n\n"
      + "window.GFC_DATA = GFC_DATA;\n";
    const blob = new Blob([js], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "data.js";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Downloaded data.js");
  }
  function resetAll() {
    D = clone(DEFAULTS);
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    adminForm = null; resultForm = null; infoDraft = null; setDraft = null; liveDraft = null; pendingImageDeletes = [];
    renderAll(); renderAdmin(); toast("Reset to empty");
  }

  // ---- Toast -----------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // ---- Admin event wiring (delegated, attached once) -------------------------
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-admin='login']"))  { adminLogin();  return; }
    if (t.closest("[data-admin='logout']")) { adminLogout(); return; }

    const tab = t.closest("[data-admin-tab]");
    if (tab) { adminTab = tab.dataset.adminTab; adminForm = null; resultForm = null; infoDraft = null; setDraft = null; liveDraft = null; pendingImageDeletes = []; renderAdmin(); return; }

    const add = t.closest("[data-add]");
    if (add) { const id = add.dataset.add; adminForm = { schemaId: id, index: -1, draft: ADMIN_SCHEMAS[id].blank() }; renderAdmin(); return; }

    const edit = t.closest("[data-edit]");
    if (edit) { const [id, i] = edit.dataset.edit.split(":"); adminForm = { schemaId: id, index: +i, draft: clone(D[ADMIN_SCHEMAS[id].coll][+i]) }; renderAdmin(); return; }

    const del = t.closest("[data-del]");
    if (del) {
      const [id, i] = del.dataset.del.split(":");
      if (confirm("Delete this item? This can't be undone.")) {
        D[ADMIN_SCHEMAS[id].coll].splice(+i, 1);
        if (id === "fighters") syncAfterFighterChange();
        commit();
      }
      return;
    }

    const mv = t.closest("[data-move]");
    if (mv) {
      const [coll, dir, iRaw] = mv.getAttribute("data-move").split(":");
      const arr = D[coll]; const i = +iRaw; const j = dir === "up" ? i - 1 : i + 1;
      if (arr && j >= 0 && j < arr.length) { const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; commit(); }
      return;
    }

    if (t.closest("[data-save]"))   { saveForm(); return; }
    if (t.closest("[data-cancel]")) { adminForm = null; pendingImageDeletes = []; renderAdmin(); return; }

    const logr = t.closest("[data-logresult]");
    if (logr) {
      const i = +logr.getAttribute("data-logresult");
      const fx = D.upcomingFights[i];
      resultForm = { fightIndex: i, draft: { winner: "", method: "KO", date: (fx && fx.date) || todayStr(), details: "" } };
      renderAdmin();
      return;
    }
    if (t.closest("[data-cancel-result]")) { resultForm = null; renderAdmin(); return; }
    if (t.closest("[data-logresult-save]")) { logResult(); return; }

    const imgrm = t.closest("[data-imgrm]");
    if (imgrm) {
      const path = imgrm.getAttribute("data-imgrm");
      const url = imgrm.getAttribute("data-url") || "";
      const draft = activeDraft();
      if (draft) setByPath(draft, path, "");
      if (url) pendingImageDeletes.push(url);
      renderAdmin();
      toast("Image removed — Save to apply");
      return;
    }

    const addRow = t.closest("[data-add-row]");
    if (addRow) {
      const path = addRow.dataset.addRow;
      const blank = JSON.parse(decodeURIComponent(addRow.dataset.blank));
      const arr = getByPath(activeDraft(), path);
      if (Array.isArray(arr)) { arr.push(blank); renderAdmin(); }
      return;
    }
    const delRow = t.closest("[data-del-row]");
    if (delRow) {
      const parts = delRow.dataset.delRow.split(".");
      const idx = +parts.pop();
      const arr = getByPath(activeDraft(), parts.join("."));
      if (Array.isArray(arr)) { arr.splice(idx, 1); renderAdmin(); }
      return;
    }

    const rk = t.closest("[data-rank]");
    if (rk) { handleRank(rk.dataset.rank); return; }

    if (t.closest("[data-save-info]"))     { D.info = clone(infoDraft); commit(); toast("Info text saved"); return; }
    if (t.closest("[data-save-settings]")) { applySettings(); return; }
    if (t.closest("[data-save-live]"))     { D.livestream = clone(liveDraft); liveAuto = null; commit(); toast(D.livestream.active ? "You're live" : "Livestream saved"); return; }
    if (t.closest("[data-export]"))        { exportData(); return; }
    if (t.closest("[data-reset]")) {
      if (confirm("Reset the ENTIRE site back to empty? This wipes every fighter, fight, result, and text change you've made in this browser.")) resetAll();
      return;
    }
  });

  // Live text edits update the working draft WITHOUT re-rendering (keeps focus).
  const draftInput = (e) => {
    const el = e.target.closest("[data-path]");
    if (!el) return;
    const draft = activeDraft();
    if (!draft) return;
    let val;
    if (el.type === "checkbox") val = el.checked;
    else if (el.type === "number") val = el.value === "" ? 0 : Number(el.value);
    else val = el.value;
    setByPath(draft, el.dataset.path, val);
  };
  document.addEventListener("input", draftInput);
  document.addEventListener("change", draftInput); // selects / checkboxes

  // Enter submits the login password.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target && e.target.id === "adminPw") { e.preventDefault(); adminLogin(); }
  });

  /* ====================================================== BOOT ============= */
  function boot() {
    initCloud();
    renderChrome();
    renderHome();
    renderFighters();
    renderRankings();
    renderHistory();
    renderVideos();
    renderTickets();
    renderMemberships();
    renderInfo();
    initPublicAuth();

    // Visual enhancements only — never let one failing take down routing/admin.
    try { initReveal(); }    catch (e) { console.warn("reveal init skipped:", e); }
    try { initNavScroll(); } catch (e) { console.warn("nav-scroll init skipped:", e); }
    try { initEmbers(); }    catch (e) { console.warn("embers init skipped:", e); }

    // Wire up mobile hamburger (element exists after renderChrome).
    $("#navToggle").addEventListener("click", toggleMobileNav);

    // Initial route from URL hash.
    const start = (location.hash || "#home").slice(1);
    route((start.indexOf("fighter=") === 0 || ROUTES.includes(start)) ? start : "home", false);

    // Dismiss the loading screen once the first paint settles.
    window.addEventListener("load", dismissLoader);
    setTimeout(dismissLoader, 1800); // safety net

    // Cloud (async, non-blocking): adopt the shared data + restore admin session.
    if (cloudEnabled()) {
      pullFromCloud().then((got) => {
        if (got) {
          renderAll();
          const cur = (location.hash || "#home").slice(1);
          route((cur.indexOf("fighter=") === 0 || ROUTES.includes(cur)) ? cur : "home", false);
        }
      });
      supa.auth.getSession().then(async ({ data }) => {
        if (data && data.session) {
          adminAuthed = await verifyAdminSession(data.session.user);
          if ((location.hash || "").slice(1) === "admin") renderAdmin();
        }
      }).catch(() => {});
    }
  }

  let loaderGone = false;
  function dismissLoader() {
    if (loaderGone) return; loaderGone = true;
    const l = $("#loader");
    setTimeout(() => l.classList.add("done"), 500);
  }

  // Start once DOM is ready.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ====================================================== DATE UTILS ======= */
  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function shortDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
})();
