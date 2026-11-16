/* Suite 53: people, time, Team status and Live status (round 3 findings V-01 to V-11, without V-04). A made-up floor through
   stand-ins for Purview Shastra's roster, live attendance and floor-time feeds, with the clock moved for the server and the page
   code. Checks named "V-NN: ...". Made-up people only: Vera Vice (VP) over Mona Manager, over Tina Lead (Sunrise Eye Care)
   and Leo Lead (Lakeview Dental Group); Sima Expert is Tina's SME; Tina's billers Arun, Bela, Cara and Dev, Leo's Kim and Lara. */
import vm from "vm";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 700))); };

const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const istDay = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const bizDay = (ms) => new Date(ms + 330 * 60000 - 5 * 3600000).toISOString().slice(0, 10);
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".") + "@purview-healthcare.com";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const AG = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
// a live-feed row (brahmastra_live) and a floor-feed row (brahmastra_floor)
const LV = (emp, o = {}) => ({ emp_id: emp, email: "", shift: "09:00-18:00", no_punch: false, auto_present: false, week_off: false, holiday: false, leave: null, status: "", in_at: null, out_at: null, late_ok: false, break_since: null, ...o });
const FL = (emp, date, status, tof = 480, brk = 45, o = {}) => ({ emp_id: emp, email: "", date, status, open: false, tof_min: tof, logged_min: tof + brk, break_min: brk, guard: false, idle_min: 0, locked_min: 0, ...o });
const stdFeed = () => [
  P({ emp_id: "V1", name: "Vera Vice", position: "Vice President", email: mail("Vera Vice"), shift: "" }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vera Vice", project: SUN, also_on_projects: LAKE, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: SUN, reports_to: "Tina Lead", email: mail("Sima Expert") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Cara Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Tina Lead", SUN),
  AG("B1", "Kim Agent", "Leo Lead", LAKE), AG("B2", "Lara Agent", "Leo Lead", LAKE),
];

/* One floor: a fresh rig whose Shastra stand-in answers from F.S (feed, live rows, floor rows, holidays), the clock at now. */
async function floor({ now, feed = stdFeed(), live = [], floorRows = [], capacity = 10 } = {}) {
  const st = { feed, live, floorRows, floorFail: null, liveDay: null, now, holidays: [{ date: "2026-10-02", name: "Gandhi Jayanti" }, { date: "2026-11-09", name: "Diwali" }] };
  const fetchMock = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: st.feed });
    if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: st.holidays });
    if (url.includes("brahmastra_floor")) return st.floorFail ? J({ ok: false, error: st.floorFail }, 500) : J({ ok: true, rows: st.floorRows.filter((x) => x.date >= body.p_from && x.date <= body.p_to) });
    if (url.includes("brahmastra_live")) return J({ ok: true, at: new Date(st.now).toISOString(), day: st.liveDay || bizDay(st.now), rows: st.live });
    if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "no such function" }, 404);
    return J({ error: "no outside calls in tests" }, 500);
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
  const VDate = vm.runInContext("Date", rig.app);
  const F = { rig, S: st, as: rig.as, T: rig.tryOp };
  F.clock = (ms) => { st.now = ms; Date.now = () => ms; VDate.now = () => ms; };
  F.clock(now);
  const DB = rig.backend.env.DB;
  F.sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  F.rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
  await rig.app.seedDemo(() => {});
  const login = async (email, pw) => rig.as(null)("auth.login", { email, passHash: await rig.sha(pw) });
  F.AD = rig.as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  await F.sql("UPDATE sessions SET expires_at = ?", IST(2030, 1, 1));
  F.users = [];
  F.refresh = async () => { F.users = (await F.AD("users.list")).users; };
  F.sync = async () => { const r = await F.AD("roster.syncShastra"); await F.refresh(); return r; };
  await F.sync();
  if (capacity) await F.sql("UPDATE users SET capacity = ? WHERE source = 'roster'", capacity);
  F.U = (n, email) => F.users.find((u) => u.name === n && (!email || u.email === email));
  F.id = (n, email) => { const u = F.U(n, email); if (!u) throw new Error("no user " + n); return u.id; };
  const sessions = new Map();
  F.who = async (name, email) => {
    email = email || mail(name); if (sessions.has(email)) return sessions.get(email);
    const u = F.users.find((x) => x.name === name && x.email === email); if (!u) throw new Error("no user " + name + " " + email);
    await rig.as(null)("auth.firstPassword", { user_id: u.id, passHash: await rig.sha("pw-" + email) }).catch(() => {});
    const X = rig.as((await login(email, "pw-" + email)).token); sessions.set(email, X);
    await F.sql("UPDATE sessions SET expires_at = ?", IST(2030, 1, 1)); return X;
  };
  F.clients = (await F.AD("clients.list")).clients;
  F.client = (re) => F.clients.find((c) => re.test(c.name));
  let nn = 0;
  // n work entries by a person from a time on, a second apart, each on a claim of the client
  F.workAt = async (name, atMs, n = 1, clientRe = /Sunrise/) => {
    const u = F.U(name), pool = (await F.rows("SELECT id FROM claims WHERE client_id = ? ORDER BY id LIMIT 200", F.client(clientRe).id)).map((r) => r.id);
    for (let i = 0; i < n; i++) await F.sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) VALUES (?,?,?,?, 'work', ?)", "s53n" + (++nn), pool[nn % pool.length], u.id, u.name, atMs + i * 1000);
  };
  // claims of a client allocated to someone (n, not started), allocated at a time
  F.give = async (name, n, clientRe = /Sunrise/, at = null, tier = null) => {
    const ids = (await F.rows("SELECT id FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT ?", F.client(clientRe).id, n)).map((x) => x.id);
    for (const id of ids) await F.sql(`UPDATE claims SET assigned_to = ?, assigned_at = ?, state = 'assigned'${tier ? ", tier = ?" : ""} WHERE id = ?`, F.id(name), at || st.now, ...(tier ? [tier] : []), id);
    return ids;
  };
  F.hud = (X, o = {}) => X("team.huddle", { today: istDay(st.now), tz_offset_min: 330, ...o });
  F.ts = (X, from, to, o = {}) => X("team.status", { from, to, today: istDay(st.now), tz_offset_min: 330, ...o });
  F.bell = (X) => X("notify.list", { today: istDay(st.now) });
  F.row = (d, n) => (d.rows || []).find((r) => r.name === n);
  F.freshLive = () => F.sql("DELETE FROM settings WHERE key = 'live_sync'");
  return F;
}

S("V-07: a Payment posting or Submission team lead has only their desk, never the AR floor");
{
  const feed = stdFeed();
  feed.push(P({ emp_id: "D1", name: "Pia Poster", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Pia Poster") }),
    P({ emp_id: "D2", name: "Sam Submitter", position: "Team Lead", department: "Submission", project: SUN, reports_to: "Mona Manager", email: mail("Sam Submitter") }),
    AG("D3", "Paula Post", "Pia Poster", SUN, { department: "Posting" }),
    // an AR team lead who is also in Posting keeps the AR floor
    P({ emp_id: "T5", name: "Tara Lead", position: "Team Lead", project: SUN, also_in_departments: "Posting", reports_to: "Mona Manager", email: mail("Tara Lead") }));
  const F = await floor({ now: IST(2026, 11, 16, 11), feed });
  const TI = await F.who("Tina Lead"), PIA = await F.who("Pia Poster"), SAM = await F.who("Sam Submitter"), PAULA = await F.who("Paula Post"), TARA = await F.who("Tara Lead");
  const bela = F.id("Bela Agent");
  const pool = await F.give("Bela Agent", 6);
  await TI("coach.noteAdd", { user_id: bela, kind: "concern", text: "Made-up 1:1 note: we talked about the pace this week." });
  const at = (h) => new Date(IST(2026, 11, 16, h)).toISOString();
  // 11:00, shifts 09:00: Bela has no punch in; Arun and Cara are in
  F.S.live = [LV("A1", { status: "present", in_at: at(9) }), LV("A2", {}), LV("A3", { status: "present", in_at: at(9) })];
  const belaClaims = async () => (await F.rows(`SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'assigned'`, bela))[0].n;
  for (const [who, X] of [["the Payment posting team lead", PIA], ["the Submission team lead", SAM]]) {
    const nt = await F.bell(X);
    ok(`V-07: ${who} gets no not-logged-in alert or pop-up for an AR biller`, !(nt.alerts || []).length && !(nt.items || []).some((i) => i.key === "shastra_missing"), nt.alerts);
    for (const [op, payload] of [["team.shareOut", { user_id: bela }], ["team.setOut", { user_id: bela, out: true, reason: "Not logged in to Shastra" }], ["team.rebalance", { user_id: bela }],
      ["team.alertSnooze", { user_id: bela, minutes: 30 }], ["team.alertDismiss", { user_id: bela }], ["team.saveNote", { user_id: bela, comment: "made-up note" }],
      ["team.status", { from: "2026-11-01", to: "2026-11-16" }], ["team.range", { from: "2026-11-01", to: "2026-11-16" }], ["team.activity", {}], ["team.huddle", {}],
      ["coach.profile", { user_id: bela }], ["coach.noteAdd", { user_id: bela, kind: "praise", text: "A made-up note from the wrong desk." }]]) {
      const r = await F.T(() => X(op, payload));
      ok(`V-07: ${who} is refused ${op} for the AR floor`, !r.ok && r.status === 403 && /AR's work/.test(r.e), r.ok ? r.r : r);
    }
  }
  const note = (await F.rows("SELECT id FROM coach_notes WHERE user_id = ?", bela))[0];
  const del = await F.T(() => PIA("coach.noteDelete", { id: note.id }));
  ok("V-07: a desk lead cannot remove a coaching note either", !del.ok && del.status === 403, del);
  ok("V-07: nothing moved: Bela keeps her 6 claims, is not marked out, and her 1:1 note is the only one", (await belaClaims()) === 6 && !(await F.rows("SELECT 1 FROM attendance WHERE user_id = ?", bela)).length
    && (await F.rows("SELECT COUNT(*) AS n FROM coach_notes WHERE user_id = ?", bela))[0].n === 1 && !(await F.rows("SELECT 1 FROM shastra_alerts WHERE user_id = ?", bela)).length);
  // a desk agent (not a lead) is refused too
  const pa = await F.T(() => PAULA("team.setOut", { user_id: bela, out: true, reason: "x" }));
  ok("V-07: a Payment posting agent is refused Out today for an AR biller", !pa.ok && pa.status === 403, pa);
  // the bell line about claims on the desks of people out today is AR's too
  await TI("team.setOut", { user_id: F.id("Dev Agent"), out: true, reason: "Sick" });
  await F.give("Dev Agent", 2);
  ok("V-07: a desk lead's bell has no line about claims on the desks of AR billers out today", !(await F.bell(PIA)).items.some((i) => i.key === "absent"));
  // the AR team lead keeps all of it
  const tn = await F.bell(TI), ta = (tn.alerts || []).find((a) => a.name === "Bela Agent");
  ok("V-07: Tina (AR team lead) still gets the pop-up for Bela with the plan, and the line about Dev's claims", ta && ta.popup && ta.n === 6 && tn.items.some((i) => i.key === "absent"), tn.alerts);
  ok("V-07: Tina still opens Team status and Bela's coaching card", (await F.T(() => F.ts(TI, "2026-11-01", "2026-11-16"))).ok && (await F.T(() => TI("coach.profile", { user_id: bela }))).r.notes.length === 1);
  const tara = await F.bell(TARA), tr = (tara.alerts || []).find((a) => a.name === "Bela Agent");
  ok("V-07: an AR team lead also in Posting keeps the AR floor (the alert, Team status)", !!tr && (await F.T(() => F.ts(TARA, "2026-11-01", "2026-11-16"))).ok, tara.alerts);
  const sh = await F.T(() => TI("team.shareOut", { user_id: bela, today: "2026-11-16" }));
  ok("V-07: Tina's Reallocate equally still shares Bela's 6 claims", sh.ok && sh.r.moved === 6, sh);
}

S("V-03: a name two people in Shastra have is never guessed for who reports to whom");
{
  const feed = stdFeed();
  const F = await floor({ now: IST(2026, 11, 16, 11), feed });
  const tina1 = F.id("Tina Lead"), mona1 = F.id("Mona Manager"), team = ["Arun Agent", "Bela Agent", "Cara Agent", "Dev Agent", "Sima Expert"];
  ok("V-03: before, Tina's four billers and her SME report to her", team.every((n) => F.U(n).reports_to === tina1));
  // a second Tina Lead joins (another Emp ID, email and client) with her own agent who reports to "Tina Lead"
  const T2MAIL = "tina.lead.two@purview-healthcare.com";
  feed.push(P({ emp_id: "T3", name: "Tina Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: T2MAIL, doj: "2026-11-16" }), AG("B7", "Zara Agent", "Tina Lead", LAKE));
  F.clock(IST(2026, 11, 16, 11, 5));
  const r = await F.sync();
  const tina2 = F.id("Tina Lead", T2MAIL);
  ok("V-03: after the namesake joins, every one of the first Tina's people still reports to her", team.every((n) => F.U(n).reports_to === tina1), team.map((n) => [n, F.U(n).reports_to === tina2 ? "tina2" : F.U(n).reports_to === tina1 ? "tina1" : F.U(n).reports_to]));
  ok("V-03: the newcomer's own agent is not guessed either: no team lead until Shastra is fixed", F.U("Zara Agent").reports_to == null, F.U("Zara Agent").reports_to);
  const w = (r.warnings || []).filter((x) => x.clash);
  ok("V-03: the sync's warnings name each of the six people, the shared name and both Emp IDs", w.length === 6 && w.every((x) => x.issues.some((i) => /Tina Lead, a name 2 people have in Shastra \(Emp ID T1, T3\)/.test(i) && /fixed in Shastra/.test(i))), w);
  const arunW = w.find((x) => x.name === "Arun Agent"), zaraW = w.find((x) => x.name === "Zara Agent");
  ok("V-03: a warning says who the person still reports to (by Emp ID), or that nobody is set", arunW && arunW.issues.some((i) => /still reports to Tina Lead \(Emp ID T1\) here/.test(i)) && zaraW && zaraW.issues.some((i) => /no team lead set here/.test(i)), [arunW, zaraW]);
  ok("V-03: the sync counts them as warnings and lists the clash once", r.summary.warnings >= 6 && r.clashes.length === 1 && r.clashes[0].name === "Tina Lead" && r.clashes[0].emp_ids.join() === "T1,T3" && r.clashes[0].people.length === 6, r.clashes);
  const meta = await F.AD("roster.meta");
  ok("V-03: the Roster page has the clash and the warnings from the last sync", meta.shastra.last.clashes.length === 1 && meta.shastra.last.emails.filter((x) => x.clash).length === 6, meta.shastra.last.clashes);
  const aud = await F.rows("SELECT detail FROM audit_log WHERE action = 'roster.nameClash'");
  ok("V-03: the audit trail says so once", aud.length === 1 && /Tina Lead \(Emp ID T1, T3\)/.test(aud[0].detail), aud);
  // what the newcomer can do with the first Tina's people: nothing
  const T2 = await F.who("Tina Lead", T2MAIL);
  const code = await F.T(() => T2("users.loginCode", { id: F.id("Arun Agent") }));
  const hud = await F.hud(T2), ts = await F.ts(T2, "2026-11-02", "2026-11-13");
  ok("V-03: the newcomer gets no sign-in code for the first Tina's biller", !code.ok && code.status === 403, code);
  ok("V-03: the newcomer's Live status and Team status have none of the first Tina's billers", !hud.rows.some((x) => /^(Arun|Bela|Cara|Dev) Agent$/.test(x.name)) && !ts.rows.some((x) => /^(Arun|Bela|Cara|Dev) Agent$/.test(x.name)), hud.rows.map((x) => x.name));
  const TI = await F.who("Tina Lead");
  const tts = await F.ts(TI, "2026-11-02", "2026-11-13");
  ok("V-03: the first Tina still sees her four billers grouped under her", ["Arun Agent", "Bela Agent", "Cara Agent", "Dev Agent"].every((n) => { const x = F.row(tts, n); return x && x.lead_id === tina1; }), tts.rows.map((x) => [x.name, x.lead_name]));
  // the next hourly sync: nothing written again, no second audit line
  F.clock(IST(2026, 11, 16, 12, 5));
  const r2 = await F.sync();
  ok("V-03: the next sync keeps it all as it is, and does not repeat the audit line", team.every((n) => F.U(n).reports_to === tina1) && r2.summary.updated === 0 && (await F.rows("SELECT 1 FROM audit_log WHERE action = 'roster.nameClash'")).length === 1, r2.summary);
  // a manager's name twice: the team leads keep their manager, so the manager's span does not move
  feed.push(P({ emp_id: "M2", name: "Mona Manager", position: "Manager", reports_to: "Vera Vice", project: LAKE, email: "mona.manager.two@purview-healthcare.com" }));
  F.clock(IST(2026, 11, 16, 13, 5));
  await F.sync();
  ok("V-03: two managers with one name: Tina and Leo keep reporting to the first Mona", F.U("Tina Lead", mail("Tina Lead")).reports_to === mona1 && F.U("Leo Lead").reports_to === mona1);
  const MO1 = await F.who("Mona Manager"), mts = await F.ts(MO1, "2026-11-02", "2026-11-13");
  ok("V-03: the first Mona's Team status still has both teams", ["Arun Agent", "Kim Agent"].every((n) => F.row(mts, n)), mts.rows.map((x) => x.name));
  // once the names differ in Shastra, Shastra decides again: the second Tina is "Tina Lead Two" and Zara reports to her
  const t3 = feed.find((x) => x.emp_id === "T3"); t3.name = "Tina Lead Two"; feed.find((x) => x.emp_id === "B7").reports_to = "Tina Lead Two";
  feed.find((x) => x.emp_id === "M2").name = "Mona Manager Two";
  F.clock(IST(2026, 11, 16, 14, 5));
  const r3 = await F.sync();
  ok("V-03: fixed in Shastra: Zara reports to the second Tina, the first Tina's team stays hers, no clash left", F.U("Zara Agent").reports_to === tina2 && team.every((n) => F.U(n).reports_to === tina1) && !r3.clashes.length && !(r3.warnings || []).some((x) => x.clash), r3.clashes);
  // an Emp ID or an email in "reports to" decides by itself, whatever the names
  feed.find((x) => x.emp_id === "B1").reports_to = "T1";
  feed.find((x) => x.emp_id === "B2").reports_to = mail("Tina Lead");
  F.clock(IST(2026, 11, 16, 15, 5));
  await F.sync();
  ok("V-03: \"reports to\" given as an Emp ID or an email is used as it is", F.U("Kim Agent").reports_to === tina1 && F.U("Lara Agent").reports_to === tina1, [F.U("Kim Agent").reports_to, F.U("Lara Agent").reports_to]);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
