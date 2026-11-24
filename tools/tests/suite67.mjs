/* Suite 67: a night shift's day on every screen (round 2 of the testers' findings, 2.119.0). A night-shift biller (18:30-03:30
   India time) works before and after midnight: Team status Today, its closed count, Live status (worked, the weekend and the
   floor's target) and My day all count the shift's own working day (workDayOf). Ops the page sends no day to fall back to
   India's date, not the UTC one (a day behind from 00:00 to 05:30 India time). The clock is moved (Date.now and new Date()).
   A stand-in for Purview Shastra's roster; made-up people, patients and claim numbers only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", NIGHT = "18:30-03:30";
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", project: SUN, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", shift: NIGHT, email: mail("Arun Agent") }),
  P({ emp_id: "A2", name: "Bela Agent", project: SUN, reports_to: "Tina Lead", shift: NIGHT, email: mail("Bela Agent") }),
  P({ emp_id: "A3", name: "Dev Agent", project: SUN, reports_to: "Tina Lead", email: mail("Dev Agent") }),
];
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_holidays")) return J({ ok: true, today: "2026-11-08", holidays: [] });
  if (url.includes("brahmastra_live") || url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ code: "PGRST202", message: "not set up" }, 404);
  return new Response("nope", { status: 500 });
};
const _log = console.log; console.log = (...a) => { if (/^(Snapshot|Folders|Shastra|TAT|Escalation|Digest)/.test(String(a[0]))) return; _log(...a); };
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, sha } = rig; const app = rig.app;
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const q1 = async (s, ...a) => (await q(s, ...a))[0];
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {};
for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); TOK[f.name] = (await login(f.email, "pw-" + f.email)).token; }
await sql("UPDATE sessions SET expires_at = expires_at + ?", 400 * 86400000);
const TI = as(TOK["Tina Lead"]), ARUN = as(TOK["Arun Agent"]), BELA = as(TOK["Bela Agent"]), DEV = as(TOK["Dev Agent"]);
const sun = (await A("clients.list")).clients.find((c) => c.name === SUN);
await sql("UPDATE claims SET state = 'excluded', assigned_to = NULL WHERE client_id = ?", sun.id);
await sql("UPDATE users SET capacity = 35 WHERE id IN (?, ?, ?)", U("Arun Agent"), U("Bela Agent"), U("Dev Agent"));
// the clock: India wall time; Date.now and new Date() both follow it, in the worker and in the page
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const RealDate = globalThis.Date; let fake = null;
class FDate extends RealDate { constructor(...a) { if (a.length === 0 && fake != null) super(fake); else super(...a); } static now() { return fake != null ? fake++ : RealDate.now(); } }
globalThis.Date = FDate; try { app.Date = FDate; } catch (e) {}
const setNow = (ms) => { fake = ms; };
const at = (d, h, m = 0, mo = 11) => IST(2026, mo, d, h, m);
const nowIso = () => new RealDate(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const T = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
let seq = 0;
const make = async (who) => {
  seq++; const id = "s67-" + seq, no = "S67-" + String(10000 + seq), now = Date.now();
  await sql(`INSERT INTO claims (id, client_id, match_key, claim_no, patient, payer, dos, balance, priority, tier, status_class, state, assigned_to, assigned_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, sun.id, "claim:" + no.toLowerCase(), no, "Testpatient, N" + seq, "Aetna", "2026-09-30", 100 + seq, 50, "Medium", "denied", who ? "assigned" : "open", who ? U(who) : null, who ? now : null, now, now);
  return id;
};
const FU = { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" };
const CLOSE = { status: "Claim Paid", sub_status: "Already Posted", action: "Moved To Closed/Non Workable", bucket: "Closed", effective: "Processing-Closed" };
const NOTE = { source: "Portal", findings: "Checked the payer portal, claim on file" };
const save = async (who, id, saag) => { await who("queue.open", { id }); return who("queue.complete", { id, saag, note: NOTE, desk: true }); };
const status = async (from, to, extra = {}) => Object.fromEntries((await TI("team.status", { from, to, ...extra })).rows.map((r) => [r.name.split(" ")[0], r]));
const huddle = async () => { const h = await TI("team.huddle", {}); h.by = Object.fromEntries(h.rows.map((r) => [r.name.split(" ")[0], r])); return h; };
// the page's own day for My day (a night shift's runs to 05:00, as app.jsx bizDayBounds does)
const myDay = async (who) => { const now = Date.now(), ist = now + 330 * 60000, roll = 300 * 60000, start = now - (((ist - roll) % 86400000) + 86400000) % 86400000; return (await who("queue.summary", { day_from_ms: start, day_to_ms: start + 86400000 - 1 })).done_today.n; };

S("A night shift on Monday 9 Nov, read at 02:50 on Tuesday: Team status Today, Live status and My day agree");
setNow(at(9, 16, 0));
const arunIds = []; for (let i = 0; i < 6; i++) arunIds.push(await make("Arun Agent"));
const devIds = []; for (let i = 0; i < 2; i++) devIds.push(await make("Dev Agent"));
// Arun: 19:00 and 23:00 on Monday, 00:30 (closes it), 01:30 and 02:15 (closes it) after midnight
for (const [i, [d, h, m], saag] of [[0, [9, 19, 0], FU], [1, [9, 23, 0], FU], [2, [10, 0, 30], CLOSE], [3, [10, 1, 30], FU], [4, [10, 2, 15], CLOSE]]) { setNow(at(d, h, m)); const r = await T(() => save(ARUN, arunIds[i], saag)); if (!r.ok) console.log("save", i, r.e); }
setNow(at(9, 11, 0)); await save(DEV, devIds[0], FU);   // Dev's Monday entry (day shift)
setNow(at(10, 2, 50));
const today = await status("2026-11-10", "2026-11-10", { today_only: 1 });
ok("Team status Today at 02:50: Arun worked 5, all of them today's (the shift that began on Monday)", today.Arun.worked === 5 && today.Arun.worked_today === 5 && today.Arun.count_today === 5, [today.Arun.worked, today.Arun.worked_today, today.Arun.count_today]);
ok("Team status Today at 02:50: Arun's target today is his day's target (35), not 0", today.Arun.target_today === 35, today.Arun.target_today);
ok("Team status Today at 02:50: Arun closed 2 today (the two he closed after midnight)", today.Arun.closed === 2, today.Arun.closed);
ok("Team status Today at 02:50: Dev, a day shift, is on Tuesday already: nothing worked yet, Tuesday's target", today.Dev.worked === 0 && today.Dev.target_today === 35, [today.Dev.worked, today.Dev.target_today]);
const h1 = await huddle();
ok("Live status at 02:50 says the same for Arun: worked 5, closed 2", h1.by.Arun.worked === 5 && h1.by.Arun.closed === 2, [h1.by.Arun.worked, h1.by.Arun.closed]);
ok("My day at 02:50 says the same for Arun: 5 worked today", (await myDay(ARUN)) === 5);
const mon = await status("2026-11-09", "2026-11-09");
ok("Team status for Monday (dates picked): Arun's whole shift, 5 worked", mon.Arun.worked === 5, mon.Arun.worked);
ok("Team status for Monday: Arun closed 2, on the day his entries are counted (not on Tuesday)", mon.Arun.closed === 2, mon.Arun.closed);
const tueDates = await status("2026-11-10", "2026-11-10");
ok("Team status with Tuesday picked as a date (not Today): calendar Tuesday, the night shift has nothing there yet", tueDates.Arun.worked === 0 && tueDates.Arun.closed === 0, [tueDates.Arun.worked, tueDates.Arun.closed]);
const both = await status("2026-11-09", "2026-11-10");
ok("Monday to Tuesday: Arun's 5 entries and 2 closes counted once", both.Arun.worked === 5 && both.Arun.closed === 2, [both.Arun.worked, both.Arun.closed]);
setNow(at(10, 6, 0));
const today2 = await status("2026-11-10", "2026-11-10", { today_only: 1 });
ok("06:00 Tuesday: Arun's Monday shift is over, Team status Today starts his new day at 0", today2.Arun.worked === 0 && today2.Arun.closed === 0 && today2.Arun.target_today === 35, [today2.Arun.worked, today2.Arun.closed, today2.Arun.target_today]);
const mon2 = await status("2026-11-09", "2026-11-09");
ok("06:00 Tuesday: Team status for Monday still has Arun's 5 worked and 2 closed (now a finished day)", mon2.Arun.worked === 5 && mon2.Arun.closed === 2 && mon2.Arun.worked_done === 5, [mon2.Arun.worked, mon2.Arun.closed, mon2.Arun.worked_done]);
ok("06:00 Tuesday: Live status starts Arun's new day at 0 worked, 0 closed", (await huddle()).by.Arun.worked === 0 && (await huddle()).by.Arun.closed === 0);

S("A Friday night shift after midnight: Live status does not say weekend, and its target counts");
setNow(at(27, 16, 0));
const fri = [await make("Arun Agent"), await make("Arun Agent")];
setNow(at(27, 22, 0)); await save(ARUN, fri[0], FU);
setNow(at(28, 1, 0)); await save(ARUN, fri[1], FU);
setNow(at(28, 2, 40));
const h2 = await huddle();
ok("Saturday 02:40: the Friday night shift is still Friday, a working day (no weekend line)", h2.weekend === false && !h2.holiday, [h2.weekend, h2.holiday]);
ok("Saturday 02:40: the floor's target is the night billers' (Arun and Bela, 35 each), not 0; Dev is on his Saturday", h2.totals.capacity === 70, h2.totals.capacity);
ok("Saturday 02:40: Arun's row has a pace target and 2 worked", h2.by.Arun.expected > 0 && h2.by.Arun.worked === 2, [h2.by.Arun.expected, h2.by.Arun.worked]);
ok("Saturday 02:40: Dev (day shift) has no target on his Saturday", h2.by.Dev.expected === 0, h2.by.Dev.expected);
setNow(at(28, 10, 0));
const h3 = await huddle();
ok("Saturday 10:00: everyone's day is Saturday: weekend, no target on the floor", h3.weekend === true && h3.totals.capacity === 0, [h3.weekend, h3.totals.capacity]);
setNow(at(30, 1, 0));
const h4 = await huddle();
ok("Monday 01:00: a working day for Dev (day shift), so no weekend line", h4.weekend === false, h4.weekend);
ok("Monday 01:00: the floor's target is Dev's only (the night billers are still on their Sunday shift, no target)", h4.totals.capacity === 35 && h4.by.Arun.expected === 0, [h4.totals.capacity, h4.by.Arun.expected]);

S("Ops the page sends no day to: India's date between 00:00 and 05:30, not the UTC date");
setNow(at(1, 16, 0, 12));
const nd = [await make("Dev Agent"), await make("Dev Agent")];
await sql("UPDATE claims SET state = 'completed', follow_up_on = '2026-12-02', assigned_to = NULL, assigned_at = NULL WHERE id = ?", nd[1]);
setNow(at(2, 2, 0, 12));   // Wednesday 2 Dec 02:00 India time = 1 Dec 20:30 UTC
const noDay = (who, op, p = {}) => who(op, { today: undefined, ...p });
ok("an entry saved at 02:00 with no day sent is dated 2 Dec (India), follow-up 17 Dec (+15)", await (async () => { await noDay(DEV, "queue.open", { id: nd[0] }); await noDay(DEV, "queue.complete", { id: nd[0], saag: FU, note: NOTE, desk: true }); const c = await q1("SELECT last_worked_on, follow_up_on FROM claims WHERE id = ?", nd[0]); return c.last_worked_on === "2026-12-02" && c.follow_up_on === "2026-12-17"; })(), await q1("SELECT last_worked_on, follow_up_on FROM claims WHERE id = ?", nd[0]));
const due = await noDay(TI, "claims.list", { client_id: sun.id, follow_up_due: 1, page_size: 50 });
ok("the Claims list's 'follow-up due' with no day sent finds the claim due today (2 Dec)", due.rows.some((r) => r.id === nd[1]), due.rows.length);
const el = await noDay(TI, "claims.eligible", { client_id: sun.id });
ok("the Allocate pool with no day sent has the claim whose follow-up is today", el.claims.some((c) => c.id === nd[1]));
const tt = await TI("team.today", { client_id: sun.id, day: undefined });
ok("the day's team with no day sent is for 2 Dec", tt.day === "2026-12-02", tt.day);
await noDay(TI, "team.setOut", { user_id: U("Dev Agent"), out: true, reason: "Sick" });
ok("Out today marked at 02:00 with no day sent is Dev's 2 Dec (his day shift's day)", (await q1("SELECT day FROM attendance WHERE user_id = ? AND status = 'out'", U("Dev Agent"))).day === "2026-12-02", await q("SELECT day FROM attendance WHERE user_id = ?", U("Dev Agent")));
const withDay = await TI("claims.list", { client_id: sun.id, follow_up_due: 1, page_size: 50, today: "2026-12-01" });
ok("a day the page sends still wins (1 Dec sent: the claim due 2 Dec is not due yet)", !withDay.rows.some((r) => r.id === nd[1]));

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
