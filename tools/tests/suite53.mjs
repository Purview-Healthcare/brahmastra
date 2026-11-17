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

S("V-01: a week off, a holiday or not joined yet in Shastra is a day off on Live status, never 'Not logged in'");
{
  const feed = stdFeed();
  feed.push(AG("E3", "Gita Agent", "Tina Lead", SUN), AG("E4", "Hari Agent", "Tina Lead", SUN), AG("E5", "Jai Agent", "Tina Lead", SUN), AG("E6", "Ola Agent", "Tina Lead", SUN),
    AG("E7", "Nila Agent", "Tina Lead", SUN, { doj: "2026-11-23" }), AG("E8", "Pari Agent", "Tina Lead", SUN));
  // Wednesday 18 Nov 2026, 10:30 IST; shifts 09:00-18:00
  const F = await floor({ now: IST(2026, 11, 18, 10, 30), feed });
  F.S.live = [LV("E3", {}), LV("E4", { status: "week_off" }), LV("E5", { status: "holiday" }), LV("E6", { status: "not_joined" }), LV("E7", {}), LV("E8", { status: "wo" }),
    LV("A1", { status: "present", in_at: new Date(IST(2026, 11, 18, 9)).toISOString() })];
  const TI = await F.who("Tina Lead");
  const h = await F.hud(TI), st = (n) => (F.row(h, n) || {}).shastra || {};
  const nt = await F.bell(TI), pop = (nt.alerts || []).map((a) => a.name);
  ok("V-01: a week off marked on the person's own attendance is 'Week off', not 'Not logged in'", st("Hari Agent").state === "leave" && st("Hari Agent").label === "Week off" && st("Pari Agent").label === "Week off", [st("Hari Agent"), st("Pari Agent")]);
  ok("V-01: a holiday marked on the person's attendance is 'Holiday'", st("Jai Agent").state === "leave" && st("Jai Agent").label === "Holiday", st("Jai Agent"));
  ok("V-01: 'not joined' in Shastra, and a date of joining still ahead, are 'Not joined yet'", st("Ola Agent").label === "Not joined yet" && st("Nila Agent").label === "Not joined yet" && /joins 2026-11-23/.test(st("Nila Agent").sub), [st("Ola Agent"), st("Nila Agent")]);
  ok("V-01: none of them raises the not-logged-in alert or is in the bell", !["Hari Agent", "Jai Agent", "Ola Agent", "Nila Agent", "Pari Agent"].some((n) => pop.includes(n)), pop);
  ok("V-01: someone really not logged in still raises it", st("Gita Agent").state === "missing" && (nt.alerts || []).some((a) => a.name === "Gita Agent" && a.popup), st("Gita Agent"));
  ok("V-01: and Live status counts the days off as out, not in", ["Hari Agent", "Jai Agent", "Ola Agent", "Nila Agent", "Pari Agent"].every((n) => F.row(h, n).status === "out" && F.row(h, n).out.shastra) && F.row(h, "Gita Agent").status !== "out", h.rows.map((r) => [r.name, r.status]));
  // on the day of joining the person is expected in like anyone else
  F.clock(IST(2026, 11, 23, 10, 30)); await F.freshLive(); F.S.live = [LV("E7", {})];
  const h2 = await F.hud(TI);
  ok("V-01: on the date of joining itself, no punch an hour in is 'Not logged in' again", (F.row(h2, "Nila Agent").shastra || {}).state === "missing", F.row(h2, "Nila Agent").shastra);
}

S("V-02: people Shastra has on leave or comp off today count as out on Live status and Team status");
{
  const F = await floor({ now: IST(2026, 11, 16, 15, 0) });   // Monday 16 Nov 2026, 15:00 IST; target 10 a day each
  F.S.live = [LV("A1", { status: "present", in_at: new Date(IST(2026, 11, 16, 8, 58)).toISOString() }), LV("A2", { status: "approved_leave", leave: "Approved Leave" }),
    LV("A3", { status: "sick_leave", leave: "Sick Leave" }), LV("A4", { status: "comp_off" })];
  F.S.floorRows = [FL("A1", "2026-11-16", "present", 360, 0, { open: true }), FL("A2", "2026-11-16", "approved_leave", 0, 0), FL("A3", "2026-11-16", "sick_leave", 0, 0), FL("A4", "2026-11-16", "comp_off", 0, 0)];
  for (let hh = 9; hh < 15; hh++) await F.workAt("Arun Agent", IST(2026, 11, 16, hh, 15));
  // Bela has 4 high priority claims allocated on Friday
  await F.give("Bela Agent", 4, /Sunrise/, IST(2026, 11, 13, 12), "High");
  const TI = await F.who("Tina Lead");
  const h = await F.hud(TI), mine = h.rows.filter((r) => ["Arun Agent", "Bela Agent", "Cara Agent", "Dev Agent"].includes(r.name));
  const tt = { people: mine.length, out: mine.filter((r) => r.status === "out").length };
  ok("V-02: Live status: In today 1 of 4 (Bela, Cara and Dev are out per Shastra)", tt.people === 4 && tt.out === 3 && F.row(h, "Arun Agent").status !== "out", mine.map((r) => [r.name, r.status]));
  ok("V-02: the day's target leaves them out (10 for Arun alone), and the floor's totals agree", h.totals.capacity === 10 && h.totals.out === 3 && h.totals.worked === 6, h.totals);
  ok("V-02: nobody on leave is marked behind", !mine.some((r) => r.status === "out" && r.behind) && h.totals.behind === 0, mine.map((r) => [r.name, r.behind]));
  const b = F.row(h, "Bela Agent"), d = F.row(h, "Dev Agent");
  ok("V-02: their row says why, from Shastra, with no 'In after all' to undo", b.out && b.out.shastra && b.out.reason === "On leave" && b.out.by === "Purview Shastra" && d.out.reason === "Comp off", [b.out, d.out]);
  // Team status, today
  const ts = await F.ts(TI, "2026-11-16", "2026-11-16"), bt = F.row(ts, "Bela Agent");
  ok("V-02: Team status today: Bela, Cara and Dev are out today (from Shastra), Arun is not", bt.out_today === "out" && F.row(ts, "Cara Agent").out_today === "out" && F.row(ts, "Dev Agent").out_today === "out" && F.row(ts, "Arun Agent").out_today === "", ts.rows.map((r) => [r.name, r.out_today]));
  const sg = [...ts.suggestions.today, ...ts.suggestions.week].filter((x) => x.who === "Bela Agent");
  ok("V-02: the suggestion for Bela's 4 high priority claims is to rebalance them, not to have her work them", sg.length && sg.every((x) => !/Have them work/.test(x.do)) && sg.some((x) => /Rebalance the 4 high priority claims/.test(x.do)), sg);
  // Rebalance works for someone out per Shastra, without marking them out by hand
  const rb = await TI("team.rebalance", { user_id: F.id("Bela Agent") });
  ok("V-02: Rebalance shares Bela's 4 claims to the one person in (Arun)", rb.moved === 4 && rb.to.length === 1 && rb.to[0].name === "Arun Agent", rb);
  // someone on leave in Shastra who works here today anyway is counted in
  await F.workAt("Cara Agent", IST(2026, 11, 16, 14, 50), 2);
  const h2 = await F.hud(TI);
  ok("V-02: someone Shastra has on leave who works here today counts in", F.row(h2, "Cara Agent").status !== "out" && h2.totals.capacity === 20, [F.row(h2, "Cara Agent").status, h2.totals.capacity]);
  // a half day in Shastra is half on Team status today
  F.S.floorRows.push(FL("B1", "2026-11-16", "half_day", 240, 0));
  await F.sql("DELETE FROM settings WHERE key = 'floor_sync'");
  const MO = await F.who("Mona Manager"), ts2 = await F.ts(MO, "2026-11-16", "2026-11-16");
  ok("V-02: a half day in Shastra shows as a half day today", F.row(ts2, "Kim Agent").out_today === "half", F.row(ts2, "Kim Agent"));
  // the weekend: a week off for everyone is not 'out today' on Live status (nobody is expected in)
  F.clock(IST(2026, 11, 21, 11)); await F.freshLive();
  F.S.live = [LV("A1", { week_off: true }), LV("A2", { week_off: true })];
  const hw = await F.hud(TI);
  ok("V-02: on a Saturday the week off is not counted as out (the weekend says nobody is expected in)", hw.weekend && !hw.rows.some((r) => r.status === "out"), hw.rows.map((r) => [r.name, r.status]));
}

S("V-05: a night shift's Out today mark and a dismissed alert hold for the shift, past midnight and past 05:00");
{
  const feed = stdFeed();
  feed.push(AG("N1", "Uma Agent", "Tina Lead", SUN, { shift: "21:00-06:00" }), AG("N2", "Vik Agent", "Tina Lead", SUN, { shift: "21:00-06:00" }),
    AG("N3", "Wren Agent", "Tina Lead", SUN, { shift: "22:30-07:30" }), AG("N4", "Yash Agent", "Tina Lead", SUN, { shift: "02:00-11:00" }));
  const F = await floor({ now: IST(2026, 11, 16, 12), feed });
  const TI = await F.who("Tina Lead");
  await F.give("Uma Agent", 4);
  // nobody of them punches in for Monday night's shift (nor Yash for his 02:00 shift on Tuesday)
  F.S.live = [LV("N1", { shift: "21:00-06:00" }), LV("N2", { shift: "21:00-06:00" }), LV("N3", { shift: "22:30-07:30" }), LV("N4", { shift: "02:00-11:00" })];
  const look = async (ms) => { F.clock(ms); await F.freshLive(); const h = await F.hud(TI), nt = await F.bell(TI);
    return { h, al: (n) => (nt.alerts || []).find((a) => a.name === n), st: (n) => F.row(h, n).status }; };
  let L = await look(IST(2026, 11, 16, 23, 45));
  ok("V-05: 23:45 Monday: the pop-up for Uma, Vik and Wren", ["Uma Agent", "Vik Agent", "Wren Agent"].every((n) => L.al(n) && L.al(n).popup && L.al(n).day === "2026-11-16"), ["Uma Agent", "Vik Agent", "Wren Agent"].map((n) => L.al(n)));
  await TI("team.setOut", { user_id: F.id("Uma Agent"), out: true, reason: "Not logged in to Shastra", today: "2026-11-16" });   // the pop-up's Mark out only
  await TI("team.alertDismiss", { user_id: F.id("Vik Agent") });                                                                   // They told me · dismiss
  await TI("team.shareOut", { user_id: F.id("Wren Agent"), today: "2026-11-16" });                                                 // Reallocate (marks her out)
  L = await look(IST(2026, 11, 17, 0, 30));
  ok("V-05: 00:30 Tuesday: Uma is still out on Live status, with no alert", L.st("Uma Agent") === "out" && !L.al("Uma Agent"), [L.st("Uma Agent"), L.al("Uma Agent")]);
  ok("V-05: 00:30 Tuesday: Vik's dismissed alert and Wren (reallocated, out) stay quiet", !L.al("Vik Agent") && !L.al("Wren Agent") && L.st("Wren Agent") === "out", [L.al("Vik Agent"), L.al("Wren Agent")]);
  // marking Uma out again after midnight marks the same shift, never Tuesday
  await TI("team.setOut", { user_id: F.id("Uma Agent"), out: true, reason: "Sick", today: "2026-11-17" });
  ok("V-05: marking her out again at 00:30 marks Monday's shift, not Tuesday", (await F.rows("SELECT day FROM attendance WHERE user_id = ?", F.id("Uma Agent"))).map((x) => x.day).join() === "2026-11-16");
  L = await look(IST(2026, 11, 17, 5, 15));
  ok("V-05: 05:15 Tuesday: no pop-up comes back for Uma, Vik or Wren for the same missed shift", !L.al("Uma Agent") && !L.al("Vik Agent") && !L.al("Wren Agent"), [L.al("Uma Agent"), L.al("Vik Agent"), L.al("Wren Agent")]);
  ok("V-05: 05:15 Tuesday: Uma and Wren are still out on Live status", L.st("Uma Agent") === "out" && L.st("Wren Agent") === "out");
  const ts = await F.ts(TI, "2026-11-16", "2026-11-17");
  ok("V-05: Team status: Uma is out today (her shift's day is Monday until it is over) and Tuesday is not a day out", F.row(ts, "Uma Agent").out_today === "out" && F.row(ts, "Uma Agent").days_out === 1, F.row(ts, "Uma Agent"));
  // an early shift that begins after midnight: a dismissal at 03:30 still holds after Shastra's day rolls at 05:00
  L = await look(IST(2026, 11, 17, 3, 30));
  ok("V-05: 03:30 Tuesday: Yash (02:00 shift) has not logged in", L.al("Yash Agent") && L.al("Yash Agent").day === "2026-11-17", L.al("Yash Agent"));
  await TI("team.alertSnooze", { user_id: F.id("Yash Agent"), minutes: 120 });
  L = await look(IST(2026, 11, 17, 5, 10));
  ok("V-05: a 'remind me later' at 03:30 still holds at 05:10, after Shastra's day rolled", L.al("Yash Agent") && L.al("Yash Agent").snoozed && !L.al("Yash Agent").popup, L.al("Yash Agent"));
  // In after all, at 01:00 for Monday night's shift, gives that shift back
  F.clock(IST(2026, 11, 17, 1)); await TI("team.setOut", { user_id: F.id("Uma Agent"), out: false, today: "2026-11-17" });
  ok("V-05: In after all after midnight takes back Monday's mark", !(await F.rows("SELECT 1 FROM attendance WHERE user_id = ?", F.id("Uma Agent"))).length);
  // the next night is a new shift: the alert comes again
  L = await look(IST(2026, 11, 17, 22, 30));
  ok("V-05: Tuesday night's shift is a new one: Vik's alert comes again at 22:30", L.al("Vik Agent") && L.al("Vik Agent").day === "2026-11-17" && L.al("Vik Agent").popup, L.al("Vik Agent"));
}

S("V-11: the bell names who has not logged in in a fixed number of reads; the plan is worked out for one person when shown");
{
  // statements one call makes, counted where the rig's D1 stand-in runs each one (a batch counts each statement)
  const counted = async (F, fn) => { const ST = Object.getPrototypeOf(F.rig.backend.env.DB.prepare("SELECT 1")), ex = ST._exec; let n = 0;
    ST._exec = function () { n++; return ex.call(this); }; try { const r = await fn(); return { r, n }; } finally { ST._exec = ex; } };
  const sizes = {};
  for (const N of [20, 200]) {
    const feed = stdFeed();
    for (let i = 1; i <= N; i++) feed.push(AG("X" + i, "Biller " + String(i).padStart(3, "0") + " Made", "Tina Lead", SUN, { email: "biller" + i + ".made@purview-healthcare.com" }));
    const F = await floor({ now: IST(2026, 11, 16, 10, 30), feed });
    F.S.live = Array.from({ length: N }, (_, i) => LV("X" + (i + 1), {}));   // no punch in for any of them at 10:30 (shift 09:00)
    await F.give("Biller 001 Made", 5, /Sunrise/, null, "High"); await F.give("Biller 001 Made", 3);
    const MO = await F.who("Mona Manager"), TI = await F.who("Tina Lead");
    await F.freshLive(); await F.bell(MO);   // the live feed read once (kept two minutes), as on every page
    const bell = await counted(F, () => F.bell(MO));
    const one = (bell.r.alerts || []).find((a) => a.name === "Biller 001 Made");
    const plan = await counted(F, () => TI("team.sharePlan", { user_id: F.id("Biller 001 Made") }));
    const db = (await F.rows("SELECT COUNT(*) AS n, SUM(CASE WHEN tier = 'High' THEN 1 ELSE 0 END) AS high FROM claims WHERE assigned_to = ? AND state = 'assigned'", F.id("Biller 001 Made")))[0];
    sizes[N] = { bell: bell.n, plan: plan.n, alerts: (bell.r.alerts || []).length, one, p: plan.r, db };
    if (N === 200) {
      const PIA = await (async () => { F.S.feed.push(P({ emp_id: "D1", name: "Pia Poster", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Pia Poster") })); await F.sync(); return F.who("Pia Poster"); })();
      const r1 = await F.T(() => PIA("team.sharePlan", { user_id: F.id("Biller 001 Made") }));
      const LEO = await F.who("Leo Lead"), r2 = await F.T(() => LEO("team.sharePlan", { user_id: F.id("Biller 001 Made") }));
      ok("V-11: the plan is refused to a desk lead and to another team's lead", !r1.ok && r1.status === 403 && !r2.ok && r2.status === 403, [r1, r2]);
    }
  }
  ok("V-11: with 200 billers not logged in, one bell refresh names all 200 in well under D1's 1,000 queries", sizes[200].alerts === 200 && sizes[200].bell < 300, sizes[200].bell);
  ok("V-11: the bell's reads do not grow with the number not logged in (20 or 200)", sizes[200].bell - sizes[20].bell <= 2, [sizes[20].bell, sizes[200].bell]);
  const x = sizes[200], db = x.db;
  ok("V-11: each alert still says how many claims are not started and how many are high priority, without a plan", x.one && db.n === 8 && x.one.n === db.n && x.one.high === db.high && !("plan" in x.one), [x.one, db]);
  ok("V-11: the pop-up's plan for one person is worked out on its own: the same 8 claims, 2 each to the four people in, the others on the client named as not logged in",
    x.p.n === db.n && x.p.high === db.high && x.p.left === 0 && x.p.clients.join() === SUN && x.p.plan.length === 4 && x.p.plan.every((y) => y.count === 2) && x.p.skipped.length > 0 && x.p.skipped.every((y) => y.why === "not logged in"),
    { n: x.p.n, high: x.p.high, left: x.p.left, clients: x.p.clients, plan: x.p.plan.length, skipped: x.p.skipped.length, whys: [...new Set(x.p.skipped.map((y) => y.why))] });
  ok("V-11: and in a fixed number of reads too (20 or 200 not logged in)", sizes[200].plan - sizes[20].plan <= 2 && sizes[200].plan < 40, [sizes[20].plan, sizes[200].plan]);
}

S("V-06: the team lead's row on Team status rounds the team's attainment as the KPI does");
{
  const F = await floor({ now: IST(2026, 11, 16, 14) });
  // Nov 2-13 without Diwali (Nov 9): 9 working days x 10 = 90 each, 360 for Tina's four. Worked 80 + 81 + 81 + 81 = 323: 89.7%.
  const days = []; for (let d = 2; d <= 13; d++) { const iso = "2026-11-" + String(d).padStart(2, "0"), w = new Date(iso + "T12:00:00Z").getUTCDay(); if (w && w !== 6 && d !== 9) days.push(d); }
  for (const [n, total] of [["Arun Agent", 80], ["Bela Agent", 81], ["Cara Agent", 81], ["Dev Agent", 81]]) for (let i = 0; i < total; i++) await F.workAt(n, IST(2026, 11, days[i % days.length], 11) + i * 60000);
  const TI = await F.who("Tina Lead"), ts = await F.ts(TI, "2026-11-01", "2026-11-16");
  const mine = ts.rows.filter((r) => r.lead_id === F.id("Tina Lead"));
  ok("V-06: the KPI says 89.7% (323 of 360 up to yesterday)", ts.totals.attain === 89.7 && ts.totals.count_done === 323 && ts.totals.target_done === 360, ts.totals);
  const row = F.rig.app.groupAttain(mine);
  ok("V-06: Tina's row on the page says 89.7% too, below the 90% mark (not 90% in green)", mine.length === 4 && row === 89.7 && row < 90, row);
  const MO = await F.who("Mona Manager"), mts = await F.ts(MO, "2026-11-01", "2026-11-16");
  ok("V-06: the manager's Team status shows the same figure on Tina's row", F.rig.app.groupAttain(mts.rows.filter((r) => r.lead_id === F.id("Tina Lead"))) === 89.7);
  const today = await F.ts(TI, "2026-11-16", "2026-11-16");
  ok("V-06: with only today picked the row is today's figure to one decimal as well", F.rig.app.groupAttain(today.rows.filter((r) => r.lead_id === F.id("Tina Lead"))) === today.totals.attain, [today.totals.attain]);
}

S("V-08: the roster sync counts and lists every change it writes");
{
  const feed = stdFeed();
  const F = await floor({ now: IST(2026, 11, 16, 11), feed });
  const MO = await F.who("Mona Manager");
  F.clock(IST(2026, 11, 16, 11, 5));
  feed.find((x) => x.emp_id === "A1").shift = "13:00-22:00";                // Arun moves to the afternoon shift
  feed.find((x) => x.emp_id === "A2").also_in_departments = "Posting";       // Bela is also in Posting now
  feed.find((x) => x.emp_id === "A3").emp_id = "A3-CORR";                    // Cara's Emp ID corrected (matched by her email)
  feed.find((x) => x.emp_id === "A4").location = "Hyderabad";                // Dev moves city
  const r = await MO("team.syncRoster");
  await F.refresh();
  ok("V-08: the changes are written", F.U("Arun Agent").shift === "13:00-22:00" && F.U("Bela Agent").departments_also === "Posting" && F.U("Cara Agent").emp_id === "A3-CORR", [F.U("Arun Agent").shift, F.U("Bela Agent").departments_also, F.U("Cara Agent").emp_id]);
  ok("V-08: and counted: the sync says 4 changed (the Team tab's toast)", r.summary.updated === 4 && r.summary.new === 0, r.summary);
  const log = JSON.parse((await F.rows("SELECT value_json FROM settings WHERE key = 'shastra_log'"))[0].value_json), e = log[0];
  const ch = (n) => ((e.names || []).find((x) => x.name === n) || {}).changes || [];
  ok("V-08: the Roster page's list of what changed names each one with what changed",
    e.at === IST(2026, 11, 16, 11, 5) && e.updated === 4 && ch("Arun Agent").includes("shift") && ch("Bela Agent").includes("also_in_departments") && ch("Cara Agent").includes("emp_id") && ch("Dev Agent").includes("city"), e);
  const aud = await F.rows("SELECT detail FROM audit_log WHERE action = 'roster.sync' ORDER BY at DESC LIMIT 1");
  ok("V-08: the audit line says 4 changed", aud.length && /4 changed/.test(aud[0].detail), aud);
  ok("V-08: the page names them in plain words", F.rig.app.changeLabel("emp_id") === "Emp ID" && F.rig.app.changeLabel("also_in_departments") === "also in departments" && F.rig.app.changeLabel("reports_to_name") === "reports to");
  // the next sync with nothing changed writes nothing and counts nothing
  F.clock(IST(2026, 11, 16, 12, 5));
  const r2 = await F.sync();
  ok("V-08: the next sync with nothing new counts no change and adds no entry", r2.summary.updated === 0 && JSON.parse((await F.rows("SELECT value_json FROM settings WHERE key = 'shastra_log'"))[0].value_json)[0].at === IST(2026, 11, 16, 11, 5), r2.summary);
}

S("V-09: Live status's Needs you lines wrap on a phone (the page's own CSS)");
{
  // the browser proof measures the page at 390 px; here the rule that makes the strip's link buttons wrap is checked to stay
  const html = (await import("fs")).readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const rule = (html.match(/\.needs-strip \.btn\{([^}]*)\}/) || [])[1] || "";
  ok("V-09: the Needs you strip's lines wrap inside the card (white-space normal, at most the card's width)", /white-space:normal/.test(rule) && /max-width:100%/.test(rule), rule);
  ok("V-09: and the strip is the one Live status draws", /className="card tight row needs-strip"/.test((await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8")));
}

S("V-10: with Shastra down, a finished day is not judged on a figure sent while its shift was still open");
{
  const F = await floor({ now: IST(2026, 11, 17, 13) });   // Tuesday 17 Nov, 13:00
  // Shastra: Arun worked Monday 09:00-18:00 (480 on the floor); Tuesday his shift is open (240 so far). Bela's Monday shift
  // was never punched out in Shastra (still open there, 300).
  F.S.floorRows = [FL("A1", "2026-11-16", "present", 480, 45), FL("A1", "2026-11-17", "present", 240, 0, { open: true }), FL("A2", "2026-11-16", "present", 300, 30, { open: true }), FL("A2", "2026-11-17", "present", 240, 0, { open: true })];
  const TI = await F.who("Tina Lead");
  let ts = await F.ts(TI, "2026-11-16", "2026-11-17");
  ok("V-10: Tuesday 13:00: Arun's Tuesday is today (not judged), Monday met", F.row(ts, "Arun Agent").floor === "met" && F.row(ts, "Arun Agent").floor_needed_done_min === 480, F.row(ts, "Arun Agent"));
  // Shastra stops answering from Tuesday afternoon until Wednesday (it would have sent 480 for Tuesday)
  F.S.floorRows = [FL("A1", "2026-11-16", "present", 480, 45), FL("A1", "2026-11-17", "present", 480, 45)];
  F.S.floorFail = "timeout";
  F.clock(IST(2026, 11, 18, 10));
  ts = await F.ts(TI, "2026-11-16", "2026-11-18");
  const a = F.row(ts, "Arun Agent");
  ok("V-10: Wednesday, Shastra down: Arun's Tuesday is not known (1 day), not judged on the 240 sent at 13:00", a.floor_unknown_days === 1 && a.floor !== "short" && a.floor_needed_done_min === 480 && a.on_floor_done_min === 480, a);
  ok("V-10: his Tuesday still has its target (he was present)", a.target_done === 20, a.target_done);
  ok("V-10: and no suggestion about the 8-hour rule for him", ![...ts.suggestions.today, ...ts.suggestions.week].some((x) => x.who === "Arun Agent" && /floor|8-hour/i.test(x.seen + " " + x.do)), ts.suggestions);
  // a day Shastra itself still has open after it ended (a missed punch-out) is Shastra's figure: judged as before
  F.S.floorFail = null; F.S.floorRows = [FL("A1", "2026-11-16", "present", 480, 45), FL("A1", "2026-11-17", "present", 480, 45), FL("A2", "2026-11-16", "present", 300, 30, { open: true }), FL("A2", "2026-11-17", "present", 480, 45)];
  await F.sql("DELETE FROM settings WHERE key = 'floor_sync'");
  ts = await F.ts(TI, "2026-11-16", "2026-11-18");
  const b = F.row(ts, "Bela Agent"), a2 = F.row(ts, "Arun Agent");
  ok("V-10: Shastra answering again: Arun's Tuesday is known and met (960 of 960)", a2.floor === "met" && a2.floor_unknown_days === 0 && a2.on_floor_done_min === 960, a2);
  ok("V-10: a shift Shastra still has open after the day ended (no punch-out) is judged on Shastra's figure, as before", b.floor === "short" && b.floor_unknown_days === 0 && b.on_floor_done_min === 780, b);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
