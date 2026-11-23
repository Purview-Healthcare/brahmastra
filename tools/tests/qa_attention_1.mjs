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
const ASSIST = async (who, hid, outcome, extra = {}) => T(() => call(who, "handoffs.close", { id: hid, outcome, ...extra }));
await part("F1: claims a biller flags for the team lead: the same numbers everywhere", async () => {
  setNow(IST(2026, 11, 9, 10, 0));   // Monday
  const ids = await give("Arun Agent", 5);
  for (let i = 0; i < 5; i++) { setNow(IST(2026, 11, 9, 10 + i, 0)); await call(AR, "queue.open", { id: ids[i] }); await call(AR, "queue.complete", { id: ids[i], saag: SAAG.fu, note: NOTE("Flagging claim " + i + " for the team lead"), escalate: true, desk: true }); }
  setNow(IST(2026, 11, 12, 11, 0));   // Thursday 11:00: 0 and 1 are past 48 working hours (Mon 10:00 + 48h = Wed 10:00; 10:00 + 48 = Wed 11:00 ... ) 
  const at = (i) => IST(2026, 11, 9, 10 + i, 0);
  const lateExp = ids.filter((_, i) => at(i) + 2 * 86400000 < Date.now()).length;
  const cnt = await call(TI, "attention.count", {});
  ok("the badge counts the 5 flagged claims", cnt.escalations === 5, cnt);
  ok("past 48 working hours: " + lateExp, cnt.overdue === lateExp, [cnt.overdue, lateExp]);
  const lst = await call(TI, "attention.list", {});
  ok("the list holds 5 rows and the same number past 48 hours", lst.rows.length === 5 && lst.overdue === lateExp, [lst.rows.length, lst.overdue]);
  const hud = await call(TI, "team.huddle", { today: nowIso() });
  ok("Live status lists the same 5 flagged, and the same number red", hud.flagged.length === 5 && hud.flagged.filter((f) => f.red).length === lateExp, [hud.flagged.length, hud.flagged.filter((f) => f.red).length]);
  const tl = await call(TI, "tat.list", {});
  const flaggedLate = tl.late.filter((x) => x.part === "flagged").length;
  ok("the Past TAT list has the same late flagged claims", flaggedLate === lateExp, [flaggedLate, lateExp]);
  const inv = await call(TI, "inventory.status", { client_id: sun.id, today: nowIso() });
  // hold the oldest
  const r = await T(() => call(TI, "tat.hold", { kind: "flag", id: ids[0], reason: "Waiting on the payer", until: "2026-11-16", note: "" }));
  ok("the team lead puts the oldest on hold (Can't close yet)", r.ok || /reason/i.test(r.e || ""), r);
  const reason = ((await call(TI, "tat.list", {})).reasons || [])[0];
  const r2 = await T(() => call(TI, "tat.hold", { kind: "flag", id: ids[0], reason, until: "2026-11-16", note: "Payer needs two more days" }));
  ok("a hold with a listed reason is accepted", r2.ok, r2);
  const cnt2 = await call(TI, "attention.count", {});
  const lst2 = await call(TI, "attention.list", {});
  const hud2 = await call(TI, "team.huddle", { today: nowIso() });
  const tl2 = await call(TI, "tat.list", {});
  ok("after the hold: the badge's overdue drops by one", cnt2.overdue === lateExp - 1, cnt2.overdue);
  ok("after the hold: the Needs attention list's own overdue count drops by one too (the page hides the red itself, from the Past TAT list)", lst2.overdue === lateExp - 1, [lst2.overdue, lateExp - 1]);
  ok("after the hold: the held row is not red on the list", !lst2.rows.find((x) => x.id === ids[0]).overdue, lst2.rows.find((x) => x.id === ids[0]).overdue);
  ok("after the hold: Live status shows one fewer red", hud2.flagged.filter((f) => f.red).length === lateExp - 1, hud2.flagged.filter((f) => f.red).length);
  ok("after the hold: Past TAT list drops it and the Held list has it", tl2.late.filter((x) => x.part === "flagged").length === lateExp - 1 && tl2.held.some((x) => x.claim_id === ids[0]), [tl2.late.length, tl2.held.length]);
  // answered claims leave every count
  const a = await T(() => call(TI, "attention.answer", { id: ids[1], comment: "Go ahead and call the payer again today" }));
  ok("the team lead answers one", a.ok, a);
  const cnt3 = await call(TI, "attention.count", {}), lst3 = await call(TI, "attention.list", {});
  ok("the answered claim leaves the badge and the list", cnt3.escalations === 4 && lst3.rows.length === 4, [cnt3.escalations, lst3.rows.length]);
  const a2 = await T(() => call(TI, "attention.answer", { id: ids[1], comment: "Answering the same one a second time" }));
  ok("answering it twice is refused", !a2.ok && a2.status === 400, a2);
  const a3 = await T(() => call(AR, "attention.answer", { id: ids[2], comment: "A biller answering her own flag" }));
  ok("a biller cannot answer a flag", !a3.ok && a3.status === 403, a3);
  const a4 = await T(() => call(CY, "attention.list", {}));
  ok("a biller cannot open the Needs attention list at all", !a4.ok && a4.status === 403, a4);
  const a6 = await T(() => call(LA, "attention.list", {}));
  ok("the Lakeview lead's Needs attention list holds no Sunrise claim", a6.ok && !a6.r.rows.some((x) => x.client_id === sun.id), a6.ok && a6.r.rows.length);
  const a5 = await T(() => call(LA, "attention.answer", { id: ids[2], comment: "Lakeview lead answering a Sunrise claim" }));
  ok("the Lakeview team lead cannot answer a Sunrise flag", !a5.ok && a5.status === 403, a5);
});
await part("F2: a flagged claim reaches a desk and comes back", async () => {
  setNow(IST(2026, 11, 9, 9, 0));
  const [id] = await give("Bela Agent", 1);
  await call(BE, "queue.open", { id });
  await call(BE, "queue.complete", { id, saag: SAAG.resub, note: NOTE("Flag it and send it to Submission"), escalate: true, desk: true });
  const c = await claim(id);
  ok("a flagged claim sent to Submission is both flagged and In process", c.escalated === 1 && c.state === "in_process", await brief(id));
  const cnt = await call(TI, "attention.count", {});
  const hud = await call(TI, "team.huddle", { today: nowIso() });
  ok("the flagged claim counts on the badge and in Live status alike", hud.flagged.some((f) => f.id === id) && cnt.escalations === hud.flagged.length, [cnt.escalations, hud.flagged.length]);
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
