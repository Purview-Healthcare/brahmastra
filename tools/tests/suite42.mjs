/* suite42: regression checks for the bug-test fixes on pages, roles and themes (tester H): pop-ups (Escape, a click on the
   shade, typed text, Tab), Claims per day, money and dates in one style, wording, the dark themes and the digest PDF, the
   Feedback tab, the top bar on a tablet and long names on a phone. Page-only fixes are checked on the page's own code (the
   built app.js, run in the rig, and app.jsx) and its CSS (index.html, with the contrast worked out from the theme colours);
   the browser proofs are in the bug-test folder. Made-up data only. */
import fs from "fs";
import vm from "vm";
import { makeRig, REPO } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const rig = await makeRig({});
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const A = as((await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") })).token);
const ev = (s) => vm.runInContext(s, rig.app);
const SRC = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
const HTML = fs.readFileSync(REPO + "/index.html", "utf8");
// one component's code in app.jsx: from "function Name(" to the next top-level function
const fnSrc = (name) => { const i = SRC.indexOf("\nfunction " + name + "("); if (i < 0) return ""; const j = SRC.indexOf("\nfunction ", i + 10); return SRC.slice(i, j < 0 ? undefined : j); };
// The page's CSS as rules ({ media, sel, body }, media "" outside any @media), the theme colours as index.html defines
// them, and the contrast of text on a background (WCAG: 4.5 to 1 for text)
const CSS = HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = []; { let media = "", m; const re = /(@media[^{]*)\{|([^{}]+)\{([^{}]*)\}|\}/g; while ((m = re.exec(CSS))) { if (m[1]) media = m[1].slice(6).trim(); else if (m[2] !== undefined) RULES.push({ media, sel: m[2].trim(), body: m[3] }); else media = ""; } }
const decls = (body) => { const out = {}; for (const d of body.split(";")) { const k = d.indexOf(":"); if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim(); } return out; };
// the declarations of every rule whose selector list holds `sel`, in that @media (none: outside any), merged in order
const rule = (sel, media = "") => Object.assign({}, ...RULES.filter((r) => r.media === media && r.sel.split(",").map((x) => x.trim()).includes(sel)).map((r) => decls(r.body)));
const LIGHT = rule(":root"), THEME = { light: LIGHT, navy: { ...LIGHT, ...rule(':root[data-theme="navy"]') }, gold: { ...LIGHT, ...rule(':root[data-theme="gold"]') } };
const rgba = (c) => { c = String(c).trim(); let m = c.match(/^#([0-9a-f]{6})$/i); if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)).concat(1); m = c.match(/^rgba?\(([^)]+)\)$/); if (m) { const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; } return null; };
const over = (top, bot, alpha = 1) => { const a = top[3] * alpha; return [0, 1, 2].map((k) => top[k] * a + bot[k] * (1 - a)).concat(1); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
// a colour in a theme (tokens: the theme's values; var(--x) followed until it is a colour)
const col = (theme, v, toks = THEME[theme]) => { let x = String(v).trim(); for (let k = 0; k < 6; k++) { const m = x.match(/^var\((--[\w-]+)\)$/); if (!m) break; x = String(toks[m[1]]).trim(); } return rgba(x); };

S("Pop-ups: Escape, the shade, typed text and Tab (H-01, H-02, H-13, H-14, H-15)");
const layered = ["Modal", "ClaimDrawer", "CommandPalette", "DiscardAsk", "AlertLayer", "SidePanel"];
ok("H-13: every pop-up is a layer of the one shared behaviour (Modal, the claim profile, Ctrl+K, the ask box, the alert, the side panels)",
  layered.every((n) => /useLayer\(/.test(fnSrc(n)) && /data-layer=""/.test(fnSrc(n))), layered.filter((n) => !(/useLayer\(/.test(fnSrc(n)) && /data-layer=""/.test(fnSrc(n)))));
ok("H-14: Claim history and How it works open as side panels (layers of their own), the not-logged-in alert as an alert layer",
  /<SidePanel label="Claim history"/.test(fnSrc("ClaimHistory")) && /<SidePanel className="rh-how"/.test(fnSrc("HowDrawer")) && /<AlertLayer className="miss-pop"/.test(fnSrc("MissingAlertPopup")));
ok("H-13: no pop-up keeps an Escape listener of its own that ignores what is on top of it",
  !/addEventListener\("keydown", esc\)/.test(fnSrc("HowDrawer")) && !/querySelectorAll\("\.overlay"\)/.test(fnSrc("ClaimDrawer")) && !/e\.key === "Escape" && onClose/.test(fnSrc("Modal")));
const hook = fnSrc("useLayer");
ok("H-13: only the top layer answers Escape and Tab, and never a key a dropdown already took", /topLayer\(\) !== el/.test(hook) && /e\.defaultPrevented/.test(hook) && /e\.key === "Escape"/.test(hook) && /e\.key !== "Tab"/.test(hook));
// topLayer: the last [data-layer] in the page
ev(`var __layers = []; document.querySelectorAll = (s) => (s === "[data-layer]" ? __layers : []);`);
ev(`__layers = [{ id: "claim profile" }, { id: "history panel" }];`);
ok("H-14: with the Claim history panel open inside the claim profile, the panel is the top layer", ev("topLayer().id") === "history panel");
ev(`__layers = [{ id: "task" }, { id: "close the task" }, { id: "ask" }];`);
ok("H-13: a box on a box: the last one opened is the top layer", ev("topLayer().id") === "ask");
ev(`__layers = [];`);
ok("H-13: no pop-up open: no top layer", ev("topLayer()") === null);
ok("H-01: a dropdown takes Escape first while its list is open (capture phase, stopped there), in Combo and SuggestCombo",
  /addEventListener\("keydown", k, true\)/.test(fnSrc("useComboEsc")) && /e\.stopPropagation\(\)/.test(fnSrc("useComboEsc")) && /useComboEsc\(open, setOpen\)/.test(fnSrc("Combo")) && /useComboEsc\(open, setOpen\)/.test(fnSrc("SuggestCombo")));
// typedIn: a box whose text changed since it was first touched, still in the pop-up
ev(`var __root = { contains: (el) => el.inside !== false };`);
ok("H-02: a note typed in a pop-up counts as typed text", ev(`typedIn(new Map([[{ isConnected: true, value: "Called the payer" }, ""]]), __root)`) === true);
ok("H-02: a box left as it was (or typed and put back) does not", ev(`typedIn(new Map([[{ isConnected: true, value: "CLM-1" }, "CLM-1"]]), __root)`) === false);
ok("H-02: a box no longer on the page (saved and cleared, or closed) does not", ev(`typedIn(new Map([[{ isConnected: false, value: "x" }, ""]]), __root)`) === false);
ok("H-02: a box outside this pop-up does not", ev(`typedIn(new Map([[{ isConnected: true, value: "x", inside: false }, ""]]), __root)`) === false);
ok("H-02: Escape, the shade and the Close button all ask first when something was typed: Discard what you typed? (Keep editing / Discard)",
  /setAsking\(true\)/.test(hook) && /e\.preventDefault\(\); close\(\)/.test(hook) && /onClick=\{L\.close\}>Close</.test(fnSrc("Modal")) && /onClick=\{L\.close\}>Close</.test(fnSrc("ClaimDrawer"))
  && /Discard what you typed\?/.test(fnSrc("DiscardAsk")) && /autoFocus onClick=\{onKeep\}>Keep editing</.test(fnSrc("DiscardAsk")) && />Discard<\/button>/.test(fnSrc("DiscardAsk")));
ok("H-02: a dropdown's own search box is not counted as typed text", /closest\("\.combo-list"\)/.test(hook));
// tabStop: where Tab and Shift+Tab go inside the top pop-up
ok("H-15: Tab on the last part wraps to the first", ev(`tabStop(["a", "b", "c"], "c", false)`) === "a");
ok("H-15: Shift+Tab on the first part wraps to the last", ev(`tabStop(["a", "b", "c"], "a", true)`) === "c");
ok("H-15: Tab from outside the pop-up (or from its box) goes to its first part, Shift+Tab to its last", ev(`tabStop(["a", "b", "c"], "page", false)`) === "a" && ev(`tabStop(["a", "b", "c"], "page", true)`) === "c");
ok("H-15: in the middle the browser moves on by itself (it stays inside)", ev(`tabStop(["a", "b", "c"], "b", false)`) === null && ev(`tabStop(["a", "b", "c"], "b", true)`) === null);
ok("H-15: a pop-up with nothing to focus keeps the focus on its box", ev(`tabStop([], "page", false)`) === "box");
ok("H-15: focus starts inside a pop-up that opens on top, and goes back where it was when it closes",
  /topLayer\(\) === el && !el\.contains\(document\.activeElement\)/.test(hook) && /opener\.focus\(/.test(hook) && /tabIndex=\{-1\}/.test(fnSrc("Modal")) && /tabIndex=\{-1\}/.test(fnSrc("ClaimDrawer")));
ok("H-15: the focused pop-up box shows no outline of its own", /\.modal:focus,\.cmdk:focus,\.hist:focus\{outline:none\}/.test(HTML));

S("Claims per day: a number outside 1 to 500 is refused, never saved as another number (H-11), and the default follow-up the same");
const users0 = (await A("users.list")).users, biller = users0.find((u) => u.role === "user" && u.active);
const capOf = async (id) => (await rig.backend.env.DB.prepare("SELECT capacity FROM users WHERE id = ?").bind(id).all()).results[0].capacity;
const saveB = (cap) => T(() => A("users.save", { id: biller.id, first_name: biller.first_name || "Arun", last_name: biller.last_name || "Agent", designation: biller.designation, role: "user", active: true, ...(cap === undefined ? {} : { capacity: cap }) }));
let r = await saveB(40);
ok("H-11: 40 claims a day is saved as 40", r.ok && (await capOf(biller.id)) === 40, r);
for (const v of [9999, 0, -3, 2.5, "1e3", "", " ", "abc", 501, "500.5"]) {
  r = await saveB(v);
  ok(`H-11: Claims per day ${JSON.stringify(v)} is refused with a plain message and nothing changes`, !r.ok && r.status === 400 && r.e === "Claims per day must be a whole number from 1 to 500." && (await capOf(biller.id)) === 40, [r, await capOf(biller.id)]);
}
r = await saveB("500");
ok("H-11: 500 (typed in the box, so text) is saved as 500", r.ok && (await capOf(biller.id)) === 500, r);
r = await saveB(undefined);
ok("H-11: a save without Claims per day keeps it as it is (it used to become 35)", r.ok && (await capOf(biller.id)) === 500, [r, await capOf(biller.id)]);
await saveB(35);
r = await T(() => A("users.save", { first_name: "Nova", last_name: "Hand", email: "nova.hand@purview-healthcare.com", designation: "Biller", role: "user", capacity: 0, active: true }));
ok("H-11: a new person with Claims per day 0 is refused and not created", !r.ok && /Claims per day must be a whole number from 1 to 500/.test(r.e || "") && !(await A("users.list")).users.some((u) => u.email === "nova.hand@purview-healthcare.com"), r);
r = await T(() => A("users.save", { first_name: "Nova", last_name: "Hand", email: "nova.hand@purview-healthcare.com", designation: "Biller", role: "user", active: true }));
ok("H-11: a new person without Claims per day starts at 35", r.ok && r.r.user.capacity === 35, r);
ok("H-11: the page's own check: 1 to 500 whole numbers only", ev(`[wholeIn(35, 1, 500), wholeIn("500", 1, 500), wholeIn(" 7 ", 1, 500), wholeIn("9999", 1, 500), wholeIn("0", 1, 500), wholeIn("", 1, 500), wholeIn("2.5", 1, 500), wholeIn("1e3", 1, 500), wholeIn("-3", 1, 500), wholeIn(null, 1, 500)].join()`) === "true,true,true,false,false,false,false,false,false,false");
const team = fnSrc("TeamView");
ok("H-11: the box says the range (1 to 500), says what is wrong in plain words, and Save is off until it is right",
  /"1 to 500 · the default for allocation"/.test(team) && /Claims per day must be a whole number from 1 to 500\./.test(team) && /!wholeIn\(edit\.capacity, 1, 500\)\} onClick=\{save\}/.test(team));
const cl = (await A("clients.list")).clients[0];
const fuOf = async () => (await rig.backend.env.DB.prepare("SELECT follow_up_days FROM clients WHERE id = ?").bind(cl.id).all()).results[0].follow_up_days;
const saveC = (fu) => T(() => A("clients.save", { id: cl.id, name: cl.name, code: cl.code, active: true, ...(fu === undefined ? {} : { follow_up_days: fu }) }));
r = await saveC(21);
ok("H-11 (same mistake): a default follow-up of 21 days is saved as 21", r.ok && (await fuOf()) === 21, r);
for (const v of [999, 0, "", 2.5]) {
  r = await saveC(v);
  ok(`H-11 (same mistake): a default follow-up of ${JSON.stringify(v)} is refused with a plain message and nothing changes`, !r.ok && r.e === "The default follow-up must be a whole number of days from 1 to 365." && (await fuOf()) === 21, [r, await fuOf()]);
}
r = await saveC(undefined);
ok("H-11 (same mistake): a client save without the follow-up keeps it (it used to become 30)", r.ok && (await fuOf()) === 21, [r, await fuOf()]);
ok("H-11 (same mistake): the client profile form says 1 to 365 and lists a wrong follow-up under Still needed",
  /wholeIn\(f\.follow_up_days, 1, 365\)/.test(fnSrc("profileMissing")) && /"1 to 365"/.test(fnSrc("ClientProfileForm")));

S("The Feedback tab: readable in every theme (H-03)");
const fb = rule(".fb-tab");
ok("H-03: the Feedback tab's text is the dark ink the primary buttons use on teal and gold", fb.color === "var(--pri-ink)" && fb.background === "var(--teal)", fb);
for (const th of ["light", "navy", "gold"]) {
  const paper = col(th, "var(--paper)"), op = Number(fb.opacity || 1);
  const bg = over(col(th, fb.background), paper, op), fg = over(col(th, fb.color), paper, op);
  const k = ratio(fg, bg);
  ok(`H-03: ${th}: the Feedback tab text is at least 4.5 to 1 (now ${k} to 1; it was about 2 to 1 in white)`, k >= 4.5, { th, k });
}

S("Navy and Gold: the Monday digest and Inventory status in the theme's own colours (H-04); the digest PDF always light (H-10)");
const DARK = ["navy", "gold"];
for (const th of DARK) {
  const card = col(th, "var(--card)");
  for (const [k, w] of [["r", "red"], ["a", "amber"], ["g", "green"]]) {
    const v = ratio(col(th, rule(`.dd-kpis .${k} b`).color), card);
    ok(`H-04: ${th}: the digest's ${w} figure is at least 4.5 to 1 on the card (${v})`, v >= 4.5, { th, k, v });
  }
  for (const b of ["", ".ok", ".warn", ".miss"]) {
    const R = { ...rule(".dd-dial"), ...(b ? rule(".dd-dial" + b) : {}) }, bg = over(col(th, R.background), card), fg = over(col(th, R.color), bg), v = ratio(fg, bg);
    ok(`H-04: ${th}: the score circle${b ? " " + b.slice(1) : ""} takes the theme's tint (not a light disc), its text at least 4.5 to 1 (${v})`, lum(bg) < 0.2 && v >= 4.5, { th, b, v, bg });
  }
  for (const b of [".g", ".r", ".a"]) {
    const R = rule(".dd-esc" + b), bg = over(col(th, R.background), card), v = ratio(over(col(th, R.color), bg), bg);
    ok(`H-04: ${th}: the escalation / TAT strip ${b.slice(1)} takes the theme's tint, its text at least 4.5 to 1 (${v})`, lum(bg) < 0.2 && v >= 4.5, { th, b, v });
  }
  for (const [k, mix] of [["red", 0.05], ["amber", 0.06], ["green", 0.06], ["blue", 0]]) {
    const sc = { red: "var(--sc-r)", amber: "var(--sc-a)", green: "var(--sc-g)", blue: "var(--card)" }[k];
    const bg = over(col(th, sc), card, mix), v = ratio(col(th, rule(`.inv-it.${k} .inv-num b`).color), bg);
    ok(`H-04: ${th}: Inventory status, the ${k} do-first figure is at least 4.5 to 1 (${v})`, v >= 4.5, { th, k, v });
  }
}
ok("H-04: Light keeps its own digest and Inventory status colours", ["#BA2340", "#935300", "#127A4D"].every((c, i) => String(col("light", rule(`.dd-kpis .${"rag"[i]} b`).color)) === String(rgba(c)))
  && String(col("light", rule(".dd-dial.ok").background)) === String(rgba("#E3F5EC")) && String(col("light", rule(".dd-esc.r").background)) === String(rgba("#FDE7EB"))
  && String(col("light", rule(".inv-it.blue .inv-num b").color)) === String(rgba("#2563EB")) && String(col("light", rule(".inv-it.red .inv-num b").color)) === String(col("light", "var(--sc-r)")));
const PR = rule("body.dd-printing", "print");
const needP = ["--paper", "--card", "--card2", "--ink", "--body", "--slate", "--faint", "--line", "--soft", "--tealink", "--chipbg", "--red-ink", "--amber-ink", "--green-ink", "--red-soft", "--amber-soft", "--green-soft",
  "--dd-r", "--dd-a", "--dd-g", "--dd-dial", "--dd-dial-ink", "--dd-ok", "--dd-warn", "--dd-miss", "--dd-esc-ink"];
ok("H-10: the digest PDF takes the Light theme's colours whatever the theme on screen", needP.every((k) => PR[k]), needP.filter((k) => !PR[k]));
const drift = Object.keys(PR).filter((k) => k.startsWith("--") && PR[k] !== LIGHT[k]);
ok("H-10: each colour the digest PDF takes is exactly Light's (kept in step with :root)", !drift.length, drift.map((k) => k + " " + PR[k] + " vs " + LIGHT[k]));
const pv = (v) => col("light", v, { ...LIGHT, ...PR });
ok("H-10: printed: a light page and white cards with dark text (at least 4.5 to 1)", lum(pv("var(--paper)")) > 0.8 && lum(pv("var(--card)")) > 0.95 && ratio(pv("var(--ink)"), pv("var(--card)")) >= 4.5 && ratio(pv("var(--dd-r)"), pv("var(--card)")) >= 4.5);
ok("H-10: the PDF button marks the page for that print (body.dd-printing)", /classList\.add\("dd-printing"\)/.test(fnSrc("DigestDashboard")));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
