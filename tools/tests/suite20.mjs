/* Suite 20: the Escalation tracker. Based on suite 13: each client's own OneDrive folders (Brahmastra Clients / <Client> / Inventory, Production), made when a client is added and by the hourly job for every existing client, and the monthly Production file every saved entry goes to. A fake Microsoft Graph stands in for OneDrive. */
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
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "sima@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" })];
// ---- a small fake of Microsoft Graph: folders, files, sharing links and one worksheet per workbook ----
const OD = { items: new Map(), seq: 0, fail: false, rows: new Map() };
const OWNER_ROOT = "root";
const mk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it); if (kind === "file") OD.rows.set(id, []); return it; };
const child = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const out = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const pathOf = (id) => { const p = []; let it = OD.items.get(id); while (it) { p.unshift(it.name); it = OD.items.get(it.parent); } return p.join("/"); };
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const u = new URL(url); const path = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));
  if (OD.fail && m !== "GET") return J({ error: { message: "Access denied" } }, 403);
  let r;
  // nested paths under the owner's root (the Brahmastra Reports / <lead> / <client> / SLA & KPI files)
  const walk = (parts, make) => { let cur = OWNER_ROOT; for (const nm of parts) { let it = child(cur, nm); if (!it) { if (!make) return null; it = mk(nm, cur, "folder"); } cur = it.id; } return cur; };
  if ((r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+\/.+?):(\/content)?$/))) {
    const parts = r[1].split("/"), nm = parts.pop();
    if (m === "PUT" && r[2]) { const dir = walk(parts, true); if (child(dir, nm)) return J({}, 409); return J(out(mk(nm, dir, "file")), 201); }
    if (m === "GET" && !r[2]) { const dir = walk(parts, false); const it = dir && child(dir, nm); return it ? J(out(it)) : J({}, 404); }
  }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range\(address='A(\d+):[A-Z]+\d+'\)\/clear$/))) { const rows = OD.rows.get(r[1]); rows.length = Math.min(rows.length, Number(r[2]) - 1); return J({}); }
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (child(OWNER_ROOT, b.name)) return J({}, 409); return J(out(mk(b.name, OWNER_ROOT, "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = child(OWNER_ROOT, r[1]); return it ? J(out(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (child(r[1], r[2])) return J({}, 409); return J(out(mk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: [{ id: "s1", name: "Sheet1" }] });
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/usedRange/))) { const rows = OD.rows.get(r[1]) || []; return J({ rowCount: Math.max(1, rows.length), address: "Sheet1!A1:Z" + Math.max(1, rows.length), values: rows.length ? rows : [[""]] }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range\(address='A(\d+):/))) { const b = JSON.parse(init.body); const rows = OD.rows.get(r[1]); b.values.forEach((v, i) => { rows[Number(r[2]) - 1 + i] = v; }); return J({}); }
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); }
  return new Response("nope", { status: 500 });
};
const mails = [];
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
rig.liveEnv.DEMO = false;   // from here on the server behaves as live (OneDrive copies on)
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), SM = await firstIn("Sima Expert", "sima@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const folder = (clientName) => { const root = child("root", "Brahmastra Clients"); const f = root && child(root.id, clientName); const prod = f && child(f.id, "Production");
  return { root, f, inv: f && child(f.id, "Inventory"), prod, ar: prod && child(prod.id, "AR"), posting: prod && child(prod.id, "Payment posting"), submission: prod && child(prod.id, "Submission"), rejection: prod && child(prod.id, "Rejections") }; };
const runJob = async (at) => { const real = Date.now; if (at) Date.now = () => at; try { const ps = []; await rig.worker.default.scheduled({ cron: "17 * * * *" }, { ...rig.backend.env, ...rig.liveEnv, DB: rig.backend.env.DB }, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };


const base = { day: "2026-11-04", dept: "Submission", severity: "High", raised_src: "Client", raised_who: "Office manager", how: "Email", claim_no: "CLM1", description: "Claims rejected twice for the same modifier" };
S("Who can use it");
let r = await T(() => AR("escalations.list", {}));
ok("a biller cannot open the tracker", !r.ok && r.status === 403, r);
r = await T(() => AR("escalations.save", { ...base, client_id: sun.id }));
ok("a biller cannot log one", !r.ok && r.status === 403, r);
r = await T(() => SM("escalations.save", { ...base, client_id: sun.id }));
ok("an SME logs one on their client: SR1", r.ok && r.r.sr === 1, r);
r = await T(() => SM("escalations.save", { ...base, client_id: lake.id }));
ok("an SME cannot log on a client outside their scope", !r.ok && r.status === 403, r);
r = await T(() => TI("escalations.save", { ...base, dept: "Payment Posting", client_id: sun.id }));
ok("the team lead logs the next one: SR2", r.ok && r.r.sr === 2, r);
r = await T(() => A("escalations.save", { ...base, client_id: lake.id }));
ok("SR numbers count per client: Lakeview starts at SR1", r.ok && r.r.sr === 1, r);
S("Checks");
r = await T(() => TI("escalations.save", { ...base, dept: "Nope", client_id: sun.id })); ok("department must be one of the list", !r.ok && /department/i.test(r.e), r);
r = await T(() => TI("escalations.save", { ...base, description: "x", client_id: sun.id })); ok("description is needed", !r.ok && /escalated/i.test(r.e), r);
r = await T(() => TI("escalations.save", { ...base, day: "", client_id: sun.id })); ok("date is needed", !r.ok && /date/i.test(r.e), r);
let L = await TI("escalations.list", { client_id: sun.id, status: "all" });
ok("the list shows both, newest first, with their SR numbers", L.rows.length === 2 && L.rows.map((x) => x.sr).sort().join() === "1,2", L.rows.map((x) => x.sr));
const sr1 = L.rows.find((x) => x.sr === 1);
r = await T(() => SM("escalations.save", { ...sr1, id: sr1.id, status: "resolved", rca: "" }));
ok("resolving needs the RCA", !r.ok && /root cause/i.test(r.e), r);
S("Open past 24 hours");
await sql("UPDATE escalations SET created_at = ? WHERE client_id = ?", Date.now() - 30 * 3600000, sun.id);
L = await TI("escalations.list", { client_id: sun.id, status: "open" });
ok("both are flagged: reason needed", L.rows.every((x) => x.needs_reason && x.can_reason) && L.stats.needs_reason === 2, L.stats);
const SL = await SM("escalations.list", { client_id: sun.id, status: "open" });
ok("an SME sees the flag but cannot give the reason", SL.rows.every((x) => x.needs_reason && !x.can_reason), SL.rows.map((x) => x.can_reason));
r = await T(() => SM("escalations.reason", { id: sr1.id, reason: "Waiting on the client", expected_on: "2099-01-01" }));
ok("an SME is told the team lead gives the reason", !r.ok && /team lead/i.test(r.e), r);
let bell = await TI("notify.list", {});
ok("the team lead's bell asks for the reasons", bell.items.some((x) => x.key === "esc_reason" && x.n === 2 && x.view === "escalations"), bell.items.map((x) => x.key));
await runJob();
const notes = await sql("SELECT 1"); // keep the DB warm
const tinaId = U("Tina Lead").id;
const nn = DB.prepare("SELECT text FROM user_notices WHERE user_id = ? AND view = 'escalations'").bind(tinaId); const got = [];
const res = await nn.all(); for (const x of (res.results || res)) got.push(x.text);
ok("the hourly job tells the client's team lead once per escalation", got.length === 2 && got.every((t) => /24 hours/.test(t)), got);
await runJob();
const res2 = await nn.all(); ok("and not again on the next run", (res2.results || res2).length === 2);
ok("an email went to the team lead", mails.some((m) => /SR1/.test(JSON.stringify(m)) && /tina@/.test(JSON.stringify(m))), mails.length);
r = await T(() => TI("escalations.reason", { id: sr1.id, reason: "x", expected_on: "2099-01-01" })); ok("the reason must be a sentence", !r.ok, r);
r = await T(() => TI("escalations.reason", { id: sr1.id, reason: "Waiting on the corrected charge template", expected_on: "2020-01-01" })); ok("the expected date cannot be in the past", !r.ok && /date/i.test(r.e), r);
r = await T(() => TI("escalations.reason", { id: sr1.id, reason: "Waiting on the corrected charge template", expected_on: "2099-01-01" })); ok("the team lead gives the reason and expected date", r.ok, r);
L = await TI("escalations.list", { client_id: sun.id, status: "reason" });
ok("only the other one still needs a reason", L.rows.length === 1 && L.rows[0].sr === 2, L.rows.map((x) => x.sr));
await sql("UPDATE escalations SET expected_on = '2026-01-01' WHERE id = ?", sr1.id);
L = await TI("escalations.list", { client_id: sun.id, status: "open" });
ok("past the expected date it turns red again and the lead can give a new date", L.rows.find((x) => x.sr === 1).past_expected && L.rows.find((x) => x.sr === 1).can_reason, L.rows);
r = await T(() => SM("escalations.save", { ...sr1, id: sr1.id, status: "resolved", rca: "Modifier 25 added to the charge template" }));
ok("the SME resolves it with the RCA", r.ok, r);
L = await TI("escalations.list", { client_id: sun.id, status: "resolved" });
ok("resolved, with hours to resolve", L.rows.length === 1 && L.rows[0].hours >= 29 && L.stats.resolved_month >= 0, L.rows);
await sleep(800);
S("The client's OneDrive file");
const f = folder(sun.name), file = f.f && child(f.f.id, "Escalation Tracker - " + sun.name + ".xlsx");
ok("one workbook in the client's folder: Escalation Tracker - <Client>.xlsx", !!file, [...OD.items.values()].map((x) => pathOf(x.id)));
const rows = file ? OD.rows.get(file.id) : [];
ok("header first: SR No, Department, Description, Date (what Drishti counts)", rows[0] && rows[0].slice(0, 4).join() === "SR No,Department,Description,Date", rows[0]);
ok("one row per escalation, the same row updated, not added again", rows.length === 3 && rows[1][0] === "SR1" && rows[2][0] === "SR2", rows.map((x) => x[0]));
ok("SR1's row shows Resolved, the RCA and the reason given", rows[1][9] === "Resolved" && /Modifier 25/.test(rows[1][14]) && /charge template/.test(rows[1][15]), rows[1]);
L = await TI("escalations.list", { client_id: sun.id, status: "all" });
ok("the screen shows where it was saved, with a link", L.file && L.file.ok && /Escalation Tracker/.test(L.file.file) && /share\//.test(L.file.link), L.file);
const lf = folder(lake.name); ok("Lakeview has its own file", lf.f && child(lf.f.id, "Escalation Tracker - " + lake.name + ".xlsx"));
r = await T(() => TI("escalations.list", { client_id: lake.id }));
ok("a lead cannot list another team's client", !r.ok && r.status === 403, r);
const all2 = await TI("escalations.list", { status: "all" });
ok("All clients for a lead shows only their clients", all2.rows.every((x) => x.client_id === sun.id), all2.rows.map((x) => x.client_name));

S("SLA: each month's file in the SLA & KPI folder, threshold 0");
const slaDir = () => { const root = child("root", "Brahmastra Reports"); const ld = root && child(root.id, "Tina Lead"); const cf = ld && child(ld.id, sun.name); return cf && child(cf.id, "SLA & KPI"); };
const nov = slaDir() && child(slaDir().id, "Escalation Tracker - " + sun.name + " - Nov 2026.xlsx");
ok("Brahmastra Reports › <team lead> › <client> › SLA & KPI › Escalation Tracker - <client> - Nov 2026.xlsx", !!nov, [...OD.items.values()].map((x) => pathOf(x.id)));
let nr = nov ? OD.rows.get(nov.id) : [];
ok("it holds November's escalations only (what Drishti counts), Department column for its per-scope count", nr.length === 3 && nr[0][1] === "Department" && nr.slice(1).map((x) => x[1]).sort().join() === "Payment Posting,Submission", nr.map((x) => x.slice(0, 4)));
const sr2 = (await TI("escalations.list", { client_id: sun.id, status: "all" })).rows.find((x) => x.sr === 2);
r = await T(() => TI("escalations.save", { ...sr2, id: sr2.id, day: "2026-10-30" }));
ok("moving SR2 to October", r.ok, r); await sleep(800);
nr = OD.rows.get(nov.id);
const oct = child(slaDir().id, "Escalation Tracker - " + sun.name + " - Oct 2026.xlsx");
ok("November's file drops it, October's file gets it", nr.length === 2 && nr[1][0] === "SR1" && oct && OD.rows.get(oct.id).length === 2 && OD.rows.get(oct.id)[1][0] === "SR2", [nr.map((x) => x[0]), oct && OD.rows.get(oct.id).map((x) => x[0])]);
L = await TI("escalations.list", { client_id: sun.id, status: "all", today: "2026-11-05" });
ok("the screen shows the SLA: 1 this month against a target of 0, red", L.sla && L.sla.target === 0 && L.sla.n === 1 && !L.sla.met && L.sla.month === "Nov 2026", L.sla);
ok("and where the SLA copy went", L.sla_file && L.sla_file.ok && L.sla_file.files.some((f) => /SLA & KPI › Escalation Tracker/.test(f)), L.sla_file);
L = await TI("escalations.list", { client_id: sun.id, status: "all", today: "2026-12-05" });
ok("a month with none is green", L.sla.n === 0 && L.sla.met, L.sla);

const pass = results.filter((x) => x.pass).length, fail = results.length - pass;
console.log(`\n==== suite20: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
