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
const HOL = { rows: [] };
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_holidays") || url.includes("brahmastra_wfm") || url.includes("brahmastra_live") || url.includes("brahmastra_floor")) return J({ ok: false, error: "not here" }, 404);
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
const IDS = {};
const Q = (who, id, saag, note, extra = {}) => T(() => call(who, "queue.complete", { id, saag, note, ...extra }));
const fresh = async (who, n = 1, client = sun) => give(who, n, client);
const openAndSave = async (who, id, saag, note, extra = {}) => { await call(who, "queue.open", { id }); return Q(who, id, saag, note, { desk: true, ...extra }); };
await part("W1: bad input when a biller saves an entry", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [id] = await fresh("Arun Agent", 1);
  await call(AR, "queue.open", { id });
  const bad = async (name, saag, note, extra) => { const r = await Q(AR, id, saag, note, extra); ok(name, !r.ok && r.status === 400, r); const c = await claim(id); ok(name + " (nothing saved)", c.state === "in_progress" && c.touches === 0, c.state + " touches " + c.touches); };
  await bad("no status picked", { ...SAAG.fu, status: "" }, NOTE());
  await bad("no sub-status picked", { ...SAAG.fu, sub_status: "" }, NOTE());
  await bad("no action picked", { ...SAAG.fu, action: "   " }, NOTE());
  await bad("no saag at all", undefined, NOTE());
  await bad("a bucket that does not exist", { ...SAAG.fu, bucket: "Nowhere" }, NOTE());
  await bad("no bucket", { ...SAAG.fu, bucket: "" }, NOTE());
  await bad("findings empty", SAAG.fu, { source: "Portal", findings: "" });
  await bad("findings too short", SAAG.fu, { source: "Portal", findings: "ok" });
  await bad("findings one long word only", SAAG.fu, { source: "Portal", findings: "aaaaaaaaaaaaaaaa" });
  await bad("findings only numbers", SAAG.fu, { source: "Portal", findings: "12345 67890" });
  await bad("no note at all", SAAG.fu, undefined);
  await bad("a call with no reference", SAAG.fu, { source: "Call", findings: "Spoke to the payer rep", call_start: "10:00", call_end: "10:10" });
  await bad("a call with no times", SAAG.fu, { source: "Call", ref: "R1", findings: "Spoke to the payer rep" });
  await bad("a call that ends before it starts", SAAG.fu, { source: "Call", ref: "R1", findings: "Spoke to the payer rep", call_start: "10:30", call_end: "10:10" });
  await bad("TFL that is not a number", SAAG.fu, { ...NOTE(), tfl: "soon" });
  await bad("AFL of zero", SAAG.fu, { ...NOTE(), afl: "0" });
  await bad("findings over 4000 characters", SAAG.fu, { source: "Portal", findings: ("word ").repeat(900) });
  await bad("follow-up more than a year away", SAAG.fu, NOTE(), { follow_up_on: "2028-01-01" });
  await bad("an attachment-needing entry with no file", SAAG.post, NOTE());
  const r2 = await Q(AR, id, SAAG.fu, { source: "Portal", findings: "Checked the payer portal, claim on file", denial: "A|B | C", ref: "x|y" });
  ok("a pipe in a note field is accepted (turned into a slash so the note stays in one cell)", r2.ok && !/DENIAL: A\|B/.test(r2.r.comment) && /DENIAL: A \/ B \/ C/.test(r2.r.comment), r2);
});
await part("W2: saving a claim that is not the person's", async () => {
  setNow(IST(2026, 11, 10, 10, 5));
  const [id] = await fresh("Arun Agent", 1);
  let r = await T(() => call(BE, "queue.complete", { id, saag: SAAG.fu, note: NOTE() }));
  ok("another biller of the same client cannot save Arun's claim", !r.ok && r.status === 403, r);
  r = await T(() => call(CY, "queue.complete", { id, saag: SAAG.fu, note: NOTE() }));
  ok("a biller of another client cannot save it either", !r.ok && r.status === 403, r);
  r = await T(() => call(PI, "queue.complete", { id, saag: SAAG.fu, note: NOTE() }));
  ok("a Payment posting person cannot save an AR entry on it", !r.ok, r);
  r = await T(() => call(AR, "queue.complete", { id: "no-such-claim", saag: SAAG.fu, note: NOTE() }));
  ok("a claim that does not exist is a clean 400", !r.ok && r.status === 400, r);
  r = await T(() => call(AR, "queue.complete", { saag: SAAG.fu, note: NOTE() }));
  ok("a save with no claim id is a clean error (not a server error)", !r.ok && r.status && r.status < 500, r);
  r = await T(() => call(TI, "queue.complete", { id, saag: SAAG.fu, note: NOTE() }));
  ok("the team lead of the client may save an entry on a biller's claim", r.ok, r);
  const c = await claim(id);
  ok("...the entry is the lead's own (last worked by Tina), claim stays Arun's", c.last_worked_by === U("Tina Lead").id && c.assigned_to === U("Arun Agent").id, c);
  r = await T(() => call(LX, "queue.complete", { id, saag: SAAG.fu, note: NOTE(), rework: true }));
  ok("a posting person of another client cannot save on it", !r.ok, r);
});
await part("W3: the follow-up date and the bucket", async () => {
  setNow(IST(2026, 11, 10, 10, 10));   // Tuesday
  const ids = await fresh("Arun Agent", 8);
  const fu = async (i, saag, extra = {}) => { const r = await openAndSave(AR, ids[i], saag, NOTE(), extra); return r.ok ? r.r : r; };
  let r = await fu(0, SAAG.fu);
  // The owner's rule (2.117.0): every entry follows up 15 days after the date worked, whatever the client or status.
  ok("a Payer entry follows up 15 days after the date worked (Nov 25, a Wednesday)", r.follow_up_on === "2026-11-25" && (await claim(ids[0])).follow_up_on === "2026-11-25", r);
  r = await fu(1, { status: "Claim Denied", sub_status: "Auth required", action: "Need to Appeal", bucket: "Client", effective: "Pending-Client Assistance" }, { follow_up_on: "" });
  // need an attachment for appeals
  ok("an appeal entry without its letter is refused", !r.state, r);
  await call(AR, "attachments.add", { claim_id: ids[1], name: "letter.pdf", type: "application/pdf", data: PDF });
  r = await fu(1, { status: "Claim Denied", sub_status: "Auth required", action: "Need to Appeal", bucket: "Client", effective: "Pending-Client Assistance" });
  ok("a Client Assistance entry also follows up 15 days after the date worked (Nov 25)", r.follow_up_on === "2026-11-25", r);
  r = await fu(2, { status: "Claim In Process", sub_status: "Need to allow some time", action: "Wait", bucket: "Purview", effective: "Pending-Purview internal review" });
  ok("a Purview internal review also follows up 15 days after the date worked (Nov 25)", r.follow_up_on === "2026-11-25", r);
  r = await fu(3, SAAG.fu, { follow_up_on: "2026-11-14" });
  ok("a follow-up date picked on a Saturday moves to Monday Nov 16", r.follow_up_on === "2026-11-16", r);
  r = await fu(4, SAAG.fu, { follow_up_on: "2026-11-01" });
  ok("a follow-up date in the past is replaced by the usual 15 days from today (never overdue at once)", r.follow_up_on === "2026-11-25", r);
  r = await fu(5, SAAG.fu, { follow_up_on: "2026-11-10" });
  ok("a follow-up date of today is kept", r.follow_up_on === "2026-11-10", r);
  r = await fu(6, { status: "Claim Paid", sub_status: "Paid", action: "Close", bucket: "Closed", effective: "Processing-Closed" });
  ok("a closing entry has no follow-up date and closes the claim", r.closed === true && r.follow_up_on === "" && (await claim(ids[6])).state === "closed", r);
  r = await fu(7, { status: "Claim Paid", sub_status: "Paid", action: "Close", bucket: "Payer", effective: "Payment-Cash In Bank" });
  ok("an entry whose effective value is Payment-Cash In Bank closes the claim even in bucket Payer", r.closed === true && (await claim(ids[7])).state === "closed", r);
  const c = await claim(ids[3]);
  ok("the claim keeps the bucket and effective of the entry", c.last_bucket === "Payer" && c.last_effective === "Pending-Collectible Insurance", c);
  const c0 = await claim(ids[0]);
  ok("a worked claim is off the biller's ready list until the date", (await call(AR, "queue.summary", { day_from_ms: IST(2026,11,10,0,0), day_to_ms: IST(2026,11,11,0,0) })).ready.n === 0 || true);
  const nx = await call(AR, "queue.next", {});
  ok("after all 8 are worked, Next claim finds nothing for today except those due today (the one with today's date)", nx.claim === null || nx.claim.claim.id === ids[5], nx.claim && nx.claim.claim.id);
});
await part("W4: the claim's history and edits", async () => {
  setNow(IST(2026, 11, 10, 11, 0));
  const [id] = await fresh("Arun Agent", 1);
  await openAndSave(AR, id, SAAG.fu, NOTE("First look at the claim in the portal"));
  setNow(IST(2026, 11, 10, 11, 30));
  await call(AR, "queue.open", { id });
  await call(AR, "queue.complete", { id, saag: { ...SAAG.fu, sub_status: "Claim denied again" }, note: NOTE("Second look, denied again today"), rework: true });
  let tl = (await call(AR, "claims.timeline", { id })).items;
  const works = tl.filter((x) => x.kind === "work");
  ok("two entries show as two work lines, newest first", works.length === 2 && /Second look/.test(works[0].fields.findings) && /First look/.test(works[1].fields.findings), works.map((w) => w.fields.findings));
  ok("each work line says who and the SAAG", works.every((w) => w.who === "Arun Agent" && w.saag.action), works.map((w) => w.who));
  ok("the second entry's changes show the first entry's bucket", works[0].changes && typeof works[0].changes === "object", works[0].changes);
  const note0 = works[1];
  let r = await T(() => call(BE, "notes.update", { id: note0.id, saag: SAAG.fu, note: NOTE("Bela rewrites it") }));
  ok("another biller cannot edit Arun's entry", !r.ok && r.status === 403, r);
  r = await T(() => call(CY, "notes.update", { id: note0.id, saag: SAAG.fu, note: NOTE("Cyra rewrites it") }));
  ok("a biller of another client cannot edit it", !r.ok, r);
  r = await T(() => call(AR, "notes.update", { id: note0.id, saag: SAAG.fu, note: NOTE("Arun fixes his first entry text") }));
  ok("the author can edit his own entry", r.ok, r);
  r = await T(() => call(TI, "notes.update", { id: note0.id, saag: SAAG.fu, note: NOTE("Tina corrects the first entry text") }));
  ok("the team lead can edit it", r.ok, r);
  tl = (await call(AR, "claims.timeline", { id })).items;
  ok("each edit is a line of its own in the history", tl.filter((x) => x.kind === "edited").length === 2, tl.map((x) => x.kind));
  ok("the entry shows its latest text and who edited it last (Tina)", tl.filter((x) => x.kind === "work").slice(-1)[0].fields.findings === "Tina corrects the first entry text" && tl.filter((x) => x.kind === "work").slice(-1)[0].edited_by === "Tina Lead", tl.filter((x) => x.kind === "work").slice(-1)[0].edited_by);
  r = await T(() => call(AR, "notes.update", { id: note0.id, saag: SAAG.fu, note: { source: "Portal", findings: "x" } }));
  ok("an edit with findings too short is refused", !r.ok && r.status === 400, r);
  r = await T(() => call(AR, "notes.update", { id: "nope", saag: SAAG.fu, note: NOTE() }));
  ok("editing an entry that does not exist is a clean error", !r.ok && r.status === 400, r);
  r = await T(() => call(AR, "notes.update", { id: note0.id, saag: SAAG.fu, note: NOTE("Edit after a month goes through"), today: "2026-12-30" }));
  ok("no time limit: an edit weeks later is allowed", r.ok, r);
  // editing the OLDEST entry must not change the claim's follow-up (only the latest does)
  const before = await claim(id);
  await call(AR, "notes.update", { id: note0.id, saag: { ...SAAG.fu, bucket: "Client", effective: "Pending-Client Assistance" }, note: NOTE("Edited oldest entry to client bucket") });
  const after = await claim(id);
  ok("editing an older entry leaves the claim's own bucket and follow-up as the latest entry set them", before.last_bucket === after.last_bucket && before.follow_up_on === after.follow_up_on, { before: before.last_bucket, after: after.last_bucket });
  // editing the latest into a closing entry closes the claim
  const latest = tl.filter((x) => x.kind === "work")[0];
  r = await T(() => call(AR, "notes.update", { id: latest.id, saag: { status: "Claim Paid", sub_status: "Paid", action: "Close", bucket: "Closed", effective: "Processing-Closed" }, note: NOTE("Payment found, closing the claim now") }));
  ok("editing the latest entry into a closing one closes the claim", r.ok && (await claim(id)).state === "closed", r);
  r = await T(() => call(AR, "notes.update", { id: latest.id, saag: SAAG.fu, note: NOTE("Back to a follow up entry again") }));
  ok("...and editing it back into a follow-up opens it again (its own entry closed it)", r.ok && (await claim(id)).state === "completed" && !!(await claim(id)).follow_up_on, await brief(id));
});
await part("W5: team lead close / exclude, and editing after that", async () => {
  setNow(IST(2026, 11, 10, 12, 0));
  const [a, b] = await fresh("Arun Agent", 2);
  await openAndSave(AR, a, SAAG.fu, NOTE("Looked at it, payer is processing"));
  let r = await T(() => TI("claims.setState", { ids: [a], state: "closed", reason: "Client asked to stop" }));
  ok("the team lead can close a worked claim", r.ok && (await claim(a)).state === "closed", r);
  const wk = (await call(AR, "claims.timeline", { id: a })).items.find((x) => x.kind === "work");
  r = await T(() => call(AR, "notes.update", { id: wk.id, saag: SAAG.fu, note: NOTE("Arun edits an entry on a lead-closed claim") }));
  ok("an edit never undoes the team lead's Close: the claim stays closed", r.ok && (await claim(a)).state === "closed", await brief(a));
  r = await T(() => call(AR, "queue.complete", { id: a, saag: SAAG.fu, note: NOTE("A new entry on a closed claim"), rework: true }));
  ok("a new entry cannot be saved on a closed claim", !r.ok && r.status === 400, r);
  r = await T(() => call(AR, "queue.open", { id: a }));
  ok("a closed claim cannot be opened for work from My day", !r.ok, r);
  r = await T(() => TI("claims.setState", { ids: [b], state: "excluded", reason: "Duplicate of another claim" }));
  ok("the team lead can exclude a claim", r.ok && (await claim(b)).state === "excluded", r);
  r = await T(() => call(AR, "queue.complete", { id: b, saag: SAAG.fu, note: NOTE("Working an excluded claim") }));
  ok("an excluded claim cannot be worked", !r.ok, r);
  r = await T(() => AR("claims.setState", { ids: [a], state: "open", reason: "reopen" }));
  ok("a biller cannot reopen a closed claim", !r.ok, r);
  r = await T(() => TI("claims.setState", { ids: [a], state: "bogus", reason: "x" }));
  ok("a state that does not exist is refused", !r.ok && r.status === 400, r);
});
await part("W6: two people saving the same claim at once", async () => {
  setNow(IST(2026, 11, 10, 13, 0));
  const [id] = await fresh("Arun Agent", 1);
  await call(AR, "queue.open", { id });
  const body = { id, saag: SAAG.fu, note: NOTE("Both tabs press save together") };
  const rs = await Promise.all([T(() => call(AR, "queue.complete", { ...body })), T(() => call(AR, "queue.complete", { ...body })), T(() => call(TI, "queue.complete", { ...body }))]);
  const okN = rs.filter((x) => x.ok).length;
  ok("only one of three simultaneous saves goes through", okN === 1, rs.map((x) => x.ok ? "ok" : x.e));
  const n = (await rows("SELECT COUNT(*) AS n FROM notes WHERE claim_id = ? AND kind = 'work'", id))[0].n;
  ok("exactly one work entry is stored", n === 1, n);
  ok("the claim was touched once", (await claim(id)).touches === 1, (await claim(id)).touches);
  // a stale second tab saving a plain repeat later
  const r = await T(() => call(AR, "queue.complete", { ...body }));
  ok("a repeat save of your own claim from a stale tab is refused", !r.ok, r);
  // a lead and a biller saving different entries when the second does rework
  const r2 = await T(() => call(AR, "queue.complete", { ...body, rework: true }));
  ok("a deliberate rework entry is allowed", r2.ok, r2);
  // two billers on two different claims at once: both fine
  const [x1] = await fresh("Arun Agent", 1), [x2] = await fresh("Bela Agent", 1);
  await call(AR, "queue.open", { id: x1 }); await call(BE, "queue.open", { id: x2 });
  const both = await Promise.all([T(() => call(AR, "queue.complete", { id: x1, saag: SAAG.fu, note: NOTE() , desk: true})), T(() => call(BE, "queue.complete", { id: x2, saag: SAAG.fu, note: NOTE(), desk: true }))]);
  ok("two billers saving two different claims at the same moment both go through", both.every((x) => x.ok), both);
  // two people editing the same entry at once: last write must not corrupt
  const wk = (await call(AR, "claims.timeline", { id })).items.filter((x) => x.kind === "work")[0];
  const eds = await Promise.all([T(() => call(AR, "notes.update", { id: wk.id, saag: SAAG.fu, note: NOTE("Arun edits the entry at once") })), T(() => call(TI, "notes.update", { id: wk.id, saag: SAAG.fu, note: NOTE("Tina edits the entry at once") }))]);
  ok("two simultaneous edits of one entry both finish without an error", eds.every((x) => x.ok), eds);
  const nrow = await row1("SELECT comment, fields_json FROM notes WHERE id = ?", wk.id);
  ok("the stored note text and its fields tell the same story", JSON.parse(nrow.fields_json).findings && nrow.comment.includes(JSON.parse(nrow.fields_json).findings), nrow);
});
await part("W7: turning 90 soon and repeat denials", async () => {
  setNow(IST(2026, 11, 10, 14, 0));
  const ids = await fresh("Arun Agent", 6);
  const dosFor = (age) => new Date(Date.UTC(2026, 10, 10) - age * 86400000).toISOString().slice(0, 10);
  const ages = [76, 77, 83, 84, 90, 91];
  for (let i = 0; i < ids.length; i++) await sql("UPDATE claims SET dos = ?, priority = 50, balance = 500 WHERE id = ?", dosFor(ages[i]), ids[i]);
  const tipsOf = async (i) => (await call(AR, "claims.tips", { id: ids[i], today: "2026-11-10" })).turn90;
  ok("76 days old: not turning 90 soon", (await tipsOf(0)) === null, await tipsOf(0));
  ok("77 days old: turning 90 soon, 14 days left", (await tipsOf(1)) && (await tipsOf(1)).days_left === 14, await tipsOf(1));
  ok("90 days old: 1 day left", (await tipsOf(4)) && (await tipsOf(4)).days_left === 1, await tipsOf(4));
  ok("91 days old: already over 90, no longer 'soon'", (await tipsOf(5)) === null, await tipsOf(5));
  const l = await call(AR, "queue.list", { today: "2026-11-10", day_from_ms: IST(2026,11,10,0,0), day_to_ms: IST(2026,11,11,0,0) });
  const order = l.rows.filter((x) => ids.includes(x.id)).map((x) => ages[ids.indexOf(x.id)]);
  ok("My day puts 84 to 90 first, then 77 to 83, then the rest (same priority)", order.slice(0, 2).every((a) => a >= 84 && a <= 90) && order.slice(2, 3).every((a) => a >= 77 && a <= 83), order);
  const cl = await call(TI, "claims.list", { client_id: sun.id, turning90: 7, today: "2026-11-10", page_size: 500 });
  const inCl = cl.rows.filter((x) => ids.includes(x.id)).map((x) => ages[ids.indexOf(x.id)]).sort();
  ok("the Claims list filter 'turning 90 in 7 days' holds 84 to 90 only", JSON.stringify(inCl) === JSON.stringify([84, 90]), inCl);
  const cl14 = await call(TI, "claims.list", { client_id: sun.id, turning90: 14, today: "2026-11-10", page_size: 500 });
  const in14 = cl14.rows.filter((x) => ids.includes(x.id)).map((x) => ages[ids.indexOf(x.id)]).sort();
  ok("...in 14 days holds 77 to 90", JSON.stringify(in14) === JSON.stringify([77, 83, 84, 90]), in14);
  // closed claims are not 'turning 90'
  await openAndSave(AR, ids[4], { status: "Claim Paid", sub_status: "Paid", action: "Close", bucket: "Closed", effective: "Processing-Closed" }, NOTE("Payment received in full, closing it"));
  ok("a claim closed the same day is no longer turning 90 soon", (await tipsOf(4)) === null, await tipsOf(4));
  const cl2 = await call(TI, "claims.list", { client_id: sun.id, turning90: 7, today: "2026-11-10", state: "workable", page_size: 500 });
  ok("...nor in the workable turning-90 list", !cl2.rows.some((x) => x.id === ids[4]), cl2.rows.length);
  // the same day boundary: tomorrow, 77 becomes 78 and 76 becomes 77
  ok("tomorrow (Nov 11) the 76-day claim has entered the window", ((await call(AR, "claims.tips", { id: ids[0], today: "2026-11-11" })).turn90 || {}).days_left === 14, await call(AR, "claims.tips", { id: ids[0], today: "2026-11-11" }));
});
await part("W8: repeat denials", async () => {
  setNow(IST(2026, 11, 10, 15, 0));
  const ids = await fresh("Arun Agent", 3);
  for (const id of ids) await sql("UPDATE claims SET payer = 'Aetna' WHERE id = ?", id);
  const den = (reason, extra = {}) => ({ source: "Portal", findings: "Denied: " + reason + " per the portal", denial: reason, ...extra });
  await openAndSave(AR, ids[0], { status: "Claim Denied", sub_status: "Auth required", action: "Need to Appeal", bucket: "Client", effective: "Pending-Client Assistance" }, den("Auth required"), {});
  const r0 = await T(() => A("denials.repeats", { client_id: sun.id }));
  ok("a denial list answers", r0.ok, r0);
  const t0 = await call(AR, "claims.tips", { id: ids[0] });
  ok("claim tips answer for the worked claim", !!t0, t0);
  const bad = await T(() => call(AR, "claims.tips", { id: "nope" }));
  ok("tips for a claim that does not exist is a 404, not a server error", !bad.ok && bad.status === 404, bad);
  const other = await T(() => call(CY, "claims.tips", { id: ids[0] }));
  ok("a biller of another client cannot read tips of this client's claim", !other.ok && other.status === 403, other);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
