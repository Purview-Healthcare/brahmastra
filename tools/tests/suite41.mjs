/* Suite 41: regression checks for the bug-test fixes in the SLA area (tester G: Drishti and Brahmastra's SLA views). One or more
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

S("G-07: the TAT Report in the SLA & KPI folder cannot be taken for the Escalation Tracker");
{ // two November hand-offs of Sunrise, then the job on 1 December writes November's TAT Report and Escalation Tracker copy
  const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 5 })).rows;
  const ho = (id, c, dept, created, due, done) => sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, lead_id, done_at, done_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, c.id, sun.id, dept, "complete", created, "Abe Agent", due, U("Tara Lead").id, done, "");
  await ho("g07-a", pool[0], "posting", IST(2026, 11, 2, 9), IST(2026, 11, 3, 9), IST(2026, 11, 3, 8));
  await ho("g07-b", pool[1], "submission", IST(2026, 11, 4, 9), IST(2026, 11, 5, 9), IST(2026, 11, 6, 11));
  await runJob(IST(2026, 12, 1, 10));
  const fileOf = (re) => [...OD.items.values()].find((x) => x.kind === "file" && re.test(x.name) && /SLA & KPI/.test(pathOf(x.id)));
  const tat = fileOf(/^TAT Report - Sunrise Eye Care - Nov 2026\.xlsx$/), esc = fileOf(/^Escalation Tracker - Sunrise Eye Care - Nov 2026\.xlsx$/);
  const tb = tat ? OD.books.get(tat.id) : { name: "", rows: [[]] }, eb = esc ? OD.books.get(esc.id) : { name: "", rows: [[]] };
  const head = (tb.rows[0] || []).map((v) => String(v == null ? "" : v)), named = head.filter(Boolean);
  ok("G-07: the TAT Report is written next to the Escalation Tracker copy, one row per hand-off", !!tat && !!esc && tb.rows.length === 3 && tb.rows[1][0] === pool[0].claim_no, { tat: tat && pathOf(tat.id), rows: tb.rows.length });
  ok("G-07: its desk column is called Desk (the desks under it), not Department", named.join("|") === "Claim #|Desk|Sent to the desk (IST)|Due by (IST)|Closed (IST)|Within TAT|Working hours taken|TAT (working hours)" && tb.rows[1][1] === "Payment Posting" && tb.rows[2][1] === "Submission", named);
  // what Drishti's file matching looks for to call a file an Escalation Tracker: a Department or an SR No column
  const escLike = (h) => /department|\bdept\b/i.test(h) || /\bsr\s*no|serial|ticket|\bsr\b/i.test(h);
  ok("G-07: no column of it reads as an Escalation Tracker's (no Department, no SR No)", !head.some(escLike), head.filter(escLike));
  ok("G-07: the tracker template's other columns are gone from its header row, and its tab is not called Escalations", head.slice(8).every((v) => v === "") && !/escalation/i.test(tb.name), { after: head.slice(8).filter(Boolean), tab: tb.name });
  const eh = (eb.rows[0] || []).map(String);
  ok("G-07: the Escalation Tracker copy keeps SR No and Department, so Drishti still takes that file for the tracker", eh[0] === "SR No" && eh[1] === "Department" && eh.some(escLike), eh.slice(0, 4));
}

S("G-13: KPIs in the red counts KPIs only");
{ // Sunrise: two KPIs red, one green, and one SLA task line red. Lakeview: KPIs green, one SLA task line red.
  DR_CLIENTS = [
    drClient("d-sun", "Sunrise Eye Care", [month("p-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.3), collectionRate: cell(0.5), denialRate: cell(0.04) }, [{ name: "Production SLA", received: 100, achieved: 50 }])]),
    drClient("d-lake", "Lakeview Dental Group", [month("p-l-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.1), collectionRate: cell(0.9) }, [{ name: "Production SLA", received: 100, achieved: 60 }])])];
  await fresh();
  const pf = await A("portfolio.overview", TODAY);
  let kpiRed = 0, lineRed = 0; const names = [];
  for (const c of [sun, lake]) { const s = await A("sla.scorecard", { client_id: c.id, kind: "month", ...TODAY });
    for (const i of s.items) { if (i.status !== "miss") continue; if (i.kind === "KPI") { kpiRed++; names.push(i.name); } else lineRed++; } }
  ok("G-13: the scorecards have 2 red KPIs and 2 red SLA lines (the made-up data)", kpiRed === 2 && lineRed === 2, { kpiRed, lineRed });
  ok("G-13: the Portfolio's KPIs in the red is the 2 KPIs, not the 4 red lines", pf.drishti.red === kpiRed, pf.drishti);
  ok("G-13: it names the red KPIs only, and counts only the client that has one", pf.drishti.red_names.join("|") === names.join("|") && !pf.drishti.red_names.includes("Production SLA") && pf.drishti.clients_red === 1, pf.drishti);
  const sm = await A("sla.summary", TODAY);
  ok("G-13: sla.summary's red count and names are the same KPIs", sm.totals.red === kpiRed && sm.totals.red_names.join("|") === names.join("|"), sm.totals);
  const row = pf.rows.find((x) => x.client_id === lake.id);
  ok("G-13: a red SLA line still pulls its client's score down and shows under Pulling it down", row && row.drishti && row.drishti.counts.miss === 1 && row.drishti.drags.some((x) => x.name === "Production SLA"), row && row.drishti);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
