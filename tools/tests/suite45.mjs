/* Suite 45: the owner's decisions after the bug test (fixer DA): month end closes on the 5th and last month's undone steps stay
   until done (E-18), Overtime on a day off is a day worked (B-01), an upload never loads claims into a switched-off location
   (N-17), a rejected recheck with nobody to send it to tells the team lead (N-02), Drishti opens with the Brahmastra sign-in
   once a code emailed to the address proved it (D-04), and wrong sign-in codes are counted per caller (D-07). Each check
   carries the decision it guards. A made-up Shastra roster with its holidays and floor feed, a stand-in for Drishti and a mail
   hook. Made-up data only: nothing here is a real person or claim. */
import crypto from "crypto";
import fs from "fs";
import vm from "vm";
import { makeRig, REPO } from "./rig.mjs";
process.setMaxListeners(50);   // one rig per world, each adds an exit listener
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const D = "@purview-healthcare.com";
// IST(2026, 11, 10, 9, 30) is 09:30 IST on 10 Nov 2026
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const N = (n) => "2026-11-" + String(n).padStart(2, "0");
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const B = (emp_id, name) => P({ emp_id, name, project: SUN, reports_to: "Tina Lead", shift: "09:00-18:00", email: name.split(" ")[0].toLowerCase() + D });
const FEED = () => [
  P({ emp_id: "V1", name: "Vera Vice", position: "Vice President", email: "vera" + D }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vera Vice", email: "mona" + D }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: "tina" + D }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: "lara" + D }),
  B("A1", "Arun Agent"), B("A2", "Otto Over"), B("A3", "Pat Present"), B("A4", "Sana Sunday"), B("A5", "Hana Holiday"), B("A6", "Walt Weekday"), B("A7", "Ned Nomark"),
  P({ emp_id: "PA", name: "Pavan Poster", department: "Posting", project: SUN, reports_to: "Tina Lead", email: "pavan" + D }),
  P({ emp_id: "SB", name: "Sahil Submitter", department: "Submission", project: SUN, reports_to: "Tina Lead", email: "sahil" + D }),
  // two team leads the roster has no email for
  P({ emp_id: "N1", name: "Nil Nomail", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: "" }),
  P({ emp_id: "N2", name: "Noor Nomail", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: "" }),
];
// Shastra's holidays: Diwali (Monday 9 Nov 2026) and New Year's Day 2027 (a Friday)
const HOLIDAYS = [{ date: "2026-11-09", name: "Diwali" }, { date: "2027-01-01", name: "New Year" }];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
// ---- a stand-in for Drishti's Apps Script: checks the token's signature like its authUser, and answers the calls the single sign-in makes ----
const DR_SECRET = "s".repeat(40), DR_ADMIN_EMAIL = "drishti.admin" + D;
function drishtiStub() {
  const users = [{ id: "du-mona", email: "mona" + D, name: "Mona Manager", role: "manager" }, { id: "du-only", email: "drishti.only" + D, name: "Drishti Only", role: "manager" }];
  const managers = [{ id: "dm-mona", email: "mona" + D, name: "Mona Manager" }];
  const calls = [];
  const verify = (t) => { const [p, s] = String(t || "").split("."); if (!p || !s) return null; const payload = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    const sig = crypto.createHmac("sha256", DR_SECRET).update(payload).digest("base64").replace(/\+/g, "-").replace(/\//g, "_"); return sig === s ? payload.split("|") : null; };
  const handle = async (url, init) => {
    if (!url.includes("script.google.com")) return null;
    const b = JSON.parse(init.body); calls.push(b.a);
    if (b.a === "signup") { const u = { id: "du-" + users.length, email: b.email, name: b.name, role: b.role }; users.push(u); return J({ ok: true, user: u }); }
    const me = verify(b.t); if (!me) return J({ ok: false, code: "auth", error: "Please sign in again." });
    if (b.a === "me") return J({ ok: true, user: me[0] === "admin" ? { id: "admin", email: DR_ADMIN_EMAIL, role: "admin" } : users.find((u) => u.id === me[0]) });
    if (b.a === "users.list") return J({ ok: true, users });
    if (b.a === "managers.list") return J({ ok: true, managers });
    return J({ ok: false, error: "not in the stand-in" });
  };
  return { handle, users, calls, verify };
}
/* A fresh world: the demo data, the roster synced, a mail hook that keeps what it is sent, and sessions for anyone by name. */
async function makeWorld({ feed = FEED(), envExtra = {} } = {}) {
  const st = { feed, mails: [], floorRows: null, dr: drishtiStub() };
  const fetchMock = async (url, init) => {
    const d = await st.dr.handle(url, init); if (d) return d;
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: st.feed });
    if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: HOLIDAYS });
    if (url.includes("brahmastra_floor")) return st.floorRows ? J({ ok: true, rows: st.floorRows.filter((x) => x.date >= body.p_from && x.date <= body.p_to) }) : J({ code: "PGRST202", message: "no such function" }, 404);
    if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "not set up" }, 404);
    if (url.includes("mail-hook.test")) { st.mails.push(JSON.parse(init.body)); return new Response("ok"); }
    return new Response("no outside network in tests", { status: 503 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), DRISHTI_TOKEN_SECRET: DR_SECRET, ...envExtra }, fetchMock });
  const { as, tryOp, sha } = rig, T = (fn) => tryOp(fn);
  const DB = rig.backend.env.DB;
  const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results || [];
  const row = async (q, ...a) => (await rows(q, ...a))[0];
  await rig.app.seedDemo(() => {});
  const anon = as(null);
  const A = as((await anon("auth.login", { email: "supervisor" + D, passHash: await sha("brahmastra-demo") })).token);
  const sync = () => A("roster.syncShastra");
  await sync();
  const U = async (name) => row("SELECT * FROM users WHERE name = ? ORDER BY created_at", name);
  const id = {}, calls = {};
  for (const r of feed) { const u = await U(r.name); if (u) id[r.name] = u.id; }
  // a session for someone: their first password (demo), then sign in by name
  const c = async (name) => { if (calls[name]) return calls[name]; const u = await U(name); if (!u) throw new Error("no such person: " + name);
    if (!u.pass_hash) await anon("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + name) });
    return (calls[name] = as((await anon("auth.loginById", { user_id: u.id, passHash: await sha("pw-" + name) })).token)); };
  const cl = (await A("clients.list")).clients, sun = cl.find((x) => /Sunrise/.test(x.name)), lake = cl.find((x) => /Lakeview/.test(x.name));
  // the server's clock and the page's (the rig runs the page's own code in its own realm)
  const VDate = vm.runInContext("Date", rig.app);
  // the sessions outlast the clock moving to another day
  const at = async (ms, fn) => { await sql("UPDATE sessions SET expires_at = ?", Date.now() + 400 * 86400000);
    const r1 = Date.now, r2 = VDate.now; Date.now = () => ms; VDate.now = () => ms; try { return await fn(); } finally { Date.now = r1; VDate.now = r2; } };
  // a call from a given caller: what Cloudflare puts in CF-Connecting-IP (none: the rig's fixed stand-in)
  const from = async (ip, op, payload = {}, token = null) => {
    const res = await rig.backend.fetch("https://demo.brahmastra.local/api", { method: "POST", headers: { "Content-Type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ op, payload }) });
    let data = null; try { data = await res.json(); } catch (e) {}
    return res.ok ? { ok: true, r: data } : { ok: false, e: (data && data.error) || "", status: res.status };
  };
  return { rig, as, anon, T, sha, DB, sql, rows, row, A, sync, U, id, c, sun, lake, st, at, from };
}

/* ================= E-18: month end closes on the 5th; last month's undone steps stay until they are done ================= */
{
  const w = await makeWorld();
  const { A, T, sun, lake } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead");
  // Sunrise has been a client since September; Lakeview was added this month (the demo makes both today)
  await w.sql("UPDATE clients SET created_at = ? WHERE id = ?", IST(2026, 9, 1, 10), sun.id);
  await w.sql("UPDATE clients SET created_at = ? WHERE id = ?", IST(2026, 11, 3, 10), lake.id);
  const bell = async (who, day) => (await who("notify.list", { today: day })).items.find((x) => x.key === "monthend") || null;
  const ov = (who, cid, today, month) => who("client.overview", { client_id: cid, today, ...(month ? { month } : {}) });
  const dues = (o) => o.monthend.steps.map((s) => s.due);
  const tick = (step, extra = {}) => TI("monthend.set", { client_id: sun.id, month: "2026-10", step, done: true, ...extra });

  S("E-18: no step is due later than the 5th of the next month");
  let o = await ov(TI, sun.id, N(20), "2026-10");
  ok("E-18: October's steps keep their working days (Nov 2, 3, 3, 4, 5), and Pack sent (5th working day: Fri Nov 6) is due on the 5th", JSON.stringify(dues(o)) === JSON.stringify([N(2), N(3), N(3), N(4), N(5), N(5)]), dues(o));
  o = await ov(TI, sun.id, "2026-12-01", "2026-11");
  ok("E-18: the 5th is a calendar day: November's Pack sent is due Saturday Dec 5, not Monday Dec 7 (the 5th working day)", JSON.stringify(dues(o)) === JSON.stringify(["2026-12-01", "2026-12-02", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]), dues(o));
  o = await ov(TI, sun.id, "2027-01-06", "2026-12");
  ok("E-18: January 2027 (the 1st a Shastra holiday): every December step is due by Jan 5, none on Jan 6, 7 or 8", JSON.stringify(dues(o)) === JSON.stringify(["2027-01-04", "2027-01-05", "2027-01-05", "2027-01-05", "2027-01-05", "2027-01-05"]), dues(o));

  S("E-18: the team lead's bell keeps last month's undone steps until they are done");
  let b = await bell(TI, N(5));
  ok("E-18: on Nov 5 the four steps due before it are past due", b && b.n === 4, b);
  b = await bell(TI, N(6));
  ok("E-18: on Nov 6 all six are past due (Pack sent was due on the 5th)", b && b.n === 6 && /^6 month-end steps for October 2026 past due at Sunrise Eye Care$/.test(b.text), b);
  b = await bell(TI, N(11));
  ok("E-18: on Nov 11 they are still there (the cut-off on the 11th is gone)", b && b.n === 6 && /October 2026/.test(b.text), b);
  b = await bell(TI, N(30));
  ok("E-18: and on Nov 30, the last day of the month", b && b.n === 6 && /October 2026/.test(b.text), b);
  ok("E-18: the bell line opens Client 360 on that client and on October", b && b.view === "client" && b.params && b.params.client_id === sun.id && b.params.month === "2026-10", b);
  b = await bell(LA, N(20));
  ok("E-18: a client added this month has no last month to close: no line for Lakeview", !b, b);

  S("E-18: Client 360 opens on the month still being closed");
  o = await ov(TI, sun.id, N(20));
  ok("E-18: Client 360 opens on October while any October step is not done", o.monthend.month === "2026-10" && o.monthend.done === 0, o.monthend.month);
  o = await ov(LA, lake.id, N(20));
  ok("E-18: Lakeview (added this month) opens on November", o.monthend.month === "2026-11", o.monthend.month);

  S("E-18: the portfolio's SLA check and the Monday digest keep them too");
  let pf = await A("portfolio.overview", { today: N(20) });
  const slaLine = (p, name) => p.freshness.find((x) => new RegExp("^" + name + ": SLA for").test(x.text)) || null;
  ok("E-18: on Nov 20 the portfolio still says October's SLA is not scored (it was due Nov 5)", (slaLine(pf, SUN) || {}).text === `${SUN}: SLA for October 2026 not scored yet (was due ${N(5)})`, pf.freshness);
  ok("E-18: but not for Lakeview, added this month", !slaLine(pf, LAKE), pf.freshness);
  const dg = await w.at(IST(2026, 11, 16, 10), () => A("digest.dashboard", {}));
  const dSun = (dg.clients || []).find((x) => x.id === sun.id), att = (dg.rollup && dg.rollup.attention || []).find((x) => x[1] === SUN && /month-end/.test(x[2]));
  ok("E-18: the digest of Monday Nov 16 names October's six undone steps", dSun && dSun.monthend.month === "2026-10" && dSun.monthend.late.length === 6 && att && /^month-end for October 2026 past due: Inventory uploaded, /.test(att[2]), [dSun && dSun.monthend, att]);

  S("E-18: done steps leave; when all are done the month moves on");
  await TI("monthend.mark", { client_id: sun.id, step: "sla_inventory", today: N(20) });
  const marked = await w.rows("SELECT month, auto FROM client_monthend WHERE client_id = ? AND step = 'sla_inventory'", sun.id);
  ok("E-18: the scorecard's AR Inventory step ticks the month still being closed (October), not November", marked.length === 1 && marked[0].month === "2026-10" && marked[0].auto === 1, marked);
  for (const k of ["inventory", "internal", "pack"]) await tick(k);
  b = await bell(TI, N(20));
  ok("E-18: with four done, the bell counts the two left", b && b.n === 2 && /^2 month-end steps for October 2026/.test(b.text), b);
  await tick("sla", { score: 92 });
  pf = await A("portfolio.overview", { today: N(20) });
  ok("E-18: once October's SLA is scored, the portfolio's check is gone", !slaLine(pf, SUN), pf.freshness);
  b = await bell(TI, N(20));
  ok("E-18: one step left: one line, one step", b && b.n === 1 && /^1 month-end step for October 2026 past due at Sunrise Eye Care$/.test(b.text), b);
  await tick("sent");
  b = await bell(TI, N(20));
  ok("E-18: all six done: the line is gone", !b, b);
  o = await ov(TI, sun.id, N(20));
  ok("E-18: and Client 360 opens on November", o.monthend.month === "2026-11", o.monthend.month);
  await TI("monthend.mark", { client_id: sun.id, step: "sla_inventory", today: N(20) });
  ok("E-18: the scorecard's step now ticks November's", !!(await w.row("SELECT 1 AS x FROM client_monthend WHERE client_id = ? AND step = 'sla_inventory' AND month = '2026-11'", sun.id)));
  await TI("monthend.set", { client_id: sun.id, month: "2026-10", step: "pack", done: false });
  o = await ov(TI, sun.id, N(20));
  b = await bell(TI, N(20));
  ok("E-18: a step marked not done again brings October back, in the bell and on Client 360", o.monthend.month === "2026-10" && b && b.n === 1, [o.monthend.month, b]);

  S("E-18: the page opens Client 360 on the month the bell names");
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("E-18: Client 360 starts on the month in the link (the bell's), else on the server's month still being closed",
    /const \[month, setMonth\] = useState\(\(\) => \(params && \/\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$\/\.test\(params\.month \|\| ""\) \? params\.month : ""\)\);/.test(src)
    && /useRpc\("client\.overview", \{ client_id: cid, from_ms: dayBounds\(from\)\[0\], to_ms: dayBounds\(to\)\[1\], month: month \|\| undefined \}/.test(src));
  ok("E-18: the 10-day rule is gone from the server", !/closingMonth\(/.test(fs.readFileSync(REPO + "/worker.js", "utf8")));
}

/* ================= B-01: a Saturday, Sunday or holiday Shastra marks as Overtime is a day worked ================= */
{
  const w = await makeWorld();
  const { A } = w;
  const emp = Object.fromEntries(FEED().map((r) => [r.name, r.emp_id]));
  const F = (name, n, status, tof = 480) => ({ emp_id: emp[name], email: "", date: N(n), status, open: false, tof_min: tof, logged_min: tof + 60, break_min: 60, guard: false, idle_min: 0, locked_min: 0 });
  const week = (name) => [2, 3, 4, 5, 6].map((n) => F(name, n, "present"));
  // Mon Nov 2 to Fri Nov 6 present for all; then Otto's Saturday is Overtime, Pat's Saturday Present, Sana's Sunday Overtime,
  // Hana's Monday Nov 9 (Diwali, a Shastra holiday) Overtime; Walt works the week only; Ned works Saturday with no mark in Shastra
  w.st.floorRows = [...week("Otto Over"), F("Otto Over", 7, "overtime"), ...week("Pat Present"), F("Pat Present", 7, "present"), ...week("Sana Sunday"), F("Sana Sunday", 8, "overtime"),
    ...week("Hana Holiday"), F("Hana Holiday", 9, "overtime"), ...week("Walt Weekday"), ...week("Ned Nomark")];
  const claims = (await w.rows("SELECT id FROM claims WHERE client_id = ? ORDER BY id LIMIT 60", w.sun.id)).map((r) => r.id);
  let nn = 0;
  const work = async (name, n) => { const u = await w.U(name); for (let i = 0; i < 35; i++) { nn++; await w.sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) VALUES (?,?,?,?,'work',?)", "s45n" + nn, claims[nn % claims.length], u.id, u.name, IST(2026, 11, n, 10) + i * 60000); } };
  for (const [name, extra] of [["Otto Over", 7], ["Pat Present", 7], ["Sana Sunday", 8], ["Hana Holiday", 9], ["Walt Weekday", null], ["Ned Nomark", 7]]) { for (const n of [2, 3, 4, 5, 6]) await work(name, n); if (extra) await work(name, extra); }
  const r = await w.at(IST(2026, 11, 10, 15), () => A("team.status", { from: N(2), to: N(9), today: N(10), tz_offset_min: 330 }));
  const row = (n) => r.rows.find((x) => x.name === n) || {};
  const ks = ["days_full", "target_done", "floor_needed_done_min", "count_done", "attain", "perf", "floor"];
  const pick = (x) => Object.fromEntries(ks.map((k) => [k, x[k]]));
  const sixDays = (x) => x.days_full === 6 && x.target_done === 210 && x.floor_needed_done_min === 48 * 60 && x.count_done === 210 && x.attain === 100 && x.perf === "ok";

  S("B-01: Overtime on a day off gets the day's target and 8 hours of floor time");
  ok("B-01: a Saturday marked Overtime is a day worked: 6 days, target 210, 48 h of floor time, 210 of 210 = 100% (not 120%)", sixDays(row("Otto Over")) && row("Otto Over").floor === "met", pick(row("Otto Over")));
  ok("B-01: the same as a Saturday marked Present", JSON.stringify(pick(row("Otto Over"))) === JSON.stringify(pick(row("Pat Present"))), [pick(row("Otto Over")), pick(row("Pat Present"))]);
  ok("B-01: a Sunday marked Overtime counts the same", sixDays(row("Sana Sunday")), pick(row("Sana Sunday")));
  ok("B-01: and a Shastra holiday (Diwali) marked Overtime", sixDays(row("Hana Holiday")), pick(row("Hana Holiday")));
  ok("B-01: the week alone stays 5 days, 175, 40 h", row("Walt Weekday").days_full === 5 && row("Walt Weekday").target_done === 175 && row("Walt Weekday").floor_needed_done_min === 40 * 60 && row("Walt Weekday").attain === 100, pick(row("Walt Weekday")));
  ok("B-01: a Saturday with entries but no mark in Shastra still gets no target (its entries count): 210 of 175", row("Ned Nomark").days_full === 5 && row("Ned Nomark").target_done === 175 && row("Ned Nomark").count_done === 210 && row("Ned Nomark").attain === 120, pick(row("Ned Nomark")));
  const prod = r.by_status.find((x) => x.status === "Production") || {};
  // everyone else works the week only (5 days of 35)
  ok("B-01: the team's totals and the Production line carry the four day-off days' targets", r.totals.target_done === 210 * 4 + 175 * (r.rows.length - 4) && prod.target === Math.round(r.totals.target_done), { totals: r.totals.target_done, people: r.rows.length, prod });
}

/* ================= N-17: an upload never loads claims into a switched-off location, and never switches it on ================= */
{
  // The upload wizard is page code (React) this rig does not render; the page itself is checked in a browser by
  // fix-DA/repro-N-17.js (which also took the owner's pictures). Here: the server's rule, and the page's.
  const w = await makeWorld();
  const { T, sun } = w;
  const TI = await w.c("Tina Lead");
  const locs = await w.rows("SELECT id, name FROM locations WHERE client_id = ? ORDER BY name", sun.id);
  const west = locs.find((l) => l.name === "Westside"), down = locs.find((l) => l.name === "Downtown");
  // a claim already in Westside before the team stopped working it
  const old = await w.row("SELECT id, claim_no, match_key FROM claims WHERE client_id = ? AND location_id = ? AND state = 'open' ORDER BY id LIMIT 1", sun.id, west.id);
  await TI("locations.save", { id: west.id, name: west.name, active: false });
  const claim = (n) => ({ match_key: "n17|" + n, claim_no: "N17-" + n, patient: "Testcase, N17 " + n, payer: "Aetna", dos: "2026-10-01", balance: 120, billed: 200, lines: 1 });
  const up = (location_id, claims, file = "n17.xlsx") => T(() => TI("inventory.upload", { client_id: sun.id, location_id, kind: "fresh", file_name: file, rows_read: claims.length, claims, final: true, summary: {} }));

  S("N-17: the server never loads claims into a switched-off location");
  let r = await up(west.id, [claim(1), claim(2), claim(3)]);
  ok("N-17: an upload into a switched-off location is refused, and says why and what to do", !r.ok && r.status === 400
    && r.e === "Westside is switched off because the team stopped working it, so nothing was loaded into it. If the work starts again, switch it on in Clients & locations, then upload again.", r);
  ok("N-17: nothing was loaded, no upload is in the history, and Westside stays off", (await w.row("SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE 'N17-%'")).n === 0
    && !(await w.row("SELECT 1 AS x FROM batches WHERE file_name = 'n17.xlsx'")) && (await w.row("SELECT active FROM locations WHERE id = ?", west.id)).active === 0);
  r = await up(down.id, [claim(4), claim(5)], "n17-down.xlsx");
  ok("N-17: an active location loads as before", r.ok && r.r.inserted === 2 && (await w.row("SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE 'N17-%' AND location_id = ?", down.id)).n === 2, r);
  r = await up(null, [{ match_key: old.match_key, claim_no: old.claim_no, balance: 77, lines: 1 }], "n17-client.xlsx");
  const oc = await w.row("SELECT location_id, balance, state FROM claims WHERE id = ?", old.id);
  ok("N-17: a claim already in Westside keeps today's behaviour: a client-level upload refreshes it where it is", r.ok && r.r.updated === 1 && oc.location_id === west.id && oc.balance === 77 && oc.state === "open", [r, oc]);
  ok("N-17: and Westside is still off after it", (await w.row("SELECT active FROM locations WHERE id = ?", west.id)).active === 0);

  S("N-17: the page leaves those rows out, says so, and the switch says what off means");
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("N-17: the upload never switches a location on: its rows are left out and only the other locations load",
    !/rpc\("locations\.save", \{ id: g\.loc\.id, name: g\.loc\.name, active: true \}\)/.test(src) && /const off = groups\.filter\(\(g\) => g\.loc && !g\.loc\.active\)\.map\(\(g\) => \(\{ location: g\.loc\.name, rows: g\.claims\.reduce\(\(t, c\) => t \+ \(c\.lines \|\| 1\), 0\) \}\)\);/.test(src)
    && /for \(const g of live\) \{/.test(src));
  ok("N-17: the result says how many rows, for which location, why, and to switch it on in Clients & locations, then upload again",
    /<b>\{x\.location\}: \{plural\(x\.rows, "row"\)\} left out\.<\/b> \{x\.location\} is switched off because the team stopped working it, so nothing was loaded into it\. If the work starts again, switch it on in Clients &amp; locations, then upload the file again\./.test(src));
  ok("N-17: on the client card an off location reads 'stopped working here', and switching one off says it is for a location the team stopped working",
    /\{l\.name\}\{!l\.active \? " · stopped working here" : ""\}/.test(src) && /confirmLabel="Stopped working here: switch off"/.test(src) && /text=\{"Switch a location off only when the team has stopped working it\. "/.test(src));
}

/* ================= N-02: a rejected recheck with nobody to send it to tells the client's team lead ================= */
{
  const w = await makeWorld();
  const { A, T, sun, id } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead"), AR = await w.c("Arun Agent"), SB = await w.c("Sahil Submitter");
  const profile = (resp) => ({ scope: ["ar", "submission"], targets: { ar: 40 }, tat: { submission: 24, subcheck: 48 }, resp: { ar: { lead: id["Tina Lead"] }, subcheck: { mode: "biller" }, ...resp } });
  const save = (who, resp, extra = {}) => T(() => who("clients.save", { id: sun.id, name: sun.name, profile: profile(resp), ...extra }));

  S("N-02: a client with Submission in its scope always has an active Submission person");
  let r = await T(() => TI("clients.save", { name: "Echo Clinic N02", locations: ["Main"], profile: profile({}) }));
  ok("N-02: a new client with Submission in its scope cannot be created without a Submission person", !r.ok && r.status === 400 && /who is responsible for Submission/.test(r.e), r);
  r = await save(TI, { submission: { lead: id["Sahil Submitter"] } });
  ok("N-02: with one it saves", r.ok, r);
  r = await save(TI, {});
  ok("N-02: an edited profile cannot drop the Submission person either", !r.ok && r.status === 400 && /who is responsible for Submission/.test(r.e), r);
  r = await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "client" }));
  const r2 = await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person" }));
  ok("N-02: nor can the client card hand Submission to the client, or to nobody, while it is in the scope", !r.ok && /in this client's scope of work/.test(r.e) && !r2.ok && /Pick the person responsible/.test(r2.e), [r, r2]);
  await w.sql("UPDATE users SET active = 0 WHERE id = ?", id["Pavan Poster"]);
  r = await save(TI, { submission: { lead: id["Pavan Poster"] } });
  const r3 = await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: id["Pavan Poster"] }));
  ok("N-02: nor be given someone switched off, on the profile or on the card", !r.ok && /only people who are active/.test(r.e) && !r3.ok && /not active/.test(r3.e), [r, r3]);
  ok("N-02: the Submission person is still the one set", (await w.row("SELECT submission_mode, submission_lead FROM clients WHERE id = ?", sun.id)).submission_lead === id["Sahil Submitter"]);

  // a resubmission: Arun's entry sends the claim to Submission, Sahil submits it, the recheck opens (moved to now)
  const SUBMIT = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" },
    note: { source: "Portal", findings: "Claim is in process per the payer portal", action: "follow up" } };
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 20 })).rows;
  await TI("alloc.apply", { client_id: sun.id, assignments: pool.slice(0, 3).map((c) => ({ id: c.id, user_id: id["Arun Agent"] })) });
  const recheck = async (c) => {
    await AR("queue.complete", { id: c.id, ...SUBMIT });
    const h = (await SB("handoffs.list", {})).rows.find((x) => x.claim_id === c.id);
    await SB("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "B-" + c.claim_no } });
    const sc = await w.row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'subcheck' AND status IN ('pending','assigned')", c.id);
    await w.sql("UPDATE handoffs SET available_at = ? WHERE id = ?", Date.now() - 60000, sc.id);
    return sc.id;
  };
  const reject = (who, hid) => T(() => who("handoffs.close", { id: hid, outcome: "rejected", reason: "Taxonomy missing", note: "Payer rejected it for the taxonomy code" }));
  const profileNotes = async (who) => (await who("notify.list", {})).items.filter((x) => x.key.startsWith("notice:") && x.params && x.params.focus === "profile");
  const [c1, c2, c3] = pool;

  S("N-02: nobody active for Rejections or Submission: the team lead hears it, and the line opens the profile");
  const h1 = await recheck(c1), h2 = await recheck(c2);
  await w.sql("UPDATE users SET active = 0 WHERE id = ?", id["Sahil Submitter"]);   // Sahil leaves after submitting
  r = await reject(AR, h1);
  let tn = await profileNotes(TI);
  const want = `Claim ${c1.claim_no} was marked Rejected at its recheck, but nobody active is set for Rejections or Submission on ${sun.name}'s profile to correct and resubmit it. Set someone on the profile.`;
  ok("N-02: the recheck is marked Rejected and goes back on the biller's list, as before", r.ok && r.r.went === "biller", r);
  ok("N-02: the client's team lead gets a bell line: the claim number, and nobody active is set for Rejections or Submission on the profile", tn.length === 1 && tn[0].text === want, tn);
  ok("N-02: it opens the client's profile", tn.length === 1 && tn[0].view === "clients" && tn[0].params.client_id === sun.id && tn[0].params.focus === "profile", tn[0]);
  const pc = await w.row("SELECT patient, account_no FROM claims WHERE id = ?", c1.id);
  ok("N-02: the claim number only: no patient, account number, reason or note in it", tn.length === 1 && !tn[0].text.includes(pc.patient) && !(pc.account_no && tn[0].text.includes(pc.account_no)) && !/Taxonomy|taxonomy/.test(tn[0].text), tn[0] && tn[0].text);
  ok("N-02: only the client's team lead: not the biller who marked it, nor another client's team lead", (await profileNotes(AR)).length === 0 && (await profileNotes(LA)).length === 0);
  await TI("claims.setState", { ids: [c2.id], state: "closed" });
  r = await reject(TI, h2);
  tn = await profileNotes(TI);
  ok("N-02: a claim the team lead had closed stays closed, and the team lead still hears it (the team lead marked it here)", r.ok && r.r.went === "kept" && tn.length === 2 && tn.some((x) => x.text.startsWith(`Claim ${c2.claim_no} was marked Rejected`)), [r, tn.map((x) => x.text)]);

  S("N-02: with someone active set, nothing new");
  await w.sql("UPDATE users SET active = 1 WHERE id = ?", id["Sahil Submitter"]);
  const h3 = await recheck(c3);
  r = await reject(AR, h3);
  ok("N-02: an active Submission person gets the rejection, and the team lead's bell has no new line", r.ok && r.r.went === "submission" && (await profileNotes(TI)).length === 2, [r, (await profileNotes(TI)).length]);

  S("N-02: the page opens the profile from the bell");
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("N-02: Clients & locations opens the profile of the client in the link when the bell line asks for it (focus: profile), for whoever may edit it",
    /if \(profAsked\.current \|\| ro \|\| !params \|\| params\.focus !== "profile" \|\| !params\.client_id\) return;/.test(src) && /if \(c && c\.can_edit !== false\) \{ profAsked\.current = true; setProf\(\{ client: c \}\); \}/.test(src));
}

/* ================= D-04: Drishti opens with the Brahmastra sign-in once a code emailed to the address proved it ================= */
// sign-in codes go out by email here (a stand-in mail hook that keeps them), as live
const MAIL = { EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40) };
{
  const w = await makeWorld({ envExtra: MAIL });
  const { A, T, anon, id, st } = w;
  let t = Date.now();
  const later = (fn) => w.at((t += 60000), fn);   // a minute on each time: past the 45 seconds between emailed codes
  const codeFor = (to) => { const m = [...st.mails].reverse().find((x) => x.to === to); return m ? (m.subject.match(/(\d{6})/) || [])[1] : null; };
  const typed = async () => (await w.U("Nil Nomail")).email_typed;
  const setEmail = (who, email) => later(() => who("users.save", { id: id["Nil Nomail"], first_name: "Nil", last_name: "Nomail", role: "supervisor", email }));
  const drishti = (tok) => later(() => T(() => w.as(tok)("reports.drishtiSession", {})));
  const tokenOf = (r) => r.r.token;
  const NIL = "nil.typed" + D;
  let NN = await w.c("Nil Nomail");

  S("D-04: an email typed in Brahmastra still does not open Drishti");
  await setEmail(NN, NIL);
  let r = await later(() => T(() => NN("reports.drishtiSession", {})));
  ok("D-04: a typed email does not open Drishti, and the SLA tab says how to fix it: sign in once with Email code, using that address and the code sent to it",
    (await typed()) === 1 && !r.ok && r.status === 403 && r.e === `Your email address (${NIL}) was added in Brahmastra, not in Purview Shastra, so it does not open Drishti until you show it is yours: sign out, then sign in once with Email code, using ${NIL} and the code sent to it. The SLA tab then opens as you. (Or ask for it to be added in Purview Shastra.)`, r);

  S("D-04: a code a team lead hands over, or one shown on screen, proves nothing");
  const lead = await later(() => A("users.loginCode", { id: id["Nil Nomail"] }));
  r = await later(() => T(() => anon("auth.verifyOtp", { email: NIL, code: lead.code })));
  ok("D-04: signed in with a code the team lead handed over (Email code): still typed, Drishti still refused", r.ok && (await typed()) === 1 && !(await drishti(tokenOf(r))).ok, r);
  const lead2 = await later(() => A("users.loginCode", { id: id["Nil Nomail"] }));
  r = await later(() => T(() => anon("auth.completeSetup", { user_id: id["Nil Nomail"], code: lead2.code, passHash: "a".repeat(64) })));
  ok("D-04: nor by name with a team lead's code (first time here)", r.ok && (await typed()) === 1 && !(await drishti(tokenOf(r))).ok, r);
  delete w.rig.liveEnv.EMAIL_PROVIDER;   // the demo: no email, the code is shown on screen
  const shown = await later(() => anon("auth.sendOtp", { email: NIL }));
  r = await later(() => T(() => anon("auth.verifyOtp", { email: NIL, code: shown.demo_code })));
  Object.assign(w.rig.liveEnv, MAIL);
  ok("D-04: nor a code shown on screen (demo, no email sent)", /^\d{6}$/.test(shown.demo_code || "") && r.ok && (await typed()) === 1, r);

  S("D-04: a sign-in with a code emailed to the address proves it, and Drishti opens");
  await later(() => anon("auth.sendOtp", { email: NIL }));
  r = await later(() => T(() => anon("auth.verifyOtp", { email: NIL, code: codeFor(NIL) })));
  ok("D-04: signed in with the code emailed to the typed address: the address is proved", r.ok && r.r.user.id === id["Nil Nomail"] && (await typed()) === 3, [r, await typed()]);
  NN = w.as(tokenOf(r));
  r = await later(() => T(() => NN("reports.drishtiSession", {})));
  const made = st.dr.users.find((u) => u.email === NIL), who = r.ok ? st.dr.verify(r.r.token) : null;
  ok("D-04: Drishti now opens with the Brahmastra sign-in, as a Drishti account of their own (made under their manager), never its Admin", r.ok && made && who && who[0] === made.id && who[1] !== "admin" && r.r.role !== "admin", [r, who]);
  await w.sync();
  ok("D-04: a roster sync keeps it proved while the email stays the same", (await w.U("Nil Nomail")).email === NIL && (await typed()) === 3 && (await later(() => T(() => NN("reports.drishtiSession", {})))).ok);
  // only the admin changes an email that is there; a person types one only where it is missing (as when the roster frees an address)
  await w.sql("UPDATE users SET email_missing = 1 WHERE id = ?", id["Nil Nomail"]);
  await setEmail(NN, "nil.other" + D);
  r = await later(() => T(() => NN("reports.drishtiSession", {})));
  ok("D-04: typing a different email makes it typed again: Drishti refused until that one is proved too", (await typed()) === 1 && !r.ok && /added in Brahmastra, not in Purview Shastra/.test(r.e), [await typed(), r]);
  const su = await later(() => anon("auth.setupCode", { user_id: id["Nil Nomail"] }));
  r = await later(() => T(() => anon("auth.completeSetup", { user_id: id["Nil Nomail"], code: codeFor("nil.other" + D), passHash: "b".repeat(64) })));
  ok("D-04: signing in by name with the code emailed to it (Forgot it?) proves it as well", su.via === "email" && r.ok && (await typed()) === 3 && (await drishti(tokenOf(r))).ok, [su.via, r, await typed()]);

  S("D-04: the safety stays: an address that is not theirs never picks a Drishti account");
  const NO = await w.c("Noor Nomail"), noor = async () => (await w.U("Noor Nomail")).email_typed;
  await later(() => NO("users.save", { id: id["Noor Nomail"], first_name: "Noor", last_name: "Nomail", role: "supervisor", email: DR_ADMIN_EMAIL }));
  const lead3 = await later(() => A("users.loginCode", { id: id["Noor Nomail"] }));
  r = await later(() => T(() => anon("auth.verifyOtp", { email: DR_ADMIN_EMAIL, code: lead3.code })));
  const r4 = await drishti(tokenOf(r));
  ok("D-04: Drishti's Admin address typed in Brahmastra: a team lead's code does not prove it, and Drishti is refused", (await noor()) === 1 && !r4.ok && /added in Brahmastra/.test(r4.e), [await noor(), r4]);
  await later(() => anon("auth.sendOtp", { email: DR_ADMIN_EMAIL }));   // (the code goes to that mailbox: here the stand-in hook, as if it were theirs)
  r = await later(() => T(() => anon("auth.verifyOtp", { email: DR_ADMIN_EMAIL, code: codeFor(DR_ADMIN_EMAIL) })));
  const r5 = await drishti(tokenOf(r));
  ok("D-04: even proved, only Brahmastra's admin opens Drishti as its Admin", (await noor()) === 3 && !r5.ok && /belongs to Drishti's Admin/.test(r5.e), [await noor(), r5]);
  const TI = await w.c("Tina Lead"), rt = await later(() => T(() => TI("reports.drishtiSession", {}))), ra = await later(() => T(() => A("reports.drishtiSession", {})));
  ok("D-04: an email from Shastra opens Drishti as before (its own account), and Brahmastra's admin opens it as its Admin",
    (await w.U("Tina Lead")).email_typed === 0 && rt.ok && st.dr.verify(rt.r.token)[1] !== "admin" && ra.ok && ra.r.role === "admin" && st.dr.verify(ra.r.token)[0] === "admin", [rt, ra]);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
