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
// ---- a seeded random week ----
let seed = 20261109; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const EL = await firstIn("Eli Agent"), DE = await firstIn("Dev Agent"), LA = await firstIn("Lara Lead"), MO = await firstIn("Mona Manager"), LA2 = LA;
const BILL = { "Arun Agent": AR, "Bela Agent": BE, "Dev Agent": DE, "Cyra Agent": CY, "Eli Agent": EL };
const CLIENT_OF = { "Arun Agent": sun, "Bela Agent": sun, "Dev Agent": sun, "Cyra Agent": lake, "Eli Agent": lake };
for (const [dept, lead] of [["posting", "Lex Lakepost"], ["submission", "Sam Submitlake"]]) await A("clients.saveResponsibility", { client_id: lake.id, dept, mode: "person", lead: U(lead).id, backup: null });
const LEDGER = [];
const DAYS = { mon: [2026, 11, 9], tue: [2026, 11, 10], wed: [2026, 11, 11], thu: [2026, 11, 12], fri: [2026, 11, 13] };
const dayFrom = (k) => IST(...DAYS[k], 0, 0), dayTo = (k) => IST(...DAYS[k], 23, 59) + 59999;
const dIso = (k) => { const [y, m, d] = DAYS[k]; return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
const CLOSE = { status: "Claim Paid", sub_status: "Paid", action: "Close", bucket: "Closed", effective: "Processing-Closed" };
const SAAGS = [SAAG.fu, SAAG.fu, SAAG.fu, CLOSE, SAAG.resub, { status: "Claim Denied", sub_status: "Auth required", action: "Call payer", bucket: "Client", effective: "Pending-Client Assistance" }];
const POOLS = { [sun.id]: [], [lake.id]: [] };
const takeClaims = async (client, n) => { const pool = (await A("claims.list", { client_id: client.id, state: "open", page_size: 300 })).rows.filter((c) => !c.assigned_to).slice(0, n); return pool.map((c) => c.id); };
const allocate = async (name, n) => { const cl = CLIENT_OF[name]; const ids = await takeClaims(cl, n); await A("alloc.apply", { client_id: cl.id, assignments: ids.map((id) => ({ id, user_id: U(name).id })) }); return ids; };
const workDay = async (k) => {
  for (const name of Object.keys(BILL)) {
    const n = 3 + Math.floor(rnd() * 5); const ids = await allocate(name, n);
    let min = 0;
    for (const id of ids) {
      min += 7 + Math.floor(rnd() * 20); const h = 9 + Math.floor(min / 60), mi = min % 60;
      setNow(IST(...DAYS[k], Math.min(h, 23), mi));
      const saag = pick(SAAGS);
      await call(BILL[name], "queue.open", { id });
      const r = await T(() => call(BILL[name], "queue.complete", { id, saag, note: NOTE("Worked by " + name + " round " + k), desk: true }));
      if (r.ok) LEDGER.push({ who: name, day: dIso(k), claim: id, closed: r.r.closed, at: Date.now(), client: CLIENT_OF[name].id, toDesk: !!r.r.handoff && r.r.handoff.mode === "person" });
    }
  }
};
for (const k of ["mon", "tue", "wed", "thu", "fri"]) await workDay(k);
setNow(IST(2026, 11, 13, 20, 0));
const expW = (name, d1, d2) => LEDGER.filter((x) => x.who === name && x.day >= d1 && x.day <= d2).length;
const expC = (name, d1, d2) => LEDGER.filter((x) => x.who === name && x.day >= d1 && x.day <= d2 && x.closed).length;
await part("N1: every screen counts the same entries", async () => {
  ok("the week produced entries for every biller", Object.keys(BILL).every((n) => expW(n, "2026-11-09", "2026-11-13") > 10), Object.keys(BILL).map((n) => [n, expW(n, "2026-11-09", "2026-11-13")]));
  const dbWork = await rows("SELECT user_name, COUNT(*) AS n FROM notes WHERE kind = 'work' GROUP BY user_name");
  ok("the notes table holds the same number of work entries as the ledger", dbWork.reduce((t, r) => t + r.n, 0) === LEDGER.length, [dbWork, LEDGER.length]);
  for (const k of Object.keys(DAYS)) {
    for (const name of Object.keys(BILL)) {
      const e = expW(name, dIso(k), dIso(k));
      const q = await call(BILL[name], "queue.summary", { today: dIso(k), day_from_ms: dayFrom(k), day_to_ms: dayTo(k) });
      ok(`My day: ${name} on ${dIso(k)} worked ${e}`, q.done_today.n === e, q.done_today);
      const hm = await call(BILL[name], "history.mine", { from_ms: dayFrom(k), to_ms: dayTo(k) });
      ok(`History: ${name} on ${dIso(k)} has ${e} entries`, hm.rows.filter((r) => r.kind === "work").length === e, hm.rows.length);
    }
  }
});
await part("N2: Team status and Dashboard ranges agree with the entries, per biller and per lead", async () => {
  const ranges = [["2026-11-09", "2026-11-09"], ["2026-11-10", "2026-11-12"], ["2026-11-09", "2026-11-13"], ["2026-11-13", "2026-11-13"]];
  for (const [f, t] of ranges) {
    for (const [lead, LT, names] of [["Tina", TI, ["Arun Agent", "Bela Agent", "Dev Agent"]], ["Lara", LA, ["Cyra Agent", "Eli Agent"]]]) {
      const st = await call(LT, "team.status", { from: f, to: t, today: "2026-11-13" });
      const rg = await call(LT, "team.range", { from: f, to: t, today: "2026-11-13" });
      for (const name of names) {
        const e = expW(name, f, t), c = expC(name, f, t);
        const row = st.rows.find((r) => r.name === name), row2 = rg.rows.find((r) => r.name === name);
        ok(`Team status ${f}..${t}: ${name} worked ${e}`, row && row.worked === e, row && row.worked);
        ok(`Team status ${f}..${t}: ${name} count ${e}`, row && row.count === e, row && row.count);
        ok(`Team range ${f}..${t}: ${name} worked ${e}`, row2 && row2.worked === e, row2 && row2.worked);
        ok(`Team status ${f}..${t}: ${name} closed ${c}`, row && row.closed === c, row && row.closed);
        ok(`Team range ${f}..${t}: ${name} closed ${c}`, row2 && row2.closed === c, row2 && row2.closed);
      }
      const tot = names.reduce((s, n) => s + expW(n, f, t), 0);
      ok(`${lead}'s Team status ${f}..${t}: the total worked is ${tot}`, st.totals.worked === tot, st.totals.worked);
      ok(`${lead}'s Team range ${f}..${t}: the total worked is ${tot}`, rg.totals.worked === tot, rg.totals.worked);
    }
  }
});
await part("N3: reports, production files and activity add up", async () => {
  const f = dayFrom("mon"), t = dayTo("fri");
  const rw = await A("reports.work", { from_ms: f, to_ms: t, kind: "work" });
  ok("Reports › work total is the ledger's total", rw.total === LEDGER.length, rw.total);
  for (const name of Object.keys(BILL)) {
    const rp = await A("reports.production", { scope: "ar", from_ms: f, to_ms: t, user_id: U(name).id, page: 1 });
    ok(`Production file: ${name} has ${expW(name, "2026-11-09", "2026-11-13")} rows`, rp.total === expW(name, "2026-11-09", "2026-11-13") && rp.rows.length === rp.total, [rp.total, rp.rows.length]);
  }
  for (const cl of [sun, lake]) {
    const e = LEDGER.filter((x) => x.client === cl.id).length;
    const rp = await A("reports.production", { scope: "ar", from_ms: f, to_ms: t, client_id: cl.id, page: 1 });
    ok(`Production file for ${cl.name}: ${e} rows`, rp.total === e, rp.total);
    const ta = await A("team.activity", { from_ms: f, to_ms: t, client_id: cl.id });
    ok(`Team activity for ${cl.name}: ${e} worked`, ta.worked === e, ta);
    const closedE = LEDGER.filter((x) => x.client === cl.id && x.closed).length;
    const dbClosed = (await rows("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'closed' AND completed_at BETWEEN ? AND ?", cl.id, f, t))[0].n;
    ok(`Team activity for ${cl.name}: closed ${closedE} (the entries that closed a claim)`, ta.closed_n === closedE && dbClosed === closedE, [ta.closed_n, dbClosed, closedE]);
    const sp = await A("supervisor.productivity", { from_ms: f, to_ms: t });
    const sum = sp.rows.filter((r) => LEDGER.some((x) => x.who === r.user_name && x.client === cl.id)).reduce((s, r) => s + r.n, 0);
    ok("Productivity by day adds to the ledger for every biller together", sp.rows.reduce((s, r) => s + r.n, 0) === LEDGER.length, sp.rows.reduce((s, r) => s + r.n, 0));
  }
  for (const k of Object.keys(DAYS)) {
    const sp = await A("supervisor.productivity", { from_ms: dayFrom(k), to_ms: dayTo(k) });
    for (const name of Object.keys(BILL)) { const e = expW(name, dIso(k), dIso(k)); const r = sp.rows.find((x) => x.user_name === name && x.day === dIso(k)); ok(`Productivity ${dIso(k)} ${name}: ${e}`, (r ? r.n : 0) === e, r); }
  }
});
await part("N4: the week split across a midnight and the Sunday", async () => {
  // entries at 23:59:30 and 00:00:30 IST land on two different days everywhere
  setNow(IST(2026, 11, 13, 23, 59) + 30000);
  const ids = await allocate("Arun Agent", 2);
  await call(AR, "queue.open", { id: ids[0] }); await call(AR, "queue.complete", { id: ids[0], saag: SAAG.fu, note: NOTE("Just before midnight on Friday"), desk: true });
  setNow(IST(2026, 11, 14, 0, 0) + 1000);
  await call(AR, "queue.open", { id: ids[1] }); await call(AR, "queue.complete", { id: ids[1], saag: SAAG.fu, note: NOTE("Just after midnight, on Saturday"), desk: true });
  const fri = await call(TI, "team.status", { from: "2026-11-13", to: "2026-11-13", today: "2026-11-14" });
  const sat = await call(TI, "team.status", { from: "2026-11-14", to: "2026-11-14", today: "2026-11-14" });
  const a = (r) => r.rows.find((x) => x.name === "Arun Agent");
  ok("Friday 23:59:30 counts on Friday", a(fri).worked === expW("Arun Agent", "2026-11-13", "2026-11-13") + 1, a(fri).worked);
  ok("Saturday 00:00:01 counts on Saturday", a(sat).worked === 1, a(sat).worked);
  const q1 = await call(AR, "queue.summary", { today: "2026-11-13", day_from_ms: dayFrom("fri"), day_to_ms: dayTo("fri") });
  const q2 = await call(AR, "queue.summary", { today: "2026-11-14", day_from_ms: IST(2026, 11, 14, 0, 0), day_to_ms: IST(2026, 11, 14, 23, 59) });
  ok("My day agrees: Friday has the late entry, Saturday the early one", q1.done_today.n === a(fri).worked && q2.done_today.n === 1, [q1.done_today, q2.done_today]);
  const rg = await call(TI, "team.range", { from: "2026-11-13", to: "2026-11-14", today: "2026-11-14" });
  ok("Team range over Friday and Saturday counts both", rg.rows.find((r) => r.name === "Arun Agent").worked === a(fri).worked + 1, rg.rows.find((r) => r.name === "Arun Agent"));
  ok("Saturday is not a working day: 5 workdays Mon-Fri, a Fri-Sat range has 1", rg.workdays === 1, rg.workdays);
});
await part("N9: a manager's view per team lead adds up to the whole", async () => {
  setNow(IST(2026, 11, 13, 23, 59) + 50000);
  const f = "2026-11-09", t = "2026-11-13", base = { from: f, to: t, today: "2026-11-13" };
  const all0 = await call(MO, "team.status", base), tina = await call(MO, "team.status", { ...base, lead_id: U("Tina Lead").id }), lara = await call(MO, "team.status", { ...base, lead_id: U("Lara Lead").id });
  const named = (r) => r.rows.filter((x) => Object.keys(BILL).includes(x.name));
  ok("the manager sees every biller of the week once", Object.keys(BILL).every((n) => all0.rows.filter((r) => r.name === n).length === 1), all0.rows.map((r) => r.name));
  ok("Tina's picked view holds her three billers, Lara's her two", Object.keys(BILL).filter((n) => tina.rows.some((r) => r.name === n)).length === 3 && named(lara).length === 2, [named(tina).map((r) => r.name), named(lara).map((r) => r.name)]);
  const w = (r) => named(r).reduce((s2, x) => s2 + x.worked, 0);
  ok("the worked entries of the two leads' views add up to the manager's whole", w(tina) + w(lara) === w(all0), [w(tina), w(lara), w(all0)]);
  ok("the totals line equals the sum of the lines for each lead", tina.totals.worked === tina.rows.reduce((s2, r) => s2 + r.worked, 0) && lara.totals.worked === lara.rows.reduce((s2, r) => s2 + r.worked, 0), [tina.totals.worked, lara.totals.worked]);
  ok("the target adds up too", tina.totals.target + lara.totals.target === all0.totals.target - all0.rows.filter((r) => !tina.rows.some((x) => x.id === r.id) && !lara.rows.some((x) => x.id === r.id)).reduce((s2, r) => s2 + r.target, 0), [tina.totals.target, lara.totals.target, all0.totals.target]);
  const hudAll = await call(MO, "team.huddle", { today: "2026-11-13" }), hudT = await call(MO, "team.huddle", { today: "2026-11-13", lead_id: U("Tina Lead").id }), hudL = await call(MO, "team.huddle", { today: "2026-11-13", lead_id: U("Lara Lead").id });
  const wd = (r) => r.rows.filter((x) => Object.keys(BILL).includes(x.name)).reduce((s2, x) => s2 + x.worked, 0);
  ok("Live status per lead adds up to the whole, and agrees with Team status for Friday", wd(hudT) + wd(hudL) === wd(hudAll), [wd(hudT), wd(hudL), wd(hudAll)]);
  const fri = await call(MO, "team.status", { from: "2026-11-13", to: "2026-11-13", today: "2026-11-13" });
  ok("Live status worked today equals Team status for today, per biller", Object.keys(BILL).every((n) => (hudAll.rows.find((r) => r.name === n) || {}).worked === (fri.rows.find((r) => r.name === n) || {}).worked), Object.keys(BILL).map((n) => [n, (hudAll.rows.find((r) => r.name === n) || {}).worked, (fri.rows.find((r) => r.name === n) || {}).worked]));
  ok("Live status closed today equals Team status for today, per biller", Object.keys(BILL).every((n) => (hudAll.rows.find((r) => r.name === n) || {}).closed === (fri.rows.find((r) => r.name === n) || {}).closed), Object.keys(BILL).map((n) => [n, (hudAll.rows.find((r) => r.name === n) || {}).closed, (fri.rows.find((r) => r.name === n) || {}).closed]));
  const ci = await call(MO, "team.status", { ...base, client_id: lake.id });
  ok("picking Lakeview shows its two billers", Object.keys(BILL).filter((n) => ci.rows.some((r) => r.name === n)).sort().join() === "Cyra Agent,Eli Agent", ci.rows.map((r) => r.name));
});
const p = results.filter((r) => r.pass).length; console.log("\n==== " + p + " passed, " + (results.length - p) + " failed of " + results.length); process.exit(0);
