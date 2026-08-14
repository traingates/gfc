# GFC — Global Fighting Championship

A complete, self-contained website for a Minecraft PvP fight league.
Dark cinematic theme, red glow, animated ember particles, a countdown timer,
fighter profiles, rankings, an event timeline, hall of fame, news, and a
fully responsive mobile nav, cinema-style ticket selection, memberships, and
Discord sign-in — plus a **built-in admin panel** for managing
everything without touching code.

No frameworks. No build step. No server required.
**Just open `index.html` in any browser.**

The site starts **completely empty** — no fighters, fights, rankings, or
results. You log all of that yourself through the admin panel.

---

## File structure

```
gfc/
├── index.html          ← the page (open this)
├── css/
│   └── style.css        ← all styling (colors, layout, animations)
├── assets/
│   └── logo.png         ← the GFC logo
└── js/
    ├── data.js          ← starting/default content (you normally won't touch this)
    └── app.js           ← app logic + the admin panel
```

---

## The Admin Panel (how you manage the site)

This is the main way to add and edit content — no code required.

### Getting in
1. Open the site, scroll to the footer, and click the small **Admin** link
   (or add `#admin` to the end of the address).
2. Enter the password:

   ```
   5LiXFCZy8Qxy3o7nGpce
   ```

3. You're in the **Control Room**. Use the tabs across the top.

### What each tab does
- **Fighters** — add/edit/delete fighters (name, **nickname**, bio, and their
  personal fight history). The record fields (wins, losses, KO rate, streak) are
  **optional**: fill them in to seed an existing record, or leave them at 0 and
  the record builds itself automatically as you log fights. Each fighter has a
  **dedicated profile page** — click any fighter anywhere on the site.
- **Upcoming** — schedule fights (fighters are picked from a dropdown of your
  roster). Mark one as the **main event** to drive the home-page countdown.
  After a fight happens, hit **Log result** on it: pick the winner and method,
  and it automatically updates *both* fighters' win/loss records, KO rate, and
  streak, adds the bout to each fighter's history, drops it into Results, and
  removes it from the schedule. Past-dated fights show a **⚠ needs result** flag.
  Each event can also open ticket sales: set the arena, rows, seats per row,
  price, manually unavailable seats, and your hosted checkout URL.
- **Rankings** — order the ladder with up/down arrows, or *Auto-sort by record*.
  Crown the **reigning champion** by tapping **★ Champ** on any fighter — the
  champion is set here (independent of ladder position) and gets the gold badge
  site-wide.
- **Results** — the history timeline. Logging a fight from Upcoming fills this
  in automatically; you can also add or correct entries here by hand.
- **News** — post announcements (tag, headline, excerpt, full body). When articles exist, their headlines flank the hero on the home page (with a red underline and "read more"); the lines only appear when there are articles to fill them. All news also appears in "The Wire" section lower down.
- **Hall of Fame / Posters / Sponsors** — the extra home-page sections.
- **Memberships** — publish paid tiers with a price, billing period, benefits,
  featured badge, and hosted checkout URL.
- **Videos** — the media hub. Add past broadcasts/recordings: title, YouTube
  video ID, date, duration, event, category, view count, description, and a
  "featured" toggle that pins it to the Featured Events carousel.
- **Livestream** — flip **Live now** on when you go live and the Videos page
  pins a big animated player at the top with a LIVE badge, title, viewer count,
  and start time. Turn it off when you're done; add the recording under Videos
  and it drops into Past Broadcasts. (Optional: add a channel ID + YouTube Data
  API key and it auto-detects live status every minute — see below.)
- **Info Text** — **every word** on the Info page is editable here: the about
  blurb, how-fights-work cards, how-to-join text, rules, FAQ, and staff.
  Clear a whole section to hide it on the site.
- **Settings** — league name, tagline, the four stat-strip numbers, the
  featured fighter, currency and commerce-page copy, plus **Export** and **Reset**.

Every change saves instantly and updates the live site.

### Where your data is saved
Edits are stored **in your browser** (localStorage) on the machine you're
using, and reload automatically next time you open the file there.

> **Two things to know:**
> - This saving only works when you open the actual `index.html` file in your
>   browser (or the deployed site). Inside a sandboxed *preview* pane it may not
>   persist — the admin panel will warn you if so.
> - Because it's per-browser, your edits won't automatically appear on someone
>   else's computer. To publish your content for everyone, use **Export** ↓.

### Publishing your content (Export)
In **Settings → Export data.js**, download a `data.js` file containing
everything you've logged. Drop it into the `js/` folder (replacing the old
`data.js`) and re-deploy. Now the site loads your content for everyone by
default. Keep the exported file as a backup, too.

### About the password
The password check happens in the browser, which means anyone who digs through
the page's source code can find it. It keeps casual visitors out of the editor,
but it is **not real security**. If you need genuine access control (so no one
can ever see or bypass it), the site would need a small backend server — happy
to add that if you host it somewhere that supports it.

To change the password, open `js/app.js` and edit the line near the admin
section: `const ADMIN_PW = "...";`

*(The above describes local-only mode. If you set up cloud saving below, a real
login replaces this password entirely.)*

---

## Cloud saving — publish edits to everyone (Supabase)

By default the admin saves to your browser only, and you publish with Export.
If you want **Save** to update the live site for all visitors instantly — and a
real login instead of the client-side password — connect a free Supabase
database. One-time setup:

1. Create a free project at supabase.com.
2. In the project's **SQL Editor**, run the setup script (in `SUPABASE_SETUP.sql`
   included alongside this site, or from the chat). It creates one `site` table
   and locks it down so anyone can *read* but only a logged-in admin can *write*.
3. In **Authentication → Users**, add yourself as a user (email + password, mark
   it confirmed). This email/password becomes your new admin login. Turn **off**
   public sign-ups so no one else can register.
4. In **Project Settings → API**, copy the **Project URL** and the **anon public**
   key.
5. Open `index.html` and paste them into this line near the bottom:
   ```js
   window.GFC_CLOUD = { url: "https://hwbwlpfwuryioojjlptc.supabase.co", key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3YndscGZ3dXJ5aW9vampscHRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTg4MDIsImV4cCI6MjEwMjIzNDgwMn0.7bCe3fyTPmNrmYV2K2YNRACJhTOP9ZzfAaKOIqQC_Pc" };
   ```
6. Redeploy (drag the folder to Cloudflare Pages again).

Now the admin login asks for your email + password, and every Save publishes to
everyone. If the database is ever unreachable, the site automatically falls back
to local saving so nothing breaks.

### Discord login, tickets, and memberships

1. Run `SUPABASE_COMMERCE.sql` in the SQL Editor before enabling public login.
2. In Authentication → Users, copy the existing admin user's UUID and run the
   allowlist `insert` shown at the top of that SQL file. This is mandatory:
   ordinary Discord users are authenticated members, not administrators.
3. In Authentication → Providers → Discord, enable Discord and enter the app
   client ID/secret. Add the callback URL displayed by Supabase to the Discord
   Developer Portal, and add the live site URL to Supabase's redirect allowlist.
4. In the admin panel, configure ticket sales under **Upcoming** and create tiers
   under **Memberships**. Checkout URLs should point to a hosted payment page.

Seat holds are created transactionally in Supabase and expire after 15 minutes.
The SQL prevents double-booking. A trusted payment webhook/Edge Function still
needs to change ticket orders from `pending` to `paid` and membership orders from
`pending` to `active`; never perform that step in browser JavaScript or expose a
`service_role` key.

> **Which key?** The **anon public** key is safe to put in `index.html` — it's
> designed for browsers and is protected by the database rules from step 2.
> **Never** put the `service_role` (secret) key in the site.

---

## Advanced: editing `js/data.js` by hand (optional)

You don't need this — the admin panel covers everything — but `js/data.js` is
the plain-text starting content, heavily commented. It defines the empty
defaults and the pre-filled Info text. If you edit it directly, keep the
punctuation (`"quotes"`, commas, `{ }`, `[ ]`) intact. Note that saved admin
edits in your browser will take over from this file until you Reset.

---

## The Videos page (media hub)

A full broadcast hub lives at the **Videos** tab in the nav. It's entirely
data-driven — you never edit the layout, just add entries in the admin panel.

- **Featured section** — shows your livestream when you're live (big animated
  player, LIVE badge, viewers, start time, Watch Live). When offline it shows a
  clean placeholder plus a countdown to your next scheduled fight (it reuses the
  main event from the Upcoming tab).
- **Past Broadcasts** — a responsive grid of recording cards with thumbnails,
  hover animations, and a click-to-play embedded YouTube player. It grows
  automatically as you add more.
- **Search & filters** — instant search, sort by newest / oldest / most viewed,
  and filter by year or event.
- **Featured Events carousel** — anything you mark "featured" shows in a
  horizontal highlight reel (great for championship or historic fights).

**YouTube IDs:** for both recordings and the livestream you just paste the
video's ID — the part after `watch?v=` in a YouTube URL (e.g. `dQw4w9WgXcQ`).
Thumbnails are pulled from YouTube automatically.

**Optional auto-detect:** if you add a **channel ID** and a **YouTube Data API
key** in the Livestream tab, the page polls YouTube once a minute and flips
itself live automatically when you start streaming — no manual toggle. Without a
key it just uses the Live now switch. (The key is visible in the page source, so
use a key restricted to the YouTube Data API.)

---

## Images: partner logos & event banners

You can add sponsor logos and event banners just by dropping image files into
the right folder — no code editing. The site looks for a file named after the
item (lowercased, spaces become hyphens) and uses it if found.

- **Partner logos** → put files in `assets/sponsors/`. Name each file after the
  sponsor: sponsor "Acme Corp" → `acme-corp.png` (`.jpg`/`.jpeg` also work). If no
  file matches, the sponsor's name shows as text instead. See
  `assets/sponsors/README.txt`.
- **Event banners** → put files in `assets/banners/`. Name each file after the
  **event**: event "GFC 5: Firestorm" → `gfc-5-firestorm.png`. Banners appear on
  the main event card, inside expanded history rows, and on event posters. If no
  file matches, no banner shows (nothing breaks). See `assets/banners/README.txt`.

After adding image files, redeploy the site (drag the folder to Cloudflare
again) so the new files are uploaded.

### Uploading images from the admin (no redeploy)

If you've connected Supabase (cloud saving), you can skip the folders entirely
and **upload logos and banners straight from the admin panel** — they publish to
everyone instantly, no redeploy. One-time setup:

1. In Supabase → **Storage → New bucket**, name it exactly `media`, turn
   **Public bucket ON**, and Create.
2. In the **SQL Editor**, run `SUPABASE_STORAGE.sql` (included with the site).

After that, the Sponsors, Upcoming, Results, and Posters forms show an **Upload
image** button (PNG/JPG, up to 5 MB). Uploading a new image keeps the old one
and uses the newest. A **Remove** button clears the image and deletes it from
storage when you Save (Remove then Cancel changes nothing). If you ever turn
cloud off, the filename-probe folders above still work as a fallback.

**Note on the admin:** when adding upcoming fights, results, or posters, the
fighter fields are now **dropdowns** listing your registered fighters — so you
pick from the roster instead of typing names. Register a fighter in the
**Fighters** tab first, and they'll appear in those menus.

---

## Link preview (Discord & social)

When the site link is shared (e.g. pasted in Discord), it unfurls into a card
with the league name, a description, and a branded image. This is set by the
Open Graph tags in `index.html`.

The preview image is hosted on **Supabase Storage** (the public `media` bucket),
so it loads reliably no matter how the site is deployed. To set it up, upload
`assets/og-image.png` to that bucket once (Supabase dashboard → Storage → media
→ Upload file). To change the image later, replace that file (keep it ~1200x630).

---

## Swapping colors / fonts (optional)

Open `css/style.css`. The very top has a `:root` block with every color as a
named variable — change them in one place:
```css
--blood:  #d32f2f;   /* main red accent   */
--ember:  #ff5a2c;   /* particle / glow   */
--gold:   #f5c542;   /* champions only    */
--void:   #08080a;   /* page background   */
```

---

## Notes
- Fighter skins are pulled live from `mc-heads.net` by username — they appear
  the moment the page opens in a browser with internet access. Any real
  Minecraft username works; no image files to upload.
- Works offline for everything except the live skin images and web fonts.
- There's also a single-file version, **`GFC-standalone.html`**, with the CSS,
  JavaScript, and logo all embedded into one file — handy for emailing or
  quick sharing. The admin panel works there too.
