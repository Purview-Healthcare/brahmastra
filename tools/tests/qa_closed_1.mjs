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
const DE = await firstIn("Dev Agent"), LA = await firstIn("Lara Lead"), PAT = await firstIn("Pat Postlead");
const ASSIST = async (who, hid, outcome, extra = {}) => T(() => call(who, "handoffs.close", { id: hid, outcome, ...extra }));
await part("P1: a claim Payment posting closed is read only for everyone (rule 7)", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [id, id2] = await give("Arun Agent", 2);
  await call(AR, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
  await save(AR, id, SAAG.post);
  await ASSIST(PI, (await openH(id, "posting")).id, "complete", { proof: { date: nowIso(), ref: "CHK-1" } });
  ok("set-up: the claim is closed by Posting", (await claim(id)).handoff_status === "posted" && (await claim(id)).state === "closed", await brief(id));
  const wk = (await call(AR, "claims.timeline", { id })).items.find((x) => x.kind === "work");
  const ro = async (name, F, op, p) => { const r = await T(() => F(op, p)); ok(name, !r.ok, r.ok ? JSON.stringify(r.r).slice(0, 160) : r); };
  await ro("the biller cannot edit her entry", AR, "notes.update", { id: wk.id, saag: SAAG.fu, note: NOTE("Editing a posted claim entry") });
  await ro("the team lead cannot edit the entry", TI, "notes.update", { id: wk.id, saag: SAAG.fu, note: NOTE("Editing a posted claim entry") });
  await ro("the biller cannot save a new entry", AR, "queue.complete", { id, saag: SAAG.fu, note: NOTE("A new entry on a posted claim"), rework: true });
  await ro("the team lead cannot save a new entry", TI, "queue.complete", { id, saag: SAAG.fu, note: NOTE("A new entry on a posted claim"), rework: true });
  await ro("the biller cannot open it for work", AR, "queue.open", { id });
  // QUESTION (QA3-Q1): rule 7 says the notes are locked; the server still takes a plain note from the biller and the team lead
  const pn1 = await T(() => call(AR, "notes.add", { claim_id: id, comment: "Adding a note after it was posted" })), pn2 = await T(() => call(TI, "notes.add", { claim_id: id, comment: "Adding a note after it was posted" }));
  ok("QUESTION: a plain note on a claim Posting closed is refused for the biller and the team lead (rule 7: notes are locked)", !pn1.ok && !pn2.ok, [pn1.ok, pn2.ok]);
  await ro("the team lead cannot reopen it", TI, "claims.setState", { ids: [id], state: "open", reason: "reopen" });
  await ro("the team lead cannot exclude it", TI, "claims.setState", { ids: [id], state: "excluded", reason: "exclude" });
  await ro("the team lead cannot change its priority", TI, "claims.setPriority", { ids: [id], priority: "high", comment: "raise this claim now" });
  const rA = await TI("alloc.reassign", { ids: [id], user_id: U("Bela Agent").id }), rU = await TI("alloc.unassign", { ids: [id] });
  ok("the team lead cannot give it to another biller or unassign it (nothing changes)", rA.changed === 0 && rU.changed === 0, [rA, rU]);
  await ro("a reader (another client's person) cannot add a plain note", LX, "notes.add", { claim_id: id, comment: "A reader adding a note to a posted claim" });
  const un = await rows("SELECT state, assigned_to FROM claims WHERE id = ?", id);
  ok("...and it still belongs to Arun, closed", un[0].state === "closed" && un[0].assigned_to === U("Arun Agent").id, un);
  const g = await T(() => call(BE, "claims.get", { id }));
  const rd = await T(() => call(LX, "claims.get", { id }));
  ok("anyone can open it read only (another biller of the client)", g.ok && g.r.claim.locked, g.ok || g);
  ok("anyone can open it read only (a posting person of another client)", rd.ok && rd.r.claim.locked, rd.ok || rd);
  ok("the reader sees no sibling claims of the patient", rd.ok && rd.r.siblings.length === 0, rd.ok && rd.r.siblings);
  const tl = await T(() => call(LX, "claims.timeline", { id }));
  ok("the reader can read the history", tl.ok, tl);
  const att = await T(() => call(LX, "attachments.add", { claim_id: id, name: "x.pdf", type: "application/pdf", data: PDF }));
  ok("the reader (another client's person) cannot add a file", !att.ok, att);
  const cno0 = (await claim(id)).claim_no; const sr = await T(() => call(LX, "search.global", { q: cno0 }));
  ok("Ctrl+K finds it for everyone, marked posted", sr.ok && JSON.stringify(sr.r).includes(cno0), sr.ok && JSON.stringify(sr.r).slice(0, 200));
  // an inventory upload that lists it again reopens it (payer take-back), the old entries stay locked
});
await part("P2: the same claim read-only for others but the person it is with can still work a claim AR closed itself", async () => {
  setNow(IST(2026, 11, 10, 11, 0));
  const [id] = await give("Arun Agent", 1);
  await save(AR, id, { status: "Claim Paid", sub_status: "Paid", action: "Close", bucket: "Closed", effective: "Processing-Closed" });
  const g = await T(() => call(BE, "claims.get", { id }));
  ok("a claim AR closed itself stays with its own people: another biller cannot open it", !g.ok, g.ok || "");
  const wk = (await call(AR, "claims.timeline", { id })).items.find((x) => x.kind === "work");
  const r = await T(() => call(AR, "notes.update", { id: wk.id, saag: SAAG.fu, note: NOTE("Edited a claim AR closed itself") }));
  ok("its entry can still be edited into a follow-up (opens it again)", r.ok && (await claim(id)).state === "completed", r);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
