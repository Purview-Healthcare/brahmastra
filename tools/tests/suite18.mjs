// Live status with Purview Shastra: each biller's attendance now (present, late, on a break, on leave, not in yet, not
// logged in an hour after the shift began), the team lead's alert (who sees it, snooze, dismiss), the untouched claims
// shared equally between the people logged in on the same client (and marked out), Rebalance on the same rule, and the
// biller's "N new claims were allocated to you" notice for any allocation.
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const FEED_KEY = "k".repeat(48);
// shifts around the time the suite runs (IST), so the states do not depend on the clock
const IST = 330 * 60000, now0 = Date.now();
const hm = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
const shiftFrom = (startMs) => hm(startMs) + "-" + hm(startMs + 9 * 3600000);
const iso = (ms) => new Date(ms).toISOString();
const SH = { arun: shiftFrom(now0 - 65 * 60000), gita: shiftFrom(now0 - 3 * 3600000), dev: shiftFrom(now0 - 2 * 3600000), cara: shiftFrom(now0 - 3 * 3600000), kim: shiftFrom(now0 + 30 * 60000), bela: shiftFrom(now0 - 3 * 3600000) };
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Joseph Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", shift: SH.arun, email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cara Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", shift: SH.cara, email: "cara@purview-healthcare.com" }),
  P({ emp_id: "A4", name: "Gita Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", shift: SH.gita, email: "gita@purview-healthcare.com" }),
  P({ emp_id: "A5", name: "Dev Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", shift: SH.dev, email: "dev@purview-healthcare.com" }),
  P({ emp_id: "A6", name: "Kim Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", shift: SH.kim, email: "kim@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", shift: SH.bela, email: "bela@purview-healthcare.com" }),
];
// Shastra now: Arun no punch 65 minutes into the shift; Gita in on time; Dev in 20 minutes late; Cara on sick leave;
// Kim's shift starts in half an hour; Bela on a break
const L = (emp, o) => ({ emp_id: emp, email: "", shift: "", no_punch: false, auto_present: false, week_off: false, holiday: false, leave: null, status: "", in_at: null, out_at: null, late_ok: false, break_since: null, ...o });
let liveRows = [
  L("A1", { shift: SH.arun }), L("A4", { shift: SH.gita, status: "present", in_at: iso(now0 - 3 * 3600000 + 2 * 60000) }), L("A5", { shift: SH.dev, status: "late", in_at: iso(now0 - 2 * 3600000 + 20 * 60000) }),
  L("A3", { shift: SH.cara, status: "sick_leave" }), L("A6", { shift: SH.kim }), L("A2", { shift: SH.bela, status: "present", in_at: iso(now0 - 3 * 3600000), break_since: iso(now0 - 5 * 60000) }),
];
let liveOn = true;
const bizDay = new Date(now0 + IST - 5 * 3600000).toISOString().slice(0, 10);
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_live")) {
    if (!liveOn) return new Response(JSON.stringify({ code: "PGRST202", message: "not set up" }), { status: 404, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, at: new Date().toISOString(), day: bizDay, rows: liveRows }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("supabase.co")) return new Response(JSON.stringify({ code: "PGRST202", message: "not set up" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const fresh = () => sql("DELETE FROM settings WHERE key = 'live_sync'");
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"), SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com");
const AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), GI = await firstIn("Gita Agent", "gita@purview-healthcare.com"), DE = await firstIn("Dev Agent", "dev@purview-healthcare.com");
const clients = (await A("clients.list")).clients; const sunrise = clients.find((c) => /Sunrise/.test(c.name));
await A("clients.saveTeam", { client_id: sunrise.id, team: ["Arun Agent", "Cara Agent", "Gita Agent", "Dev Agent", "Kim Agent"].map((n) => U(n).id) });
const open = (await A("claims.list", { client_id: sunrise.id, state: "open", page_size: 100 })).rows;
await TI("alloc.reassign", { ids: open.slice(0, 6).map((c) => c.id), user_id: U("Arun Agent").id });
await sql("UPDATE claims SET tier = 'High' WHERE id IN (?, ?)", open[0].id, open[1].id);
let r, h;
const row = (hh, n) => hh.rows.find((x) => x.name === n);

S("Live status: each biller's attendance in Shastra now");
h = await TI("team.huddle", {});
ok("Shastra answers", h.shastra_state === "ok", h.shastra_state);
ok("no punch an hour into the shift: Not logged in, how long past the start", row(h, "Arun Agent").shastra.state === "missing" && /past/.test(row(h, "Arun Agent").shastra.sub), row(h, "Arun Agent").shastra);
ok("punched in on time: Present with the time", row(h, "Gita Agent").shastra.state === "present" && /^in \d\d:\d\d$/.test(row(h, "Gita Agent").shastra.sub), row(h, "Gita Agent").shastra);
ok("in 20 minutes after the start: Late (10 minutes grace)", row(h, "Dev Agent").shastra.state === "late", row(h, "Dev Agent").shastra);
ok("sick leave in Shastra: On leave", row(h, "Cara Agent").shastra.state === "leave" && /sick leave/.test(row(h, "Cara Agent").shastra.sub), row(h, "Cara Agent").shastra);
ok("shift not started yet: Not in yet", row(h, "Kim Agent").shastra.state === "notin", row(h, "Kim Agent").shastra);
ok("each row has its untouched claims", row(h, "Arun Agent").untouched === 6, row(h, "Arun Agent").untouched);
const hl = await LE("team.huddle", {});
ok("an open break: On break", row(hl, "Bela Agent").shastra.state === "break", row(hl, "Bela Agent").shastra);

S("The team lead's alert: not logged in an hour after the shift began");
let nt = await TI("notify.list", {});
let al = (nt.alerts || []).find((a) => a.name === "Arun Agent");
ok("the team lead gets the pop-up for Arun", al && al.popup === true, nt.alerts);
ok("it carries the claims not started (2 high) and the plan: shared equally between the two people logged in", al && al.n === 6 && al.high === 2 && al.plan.length === 2 && al.plan.every((x) => x.count === 3) && al.plan.map((x) => x.name).sort().join() === "Dev Agent,Gita Agent", al);
ok("people not in are named with why (on leave, not in yet)", al && al.skipped.some((x) => x.name === "Cara Agent" && x.why === "on leave") && al.skipped.some((x) => x.name === "Kim Agent" && x.why === "not in yet"), al && al.skipped);
ok("the bell says it too", nt.items.some((x) => x.key === "shastra_missing" && x.n === 1 && x.view === "live"), nt.items.map((x) => x.key));
nt = await LE("notify.list", {}); ok("another team's lead is not told", !(nt.alerts || []).some((a) => a.name === "Arun Agent"));
nt = await SA("notify.list", {}); al = (nt.alerts || []).find((a) => a.name === "Arun Agent");
ok("the VP sees it in the bell, without the pop-up", al && al.popup === false && nt.items.some((x) => x.key === "shastra_missing"), al);
nt = await AR("notify.list", {}); ok("billers get no alerts", !(nt.alerts || []).length);
r = await TI("team.alertSnooze", { user_id: U("Arun Agent").id, minutes: 30 }); ok("Remind me in 30 min", r.ok && r.until_at > Date.now() + 29 * 60000);
nt = await TI("notify.list", {}); al = (nt.alerts || []).find((a) => a.name === "Arun Agent");
ok("snoozed: no pop-up for 30 minutes, still in the bell", al && al.popup === false && al.snoozed === true, al);
await sql("UPDATE shastra_alerts SET until_at = ? WHERE state = 'snoozed'", Date.now() - 1000);
nt = await TI("notify.list", {}); ok("after the 30 minutes it pops up again", (nt.alerts || []).some((a) => a.name === "Arun Agent" && a.popup));
r = await T(() => AR("team.shareOut", { user_id: U("Arun Agent").id })); ok("billers cannot reallocate", !r.ok, r);
r = await T(() => LE("team.shareOut", { user_id: U("Arun Agent").id })); ok("another team's lead cannot reallocate", !r.ok, r);

S("Reallocate equally, mark out, tell the billers");
r = await TI("team.shareOut", { user_id: U("Arun Agent").id });
ok("6 claims shared equally: 3 to Gita, 3 to Dev; Arun marked out", r.moved === 6 && r.left === 0 && r.to.length === 2 && r.to.every((x) => x.count === 3) && r.marked_out === true, r);
h = await TI("team.huddle", {});
ok("Arun is out today with the reason; Gita and Dev have the claims", row(h, "Arun Agent").status === "out" && /Not logged in to Shastra/.test(row(h, "Arun Agent").out.reason) && row(h, "Arun Agent").on_desk === 0 && row(h, "Gita Agent").on_desk === 3 && row(h, "Dev Agent").on_desk === 3, h.rows.map((x) => [x.name, x.status, x.on_desk]));
const hi = await DB.prepare("SELECT assigned_to FROM claims WHERE id IN (?, ?)").bind(open[0].id, open[1].id).all();
ok("the two high priority claims went one to each", new Set((hi.results || []).map((x) => x.assigned_to)).size === 2, hi.results);
nt = await TI("notify.list", {}); ok("no more alert once they are out", !(nt.alerts || []).some((a) => a.name === "Arun Agent"));
nt = await GI("notify.list", {});
ok("Gita is told: 3 new claims, from Arun's desk, shared by Tina", (nt.alloc_new || []).length === 1 && nt.alloc_new[0].n === 3 && /from Arun Agent's desk \(not logged in today\), shared equally by Tina Lead/.test(nt.alloc_new[0].text), nt.alloc_new);
ok("and it is in her bell", nt.items.some((x) => /3 new claims were allocated to you/.test(x.text)));
r = await GI("notify.seen", { ids: nt.alloc_new.map((x) => x.id) }); nt = await GI("notify.list", {});
ok("OK clears the banner (the bell keeps it)", !(nt.alloc_new || []).length && nt.items.some((x) => /3 new claims/.test(x.text)));
ok("the move is in the audit trail", (await A("audit.list", {})).rows.some((x) => x.action === "team.rebalance" && /Arun Agent \(not logged in\): 6 claims shared equally/.test(x.detail)));
const more = (await A("claims.list", { client_id: sunrise.id, state: "open", page_size: 100 })).rows;
await TI("alloc.reassign", { ids: more.slice(0, 2).map((c) => c.id), user_id: U("Gita Agent").id });
nt = await GI("notify.list", {});
ok("any allocation tells the biller: 2 new claims by Tina", (nt.alloc_new || []).some((x) => x.n === 2 && /allocated to you by Tina Lead/.test(x.text)), nt.alloc_new);

S("They told me: dismissed for the day, for everyone");
liveRows = liveRows.map((x) => x.emp_id === "A3" ? { ...x, status: "" } : x); await fresh();
nt = await TI("notify.list", {}); ok("Cara (no punch now, no leave) is not logged in", (nt.alerts || []).some((a) => a.name === "Cara Agent" && a.popup), nt.alerts);
r = await TI("team.alertDismiss", { user_id: U("Cara Agent").id }); ok("dismissed", r.ok);
nt = await TI("notify.list", {}); ok("no more alert about Cara today", !(nt.alerts || []).some((a) => a.name === "Cara Agent"));
nt = await SA("notify.list", {}); ok("for the VP either", !(nt.alerts || []).some((a) => a.name === "Cara Agent"));
r = await T(() => AR("team.alertDismiss", { user_id: U("Cara Agent").id })); ok("billers cannot dismiss", !r.ok, r);

S("Rebalance (someone marked out): the same equal rule");
await TI("team.setOut", { user_id: U("Arun Agent").id, out: false });
liveRows = liveRows.map((x) => x.emp_id === "A1" ? { ...x, status: "present", in_at: new Date(now0 - 60 * 60000).toISOString() } : x); await fresh();
const five = (await A("claims.list", { client_id: sunrise.id, state: "open", page_size: 100 })).rows.slice(0, 5);
await TI("alloc.reassign", { ids: five.map((c) => c.id), user_id: U("Dev Agent").id });
await TI("team.setOut", { user_id: U("Dev Agent").id, out: true, reason: "Sick" });
r = await TI("team.rebalance", { user_id: U("Dev Agent").id });
ok("Dev's 8 untouched claims split 4 and 4 between Arun and Gita (Cara and Kim are not in)", r.moved === 8 && r.to.length === 2 && r.to.every((x) => x.count === 4) && r.to.map((x) => x.name).sort().join() === "Arun Agent,Gita Agent", r);

S("Without the live feed: Live status as before");
liveOn = false; await fresh();
h = await TI("team.huddle", {});
ok("no Shastra column data, and it says why", h.shastra_state === "not_set_up" && h.rows.every((x) => x.shastra === null), h.shastra_state);
nt = await TI("notify.list", {}); ok("no alerts", !(nt.alerts || []).length);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
