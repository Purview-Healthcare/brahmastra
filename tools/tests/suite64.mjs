/* Suite 64: a biller a team lead adds to a client by hand (their Purview Shastra project is another client) stays on it through
   the hourly roster copy, so the claims given to them stay on their own My day; taken off by hand, they leave. The owner's case: the
   NAEC billers added by hand lost sight of their 44 claims an hour later while Live status still counted them. (Origin: suite 54.)
   The owner's rule since: whoever a team lead puts on a client stays on it until a team lead takes them off, whatever Purview
   Shastra says about them later (another department, switched off for a while, moved to another project), and also when the
   roster takes over an account made by hand or a Shastra project is matched to a client that had none. Only the people Shastra
   brought in come and go with Shastra.
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


const SUNTEAM = async () => parseTeam((await q1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json);
const parseTeam = (t) => { try { const v = JSON.parse(t || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const ready = async (who) => ((await as(TOK[who])("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 })).ready || {}).n || 0;
S("A team lead adds a biller of another project by hand, and allocates");
{
  await TI("clients.saveTeam", { location_id: downtown.id, team: [] });   // Downtown takes the client's own team
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND state = 'open'", sun.id);
  const before = await SUNTEAM();
  await TI("clients.saveTeam", { client_id: sun.id, team: [...before, U("Dev Agent")] });
  ok("set-up: Dev (Lakeview in Shastra) is on Sunrise's billers, added by hand", (await SUNTEAM()).includes(U("Dev Agent")));
  const rows = made("HB", 9);
  app.setToken(TOK["Tina Lead"]);
  await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "S64.xlsx", claims: rows, summary: {}, rows_read: 9 });
  app.setToken(TOK["Tina Lead"]);
  const al = await app.autoAllocate({ client: (await TI("clients.list")).clients.find((c) => c.id === sun.id), loc: downtown });
  const dev = (al.perUser || []).find((u) => u.name === "Dev Agent");
  ok("the allocation gives Dev his share", al.applied === 9 && dev && dev.count === 3, al.perUser);
  ok("...and Dev sees those 3 on his My day", (await ready("Dev Agent")) === 3, await ready("Dev Agent"));
}
S("The hourly roster copy from Purview Shastra");
{
  await A("roster.syncShastra");
  ok("Dev is still on Sunrise's billers after the hourly copy", (await SUNTEAM()).includes(U("Dev Agent")), await SUNTEAM());
  ok("...and still sees his 3 claims (they are not hidden from him)", (await ready("Dev Agent")) === 3, await ready("Dev Agent"));
  ok("...and is still on the day's team for the next allocation", (await TI("team.today", { client_id: sun.id })).members.some((m) => m.name === "Dev Agent"));
  await A("roster.syncShastra");
  ok("a second copy changes nothing", (await SUNTEAM()).includes(U("Dev Agent")) && (await ready("Dev Agent")) === 3);
}
S("Taken off by hand, he leaves (and his claims go back to the pool)");
{
  await TI("clients.saveTeam", { client_id: sun.id, team: (await SUNTEAM()).filter((x) => x !== U("Dev Agent")) });
  await A("roster.syncShastra");
  ok("off Sunrise's billers, and the hourly copy does not bring him back", !(await SUNTEAM()).includes(U("Dev Agent")));
  ok("his unworked claims went back to the pool", (await ready("Dev Agent")) === 0 && (await q1("SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE 'HB-%' AND state = 'open' AND assigned_to IS NULL")).n === 3);
}
S("Billers whose Shastra project is the client are unchanged");
{
  ok("Arun (Sunrise in Shastra) stays on Sunrise's billers as before", (await SUNTEAM()).includes(U("Arun Agent")));
}
const feed = (n) => FEED.find((f) => f.name === n);
const idOf = async (n) => (await q1("SELECT id FROM users WHERE name = ?", n)).id;
S("Whatever Shastra says about him later, a biller a team lead adds stays until a team lead takes him off");
{
  await TI("clients.saveTeam", { client_id: sun.id, team: [...await SUNTEAM(), U("Dev Agent")] });
  feed("Dev Agent").department = "Posting"; await A("roster.syncShastra");
  ok("Shastra moves Dev to Payment posting: still on Sunrise's billers", (await SUNTEAM()).includes(U("Dev Agent")), await SUNTEAM());
  feed("Dev Agent").department = "AR"; feed("Dev Agent").status = "Inactive"; await A("roster.syncShastra");
  ok("set-up: Shastra switched him off for a while", !(await q1("SELECT active FROM users WHERE id = ?", U("Dev Agent"))).active);
  ok("...he is still on Sunrise's billers", (await SUNTEAM()).includes(U("Dev Agent")), await SUNTEAM());
  await TI("clients.saveTeam", { client_id: sun.id, team: await SUNTEAM(), auto_allocate: true });
  ok("...and Tina saving the list meanwhile (for something else) keeps him", (await SUNTEAM()).includes(U("Dev Agent")), await SUNTEAM());
  feed("Dev Agent").status = "Working"; await A("roster.syncShastra");
  ok("back on in Shastra: on Sunrise's billers and on the day's team for the next allocation", (await SUNTEAM()).includes(U("Dev Agent"))
    && (await TI("team.today", { client_id: sun.id })).members.some((m) => m.name === "Dev Agent"));
}
S("Someone Shastra had on the client whom a team lead adds by hand stays when Shastra moves them");
{
  await sql("UPDATE clients SET team_json = ? WHERE id = ?", JSON.stringify((await SUNTEAM()).filter((x) => x !== U("Bela Agent"))), sun.id);   // not copied over yet
  await TI("clients.saveTeam", { client_id: sun.id, team: [...await SUNTEAM(), U("Bela Agent")] });
  feed("Bela Agent").project = LAKE; await A("roster.syncShastra");
  ok("Bela, added by Tina, stays on Sunrise when Shastra moves her to Lakeview", (await SUNTEAM()).includes(U("Bela Agent")), await SUNTEAM());
  ok("...and still sees her 3 Sunrise claims", (await ready("Bela Agent")) === 3, await ready("Bela Agent"));
}
S("An account made by hand and put on the client stays when the roster takes it over");
{
  const faye = (await A("users.save", { first_name: "Faye", last_name: "Helper", email: mail("Faye Helper"), role: "user", designation: "Biller", capacity: 35 })).user;
  await TI("clients.saveTeam", { client_id: sun.id, team: [...await SUNTEAM(), faye.id] });
  FEED.push(AG("A5", "Faye Helper", "Leo Lead", LAKE)); await A("roster.syncShastra");
  const now = await q1("SELECT source FROM users WHERE id = ?", faye.id);
  ok("set-up: the roster took Faye's account over (Lakeview in Shastra)", now && now.source === "roster", now);
  ok("Faye stays on Sunrise's billers", (await SUNTEAM()).includes(faye.id), await SUNTEAM());
}
S("A client with no Shastra project keeps its team when a Shastra project is matched to it");
{
  const sup = users.find((u) => u.email === "supervisor@purview-healthcare.com").id;
  await A("clients.save", { name: "Hilltop Clinic", code: "HIL", follow_up_days: 30, active: true, locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: sup } } } });
  const other = await q1("SELECT id, name, roster_names_json FROM clients WHERE name = 'Hilltop Clinic'");
  ok("set-up: a client with no Shastra project", other && !JSON.parse(other.roster_names_json || "[]").length, other);
  await sql("UPDATE clients SET team_json = ?, team_hand_json = '[]' WHERE id = ?", JSON.stringify([U("Dev Agent")]), other.id);   // its team, made before this
  await A("roster.syncShastra");   // the hourly copy notes them as put on by hand
  FEED.push(AG("A6", "Gus Agent", "Leo Lead", other.name)); await A("roster.syncShastra");   // a Shastra project of that name: matched by itself
  const row = await q1("SELECT team_json, roster_names_json FROM clients WHERE id = ?", other.id), t = parseTeam(row.team_json);
  ok("set-up: Shastra's new project is matched to " + other.name, JSON.parse(row.roster_names_json || "[]").length === 1, row.roster_names_json);
  ok("Dev, put on it before it had a Shastra project, stays", t.includes(U("Dev Agent")), t);
  ok("...next to the project's own people", t.includes(await idOf("Gus Agent")), t);
}
S("The people only Shastra brought in still come and go with Shastra");
{
  feed("Arun Agent").project = LAKE; await A("roster.syncShastra");
  ok("Arun leaves Sunrise when Shastra moves him to Lakeview", !(await SUNTEAM()).includes(U("Arun Agent")), await SUNTEAM());
  const st = await SUNTEAM();
  ok("...while the people Tina put on it stay (Dev, Bela, Faye)", [U("Dev Agent"), U("Bela Agent"), await idOf("Faye Helper")].every((x) => st.includes(x)), st);
}
const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
