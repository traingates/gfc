/* ============================================================================
   GFC — GLOBAL FIGHT CLUB
   SEED / DEFAULT DATA
   ----------------------------------------------------------------------------
   This file holds the STARTING content for the site. Once you log fighters,
   fights, rankings, history, and news through the ADMIN PANEL (open #admin),
   your changes are saved in the browser and take over from these defaults.

   You normally won't edit this file by hand — use the admin panel instead.
   (The admin panel can also EXPORT an updated version of this file for backup
   or for deploying the site online.)

   The site starts EMPTY on purpose: no fighters, no rankings, no history,
   no fights, no news — nothing is "logged" yet. The Info page text below is
   pre-filled but fully editable in the admin panel.
   ============================================================================ */

const GFC_DATA = {

  // Schema version — used to safely upgrade saved data. Don't change.
  version: 2,

  /* ---- ORGANIZATION · branding + the numbers on the stats strip ---------- */
  org: {
    name: "Global Fighting Championship",   // the league's name (edit in admin › Settings)
    short: "GFC",
    tagline: "",                 // hero tagline — empty until you set it in Settings
    // Start at zero — nothing has been logged yet. Editable in admin › Settings.
    stats: {
      totalFights: 0,
      totalKOs: 0,
      championsCrowned: 0,
      eventsHeld: 0
    }
  },

  /* ---- CONTENT · all empty until you log it in the admin panel ----------- */
  upcomingFights: [],   // scheduled fights (the one marked main drives the countdown)
  rankingOrder:   [],   // ordered list of fighter usernames (#1 = champion)
  featuredFighter: "",  // username to spotlight on the home page
  fighters:       [],   // the roster
  news:           [],   // news / announcements
  history:        [],   // past event results (the timeline)
  hallOfFame:     [],   // inducted legends
  posters:        [],   // event poster gallery
  sponsors:       [],   // partner name slots
  membershipPlans: [], // purchasable membership tiers managed from the admin

  /* ---- COMMERCE · public ticketing + account configuration --------------- */
  commerce: {
    currency: "DC$",
    ticketHelp: "Select your seats, sign in with Discord, then continue to checkout.",
    membershipHelp: "Support GFC and unlock member benefits.",
    discordInvite: ""
  },

  /* ---- VIDEOS · the media hub (Videos page) ------------------------------ */
  // Livestream — empty/offline by default. Turn it on in admin › Livestream.
  livestream: {
    active:    false,  // ON = pinned live player at the top of the Videos page
    title:     "",     // stream title shown next to the LIVE badge
    youtubeId: "",     // the live broadcast's YouTube video ID (for the embed)
    channelId: "",     // optional: channel ID (enables channel live embed + auto-detect)
    apiKey:    "",     // optional: YouTube Data API key → real auto-detect of live status
    viewers:   "",     // optional viewer count (leave blank to hide)
    startedAt: "",     // optional ISO datetime the stream started (e.g. 2026-07-20T19:00)
    thumbnail: ""      // optional poster image URL (else the YouTube thumbnail is used)
  },
  videos: [],          // past broadcasts / recordings — add them in admin › Videos

  /* ---- INFO PAGE · empty by default — fill it in via admin › Info Text ----- */
  info: {
    about:      "",   // league description paragraph
    howItWorks: [],   // { step, text } cards
    howToJoin:  "",   // recruitment paragraph
    rules:      [],   // list of rule strings
    faq:        [],   // { q, a } entries
    staff:      []    // { name, role, skin, note } entries
  }
};

/* Make the data available to the rest of the site. Don't edit below this line. */
window.GFC_DATA = GFC_DATA;
