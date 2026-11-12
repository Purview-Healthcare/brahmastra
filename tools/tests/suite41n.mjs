/* Suite 41n (with suite41): the N-18 and N-19 checks, found while fixing. regression checks for the bug-test fixes in the SLA area (tester G: Drishti and Brahmastra's SLA views). One or more
   checks per finding, each named by its id. Drishti is a stand-in here: its "overview" is answered from made-up clients and can be
   switched off. Microsoft Graph is a small fake that starts a new workbook from the template Brahmastra sends, the way OneDrive
   does, and writes cell by cell. Made-up data only. */
import fs from "fs";
import { createRequire } from "module";
import { makeRig, REPO } from "./rig.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "V1", name: "Vee President", position: "Vice President", email: "vee@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vee President", email: "mona@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tara Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "tara@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Lalit Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Mona Manager", email: "lalit@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Abe Agent", project: "Sunrise Eye Care", reports_to: "Tara Lead", email: "abe@purview-healthcare.com" })];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });

// ---- Drishti's stand-in: "overview" from DR_CLIENTS, "me" as its Admin; drDown makes its server not answer ----
const cell = (value, extra) => ({ value, method: "upload", ...(extra || {}) });
const period = (kind, id, label, from, to, ar, tasks, createdAt) => ({ id, kind, label, range: { from, to }, numDays: kind === "week" ? 7 : 30, createdAt: createdAt || to + "T09:00:00.000Z", createdBy: "",
  scopes: { ar: { crit: ar }, ...(tasks ? { sla: { tasks } } : {}) }, reports: {} });
const month = (id, label, from, to, ar, tasks, createdAt) => period("month", id, label, from, to, ar, tasks, createdAt);
const drClient = (id, name, periods) => ({ id, name, ownerId: "u1", ownerName: "Tara Lead", scopes: ["ar"], rules: {}, periods });
let DR_CLIENTS = [], drCalls = 0, drDown = false;
const drishti = (init) => {
  drCalls++; if (drDown) throw new Error("ECONNRESET");
  const body = JSON.parse((init && init.body) || "{}");
  if (body.a === "overview") return J({ ok: true, value: DR_CLIENTS });
  if (body.a === "me") return J({ ok: true, user: { id: "admin", name: "Admin", role: "admin", email: "drishti-admin@purview-healthcare.com" } });
  return J({ ok: false, error: "not in the stand-in", code: "bad" });
};

// ---- a small fake of Microsoft Graph: folders, files, and one worksheet per workbook. A new file starts as the template that
//      was sent (its tab name and its header row), and a range write changes only the cells in the range, as in OneDrive ----
const OD = { items: new Map(), seq: 0, books: new Map() };
const fromTemplate = (body) => { try { const wb = XLSX.read(body, { type: "array" }), n = wb.SheetNames[0]; return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }) }; } catch (e) { return { name: "Sheet1", rows: [] }; } };
const mk = (name, parent, kind, body) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it); if (kind === "file") OD.books.set(id, fromTemplate(body)); return it; };
const child = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const out = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const pathOf = (id) => { const p = []; let it = OD.items.get(id); while (it) { p.unshift(it.name); it = OD.items.get(it.parent); } return p.join("/"); };
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const u = new URL(url); const path = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));
  let r;
  const walk = (parts, make) => { let cur = "root"; for (const nm of parts) { let it = child(cur, nm); if (!it) { if (!make) return null; it = mk(nm, cur, "folder"); } cur = it.id; } return cur; };
  if ((r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+\/.+?):(\/content)?$/))) {
    const parts = r[1].split("/"), nm = parts.pop();
    if (m === "PUT" && r[2]) { const dir = walk(parts, true); if (child(dir, nm)) return J({}, 409); return J(out(mk(nm, dir, "file", init.body)), 201); }
    if (m === "GET" && !r[2]) { const dir = walk(parts, false); const it = dir && child(dir, nm); return it ? J(out(it)) : J({}, 404); }
  }
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (child("root", b.name)) return J({}, 409); return J(out(mk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = child("root", r[1]); return it ? J(out(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (child(r[1], r[2])) return J({}, 409); return J(out(mk(r[2], r[1], "file", init.body)), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
  const bk = (id) => OD.books.get(id);
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: [{ id: "s1", name: bk(r[1]).name }] });
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1$/))) { bk(r[1]).name = JSON.parse(init.body).name; return J({ id: "s1", name: bk(r[1]).name }); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/usedRange/))) { const rows = bk(r[1]).rows; return J({ rowCount: Math.max(1, rows.length), address: "Sheet1!A1:Z" + Math.max(1, rows.length), values: rows.length ? rows : [[""]] }); }
  if ((r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range\(address='([A-Z]+)(\d+):([A-Z]+)(\d+)'\)(\/clear)?$/))) {
    const rows = bk(r[1]).rows, r0 = Number(r[3]) - 1, c0 = colNum(r[2]) - 1, c1 = colNum(r[4]) - 1;
    if (m === "POST" && r[6]) { for (let i = r0; i < Math.min(rows.length, Number(r[5])); i++) for (let k = c0; k <= c1; k++) if (rows[i] && rows[i][k] !== undefined) rows[i][k] = ""; return J({}); }
    if (m === "PATCH" && !r[6]) { JSON.parse(init.body).values.forEach((row, i) => { const cur = rows[r0 + i] || (rows[r0 + i] = []); row.forEach((v, k) => { cur[c0 + k] = v; }); }); return J({}); }
  }
  if (m === "POST" && /\/workbook\/(tables|worksheets)\//.test(path)) return J({});
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
const fetchMock = async (url, init, real) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("script.google.com")) return drishti(init);
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), DRISHTI_TOKEN_SECRET: "s".repeat(40), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => ((await DB.prepare(q).bind(...a).all()).results || []);
// Brahmastra keeps Drishti's answer for ten minutes: forget it, so the next read asks the stand-in again
const fresh = () => sql("DELETE FROM settings WHERE key = 'drishti_sync'");
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TA = await firstIn("Tara Lead", "tara@purview-healthcare.com");
await sql("UPDATE sessions SET expires_at = expires_at + ?", 400 * 86400000);
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => /Sunrise/.test(c.name)), lake = clients.find((c) => /Lakeview/.test(c.name));
const IST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const at = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };
const runJob = (ms, cron = "17 * * * *") => at(ms, async () => { const ps = []; await rig.worker.default.scheduled({ cron }, { ...rig.backend.env, ...rig.liveEnv, DEMO: false, DB: rig.backend.env.DB }, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); });
const NOW = IST(2026, 11, 10, 12), TODAY = { today: "2026-11-10" };
let r;

S("N-18: a client Drishti has only weeks for: its score is said to be a week's");
{ // Sunrise: only a week in Drishti (Week of 2 Nov 2026), no month. Lakeview: October 2026.
  DR_CLIENTS = [drClient("d-sun", "Sunrise Eye Care", [period("week", "p-w45", "Week of 2 Nov 2026", "2026-11-02", "2026-11-08", { arAging: cell(0.1), collectionRate: cell(0.9) })]),
    drClient("d-lake", "Lakeview Dental Group", [month("p-l-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.1), collectionRate: cell(0.9) })])];
  await fresh();
  const inv = await at(NOW, () => A("inventory.status", TODAY));
  const ws = inv.clients.find((c) => c.client_id === sun.id), ms = inv.clients.find((c) => c.client_id === lake.id);
  ok("N-18: Inventory status gets the period with each client's Drishti score (Sunrise: a week, Lakeview: a month)", ws.drishti && ws.drishti.kind === "week" && ws.drishti.label === "Week of 2 Nov 2026" && ms.drishti && ms.drishti.kind === "month", { sun: ws.drishti, lake: ms.drishti });
  ok("N-18: the page names the week beside a week's score, in Drishti's words", app.drPerNote(ws.drishti) === "week of 2 Nov 2026", app.drPerNote(ws.drishti));
  ok("N-18: and says nothing more for a month's score (the last finished month, as before)", app.drPerNote(ms.drishti) === "" && app.drPerNote(null) === "", app.drPerNote(ms.drishti));
  const one = await at(NOW, () => A("inventory.status", { client_id: sun.id, ...TODAY }));
  ok("N-18: the same for one client picked (Last scorecard in Drishti)", one.clients.length === 1 && one.clients[0].drishti && one.clients[0].drishti.kind === "week", one.clients[0] && one.clients[0].drishti);
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("N-18: both places that show it on Inventory status use it (By client, Last scorecard in Drishti)", (src.match(/drPerNote\(c\.drishti\)/g) || []).length >= 1 && (src.match(/drPerNote\(client\.drishti\)/g) || []).length >= 1);
  // the Monday digest scores months only: Sunrise has no month, so it is "no month scored", not "not scored"
  const sp = (await at(NOW, () => A("digest.spans", {}))).spans.find((x) => x.clients.some((c) => c.id === sun.id));
  const mail = await at(NOW, () => A("digest.preview", { span: sp.key }));
  ok("N-18: the digest email says Sunrise has no month scored in Drishti (it has a week), not 'not scored'", mail.text.includes("- Sunrise Eye Care: SLA (no month scored in Drishti)") && mail.html.includes("no month scored") && !/not scored/.test(mail.html + mail.text), mail.text.split("\n").filter((l) => /Sunrise/.test(l)));
  ok("N-18: and the digest page's card says No month scored in Drishti yet", src.includes(': "No month scored in Drishti yet"}') && !src.includes("Not scored in Drishti yet"));
  await fresh();
}

S("N-19: README says what Inventory status shows");
{ const rd = fs.readFileSync(REPO + "/README.md", "utf8"), a = rd.indexOf("#### Dashboard › Inventory status"), part = rd.slice(a, rd.indexOf("- **Managers side by side**", a));
  ok("N-19: no 'pulling it down', 'KPIs in the red' or 'SLA score, average' column or tile there: the page has none", a > 0 && !/pulling it down|KPIs in the red|SLA score, average/i.test(part), part.slice(0, 200));
  ok("N-19: it names what the page has: where the inventory stands, pace to clear, SLA checks, do these first, by client worst first", ["where the inventory stands", "pace to clear", "SLA checks", "do these first", "by client, worst"].every((x) => part.includes(x)), part.slice(0, 300));
  ok("N-19 (N-18): and that a client Drishti has only weeks for shows the last week's score, said so", /only weeks for, it is the last week's score, and the page\s+says so/.test(part), part.slice(-400));
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("N-19: the page itself: the Portfolio table with its own SLA and Pulling it down columns is only used in its fixed form, which leaves them out", (src.match(/<ClientReportsTab /g) || []).length === 1 && /<ClientReportsTab \{\.\.\.props\} fixed=\{/.test(src));
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
