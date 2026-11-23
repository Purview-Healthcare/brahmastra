/* Suite 54 (core release): the independent check of the owner's basic workflow, live against the release.
   CW-01: someone on a location's own team who no longer works the client (Purview Shastra moved them, a share was taken back or
   made view only) is never planned for the location's claims: the allocation hands every claim to the people who do, and the
   result on screen is what was given. A stand-in for Purview Shastra's roster; made-up people and data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project) => P({ emp_id, name, project, reports_to: lead, email: mail(name) });
/* Tina leads Sunrise (Arun, Bela), Leo leads Lakeview (Dev). */
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE),
];
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
  return new Response("nope", { status: 500 });
};
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
const TI = as(TOK["Tina Lead"]);
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN);
const downtown = sun.locations.find((l) => l.name === "Downtown");
const team = async (loc = downtown) => (await TI("team.today", { client_id: sun.id, location_id: loc ? loc.id : undefined })).members.map((m) => m.name).sort();
const allocNotices = async (who) => (await q1("SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ? AND kind = 'alloc'", U(who))).n;
const made = (prefix, n) => Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(7300000 + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (i + 1),
  payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", cpt: "99213" }; });

S("CW-01: a location's own team, after Purview Shastra moves one of its billers to another client and its team lead takes her off the client");
{
  await TI("clients.saveTeam", { location_id: downtown.id, team: [U("Arun Agent"), U("Bela Agent")] });
  const before = await team();
  ok("set-up: Downtown's own team is Arun and Bela, and the day's team lists both", JSON.stringify(before) === JSON.stringify(["Arun Agent", "Bela Agent"]), before);
  // Shastra moves Bela to Lakeview under Leo; the hourly sync takes it
  Object.assign(FEED.find((f) => f.name === "Bela Agent"), { project: LAKE, reports_to: "Leo Lead" });
  await A("roster.syncShastra");
  // since 2.116.0 (the owner's rule) nothing automatic takes anyone off a client: she stays on Sunrise's billers until Tina takes her off
  const sunT = JSON.parse((await q1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json);
  ok("2.116.0: after the move Bela is still on Sunrise's billers", sunT.includes(U("Bela Agent")), sunT);
  await TI("clients.saveTeam", { client_id: sun.id, base: sunT, team: sunT.filter((x) => x !== U("Bela Agent")) });
  const after = await team();
  ok("CW-01: the day's team for Downtown leaves Bela out: she no longer works Sunrise", JSON.stringify(after) === JSON.stringify(["Arun Agent"]), after);
  ok("the client's own team (no location picked) leaves her out too, as before", !(await team(null)).includes("Bela Agent"));
  // the next file for Downtown, loaded with its automatic allocation (on by default): only this file's claims in the pool
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND location_id = ? AND state = 'open'", sun.id, downtown.id);
  const bela0 = await allocNotices("Bela Agent");
  const rows = made("CW1", 6);
  app.setToken(TOK["Tina Lead"]);
  await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "CW-01 Downtown.xlsx", claims: rows, summary: {}, rows_read: 6 });
  app.setToken(TOK["Tina Lead"]);
  const al = await app.autoAllocate({ client: (await TI("clients.list")).clients.find((c) => c.id === sun.id), loc: downtown });
  const given = (al.perUser || []).filter((u) => u.count).map((u) => u.name + " " + u.count);
  const got = await q(`SELECT c.state, u.name FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.claim_no IN (${rows.map(() => "?").join(",")})`, ...rows.map((r) => r.claim_no));
  ok("CW-01: the allocation gives all 6 to Arun, and what it says it gave is what he has", al.applied === 6 && JSON.stringify(given) === JSON.stringify(["Arun Agent 6"]) && got.every((c) => c.state === "assigned" && c.name === "Arun Agent"), [al.applied, given, got]);
  ok("CW-01: none of the file's claims is left in the pool", !got.some((c) => c.state === "open"));
  ok("CW-01: Bela is told of no new claims", (await allocNotices("Bela Agent")) === bela0);
}

S("CW-01: someone on a location's team by a share of the client (not on its roster project)");
{
  // Dev (Lakeview) helps Sunrise: an edit share, and Tina puts him on Downtown's team
  await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "edit" });
  await TI("clients.saveTeam", { location_id: downtown.id, team: [U("Arun Agent"), U("Dev Agent")] });
  ok("with a share to edit he is on the day's team (he may be given Sunrise's claims)", JSON.stringify(await team()) === JSON.stringify(["Arun Agent", "Dev Agent"]), await team());
  await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "view" });
  ok("the share made view only: he is left out (a view-only share never puts claims on a list)", JSON.stringify(await team()) === JSON.stringify(["Arun Agent"]), await team());
  await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "edit" });
  ok("to edit again: he is back on the day's team", (await team()).includes("Dev Agent"));
  await TI("clients.accessRemove", { client_id: sun.id, user_id: U("Dev Agent") });
  ok("the share taken back: he is left out", JSON.stringify(await team()) === JSON.stringify(["Arun Agent"]), await team());
}

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
process.exit(failed.length ? 1 : 0);
