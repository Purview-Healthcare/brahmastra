/* Suite 26: the page shell and the roster. CSV cells that would run as formulas, the page and its params in the address
   (Back and reload), the denial name without a dash, plural day counts, the Client 360 report wording, the admin saving
   their own Team row, and a Shastra roster with clashing rows (same email, same name without email, "Sr. Team Lead"). */
import vm from "vm"; import fs from "fs";
import { makeRig, REPO } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "", location: "Pune", doj: "2026-03-01", exit_date: null, email: "", ...o });
let feed = [P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", email: "tina@purview-healthcare.com", reports_to: "" }), P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "E8", name: "Bela Agent", email: "bela@purview-healthcare.com" }), P({ emp_id: "E10", name: "Lena Lake", position: "Team Lead", project: "Lakeview Dental Group", email: "lena@purview-healthcare.com", reports_to: "" })];
const fetchMock = async (url, init, real) => (url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : real(url, init));
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp: T, sha, app } = rig;
await rig.app.seedDemo(() => {});
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
const sync = async () => { await DB.prepare("UPDATE settings SET value_json = json_set(value_json, '$.at', 1) WHERE key='shastra_sync'").run(); return T(() => A("roster.syncShastra")); };
const people = async () => q("SELECT name, emp_id, email, active, role, roster_kind FROM users");
const who = async (n) => (await people()).filter((u) => u.name === n);

S("CSV cells that would run as formulas");
const csv = app.toCSV([{ a: '=HYPERLINK("http://x","y")', b: "+1 555", c: "-cmd", d: "@SUM(A1)", e: "\tx", f: -12.5, g: "-40", h: "plain" }], ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => ({ key: k, label: k })));
const cells = csv.split("\r\n")[1];
ok("=, +, -, @ and a tab get a leading '", /^"'=HYPERLINK\(""http:\/\/x"",""y""\)",'\+1 555,'-cmd,'@SUM\(A1\),'\tx,/.test(cells), cells);
ok("numbers (negative ones too) stay numbers", /,-12\.5,-40,plain$/.test(cells), cells);
const acsv = app.arrayCSV(["=h"], [["=1+1"], [5]]);
ok("arrayCSV guards the header and the rows", acsv === "'=h\r\n'=1+1\r\n5", acsv);

S("The page and its params in the address");
const nh = (v, p) => vm.runInContext(`navHash(${JSON.stringify(v)}, ${JSON.stringify(p)})`, app);
ok("params go into the hash", nh("claims", { client_id: "c1", state: "open", min_age: 91 }) === "#/claims?client_id=c1&state=open&min_age=91", nh("claims", { client_id: "c1", state: "open", min_age: 91 }));
ok("no params: just the page", nh("dashboard", null) === "#/dashboard");
app.location.hash = nh("dashboard", { tab: "inventory", client_id: "abc" });
const back = app.hashNav();
ok("hashNav reads them back (reload keeps the page and its params)", back.view === "dashboard" && back.params.tab === "inventory" && back.params.client_id === "abc", back);
app.history.state = { bnav: { view: "dashboard", params: { tab: "inventory", client_id: "abc", n: 5 } } };
const fromHist = vm.runInContext("navFromHistory()", app);
ok("Back restores the params object from history (numbers stay numbers)", fromHist.params.n === 5, fromHist);
let replaced = null; app.history.replaceState = (st, t, url) => { replaced = { st, url }; };
app.history.state = { bnav: { view: "dashboard", params: { tab: "team" } } }; app.location.hash = "#/dashboard?tab=team";
vm.runInContext("navKeep({ tab: 'inventory', client_id: 'c9' })", app);
ok("a tab or client picked in a page is kept in the current history entry", replaced && replaced.url === "#/dashboard?tab=inventory&client_id=c9" && replaced.st.bnav.params.client_id === "c9", replaced);
const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
ok("go() adds a history entry (pushState), not only replaceState", /history\.pushState\(\{ bnav: next \}/.test(src));
ok("a page error is caught inside the page (PageBoundary keeps the menu)", /class PageBoundary extends \(React\.Component/.test(src) && /<PageBoundary onHome=/.test(src) && /This page hit a problem/.test(src));

S("Wording");
const lib = { window: {} }; vm.createContext(lib); vm.runInContext(fs.readFileSync(REPO + "/lib/denial-library.js", "utf8"), lib);
const names = lib.window.DENIAL_LIBRARY.map((x) => x.name);
ok("denial name has no em dash, in the library and its aliases", names.includes("Non-covered: provider out of network") && !names.some((n) => n.includes("—")) && lib.window.DENIAL_ALIASES["Non-covered: provider out of network"], names.filter((n) => /Non-covered/.test(n)));
ok("the SAAG map points at the same name", src.includes('"Provider not Credential/OON": "Non-covered: provider out of network"'));
ok("the app's own wording has no em dash in that name", !src.includes("Non-covered —"));
ok("no 'Portfolio' in the Settings digest text", !/Client 360 or Portfolio/.test(src));
ok("plural() gives 1 day / 2 days", vm.runInContext("plural(1, \"day\") + \"|\" + plural(2, \"day\") + \"|\" + plural(0, \"day\")", app) === "1 day|2 days|0 days");
ok("day counts on the page use plural()", !/\{c\.age_days\} days|\$\{c\.age_days\} days|\{r\.days_to_clear\} days|\{c\.follow_up_days\} days|\} days over 1 h/.test(src));
const wsrc = fs.readFileSync(REPO + "/worker.js", "utf8");
ok("server errors say Client 360 report", !/Client reports are for/.test(wsrc) && /The Client 360 report is for team leads and above\./.test(wsrc));
const cl = (await A("clients.list")).clients[0];
await A("clients.save", { id: cl.id, name: cl.name, code: cl.code, follow_up_days: 1, active: true });
const au = await q("SELECT detail FROM audit_log WHERE detail LIKE '%default follow-up%' ORDER BY at DESC LIMIT 1");
ok("audit text: '1 day', not '1 days'", au.length && (/→ 1 day\b/.test(au[0].detail) && !/1 days/.test(au[0].detail)), au);

S("The admin saves their own Team row");
const meU = (await A("auth.me")).user;
const self = (await A("users.list")).users.find((u) => u.id === meU.id);
const r9 = await T(() => A("users.save", { id: self.id, first_name: self.first_name || "Bob", last_name: self.last_name || "Builder", designation: self.designation || "Admin", role: "supervisor", capacity: 40, active: true }));
ok("saving your own row (a new daily target) works for the admin", r9.ok, r9);
const r9b = await T(() => A("users.save", { id: self.id, first_name: self.first_name || "Bob", last_name: self.last_name || "Builder", role: "supervisor", capacity: 40, active: false }));
ok("deactivating yourself is still refused", !r9b.ok && /deactivate or demote your own/.test(r9b.e), r9b);

S("Roster: clashing rows are skipped with a warning, the rest applies");
let r = await sync();
ok("first sync applies", r.ok, r);
const tina0 = (await who("Tina Lead"))[0];
feed = feed.map((p) => (p.name === "Bela Agent" ? { ...p, department: "Submission" } : p));
feed.push(P({ emp_id: "E20", name: "Dup One", email: "dup@purview-healthcare.com" }), P({ emp_id: "E21", name: "Dup Two", email: "dup@purview-healthcare.com" }));
feed.push(P({ name: "No Mail", email: "" }), P({ name: "No Mail", email: "" }));
r = await sync();
ok("a duplicate email no longer fails the sync", r.ok, r);
ok("Dup One and Dup Two are both skipped (no account takes the shared email)", !(await who("Dup One")).length && !(await who("Dup Two")).length, await q("SELECT name, email FROM users WHERE email LIKE 'dup%'"));
ok("the two same-name rows without email are skipped too", !(await who("No Mail")).length, await who("No Mail"));
ok("each skipped row has a clear warning", r.ok && r.r.warnings.filter((w) => w.skipped).length === 4 && r.r.warnings.some((w) => w.name === "Dup One" && /same email as Dup Two/.test(w.issues[0])) && r.r.warnings.some((w) => w.name === "No Mail" && /no email and no Emp ID/.test(w.issues[0])), r.ok && r.r.warnings);
ok("the rest of the feed is applied (Bela's department change)", (await q("SELECT department FROM users WHERE name = 'Bela Agent'"))[0].department === "Submission");
const ss = await q("SELECT value_json FROM settings WHERE key = 'shastra_sync'");
ok("the Roster card records a good sync with its warnings", JSON.parse(ss[0].value_json).ok === true && JSON.parse(ss[0].value_json).warnings >= 4, ss);
// Dup One already has an account; a second row with the same email arrives later: Dup One keeps theirs, nobody is renamed
feed = feed.filter((p) => !/^(Dup Two|No Mail)$/.test(p.name));
r = await sync();
const d1 = await who("Dup One");
ok("once fixed in Shastra, Dup One is added", r.ok && d1.length === 1 && d1[0].email === "dup@purview-healthcare.com", d1);
feed.push(P({ emp_id: "E21", name: "Dup Two", email: "dup@purview-healthcare.com" }));
r = await sync();
const d1b = await who("Dup One");
ok("a new row with Dup One's email does not take over Dup One's account", r.ok && d1b.length === 1 && d1b[0].active === 1 && d1b[0].emp_id === "E20" && !(await who("Dup Two")).length, { d1b, dup2: await who("Dup Two") });
ok("Dup One is not switched off while the clash waits", d1b[0].active === 1);
// a row matching an existing account by name only, while that name is already taken in this feed
feed = feed.filter((p) => p.name !== "Dup Two");
feed.push(P({ emp_id: "E50", name: "Arun Agent", email: "arun2@purview-healthcare.com" }));
r = await sync();
const aruns = await who("Arun Agent");
ok("a second 'Arun Agent' (other email and Emp ID) gets their own account; the first keeps theirs", r.ok && aruns.length === 2 && aruns.some((u) => u.email === "arun@purview-healthcare.com" && u.emp_id === "E2") && aruns.some((u) => u.email === "arun2@purview-healthcare.com"), aruns);
feed = feed.filter((p) => p.emp_id !== "E50");
// a forced database clash still gives plain words (an account outside the roster holds the email Shastra now sends)
await DB.prepare("INSERT INTO users (id, email, name, role, pass_salt, pass_hash, must_change, active, capacity, created_at, source) VALUES ('hand1', 'clash@purview-healthcare.com', 'Hand Made', 'user', '', '', 0, 1, 35, 1, '')").run();
feed = feed.map((p) => (p.name === "Bela Agent" ? { ...p, email: "clash@purview-healthcare.com" } : p));
r = await sync();
ok("an email held by another account: never written twice, no raw database text", (r.ok || !/UNIQUE/.test(r.e)) && (await q("SELECT COUNT(*) AS n FROM users WHERE email = 'clash@purview-healthcare.com'"))[0].n === 1, r.ok ? r.r.warnings.filter((w) => w.name === "Bela Agent") : r.e);
feed = feed.map((p) => (p.name === "Bela Agent" ? { ...p, email: "bela@purview-healthcare.com" } : p));

S("Roster: position text");
feed = feed.map((p) => (p.name === "Tina Lead" ? { ...p, position: "Sr. Team Lead" } : p));
r = await sync();
let tina = (await who("Tina Lead"))[0];
ok("a team lead whose position becomes 'Sr. Team Lead' stays an active team lead", r.ok && tina.active === 1 && tina.role === "supervisor" && tina.roster_kind === "lead" && tina.emp_id === tina0.emp_id, tina);
feed = feed.map((p) => (p.name === "Tina Lead" ? { ...p, position: "  TEAM   LEAD " } : p));
r = await sync(); tina = (await who("Tina Lead"))[0];
ok("odd spacing and case still read as Team Lead", r.ok && tina.active === 1 && tina.roster_kind === "lead", tina);
feed.push(P({ emp_id: "E60", name: "Asha Manager", position: "Senior Assistant Manager", email: "asha@purview-healthcare.com", reports_to: "" }), P({ emp_id: "E61", name: "Ravi Asst", position: "Asst. Manager", email: "ravi@purview-healthcare.com", reports_to: "" }));
r = await sync();
const asha = (await who("Asha Manager"))[0], ravi = (await who("Ravi Asst"))[0];
ok("Senior Assistant Manager and Asst. Manager are managers", asha && asha.roster_kind === "manager" && ravi && ravi.roster_kind === "manager", { asha, ravi });
feed = feed.map((p) => (p.name === "Tina Lead" ? { ...p, position: "Operations Lead Specialist" } : p));
r = await sync(); tina = (await who("Tina Lead"))[0];
ok("an unrecognised new position keeps a known lead (with a warning), not deactivated", r.ok && tina.active === 1 && tina.roster_kind === "lead" && r.r.warnings.some((w) => w.name === "Tina Lead" && /position not recognised/.test(w.issues.join(" "))), { tina, w: r.ok && r.r.warnings.filter((w) => w.name === "Tina Lead") });
feed = feed.map((p) => (p.name === "Tina Lead" ? { ...p, position: "Director" } : p));
feed = feed.map((p) => (p.name === "Tina Lead" ? { ...p, position: "Team Lead", department: "HR" } : p));
r = await sync(); tina = (await who("Tina Lead"))[0];
ok("HR still means no access", r.ok && (!tina || tina.active === 0), tina);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
