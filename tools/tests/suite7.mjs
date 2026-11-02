/* Suite 7: Portfolio (VP / managers), manager comparison, data freshness and the audit trail. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "M2", name: "Sandesh Manager", position: "Manager", reports_to: "Sasha Vice", email: "sandesh@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Sandesh Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" })];
const fetchMock = async (url) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));

S("Portfolio");
let r = await T(async () => SA("portfolio.overview"));
ok("the VP opens the portfolio", r.ok, r);
const pf = r.r;
ok("every client, with totals", pf.rows.length === cl.filter((c) => c.active).length && pf.totals.clients === pf.rows.length, [pf.rows.length, pf.totals]);
const sunRow = pf.rows.find((x) => x.client_id === sun.id);
const c360 = await SA("client.overview", { client_id: sun.id });
ok("its numbers agree with Client 360", Math.abs(sunRow.ar - c360.ar.balance) < 1 && sunRow.over90_pct === c360.ar.over90_pct && sunRow.health === c360.health, [sunRow.ar, c360.ar.balance, sunRow.health, c360.health]);
const rank = { risk: 0, watch: 1, good: 2 };
ok("worst first", pf.rows.every((x, i) => i === 0 || rank[pf.rows[i - 1].health] <= rank[x.health]), pf.rows.map((x) => x.health));
ok("total AR adds up", Math.abs(pf.totals.ar - pf.rows.reduce((t, x) => t + x.ar, 0)) < 1);
ok("fresh inventories raise nothing", !pf.freshness.some((f) => /inventory/.test(f.text)), pf.freshness.map((f) => f.text));
await sql("UPDATE batches SET uploaded_at = ? WHERE client_id = ?", Date.now() - 10 * 86400000, lake.id);
const pfOld = await SA("portfolio.overview");
ok("an inventory 10 days old is flagged under data freshness", pfOld.freshness.some((f) => f.client_id === lake.id && /last uploaded 10 days ago/.test(f.text)), pfOld.freshness.map((f) => f.text));
ok("and the portfolio shows when it was last uploaded", pfOld.rows.find((x) => x.client_id === lake.id).last_inventory < Date.now() - 9 * 86400000);
r = await T(async () => JO("portfolio.overview"));
ok("Joseph sees only his span", r.ok && r.r.rows.length === 1 && r.r.rows[0].client_id === sun.id, r.ok && r.r.rows.map((x) => x.client));
r = await T(async () => AR("portfolio.overview"));
ok("billers have no portfolio", !r.ok, r);

S("Capacity: days to clear");
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows;
await TI("alloc.reassign", { ids: pool.map((c) => c.id), user_id: U("Arun Agent").id });
for (const c of pool.slice(0, 7)) await AR("queue.complete", { id: c.id, saag: { status: "Claim In Process", sub_status: "Recently processed", action: "Need to allow some time", bucket: "Payer", effective: "In Process" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } }).catch((e) => console.log("ENTRY", e.message));
const pf2 = await SA("portfolio.overview");
const s2 = pf2.rows.find((x) => x.client_id === sun.id);
const wd = pf2.working_days;
ok("pace is entries a working day over two weeks", wd >= 9 && wd <= 11 && Math.abs(s2.per_day - Math.round(7 / wd * 10) / 10) < 0.11 && s2.people === 1, [wd, s2.per_day, s2.people]);
ok("days to clear = claims still to work / pace", s2.days_to_clear === Math.ceil(s2.to_work / (7 / wd)), [s2.to_work, s2.days_to_clear]);
const l2 = pf2.rows.find((x) => x.client_id === lake.id);
ok("a client nobody worked has no pace (not a fake number)", l2.days_to_clear === null && l2.per_day === 0, [l2.days_to_clear, l2.per_day]);

S("Managers side by side");
r = await T(async () => SA("portfolio.managers", { from_ms: Date.now() - 86400000 * 30, to_ms: Date.now() + 86400000 }));
ok("the VP sees both managers", r.ok && r.r.rows.map((m) => m.name).join() === "Joseph Manager,Sandesh Manager", r.ok && r.r.rows.map((m) => m.name));
const jo = r.r.rows.find((m) => m.name === "Joseph Manager");
ok("Joseph's line: his client, his people's entries", jo.clients.join() === sun.name && jo.entries === 7 && jo.people >= 2, jo);
r = await T(async () => JO("portfolio.managers", {}));
ok("a manager sees only their own line", r.ok && r.r.rows.length === 1 && r.r.rows[0].name === "Joseph Manager", r.ok && r.r.rows.map((m) => m.name));

S("Audit trail");
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "view" });
await TI("raci.save", { client_id: sun.id, r: [U("Arun Agent").id], a: [U("Tina Lead").id], c: [U("Joseph Manager").id], i: [] });
await A("users.save", { id: U("Bela Agent").id, name: "Bela Agent", first_name: "Bela", last_name: "Agent", email: "bela@purview-healthcare.com", role: "user", designation: "Biller", capacity: 35, active: false });
await A("feedback.setRecipients", { ids: [U("Sasha Vice").id] });
r = await T(async () => SA("audit.list", {}));
ok("the VP reads the audit trail", r.ok, r);
const acts = r.r.rows.map((x) => x.action);
ok("sharing, RACI, a deactivated person and feedback recipients are all there", ["access.share", "raci.save", "user.save", "feedback.recipients"].every((a) => acts.includes(a)), acts);
const share = r.r.rows.find((x) => x.action === "access.share");
ok("each says who, when, the client and what changed", share.user_name === "Tina Lead" && share.client_name === sun.name && /Leo Lead · view only/.test(share.detail) && share.at > 0, share);
ok("the deactivation says so", r.r.rows.some((x) => x.action === "user.save" && /Bela Agent · deactivated/.test(x.detail)), r.r.rows.filter((x) => x.action === "user.save").map((x) => x.detail));
r = await T(async () => SA("audit.list", { client_id: sun.id, action: "raci" }));
ok("filters by client and kind", r.ok && r.r.rows.length >= 1 && r.r.rows.every((x) => x.action === "raci.save"), r.ok && r.r.rows.map((x) => x.action));
r = await T(async () => TI("audit.list", {}));
ok("team leads cannot read it", !r.ok, r);
r = await T(async () => JO("audit.list", {}));
ok("nor managers", !r.ok, r);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
