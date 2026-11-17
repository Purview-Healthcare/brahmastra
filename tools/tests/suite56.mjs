/* Suite 56: things earlier fixers saw and left (R4-A to R4-H). A made-up floor through a stand-in for Purview Shastra's roster:
   Mona Manager over Tina Lead (AR, Sunrise Eye Care), Leo Lead (AR, Lakeview Dental Group), Pia Poster (Payment posting team
   lead, Sunrise) and Sam Submitter (Submission team lead, Sunrise); Arun Agent and Bela Agent are Tina's billers, Dev Agent Leo's,
   Paula Post is on Pia's desk and Sana Sub on Sam's. Checks named "R4-X: ...". Made-up people and data only. */
import { makeRig } from "./rig.mjs";
import fs from "fs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", project: SUN, also_on_projects: LAKE, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "T3", name: "Pia Poster", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Pia Poster") }),
  P({ emp_id: "T4", name: "Sam Submitter", position: "Team Lead", department: "Submission", project: SUN, reports_to: "Mona Manager", email: mail("Sam Submitter") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE),
  AG("D1", "Paula Post", "Pia Poster", SUN, { department: "Posting" }), AG("S1", "Sana Sub", "Sam Submitter", SUN, { department: "Submission" }),
];
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const app = rig.app;
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const q1 = async (s, ...a) => (await q(s, ...a))[0];
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {}, R = {};
for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); TOK[f.name] = (await login(f.email, "pw-" + f.email)).token; R[f.name] = as(TOK[f.name]); }
const TI = R["Tina Lead"], LEO = R["Leo Lead"], PIA = R["Pia Poster"], SAM = R["Sam Submitter"], MONA = R["Mona Manager"], AR = R["Arun Agent"];
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN), lake = clients.find((c) => c.name === LAKE);
const FOLLOW = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal, check again later" } };
const poolOf = async (n, clientId) => (await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL ORDER BY id LIMIT ?", clientId, n)).map((x) => x.id);
const give = (ids, who, by, clientId) => by("alloc.apply", { client_id: clientId, strategy: "smart", assignments: ids.map((id) => ({ id, user_id: U(who), priority: 50, tier: "Medium" })) });
const made = (prefix, n) => Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(7600000 + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (i + 1),
  payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", cpt: "99213" }; });
const src = fs.readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../../README.md", import.meta.url), "utf8");

S("R4-A: a Payment posting or Submission team lead manages only their own desk's people");
// an AR entry (with call minutes) by Arun on Sunrise, so the productivity and call time lists have something of the AR floor
app.setToken(TOK["Tina Lead"]);
await app.uploadClaims({ client_id: sun.id, location_id: null, kind: "fresh", file_name: "R4 inventory.xlsx", claims: made("R4", 12), summary: {}, rows_read: 12 });
const arIds = await poolOf(4, sun.id); await give(arIds, "Arun Agent", TI, sun.id);
await AR("queue.open", { id: arIds[0] }); await AR("queue.complete", { id: arIds[0], ...FOLLOW, desk: true });
await sql("UPDATE notes SET call_min = 12 WHERE claim_id = ? AND kind = 'work'", arIds[0]);
const code = (who, by) => tryOp(() => by("users.loginCode", { id: U(who) }));
const reset = async (who, by) => tryOp(async () => by("users.resetPassword", { id: U(who), passHash: await sha("temp-" + who) }));
const edit = (who, by) => tryOp(() => by("users.save", { id: U(who), capacity: 30 }));
for (const [lead, by, mate, other] of [["Pia Poster", PIA, "Paula Post", "Sana Sub"], ["Sam Submitter", SAM, "Sana Sub", "Paula Post"]]) {
  let r = await code("Arun Agent", by);
  ok(`R4-A: ${lead} cannot get a sign-in code for Arun Agent (an AR biller on the same project)`, !r.ok && /not on your team/.test(r.e), r);
  r = await reset("Arun Agent", by);
  ok(`R4-A: ${lead} cannot reset Arun Agent's password`, !r.ok && /not on your team/.test(r.e), r);
  r = await edit("Arun Agent", by);
  ok(`R4-A: ${lead} cannot edit Arun Agent's account (or switch him off)`, !r.ok && /not on your team/.test(r.e), r);
  r = await tryOp(() => by("users.save", { id: U("Arun Agent"), active: false }));
  ok(`R4-A: ${lead} cannot switch Arun Agent off`, !r.ok && (await q1("SELECT active FROM users WHERE id = ?", U("Arun Agent"))).active === 1, r);
  r = await code(other, by);
  ok(`R4-A: ${lead} cannot get a sign-in code for ${other} (the other desk)`, !r.ok && /not on your team/.test(r.e), r);
  r = await code(mate, by);
  ok(`R4-A: ${lead} still gets a sign-in code for ${mate} (their own desk)`, r.ok && /^\d+$/.test(String(r.r.code)), r);
  r = await reset(mate, by);
  ok(`R4-A: ${lead} still resets ${mate}'s password`, r.ok, r);
  r = await edit(mate, by);
  ok(`R4-A: ${lead} still edits ${mate}'s account`, r.ok, r);
  const list = (await by("users.list")).users, row = (n) => list.find((u) => u.name === n) || {};
  ok(`R4-A: ${lead}'s Team list shows Arun Agent as on another team, ${mate} as theirs`, row("Arun Agent").in_span === false && row("Bela Agent").in_span === false && row(mate).in_span === true, [row("Arun Agent").in_span, row(mate).in_span]);
  const prod = (await by("supervisor.productivity", { from_ms: 0, to_ms: Date.now() + 60000 })).rows;
  ok(`R4-A: ${lead}'s Productivity has no AR biller's entries`, !prod.some((x) => x.user_id === U("Arun Agent")), prod);
  const ct = await by("supervisor.callTime", { from_ms: 0, to_ms: Date.now() + 60000 });
  ok(`R4-A: ${lead}'s Time on calls has no AR biller's calls`, !ct.by_user.some((x) => x.user_id === U("Arun Agent")) && !ct.total.minutes, ct);
}
// AR team leads, managers, the VP and the admin are unchanged
let r0 = await code("Arun Agent", TI);
ok("R4-A: Tina Lead (AR) still gets a sign-in code for her biller Arun Agent", r0.ok, r0);
r0 = await code("Paula Post", TI);
ok("R4-A: Tina Lead (AR) still gets one for Paula Post on her project, as before", r0.ok, r0);
r0 = await code("Arun Agent", MONA);
ok("R4-A: Mona Manager still gets a sign-in code for Arun Agent", r0.ok, r0);
r0 = await code("Arun Agent", A);
ok("R4-A: the admin still gets a sign-in code for Arun Agent", r0.ok, r0);
const tiProd = (await TI("supervisor.productivity", { from_ms: 0, to_ms: Date.now() + 60000 })).rows;
ok("R4-A: Tina Lead's Productivity still has Arun Agent's entries", tiProd.some((x) => x.user_id === U("Arun Agent")), tiProd);
const tiCt = await TI("supervisor.callTime", { from_ms: 0, to_ms: Date.now() + 60000 });
ok("R4-A: Tina Lead's Time on calls still has Arun Agent's calls", tiCt.by_user.some((x) => x.user_id === U("Arun Agent")) && tiCt.total.minutes === 12, tiCt);

S("R4-B: moving inside the app with an entry typed asks first");
ok("R4-B: the app's go() (the menu, the bell, Ctrl+K, links) asks the top typed form or pop-up before moving, as Back and Forward do",
  /const go = useCallback\(\(view, params\) => \{\s*const g = typedLayerFor\(/.test(src) && /if \(g\) \{ g\.ask\(\(\) => goNow\(view, params\)\); return; \}/.test(src));
ok("R4-B: Back and Forward, once Discard is pressed, move without asking again", /g\.ask\(\(\) => goNow\(h\.view, h\.params\)\)/.test(src));
ok("R4-B: README says the menu, the bell and Ctrl+K ask too", /the menu, the bell, Ctrl\+K, Back and Forward ask first/.test(readme));

S("R4-C: losing a client another way gives its claims on the person's list back to the pool");
app.setToken(TOK["Leo Lead"]);
await app.uploadClaims({ client_id: lake.id, location_id: null, kind: "fresh", file_name: "R4 lake inventory.xlsx", claims: made("LK", 12), summary: {}, rows_read: 12 });
const onList = async (who, cid) => (await q("SELECT id FROM claims WHERE assigned_to = ? AND client_id = ? AND state IN ('assigned','in_progress')", U(who), cid)).map((x) => x.id);
const noticeOf = async (who, cid) => (await q("SELECT text FROM user_notices WHERE user_id = ? AND client_id = ? AND text LIKE '%taken off your list%'", U(who), cid)).map((x) => x.text);
// 1. a team lead takes someone off a client's team (clients.saveTeam)
const sunTeam = async () => (await q1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json;
const team0 = JSON.parse(await sunTeam()).map((x) => (typeof x === "string" ? x : x.id));
await TI("clients.saveTeam", { client_id: sun.id, team: [...team0, U("Dev Agent")] });
const devIds = await poolOf(2, sun.id); await give(devIds, "Dev Agent", TI, sun.id);
ok("R4-C: set-up: Dev Agent (Lakeview) is put on Sunrise's team and given 2 of its claims", (await onList("Dev Agent", sun.id)).length === 2);
const arunHeld = (await onList("Arun Agent", sun.id)).length;
await TI("clients.saveTeam", { client_id: sun.id, team: team0.filter((x) => x !== U("Arun Agent")) });
ok("R4-C: taking Dev Agent off Sunrise's team gives its claims on his list back to the pool", (await onList("Dev Agent", sun.id)).length === 0
  && (await q("SELECT id FROM claims WHERE id IN (SELECT value FROM json_each(?)) AND state = 'open' AND assigned_to IS NULL", JSON.stringify(devIds))).length === 2, await onList("Dev Agent", sun.id));
ok("R4-C: his bell says so", (await noticeOf("Dev Agent", sun.id)).length === 1, await noticeOf("Dev Agent", sun.id));
ok("R4-C: Arun Agent, taken off the team too but still on the project, keeps his", (await onList("Arun Agent", sun.id)).length === arunHeld && arunHeld > 0, arunHeld);
await TI("clients.saveTeam", { client_id: sun.id, team: team0 });
// 3. a changed responsibility takes the client away
await MONA("clients.saveResponsibility", { client_id: lake.id, dept: "ar", mode: "person", lead: U("Arun Agent") });
const lkIds = await poolOf(2, lake.id); await give(lkIds, "Arun Agent", MONA, lake.id);
ok("R4-C: set-up: Arun Agent is made AR responsible for Lakeview and given 2 of its claims", (await onList("Arun Agent", lake.id)).length === 2);
await MONA("clients.saveResponsibility", { client_id: lake.id, dept: "ar", mode: "person", lead: U("Dev Agent") });
ok("R4-C: AR responsibility moved to Dev Agent: Arun's Lakeview claims go back to the pool", (await onList("Arun Agent", lake.id)).length === 0, await onList("Arun Agent", lake.id));
ok("R4-C: Arun's bell says so", (await noticeOf("Arun Agent", lake.id)).length === 1);
ok("R4-C: his Sunrise claims stay on his list", (await onList("Arun Agent", sun.id)).length === arunHeld);
// 2. a roster project re-mapped to another client (Sunrise keeps another roster project, so its team follows the roster)
await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify([SUN, "Sunrise North"]), sun.id);
await A("projects.map", { name: SUN, client_id: lake.id });
ok("R4-C: re-mapping the roster project Sunrise Eye Care to Lakeview gives Arun's Sunrise claims back to the pool", (await onList("Arun Agent", sun.id)).length === 0, await onList("Arun Agent", sun.id));
ok("R4-C: Arun's bell says so", (await noticeOf("Arun Agent", sun.id)).length === 1);
await A("projects.map", { name: SUN, client_id: sun.id });
await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify([SUN]), sun.id);
const reIds = await poolOf(2, sun.id); await give(reIds, "Arun Agent", TI, sun.id);
await A("projects.map", { name: SUN, client_id: lake.id });
const sunAfter = JSON.parse((await q1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json);
ok("R4-C: Sunrise's only roster project re-mapped: the project's billers leave its team and give its claims back", (await onList("Arun Agent", sun.id)).length === 0 && !sunAfter.includes(U("Arun Agent")), [await onList("Arun Agent", sun.id), sunAfter.length]);
await A("projects.map", { name: SUN, client_id: sun.id });
ok("R4-C: matched back, the team is the project's again", JSON.parse((await q1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json).includes(U("Arun Agent")));

S("R4-D: a desk person whose share of a client is taken back gives up its open hand-offs");
await MONA("clients.saveResponsibility", { client_id: lake.id, dept: "posting", mode: "person", lead: U("Pia Poster") });
await MONA("clients.accessSave", { client_id: lake.id, user_id: U("Paula Post"), level: "edit" });
const hoClaims = await poolOf(3, lake.id), hnow = Date.now();
const HO = (id, claim, lead, backup, assigned, status) => sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id, backup_id, assigned_to, assigned_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  id, claim, lake.id, "posting", status, hnow, hnow + 86400000, lead, backup, assigned, assigned ? hnow : null);
await HO("ho-r4d-1", hoClaims[0], U("Pia Poster"), null, U("Paula Post"), "assigned");    // Pia's, given to Paula to work
await HO("ho-r4d-2", hoClaims[1], U("Paula Post"), U("Pia Poster"), null, "pending");      // Paula's, Pia the backup
await HO("ho-r4d-3", hoClaims[2], U("Pia Poster"), null, U("Paula Post"), "done");         // finished: stays as it was
const hoOf = (id) => q1("SELECT lead_id, backup_id, assigned_to, status FROM handoffs WHERE id = ?", id);
await MONA("clients.accessRemove", { client_id: lake.id, user_id: U("Paula Post") });
const h1 = await hoOf("ho-r4d-1"), h2 = await hoOf("ho-r4d-2"), h3 = await hoOf("ho-r4d-3");
ok("R4-D: the share taken back: the hand-off given to Paula Post is no longer hers (back on the desk, pending, with its lead)", h1.assigned_to === null && h1.status === "pending" && h1.lead_id === U("Pia Poster"), h1);
ok("R4-D: the hand-off Paula Post led goes to the backup, as when someone is switched off", h2.lead_id === U("Pia Poster") && h2.backup_id !== U("Paula Post"), h2);
ok("R4-D: a finished hand-off is left as it was", h3.assigned_to === U("Paula Post") && h3.status === "done", h3);
// the same for a share made view only
await MONA("clients.accessSave", { client_id: lake.id, user_id: U("Paula Post"), level: "edit" });
await sql("UPDATE handoffs SET assigned_to = ?, status = 'assigned' WHERE id = 'ho-r4d-1'", U("Paula Post"));
await MONA("clients.accessSave", { client_id: lake.id, user_id: U("Paula Post"), level: "view" });
const h1v = await hoOf("ho-r4d-1");
ok("R4-D: a share made view only: the hand-off given to her goes back too", h1v.assigned_to === null && h1v.status === "pending", h1v);
await MONA("clients.accessRemove", { client_id: lake.id, user_id: U("Paula Post") });
// someone who still works the client keeps theirs: Pia is responsible for it
await MONA("clients.accessSave", { client_id: lake.id, user_id: U("Pia Poster"), level: "edit" });
await sql("UPDATE handoffs SET assigned_to = ?, status = 'assigned' WHERE id = 'ho-r4d-1'", U("Pia Poster"));
await MONA("clients.accessRemove", { client_id: lake.id, user_id: U("Pia Poster") });
const h1p = await hoOf("ho-r4d-1");
ok("R4-D: Pia Poster, still responsible for Lakeview's posting, keeps the hand-off she was given", h1p.assigned_to === U("Pia Poster") && h1p.status === "assigned", h1p);

S("R4-E: the Stack report's reason box (Team player) refuses a long reason, never cuts it");
const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7), longWhy = "Helped the team clear the backlog every day this month. ".repeat(5).trim();
const tpLong = await tryOp(() => TI("stack.save", { month, user_id: U("Arun Agent"), field: "tp", value: "no", note: longWhy }));
ok("R4-E: a 279-character reason is refused with a message naming the box, and nothing is saved", !tpLong.ok && /The reason is too long: 279 characters, and it takes up to 200/.test(tpLong.e)
  && !(await q1("SELECT note FROM stack_typed WHERE subject_id = ? AND field = 'tp'", U("Arun Agent"))), tpLong);
const tpOk = await tryOp(() => TI("stack.save", { month, user_id: U("Arun Agent"), field: "tp", value: "no", note: longWhy.slice(0, 200) }));
ok("R4-E: 200 characters are kept whole", tpOk.ok && tpOk.r.note.length === 200, tpOk);

S("R4-F: README says what the code does about editing entries");
ok("R4-F: README no longer says entries can be edited for 24 hours, and says any time in both places", !/edited for 24\s+hours/.test(readme) && /can be edited at any\s+time by its author or a team lead/.test(readme) && /edited at any time\*\* by their author or a team lead \(no time\s+limit\)/.test(readme));
const wk = (await q("SELECT id, claim_id FROM notes WHERE user_id = ? AND kind = 'work' ORDER BY created_at LIMIT 1", U("Arun Agent")))[0];
await sql("UPDATE notes SET created_at = ? WHERE id = ?", Date.now() - 10 * 86400000, wk.id);
const ed = await tryOp(() => AR("notes.update", { id: wk.id, saag: FOLLOW.saag, note: { ...FOLLOW.note, findings: "Checked again ten days later: still in process at the payer" } }));
ok("R4-F: an entry ten days old can still be edited by its author (no time limit in the code)", ed.ok, ed);

S("R4-G: the desk dashboard's By person table keeps two people with the same name apart");
// a second Payment posting person named Paula Post (another Emp ID), each with work done on Sunrise
const twin = "twin-paula-r4g";
await sql("INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at, department, emp_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  twin, "paula.post.two@purview-healthcare.com", "Paula Post", "Paula", "Post", "Biller", "user", "", "", 0, 1, 35, Date.now(), "Posting", "D9");
const gClaims = await poolOf(3, sun.id), gnow = Date.now();
const done = (id, claim, by, name, at) => sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id, assigned_to, done_at, done_by, done_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  id, claim, sun.id, "posting", "complete", at - 3600000, at + 86400000, by, by, at, by, name);
await done("ho-r4g-1", gClaims[0], U("Paula Post"), "Paula Post", gnow - 60000);
await done("ho-r4g-2", gClaims[1], U("Paula Post"), "Paula Post", gnow - 50000);
await done("ho-r4g-3", gClaims[2], twin, "Paula Post", gnow - 40000);
const dash = await PIA("handoffs.dashboard", { dept: "posting", from_ms: gnow - 86400000, to_ms: gnow + 60000 });
const paulas = dash.by_person.filter((x) => x.name === "Paula Post");
ok("R4-G: two rows for the two Paula Posts (2 and 1 posted), not one row of 3", paulas.length === 2 && paulas.map((x) => x.completed).sort().join(",") === "1,2", dash.by_person);
ok("R4-G: each row carries the person's id, and their Emp ID to tell them apart", paulas.every((x) => x.id) && new Set(paulas.map((x) => x.id)).size === 2 && paulas.map((x) => x.emp_id).sort().join(",") === "D1,D9", paulas);
ok("R4-G: the page keys and labels the rows by person (the Emp ID shows when two share a name)", /d\.by_person\.map\(\(p\) => <tr key=\{p\.id \|\| p\.name\}/.test(src) && /sameName\(p\)/.test(src));

S("R4-H: a big floor's lists and counts are not cut at a fixed number");
const hnow2 = Date.now(), seq = (n) => `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${n})`;
const anyClaim = (await poolOf(1, sun.id))[0];
// Needs you now: 350 open posting tasks past their TAT, then one waiting on the client, due last, whose chase date has come
await sql(`${seq(350)} INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id, assigned_to) SELECT 'ho-r4h-' || i, ?, ?, 'posting', 'assigned', ?, ? + i, ?, ? FROM s`,
  anyClaim, sun.id, hnow2 - 5 * 86400000, hnow2 - 4 * 86400000, U("Paula Post"), U("Paula Post"));
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id, chase_at, paused_at) VALUES (?,?,?,?,?,?,?,?,?,?)", "ho-r4h-chase", anyClaim, sun.id, "posting", "client", hnow2 - 86400000, hnow2 + 30 * 86400000, U("Paula Post"), hnow2 - 60000, hnow2 - 86400000);
const dsh = await PIA("handoffs.dashboard", { dept: "posting", from_ms: hnow2 - 7 * 86400000, to_ms: hnow2 + 60000 });
ok("R4-H: Needs you now counts every one (351), not the first 300 looked at, and lists the first 60", dsh.attention_total === 351 && dsh.attention.length === 60, [dsh.attention_total, dsh.attention.length]);
ok("R4-H: the page says how many there are when it lists only the first 60", /The first \{fmtInt\(d\.attention\.length\)\} of \{fmtInt\(d\.attention_total\)\} by due time/.test(src));
await sql("DELETE FROM handoffs WHERE id LIKE 'ho-r4h-%'");
// a week of desk tasks over 20,000: the desk dashboard's days and the TAT counts take every one
await sql(`${seq(20050)} INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id, assigned_to, done_at, done_by, done_by_name) SELECT 'ho-r4w-' || i, ?, ?, 'posting', 'complete', ?, ?, ?, ?, ?, ?, 'Paula Post' FROM s`,
  anyClaim, sun.id, hnow2 - 3 * 86400000, hnow2 + 86400000, U("Paula Post"), U("Paula Post"), hnow2 - 2 * 86400000, U("Paula Post"));
const wk2 = await PIA("handoffs.dashboard", { dept: "posting", from_ms: hnow2 - 4 * 86400000, to_ms: hnow2 + 60000 });
const doneByDay = wk2.by_day.reduce((t, x) => t + x.done, 0), recByDay = wk2.by_day.reduce((t, x) => t + x.received, 0);
ok("R4-H: the desk dashboard's days count all 20,050 tasks of the week, as its totals do", doneByDay >= 20050 && doneByDay === wk2.totals.completed && recByDay >= 20050, [doneByDay, recByDay, wk2.totals.completed]);
const istD = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const slaX = await TI("sla.extras", { client_id: sun.id, from: istD(hnow2 - 7 * 86400000), to: istD(hnow2 + 2 * 86400000), today: istD(hnow2) });
ok("R4-H: the SLA scorecard's Payment posting TAT counts all 20,050 tasks due in the dates", slaX.tat.posting.due + slaX.tat.posting.open >= 20050, slaX.tat.posting);
await sql("DELETE FROM handoffs WHERE id LIKE 'ho-r4w-%'");
// team tasks: 2,050 open ones of another team lead, due first, then one of Tina's own, due last
await sql(`${seq(2050)} INSERT INTO team_tasks (id, client_id, scope, title, due_at, count_total, created_by, created_by_name, created_at, updated_at) SELECT 'tt-r4h-' || i, ?, 'Other', 'Lakeview list ' || i, ? + i, 1, ?, 'Leo Lead', ?, ? FROM s`,
  lake.id, hnow2 + 86400000, U("Leo Lead"), hnow2, hnow2);
await sql("INSERT INTO team_tasks (id, client_id, scope, title, due_at, count_total, created_by, created_by_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", "tt-r4h-tina", sun.id, "Other", "Sunrise ERA batch", hnow2 + 9 * 86400000, 1, U("Tina Lead"), "Tina Lead", hnow2, hnow2);
const tl = await TI("tasks.list", { view: "open" });
ok("R4-H: Tina's own team task is on her list though 2,050 others are due before it", tl.rows.some((t) => t.id === "tt-r4h-tina"), tl.rows.length);
const cnt = await TI("attention.count", {});
ok("R4-H: and on her Needs attention count", cnt.tasks >= 1, cnt);
await sql("DELETE FROM team_tasks WHERE id LIKE 'tt-r4h-%'");
// escalations: 1,050 resolved ones logged after one that is still open
await sql("INSERT INTO escalations (id, client_id, sr, day, dept, status, created_at) VALUES (?,?,?,?,?,?,?)", "esc-r4h-open", sun.id, 1, "2026-01-05", "AR", "open", Date.parse("2026-01-05T05:00:00Z"));
await sql(`${seq(1050)} INSERT INTO escalations (id, client_id, sr, day, dept, status, created_at, resolved_at) SELECT 'esc-r4h-' || i, ?, i + 1, '2026-02-01', 'AR', 'resolved', ?, ? FROM s`, sun.id, Date.parse("2026-02-01T05:00:00Z"), Date.parse("2026-02-02T05:00:00Z"));
const el = await TI("escalations.list", { client_id: sun.id, status: "open", today: "2026-11-17" });
ok("R4-H: the Escalation tracker's open list has the open one logged before 1,050 others", el.rows.some((e) => e.id === "esc-r4h-open") && el.stats.open >= 1, [el.rows.length, el.stats.open]);
const ea = await TI("escalations.list", { client_id: sun.id, status: "", today: "2026-11-17" });
ok("R4-H: and the whole register has all 1,051", ea.rows.filter((e) => /^esc-r4h-/.test(e.id)).length === 1051, ea.rows.length);
await sql("DELETE FROM escalations WHERE id LIKE 'esc-r4h-%'");
ok("R4-H: README says Live status's two lists show the red ones first, then the oldest", /picked\), the red ones first, then the oldest first/.test(readme) && /Needs attention,\s+the red ones first, then the oldest first/.test(readme) && !/picked\), oldest first/.test(readme));

// ---------------------------------------------------------------------------------------------------------------------
const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
