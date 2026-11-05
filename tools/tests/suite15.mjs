// The Dashboard: claims and the team in one place.
// Team leads see their own team; managers and above can pick one team lead (and see billers grouped by team lead).
// Today: the live floor with left over split into high priority and other, closed today, Out today. Other dates: each
// biller's totals against their target for the weekdays they were in. Claims: the inventory as of now and the activity
// for the dates; a team lead picked narrows the claims to that team lead's clients.
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "M2", name: "Sandesh Manager", position: "Manager", reports_to: "Sasha Vice", email: "sandesh@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Sandesh Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cara Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "cara@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Snail Post", department: "Posting", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "snail@purview-healthcare.com" }),
];
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const VP = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"),
  AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sunrise = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const saag = { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" };
const note = { source: "Web", findings: "In process per the payer portal", action: "follow up later" };
let r;

S("Setting the floor");
const sun = (await TI("claims.list", { client_id: sunrise.id, state: "open", page_size: 12 })).rows;
await TI("alloc.reassign", { ids: sun.slice(0, 8).map((c) => c.id), user_id: U("Arun Agent").id });
await TI("alloc.reassign", { ids: sun.slice(8, 12).map((c) => c.id), user_id: U("Cara Agent").id });
const lk = (await LE("claims.list", { client_id: lake.id, state: "open", page_size: 5 })).rows;
await LE("alloc.reassign", { ids: lk.map((c) => c.id), user_id: U("Bela Agent").id });
for (const c of sun.slice(0, 3)) await AR("queue.complete", { id: c.id, saag, note });
await BE("queue.complete", { id: lk[0].id, saag, note });
// one of Arun's closes today
await sql("UPDATE claims SET state = 'closed', completed_at = ? WHERE id = ?", Date.now() - 60000, sun[0].id);
// Arun's other five were allocated yesterday: left over today, two of them High
const leftIds = sun.slice(3, 8).map((c) => c.id);
await sql(`UPDATE claims SET assigned_at = ?, tier = 'Medium' WHERE id IN (${leftIds.map(() => "?").join(",")})`, Date.now() - 86400000, ...leftIds);
await sql(`UPDATE claims SET tier = 'High' WHERE id IN (?, ?)`, leftIds[0], leftIds[1]);
ok("set up", true);

S("Who can pick a team lead");
r = await VP("team.leads");
ok("the VP can pick, and sees every team lead", r.can_pick_lead && r.leads.map((l) => l.name).sort().join() === "Leo Lead,Tina Lead", r);
r = await JO("team.leads");
ok("a manager sees only the team leads in their span", r.can_pick_lead && r.leads.map((l) => l.name).join() === "Tina Lead", r);
r = await TI("team.leads");
ok("a team lead has no team lead filter", !r.can_pick_lead && !r.leads.length, r);
r = await T(async () => TI("team.huddle", { lead_id: U("Leo Lead").id }));
ok("a team lead cannot ask for another team lead's team", !r.ok, r);
r = await T(async () => JO("team.huddle", { lead_id: U("Leo Lead").id }));
ok("a manager cannot pick a team lead outside their span", !r.ok, r);
r = await T(async () => AR("team.huddle", {}));
ok("billers cannot open the Dashboard's team part", !r.ok, r);

S("Today: the live floor");
r = await VP("team.huddle", {});
const names = r.rows.map((x) => x.name).sort().join();
ok("AR billers, not the Posting desk person", ["Arun Agent", "Bela Agent", "Cara Agent"].every((n) => names.includes(n)) && !names.includes("Snail Post"), names);
ok("each row carries its team lead", r.rows.find((x) => x.name === "Arun Agent").lead_name === "Tina Lead" && r.rows.find((x) => x.name === "Bela Agent").lead_name === "Leo Lead", r.rows.map((x) => [x.name, x.lead_name]));
const arun = r.rows.find((x) => x.name === "Arun Agent");
ok("left over: 5, of which 2 high priority and 3 other", arun.carried === 5 && arun.left_high === 2 && arun.left_other === 3, { carried: arun.carried, high: arun.left_high, other: arun.left_other });
ok("closed today counts the claim Arun closed", arun.closed === 1, arun.closed);
ok("worked this shift: 3 entries", arun.worked === 3, arun.worked);
ok("totals add up: left over and high priority", r.totals.carried >= 5 && r.totals.left_high >= 2 && r.totals.closed === 1, r.totals);
r = await VP("team.huddle", { lead_id: U("Tina Lead").id });
ok("picking Tina Lead shows only her billers", r.rows.map((x) => x.name).sort().join() === "Arun Agent,Cara Agent", r.rows.map((x) => x.name));
r = await TI("team.huddle", {});
ok("a team lead sees their own team", r.rows.map((x) => x.name).sort().join() === "Arun Agent,Cara Agent", r.rows.map((x) => x.name));
r = await VP("team.huddle", { client_id: lake.id });
ok("a client picked: the people working it", r.rows.map((x) => x.name).join() === "Bela Agent", r.rows.map((x) => x.name));

S("Claims: the inventory now, a team lead's clients");
const all = await VP("claims.stats", {}), tina = await VP("claims.stats", { lead_id: U("Tina Lead").id });
ok("picking Tina Lead narrows the claims to her clients", tina.by_location.length && tina.by_location.every((x) => x.client_id === sunrise.id) && all.by_location.some((x) => x.client_id === lake.id), tina.by_location.map((x) => x.client_name));
r = await T(async () => TI("claims.stats", { lead_id: U("Leo Lead").id }));
ok("a team lead cannot narrow to another team lead's clients", !r.ok, r);
const now = Date.now(), dayAgo = now - 12 * 3600000;
r = await VP("team.activity", { from_ms: dayAgo, to_ms: now + 1000 });
ok("activity: entries worked and claims closed in the dates", r.worked === 4 && r.claims_worked === 4 && r.closed_n === 1, r);
r = await VP("team.activity", { from_ms: dayAgo, to_ms: now + 1000, lead_id: U("Tina Lead").id });
ok("activity for Tina Lead's clients only", r.worked === 3 && r.closed_n === 1, r);
r = await T(async () => AR("team.activity", {}));
ok("billers cannot read it", !r.ok, r);

S("A week: totals against target");
// Monday to Wednesday of a fixed week; Cara was out on the Tuesday; Arun has two entries on Monday too
const mon = "2026-11-02", tue = "2026-11-03", wed = "2026-11-04";
await sql("INSERT INTO attendance (user_id, day, status, reason, by_name, at) VALUES (?,?,?,?,?,?)", U("Cara Agent").id, tue, "out", "Sick", "Tina Lead", Date.now());
const monMs = Date.parse(mon + "T10:00:00Z");
await sql("UPDATE notes SET created_at = ? WHERE rowid IN (SELECT rowid FROM notes WHERE user_id = ? AND kind = 'work' LIMIT 2)", monMs, U("Arun Agent").id);
// his third entry was written when the suite ran: pin it to the Wednesday so the week reads the same on any day
await sql("UPDATE notes SET created_at = ? WHERE user_id = ? AND kind = 'work' AND created_at != ?", Date.parse(wed + "T10:00:00Z"), U("Arun Agent").id, monMs);
r = await VP("team.range", { from: mon, to: wed, today: wed, tz_offset_min: 0 });
const aw = r.rows.find((x) => x.name === "Arun Agent"), cw = r.rows.find((x) => x.name === "Cara Agent");
ok("three weekdays", r.workdays === 3, r.workdays);
ok("Arun: 3 entries, 3 days in, target 105", aw && aw.worked === 3 && aw.days_in === 3 && aw.target === 105 && aw.pct === 3, aw);
ok("Arun worked on 2 different days", aw && aw.days_worked === 2, aw && aw.days_worked);
ok("Cara: out one day, so 2 days in and target 70", cw && cw.days_out === 1 && cw.days_in === 2 && cw.target === 70, cw);
ok("rows carry their team lead", aw.lead_name === "Tina Lead", aw.lead_name);
r = await VP("team.range", { from: mon, to: wed, today: wed, tz_offset_min: 0, lead_id: U("Leo Lead").id });
ok("a team lead picked: only their billers", r.rows.map((x) => x.name).join() === "Bela Agent", r.rows.map((x) => x.name));
r = await T(async () => VP("team.range", { from: wed, to: mon }));
ok("dates the wrong way round are refused", !r.ok, r);
r = await VP("team.range", { from: "2026-11-07", to: "2026-11-08", today: "2026-11-09", tz_offset_min: 0 });
ok("a weekend has no target days", r.workdays === 0 && r.rows.every((x) => x.target === 0 && x.pct == null), r.rows.map((x) => [x.name, x.target]));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
