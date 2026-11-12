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

S("G-05: one client and month, one SLA score on every page");
{ // Drishti scores Sunrise's October 67% (2 of 3 KPIs green). Before Brahmastra reads it, its team lead typed 85 for October on the
  // month-end step, and 70 for September (Drishti has no September). Lakeview has only a week in Drishti and 84 typed for October.
  const oct = (deny) => month("p-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.1), collectionRate: cell(0.9), denialRate: cell(deny) });
  DR_CLIENTS = [drClient("d-sun", "Sunrise Eye Care", [oct(0.2)]),
    drClient("d-lake", "Lakeview Dental Group", [period("week", "p-w44", "Week of 26 Oct 2026", "2026-10-26", "2026-11-01", { arAging: cell(0.1) })])];
  await sql("DELETE FROM client_monthend WHERE step = 'sla'"); await fresh();
  await at(NOW, () => TA("monthend.set", { client_id: sun.id, month: "2026-10", step: "sla", done: true, score: 85 }));
  await at(NOW, () => TA("monthend.set", { client_id: sun.id, month: "2026-09", step: "sla", done: true, score: 70 }));
  await at(NOW, () => A("monthend.set", { client_id: lake.id, month: "2026-10", step: "sla", done: true, score: 84 }));
  const sc = await at(NOW, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  const pf = await at(NOW, () => A("portfolio.overview", TODAY)), prow = pf.rows.find((x) => x.client_id === sun.id);
  const mg = await at(NOW, () => A("portfolio.managers", TODAY)), mona = mg.rows.find((m) => m.name === "Mona Manager");
  const co = await at(NOW, () => A("client.overview", { client_id: sun.id, tz_offset_min: 330, ...TODAY }));
  const step = co.monthend.steps.find((x) => x.key === "sla");
  ok("G-05: the scorecard and the Portfolio's SLA column say 67", sc.score === 67 && prow.drishti && prow.drishti.score === 67, [sc.score, prow.drishti && prow.drishti.score]);
  ok("G-05: Client 360's SLA is October 67 (not the 85 typed), and its health line says 67", co.sla && co.sla.score === 67 && co.sla.month === "2026-10" && co.reasons.some((x) => x.text === "SLA 67% for October 2026, below 90%") && !co.reasons.some((x) => /85%/.test(x.text)), { sla: co.sla, reasons: co.reasons });
  ok("G-05: the Portfolio row's own reason says 67 too", prow.sla && prow.sla.score === 67 && prow.reasons.includes("SLA 67% for October 2026, below 90%") && !prow.reasons.some((x) => /SLA 85%/.test(x)), { sla: prow.sla, reasons: prow.reasons });
  ok("G-05: the change on Client 360 is against September's typed 70 (a month Drishti has not scored keeps its typed score)", co.sla.prev === 70, co.sla);
  ok("G-05: the month-end step shows 67, and says 85 was typed", step && step.done && step.score === 67 && step.typed === 85 && !step.by_itself, step);
  const kept = await rows("SELECT month, score, auto FROM client_monthend WHERE client_id = ? AND step = 'sla' ORDER BY month", sun.id);
  ok("G-05: what was typed stays in the month-end table as typed", kept.length === 2 && kept[1].score === 85 && kept[1].auto === 0 && kept[0].score === 70, kept);
  const lk = await at(NOW, () => A("client.overview", { client_id: lake.id, tz_offset_min: 330, ...TODAY }));
  ok("G-05: a client Drishti has no month for keeps the score typed at month-end (Lakeview October 84)", lk.sla && lk.sla.score === 84 && lk.sla.month === "2026-10", lk.sla);
  ok("G-05: Managers side by side's SLA avg is the Portfolio's (Drishti's months: 67), not 85 or (67 + 84) / 2", mona && mona.sla_avg === 67 && mona.sla_avg === pf.drishti.avg, { mona: mona && mona.sla_avg, portfolio: pf.drishti.avg });
  const sp = (await at(NOW, () => A("digest.spans", {}))).spans.find((x) => x.clients.some((c) => c.id === sun.id) && x.clients.some((c) => c.id === lake.id));
  const dd = await at(NOW, () => A("digest.dashboard", { span: sp.key })), dsun = dd.clients.find((x) => x.id === sun.id);
  ok("G-05: the Monday digest for Mona's span: Sunrise 67, average 67, the same as Managers side by side", dsun.card && dsun.card.score === 67 && dd.rollup.sla_avg === 67 && dd.rollup.sla_avg === mona.sla_avg, { card: dsun.card && dsun.card.score, avg: dd.rollup.sla_avg });
  ok("G-05: the digest's attention lines name 67 for Sunrise, never the 85 typed", dd.rollup.attention.some(([, c, x]) => c === "Sunrise Eye Care" && /SLA 67%/.test(x)) && !dd.rollup.attention.some(([, , x]) => /SLA 85%/.test(x)), dd.rollup.attention);
  // Drishti re-scores October to 100%: every page follows
  DR_CLIENTS[0].periods = [oct(0.04)]; await fresh();
  const co2 = await at(NOW, () => A("client.overview", { client_id: sun.id, tz_offset_min: 330, ...TODAY })), mg2 = await at(NOW, () => A("portfolio.managers", TODAY));
  const step2 = co2.monthend.steps.find((x) => x.key === "sla");
  ok("G-05: Drishti re-scores October to 100: Client 360, its step and Managers side by side follow", co2.sla.score === 100 && !co2.reasons.some((x) => /SLA \d/.test(x.text)) && step2.score === 100 && step2.typed === 85 && mg2.rows.find((m) => m.name === "Mona Manager").sla_avg === 100, { sla: co2.sla, step: step2 });
  // no Drishti at all (not answering, nothing read yet): the typed scores are all there is, as before
  drDown = true; await fresh();
  const co3 = await at(NOW + 60000, () => A("client.overview", { client_id: sun.id, tz_offset_min: 330, ...TODAY })), mg3 = await at(NOW + 60000, () => A("portfolio.managers", TODAY));
  ok("G-05: with nothing read from Drishti, Client 360 and Managers use the typed scores (85; (85 + 84) / 2)", co3.sla.score === 85 && mg3.rows.find((m) => m.name === "Mona Manager").sla_avg === 84.5, { sla: co3.sla, mgr: mg3.rows.map((m) => [m.name, m.sla_avg]) });
  drDown = false; await fresh();
}

S("G-06: Drishti does not answer: the message says when Brahmastra asks it again, and it does");
{ DR_CLIENTS = [drClient("d-sun", "Sunrise Eye Care", [month("p-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.1), collectionRate: cell(0.9) })])];
  await fresh(); drDown = true;
  const T0 = IST(2026, 11, 10, 12);
  const a = await at(T0, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  ok("G-06: Drishti not answering (nothing read yet): an error with when it failed and when Brahmastra asks again, a minute later", a.state === "error" && a.failed_at === T0 && a.retry_at === T0 + 60000, a);
  ok("G-06: the error is one plain sentence, with no 'try again in a minute' (Brahmastra decides when it asks)", a.error === "Drishti's server did not answer." && !/try again/i.test(a.error), a.error);
  drDown = false; const c0 = drCalls;
  const b = await at(T0 + 30000, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  ok("G-06: within that minute Drishti is not asked again, and the answer says so", b.state === "error" && drCalls === c0 && b.retry_at === T0 + 60000, [b.state, drCalls - c0]);
  const c = await at(T0 + 61000, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  ok("G-06: a minute later Drishti is asked again, and the scorecard reads (Drishti is back)", c.state === "ok" && drCalls === c0 + 1 && c.score === 100, [c.state, drCalls - c0]);
  const note = app.drReadNote(a);
  ok("G-06: the page names when it failed and from when Brahmastra asks again, once, with no 'try again in a minute' and no 'in a few minutes'", /^Brahmastra could not read Drishti's scorecard at .+: Drishti's server did not answer\. It asks Drishti again from .+: open the scorecard again then\.$/.test(note) && !/try again in a minute|few minutes/i.test(note) && (note.match(/did not answer/g) || []).length === 1, note);
  // (T0 is not today, so the page names the day too, as fmtWhen does)
  const late = app.drReadNote({ ...a, failed_at: T0 + 40000, retry_at: T0 + 100000 });
  ok("G-06: the time to ask again is never earlier than the minute (failed at 12:00:40: from 12:02)", late.includes("from " + app.fmtWhen(T0 + 120000) + ":") && late.includes("at " + app.fmtWhen(T0 + 40000) + ":"), late);
  await fresh(); drDown = true;
  const pf = await at(T0, () => A("portfolio.overview", TODAY));
  ok("G-06: the Portfolio has the same times for its tiles", pf.drishti.state === "error" && pf.drishti.failed_at === T0 && pf.drishti.retry_at === T0 + 60000, pf.drishti);
  drDown = false; await fresh();
}

S("G-14: Drishti stops answering after a good read: every SLA page says its figures are old");
{ const oct = (deny) => month("p-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.1), collectionRate: cell(0.9), denialRate: cell(deny) });
  DR_CLIENTS = [drClient("d-sun", "Sunrise Eye Care", [oct(0.2)])];
  await fresh(); drDown = false;
  const T0 = IST(2026, 11, 10, 12), T3 = T0 + 3 * 3600000;
  const a = await at(T0, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  ok("G-14: a good read: October 67%, nothing old about it", a.state === "ok" && a.score === 67 && !a.stale && a.at === T0 && !app.drStaleNote(a), [a.state, a.score, a.stale]);
  DR_CLIENTS[0].periods = [oct(0.04)]; drDown = true;   // Drishti re-scores October to 100%, then stops answering
  const b = await at(T3, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  ok("G-14: three hours later the scorecard still has the read of 12:00, and says it is old: stale, read at, failed at, asked again at", b.state === "ok" && b.score === 67 && b.stale === true && b.at === T0 && b.failed_at === T3 && b.retry_at === T3 + 60000, { state: b.state, score: b.score, stale: b.stale, at: b.at, failed_at: b.failed_at });
  const note = app.drStaleNote(b);
  ok("G-14: the page says Drishti did not answer, from when the figures are, and when Brahmastra asks again", note.startsWith("Drishti did not answer at " + app.fmtWhen(T3) + ", so these are its figures as Brahmastra read them at " + app.fmtWhen(T0) + ".") && /asks Drishti again from/.test(note), note);
  const pf = await at(T3 + 1000, () => A("portfolio.overview", TODAY));
  ok("G-14: the Portfolio knows it too (its SLA tile says from when)", pf.drishti.state === "ok" && pf.drishti.stale === true && pf.drishti.at === T0, pf.drishti);
  const sp = (await at(T3 + 1000, () => A("digest.spans", {}))).spans.find((x) => x.clients.some((c) => c.id === sun.id));
  const dd = await at(T3 + 2000, () => A("digest.dashboard", { span: sp.key }));
  const mail = await at(T3 + 3000, () => A("digest.preview", { span: sp.key }));
  const said = "Drishti did not answer when this digest was made, so the SLA scores are from Brahmastra's last read of Drishti, Nov 10 12:00 IST.";
  ok("G-14: the Monday digest page and its email say the SLA scores are from the last read, with when", dd.notices.includes(said) && mail.text.includes(said) && mail.html.includes(said.replace(/'/g, "&#39;")), { notices: dd.notices, text: mail.text.split("\n").slice(0, 5) });
  drDown = false;
  const c = await at(T3 + 61000, () => A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY }));
  const mail2 = await at(T3 + 62000, () => A("digest.preview", { span: sp.key }));
  ok("G-14: Drishti back a minute later: the new figures (100%), nothing old said any more", c.state === "ok" && c.score === 100 && !c.stale && !app.drStaleNote(c) && !mail2.text.includes("did not answer"), [c.score, c.stale]);
  await fresh();
}

S("G-08: Drishti's 12-hour session is made again when it is near its end");
{ // (the SLA tab itself, Load again and Drishti dropping its token, is the browser proof repro-G-08)
  const T0 = IST(2026, 11, 10, 12);
  await at(T0, () => A("auth.me"));   // the page's own sign-in, as the admin
  const r1 = await at(T0, () => app.drishtiSignIn());
  ok("G-08: signing in to Drishti leaves its token where Drishti's page reads it", r1.token && app.localStorage.getItem("drishti:token:v1") === r1.token && r1.name === "Admin", r1.name);
  ok("G-08: the page can tell when that session ends: 12 hours on", app.drTokenEnd(r1.token) === T0 + 12 * 3600000, app.drTokenEnd(r1.token) - T0);
  const r2 = await at(T0 + 13 * 3600000, () => app.drishtiSignIn());
  ok("G-08: signing in again 13 hours later gives a new session, 12 hours from then, in the same place", r2.token !== r1.token && app.drTokenEnd(r2.token) === T0 + 25 * 3600000 && app.localStorage.getItem("drishti:token:v1") === r2.token, app.drTokenEnd(r2.token) - T0);
  ok("G-08: an unreadable token counts as ended (so it is made again)", app.drTokenEnd("") === 0 && app.drTokenEnd("x.y") === 0);
}

S("G-09: Drishti not answering: the SLA tab does not send people to a sign-in that cannot work");
{ drDown = true;
  const e = await T(() => A("reports.drishtiSession"));
  ok("G-09: signing in to Drishti fails with a 502 that says only what happened", !e.ok && e.status === 502 && e.e === "Drishti's server did not answer.", e);
  const note = app.drSsoNote({ state: "error", status: e.status, msg: e.e });
  ok("G-09: the SLA tab says Drishti's server did not answer and to use Load again in a minute, not 'sign in below'", note === "Drishti's server did not answer. Use Load again (the ↻ button above) in a minute." && !/sign in below/i.test(note), note);
  const other = app.drSsoNote({ state: "error", status: 400, msg: "Nobody you report to in Brahmastra is a manager in Drishti yet, so Drishti cannot place you. Ask Drishti's Admin to add your manager on Drishti's People tab." });
  ok("G-09: any other reason is said as it is, without pointing to Drishti's own sign-in either", /^Nobody you report to/.test(other) && !/sign in below|Load again/i.test(other), other);
  ok("G-09: nothing to say when Drishti opened signed in", app.drSsoNote({ state: "ok" }) === "");
  drDown = false; await fresh();
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("G-09: no SLA tab wording sends people to sign in below when the sign-in failed", !/You can still sign in below/.test(src) && /sso\.state === "error" \? <><i className="rh-dot off" \/>Not signed in to Drishti/.test(src));
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
