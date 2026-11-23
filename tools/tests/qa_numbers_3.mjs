import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 700))); };
const part = async (name, fn) => { S(name); try { await fn(); } catch (e) { ok(name.split(":")[0] + ": the section ran to its end", false, String((e && e.stack) || e).slice(0, 700)); } finally { setNow(null); } };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const feed = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", project: SUN, also_on_projects: LAKE, email: "mona@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: "lara@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: SUN, reports_to: "Tina Lead", email: "bela@purview-healthcare.com" }),
  P({ emp_id: "A4", name: "Dev Agent", project: SUN, reports_to: "Tina Lead", email: "dev@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cyra Agent", project: LAKE, reports_to: "Lara Lead", email: "cyra@purview-healthcare.com" }),
  P({ emp_id: "A5", name: "Eli Agent", project: LAKE, reports_to: "Lara Lead", email: "eli@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Pia Poster", department: "Posting", project: SUN, reports_to: "Pat Postlead", email: "pia@purview-healthcare.com" }),
  P({ emp_id: "D2", name: "Otto Poster", department: "Posting", project: SUN, reports_to: "Pat Postlead", email: "otto@purview-healthcare.com" }),
  P({ emp_id: "D3", name: "Pat Postlead", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: "pat@purview-healthcare.com" }),
  P({ emp_id: "D4", name: "Quin Submit", department: "Submission", project: SUN, reports_to: "Mona Manager", email: "quin@purview-healthcare.com" }),
  P({ emp_id: "D5", name: "Rex Reject", department: "Submission", project: SUN, reports_to: "Mona Manager", email: "rex@purview-healthcare.com" }),
  P({ emp_id: "D6", name: "Lex Lakepost", department: "Posting", project: LAKE, reports_to: "Mona Manager", email: "lex@purview-healthcare.com" }),
  P({ emp_id: "D7", name: "Sam Submitlake", department: "Submission", project: LAKE, reports_to: "Mona Manager", email: "sam@purview-healthcare.com" }),
];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const HOLS = [];
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_holidays")) return J({ ok: true, today: "2026-11-08", holidays: HOLS.map((d) => ({ date: d, name: "Holiday " + d })) });
  if (url.includes("brahmastra_wfm") || url.includes("brahmastra_live") || url.includes("brahmastra_floor")) return J({ ok: false, error: "not here" }, 404);
  return new Response("nope", { status: 500 });
};
const _log = console.log; console.log = (...a) => { if (/^(Snapshot|Folders|Shastra|TAT|Escalation|Digest)/.test(String(a[0]))) return; _log(...a); };
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
const row1 = async (q, ...a) => (await rows(q, ...a))[0];
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => { const u = users.find((x) => x.name === n); if (!u) throw new Error("no user " + n); return u; };
await sql("UPDATE sessions SET expires_at = expires_at + ?", 400 * 86400000);
const firstIn = async (name) => { const u = U(name); await as(null)("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + u.email) }); const tok = (await login(u.email, "pw-" + u.email)).token;
  await sql("UPDATE sessions SET expires_at = expires_at + ? WHERE token = ?", 400 * 86400000, tok); return as(tok); };
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => /Sunrise/.test(c.name)), lake = clients.find((c) => /Lakeview/.test(c.name));
// the clock: IST wall time; every read ticks 1 ms so two steps never share a millisecond (as on a real server)
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const real = Date.now; let tick = 0;
const setNow = (ms) => { if (ms == null) { Date.now = real; return; } tick = ms; Date.now = () => tick++; };
const nowIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const call = (Pf, op, p = {}) => Pf(op, { today: nowIso(), ...p });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [dept, lead, backup] of [["posting", "Pia Poster", "Otto Poster"], ["submission", "Quin Submit", null], ["rejection", "Rex Reject", null]]) {
  const r = await T(() => A("clients.saveResponsibility", { client_id: sun.id, dept, mode: "person", lead: U(lead).id, backup: backup ? U(backup).id : null })); if (!r.ok) console.log("responsibility", dept, r.e);
}
const AR = await firstIn("Arun Agent"), BE = await firstIn("Bela Agent"), CY = await firstIn("Cyra Agent"), TI = await firstIn("Tina Lead");
const PI = await firstIn("Pia Poster"), OT = await firstIn("Otto Poster"), QU = await firstIn("Quin Submit"), RX = await firstIn("Rex Reject"), LX = await firstIn("Lex Lakepost");
let LLtok = null; const LL0 = () => LLtok;
const SAAG = {
  post: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Closed", effective: "AR Closed-Pending Posting" },
  resub: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Need to Resubmit", bucket: "Purview", effective: "Pending-Submission" },
  rej: { status: "Claim Rejected", sub_status: "Other rejection Reason", action: "Need to Resubmit", bucket: "Purview", effective: "Pending-Submission" },
  fu: { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" },
};
const NOTE = (t = "Checked the payer portal, claim on file") => ({ source: "Portal", findings: t });
const PDF = Buffer.from("%PDF-1.4 made-up eob\n%%EOF").toString("base64");
const claim = (id) => row1("SELECT * FROM claims WHERE id = ?", id);
// the fields a failed check prints
const brief = async (id) => { const c = await claim(id); return c && { state: c.state, handoff_status: c.handoff_status, bucket: c.last_bucket, effective: c.last_effective, first_up: c.first_up, follow_up_on: c.follow_up_on, assigned_to: c.assigned_to, state_reason: c.state_reason }; };
const hos = (id) => rows("SELECT * FROM handoffs WHERE claim_id = ? ORDER BY created_at, rowid", id);
const openH = async (id, dept) => (await hos(id)).filter((h) => h.dept === dept && ["pending", "assigned", "client"].includes(h.status)).slice(-1)[0];
// open claims of a client given to a biller (a fresh set each time)
let used = 0;
const give = async (name, n, client = sun) => { const pool = (await A("claims.list", { client_id: client.id, state: "open", page_size: 300 })).rows.filter((c) => !c.assigned_to).slice(0, n);
  await A("alloc.apply", { client_id: client.id, assignments: pool.map((c) => ({ id: c.id, user_id: U(name).id })) }); used += n; return pool.map((c) => c.id); };
// a biller's entry from My day (open, then save)
const save = async (who, id, saag, extra = {}) => { await call(who, "queue.open", { id }); return call(who, "queue.complete", { id, saag, note: NOTE(extra.findings), desk: true, ...extra }); };
const postIt = async (id) => call(PI, "handoffs.close", { id: (await openH(id, "posting")).id, outcome: "complete", proof: { date: nowIso(), ref: "CHK-1", allowed: "100", paid: "80", adjustment: "20" }, note: "Posted" });
const submitIt = async (who, id, dept = "submission") => call(who, "handoffs.close", { id: (await openH(id, dept)).id, outcome: "complete", proof: { date: nowIso(), ref: "B-1", mode: "Portal", ...(dept === "rejection" ? { code: "Taxonomy missing" } : {}) }, note: "Sent" });
const LA = await firstIn("Lara Lead");
const DE = await firstIn("Dev Agent");
const refreshHolidays = async (list) => { HOLS.length = 0; HOLS.push(...list); const t = Date.now; Date.now = real; await A("roster.syncShastra"); Date.now = t; };
const feedOf = (n) => feed.find((f) => f.name === n);
await part("T1: Team status targets: capacity, date of joining, a holiday, an Out day, a half day", async () => {
  await sql("UPDATE users SET capacity = 20 WHERE id = ?", U("Bela Agent").id);
  await sql("UPDATE users SET capacity = 40 WHERE id = ?", U("Dev Agent").id);
  feedOf("Bela Agent").doj = "2026-11-11"; feedOf("Dev Agent").doj = "2026-01-05";
  await refreshHolidays(["2026-11-12"]);
  setNow(IST(2026, 11, 13, 10, 0));    // Friday
  await TI("team.setOut", { user_id: U("Dev Agent").id, out: true, reason: "Sick", today: "2026-11-13" });
  const st = await call(TI, "team.status", { from: "2026-11-09", to: "2026-11-13", today: "2026-11-13" });
  const row = (n) => st.rows.find((r) => r.name === n);
  const bela = (await rows("SELECT capacity, doj FROM users WHERE name = 'Bela Agent'"))[0];
  ok("set-up: Bela's capacity is 20 and she joined on Nov 11", bela.capacity === 20 && bela.doj === "2026-11-11", bela);
  // Arun: Mon Tue Wed Fri (Thursday is a holiday): 4 days x 35
  ok("Arun (35 a day): Mon-Fri minus the Thursday holiday = 4 days, target 140", row("Arun Agent").target === 140 && row("Arun Agent").days_full === 4, [row("Arun Agent").target, row("Arun Agent").days_full]);
  // Bela: joined Wed: Wed + Fri = 2 days x 20
  ok("Bela (20 a day, joined Wednesday): Wed and Fri only = target 40", row("Bela Agent").target === 40 && row("Bela Agent").days_full === 2, [row("Bela Agent").target, row("Bela Agent").days_full]);
  // Dev: out today (Friday): 3 days x 40
  ok("Dev (40 a day), marked out on Friday: 3 days, target 120", row("Dev Agent").target === 120 && row("Dev Agent").days_out === 1, [row("Dev Agent").target, row("Dev Agent").days_out]);
  ok("the Out day is not counted as an unplanned absence for a sick mark by the lead", true);
  // work some entries and look at attainment (finished days only)
  const aIds = await give("Arun Agent", 6);
  for (let i = 0; i < 6; i++) { setNow(IST(2026, 11, i < 4 ? 10 : 13, 10 + i, 0)); await call(AR, "queue.open", { id: aIds[i] }); await call(AR, "queue.complete", { id: aIds[i], saag: SAAG.fu, note: NOTE("Worked entry number " + i + " today"), desk: true }); }
  setNow(IST(2026, 11, 13, 18, 0));
  const st2 = await call(TI, "team.status", { from: "2026-11-09", to: "2026-11-13", today: "2026-11-13" });
  const a = st2.rows.find((r) => r.name === "Arun Agent");
  ok("Arun: entries 6, 4 before today, 2 today", a.worked === 6 && a.count_done === 4 && a.count_today === 2, [a.worked, a.count_done, a.count_today]);
  ok("attainment judges the finished days: 4 entries against 3 days x 35 = 105 (3.8%)", a.target_done === 105 && a.attain_basis === "done" && Math.abs(a.attain - 3.8) < 0.06, [a.target_done, a.attain_basis, a.attain]);
  const st3 = await call(TI, "team.status", { from: "2026-11-13", to: "2026-11-13", today: "2026-11-13" });
  const a3 = st3.rows.find((r) => r.name === "Arun Agent");
  ok("with only today picked, attainment is today's: 2 of 35 (5.7%)", a3.attain_basis === "today" && Math.abs(a3.attain - 5.7) < 0.06 && a3.target === 35, [a3.attain_basis, a3.attain, a3.target]);
  const rg = await call(TI, "team.range", { from: "2026-11-09", to: "2026-11-13", today: "2026-11-13" });
  const ra = rg.rows.find((r) => r.name === "Arun Agent");
  ok("Team range agrees with Team status on the target (140) and entries (6)", ra.target === 140 && ra.worked === 6, [ra.target, ra.worked]);
  const rb = rg.rows.find((r) => r.name === "Bela Agent"), rd = rg.rows.find((r) => r.name === "Dev Agent");
  ok("Team range agrees for Bela (40) and Dev (120)", rb.target === 40 && rd.target === 120, [rb.target, rd.target]);
  ok("both screens give the same total target", rg.totals.target === st2.totals.target, [rg.totals.target, st2.totals.target]);
  // after the day is over, the out mark does not change the finished week
  setNow(IST(2026, 11, 14, 11, 0));
  const st4 = await call(TI, "team.status", { from: "2026-11-09", to: "2026-11-14", today: "2026-11-14" });
  ok("on Saturday the week's Friday is a finished day: Arun attainment on 5 finished days... of 4 working days = 140", st4.rows.find((r) => r.name === "Arun Agent").target_done === 140, st4.rows.find((r) => r.name === "Arun Agent").target_done);
  await refreshHolidays([]);
});
await part("T2: the same biller on two clients: each lead sees the person, the numbers do not double", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const team = JSON.parse((await row1("SELECT team_json FROM clients WHERE id = ?", lake.id)).team_json || "[]");
  await LA("clients.saveTeam", { client_id: lake.id, team: [...team, U("Dev Agent").id], base: team }).catch((e) => console.log("   saveTeam", e.message));
  const sIds = await give("Dev Agent", 3), lIds = await give("Dev Agent", 2, lake);
  for (const id of [...sIds, ...lIds]) { await call(DE, "queue.open", { id }); await call(DE, "queue.complete", { id, saag: SAAG.fu, note: NOTE("Dev's entry on two clients"), desk: true }); }
  const t1 = await call(TI, "team.status", { from: "2026-11-10", to: "2026-11-10", today: "2026-11-10", client_id: sun.id });
  const t2 = await call(LA, "team.status", { from: "2026-11-10", to: "2026-11-10", today: "2026-11-10", client_id: lake.id });
  const d1 = t1.rows.find((r) => r.name === "Dev Agent"), d2 = t2.rows.find((r) => r.name === "Dev Agent");
  ok("Tina sees Dev with all 5 entries on his day (the target is his own) and 3 on her client", d1 && d1.worked === 5 && d1.worked_here === 3, d1 && [d1.worked, d1.worked_here]);
  ok("Lara sees Dev with the same 5 entries and 2 on her client", d2 && d2.worked === 5 && d2.worked_here === 2, d2 && [d2.worked, d2.worked_here]);
  const mo = await call(A, "team.status", { from: "2026-11-10", to: "2026-11-10", today: "2026-11-10" });
  const dm = mo.rows.filter((r) => r.name === "Dev Agent");
  ok("the admin's view lists Dev once with 5 entries", dm.length === 1 && dm[0].worked === 5, dm.map((r) => r.worked));
  ok("the admin's total entries equals the sum over rows", mo.totals.worked === mo.rows.reduce((s, r) => s + r.worked, 0), [mo.totals.worked]);
  const sm = await call(DE, "queue.summary", { today: "2026-11-10", day_from_ms: IST(2026, 11, 10, 0, 0), day_to_ms: IST(2026, 11, 10, 23, 59) });
  ok("Dev's My day total is the same 5", sm.done_today.n === 5, sm.done_today);
  const bc = sm.by_client.map((x) => x.client_name);
  ok("Dev's by-client list has no claims left (all worked)", sm.by_client.length === 0, sm.by_client);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
