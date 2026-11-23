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
const DE = await firstIn("Dev Agent"); const ASSIST = async (who, hid, outcome, extra = {}) => T(() => call(who, "handoffs.close", { id: hid, outcome, ...extra }));
await part("X1: a biller leaves while a claim of theirs is at a desk", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const ids = await give("Bela Agent", 3);
  for (const id of ids) await save(BE, id, SAAG.resub);
  await sql("UPDATE users SET active = 0 WHERE id = ?", U("Bela Agent").id);   // as the roster does when Shastra says Inactive
  const rr = await rows("SELECT id, state, assigned_to FROM claims WHERE id IN (?,?,?)", ...ids);
  ok("set-up: Bela's three claims are with Submission (In process), still named on her", rr.every((c) => c.state === "in_process" && c.assigned_to === U("Bela Agent").id), rr);
  const h = await openH(ids[0], "submission");
  let r = await ASSIST(QU, h.id, "back", { reason: "Missing claim data", note: "Needs the rendering provider before it can go" });
  ok("Submission sends the claim back to AR", r.ok, r);
  const c = await claim(ids[0]);
  ok("the claim went back on a person who is still active, or to the pool: not to Bela who has left", c.state === "open" || (c.assigned_to && c.assigned_to !== U("Bela Agent").id), { state: c.state, assigned_to: c.assigned_to });
  // QA3-02: in the pool, first in the next allocation, and the client's team lead hears it in the bell (the claim number, no patient)
  ok("...in the pool: nobody on it, first in the next allocation", c.state === "open" && !c.assigned_to && c.first_up === 1, await brief(ids[0]));
  const tl1 = await rows("SELECT text FROM user_notices WHERE user_id = ? AND client_id = ? AND text LIKE ?", U("Tina Lead").id, sun.id, "%" + c.claim_no + "%pool%");
  ok("...the team lead's bell names the claim number, why (switched off) and the pool, and no patient", tl1.length === 1 && /switched off/.test(tl1[0].text) && !tl1[0].text.includes(c.patient), tl1);
  const bills = await A("users.list");
  const ass = bills.users.find((u) => u.id === c.assigned_to);
  ok("...nobody inactive holds a claim that is waiting for AR", !c.assigned_to || (ass && ass.active), ass && ass.active);
  // finish another one: Submission completes
  const h2 = await openH(ids[1], "submission");
  r = await ASSIST(QU, h2.id, "complete", { proof: { date: nowIso(), ref: "B-1" } });
  const c2 = await claim(ids[1]);
  ok("Submission completes a claim of the leaver: it comes back as completed with a follow-up (it is not lost)", c2.state === "completed" && c2.follow_up_on, await brief(ids[1]));
  const left = await rows("SELECT id, state FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress','completed')", U("Bela Agent").id);
  ok("nothing waiting on a biller who has left (all of it is with someone, or in the pool)", left.length === 0, left);
  await sql("UPDATE users SET active = 1 WHERE id = ?", U("Bela Agent").id);
});
await part("X2: a biller a lead added by hand is taken off the client while a claim of theirs is at a desk", async () => {
  setNow(IST(2026, 11, 10, 11, 0));
  const EL = await firstIn("Eli Agent");
  const team = JSON.parse((await row1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json || "[]");
  await TI("clients.saveTeam", { client_id: sun.id, team: [...team, U("Eli Agent").id], base: team });
  const ids = await give("Eli Agent", 3);
  ok("set-up: Eli (a Lakeview biller in Shastra) was given 3 Sunrise claims", ids.length === 3 && (await call(EL, "queue.summary", { today: nowIso(), day_from_ms: 0, day_to_ms: Date.now() })).ready.n === 3);
  await save(EL, ids[0], SAAG.resub);
  const team2 = JSON.parse((await row1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json || "[]");
  await TI("clients.saveTeam", { client_id: sun.id, team: team2.filter((x) => x !== U("Eli Agent").id), base: team2 });
  const back = await rows("SELECT id, state, assigned_to FROM claims WHERE id IN (?,?)", ids[1], ids[2]);
  ok("taken off by the lead: the two claims still on Eli's list went back to the pool", back.every((c) => c.state === "open" && !c.assigned_to), back);
  const c0 = await claim(ids[0]);
  ok("the claim at Submission stays with the desk", c0.state === "in_process", await brief(ids[0]));
  const h = await openH(ids[0], "submission");
  const r = await ASSIST(QU, h.id, "back", { reason: "Missing claim data", note: "Needs the rendering provider before it can go" });
  const c = await claim(ids[0]);
  ok("Submission sends it back: it goes to the pool or to a biller who works Sunrise, not to Eli who no longer does", !(c.assigned_to === U("Eli Agent").id && c.state === "assigned"), { state: c.state, assigned_to_eli: c.assigned_to === U("Eli Agent").id });
  const tl2 = await rows("SELECT text FROM user_notices WHERE user_id = ? AND client_id = ? AND text LIKE ?", U("Tina Lead").id, sun.id, "%" + c.claim_no + "%pool%");
  ok("...the team lead's bell says Eli no longer works Sunrise and it went to the pool (QA3-02)", tl2.length === 1 && /no longer works/.test(tl2[0].text) && !tl2[0].text.includes(c.patient), tl2);
  const q = await call(EL, "queue.summary", { today: nowIso(), day_from_ms: 0, day_to_ms: Date.now() });
  ok("...and Eli sees no Sunrise claim waiting", q.ready.n === 0, q);
  const att = await call(TI, "attention.fromDesks", {});
  ok("(the team lead's Needs attention does list it)", att.rows.some((x) => x.claim_id === ids[0]), att.rows.length);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
