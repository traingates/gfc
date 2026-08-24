# GFC — Developer Handoff

Everything you need to pick up the **Global Fighting Championship (GFC)** website
and keep building. Read this first, then `README.md` (the day-to-day guide for
running the admin panel).

Live site: **https://globalfc.pages.dev**

---

## 1. What it is

A website for a Minecraft PvP fight league on the DemocracyCraft server. It has
fighter profiles, rankings, fight results/history, an upcoming-fights schedule
with countdown, a video/media hub (YouTube), news, event posters, sponsors, a
hall of fame, cinema-style ticket selection, memberships, Discord OAuth, and a
password-protected **admin panel** to manage all of it. A
non-technical owner runs the whole site through that admin panel — no code
editing required for normal content.

## 2. Tech stack (deliberately simple)

- **Frontend:** plain HTML/CSS/JS. No framework, no bundler, no build step for
  development. It's a single-page app with a hash router. You can literally open
  `index.html` in a browser and it runs.
- **Data + backend:** [Supabase](https://supabase.com). One Postgres table holds
  the entire site's content as a single JSON blob; Supabase **Auth** powers the
  admin login; Supabase **Storage** holds uploaded images.
- **Hosting:** Cloudflare Pages (static hosting).
- **Fighter skins:** rendered from `mc-heads.net` by Minecraft username.

## 3. The mental model (how it actually works)

- All site content lives in one JavaScript object, **`D`**, seeded from
  `js/data.js`. That file documents the full shape (fighters, upcomingFights,
  history, rankingOrder, news, videos, livestream, info, org, etc.).
- Public pages **render from `D`**. The admin panel **edits `D`**.
- **Saving / publishing:** when the admin saves, the app writes `D` to the
  Supabase `site` table (a single row, `id = 1`). Every visitor reads that row on
  page load, so edits publish to everyone instantly — no redeploy. If Supabase is
  unreachable, it falls back to saving in the browser (localStorage) and shows a
  status.
- **Security model:** the browser can read the data always, and write it only
  when an admin is logged in. Database Row-Level-Security (RLS) enforces this:
  anyone can `SELECT`, only an authenticated user can `INSERT/UPDATE`. The
  Supabase **anon key** in `index.html` is public by design and safe to ship —
  it only grants read + auth, RLS does the rest. **There is no `service_role`
  key anywhere in the code, and you must never add one to the client.**
- The admin panel is **schema-driven**: `ADMIN_SCHEMAS` in `js/app.js` defines
  each collection's fields and field types. Add a field there and it shows up in
  the form and saves automatically.

## 4. File map

```
gfc/
├── HANDOFF.md            ← you are here (developer onboarding)
├── README.md             ← owner/admin guide (how to run the site day-to-day)
├── build.py              ← regenerates GFC-standalone.html from source
├── index.html            ← the page shell + config + <head> meta tags
├── css/
│   └── style.css         ← all styling (design tokens in :root at the top)
├── js/
│   ├── data.js           ← starting content + the full data shape (well commented)
│   └── app.js            ← ALL app logic (router, render, admin, cloud, uploads)
├── assets/
│   ├── logo.png          ← GFC wordmark (embedded into the standalone at build)
│   ├── og-image.png      ← social/link-preview card (hosted on Supabase, see §8)
│   ├── banners/README.txt   ← naming guide for event banner images
│   └── sponsors/README.txt  ← naming guide for sponsor logo images
├── SUPABASE_SETUP.sql    ← creates the `site` table + RLS policies
├── SUPABASE_STORAGE.sql  ← storage bucket policies for image uploads
├── SUPABASE_COMMERCE.sql ← admin allowlist + secure ticket/member order RPCs
├── GFC-standalone.html   ← GENERATED single-file build (via build.py)
└── tests/
    ├── package.json
    └── smoke.mjs         ← starter headless (jsdom) smoke test
```

`js/app.js` is one big file organized into clearly-commented sections (STATE,
CLOUD, helpers, render functions per view, ADMIN PANEL, BOOT). It's long but
linear — search for the section headers.

## 5. Config & secrets

Set in `index.html`:

- `window.GFC_CLOUD = { url, key }` — the Supabase project URL and **anon**
  (public) key. Safe to be in the client; protected by RLS.
- `window.GFC_LOGO` — logo path (the build swaps it for an embedded data URI in
  the standalone).

Other:

- The admin login is a **Supabase Auth user** (email + password). The `ADMIN_PW`
  constant in `js/app.js` is only an offline fallback used when Supabase isn't
  configured; the live site uses real Supabase Auth and ignores it.
- **Never** put the Supabase `service_role` key, or any private/secret key, in
  these files. Only the anon key belongs here.

## 6. Running locally

- Simplest: open `index.html` in a browser (works from `file://`). Cloud
  save/login needs internet + the Supabase config (already set).
- Or serve it: `python3 -m http.server` then visit `http://localhost:8000`.

## 7. Building the single-file version

`GFC-standalone.html` is a self-contained snapshot with CSS/JS/data/logo inlined
(handy for quick sharing). It is **generated** — the multi-file version is the
source of truth. After any change to `index.html`, `css/style.css`, `js/app.js`,
or `js/data.js`, regenerate it:

```
python3 build.py
```

## 8. Deploying

Hosting is **Cloudflare Pages**, project `globalfc` (→ `globalfc.pages.dev`).

- Deploy by uploading the **whole `gfc` folder** (so `index.html` is at the root
  and `assets/`, `css/`, `js/` come with it), or connect the Git repo.
- **Do not deploy just `index.html` on its own** — the multi-file site needs
  `css/`, `js/`, and `assets/`. (The single `GFC-standalone.html` can be dropped
  in as `index.html` alone, but then there's no `assets/` folder — e.g. banner/
  sponsor images won't resolve.)
- For a plain static site the Cloudflare **build command is empty** and the
  **output directory** is the folder containing `index.html`.
- **Social/link preview image:** `og-image.png` is referenced by an absolute URL
  that points at **Supabase Storage** (not the Cloudflare deploy), so previews
  work regardless of how you deploy. If you replace it, re-upload it to the
  Supabase `media` bucket (see §9). Discord caches previews — bust with a
  throwaway `?v=2` on the URL.

## 9. Supabase (already set up on the live project; here for reference)

- Project ref: `tzrhtthuuroutdctzeos`.
- Run `SUPABASE_SETUP.sql` once — creates the `site` table + RLS (public read,
  authenticated write) and seeds row `id = 1`.
- Run `SUPABASE_STORAGE.sql` once — policies for the image bucket. Create a
  **public** bucket named `media` first (Storage → New bucket).
- Create one admin user (Authentication → Users → Add user, email + password,
  auto-confirm) and **disable public sign-ups** so no one else can register.
- The `og-image.png` preview card is uploaded to the root of the `media` bucket.

## 10. What to transfer to take over fully

The code contains no private keys, so the files are safe to hand over as-is. To
fully take the reins, the new developer also needs:

1. **Supabase project access** — invite them as a member (or share the login).
   Covers the database, admin auth, and storage.
2. **Cloudflare Pages access** — invite them to the Cloudflare account (or share
   the login) so they can deploy.
3. **An admin account** — share the existing admin email/password, or add a new
   Supabase Auth user for them.

## 11. What's built

Fighters (with dedicated profile pages), rankings ladder with a manual champion
toggle, upcoming fights with a main-event countdown, **log-a-result** that
auto-updates both fighters' W/L, KO%, streak and history, results/history
timeline, videos hub (YouTube recordings + livestream, optional auto-detect),
news (with headlines flanking the hero), event posters, sponsors (with logos),
hall of fame, an editable Info page, sponsor/banner **image uploads** to Supabase
Storage, cloud saving with a real login, Open Graph link previews, ticketed
events with a responsive seat map and collision-safe 15-minute holds, membership
tiers, and public Discord authentication. Ticketed events support admin-defined
seat categories (Regular, Floor, Premium, or custom), row-specific prices, and
Suite inventory sold separately from individual seats.

## 12. What's planned / not yet built

- **Payment webhook / Edge Function** — checkout links are configurable and
  order rows are created securely, but the payment provider must confirm
  `pending` → `paid` / `active` server-side before launch.
- **Betting system** (in DemocracyCraft dollars) — designed but not implemented.
  Recommended shape: parimutuel (pool) betting; Discord login + linked Minecraft
  name; a custodial "wallet" backed 1:1 by real currency held in a league
  treasury account; all balance/settlement logic in **server-side Postgres
  `security definer` functions** (never trust the client with money) on a
  double-entry ledger. Deposits/withdrawals happen in-game via staff (manual to
  start; a bot can automate later). This is the big next feature.
- **Discord webhook auto-posting** — announce new fights/results/news to a
  channel automatically. Not built.
- Optional: make the public roster follow the admin's manual fighter order
  entirely (it currently sorts by rank first; manual order controls unranked
  fighters).

## 13. Conventions & gotchas (save yourself time)

- **Skins:** always render `skin || username` — the `skin` field is optional;
  blank means "use the username." Skins only load for real Minecraft accounts.
- **Fighter references** in fights/results/posters are chosen from **dropdowns**
  of registered fighters. Register a fighter before you can book them.
- **Champion** is set manually in the Rankings tab (★), independent of ladder
  position.
- **Logging a result** (Upcoming tab → "Log result") cascades into both
  fighters' records automatically and moves the fight into Results.
- Record fields on a fighter are **optional seeds**: fill them to start from an
  existing record, or leave 0 to build purely from logged fights.
- **News headlines flank the hero** on wide screens only, and only when articles
  exist.
- **Public auth vs admin:** every Discord user receives Supabase's authenticated
  role, so admin writes are protected by `gfc_admins`, not by `authenticated`
  alone. Run `SUPABASE_COMMERCE.sql` and allowlist the existing admin UUID before
  enabling Discord.
- **Money/secrets:** anon key OK in client; service_role never. Image uploads and
  the OG image live in Supabase Storage.
- **Ticket categories:** category rows are comma-separated and the first explicit
  row match wins. The category named `Regular` is the fallback for unmatched
  rows. Suites use inventory IDs such as `SUITE1` and never appear in the seat
  grid. Re-run `SUPABASE_COMMERCE.sql` whenever its reservation RPC changes.
- After editing `js/`/`css/`, run `python3 build.py`, then redeploy the folder.

## 14. Testing

The site was validated throughout with headless jsdom smoke tests that simulate
admin flows in a fake DOM (no browser, no network — the app runs in local mode).
A starter is in `tests/`:

```
cd tests
npm install
node smoke.mjs
```

Extend it as you add features — copy the pattern (boot the built
`GFC-standalone.html`, drive the DOM, assert on the rendered output). Run
`python3 build.py` first so the test runs against your latest code.
