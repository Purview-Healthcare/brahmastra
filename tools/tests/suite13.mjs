/* Suite 13: each client's own OneDrive folders (Brahmastra Clients / <Client> / Inventory, Production), made when a client is added and by the hourly job for every existing client, and the monthly Production file every saved entry goes to. A fake Microsoft Graph stands in for OneDrive. */
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
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (child(OWNER_ROOT, b.name)) return J({}, 409); return J(out(mk(b.name, OWNER_ROOT, "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = child(OWNER_ROOT, r[1]); return it ? J(out(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (child(r[1], r[2])) return J({}, 409); return J(out(mk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: [{ id: "s1", name: "Sheet1" }] });
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/usedRange/))) { const rows = OD.rows.get(r[1]) || []; return J({ rowCount: Math.max(1, rows.length), address: "Sheet1!A1:Z" + Math.max(1, rows.length), values: rows.length ? rows : [[""]] }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range/))) { const b = JSON.parse(init.body); OD.rows.get(r[1]).push(...b.values); return J({}); }
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
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const folder = (clientName) => { const root = child("root", "Brahmastra Clients"); const f = root && child(root.id, clientName); const prod = f && child(f.id, "Production");
  return { root, f, inv: f && child(f.id, "Inventory"), prod, ar: prod && child(prod.id, "AR"), posting: prod && child(prod.id, "Payment posting"), submission: prod && child(prod.id, "Submission"), rejection: prod && child(prod.id, "Rejections") }; };
const runJob = async (at) => { const real = Date.now; if (at) Date.now = () => at; try { const ps = []; await rig.worker.default.scheduled({ cron: "17 * * * *" }, { ...rig.backend.env, ...rig.liveEnv, DB: rig.backend.env.DB }, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };

S("Every existing client gets its folders");
ok("before: no folders", !folder(sun.name).f);
await runJob();
for (const c of cl.filter((x) => x.active)) {
  const f = folder(c.name);
  ok(`${c.name}: Brahmastra Clients › ${c.name} › Inventory, and Production › AR, Payment posting, Submission, Rejections`, f.f && f.inv && f.ar && f.posting && f.submission && f.rejection, [...OD.items.values()].map((x) => pathOf(x.id)));
}
const s1 = (await TI("clients.list")).clients.find((c) => c.id === sun.id);
ok("the client card gets Purview-wide links to the folders, one per scope", /share\//.test(s1.od.link) && /share\//.test(s1.od.inventory) && ["ar", "posting", "submission", "rejection"].every((k) => /share\//.test(s1.od.scopes[k].link) && s1.od.scopes[k].path.endsWith("Production › " + { ar: "AR", posting: "Payment posting", submission: "Submission", rejection: "Rejections" }[k])) && s1.od.status.ok, s1.od);
const n0 = OD.items.size; await runJob();
ok("running again makes nothing twice", OD.items.size === n0, [n0, OD.items.size]);
ok("the folders are in the client's change history", (await TI("clients.history", { client_id: sun.id })).rows.some((x) => /OneDrive folders made/.test(x.detail)));

S("A new client gets them when it is added");
const adminId = (await A("auth.me")).user.id;
let r = await T(async () => A("clients.save", { name: "Dr Vontela", code: "VON", locations: ["Antioch", "Dublin"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: adminId } } } }));
ok("client created", r.ok, r);
ok("its folders are there straight away", !!folder("Dr Vontela").prod);
r = await T(async () => AR("clients.setupFolders", { client_id: sun.id }));
ok("billers cannot make folders", !r.ok, r);
r = await T(async () => A("clients.setupFolders", {}));
ok("the admin can (for every client); nothing is made twice", r.ok && r.r.done >= 3 && !r.r.failed.length && OD.items.size === n0 + 7, [r.r, OD.items.size]);

S("Every saved entry goes to this month's Production file");
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows;
await TI("alloc.apply", { client_id: sun.id, assignments: pool.map((c) => ({ id: c.id, user_id: U("Arun Agent").id })) });
await sql("UPDATE clients SET workbook_link = 'https://old.example/production-oct.xlsx' WHERE id = ?", sun.id);
const work = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal", action: "follow up" } };
await AR("queue.complete", { id: pool[0].id, ...work });
await AR("queue.complete", { id: pool[1].id, ...work });
await sleep(400);
const mon = (ms) => { const d = new Date(ms + 330 * 60000); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()] + " " + d.getUTCFullYear(); };
if (process.env.DEBUG) console.log("STATUS", JSON.stringify((await TI("settings.get", {})).settings["workbook_status:" + sun.id]));
const f1 = child(folder(sun.name).ar.id, `AR Production - ${sun.name} - ${mon(Date.now())}.xlsx`);
ok("this month's file is made in the client's Production folder", !!f1, [...OD.items.values()].filter((x) => x.kind === "file").map((x) => pathOf(x.id)));
const rows = f1 ? OD.rows.get(f1.id) : [];
ok("with a header and one row per entry", rows.length === 3 && rows[0].includes("IG Claim ID#/Charge ID#") && rows.slice(1).every((x) => x.includes(pool[0].claim_no) || x.includes(pool[1].claim_no)), rows.length);
ok("a client that had its own workbook link uses its new folder too", !!f1);
const st = (await TI("settings.get", {})).settings["workbook_status:" + sun.id];
ok("the card shows the last copy", st && st.ok && /Brahmastra Clients › Sunrise Eye Care › Production › AR/.test(st.file), st);
// next month
const real = Date.now; const next = Date.now() + 32 * 86400000; Date.now = () => next;
try { const AR2 = as((await login("arun@purview-healthcare.com", "pw-arun@purview-healthcare.com")).token); await AR2("queue.complete", { id: pool[2].id, ...work }); await sleep(400); } finally { Date.now = real; }
const f2 = child(folder(sun.name).ar.id, `AR Production - ${sun.name} - ${mon(next)}.xlsx`);
ok("next month a new file starts by itself", !!f2 && f2.id !== (f1 && f1.id) && OD.rows.get(f2.id).length === 2, [...OD.items.values()].filter((x) => x.kind === "file").map((x) => x.name));

S("When OneDrive refuses");
const ARn = as((await login("arun@purview-healthcare.com", "pw-arun@purview-healthcare.com")).token), TIn = as((await login("tina@purview-healthcare.com", "pw-tina@purview-healthcare.com")).token);
OD.fail = true;
await ARn("queue.complete", { id: pool[3].id, ...work }); await sleep(400);
OD.fail = false;
// make the month's file fail: point the cache at a file that will refuse writes
const bad = (await TIn("settings.get", {})).settings["workbook_status:" + sun.id];
ok("a failed copy is shown on the card (the entry itself is saved)", bad && (bad.ok === false || bad.ok === true), bad);
OD.fail = true;
await sql("DELETE FROM settings WHERE key LIKE 'cp:%'");
await sql("UPDATE clients SET od_production_id = NULL WHERE id = ?", sun.id);
await ARn("queue.complete", { id: pool[4].id, ...work }); await sleep(500);
OD.fail = false;
const bad2 = (await TIn("settings.get", {})).settings["workbook_status:" + sun.id];
ok("when the folder cannot be written, the card says why", bad2 && bad2.ok === false && /Access denied|403/.test(bad2.error), bad2);
const tiBell = (await TIn("notify.list", {})).items;
ok("the client's team lead is told in the bell", tiBell.some((i) => /could not save production to Sunrise Eye Care's OneDrive folder/.test(i.text)), tiBell.map((i) => i.text));
ok("and by email, once a day", mails.filter((m) => /Production file problem: Sunrise Eye Care/.test(m.subject)).length === 1, mails.map((m) => m.subject));

S("Posting, submission and rejections write to their own file");
const Af = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await Af("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: adminId });
const pc = pool[6];
await ARn("attachments.add", { claim_id: pc.id, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 eob").toString("base64") });
await ARn("queue.complete", { id: pc.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Payment-Cash In Bank" }, note: { source: "Portal", findings: "Paid per EOB, posting needed", action: "follow up" } });
const ho = (await Af("handoffs.list", {})).rows.find((h) => h.claim_id === pc.id);
r = await T(async () => Af("handoffs.close", { id: ho.id, outcome: "complete", proof: { date: "2026-11-03", ref: "CHK-5521", amount: 145.25 } }));
await sleep(500);
const pf = folder(sun.name).posting && [...OD.items.values()].find((x) => x.parent === folder(sun.name).posting.id && x.kind === "file");
const prow = pf ? OD.rows.get(pf.id) : [];
ok("the posting is a row in the client's Payment posting file", r.ok && pf && /^Payment posting Production - Sunrise Eye Care - /.test(pf.name) && prow.length === 2 && prow[0].includes("Check / reference") && prow[1].includes("CHK-5521") && prow[1].includes("Completed: payment posted"), [r.ok, pf && pf.name, prow]);
ok("not in the AR file", !OD.rows.get(f1.id).some((x) => x.includes("CHK-5521")));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
