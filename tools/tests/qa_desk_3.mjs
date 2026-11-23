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
const hsOf = async (id, dept) => (await hos(id)).filter((h) => h.dept === dept).slice(-1)[0];
const tlNotices = async (name) => (await rows("SELECT text, kind, view FROM user_notices WHERE user_id = ? ORDER BY at", U(name).id));
const submitted = async (id, who = AR) => { await save(who, id, SAAG.resub); await ASSIST(QU, (await openH(id, "submission")).id, "complete", { proof: { date: nowIso(), ref: "B-1" } }); return openH(id, "subcheck"); };
await part("R1: a rejected recheck goes to the right desk, and the team lead is told", async () => {
  setNow(IST(2026, 11, 9, 9, 0));
  const ids = await give("Arun Agent", 8);
  const rcs = []; for (let i = 0; i < 8; i++) { setNow(IST(2026, 11, 9, 9, i)); rcs.push(await submitted(ids[i])); }
  setNow(IST(2026, 11, 12, 10, 0));   // all rechecks open
  await sql("DELETE FROM user_notices");
  // 0: Rejections set -> Rejections
  let r = await ASSIST(AR, rcs[0].id, "rejected", { reason: "Payer rejected", note: "Payer says the member id is invalid" });
  ok("rejection person set: it goes to Rejections", r.ok && r.r.went === "rejection" && !!(await openH(ids[0], "rejection")), r);
  let tn = await tlNotices("Tina Lead");
  ok("...and Tina gets the 'email the client' notice with the claim number", tn.length === 1 && tn[0].kind === "rejected" && tn[0].text.includes((await claim(ids[0])).claim_no), tn);
  // 1: rejection person switched off -> backup none -> Submission
  await sql("UPDATE users SET active = 0 WHERE id = ?", U("Rex Reject").id);
  r = await ASSIST(AR, rcs[1].id, "rejected", { reason: "Payer rejected", note: "Payer says the member id is invalid" });
  ok("Rejections person switched off: it goes to Submission to correct and resubmit", r.ok && r.r.went === "submission" && !!(await openH(ids[1], "submission")), r);
  tn = await tlNotices("Tina Lead");
  ok("...Tina is told again, naming Submission", tn.length === 2 && /Submission/.test(tn[1].text), tn.map((x) => x.text));
  // 2: submission also gone -> back to the biller + profile notice
  await sql("UPDATE users SET active = 0 WHERE id = ?", U("Quin Submit").id);
  r = await ASSIST(AR, rcs[2].id, "rejected", { reason: "Payer rejected", note: "Payer says the member id is invalid" });
  const c2 = await claim(ids[2]);
  ok("nobody set for either: back on the biller's list today", r.ok && r.r.went === "biller" && c2.state === "assigned" && c2.follow_up_on === "2026-11-12", [r, await brief(ids[2])]);
  tn = await tlNotices("Tina Lead");
  ok("...the team lead is told nobody is set, and the line opens the profile", tn.length === 3 && tn[2].kind === "profile" && tn[2].view === "clients" && tn[2].text.includes(c2.claim_no), tn[2]);
  // 3: claim closed meanwhile -> stays closed
  await call(TI, "claims.setState", { ids: [ids[3]], state: "closed", reason: "Client asked to stop" }).catch(() => {});
  await TI("claims.setState", { ids: [ids[3]], state: "closed", reason: "Client asked to stop" });
  r = await ASSIST(AR, rcs[3].id, "rejected", { reason: "Payer rejected", note: "Payer says the member id is invalid" });
  const c3 = await claim(ids[3]);
  ok("a claim the team lead closed stays closed after a rejected recheck (nobody set)", r.ok && r.r.went === "kept" && c3.state === "closed", [r, await brief(ids[3])]);
  // restore desk people
  await sql("UPDATE users SET active = 1 WHERE id IN (?, ?)", U("Rex Reject").id, U("Quin Submit").id);
  r = await ASSIST(AR, rcs[4].id, "rejected", { reason: "Payer rejected", note: "Payer says the member id is invalid" });
  ok("people back on: rejected recheck goes to Rejections again", r.ok && r.r.went === "rejection", r);
  const tn2 = await tlNotices("Tina Lead");
  const tn3 = (await tlNotices("Mona Manager"));
  ok("the manager (not a team lead of the client) is not sent the 'email the client' line", tn3.filter((n) => n.kind === "rejected").length === 0, tn3);
  // the Lakeview lead hears nothing about Sunrise
  ok("Lara (Lakeview) hears nothing about Sunrise claims", (await tlNotices("Lara Lead")).length === 0, await tlNotices("Lara Lead"));
});
await part("R2: a rejected claim entry goes to Rejections first", async () => {
  setNow(IST(2026, 11, 10, 9, 0));
  const [a, b] = await give("Bela Agent", 2);
  await save(BE, a, SAAG.rej);
  const h = await openH(a, "rejection");
  ok("an entry with status Claim Rejected goes to the Rejections person (Rex)", h && h.lead_id === U("Rex Reject").id, h);
  const qr = await call(RX, "handoffs.list", { dept: "rejection", view: "open" });
  ok("it is first on Rex's list", qr.rows.length && qr.rows[0].claim_id === a, qr.rows.map((x) => x.dept));
  await sql("UPDATE clients SET rejection_mode = '' WHERE id = ?", sun.id);
  await save(BE, b, SAAG.rej);
  const h2 = await openH(b, "submission");
  ok("with no Rejections person on the client: the rejected entry goes to Submission", h2 && h2.lead_id === U("Quin Submit").id, h2);
  await sql("UPDATE clients SET rejection_mode = 'person' WHERE id = ?", sun.id);
});
await part("R3: desks with nobody set: the entry says so and the claim stays with the biller", async () => {
  setNow(IST(2026, 11, 10, 9, 30));
  await sql("UPDATE clients SET posting_mode = '' WHERE id = ?", sun.id);
  const [id] = await give("Dev Agent", 1);
  const DE2 = DE;
  await call(DE2, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
  const r = await T(() => save(DE2, id, SAAG.post));
  ok("a posting entry on a client with no Payment posting person is saved and closes the claim for AR", r.ok && r.r.closed === true && r.r.handoff && r.r.handoff.mode !== "person", r);
  const c = await claim(id);
  ok("the claim is closed, not In process, and has no hand-off", c.state === "closed" && !(await hos(id)).length, await brief(id));
  const ev = (await call(DE2, "claims.timeline", { id })).items.filter((x) => x.kind === "handoff_none");
  ok("the history says nobody does it for this client", ev.length === 1, ev.length);
  await sql("UPDATE clients SET posting_mode = 'person' WHERE id = ?", sun.id);
});
await part("R4: the desk leads, backups and who can see what", async () => {
  setNow(IST(2026, 11, 10, 9, 45));
  const [id] = await give("Arun Agent", 1);
  await call(AR, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
  await save(AR, id, SAAG.post);
  const g1 = await T(() => call(PI, "claims.get", { id }));
  ok("Pia (posting lead) opens the claim handed to her", g1.ok && g1.r.claim.id === id, g1.ok || g1);
  const g2 = await T(() => call(QU, "claims.get", { id }));
  ok("Quin (responsible for Sunrise submission) may open its claims", g2.ok, g2.ok || g2);
  const g3 = await T(() => call(LX, "claims.get", { id }));
  ok("Lex (Lakeview posting) cannot open a Sunrise claim", !g3.ok && g3.status === 403, g3.ok || g3);
  const g4 = await T(() => call(BE, "claims.get", { id }));
  ok("Bela (another Sunrise biller) cannot open Arun's claim", !g4.ok, g4.ok || g4);
  const g5 = await T(() => call(TI, "claims.get", { id }));
  ok("Tina (AR team lead) can", g5.ok, g5.ok || g5);
  const g6 = await T(() => call(PAT, "claims.get", { id }));
  ok("Pat (posting team lead, not on the claim) can see claims of the client she is responsible for, at her desk", g6.ok || g6.status === 403, g6.ok || g6);
  const lst = await call(OT, "handoffs.list", { dept: "posting", view: "open" });
  ok("Otto (the backup) sees the hand-off in Pia's list", lst.rows.some((x) => x.claim_id === id), lst.total);
  const lst2 = await call(QU, "handoffs.list", { dept: "posting" });
  ok("Quin asking for the posting list gets only Submission's", lst2.rows.every((x) => x.dept !== "posting"), lst2.rows.map((x) => x.dept));
  const lst3 = await call(AR, "handoffs.list", { dept: "posting" });
  ok("a plain AR biller's desk list holds nothing of hers (or is refused)", lst3.rows ? lst3.rows.length === 0 : true, lst3);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
