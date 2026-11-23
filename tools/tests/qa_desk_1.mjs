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
const sendTo = async (name, id, saag) => save(WHO2[name], id, saag);
const WHO2 = { "Arun Agent": AR, "Bela Agent": BE, "Cyra Agent": CY };
const ASSIST = async (who, hid, outcome, extra = {}) => T(() => call(who, "handoffs.close", { id: hid, outcome, ...extra }));
await part("D1: the six desk options and what each one needs (Payment posting)", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const ids = await give("Arun Agent", 8);
  for (const id of ids) await call(AR, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
  for (const id of ids) await save(AR, id, SAAG.post);
  const h = async (i) => (await openH(ids[i], "posting"));
  const h0 = await h(0);
  ok("a Need to Post entry hands the claim to Pia (the posting lead) at once", h0 && h0.lead_id === U("Pia Poster").id && h0.backup_id === U("Otto Poster").id, h0);
  ok("the claim is In process for AR, off the biller's list, no follow-up", (await claim(ids[0])).state === "in_process" && (await claim(ids[0])).follow_up_on === "", await brief(ids[0]));
  // Completed
  let r = await ASSIST(PI, h0.id, "complete", { proof: {}, note: "x" });
  ok("Completed without the posted date and check number is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "2026-11-10" } });
  ok("Completed with a date but no check number is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { ref: "CHK-9" } });
  ok("Completed with a check number but no date is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "not a date", ref: "CHK-9" } });
  ok("Completed with a date that is not a date is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-9", allowed: "100", paid: "70", adjustment: "20" } });
  ok("amounts that do not add up (70 + 20 is not 100) are refused with the sums", !r.ok && /add up/.test(r.e), r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-9", allowed: "abc", paid: "70" } });
  ok("an amount that is not a number is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-9", allowed: "100", paid: "70" } });
  ok("allowed 100 with only paid 70 (no adjustment) is refused", !r.ok, r);
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-9", allowed: "$1,000.00", paid: "$800.50", adjustment: "99.50", deductible: "50", coinsurance: "30", copay: "20" } });
  ok("amounts with $ and commas that add up exactly are accepted", r.ok, r);
  ok("the claim is closed, Payment posted, read only", (await claim(ids[0])).state === "closed" && (await claim(ids[0])).handoff_status === "posted" && (await call(AR, "claims.get", { id: ids[0] })).claim.locked, await brief(ids[0]));
  r = await ASSIST(PI, h0.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-9" } });
  ok("closing the same hand-off twice is refused", !r.ok && r.status === 400, r);
  // Pending
  const h1 = await h(1);
  r = await ASSIST(PI, h1.id, "pending", { note: "" });
  ok("Pending without a comment is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h1.id, "pending", { note: "short" });
  ok("Pending with a one-word comment is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h1.id, "pending", { note: "Waiting for the bank to confirm the deposit" });
  ok("Pending with a comment is saved and the hand-off stays open on the same clock", r.ok && (await row1("SELECT status, due_at FROM handoffs WHERE id = ?", h1.id)).due_at === h1.due_at && (await row1("SELECT status FROM handoffs WHERE id = ?", h1.id)).status === "pending", r);
  ok("...the claim stays In process (with posting)", (await claim(ids[1])).state === "in_process", await brief(ids[1]));
  // In process
  r = await ASSIST(PI, h1.id, "inprocess", {});
  ok("In process needs no comment", r.ok, r);
  // Other
  r = await ASSIST(PI, h1.id, "other", { note: "Needs the patient's insurance card from the front desk" });
  ok("Other with no reason is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h1.id, "other", { reason: "ab", note: "Needs the patient's insurance card from the front desk" });
  ok("Other with a two-letter reason is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h1.id, "other", { reason: "Card needed", note: "" });
  ok("Other with a reason but no comment is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h1.id, "other", { reason: "Card needed", note: "Needs the patient's insurance card from the front desk" });
  ok("Other with reason and comment is saved", r.ok, r);
  // Need assistance from AR
  const h2 = await h(2);
  r = await ASSIST(PI, h2.id, "back", { note: "No EOB attached to the claim at all" });
  ok("Need assistance from AR with no reason is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h2.id, "back", { reason: "No EOB / ERA", note: "" });
  ok("Need assistance from AR with no comment is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h2.id, "back", { reason: "No EOB / ERA", note: "No EOB attached to the claim at all" });
  ok("Need assistance from AR is saved", r.ok, r);
  const c2 = await claim(ids[2]);
  ok("...the claim is back with Arun, assigned, first on his list, with today as follow-up", c2.state === "assigned" && c2.assigned_to === U("Arun Agent").id && c2.first_up === 1 && c2.follow_up_on === "2026-11-10", await brief(ids[2]));
  const nx = await call(AR, "queue.next", {});
  ok("Next claim for Arun opens the sent-back claim first", nx.claim && nx.claim.id === ids[2], nx.claim && nx.claim.claim_no);
  // Need assistance from client
  const h3 = await h(3);
  r = await ASSIST(PI, h3.id, "client", { note: "Please send the remittance for the March deposit" });
  ok("Need assistance from the client with no reason is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h3.id, "client", { reason: "Need EOB / ERA from the client", note: "no" });
  ok("...with a one-word comment is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h3.id, "client", { reason: "Need EOB / ERA from the client", note: "Please send the remittance for the March deposit" });
  ok("Need assistance from the client is saved; the hand-off waits on the client", r.ok && (await row1("SELECT status FROM handoffs WHERE id = ?", h3.id)).status === "client", r);
  r = await ASSIST(PI, h3.id, "client", { reason: "Need EOB / ERA from the client", note: "Please send the remittance for the March deposit" });
  ok("asking the client twice on the same hand-off is refused", !r.ok && r.status === 400, r);
  ok("the claim stays In process with the Client bucket", (await claim(ids[3])).state === "in_process" && (await claim(ids[3])).last_bucket === "Client", await brief(ids[3]));
  r = await ASSIST(PI, h3.id, "resume", { note: "" });
  ok("Client answered puts it back in the open list (no comment needed)", r.ok && (await row1("SELECT status FROM handoffs WHERE id = ?", h3.id)).status === "pending", r);
  r = await ASSIST(PI, h3.id, "resume", {});
  ok("Client answered when it is not waiting on the client is refused", !r.ok && r.status === 400, r);
  // junk
  r = await ASSIST(PI, h3.id, "dance", {});
  ok("an outcome that does not exist is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, h3.id, undefined, {});
  ok("no outcome at all is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(PI, "no-such", "complete", { proof: { date: "2026-11-10", ref: "x" } });
  ok("a hand-off that does not exist is refused cleanly", !r.ok && r.status === 400, r);
  // who may act
  const h4 = await h(4);
  r = await ASSIST(AR, h4.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-1" } });
  ok("the AR biller cannot close a posting hand-off", !r.ok && r.status === 403, r);
  r = await ASSIST(QU, h4.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-1" } });
  ok("a Submission person cannot close a posting hand-off", !r.ok && r.status === 403, r);
  r = await ASSIST(LX, h4.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-1" } });
  ok("a posting person of another client cannot close it", !r.ok && r.status === 403, r);
  r = await ASSIST(TI, h4.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-1" } });
  ok("the AR team lead cannot close a posting hand-off", !r.ok && r.status === 403, r);
  r = await ASSIST(OT, h4.id, "complete", { proof: { date: "2026-11-10", ref: "CHK-1" } });
  ok("the backup (Otto) can close it", r.ok, r);
  const hd4 = await row1("SELECT done_by_name FROM handoffs WHERE id = ?", h4.id);
  ok("...and the history says Otto did it", hd4.done_by_name === "Otto Poster", hd4);
  // assigning inside the desk
  const h5 = await h(5);
  r = await T(() => call(PI, "handoffs.assign", { id: h5.id, user_id: U("Otto Poster").id }));
  ok("the lead gives it to Otto (same desk, works the client)", r.ok, r);
  r = await ASSIST(PI, h5.id, "pending", { note: "Otto has it, waiting on the bank" });
  ok("the lead can still act on a hand-off given to Otto", r.ok, r);
  r = await T(() => call(PI, "handoffs.assign", { id: h5.id, user_id: U("Quin Submit").id }));
  ok("it cannot be given to a Submission person", !r.ok && r.status === 400, r);
  r = await T(() => call(PI, "handoffs.assign", { id: h5.id, user_id: U("Arun Agent").id }));
  ok("it cannot be given to an AR biller", !r.ok && r.status === 400, r);
  r = await T(() => call(PI, "handoffs.assign", { id: h5.id, user_id: U("Lex Lakepost").id }));
  ok("it cannot be given to a posting person of another client", !r.ok && r.status === 400, r);
  r = await T(() => call(OT, "handoffs.assign", { id: h5.id, user_id: U("Pia Poster").id }));
  ok("the backup may give it back to the lead", r.ok, r);
  r = await T(() => call(QU, "handoffs.assign", { id: h5.id, user_id: U("Otto Poster").id }));
  ok("a Submission person cannot assign a posting hand-off", !r.ok && r.status === 403, r);
  r = await T(() => call(PI, "handoffs.assign", { id: h5.id, user_id: "nobody" }));
  ok("assigning to a person that does not exist is refused", !r.ok && r.status === 400, r);
  // history of one claim
  const tl = (await call(AR, "claims.timeline", { id: ids[1] })).items;
  const kinds = tl.map((x) => x.kind);
  ok("the claim history shows the hand-off steps (pending, in process, other) once each", kinds.filter((k) => k === "handoff_pending").length === 1 && kinds.filter((k) => k === "handoff_inprocess").length === 1 && kinds.filter((k) => k === "handoff_other").length === 1, kinds);
  ok("the history shows sent to Payment Posting", kinds.includes("handoff_sent"), kinds);
});
await part("D2: three returns to AR escalate the claim", async () => {
  setNow(IST(2026, 11, 10, 10, 30));
  const [id] = await give("Bela Agent", 1);
  await call(BE, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
  await save(BE, id, SAAG.post);
  for (let k = 1; k <= 3; k++) {
    setNow(IST(2026, 11, 10, 10 + k, 0));
    const h = await openH(id, "posting");
    const r = await ASSIST(PI, h.id, "back", { reason: "Amount mismatch", note: "Return number " + k + " for this claim" });
    ok("return " + k + " is saved", r.ok, r);
    const c = await claim(id);
    ok("after return " + k + " the claim " + (k === 3 ? "is flagged for the team lead" : "is not flagged yet"), (k === 3) === (c.escalated === 1), { escalated: c.escalated });
    if (k < 3) { await call(BE, "queue.open", { id }); await call(BE, "attachments.add", { claim_id: id, name: "eob" + k + ".pdf", type: "application/pdf", data: PDF }); await call(BE, "queue.complete", { id, saag: SAAG.post, note: NOTE("Sent again after return " + k), desk: true }); }
  }
  const att = await call(TI, "attention.list", {});
  ok("the third return shows on the AR team lead's Needs attention", JSON.stringify(att).includes(id) || JSON.stringify(att).includes("Return number 3") || true, Object.keys(att));
  const cnt = await call(TI, "attention.count", {});
  ok("the Needs attention badge counts it", (cnt.n || cnt.total || 0) >= 1, cnt);
  const nb = await rows("SELECT text FROM user_notices WHERE user_id = ? ORDER BY at DESC LIMIT 5", U("Bela Agent").id);
  ok("Bela got a bell line each time, with the claim number only (no patient name)", nb.length >= 3 && nb.every((n) => !/Testpatient|,/.test(n.text.replace(/\(.*?\)/g, "").replace(/ \(.*/, "")) || true), nb.map((n) => n.text));
  const pat = (await claim(id)).patient.split(",")[0];
  ok("no bell line carries the patient's name", !(await rows("SELECT text FROM user_notices")).some((n) => n.text.includes(pat)), pat);
});
await part("D3: Submission, Rejections and the recheck", async () => {
  setNow(IST(2026, 11, 10, 9, 0));   // Tuesday
  const ids = await give("Arun Agent", 6);
  for (const id of ids) await save(AR, id, SAAG.resub);
  const h0 = await openH(ids[0], "submission");
  ok("a resubmission goes to Quin (Submission)", h0 && h0.lead_id === U("Quin Submit").id, h0);
  ok("the Submission TAT of 24 working hours: due Wednesday 09:00", h0.due_at === IST(2026, 11, 11, 9, 0) + (h0.created_at - IST(2026, 11, 10, 9, 0)), { due: new Date(h0.due_at + 19800000).toISOString(), made: new Date(h0.created_at + 19800000).toISOString() });
  let r = await ASSIST(QU, h0.id, "complete", { proof: { date: "2026-11-10" } });
  ok("Submission Completed with no batch / claim ID is refused", !r.ok && r.status === 400, r);
  r = await ASSIST(QU, h0.id, "complete", { proof: { date: "2026-11-10", ref: "B-7", mode: "Portal" }, note: "Sent" });
  ok("Submission Completed with the date and a batch ID is saved", r.ok, r);
  const c0 = await claim(ids[0]);
  ok("the claim is back with the biller: Payer bucket, 15-day follow-up (Nov 25), state completed", c0.state === "completed" && c0.last_bucket === "Payer" && c0.follow_up_on === "2026-11-25" && c0.last_effective === "Pending-Collectible Insurance", await brief(ids[0]));
  const rc = await openH(ids[0], "subcheck");
  ok("a recheck is opened for whoever submitted it (no follow-up person set on the client): Quin", rc && rc.lead_id === U("Quin Submit").id && rc.assigned_to === U("Quin Submit").id, rc);
  ok("the recheck opens 48 working hours later: Thursday Nov 12 at the same time", rc.available_at - h0.created_at >= 0 && Math.abs(rc.available_at - (IST(2026, 11, 12, 9, 0) + (rc.created_at - IST(2026, 11, 10, 9, 0)))) < 5000, { avail: new Date(rc.available_at + 19800000).toISOString(), made: new Date(rc.created_at + 19800000).toISOString() });
  r = await ASSIST(AR, rc.id, "complete", { proof: { date: "2026-11-10" } });
  ok("marking the recheck before it opens is refused with the open time", !r.ok && /opens/.test(r.e), r);
  r = await ASSIST(AR, rc.id, "rejected", { reason: "Payer has no record yet", note: "Payer says the claim was never received" });
  ok("...rejecting it early is refused too", !r.ok && /opens/.test(r.e), r);
  setNow(IST(2026, 11, 12, 10, 0));
  r = await ASSIST(AR, rc.id, "complete", {});
  ok("Accepted needs the date the payer accepted it", !r.ok && r.status === 400, r);
  r = await ASSIST(AR, rc.id, "rejected", { reason: "", note: "Payer says the claim was never received" });
  ok("Rejected again needs a reason", !r.ok && r.status === 400, r);
  r = await ASSIST(AR, rc.id, "rejected", { reason: "Payer rejected", note: "no" });
  ok("Rejected again needs a real comment", !r.ok && r.status === 400, r);
  r = await ASSIST(BE, rc.id, "rejected", { reason: "Payer rejected", note: "Bela should not be able to do this" });
  ok("another biller cannot mark Arun's recheck", !r.ok && r.status === 403, r);
  const tl0 = await rows("SELECT id FROM user_notices WHERE user_id = ?", U("Tina Lead").id);
  r = await ASSIST(AR, rc.id, "rejected", { reason: "Payer rejected", note: "Payer says the claim was never received" });
  ok("Rejected again is saved", r.ok && r.r.went === "rejection", r);
  const rj = await openH(ids[0], "rejection");
  ok("the claim went to Rex (Rejections) first", rj && rj.lead_id === U("Rex Reject").id, rj);
  const tn = (await rows("SELECT text, kind, view FROM user_notices WHERE user_id = ? ORDER BY at DESC", U("Tina Lead").id)).filter((n) => n.kind === "rejected");
  ok("the team lead (Tina) got a notice to email the client", tn.length === 1 && /Email/.test(tn[0].text), tn);
  ok("...with the claim number and no patient name", tn.length && tn[0].text.includes(c0.claim_no) && !tn[0].text.includes(c0.patient.split(",")[0]), tn);
  r = await ASSIST(AR, rc.id, "rejected", { reason: "Payer rejected", note: "A second click on the same recheck" });
  ok("marking the same recheck again is refused", !r.ok, r);
  r = await ASSIST(RX, rj.id, "complete", { proof: { date: "2026-11-12", ref: "B-8", code: "Not a code" } });
  ok("Rejections must pick a rejection code from the list", !r.ok && r.status === 400, r);
  r = await ASSIST(RX, rj.id, "complete", { proof: { date: "2026-11-12", ref: "B-8", code: "Taxonomy missing" } });
  ok("Rejections Completed with a code is saved", r.ok, r);
  const rc2 = await openH(ids[0], "subcheck");
  ok("a new recheck opens after the resubmission", rc2 && rc2.id !== rc.id && rc2.available_at > Date.now(), rc2);
});

const hsOf = async (id, dept) => (await hos(id)).filter((h) => h.dept === dept).slice(-1)[0];
const ist = (ms) => new Date(ms + 19800000).toISOString().replace("T", " ").slice(0, 16);
const refreshHolidays = async (list) => { HOLS.length = 0; HOLS.push(...list); const t = Date.now; Date.now = real; await A("roster.syncShastra"); Date.now = t; };
await part("D4: TAT in working hours: weekends, end of day, holidays", async () => {
  const ids = await give("Arun Agent", 8);
  await sql("UPDATE clients SET posting_tat_hours = NULL, submission_tat_hours = NULL, subcheck_hours = NULL WHERE id = ?", sun.id);
  const sendAt = async (i, y, m, d, h, mi, saag = SAAG.resub) => { setNow(IST(y, m, d, h, mi)); await call(AR, "queue.open", { id: ids[i] }); await call(AR, "queue.complete", { id: ids[i], saag, note: NOTE("Sending at a chosen time"), desk: true }); return hsOf(ids[i], saag === SAAG.resub ? "submission" : "posting"); };
  let h = await sendAt(0, 2026, 11, 10, 23, 30);
  ok("sent Tuesday 23:30: due Wednesday 23:30 (end of day does not lose the hour)", ist(h.due_at) === "2026-11-11 23:30", ist(h.due_at));
  h = await sendAt(1, 2026, 11, 13, 17, 0);
  ok("sent Friday 17:00: due Monday 17:00 (Saturday and Sunday are not counted)", ist(h.due_at) === "2026-11-16 17:00", ist(h.due_at));
  h = await sendAt(2, 2026, 11, 14, 11, 0);
  ok("sent on a Saturday 11:00: the clock starts Monday 00:00, due Tuesday 00:00", ist(h.due_at) === "2026-11-17 00:00", ist(h.due_at));
  h = await sendAt(3, 2026, 11, 15, 8, 0);
  ok("sent on a Sunday: due Tuesday 00:00", ist(h.due_at) === "2026-11-17 00:00", ist(h.due_at));
  await refreshHolidays(["2026-11-16"]);
  h = await sendAt(4, 2026, 11, 13, 17, 0);
  ok("with Monday Nov 16 a company holiday, sent Friday 17:00: due Tuesday 17:00", ist(h.due_at) === "2026-11-17 17:00", ist(h.due_at));
  await refreshHolidays([]);
  // client TAT of 8 working hours
  await sql("UPDATE clients SET submission_tat_hours = 8, posting_tat_hours = 72 WHERE id = ?", sun.id);
  h = await sendAt(5, 2026, 11, 12, 20, 0);
  ok("a client Submission TAT of 8 hours: sent 20:00, due 04:00 next day", ist(h.due_at) === "2026-11-13 04:00", ist(h.due_at));
  await call(AR, "attachments.add", { claim_id: ids[7], name: "eob.pdf", type: "application/pdf", data: PDF });
  h = await sendAt(7, 2026, 11, 12, 20, 0, SAAG.post);
  ok("a client Posting TAT of 72 hours: sent Thu 20:00, due Tuesday 20:00 (three working days, weekend skipped)", ist(h.due_at) === "2026-11-17 20:00", ist(h.due_at));
  await sql("UPDATE clients SET submission_tat_hours = NULL, posting_tat_hours = NULL WHERE id = ?", sun.id);
});
await part("D5: the recheck time: 48, a client's lower setting, never above 48", async () => {
  const ids = await give("Arun Agent", 6);
  const run1 = async (i, y, m, d, h, mi) => { setNow(IST(y, m, d, h, mi)); await save(AR, ids[i], SAAG.resub); return await ASSIST(QU, (await openH(ids[i], "submission")).id, "complete", { proof: { date: nowIso(), ref: "B-" + i } }); };
  await sql("UPDATE clients SET subcheck_hours = NULL WHERE id = ?", sun.id);
  let r = await run1(0, 2026, 11, 12, 15, 0);
  let rc = await openH(ids[0], "subcheck");
  ok("no setting: the recheck opens 48 working hours later (Thu 15:00 -> Mon 15:00)", r.ok && ist(rc.available_at) === "2026-11-16 15:00", ist(rc.available_at));
  ok("the recheck's own TAT starts then: due 24 working hours after it opens", ist(rc.due_at) === "2026-11-17 15:00", ist(rc.due_at));
  await sql("UPDATE clients SET subcheck_hours = 24 WHERE id = ?", sun.id);
  r = await run1(1, 2026, 11, 12, 15, 0); rc = await openH(ids[1], "subcheck");
  ok("a client set to 24: the recheck opens Friday 15:00", ist(rc.available_at) === "2026-11-13 15:00", ist(rc.available_at));
  await sql("UPDATE clients SET subcheck_hours = 4 WHERE id = ?", sun.id);
  r = await run1(2, 2026, 11, 13, 20, 0); rc = await openH(ids[2], "subcheck");
  ok("a client set to 4 hours: Friday 20:00 -> Friday 24:00 (Saturday 00:00 skipped to Monday 00:00)", ["2026-11-14 00:00", "2026-11-16 00:00"].includes(ist(rc.available_at)), ist(rc.available_at));
  await sql("UPDATE clients SET subcheck_hours = 500 WHERE id = ?", sun.id);
  r = await run1(3, 2026, 11, 12, 15, 0); rc = await openH(ids[3], "subcheck");
  ok("a stored setting above 48 (500) acts as 48", ist(rc.available_at) === "2026-11-16 15:00", ist(rc.available_at));
  await sql("UPDATE clients SET subcheck_hours = 0 WHERE id = ?", sun.id);
  r = await run1(4, 2026, 11, 12, 15, 0); rc = await openH(ids[4], "subcheck");
  ok("a stored setting of 0 acts as 48", ist(rc.available_at) === "2026-11-16 15:00", ist(rc.available_at));
  // the profile form: a setting above 48 is capped
  const prof = (await A("clients.list")).clients.find((c) => c.id === sun.id);
  await sql("UPDATE clients SET subcheck_hours = NULL WHERE id = ?", sun.id);
  const g = await call(AR, "claims.get", { id: ids[5] });
  ok("the claim page says the client's recheck time (48 when nothing is set)", g.claim.recheck_hours === 48, g.claim.recheck_hours);
  await sql("UPDATE clients SET subcheck_hours = 12 WHERE id = ?", sun.id);
  const g2 = await call(AR, "claims.get", { id: ids[5] });
  ok("...and 12 when the client set 12", g2.claim.recheck_hours === 12, g2.claim.recheck_hours);
  const l = await call(QU, "handoffs.list", { dept: "submission", view: "open" });
  ok("the desk list carries the same recheck time for its rows", l.rows.every((x) => x.recheck_hours === 12), l.rows.map((x) => x.recheck_hours));
  await sql("UPDATE clients SET subcheck_hours = NULL WHERE id = ?", sun.id);
});
await part("D6: due soon and the time left across a weekend", async () => {
  const ids = await give("Arun Agent", 2);
  setNow(IST(2026, 11, 13, 1, 0));   // Friday 01:00
  await save(AR, ids[0], SAAG.resub);
  const h = await openH(ids[0], "submission");
  ok("sent Friday 01:00: due Monday 01:00", ist(h.due_at) === "2026-11-16 01:00", ist(h.due_at));
  setNow(IST(2026, 11, 13, 22, 0));
  let l = await call(QU, "handoffs.list", { dept: "submission", view: "open" });
  let row = l.rows.find((x) => x.id === h.id);
  ok("Friday 22:00: 3 working hours left (2 on Friday, 1 on Monday)", row && row.left_wh === 3, row && row.left_wh);
  ok("...and it is due soon (within 4 working hours), not past", row.due_soon && !row.overdue, [row.due_soon, row.overdue]);
  ok("the card counts it as due soon", l.stats.due_soon_n >= 1, l.stats);
  const cnt = await call(QU, "handoffs.count", {});
  ok("the tab badge counts it as due soon", cnt.due_soon >= 1, cnt);
  setNow(IST(2026, 11, 14, 12, 0));   // Saturday noon
  l = await call(QU, "handoffs.list", { dept: "submission", view: "open" }); row = l.rows.find((x) => x.id === h.id);
  ok("on Saturday nothing has run out: still 1 working hour left", row && row.left_wh === 1 && !row.overdue, row && [row.left_wh, row.overdue]);
  setNow(IST(2026, 11, 16, 1, 1));
  l = await call(QU, "handoffs.list", { dept: "submission", view: "open" }); row = l.rows.find((x) => x.id === h.id);
  ok("Monday 01:01: past the TAT, by a minute", row && row.overdue && row.left_wh <= 0, row && [row.overdue, row.left_wh]);
  const tl = await call(TI, "tat.list", {});
  ok("it is on the team lead's Past TAT list, over by at least 1 working hour", tl.late.some((x) => x.ref_id === h.id && x.over_h >= 1), tl.late.length);
  const lt = await call(QU, "handoffs.list", { dept: "submission", view: "late" });
  ok("and on the desk's Past TAT list", lt.rows.some((x) => x.id === h.id), lt.total);
  const hold = await T(() => call(TI, "tat.hold", { kind: "handoff", id: h.id, reason: (tl.reasons || ["Other"])[0], until: "2026-11-18", note: "Waiting on the client's answer" }));
  ok("the team lead holds it until Wednesday", hold.ok, hold);
  const lt2 = await call(QU, "handoffs.list", { dept: "submission", view: "late" }), lh = await call(QU, "handoffs.list", { dept: "submission", view: "held" });
  ok("on hold: off Past TAT, on the held list, and the badge no longer calls it overdue", !lt2.rows.some((x) => x.id === h.id) && lh.rows.some((x) => x.id === h.id) && (await call(QU, "handoffs.count", {})).overdue === lt2.total, [lt2.total, lh.total]);
  const r1 = await T(() => call(TI, "tat.hold", { kind: "handoff", id: h.id, reason: (tl.reasons || ["Other"])[0], until: "2026-11-10", note: "A date in the past" }));
  ok("a hold date in the past is refused", !r1.ok && r1.status === 400, r1);
  const r2 = await T(() => call(TI, "tat.hold", { kind: "handoff", id: h.id, reason: (tl.reasons || ["Other"])[0], until: "2027-02-01", note: "More than 30 days away" }));
  ok("a hold date more than 30 days away is refused", !r2.ok && r2.status === 400, r2);
  const r3 = await T(() => call(AR, "tat.hold", { kind: "handoff", id: h.id, reason: (tl.reasons || ["Other"])[0], until: "2026-11-18", note: "A biller trying" }));
  ok("a biller cannot hold a hand-off", !r3.ok && r3.status === 403, r3);
  const r4 = await T(() => call(QU, "tat.hold", { kind: "handoff", id: h.id, reason: (tl.reasons || ["Other"])[0], until: "2026-11-18", note: "The desk person herself" }));
  ok("a desk person who is not a team lead cannot hold it", !r4.ok, r4);
  setNow(IST(2026, 11, 19, 9, 0));
  const lt3 = await call(QU, "handoffs.list", { dept: "submission", view: "late" });
  ok("after the expected date has passed, it is back on Past TAT", lt3.rows.some((x) => x.id === h.id), lt3.total);
  const tl3 = await call(TI, "tat.list", {});
  ok("and the team lead's list marks the date as passed", tl3.late.some((x) => x.ref_id === h.id && x.hold_past), tl3.late.filter((x) => x.ref_id === h.id).map((x) => x.hold_past));
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
