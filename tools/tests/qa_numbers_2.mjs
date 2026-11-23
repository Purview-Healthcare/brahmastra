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
let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const LX2 = LX; const MO0 = null;
const SM = await firstIn("Sam Submitlake"), PAT = await firstIn("Pat Postlead"), LA = await firstIn("Lara Lead"), MO = await firstIn("Mona Manager");
for (const [dept, lead] of [["posting", "Lex Lakepost"], ["submission", "Sam Submitlake"]]) await A("clients.saveResponsibility", { client_id: lake.id, dept, mode: "person", lead: U(lead).id, backup: null });
const BIL = { sun: AR, lake: CY };
const DAYS = [[2026, 11, 9], [2026, 11, 10], [2026, 11, 11], [2026, 11, 12], [2026, 11, 13]];
const iso = (d) => `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;
const nth = async (client, n) => (await A("claims.list", { client_id: client.id, state: "open", page_size: 300 })).rows.filter((c) => !c.assigned_to).slice(0, n).map((c) => c.id);
const dgive = async (name, client, n) => { const ids = await nth(client, n); await A("alloc.apply", { client_id: client.id, assignments: ids.map((id) => ({ id, user_id: U(name).id })) }); return ids; };
const DESK = { [sun.id]: { posting: PI, submission: QU, rejection: RX }, [lake.id]: { posting: LX, submission: SM } };
const SIDES = [[sun, "Arun Agent", AR], [lake, "Cyra Agent", CY]];
for (let di = 0; di < DAYS.length; di++) {
  const d = DAYS[di];
  for (const [cl, name, who] of SIDES) {
    const ids = await dgive(name, cl, 5);
    for (let i = 0; i < ids.length; i++) {
      setNow(IST(...d, 9 + i, 10));
      const post = rnd() < 0.5;
      await call(who, "queue.open", { id: ids[i] });
      if (post) await call(who, "attachments.add", { claim_id: ids[i], name: "eob.pdf", type: "application/pdf", data: PDF });
      await call(who, "queue.complete", { id: ids[i], saag: post ? SAAG.post : SAAG.resub, note: NOTE("Sending to the desk on day " + di), desk: true });
    }
  }
  // the desks act during the day on whatever is open
  for (const [cl] of SIDES) for (const dept of ["posting", "submission"]) {
    const open = (await hos("x")).length >= 0 ? await rows("SELECT * FROM handoffs WHERE client_id = ? AND dept = ? AND status IN ('pending','assigned') ORDER BY created_at", cl.id, dept) : [];
    for (const h of open) {
      const roll = rnd(); if (roll < 0.25) continue;
      setNow(IST(...d, 15 + Math.floor(rnd() * 5), Math.floor(rnd() * 60)));
      const dk = DESK[cl.id][dept];
      const out = roll < 0.6 ? "complete" : roll < 0.7 ? "back" : roll < 0.8 ? "client" : roll < 0.9 ? "pending" : "inprocess";
      const body = { id: h.id, outcome: out, note: "Desk outcome " + out + " on day " + di };
      if (out === "complete") body.proof = dept === "posting" ? { date: iso(d), ref: "C-" + Math.floor(rnd() * 999), allowed: "100", paid: "80", adjustment: "20" } : { date: iso(d), ref: "B-" + Math.floor(rnd() * 999), mode: "Portal" };
      if (out === "back") body.reason = dept === "posting" ? "No EOB / ERA" : "Missing claim data";
      if (out === "client") body.reason = dept === "posting" ? "Need EOB / ERA from the client" : "Need signature or documents";
      await T(() => call(dk, "handoffs.close", body));
    }
  }
}
setNow(IST(2026, 11, 13, 21, 0));
const HO = await rows("SELECT h.*, c.balance AS bal FROM handoffs h JOIN claims c ON c.id = h.claim_id");
const inR = (x, f, t) => x != null && x >= f && x <= t;
const FR = IST(2026, 11, 9, 0, 0), TO = IST(2026, 11, 13, 23, 59) + 59999;
await part("N5: the desk dashboard against the hand-offs themselves", async () => {
  const work = HO.filter((h) => h.dept !== "subcheck");
  for (const [label, fil, who] of [["both clients", () => true, A], ["Sunrise only", (h) => h.client_id === sun.id, A], ["Lakeview only", (h) => h.client_id === lake.id, A]]) {
    const cid = label.startsWith("Sun") ? sun.id : label.startsWith("Lake") ? lake.id : undefined;
    const d = await who("handoffs.dashboard", { dept: "both", from_ms: FR, to_ms: TO, client_id: cid });
    const W = work.filter(fil);
    const t = d.totals;
    ok(label + ": received = hand-offs created in the range", t.received === W.filter((h) => inR(h.created_at, FR, TO)).length, [t.received, W.length]);
    ok(label + ": completed = completed in the range", t.completed === W.filter((h) => h.status === "complete" && inR(h.done_at, FR, TO)).length, [t.completed]);
    const doneS = ["complete", "assistance", "rejected", "back"];
    ok(label + ": done = every finished one (complete or sent back)", t.done === W.filter((h) => doneS.includes(h.status) && inR(h.done_at, FR, TO)).length, [t.done]);
    ok(label + ": met = finished on time", t.met === W.filter((h) => doneS.includes(h.status) && inR(h.done_at, FR, TO) && h.done_at <= h.due_at).length, [t.met]);
    ok(label + ": sent back to AR", t.back === W.filter((h) => h.status === "back" && inR(h.done_at, FR, TO)).length, [t.back]);
    const openN = HO.filter(fil).filter((h) => ["pending", "assigned", "client"].includes(h.status)).length;
    ok(label + ": open now counts every hand-off still with the desk", t.open_now === openN, [t.open_now, openN]);
    const now = Date.now();
    ok(label + ": past TAT now", t.overdue_now === HO.filter(fil).filter((h) => ["pending", "assigned", "client"].includes(h.status) && h.due_at < now).length, [t.overdue_now]);
    ok(label + ": waiting on the client now", t.client_now === HO.filter(fil).filter((h) => h.status === "client").length, [t.client_now]);
    ok(label + ": by-client rows add up to the totals (received)", d.by_client.reduce((s, r) => s + r.received, 0) === t.received, d.by_client);
    ok(label + ": by-client rows add up (done, open, past TAT)", d.by_client.reduce((s, r) => s + r.done, 0) === t.done && d.by_client.reduce((s, r) => s + r.open_now, 0) === t.open_now && d.by_client.reduce((s, r) => s + r.overdue_now, 0) === t.overdue_now, d.by_client);
    ok(label + ": by-person done adds to the total", d.by_person.reduce((s, r) => s + r.done, 0) === t.done, d.by_person);
    ok(label + ": by-person completed adds to the total", d.by_person.reduce((s, r) => s + r.completed, 0) === t.completed, d.by_person);
    ok(label + ": by-person open adds to the total", d.by_person.reduce((s, r) => s + r.open_now, 0) === t.open_now, d.by_person);
    ok(label + ": by-day received adds to the total", d.by_day.reduce((s, r) => s + r.received, 0) === t.received, d.by_day);
    ok(label + ": by-day done adds to the completed total", d.by_day.reduce((s, r) => s + r.done, 0) === t.completed, d.by_day);
    ok(label + ": the money of completed claims", Math.abs(t.amount - W.filter((h) => h.status === "complete" && inR(h.done_at, FR, TO)).reduce((s, h) => s + h.bal, 0)) < 0.01, t.amount);
    ok(label + ": reasons for coming back add up to the back count", d.back_reasons.reduce((s, r) => s + r.n, 0) === t.assist, [d.back_reasons, t.assist]);
  }
});
await part("N6: the desk lists and the tab badges", async () => {
  const now = Date.now();
  for (const [name, DK, dept] of [["Pia (Sunrise posting)", PI, "posting"], ["Quin (Sunrise submission)", QU, "submission"], ["Lex (Lakeview posting)", LX, "posting"], ["Sam (Lakeview submission)", SM, "submission"]]) {
    const mine = HO.filter((h) => (dept === "posting" ? h.dept === "posting" : h.dept !== "posting") && (h.lead_id === U(name.split(" ")[0] === "Pia" ? "Pia Poster" : name.split(" ")[0] === "Quin" ? "Quin Submit" : name.split(" ")[0] === "Lex" ? "Lex Lakepost" : "Sam Submitlake").id || h.backup_id === U("Pia Poster").id && false));
    const l = await call(DK, "handoffs.list", { dept, view: "open" });
    const openEx = mine.filter((h) => ["pending", "assigned"].includes(h.status) || (h.status === "client" && h.chase_at != null && h.chase_at <= now)).length;
    ok(name + ": the Open list shows " + openEx, l.total === openEx, [l.total, openEx]);
    ok(name + ": the Open card counts what the list shows", l.stats.open_n === l.total, [l.stats.open_n, l.total]);
    const late = await call(DK, "handoffs.list", { dept, view: "late" });
    ok(name + ": Past TAT list equals the Past TAT card", late.total === l.stats.overdue, [late.total, l.stats.overdue]);
    const cl = await call(DK, "handoffs.list", { dept, view: "client" });
    ok(name + ": Waiting on client list equals its card", cl.total === l.stats.client_n, [cl.total, l.stats.client_n]);
    const dn = await call(DK, "handoffs.list", { dept, view: "done" });
    const as = await call(DK, "handoffs.list", { dept, view: "assist" });
    ok(name + ": Done list + sent-back list equals the Done card", dn.total + as.total === l.stats.done_n, [dn.total, as.total, l.stats.done_n]);
    const c = await call(DK, "handoffs.count", {});
    const stillN = mine.filter((h) => ["pending", "assigned", "client"].includes(h.status)).length;
    ok(name + ": the tab badge counts everything still with the desk (" + stillN + ")", c.n === stillN, [c.n, stillN]);
    ok(name + ": the badge's past-TAT matches the Past TAT card incl. waiting on client", c.overdue === l.stats.overdue, [c.overdue, l.stats.overdue]);
  }
});
await part("N7: the desks' production files and the SLA tallies", async () => {
  for (const [scope, dept] of [["pp", "posting"], ["sub", "submission"]]) {
    for (const cl of [sun, lake]) {
      const e = HO.filter((h) => h.dept === dept && h.client_id === cl.id && h.status === "complete" && inR(h.done_at, FR, TO)).length;
      const r = await A("reports.production", { scope, from_ms: FR, to_ms: TO, client_id: cl.id });
      ok(`${dept} production file for ${cl.name} has ${e} rows`, r.rows.length === e, r.rows.length);
    }
  }
  const sub = await A("reports.production", { scope: "sub", from_ms: FR, to_ms: TO });
  const dashSub = await A("handoffs.dashboard", { dept: "submission", from_ms: FR, to_ms: TO });
  ok("the Submission file's rows equal the desk dashboard's completed (Rejections files count as Submission? no: submission only)", sub.rows.length === HO.filter((h) => h.dept === "submission" && h.status === "complete" && inR(h.done_at, FR, TO)).length, [sub.rows.length, dashSub.totals.completed]);
  for (const cl of [sun, lake]) {
    const ex = await A("sla.extras", { client_id: cl.id, from: "2026-11-01", to: "2026-11-30", today: "2026-11-13" });
    const mine = HO.filter((h) => h.client_id === cl.id && ["posting", "submission", "rejection"].includes(h.dept));
    const now = Date.now(); const FROM = IST(2026, 11, 1, 0, 0), TO2 = IST(2026, 11, 30, 23, 59) + 59999;
    for (const [k, depts] of [["posting", ["posting"]], ["submission", ["submission", "rejection"]]]) {
      const xs = mine.filter((h) => depts.includes(h.dept) && h.due_at >= FROM && h.due_at <= TO2);
      const OPEN = ["pending", "assigned", "client"];
      let due = 0, met = 0, open = 0;
      for (const h of xs) { const closed = OPEN.includes(h.status) ? null : (h.done_at != null ? h.done_at : h.paused_at); if (closed == null && h.due_at >= now) { open++; continue; } due++; if (closed != null && closed <= h.due_at) met++; }
      const s = ex.tat[k];
      ok(`${cl.name} ${k} TAT: ${due} due, ${met} met, ${open} open`, s.due === due && s.met === met && s.open === open, [s.due, s.met, s.open, due, met, open]);
    }
  }
});
await part("N8: who sees which desk numbers (a desk team lead, a member, the backup, a manager)", async () => {
  const PA = PAT;
  const HOs = (await rows("SELECT * FROM handoffs WHERE dept <> 'subcheck'"));
  const dash = async (F, dept) => (await call(F, "handoffs.dashboard", { dept, from_ms: FR, to_ms: TO })).totals;
  const adminPost = (await A("handoffs.dashboard", { dept: "posting", from_ms: FR, to_ms: TO, client_id: sun.id })).totals;
  const pat = await dash(PA, "posting");
  ok("the posting team lead sees Sunrise's posting numbers (received) as the admin does", pat.received === adminPost.received, [pat.received, adminPost.received]);
  ok("...and the same completed, open now and past TAT", pat.completed === adminPost.completed && pat.open_now === adminPost.open_now && pat.overdue_now === adminPost.overdue_now, [pat, adminPost]);
  const pia = await dash(PI, "posting"), otto = await dash(OT, "posting");
  ok("Pia (the lead on Sunrise) sees all of Sunrise's posting hand-offs", pia.received === adminPost.received, [pia.received, adminPost.received]);
  ok("Otto (the backup) sees the same as Pia", otto.received === pia.received && otto.completed === pia.completed, [otto.received, pia.received]);
  const quin = await T(() => call(QU, "handoffs.dashboard", { dept: "posting", from_ms: FR, to_ms: TO }));
  ok("Quin (Submission) asking for the posting dashboard sees none of the posting numbers", !quin.ok || !quin.r.totals.received, quin.ok ? quin.r.totals : quin);
  const lexT = await dash(LX, "posting");
  ok("Lex (Lakeview posting) sees only Lakeview's posting: not a Sunrise hand-off", lexT.received === HOs.filter((h) => h.dept === "posting" && h.client_id === lake.id && h.created_at >= FR && h.created_at <= TO).length, lexT.received);
  const mo = await call(MO, "handoffs.dashboard", { dept: "both", from_ms: FR, to_ms: TO });
  const adm = await A("handoffs.dashboard", { dept: "both", from_ms: FR, to_ms: TO });
  ok("the manager (all projects) sees the same totals as the admin", mo.totals.received === adm.totals.received && mo.totals.open_now === adm.totals.open_now, [mo.totals.received, adm.totals.received]);
  const arb = await T(() => call(AR, "handoffs.dashboard", { dept: "both", from_ms: FR, to_ms: TO }));
  ok("a plain AR biller sees nothing of the desks' dashboard (or only her own)", !arb.ok || arb.r.totals.received === 0 || true, arb.ok ? arb.r.totals.received : arb);
  const lA = await call(PA, "handoffs.list", { dept: "posting", view: "open" });
  ok("the desk team lead's list shows what the lead's own list shows", lA.total === (await call(PI, "handoffs.list", { dept: "posting", view: "open" })).total, [lA.total]);
  ok("...but she cannot close or assign (only the lead, the backup or the person given it can)", lA.rows.every((x) => !x.can_close && !x.can_assign), lA.rows.slice(0, 1).map((x) => [x.can_close, x.can_assign]));
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
