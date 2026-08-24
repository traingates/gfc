/*
 * GFC smoke test (starter).
 *
 * Boots the built single-file site in a headless DOM (jsdom) and exercises the
 * core flows without a browser or a Supabase connection. Because there's no
 * network here, the app runs in LOCAL mode: cloud saving is off and the admin
 * login uses the offline password fallback (ADMIN_PW in js/app.js).
 *
 * Run:
 *     cd tests
 *     npm install
 *     node smoke.mjs        (or: npm test)
 *
 * This is a starting point — copy the pattern to cover new features you add.
 * The real project was validated with a larger suite of these (fighters,
 * results, rankings, videos, news, image uploads, etc.).
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build first (python3 build.py) so this file is up to date.
const html = fs.readFileSync(path.join(__dirname, "..", "GFC-standalone.html"), "utf8");

// Offline admin password (only used when Supabase isn't configured — i.e. here).
// The LIVE site ignores this and uses real Supabase Auth.
const LOCAL_PW = "5LiXFCZy8Qxy3o7nGpce";

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://example.test/",
  beforeParse(win) {
    // jsdom doesn't implement these; the app degrades gracefully, but stub them
    // so nothing throws during boot.
    win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    win.scrollTo = () => {};
    win.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, fillRect() {}, set globalAlpha(_) {}, set fillStyle(_) {}
    });
  },
});
const { window } = dom;
const { document } = window;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const fire = (el, t) => el && el.dispatchEvent(new window.Event(t, { bubbles: true }));
const nav = (h) => { window.location.hash = h; window.dispatchEvent(new window.PopStateEvent("popstate")); };
const set = (sel, v) => { const el = $(sel); el.value = v; fire(el, "input"); };

const results = [];
const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);

setTimeout(() => {
  try {
    // Boot + chrome
    ok("nav renders", $$(".nav-link").length > 0);
    ok("home view is active", $("#view-home") && $("#view-home").innerHTML.length > 200);

    // Public views exist and are empty by default (blank-slate build)
    nav("#fighters");
    ok("fighters view renders", !!$("#view-fighters"));

    // Admin: log in with the offline password
    nav("#admin");
    ok("admin login screen shows", !!$("#adminPw"));
    $("#adminPw").value = LOCAL_PW;
    click($("[data-admin='login']"));
    ok("logged in (tabs visible)", !!$(".admin-tabs") || !!$(".atab"));

    // Add a fighter and confirm it lands on the roster
    click($('[data-admin-tab="fighters"]'));
    click($('[data-add="fighters"]'));
    set('[data-path="username"]', "TestFighter");
    click($('[data-save="1"]'));

    // Add the second fighter required to create a ticketed bout.
    nav("#admin");
    click($('[data-admin-tab="fighters"]'));
    click($('[data-add="fighters"]'));
    set('[data-path="username"]', "SecondFighter");
    click($('[data-save="1"]'));

    // Ticketing admin fields produce a public seat map.
    click($('[data-admin-tab="fights"]'));
    click($('[data-add="fights"]'));
    set('[data-path="event"]', "GFC Test Night");
    set('[data-path="date"]', "2026-12-20");
    set('[data-path="fighter1"]', "TestFighter");
    set('[data-path="fighter2"]', "SecondFighter");
    const sale = $('[data-path="tickets.enabled"]'); sale.checked = true; fire(sale, "change");
    set('[data-path="tickets.venue"]', "Test Arena");
    set('[data-path="tickets.rows"]', "A,B");
    set('[data-path="tickets.seatsPerRow"]', "4");
    set('[data-path="tickets.price"]', "25");
    click($('[data-save="1"]'));
    nav("#tickets");
    ok("ticketed event appears", $("#view-tickets").textContent.includes("GFC Test Night"));
    click($("[data-ticket-event]"));
    ok("seat map renders", $$("[data-seat]").length === 8);
    click($("[data-seat='A1']"));
    ok("seat can be selected", $("[data-seat='A1']").classList.contains("selected"));

    // Membership plans are managed from the same control room.
    nav("#admin");
    click($('[data-admin-tab="memberships"]'));
    click($('[data-add="memberships"]'));
    set('[data-path="name"]', "Contender");
    set('[data-path="price"]', "10");
    set('[data-path="description"]', "Member access");
    click($('[data-save="1"]'));
    nav("#memberships");
    ok("membership plan appears", $("#view-memberships").textContent.includes("Contender"));

    nav("#fighters");
    ok("added fighter appears on roster", $("#view-fighters").textContent.includes("TestFighter"));

    // Fighter profile page routes correctly
    nav("#fighter=TestFighter");
    ok("dedicated profile page renders", $("#view-fighter").classList.contains("active") &&
       $("#view-fighter").textContent.includes("TestFighter"));
  } catch (e) {
    results.push(["FAIL", "threw: " + e.message]);
    console.error(e.stack);
  }

  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log("\n=== GFC SMOKE TEST ===");
  results.forEach(([s, n]) => console.log(s.padEnd(5), n));
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}, 400);
