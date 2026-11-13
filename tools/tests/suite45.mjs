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
  // a team lead the roster has no email for
  P({ emp_id: "N1", name: "Nil Nomail", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: "" }),
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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
