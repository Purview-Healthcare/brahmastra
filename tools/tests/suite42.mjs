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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
