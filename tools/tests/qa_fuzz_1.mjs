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
const DE = await firstIn("Dev Agent"), LA = await firstIn("Lara Lead"), PAT = await firstIn("Pat Postlead"), MO = await firstIn("Mona Manager");
setNow(IST(2026, 11, 10, 10, 0));
const mine = await give("Arun Agent", 3);
await save(AR, mine[0], SAAG.resub);
const hid = (await openH(mine[0], "submission")).id;
const noteId = (await rows("SELECT id FROM notes WHERE kind = 'work' LIMIT 1"))[0].id;
const OPS = ["queue.summary", "queue.next", "queue.skip", "queue.complete", "queue.open", "queue.list", "notes.update", "notes.add", "history.mine", "claims.timeline", "claims.get", "claims.tips", "claims.setState", "claims.setPriority", "claims.stats", "claims.list", "claims.byPatient",
  "handoffs.list", "handoffs.dashboard", "handoffs.count", "handoffs.assign", "handoffs.close", "handoffs.myRechecks", "attention.list", "attention.count", "attention.review", "attention.answer", "attention.clientRequests", "attention.clientSent", "attention.fromDesks", "attention.reviewPeople",
  "escalations.list", "escalations.save", "escalations.reason", "escalations.count", "tat.list", "tat.hold", "tat.unhold", "tat.preview", "team.status", "team.range", "team.huddle", "team.activity", "team.setOut", "team.rebalance", "team.saveNote",
  "reports.work", "reports.production", "reports.desk", "reports.claimsProduction", "supervisor.productivity", "supervisor.callTime", "supervisor.allocations", "sla.extras", "stack.month", "notify.list", "inventory.status", "client.overview", "alloc.apply", "alloc.reassign", "alloc.unassign", "alloc.resplit", "attachments.add", "attachments.get", "attachments.delete", "denials.repeats"];
const PAY = [
  {}, { id: null }, { id: 5 }, { id: "x".repeat(5000) }, { id: mine[0] }, { id: mine[1] }, { id: hid }, { id: noteId }, { claim_id: mine[0] }, { claim_id: mine[1], comment: "a note of several words here" },
  { id: mine[0], saag: "oops", note: 5 }, { id: mine[1], saag: { status: 1, sub_status: [], action: {}, bucket: null }, note: { findings: [] } }, { id: mine[1], saag: SAAG.fu, note: { source: ["Call"], findings: "word word word word", precheck: "notalist", tfl: {} } },
  { id: mine[1], saag: SAAG.fu, note: NOTE(), follow_up_on: "2026-02-30", today: "banana" }, { id: mine[1], saag: SAAG.fu, note: NOTE(), sibling_ids: "no" }, { id: mine[1], saag: SAAG.fu, note: NOTE(), sibling_ids: [null, 5, {}, mine[1], mine[2]] },
  { id: hid, outcome: "complete", proof: "x" }, { id: hid, outcome: "complete", proof: { date: "2026-11-10", ref: "x", files: "no", amount: {} } }, { id: hid, outcome: "complete", proof: { date: "2026-11-10", ref: "x", files: [null, {}, 5] } },
  { id: hid, outcome: "other", reason: 5, note: 5 }, { id: hid, outcome: "client", reason: [], note: [] }, { id: hid, outcome: ["a"] }, { from_ms: "a", to_ms: {} }, { from_ms: -1, to_ms: 1e30 }, { from: "2026-13-01", to: "x" }, { from: "2026-11-01", to: "2026-11-30", today: "2026-11-10" },
  { client_id: sun.id, from: "2026-11-01", to: "2026-11-30", day: "2026-11-05" }, { client_id: {} }, { client_id: [sun.id] }, { user_id: 5 }, { page: -5, page_size: 1e9 }, { page: "x" }, { ids: "abc" }, { ids: [null, 1, {}] }, { ids: [mine[2]], state: "closed" },
  { kind: "flag", id: mine[0], reason: "Other", until: "2026-12-01", note: "" }, { kind: "handoff", id: hid, reason: "x", until: "2099-01-01" }, { dept: "x", view: {} }, { month: "2026-11" }, { month: "x" }, { q: "%_\\" + "z".repeat(200) }, { today: "2026-11-10", day_from_ms: "x" },
  { id: mine[0], user_id: U("Bela Agent").id, route: "other", why: "reason one", reviewed: "words words here", findings: "findings in words", next: "next in some words" },
  { client_id: sun.id, kind: "external", day: "2026-11-10", dept: "AR", raised_who: "x", reported_to: "y", description: "z".repeat(3000), email_subject: "sub", comment: "com", owner_id: 5, channels: 5, status: {}, is_error: "Y", error_by_id: [] },
];
const PEOPLE = { biller: AR, lead: TI, desk: PI, sub: QU, manager: MO, admin: A, other: CY, outsider: as("bogus-token") };
await part("Z1: nothing in my area answers with a server error for odd input", async () => {
  const fails = new Map(); let n = 0;
  for (const op of OPS) for (const [who, F] of Object.entries(PEOPLE)) for (const p of PAY) {
    n++;
    let r; try { r = await F(op, JSON.parse(JSON.stringify(p))); r = { ok: true }; } catch (e) { r = { ok: false, status: e.status, e: e.message }; }
    if (!r.ok && (!r.status || r.status >= 500)) { const k = op + " :: " + String(r.e).slice(0, 90); if (!fails.has(k)) fails.set(k, { who, payload: JSON.stringify(p).slice(0, 140), status: r.status }); }
  }
  ok("ran " + n + " odd calls", true);
  for (const [k, v] of fails) ok("no server error: " + k, false, v);
  ok("not one of them was a server error", fails.size === 0, [...fails.keys()].slice(0, 10));
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
