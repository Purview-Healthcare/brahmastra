/* Suite 36: regression checks for the bug-test fixes in people and time (tester B's findings, and H-07 with B-08): Team status
   (Shastra's attendance words, night shifts, new joiners, long dates and Shastra's floor feed), Live status (worked today,
   holidays), the capacity pace, the Monday digest's AR a week before, and India's date on the page whatever the computer's
   time zone. A made-up team on the demo data, a stand-in for Purview Shastra's roster, holidays and floor-time feeds, and a
   clock moved to fixed moments in November 2026 (Monday Nov 9 is Diwali in Shastra). Nothing here is a real person. */
import vm from "vm";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
// IST(2026, 11, 10, 9, 30) is 09:30 IST on 10 Nov 2026
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const D = (n) => "2026-11-" + String(n).padStart(2, "0");
const nextDay = (iso) => new Date(Date.parse(iso + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const B = (emp_id, name, o = {}) => P({ emp_id, name, project: "Sunrise Eye Care", reports_to: "Tess Lead", shift: "09:00-18:00", email: mail(name), ...o });
const feed = [
  P({ emp_id: "V1", name: "Vida Vice", position: "Vice President", email: mail("Vida Vice") }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vida Vice", project: "Sunrise Eye Care", also_on_projects: "Lakeview Dental Group", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tess Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: mail("Tess Lead") }),
  B("B1", "Dina Day"), B("B2", "Hal Half"), B("B3", "Lea Leave"), B("B4", "Otto Over"), B("B5", "Nell Night", { shift: "18:30-03:30" }), B("B6", "Walt West", { shift: "22:30-07:30" }),
  B("B7", "Jo Joiner", { doj: "2026-11-05" }), B("B9", "Ola Owl", { shift: "18:30-03:30" }), B("B10", "Eve Early"),
  P({ emp_id: "B8", name: "Lou Lake", project: "Lakeview Dental Group", reports_to: "Mona Manager", email: mail("Lou Lake") }),
];
// Purview Shastra: the roster, its holidays, and the floor-time feed (404 until floorRows is set; at most 93 days a call, as
// dev/shastra-floor-feed.sql); the other feeds are not set up here
let floorRows = null; const floorCalls = [];
const fetchMock = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : {};
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: [{ date: "2026-11-09", name: "Diwali" }] });
  if (url.includes("brahmastra_floor")) {
    floorCalls.push([body.p_from, body.p_to]);
    if (!floorRows) return J({ code: "PGRST202", message: "no such function" }, 404);
    if ((Date.parse(body.p_to) - Date.parse(body.p_from)) / 86400000 > 92) return J({ ok: false, error: "Ask for up to 93 days at a time" });
    return J({ ok: true, rows: floorRows.filter((x) => x.date >= body.p_from && x.date <= body.p_to) });
  }
  if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "no such function" }, 404);
  return J({ error: "no outside calls in tests" }, 500);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, sha } = rig;
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name) => { const email = mail(name); await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TL = await firstIn("Tess Lead"), WW = await firstIn("Walt West"), DD = await firstIn("Dina Day");
// the clock moves to fixed moments in November 2026, for the server and for the page's own code; the sessions outlast it
await sql("UPDATE sessions SET expires_at = ?", Date.now() + 400 * 86400000);
const VDate = vm.runInContext("Date", rig.app), page = (code) => vm.runInContext(code, rig.app);
const at = async (ms, fn) => { const r1 = Date.now, r2 = VDate.now; Date.now = () => ms; VDate.now = () => ms; try { return await fn(); } finally { Date.now = r1; VDate.now = r2; } };
const cls = (await A("clients.list")).clients; const sun = cls.find((c) => /Sunrise/.test(c.name)), lake = cls.find((c) => /Lakeview/.test(c.name));
const sunClaims = (await rows("SELECT id FROM claims WHERE client_id = ? ORDER BY id", sun.id)).map((r) => r.id), lakeClaims = (await rows("SELECT id FROM claims WHERE client_id = ? ORDER BY id", lake.id)).map((r) => r.id);
let nn = 0;
const work = async (name, ms, n = 1, { client = "sun", stepMin = 1 } = {}) => { const u = U(name), pool = client === "lake" ? lakeClaims : sunClaims;
  for (let i = 0; i < n; i++) { nn++; await sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) VALUES (?,?,?,?,'work',?)", "s36n" + nn, pool[nn % pool.length], u.id, u.name, ms + i * stepMin * 60000); } };
const F = (emp, date, status, tof, o = {}) => ({ emp_id: emp, email: "", date, status, open: false, tof_min: tof, logged_min: tof + 60, break_min: 60, guard: false, idle_min: 0, locked_min: 0, ...o });
const freshFloor = async (r) => { floorRows = r; floorCalls.length = 0; await sql("DELETE FROM settings WHERE key = 'floor_sync'"); await sql("DELETE FROM floor_days"); };
// Team status and Live status as the page asks for them, on India's day
const status = (who, from, to, today, ms) => at(ms, () => who("team.status", { from, to, today, tz_offset_min: 330 }));
const live = (who, today, ms) => at(ms, () => who("team.huddle", { today, tz_offset_min: 330 }));
const row = (r, n) => r.rows.find((x) => x.name === n);
const pick = (x, ks) => x ? Object.fromEntries(ks.map((k) => [k, x[k]])) : x;

S("B-01: Shastra's attendance words: the half-day and leave spellings, Overtime on a working day");
{
  await freshFloor([
    ...[2, 3, 4, 5, 6].map((d) => F("B2", D(d), d === 4 ? "half-day" : "present", d === 4 ? 240 : 480)),
    ...[2, 3, 4, 5, 6].map((d) => F("B3", D(d), d === 5 ? "leave" : "present", d === 5 ? 0 : 480)),
    ...[2, 3, 4, 5, 6].map((d) => F("B4", D(d), d === 4 ? "overtime" : "present", 480)),
  ]);
  // Otto is marked Out today here on Wednesday, but Shastra has him in on Overtime that day: Shastra's attendance decides
  await sql("INSERT INTO attendance (user_id, day, status, reason, by_name, at) VALUES (?,?,'out','Sick','Tess Lead',?)", U("Otto Over").id, D(4), IST(2026, 11, 4, 9));
  const r = await status(A, D(2), D(6), D(10), IST(2026, 11, 10, 15)), h = row(r, "Hal Half"), l = row(r, "Lea Leave"), o = row(r, "Otto Over");
  const ks = ["days_full", "days_half", "days_out", "days_unplanned", "target_done", "floor_needed_done_min"];
  ok("B-01: 'half-day' (Shastra's older spelling) is a half day: 4.5 days, target 157.5, 36 h of floor time needed", h.days_half === 1 && h.days_full === 4 && h.target_done === 157.5 && h.floor_needed_done_min === 36 * 60, pick(h, ks));
  ok("B-01: 'leave' (Shastra's older spelling of approved leave) is a day of leave: no target, no floor time, not unplanned", l.days_out === 1 && l.days_unplanned === 0 && l.target_done === 140 && l.floor_needed_done_min === 32 * 60, pick(l, ks));
  ok("B-01: Overtime on a working day is a day in, even with an Out today mark here: 5 days, target 175, 40 h", o.days_full === 5 && o.days_out === 0 && o.target_done === 175 && o.floor_needed_done_min === 40 * 60, pick(o, ks));
}

S("B-13: no target and no floor time before the date of joining");
{
  await freshFloor(null);
  for (const d of [5, 6]) await work("Jo Joiner", IST(2026, 11, d, 10), 35);
  const r = await status(A, D(2), D(10), D(10), IST(2026, 11, 10, 15)), j = row(r, "Jo Joiner");
  const ks = ["doj", "days_full", "days_out", "count_done", "target_done", "attain", "perf", "floor_needed_done_min"];
  ok("B-13: joined Thu Nov 5, 35 a day: 70 of 70 up to yesterday (100%, meeting the mark), 16 h of floor time needed", j.target_done === 70 && j.count_done === 70 && j.attain === 100 && j.perf === "ok" && j.floor_needed_done_min === 16 * 60, pick(j, ks));
  ok("B-13: the days before joining are not days out, and there is no Do today pointer about her", j.days_out === 0 && j.days_full === 3 && !r.suggestions.today.some((s) => s.who === "Jo Joiner"), { ...pick(j, ks), today: r.suggestions.today.filter((s) => s.who === "Jo Joiner") });
}

S("B-03: a night shift's work counts to the day it began, also when the shift ends after 05:00");
{
  // Walt (22:30 to 07:30) works 35 a night on Monday and Tuesday nights: 10 before midnight, 15 from 01:00, 10 from 05:30
  for (const d of [2, 3]) { await work("Walt West", IST(2026, 11, d, 23), 10); await work("Walt West", IST(2026, 11, d + 1, 1), 15); await work("Walt West", IST(2026, 11, d + 1, 5, 30), 10); }
  // Nell (18:30 to 03:30) works 35 a night too
  for (const d of [2, 3]) { await work("Nell Night", IST(2026, 11, d, 19), 20); await work("Nell Night", IST(2026, 11, d + 1, 0, 30), 15); }
  // a team task update at 06:00 on Wednesday, inside Tuesday night's shift; 2 entries at 09:30 Wednesday, after his day rolled
  await sql("INSERT INTO team_task_updates (id, task_id, user_id, user_name, kind, delta, at) VALUES ('s36u1', 's36t1', ?, 'Walt West', 'update', 5, ?)", U("Walt West").id, IST(2026, 11, 4, 6));
  await work("Walt West", IST(2026, 11, 4, 9, 30), 2);
  const r = await status(A, D(2), D(4), D(4), IST(2026, 11, 4, 15)), w = row(r, "Walt West"), n = row(r, "Nell Night");
  const ks = ["worked_done", "target_done", "worked_today", "task_items_done", "task_items_today", "attain", "perf"];
  ok("B-03: 22:30 to 07:30: the entries up to 07:30 count to the night before: 70 of 70 claims up to yesterday", w.worked_done === 70 && w.target_done === 70 && w.worked_today === 2, pick(w, ks));
  ok("B-03: a team task update at 06:00 inside the night shift counts to the night before too", w.task_items_done === 5 && w.task_items_today === 0, pick(w, ks));
  ok("B-03: 18:30 to 03:30 as before: 70 of 70, 100%", n.worked_done === 70 && n.target_done === 70 && n.attain === 100, pick(n, ks));
  // My day for the same biller (the page's working day): Monday night's day runs to 09:00 on Tuesday
  const md = await at(IST(2026, 11, 3, 8), async () => { const [f, t] = page('bizDayBounds("22:30-07:30")'); return { f, n: (await WW("queue.summary", { day_from_ms: f, day_to_ms: t })).done_today.n }; });
  ok("B-03: (same mistake in My day) 22:30 to 07:30 at 08:00 Tuesday: worked today is the whole night (35), from 09:00 Monday", md.f === IST(2026, 11, 2, 9) && md.n === 35, { from: new Date(md.f).toISOString(), n: md.n });
  const n1 = await at(IST(2026, 11, 3, 4), () => page('bizDayBounds("18:30-03:30")[0]')), d1 = await at(IST(2026, 11, 3, 8), () => page('bizDayBounds("09:00-18:00")[0]'));
  ok("B-03: My day for 18:30 to 03:30 and for a day shift still starts at 05:00", n1 === IST(2026, 11, 2, 5) && d1 === IST(2026, 11, 3, 5), [new Date(n1).toISOString(), new Date(d1).toISOString()]);
}

S("B-14: a night shift still under way after midnight is not judged as a finished day");
{
  // Ola (18:30 to 03:30): 20 entries from 19:00 on Monday and 10 after midnight; Shastra shows her shift open, 6.5 h so far
  await work("Ola Owl", IST(2026, 11, 2, 19), 20); await work("Ola Owl", IST(2026, 11, 3, 0, 10), 10, { stepMin: 4 });
  await freshFloor([F("B9", D(2), "present", 390, { open: true })]);
  // on her desk, not started: one claim given on Sunday, one at 19:00 on Monday (during her shift)
  const setDesk = (id, ms) => sql("UPDATE claims SET state = 'assigned', assigned_to = ?, assigned_at = ?, started_at = NULL, follow_up_on = '', tier = 'Medium' WHERE id = ?", U("Ola Owl").id, ms, id);
  await setDesk(sunClaims[200], IST(2026, 11, 1, 12)); await setDesk(sunClaims[201], IST(2026, 11, 2, 19));
  const r = await status(A, D(2), D(3), D(3), IST(2026, 11, 3, 1)), o = row(r, "Ola Owl");
  const ks = ["attain_basis", "count_done", "target_done", "count_today", "target_today", "attain", "perf", "floor", "left"];
  ok("B-14: Tue 01:00, her Monday shift runs to 03:30: not judged yet (day under way), 30 of 35 so far", o.attain_basis === "today" && o.target_done === 0 && o.count_today === 30 && o.target_today === 35 && o.perf === "pending", pick(o, ks));
  ok("B-14: her floor time is not judged either, and there are no pointers about her", o.floor === "pending" && !r.suggestions.today.concat(r.suggestions.week).some((s) => s.who === "Ola Owl"), { ...pick(o, ks), pointers: r.suggestions.today.concat(r.suggestions.week).filter((s) => s.who === "Ola Owl") });
  ok("B-14: left over is the claim given before her working day (Sunday), not the one given during her shift", o.left === 1, pick(o, ks));
  const o2 = row(await status(A, D(2), D(3), D(3), IST(2026, 11, 3, 6)), "Ola Owl");
  ok("B-14: at 06:00 her Monday is finished and judged: 30 of 35 up to yesterday, 85.7%, below the mark", o2.attain_basis === "done" && o2.target_done === 35 && o2.count_done === 30 && o2.attain === 85.7 && o2.perf === "below", pick(o2, ks));
}

S("B-11: Live status counts the whole working day, as Team status and My day");
{
  // Dina (09:00 to 18:00): 20 entries and a claim closed on Tuesday; on Wednesday 5 entries at 08:30, before her shift
  await work("Dina Day", IST(2026, 11, 10, 14), 20);
  await sql("UPDATE claims SET state = 'closed', completed_at = ?, last_worked_by = ? WHERE id = ?", IST(2026, 11, 10, 15), U("Dina Day").id, sunClaims[210]);
  await work("Dina Day", IST(2026, 11, 11, 8, 30), 5);
  const e = row(await live(TL, D(11), IST(2026, 11, 11, 8, 45)), "Dina Day");
  const ks = ["worked", "closed", "expected", "behind", "status"];
  ok("B-11: 08:45 Wednesday, before her 09:00 shift: worked today 5 (not Tuesday's 20), closed today 0, nothing expected yet", e.worked === 5 && e.closed === 0 && e.expected === 0 && !e.behind, pick(e, ks));
  await work("Dina Day", IST(2026, 11, 11, 9, 30), 3);
  const m = row(await live(TL, D(11), IST(2026, 11, 11, 11)), "Dina Day"), t = row(await status(TL, D(11), D(11), D(11), IST(2026, 11, 11, 11)), "Dina Day");
  const md = await at(IST(2026, 11, 11, 11), async () => { const [f, to] = page('bizDayBounds("09:00-18:00")'); return (await DD("queue.summary", { day_from_ms: f, day_to_ms: to })).done_today.n; });
  ok("B-11: 11:00: Live status worked today 8 = Team status Today 8 = My day 8 (the 5 before the shift count)", m.worked === 8 && t.worked_today === 8 && md === 8, { live: m.worked, team: t.worked_today, myday: md });
  ok("B-11: the pace is judged on the 8, against 2 of her 9 hours (8 expected): not behind", m.expected === 8 && !m.behind, pick(m, ks));
  // a night shift on Live status: Ola (18:30 to 03:30) on Wednesday night
  await work("Ola Owl", IST(2026, 11, 11, 19), 20); await work("Ola Owl", IST(2026, 11, 12, 0, 10), 10);
  const n1 = row(await live(TL, D(12), IST(2026, 11, 12, 1)), "Ola Owl"), n2 = row(await live(TL, D(12), IST(2026, 11, 12, 10)), "Ola Owl");
  ok("B-11: a night shift at 01:00: worked today is the evening's 20 and the 10 since midnight (30)", n1.worked === 30, pick(n1, ks));
  ok("B-11: at 10:00 the next morning a new working day has begun: 0 worked, nothing expected before her 18:30 shift, not behind", n2.worked === 0 && n2.expected === 0 && !n2.behind, pick(n2, ks));
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
