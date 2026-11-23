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
const DE = await firstIn("Dev Agent"), LA = await firstIn("Lara Lead");
const SM = await firstIn("Sam Submitlake"), SME = await firstIn("Sima Expert").catch(() => null);
const ESC = (o = {}) => ({ client_id: sun.id, kind: "external", day: "2026-11-09", dept: "Account Receivable", raised_who: "Dr. Client Owner", reported_to: "Tina Lead", description: "The payer was billed twice for one visit", email_subject: "Double billing on one visit", comment: "Raised by phone, checking now",
  owner_id: U("Tina Lead").id, channels: ["Email"], location_id: "all", status: "open", ...o });
const escDepts = (await TI("escalations.list", {})).depts;
await part("E1: logging an escalation: what is required and what it does", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  await sql("DELETE FROM user_notices");
  const bad = async (name, o) => { const r = await T(() => TI("escalations.save", ESC(o))); ok(name, !r.ok && r.status === 400, r); };
  await bad("no type is refused (type comes first)", { kind: "" });
  await bad("a type that is not External or Internal", { kind: "maybe" });
  await bad("no received date", { day: "" });
  await bad("a received date that is not a real date (Feb 30)", { day: "2026-02-30" });
  await bad("a received date in the future", { day: "2027-01-01" });
  await bad("no department", { dept: "" });
  await bad("a department that does not exist", { dept: "Cooking" });
  await bad("nobody raised it", { raised_who: " " });
  await bad("not reported to anyone", { reported_to: "" });
  await bad("a description that is one word", { description: "bad" });
  await bad("no subject", { email_subject: "" });
  await bad("no comment", { comment: "" });
  await bad("no responding person", { owner_id: "" });
  await bad("a responding person who does not exist", { owner_id: "nobody" });
  await bad("no channel", { channels: [] });
  await bad("no location", { location_id: "" });
  await bad("a location of another client", { location_id: lake.locations[0].id });
  await bad("our error with nobody named", { is_error: "Y", error_by_id: "", error_dow: "2026-11-05" });
  await bad("our error with no DOW", { is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: "" });
  await bad("our error with a DOW after the received date", { is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: "2026-11-10" });
  await bad("closing without the root cause", { status: "resolved", is_error: "N", rca: "", corrective: "Fixed the claim", preventive: "Added a check", close_on: "2026-11-10", review_on: "2026-11-10", rework: "Yes" });
  await bad("closing with a close date before the received date", { status: "resolved", is_error: "N", rca: "Root cause words", corrective: "Corrective words", preventive: "Preventive words", close_on: "2026-11-01", review_on: "2026-11-10", rework: "Yes" });
  await bad("closing with a close date in the future", { status: "resolved", is_error: "N", rca: "Root cause words", corrective: "Corrective words", preventive: "Preventive words", close_on: "2026-12-01", review_on: "2026-11-10", rework: "Yes" });
  await bad("closing without the review date", { status: "resolved", is_error: "N", rca: "Root cause words", corrective: "Corrective words", preventive: "Preventive words", close_on: "2026-11-10", rework: "Yes" });
  await bad("closing without saying whether the rework is done", { status: "resolved", is_error: "N", rca: "Root cause words", corrective: "Corrective words", preventive: "Preventive words", close_on: "2026-11-10", review_on: "2026-11-10" });
  ok("none of those refused saves left a row or a notice", (await rows("SELECT COUNT(*) n FROM escalations"))[0].n === 0 && (await rows("SELECT COUNT(*) n FROM user_notices"))[0].n === 0, await rows("SELECT COUNT(*) n FROM escalations"));
  const outsider = await T(() => AR("escalations.save", ESC()));
  ok("a biller cannot log an escalation", !outsider.ok && outsider.status === 403, outsider);
  const other = await T(() => LA("escalations.save", ESC()));
  ok("the Lakeview lead cannot log one on Sunrise", !other.ok && other.status === 403, other);
  const r1 = await T(() => TI("escalations.save", ESC()));
  const r2 = await T(() => TI("escalations.save", ESC({ kind: "internal", dept: "Account Receivable", raised_who: "Mona Manager", reported_to: "Tina Lead", day: "2026-11-10" })));
  ok("two valid escalations are saved as SR1 and SR2", r1.ok && r2.ok && r1.r.sr === 1 && r2.r.sr === 2, [r1, r2]);
  const lk = await T(() => LA("escalations.save", ESC({ client_id: lake.id, location_id: "all", owner_id: U("Lara Lead").id, reported_to: "Lara Lead" })));
  ok("Lakeview numbers its own SR from 1", lk.ok && lk.r.sr === 1, lk);
  const ls = await TI("escalations.list", { client_id: sun.id, today: "2026-11-10" });
  ok("the list holds both, with external 1 and internal 1 logged this month and 2 open", ls.stats.logged_month === 2 && ls.stats.logged_external === 1 && ls.stats.logged_internal === 1 && ls.stats.open === 2, ls.stats);
  ok("the client's SLA counts the external one only (target 0, so missed), the internal beside it", ls.sla.n === 1 && ls.sla.met === false && ls.sla.internal === 1, ls.sla);
  const notes = await rows("SELECT u.name, n.text FROM user_notices n JOIN users u ON u.id = n.user_id");
  ok("the project's team lead is told once for the Sunrise ones (the saver, Tina, is not told in the bell)", notes.filter((n) => n.name === "Tina Lead").length === 0, notes);
  ok("...nobody's bell line carries the description or the subject", !notes.some((n) => /payer was billed|Double billing/.test(n.text)), notes.map((n) => n.text));
  const cnt = await TI("escalations.count", {});
  ok("the count says 2 open", cnt.open === 2, cnt);
  // the 24-hour rule
  setNow(IST(2026, 11, 11, 11, 0));
  const ls2 = await TI("escalations.list", { client_id: sun.id, today: "2026-11-11" });
  const e1 = ls2.rows.find((x) => x.sr === 1);
  ok("SR1 logged Tuesday 10:00: Wednesday 11:00 it is past 24 working hours and needs a reason", e1.past_24 && e1.needs_reason, [e1.past_24, e1.needs_reason, e1.open_hours]);
  const huddle = await call(TI, "team.huddle", { today: "2026-11-11" });
  ok("Live status shows the same escalations and red ones", huddle.escalations.length === 2 && huddle.escalations.filter((e) => e.red).length === ls2.stats.needs_reason, [huddle.escalations.length, huddle.escalations.filter((e) => e.red).length, ls2.stats.needs_reason]);
  const cnt2 = await TI("attention.count", {});
  ok("the Needs attention count says the same open and red numbers", cnt2.esc_open === ls2.stats.open && cnt2.esc_late === ls2.stats.needs_reason, [cnt2.esc_open, cnt2.esc_late, ls2.stats]);
  const reas = await T(() => TI("escalations.reason", { id: e1.id, reason: "short", expected_on: "2026-11-13" }));
  ok("a reason of one word is refused", !reas.ok && reas.status === 400, reas);
  const reas2 = await T(() => TI("escalations.reason", { id: e1.id, reason: "Waiting for the payer to answer our dispute", expected_on: "2026-11-01" }));
  ok("an expected date in the past is refused", !reas2.ok && reas2.status === 400, reas2);
  const reas3 = await T(() => TI("escalations.reason", { id: e1.id, reason: "Waiting for the payer to answer our dispute", expected_on: "2026-11-13" }));
  ok("a reason and a date are saved", reas3.ok, reas3);
  const ls3 = await TI("escalations.list", { client_id: sun.id, today: "2026-11-11" });
  ok("the escalation no longer needs a reason", !ls3.rows.find((x) => x.sr === 1).needs_reason && ls3.stats.needs_reason === 1, ls3.stats);
  setNow(IST(2026, 11, 14, 11, 0));
  const ls4 = await TI("escalations.list", { client_id: sun.id, today: "2026-11-14" });
  ok("a date that has passed makes it red again (past the expected date)", ls4.rows.find((x) => x.sr === 1).past_expected && ls4.stats.past_expected >= 1, ls4.stats);
  const cnt3 = await TI("escalations.count", {});
  ok("the count of past-expected agrees", cnt3.past_expected === ls4.stats.past_expected, [cnt3, ls4.stats]);
  // an error marked later
  setNow(IST(2026, 11, 14, 12, 0));
  await sql("DELETE FROM user_notices");
  const e2 = ls4.rows.find((x) => x.sr === 2);
  const ed = await T(() => TI("escalations.save", ESC({ id: e2.id, kind: "internal", day: "2026-11-10", raised_who: "Mona Manager", reported_to: "Tina Lead", is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: "2026-11-05" })));
  ok("marking it as our error, made by Arun, is saved", ed.ok, ed);
  const st = await call(TI, "team.status", { from: "2026-11-09", to: "2026-11-13", today: "2026-11-14" });
  const ar = st.rows.find((r) => r.name === "Arun Agent");
  ok("Team status shows the error against Arun (internal 1)", ar.esc_n === 1 && ar.esc_int === 1 && ar.esc_ext === 0, [ar.esc_n, ar.esc_int, ar.esc_ext]);
  const st2 = await call(TI, "team.status", { from: "2026-11-02", to: "2026-11-06", today: "2026-11-14" });
  ok("an earlier week (before the escalation was received) shows none", st2.rows.find((r) => r.name === "Arun Agent").esc_n === 0, st2.rows.find((r) => r.name === "Arun Agent").esc_n);
  const nt = await rows("SELECT u.name, n.text FROM user_notices n JOIN users u ON u.id = n.user_id");
  ok("the error notice is for the supervisors other than the one who marked it", nt.every((n) => n.name !== "Tina Lead"), nt);
  const ed2 = await T(() => TI("escalations.save", ESC({ id: e2.id, kind: "internal", day: "2026-11-10", raised_who: "Mona Manager", reported_to: "Tina Lead", is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: "2026-11-05" })));
  ok("saving it again as an error does not tell them again", (await rows("SELECT COUNT(*) n FROM user_notices"))[0].n === nt.length, nt.length);
  // closing
  const done = await T(() => TI("escalations.save", ESC({ id: e2.id, kind: "internal", day: "2026-11-10", raised_who: "Mona Manager", reported_to: "Tina Lead", is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: "2026-11-05", status: "resolved", rca: "Wrong payer id on the claim", corrective: "Corrected and resubmitted", preventive: "Added a payer id check", close_on: "2026-11-13", review_on: "2026-11-13", rework: "Yes" })));
  ok("closing with every closing field is saved", done.ok, done);
  const ls5 = await TI("escalations.list", { client_id: sun.id, today: "2026-11-14" });
  ok("the month's counts: 1 open, 1 closed this month", ls5.stats.open === 1 && ls5.stats.closed_month === 1, ls5.stats);
  const cnt4 = await TI("escalations.count", {});
  ok("the open count agrees (1)", cnt4.open === 1, cnt4);
  const l2 = await TI("escalations.list", { client_id: sun.id, status: "resolved", today: "2026-11-14" });
  ok("the Closed filter holds one", l2.rows.length === 1 && l2.rows[0].sr === 2, l2.rows.length);
  const x1 = await TI("escalations.list", { client_id: sun.id, kind: "external", today: "2026-11-14" }), x2 = await TI("escalations.list", { client_id: sun.id, kind: "internal", today: "2026-11-14" });
  ok("filters by type: 1 external, 1 internal", x1.rows.length === 1 && x2.rows.length === 1, [x1.rows.length, x2.rows.length]);
  const lakeSees = await T(() => LA("escalations.list", { client_id: sun.id }));
  ok("the Lakeview lead cannot read Sunrise's escalations", !lakeSees.ok, lakeSees.ok ? lakeSees.r.rows.length : "");
  const lakeAll = await LA("escalations.list", {});
  ok("...and sees only her own client's in the full list", lakeAll.rows.every((x) => x.client_id === lake.id) && lakeAll.rows.length === 1, lakeAll.rows.length);
});
await part("E2: two escalations logged at the same moment get different SR numbers", async () => {
  setNow(IST(2026, 11, 15, 12, 0));
  const rs = await Promise.all([1, 2, 3, 4].map((i) => T(() => TI("escalations.save", ESC({ day: "2026-11-10", email_subject: "Parallel escalation " + i })))));
  const srs = rs.filter((x) => x.ok).map((x) => x.r.sr).sort();
  ok("four at once: all saved, SR numbers all different", rs.every((x) => x.ok) && new Set(srs).size === 4, rs.map((x) => x.ok ? x.r.sr : x.e));
  ok("...with no gaps after the earlier ones", JSON.stringify(srs) === JSON.stringify([3, 4, 5, 6]), srs);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
