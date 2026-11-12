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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
