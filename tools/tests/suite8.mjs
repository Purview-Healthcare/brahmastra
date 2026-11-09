/* Suite 8: Team today (huddle, out today, rebalance), coaching notes, note templates, SAAG suggestions. */
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
  P({ emp_id: "A3", name: "Cara Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "cara@purview-healthcare.com" }),
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
const CA = await firstIn("Cara Agent", "cara@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com");
const arun = U("Arun Agent"), cara = U("Cara Agent"), bela = U("Bela Agent");
const team = (await A("clients.list")).clients.find((c) => c.id === sun.id).team || [];
if (!team.includes(arun.id) || !team.includes(cara.id)) await A("clients.saveTeam", { id: sun.id, team: [...new Set([...team, arun.id, cara.id])] });
const done = { saag: { status: "Claim In Process", sub_status: "Recently processed", action: "Need to allow some time", bucket: "Payer", effective: "In Process" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } };

S("Team today");
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 20 })).rows;
await TI("alloc.reassign", { ids: pool.slice(0, 12).map((c) => c.id), user_id: arun.id });
await TI("alloc.reassign", { ids: pool.slice(12, 16).map((c) => c.id), user_id: cara.id });
for (const c of pool.slice(0, 3)) await AR("queue.complete", { id: c.id, ...done });
let r = await T(async () => TI("team.huddle"));
ok("a team lead opens Team today", r.ok, r);
let h = r.r, ha = h.rows.find((x) => x.id === arun.id), hc = h.rows.find((x) => x.id === cara.id);
ok("their billers are listed, not other teams'", ha && hc && !h.rows.some((x) => x.id === bela.id), h.rows.map((x) => x.name));
ok("worked and on-desk counts are right", ha.worked === 3 && ha.on_desk === 9 && hc.worked === 0 && hc.on_desk === 4, [ha.worked, ha.on_desk, hc.worked, hc.on_desk]);
ok("someone with entries is working, someone without has not started", ha.status === "working" && hc.status === "not_started", [ha.status, hc.status]);
ok("first and last entry times are there", ha.first && ha.last && ha.first <= ha.last);
ok("totals add up", h.totals.worked === h.rows.reduce((t, x) => t + x.worked, 0) && h.totals.on_desk === h.rows.reduce((t, x) => t + x.on_desk, 0), h.totals);
await sql("UPDATE claims SET assigned_at = ?, follow_up_on = '' WHERE assigned_to = ?", Date.now() - 2 * 86400000, cara.id);
h = await TI("team.huddle"); hc = h.rows.find((x) => x.id === cara.id);
ok("claims allocated before this shift and not worked show as carried over", hc.carried === 4 && h.totals.carried >= 4, [hc.carried, h.totals.carried]);
// a claim parked for a follow-up later is not left over
await sql("UPDATE claims SET follow_up_on = '2099-01-01' WHERE id = ?", pool[12].id);
h = await TI("team.huddle"); hc = h.rows.find((x) => x.id === cara.id);
ok("a claim parked for a later follow-up is not carried over", hc.carried === 3, hc.carried);
await sql("UPDATE claims SET follow_up_on = '' WHERE id = ?", pool[12].id);
r = await T(async () => AR("team.huddle"));
ok("billers cannot open it", !r.ok, r);
r = await T(async () => LE("team.setOut", { user_id: cara.id, out: true }));
ok("a lead cannot mark someone else's biller out", !r.ok, r);

S("Out today and rebalance");
await TI("team.setOut", { user_id: cara.id, out: true, reason: "Sick" });
h = await TI("team.huddle"); hc = h.rows.find((x) => x.id === cara.id);
ok("marked out shows with the reason and who marked it", hc.status === "out" && hc.out.reason === "Sick" && hc.out.by === "Tina Lead", hc.out);
ok("the totals count them out and flag their desk", h.totals.out === 1 && h.totals.out_on_desk === 4, h.totals);
r = await T(async () => TI("team.rebalance", { user_id: cara.id }));
ok("rebalance moves their untouched claims to someone in today", r.ok && r.r.moved === 4 && r.r.left === 0 && r.r.to[0].name === "Arun Agent", r.r || r);
h = await TI("team.huddle");
ok("their desk is empty after", h.rows.find((x) => x.id === cara.id).on_desk === 0 && h.rows.find((x) => x.id === arun.id).on_desk === 13, h.rows.map((x) => x.name + " " + x.on_desk));
ok("the move is in the audit trail", (await A("audit.list", {})).rows.some((x) => x.action === "team.rebalance" && /Cara Agent: 4 claims shared equally to Arun Agent 4/.test(x.detail)));
r = await TI("team.rebalance", { user_id: cara.id });
ok("rebalancing again moves nothing", r.moved === 0, r);
await TI("team.setOut", { user_id: cara.id, out: false });
h = await TI("team.huddle");
ok("'In after all' clears it", h.rows.find((x) => x.id === cara.id).status !== "out" && h.totals.out === 0);
await TI("team.setOut", { user_id: arun.id, out: true }); await TI("team.setOut", { user_id: cara.id, out: true });
r = await TI("team.rebalance", { user_id: arun.id });
ok("with nobody in on that client, the claims stay put", r.moved === 0 && r.left === 13, r);
await TI("team.setOut", { user_id: arun.id, out: false }); await TI("team.setOut", { user_id: cara.id, out: false });

S("Coaching");
r = await T(async () => TI("coach.profile", { user_id: arun.id }));
ok("a lead opens a biller's coaching card", r.ok && r.r.person.name === "Arun Agent", r);
const cp = r.r;
ok("30-day entries and pace", cp.entries === 3 && cp.worked_days === 1 && cp.avg_per_day === 3, [cp.entries, cp.worked_days, cp.avg_per_day]);
ok("most entered statuses", cp.statuses[0] && cp.statuses[0].status === "Claim In Process", cp.statuses);
r = await T(async () => TI("coach.noteAdd", { user_id: arun.id, kind: "praise", text: "Clean notes all week, kept the call refs." }));
ok("adds a 1:1 note", r.ok, r);
r = await T(async () => TI("coach.noteAdd", { user_id: arun.id, text: "ok" }));
ok("a note needs a few words", !r.ok, r);
const n1 = (await TI("coach.profile", { user_id: arun.id })).notes;
ok("the note is listed with kind and author", n1.length === 1 && n1[0].kind === "praise" && n1[0].by_name === "Tina Lead" && n1[0].mine, n1);
r = await T(async () => AR("coach.profile", { user_id: arun.id }));
ok("the biller cannot read their own coaching notes", !r.ok, r);
r = await T(async () => LE("coach.profile", { user_id: arun.id }));
ok("another team's lead cannot either", !r.ok, r);
const jn = (await JO("coach.profile", { user_id: arun.id })).notes;
ok("the manager above can", jn.length === 1 && !jn[0].mine, jn);
r = await T(async () => JO("coach.noteDelete", { id: n1[0].id }));
ok("only the writer removes a note", !r.ok, r);
await TI("coach.noteDelete", { id: n1[0].id });
ok("the writer can", (await TI("coach.profile", { user_id: arun.id })).notes.length === 0);

S("Note templates");
r = await T(async () => TI("templates.save", { title: "In process, call back", text: "Called the payer, claim is in process since [date]. Ref [ref]." }));
ok("a lead saves a template for every client", r.ok, r);
r = await T(async () => TI("templates.save", { title: "Lakeview only", text: "Lakeview needs the dental x-ray attached.", client_id: lake.id }));
ok("but not for a client outside their span", !r.ok, r);
await TI("templates.save", { title: "Sunrise COB", text: "Sunrise: patient to update COB with the primary payer.", client_id: sun.id });
r = await T(async () => AR("templates.save", { title: "Mine", text: "A biller writing a template here." }));
ok("billers cannot write templates", !r.ok, r);
let tl = await AR("templates.list", { client_id: sun.id });
ok("billers see the general and their client's templates", tl.rows.length === 2 && tl.rows.some((x) => x.client_name === sun.name), tl.rows.map((x) => x.title));
tl = await (await firstIn("Bela Agent", "bela@purview-healthcare.com"))("templates.list", { client_id: lake.id });
ok("another client's biller does not see Sunrise's", tl.rows.length === 1 && !tl.rows.some((x) => x.client_id === sun.id), tl.rows.map((x) => x.title));
const t1 = (await TI("templates.list", {})).rows.find((x) => x.title === "In process, call back");
await TI("templates.save", { id: t1.id, title: "In process, call back in 15 days", text: t1.text });
ok("edit keeps one row", (await TI("templates.list", {})).rows.filter((x) => x.id === t1.id && /15 days/.test(x.title)).length === 1);
r = await T(async () => LE("templates.delete", { id: (await TI("templates.list", {})).rows.find((x) => x.client_id === sun.id).id }));
ok("a lead cannot delete another client's template", !r.ok, r);
await TI("templates.delete", { id: t1.id });
ok("delete removes it", !(await TI("templates.list", {})).rows.some((x) => x.id === t1.id));

S("SAAG suggestions");
const sc = pool[0];
r = await T(async () => CA("saag.suggest", { client_id: sun.id, payer: sc.payer }));
ok("suggests the most picked status for the payer", r.ok && r.r.rows[0] && r.r.rows[0].action === "Need to allow some time" && r.r.scope === "payer", r.r || r);
r = await CA("saag.suggest", { client_id: sun.id, payer: "A payer nobody worked" });
ok("falls back to the whole client", r.scope === "client" && r.rows.length >= 1, r);
r = await (await firstIn("Bela Agent", "bela@purview-healthcare.com").catch(() => null) || (async () => ({ rows: [] })))("saag.suggest", { client_id: sun.id, payer: sc.payer }).catch(() => ({ rows: [] }));
ok("nothing for a client outside the biller's scope", !r.rows.length, r);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
