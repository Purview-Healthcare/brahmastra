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
const ist = (ms) => new Date(ms + 19800000).toISOString().replace("T", " ").slice(0, 16);
await part("C1: client requests: ask, send, chase, answer", async () => {
  setNow(IST(2026, 11, 13, 10, 0));   // Friday
  const ids = await give("Arun Agent", 4);
  for (const id of ids) await save(AR, id, SAAG.resub);
  const hs = []; for (const id of ids) hs.push(await openH(id, "submission"));
  for (const h of hs) { const r = await ASSIST(QU, h.id, "client", { reason: "Need signature or documents", note: "Need the signed form from the client" }); ok("asked the client on " + h.id.slice(0, 4), r.ok, r); }
  const cr = await call(TI, "attention.clientRequests", {});
  ok("the team lead's Client requests lists 4 not yet sent", cr.to_send === 4 && cr.rows.length === 4, [cr.to_send, cr.rows.length]);
  const cnt = await call(TI, "attention.count", {});
  ok("the badge counts them (client_to_send 4)", cnt.client_to_send === 4, cnt);
  const q1 = await call(QU, "handoffs.list", { dept: "submission", view: "open" });
  ok("waiting-on-the-client claims are not in the desk's Open list until it is time to chase", !q1.rows.some((x) => ids.includes(x.claim_id)), q1.total);
  const w = await call(QU, "handoffs.list", { dept: "submission", view: "client" });
  ok("they are under Waiting on client", w.rows.filter((x) => ids.includes(x.claim_id)).length === 4, w.total);
  let r = await T(() => call(TI, "attention.clientSent", { id: hs[0].id, how: "Smoke signal" }));
  ok("sending with a way that is not on the list is refused", !r.ok && r.status === 400, r);
  r = await T(() => call(AR, "attention.clientSent", { id: hs[0].id, how: "Email" }));
  ok("a biller cannot mark a request sent", !r.ok && r.status === 403, r);
  r = await T(() => call(LA, "attention.clientSent", { id: hs[0].id, how: "Email" }));
  ok("another client's team lead cannot", !r.ok && r.status === 403, r);
  setNow(IST(2026, 11, 13, 17, 0));
  r = await T(() => call(TI, "attention.clientSent", { id: hs[0].id, how: "Email", note: "Sent to the front desk" }));
  ok("the team lead marks the first sent Friday 17:00", r.ok, r);
  const h0 = await row1("SELECT chase_at, client_sent_at FROM handoffs WHERE id = ?", hs[0].id);
  ok("the chase is 72 working hours later: Wednesday 17:00 (weekend skipped)", ist(h0.chase_at) === "2026-11-18 17:00", ist(h0.chase_at));
  r = await T(() => call(TI, "attention.clientSent", { id: hs[0].id, how: "Email" }));
  ok("marking it sent twice is refused", !r.ok && r.status === 400, r);
  const cr2 = await call(TI, "attention.clientRequests", {});
  ok("to-send drops to 3 and the sent one is still listed (with when and how)", cr2.to_send === 3 && cr2.rows.some((x) => x.id === hs[0].id && x.client_sent_how === "Email"), [cr2.to_send]);
  setNow(IST(2026, 11, 18, 16, 59));
  let o = await call(QU, "handoffs.list", { dept: "submission", view: "open" });
  ok("Wednesday 16:59: not yet in Open", !o.rows.some((x) => x.id === hs[0].id), o.total);
  setNow(IST(2026, 11, 18, 17, 1));
  o = await call(QU, "handoffs.list", { dept: "submission", view: "open" });
  ok("Wednesday 17:01: back in Open as Chase the client", o.rows.some((x) => x.id === hs[0].id && x.chase), o.total);
  ok("...and counted in the Open card and the chase card", o.stats.chase_n >= 1 && o.stats.open_n === o.total, o.stats);
  // answered
  r = await ASSIST(QU, hs[0].id, "resume", { note: "The client sent the form" });
  ok("Client answered puts it on the desk", r.ok && (await row1("SELECT status FROM handoffs WHERE id = ?", hs[0].id)).status === "pending", r);
  const cr3 = await call(TI, "attention.clientRequests", {});
  ok("it leaves the team lead's Client requests", !cr3.rows.some((x) => x.id === hs[0].id), cr3.rows.length);
  // asking the client again starts a fresh round
  r = await ASSIST(QU, hs[0].id, "client", { reason: "Need signature or documents", note: "Still need page two of the form" });
  const h0b = await row1("SELECT client_sent_at, client_answered_at, chase_at FROM handoffs WHERE id = ?", hs[0].id);
  ok("a second request on the same hand-off starts clean (not sent, not answered, no chase)", r.ok && !h0b.client_sent_at && !h0b.client_answered_at && !h0b.chase_at, h0b);
  // the TAT clock kept running: due is 24 working hours after the original send
  const hh = await row1("SELECT due_at, created_at FROM handoffs WHERE id = ?", hs[0].id);
  ok("the TAT clock never stopped: due 24 working hours after sending (Monday 10:00 + ... )", ist(hh.due_at) === ist(IST(2026, 11, 16, 10, 0) + (hh.created_at - IST(2026, 11, 13, 10, 0))), ist(hh.due_at));
  // hide waiting
  const h1 = await call(QU, "handoffs.list", { dept: "submission", view: "open", hide_client: true });
  const h2 = await call(QU, "handoffs.list", { dept: "submission", view: "late", hide_client: true });
  const h3 = await call(QU, "handoffs.list", { dept: "submission", view: "late" });
  ok("Hide claims waiting on the client takes them out of the Past TAT count", h2.total <= h3.total, [h2.total, h3.total]);
});
await part("C2: the desk's stale screen: two people choosing at once", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [id] = await give("Bela Agent", 1);
  await save(BE, id, SAAG.resub);
  const h = await openH(id, "submission");
  const rs = await Promise.all([ASSIST(QU, h.id, "client", { reason: "Need signature or documents", note: "Asking the client for the signed form" }), ASSIST(QU, h.id, "complete", { proof: { date: nowIso(), ref: "B-3" } }), ASSIST(QU, h.id, "back", { reason: "Missing claim data", note: "Sending it back to AR at the same time" })]);
  ok("three different choices at the same moment: exactly one is saved", rs.filter((x) => x.ok).length === 1, rs.map((x) => x.ok ? "ok" : x.e));
  const st = (await row1("SELECT status FROM handoffs WHERE id = ?", h.id)).status;
  const c = await claim(id);
  ok("the claim agrees with the hand-off that was saved (" + st + ")", (st === "client" && c.state === "in_process") || (st === "complete" && c.state === "completed") || (st === "back" && c.state === "assigned"), { st, state: c.state });
  const notes = await rows("SELECT comment FROM notes WHERE claim_id = ? AND kind = 'note'", id);
  ok("only the saved choice left a note in the history", notes.length === 1, notes.map((n) => n.comment));
  const stale = await ASSIST(QU, h.id, "pending", { note: "A choice from an old screen", seen: "pending" });
  ok("a choice made on a stale screen is refused when it is already closed or changed", !stale.ok, stale);
});
await part("C3: the bell and the emails carry claim numbers only", async () => {
  setNow(IST(2026, 11, 10, 12, 0));
  await sql("DELETE FROM user_notices");
  const ids = await give("Arun Agent", 6);
  for (const id of ids) await call(AR, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
  for (const id of ids.slice(0, 3)) await save(AR, id, SAAG.post);
  for (const id of ids.slice(3)) await save(AR, id, SAAG.resub);
  let hh = await openH(ids[0], "posting"); await ASSIST(PI, hh.id, "complete", { proof: { date: nowIso(), ref: "C1" } });
  hh = await openH(ids[1], "posting"); await ASSIST(PI, hh.id, "back", { reason: "No EOB / ERA", note: "The EOB is blank on page two" });
  hh = await openH(ids[2], "posting"); await ASSIST(PI, hh.id, "client", { reason: "Need EOB / ERA from the client", note: "Please send the deposit slip" });
  hh = await openH(ids[3], "submission"); await ASSIST(QU, hh.id, "complete", { proof: { date: nowIso(), ref: "B-1" } });
  hh = await openH(ids[4], "submission"); await ASSIST(QU, hh.id, "back", { reason: "Missing claim data", note: "No rendering provider on the claim" });
  setNow(IST(2026, 11, 13, 10, 0));
  const rc = await openH(ids[3], "subcheck");
  await ASSIST(AR, rc.id, "rejected", { reason: "Payer rejected", note: "Payer says the member id is invalid" });
  await T(() => call(AR, "queue.complete", { id: ids[5], saag: SAAG.fu, note: NOTE("Flag this one now"), escalate: true, rework: true }));
  const all2 = await rows("SELECT u.name AS who, n.text FROM user_notices n JOIN users u ON u.id = n.user_id");
  const names = (await rows("SELECT patient, account_no FROM claims WHERE id IN (" + ids.map(() => "?").join(",") + ")", ...ids));
  const bad = [];
  for (const n of all2) for (const p of names) { const last = String(p.patient).split(",")[0].trim(); if (last.length > 2 && n.text.includes(last)) bad.push(n.text); if (p.account_no && n.text.includes(p.account_no)) bad.push(n.text); }
  ok("no bell line names a patient or an account number (" + all2.length + " lines)", bad.length === 0, bad);
  ok("the bell lines name claims by their claim number", all2.filter((n) => /claim 77|Claim 77/.test(n.text)).length >= 4, all2.map((n) => n.text));
  const cno = (await claim(ids[3])).claim_no;
  ok("the team lead's rejected-recheck line has the claim number and no patient", all2.some((n) => n.who === "Tina Lead" && n.text.includes(cno)), all2.filter((n) => n.who === "Tina Lead"));
  const prev = await T(() => call(TI, "tat.preview", { kind: "ar" }));
  ok("the TAT reminder preview opens", prev.ok, prev);
  const mail = JSON.stringify(prev.r && prev.r.mail || {});
  ok("...and carries no patient name", !names.some((p) => mail.includes(String(p.patient).split(",")[0].trim())), mail.slice(0, 200));
  const prevD = await T(() => call(PAT, "tat.preview", { kind: "desks" }));
  ok("the desk's reminder preview opens and carries no patient name", prevD.ok && !names.some((p) => JSON.stringify(prevD.r.mail || {}).includes(String(p.patient).split(",")[0].trim())), prevD);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
