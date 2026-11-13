/* Suite 48: bug test round 2, tester K's findings (fixer RK). Uploads that lose or mix up work (an upload part writing back a state
   it read a moment earlier, an upload stopped half way, two loads of the same file at once), allocation history at the same moment,
   OneDrive names for long client names, the floor feed's past days, comp off on Live status, the digest's AR for its week, text cut
   without a word, and the SAAG reference page. Made-up people and data only. */
import { makeRig } from "./rig.mjs";
import vm from "vm";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const feed = [P({ emp_id: "RM1", name: "Manager Rk One", position: "Manager", project: "", email: "rk-mgr@purview-healthcare.com" }),
  P({ emp_id: "RL1", name: "Lead Rk One", position: "Team Lead", reports_to: "Manager Rk One", email: "rk-lead1@purview-healthcare.com" }),
  P({ emp_id: "RL2", name: "Lead Rk Two", position: "Team Lead", reports_to: "Manager Rk One", email: "rk-lead2@purview-healthcare.com" }),
  P({ emp_id: "RA1", name: "Biller Rk One", reports_to: "Lead Rk One", email: "rk-b1@purview-healthcare.com" }),
  P({ emp_id: "RA2", name: "Biller Rk Two", reports_to: "Lead Rk Two", email: "rk-b2@purview-healthcare.com" })];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
// ---- a small fake of Microsoft Graph (as suite13): folders, files, links, one worksheet per workbook ----
const OD = { items: new Map(), seq: 0, rows: new Map() };
const odMk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it); if (kind === "file") OD.rows.set(id, []); return it; };
const odChildOf = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const odOut = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const path = decodeURIComponent(new URL(url).pathname.replace(/^\/v1\.0/, "")); let r;
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (odChildOf("root", b.name)) return J({}, 409); return J(odOut(odMk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/([^/]+)$/))) { const it = odChildOf("root", r[1]); return it ? J(odOut(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (odChildOf(r[1], b.name)) return J({}, 409); return J(odOut(odMk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://share.example/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (odChildOf(r[1], r[2])) return J({}, 409); return J(odOut(odMk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = odChildOf(r[1], r[2].replace(/:$/, "")); return it ? J(odOut(it)) : J({}, 404); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: [{ id: "s1", name: "Sheet1" }] });
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/usedRange/))) { const rows = OD.rows.get(r[1]) || []; return J({ rowCount: Math.max(1, rows.length), address: "Sheet1!A1:Z" + Math.max(1, rows.length), values: rows.length ? rows : [[""]] }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range/))) { const b = JSON.parse(init.body); if (b.values) (OD.rows.get(r[1]) || []).push(...b.values); return J({}); }
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
// Shastra's floor and live feeds: made-up rows the checks set as they go
const FLOOR = { rows: [], calls: 0 }, LIVE = { rows: [], day: "" };
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_floor")) { FLOOR.calls++; const b = JSON.parse(init.body); return J({ ok: true, rows: FLOOR.rows.filter((r) => r.date >= b.p_from && r.date <= b.p_to) }); }
  if (url.includes("brahmastra_live")) return J({ ok: true, day: LIVE.day, rows: LIVE.rows });
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
let A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {};
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name), passHash: await sha("pw-" + email) }); TOK[name] = (await login(email, "pw-" + email)).token; return as(TOK[name]); };
let L1 = await firstIn("Lead Rk One", "rk-lead1@purview-healthcare.com"), L2 = await firstIn("Lead Rk Two", "rk-lead2@purview-healthcare.com");
let B1 = await firstIn("Biller Rk One", "rk-b1@purview-healthcare.com");
// a sign-in with the clock moved weeks ahead clears the sessions that look expired then: everyone signs in again afterwards
const signInAgain = async () => { A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  for (const [n, e] of [["Lead Rk One", "rk-lead1@purview-healthcare.com"], ["Lead Rk Two", "rk-lead2@purview-healthcare.com"], ["Biller Rk One", "rk-b1@purview-healthcare.com"]]) TOK[n] = (await login(e, "pw-" + e)).token;
  L1 = as(TOK["Lead Rk One"]); L2 = as(TOK["Lead Rk Two"]); B1 = as(TOK["Biller Rk One"]); };
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
await A("clients.saveTeam", { client_id: sun.id, team: [U("Biller Rk One"), U("Biller Rk Two")] });
// hold the next database batch whose SQL matches re until release() is called, so another request lands between a read and its write
const realBatch = DB.batch.bind(DB);
const holdNext = (re) => { let release; const gate = new Promise((r) => { release = r; }); let armed = true;
  DB.batch = async (stmts) => { if (armed && stmts.some((s) => re.test(s.sql))) { armed = false; await gate; } return realBatch(stmts); };
  return () => release(); };
const unhold = () => { DB.batch = realBatch; };
const tick = () => new Promise((r) => setTimeout(r, 30));
const fileOf = (rows, extra = {}) => rows.map((c) => ({ match_key: c.match_key, claim_no: c.claim_no, account_no: c.account_no, patient: c.patient, payer: c.payer, dos: c.dos, balance: c.balance, billed: c.billed, cpt: c.cpt, provider: c.provider, status_class: "awaiting", tier: "Medium", priority: 40, ...extra }));
const COLS = "id, match_key, claim_no, account_no, patient, payer, dos, balance, billed, cpt, provider, location_id";
const poolOf = (n) => q(`SELECT ${COLS} FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL ORDER BY priority DESC LIMIT ?`, sun.id, n);
const REFRESH = /UPDATE claims SET location_id = COALESCE/;

S("K-08: an upload part keeps the state another person set between its read and its write");
{
  const pool = await poolOf(8);
  const release = holdNext(REFRESH);
  const up = L2("inventory.upload", { client_id: sun.id, location_id: pool[0].location_id, kind: "fresh", file_name: "rk-next-day.xlsx", rows_read: pool.length, claims: fileOf(pool), final: true, summary: {} });
  await tick();
  const al = await L1("alloc.apply", { client_id: sun.id, strategy: "smart", assignments: pool.map((c) => ({ id: c.id, user_id: U("Biller Rk One"), priority: 50, tier: "Medium" })) });
  release(); const ur = await up; unhold();
  const ids = pool.map((c) => c.id), rows = await q(`SELECT state, assigned_to FROM claims WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids));
  ok("K-08: claims a team lead allocates while an upload part refreshes them stay on the biller's list (none left 'open' on a biller's name)",
    al.applied === pool.length && rows.length === pool.length && rows.every((r) => r.state === "assigned" && r.assigned_to === U("Biller Rk One")), { applied: al.applied, rows });
  ok("K-08: the upload still refreshed those claims (counted as refreshed)", ur.updated === pool.length && ur.inserted === 0, ur);
  const list = (await B1("queue.list", {})).rows || [];
  ok("K-08: the biller's list has them", ids.every((id) => list.some((r) => r.id === id)), list.length);
}
{
  const more = await poolOf(3);
  await L1("alloc.apply", { client_id: sun.id, strategy: "smart", assignments: more.map((c) => ({ id: c.id, user_id: U("Biller Rk One"), priority: 50, tier: "Medium" })) });
  const nx = await B1("queue.next", {});
  const cur = (await q(`SELECT ${COLS} FROM claims WHERE id = ?`, nx.claim.id))[0];
  const release = holdNext(REFRESH);
  const up = L2("inventory.upload", { client_id: sun.id, location_id: cur.location_id, kind: "fresh", file_name: "rk-refresh.xlsx", rows_read: 1, claims: fileOf([cur]), final: true, summary: {} });
  await tick();
  const sv = await T(() => B1("queue.complete", { id: cur.id, saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" },
    note: { source: "Portal", findings: "Claim is in process per the payer portal, check again later", action: "follow up" } }));
  release(); await up; unhold();
  const after = (await q("SELECT state, follow_up_on FROM claims WHERE id = ?", cur.id))[0];
  ok("K-08: a claim the biller saves while an upload part refreshes it stays worked (completed, follow-up kept), not back 'in progress'",
    sv.ok && after.state === "completed" && !!after.follow_up_on, { save: sv.e, after });
}
{
  // a change the upload means still happens: an open claim the worked file gives a later follow-up waits for that date
  const [c] = await poolOf(1);
  const r = await L2("inventory.upload", { client_id: sun.id, location_id: c.location_id, kind: "worked", file_name: "rk-worked.xlsx", rows_read: 1, claims: fileOf([c], { last_worked_on: "2026-11-02", follow_up_on: "2099-01-15" }), final: true, summary: {} });
  const st = (await q("SELECT state, follow_up_on FROM claims WHERE id = ?", c.id))[0];
  const ev = (await q("SELECT data_json FROM claim_events WHERE claim_id = ? AND kind = 'refreshed' ORDER BY at DESC LIMIT 1", c.id))[0];
  ok("K-08: with nobody else on the claim, the worked file still moves an open claim to waiting for its follow-up, and its history names the change",
    r.updated === 1 && st.state === "completed" && st.follow_up_on === "2099-01-15" && /"state":\["open","completed"\]/.test(ev.data_json), { r, st, ev });
  // the same file while a team lead allocates the claim: the lead's change stays and the history names no change
  const [d] = await poolOf(1);
  const release = holdNext(REFRESH);
  const up = L2("inventory.upload", { client_id: sun.id, location_id: d.location_id, kind: "worked", file_name: "rk-worked-2.xlsx", rows_read: 1, claims: fileOf([d], { last_worked_on: "2026-11-02", follow_up_on: "2099-01-15" }), final: true, summary: {} });
  await tick();
  await L1("alloc.apply", { client_id: sun.id, strategy: "smart", assignments: [{ id: d.id, user_id: U("Biller Rk One"), priority: 50, tier: "Medium" }] });
  release(); await up; unhold();
  const st2 = (await q("SELECT state, assigned_to FROM claims WHERE id = ?", d.id))[0];
  const ev2 = (await q("SELECT data_json FROM claim_events WHERE claim_id = ? AND kind = 'refreshed' ORDER BY at DESC LIMIT 1", d.id))[0];
  ok("K-08: allocated during that upload, it stays with the biller and its history line names no state change", st2.state === "assigned" && st2.assigned_to === U("Biller Rk One") && ev2 && !/"changes"/.test(ev2.data_json), { st2, ev2 });
  // a closed claim the next file lists again is reopened and taken off the biller's name, as before
  const [e] = await poolOf(1);
  await sql("UPDATE claims SET state = 'closed', assigned_to = ?, state_reason = 'Closed by supervisor' WHERE id = ?", U("Biller Rk One"), e.id);
  const r3 = await L2("inventory.upload", { client_id: sun.id, location_id: e.location_id, kind: "fresh", file_name: "rk-reopen.xlsx", rows_read: 1, claims: fileOf([e]), final: true, summary: {} });
  const st3 = (await q("SELECT state, assigned_to, state_reason FROM claims WHERE id = ?", e.id))[0];
  ok("K-08: a closed claim listed again is still reopened into the pool by the upload", r3.reopened === 1 && st3.state === "open" && st3.assigned_to === null && /Reopened/.test(st3.state_reason), { r3, st3 });
}

S("K-10, K-11: an upload stopped half way says so");
{
  // claim numbers whose digits differ between files (a claim number is recognised by its digits)
  const mkFile = (pre, n, base) => { const out = []; for (let i = 1; i <= n; i++) out.push({ match_key: pre + i, claim_no: pre + (base + i), patient: "Test Patient " + pre + i, payer: "Test Payer " + (i % 5),
    dos: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), balance: 60 + (i % 90), status_class: "awaiting", tier: "Medium", priority: 30 }); return out; };
  const file = mkFile("RKH", 700, 7100000), loc = sun.locations[0].id;
  const up = (claims, name, onProgress) => { rig.app.setToken(TOK["Lead Rk Two"]); return rig.app.uploadClaims({ client_id: sun.id, location_id: loc, kind: "fresh", file_name: name, claims, summary: { included: claims.length }, rows_read: claims.length, onProgress }); };
  let parts = 0;
  const r1 = await up(file, "rk-stops.xlsx", () => { parts++; if (parts === 2) throw new Error("page reloaded"); }).then(() => ({ ok: true }), (e) => ({ ok: false, e: e.message }));
  const hist = async () => (await L2("inventory.batches", { client_id: sun.id })).batches.filter((b) => b.file_name === "rk-stops.xlsx").sort((a, b) => a.uploaded_at - b.uploaded_at);
  let h = await hist();
  ok("K-10: an upload stopped after 2 of its 3 parts is marked unfinished in Upload history, still loading right after its last part",
    !r1.ok && h.length === 1 && h[0].unfinished === true && h[0].stopped === false && h[0].inserted === 500 && h[0].rows_read === 700, h.map((b) => [b.unfinished, b.stopped, b.inserted, b.rows_read]));
  const real = Date.now; Date.now = () => real() + 4 * 60 * 1000;
  try { h = await hist(); } finally { Date.now = real; }
  ok("K-10: with no part for a few minutes it reads as stopped part way", h[0].unfinished === true && h[0].stopped === true, h.map((b) => [b.unfinished, b.stopped]));
  const r2 = await up(file, "rk-stops.xlsx");
  h = await hist();
  const n = (await q("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND match_key LIKE 'RKH%'", sun.id))[0].n;
  ok("K-10: the same file loaded again in full refreshes the 500 already loaded, adds the other 200, and that upload is finished",
    r2.inserted === 200 && r2.updated === 500 && n === 700 && h.length === 2 && h[1].unfinished === false && h[1].stopped === false && h[0].unfinished === true, { r2, n, h: h.map((b) => [b.unfinished, b.inserted, b.updated]) });
  const one1 = await up(mkFile("RKS", 40, 7200000), "rk-small.xlsx");
  const hs = (await L2("inventory.batches", { client_id: sun.id })).batches.find((b) => b.file_name === "rk-small.xlsx");
  ok("K-10: an upload in one part is finished as soon as it loads", one1.inserted === 40 && hs && hs.unfinished === false && hs.finished === 1, { one1, hs: hs && [hs.unfinished, hs.finished] });
  // an upload kept before this change has no mark of its own: it reads as finished
  await sql("INSERT INTO batches (id, client_id, kind, file_name, uploaded_by, uploaded_at, rows_read, inserted) VALUES ('rk-old-batch', ?, 'fresh', 'rk-older.xlsx', ?, ?, 10, 10)", sun.id, U("Lead Rk Two"), Date.now() - 86400000);
  const ho = (await L2("inventory.batches", { client_id: sun.id })).batches.find((b) => b.id === "rk-old-batch");
  ok("K-10: an upload from before the change reads as finished", ho && ho.unfinished === false && ho.stopped === false, ho && [ho.unfinished, ho.stopped, ho.finished]);
  // K-11: a part the server refuses half way: the page's loop stops with the server's message and how many claims loaded before it
  let bid = null;
  const r3 = await up(mkFile("RKF", 600, 7300000), "rk-refused.xlsx", () => { if (!bid) { bid = 1; return DB.prepare("DELETE FROM batches WHERE file_name = 'rk-refused.xlsx'").run(); } })
    .then(() => ({ ok: true }), (e) => ({ ok: false, msg: e.message, loaded: e.loaded }));
  ok("K-11: a part refused half way stops the upload with the server's message and the number of claims loaded before it (for the upload screen)",
    !r3.ok && r3.msg === "Unknown batch." && r3.loaded === 250, r3);
}

S("K-14: two loads of the same new claims at the same moment");
{
  const mk = (pre, n, base, extra = {}) => { const out = []; for (let i = 1; i <= n; i++) out.push({ match_key: pre + i, claim_no: pre + (base + i), patient: "Test Patient " + pre + i, payer: "Test Payer " + (i % 5),
    dos: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + (i % 50), status_class: "awaiting", tier: "Medium", priority: 30, ...extra }); return out; };
  const loc = sun.locations[0].id;
  const load = (L, claims, name, kind = "fresh") => L("inventory.upload", { client_id: sun.id, location_id: loc, kind, file_name: name, rows_read: claims.length, claims, final: true, summary: {} });
  const orphans = async () => (await q("SELECT COUNT(*) AS n FROM claim_events e WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.id = e.claim_id)"))[0].n;
  const orphan0 = await orphans();
  // lead 2's part reads the claims (none yet), then lead 1's load of the same file lands before lead 2's part writes
  const file = mk("RKD", 120, 7400000);
  let release = holdNext(/INSERT INTO claims \(id, client_id/);
  const p2 = T(() => load(L2, file, "rk-same.xlsx"));
  await tick();
  const r1 = await T(() => load(L1, file, "rk-same.xlsx"));
  release(); const r2 = await p2; unhold();
  const n = (await q("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND match_key LIKE 'RKD%'", sun.id))[0].n;
  const hist = (await L2("inventory.batches", { client_id: sun.id })).batches.filter((b) => b.file_name === "rk-same.xlsx");
  ok("K-14: the second load of the same new file at the same moment finishes (no 'Server error.'): it refreshes the claims the first one added",
    r1.ok && r2.ok && r1.r.inserted === 120 && r2.r.inserted === 0 && r2.r.updated === 120 && n === 120, { r1: r1.ok ? r1.r : r1.e, r2: r2.ok ? r2.r : r2.e, n });
  ok("K-14: Upload history shows two real uploads (new 120 and refreshed 120), both finished", hist.length === 2 && hist.some((b) => b.inserted === 120 && b.updated === 0) && hist.some((b) => b.inserted === 0 && b.updated === 120) && hist.every((b) => !b.unfinished),
    hist.map((b) => [b.inserted, b.updated, b.unfinished]));
  ok("K-14: no history line is left behind for a claim that was not added", (await orphans()) === orphan0, (await orphans()) - orphan0);
  // a worked file whose part meets claims another load added: half of it new, half added by the other load a moment before
  const wf = mk("RKW", 60, 7500000, { last_worked_on: "2026-11-02", file_comments: "Called the payer, claim in process" });
  release = holdNext(/INSERT INTO claims \(id, client_id/);
  const p3 = T(() => load(L2, wf, "rk-worked-same.xlsx", "worked"));
  await tick();
  await load(L1, wf.slice(0, 30), "rk-worked-half.xlsx", "worked");
  release(); const r3 = await p3; unhold();
  const nw = (await q("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND match_key LIKE 'RKW%'", sun.id))[0].n;
  const fw = (await q("SELECT COUNT(*) AS n FROM claim_events e JOIN claims c ON c.id = e.claim_id WHERE c.match_key LIKE 'RKW%' AND e.kind = 'file_work' AND e.text = 'rk-worked-same.xlsx'"))[0].n;
  ok("K-14: a worked file meeting claims another load added: 30 new, 30 refreshed, each claim once with this file's entry in its history",
    r3.ok && r3.r.inserted === 30 && r3.r.updated === 30 && nw === 60 && fw === 60 && (await orphans()) === orphan0, { r3: r3.ok ? r3.r : r3.e, nw, fw, orphans: (await orphans()) - orphan0 });
}

S("K-12: client names in OneDrive (Production file names keep the month; two clients never share a folder)");
{
  const me = (await A("auth.me")).user, biller = U("Biller Rk One");
  const profile = { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: me.id } } };
  const newClient = (name, code) => T(() => A("clients.save", { name, code, locations: ["Main"], profile }));
  const long = "Rk Valley Eye Care Associates of the Northern Plains Ophthalmology and Retina Group";   // 83 characters
  const okLong = await newClient(long + " - North", "RKN");
  const twinLong = await newClient(long + " - South", "RKS");
  ok("K-12: a second client whose name is the same as another's in its first 80 characters is refused, naming the other client",
    okLong.ok && !twinLong.ok && twinLong.e.includes(long + " - North") && /OneDrive/.test(twinLong.e), twinLong.e);
  const okSlash = await newClient("Rk Hill/Vale Pediatrics", "RKH");
  const twinSlash = await newClient("Rk Hill Vale Pediatrics.", "RKV");
  ok("K-12: a client whose name differs from another only by / : ? or a final dot is refused (OneDrive would give them one folder)", okSlash.ok && !twinSlash.ok && /Rk Hill\/Vale Pediatrics/.test(twinSlash.e), twinSlash.e);
  const plain = await newClient("Rk Meadow Dental", "RKM");
  const cl = (await A("clients.list")).clients;
  const lc = cl.find((c) => c.name === long + " - North"), sc = cl.find((c) => c.name === "Rk Hill/Vale Pediatrics"), pc = cl.find((c) => c.name === "Rk Meadow Dental");
  const ren = await T(() => A("clients.save", { id: pc.id, name: "Rk Hill:Vale Pediatrics" }));
  const renSelf = await T(() => A("clients.save", { id: sc.id, name: "Rk Hill Vale Pediatrics" }));
  ok("K-12: renaming a client into another's OneDrive name is refused; a client may still change its own name's punctuation", plain.ok && !ren.ok && /OneDrive/.test(ren.e) && renSelf.ok, { ren: ren.e, renSelf: renSelf.ok || renSelf.e });
  await A("clients.save", { id: sc.id, name: "Rk Hill/Vale Pediatrics" });
  // AR entries in November on a long-named client and a short-named one, and one more on the long-named one in December
  rig.liveEnv.DEMO = false;
  const work = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal, EOB requested", action: "follow up" } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const entry = async (c, key, who) => {
    await who.A("clients.saveTeam", { client_id: c.id, team: [biller] });
    await who.A("inventory.upload", { client_id: c.id, location_id: c.locations[0].id, kind: "fresh", file_name: "rk-one-claim.xlsx", rows_read: 1, final: true, summary: {},
      claims: [{ match_key: key, claim_no: key, patient: "Test Patient " + key, payer: "Test Payer", dos: "2026-10-01", balance: 120, status_class: "awaiting", tier: "Medium", priority: 30 }] });
    const id = (await q("SELECT id FROM claims WHERE client_id = ? AND match_key = ?", c.id, key))[0].id;
    await who.A("alloc.reassign", { ids: [id], user_id: biller });
    await who.B("queue.complete", { id, ...work });
  };
  const B1t = TOK["Biller Rk One"];
  try {
    await entry(lc, "RKL-8800001", { A, B: as(B1t) }); await entry(pc, "RKP-8800002", { A, B: as(B1t) }); await sleep(600);
    const realNow = Date.now; Date.now = () => Date.parse("2026-12-02T05:30:00Z");
    try {
      const A2 = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token), B2 = as((await login("rk-b1@purview-healthcare.com", "pw-rk-b1@purview-healthcare.com")).token);
      await entry(lc, "RKL-8800003", { A: A2, B: B2 }); await sleep(600);
    } finally { Date.now = realNow; }
  } finally { rig.liveEnv.DEMO = true; await signInAgain(); }
  const files = [...OD.items.values()].filter((x) => x.kind === "file" && /^AR Production/.test(x.name)).map((x) => x.name);
  ok("K-12: a name that fits keeps exactly today's file name", files.includes("AR Production - Rk Meadow Dental - Nov 2026.xlsx"), files);
  const lf = files.filter((f) => f.startsWith("AR Production - Rk Valley"));
  ok("K-12: a long client name keeps the month: one AR Production file for November and one for December, each 80 characters or less before .xlsx",
    lf.length === 2 && lf.some((f) => f.endsWith(" - Nov 2026.xlsx")) && lf.some((f) => f.endsWith(" - Dec 2026.xlsx")) && lf.every((f) => f.length <= 85), lf);
  const folders = (await q("SELECT od_folder_id FROM clients WHERE name LIKE 'Rk %' AND od_folder_id IS NOT NULL")).map((r) => r.od_folder_id);
  ok("K-12: each client has a folder of its own", folders.length >= 2 && new Set(folders).size === folders.length, folders);
}

S("K-07: Team status picks up a past day Shastra corrected, and people linked to Shastra later");
{
  const fr = (emp, date, tof) => ({ emp_id: emp, email: "", date, status: "present", tof_min: tof, idle_min: 0, locked_min: 0, logged_min: tof, break_min: 0, open: false, guard: false });
  const realNow = Date.now, at = (iso) => { Date.now = () => Date.parse(iso); };
  const floorOf = async (who, day, today) => { const t = await A("team.status", { from: day, to: day, today, tz_offset_min: 330 }); const r = t.rows.find((x) => x.name === who); return r ? r.on_floor_min : undefined; };
  try {
    // Mon 9 Nov: Shastra closed the biller's shift at 12:00 by mistake (180 minutes); the biller of a new joiner not in the roster yet
    FLOOR.rows = [fr("RA1", "2026-11-09", 180), fr("RA7", "2026-11-09", 480), fr("RA1", "2026-09-14", 300)];
    at("2026-11-11T04:30:00Z");   // Wed 11 Nov 10:00 IST
    const first = await floorOf("Biller Rk One", "2026-11-09", "2026-11-11");
    FLOOR.rows[0] = fr("RA1", "2026-11-09", 480);   // the team lead corrects the punch-out in Shastra
    at("2026-11-11T05:30:00Z");   // an hour later
    const soon = await floorOf("Biller Rk One", "2026-11-09", "2026-11-11");
    at("2026-11-11T08:00:00Z");   // three and a half hours after the first read
    const later = await floorOf("Biller Rk One", "2026-11-09", "2026-11-11");
    ok("K-07: a past day of this month is asked again a few hours later: Shastra's corrected punch-out shows (180, then 480 minutes)", first === 180 && soon === 180 && later === 480, { first, soon, later });
    // a day two months back stays as first read (Shastra is not asked again for it)
    at("2026-11-11T08:05:00Z");
    const old1 = await floorOf("Biller Rk One", "2026-09-14", "2026-11-11");
    FLOOR.rows[2] = fr("RA1", "2026-09-14", 420);
    at("2026-11-11T12:30:00Z");
    const old2 = await floorOf("Biller Rk One", "2026-09-14", "2026-11-11");
    ok("K-07: a settled day from before last month is not asked again", old1 === 300 && old2 === 300, { old1, old2 });
    // the hourly roster sync brings in the new joiner: Team status asks Shastra again and shows their day
    const before = await floorOf("Biller Rk Seven", "2026-11-09", "2026-11-11");
    feed.push(P({ emp_id: "RA7", name: "Biller Rk Seven", reports_to: "Lead Rk One", doj: "2026-11-02", email: "rk-b7@purview-healthcare.com" }));
    await A("roster.syncShastra");
    at("2026-11-11T12:35:00Z");
    const after = await floorOf("Biller Rk Seven", "2026-11-09", "2026-11-11");
    ok("K-07: someone linked to their Shastra row by a later roster sync gets the floor time Shastra already had for them", before === undefined && after === 480, { before, after });
  } finally { Date.now = realNow; }
}

S("K-04: a comp off in Shastra is a day off on Live status, and sharing out a desk skips it");
{
  const now = Date.now(), day = new Date(now + 330 * 60000 - 5 * 3600000).toISOString().slice(0, 10);   // Shastra's day rolls at 05:00 IST
  const lr = (emp, o) => ({ emp_id: emp, email: "", shift: "09:00-18:00", no_punch: false, auto_present: false, week_off: false, holiday: false, leave: null, status: "", in_at: null, out_at: null, late_ok: false, break_since: null, ...o });
  LIVE.day = day; LIVE.rows = [lr("RA1", { status: "comp_off" }), lr("RA2", { status: "present", in_at: new Date(now - 2 * 3600000).toISOString() }), lr("RA7", { status: "absent" })];
  await A("clients.saveTeam", { client_id: sun.id, team: [U("Biller Rk One"), U("Biller Rk Two"), (await A("users.list")).users.find((u) => u.name === "Biller Rk Seven").id] });
  const seven = (await A("users.list")).users.find((u) => u.name === "Biller Rk Seven").id;
  const six = (await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL LIMIT 6", sun.id)).map((x) => x.id);
  await A("alloc.reassign", { ids: six, user_id: seven });
  const hud = await A("team.huddle", { today: day });
  const sh = (hud.rows.find((r) => r.id === U("Biller Rk One")) || {}).shastra || {};
  ok("K-04: Live status shows a biller on comp off as a day off (Comp off), not Present", sh.state === "leave" && sh.label === "Comp off", sh);
  const rb = await A("team.rebalance", { user_id: seven, today: day });
  const got = (n) => (rb.to.find((x) => x.name === n) || {}).count || 0;
  ok("K-04: sharing out an absent biller's desk gives the biller on comp off nothing; the one punched in gets them", rb.moved === 6 && got("Biller Rk One") === 0 && got("Biller Rk Two") === 6, rb);
  const pr = (hud.rows.find((r) => r.id === U("Biller Rk Two")) || {}).shastra || {};
  ok("K-04: someone punched in still shows as in (Present or Late)", pr.state === "present" || pr.state === "late", pr);
}

S("K-13: the Monday digest's AR is the week's own (its Sunday's reading), whenever it is read");
{
  const snapAt = (cid, day, ar) => sql("INSERT OR REPLACE INTO client_snapshots (client_id, day, ar_balance, ar_claims, over90_balance, over90_claims, over120_balance, ar_owed, over90_owed, at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    cid, day, ar, 100, 0, 0, 0, ar, 0, Date.parse(day + "T18:00:00Z"));
  const lake = (await A("clients.list")).clients.find((c) => /Lake/.test(c.name));
  const realNow = Date.now;
  try {
    // Mon 9 Nov, 11:00 IST: live AR has Monday's upload in it; the readings: end of Sun 1 Nov and end of Sun 8 Nov (the week added 40,000)
    Date.now = () => Date.parse("2026-11-09T05:30:00Z");
    const live = (await A("client.overview", { client_id: sun.id })).ar.balance;
    await sql("DELETE FROM client_snapshots WHERE client_id IN (?, ?)", sun.id, lake.id);
    await snapAt(sun.id, "2026-11-01", live - 100000); await snapAt(sun.id, "2026-11-08", live - 60000);
    const d1 = await A("digest.dashboard", {}), c1 = d1.clients.find((c) => c.id === sun.id);
    let l1 = null; for (const sp of d1.spans || []) { const r = await A("digest.dashboard", { span: sp.key }); l1 = (r.clients || []).find((c) => c.id === lake.id) || l1; }
    const liveLake = (await A("client.overview", { client_id: lake.id })).ar.balance;
    ok("K-13: on its Monday the digest's week (Nov 2 to Nov 8) shows AR at the end of Sun 8 Nov, up 40,000, not live AR with Monday's upload",
      d1.week.first === "2026-11-02" && Math.round(c1.ar.now) === Math.round(live - 60000) && Math.round(c1.ar.now - c1.ar.week_ago) === 40000, { week: d1.week, ar: c1.ar, live });
    ok("K-13: a client with no reading by then still shows its live AR", l1 && Math.round(l1.ar.now) === Math.round(liveLake), l1 && { ar: l1.ar, liveLake });
    // Mon 16 Nov: the same week picked again, and the new digest (Nov 9 to 15) starts from the week's end
    Date.now = () => Date.parse("2026-11-16T05:30:00Z");
    const A16 = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
    await snapAt(sun.id, "2026-11-15", live);
    const c2 = (await A16("digest.dashboard", { week: d1.week.week })).clients.find((c) => c.id === sun.id);
    const c3 = (await A16("digest.dashboard", {})).clients.find((c) => c.id === sun.id);
    ok("K-13: picked a week later the same week reads the same (up 40,000), and the next week's change (up 60,000) does not count Monday's upload twice",
      Math.round(c2.ar.now - c2.ar.week_ago) === 40000 && Math.round(c3.ar.now - c3.ar.week_ago) === 60000, { c2: c2.ar, c3: c3.ar });
  } finally { Date.now = realNow; await signInAgain(); }
}

S("K-05: typed text over a box's limit is refused with a message, never cut; a long file name keeps its ending");
{
  const me = (await A("auth.me")).user, biller = U("Biller Rk One");
  const words = (n, tag) => { let t = ""; while (t.length < n - tag.length - 1) t += "the payer said the claim needs a corrected form "; return t.slice(0, n - tag.length - 1) + " " + tag; };
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const open3 = (await q("SELECT id, payer FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL LIMIT 6", sun.id));
  const esc = { kind: "external", client_id: sun.id, location_id: "all", day, dept: "Account Receivable", raised_who: "Office manager", reported_to: "Team lead", owner_id: me.id, channels: ["Email"], email_subject: "Subject line", description: "The error description here", comment: "A comment", status: "open" };
  const hid = "rk-ho-1"; await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id) VALUES (?,?,?,?,?,?,?,?)", hid, open3[0].id, sun.id, "posting", "pending", Date.now(), Date.now() + 86400000, me.id);
  const boxes = [
    ["Error description", 2000, (t) => A("escalations.save", { ...esc, description: t })], ["Comment", 2000, (t) => A("escalations.save", { ...esc, comment: t })],
    ["Root cause", 2000, (t) => A("escalations.save", { ...esc, rca: t })], ["Email subject", 300, (t) => A("escalations.save", { ...esc, email_subject: t })],
    ["Raised by", 120, (t) => A("escalations.save", { ...esc, raised_who: t })], ["Reported to", 120, (t) => A("escalations.save", { ...esc, reported_to: t })],
    ["The comment", 500, (t) => A("team.saveNote", { user_id: biller, comment: t })], ["The comment", 2000, (t) => A("handoffs.close", { id: hid, outcome: "pending", note: t })],
    ["The note", 2000, (t) => A("coach.noteAdd", { user_id: biller, kind: "concern", text: t })], ["The comment", 600, (t) => A("claims.setPriority", { ids: [open3[1].id], level: "top", category: "Client request", comment: t })],
    ["The text", 1500, (t) => A("templates.save", { client_id: sun.id, title: "Rk long template", text: t })], ["The note", 300, (t) => A("payers.saveLimit", { client_id: sun.id, payer: open3[2].payer, tfl_days: 90, afl_days: 180, note: t })],
    ["The note", 4000, (t) => A("notes.add", { claim_id: open3[3].id, comment: t })], ["Your message", 4000, (t) => A("feedback.send", { kind: "bug", message: t, page: "x", files: [] })],
    ["The reason", 120, (t) => A("team.setOut", { user_id: biller, reason: t, today: day })], ["The note", 300, (t) => A("monthend.set", { client_id: sun.id, month: day.slice(0, 7), step: "pack", done: true, note: t })],
    ["The client's name", 160, (t) => A("clients.save", { name: t, code: "RKLNG", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: me.id } } } })],
    ["A location's name", 160, (t) => A("clients.save", { name: "Rk Long Location Client", code: "RKLL", locations: [t], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: me.id } } } })],
  ];
  const out = [];
  for (const [label, max, call] of boxes) { const r = await T(() => call(words(max + 50, "END"))); out.push({ label, max, refused: !r.ok && r.e.startsWith(label + " is too long: " + (max + 50).toLocaleString("en-US") + " characters, and it takes up to " + max.toLocaleString("en-US")) ? 1 : r.ok ? "SAVED" : r.e }); }
  const bad1 = out.filter((x) => x.refused !== 1);
  ok("K-05: 50 characters over the limit in each of 18 boxes is refused with a message naming the box and its limit (nothing saved, nothing cut)", !bad1.length, bad1);
  const full = words(2000, "END-OF-TEXT"), r1 = await T(() => A("escalations.save", { ...esc, description: full }));
  const st = r1.ok ? (await q("SELECT description FROM escalations WHERE sr = ? AND client_id = ?", r1.r.sr, sun.id))[0] : null;
  const n500 = words(500, "END-OF-NOTE"); await A("team.saveNote", { user_id: biller, comment: n500 }); const tn = (await q("SELECT comment FROM team_notes WHERE user_id = ?", biller))[0];
  ok("K-05: text exactly at the limit is kept whole (an escalation's 2,000-character description, a 500-character Team status comment)", st && st.description === full && tn && tn.comment === n500, { e: r1.e, len: st && st.description.length, tn: tn && tn.comment.length });
  // file names: 234 characters ending .pdf on a claim, a team task and feedback
  const longName = "Remittance advice for the corrected claim " + "x".repeat(188) + ".pdf";
  const at = await A("attachments.add", { claim_id: open3[4].id, name: longName, type: "application/pdf", data: "JVBERi0xLjQK" });
  const fb = await T(() => A("feedback.send", { kind: "bug", message: "The upload screen stopped half way, see the picture", page: "x", files: [{ name: "Screenshot " + "y".repeat(140) + ".png", type: "image/png", b64: "iVBORw0KGgo=" }] }));
  const fbf = (await q("SELECT name FROM feedback_files ORDER BY rowid DESC LIMIT 1"))[0];
  ok("K-05: a file name over the limit keeps its ending: a claim's 234-character .pdf is kept as 200 characters ending .pdf; feedback's picture ends .png",
    longName.length === 234 && at.attachment.name.length === 200 && at.attachment.name.endsWith(".pdf") && fb.ok && fbf && fbf.name.length <= 120 && fbf.name.endsWith(".png"), { at: at.attachment.name.length, end: at.attachment.name.slice(-6), fb: fb.e || (fbf && fbf.name.slice(-8)) });
  const short = await A("attachments.add", { claim_id: open3[5].id, name: "eob-7711041.pdf", type: "application/pdf", data: "JVBERi0xLjQK" });
  ok("K-05: a short file name is kept as it is", short.attachment.name === "eob-7711041.pdf", short.attachment.name);
}

S("K-06: Back, Forward or a new address while a pop-up holds typed text asks first (the page's own code)");
{
  // the page code as built (app.js): its pop-ups register in LAYER_GUARDS; typedLayerFor decides whether a move must ask first
  const page = (code) => vm.runInContext(code, rig.app);
  page("globalThis.__rkTyped = { typed: () => true, ask() {} }; globalThis.__rkEmpty = { typed: () => false, ask() {} }; LAYER_GUARDS.add(__rkEmpty); LAYER_GUARDS.add(__rkTyped);");
  const held = page("typedLayerFor({ view: 'escalations', params: null }, { view: 'claims', params: null }) === __rkTyped");
  const same = page("typedLayerFor({ view: 'escalations', params: null }, { view: 'escalations', params: null }) === null");
  page("LAYER_GUARDS.delete(__rkTyped)");
  const free = page("typedLayerFor({ view: 'escalations', params: null }, { view: 'claims', params: null }) === null");
  page("LAYER_GUARDS.delete(__rkEmpty)");
  ok("K-06: Back to another page with typed text in a pop-up is held for 'Discard what you typed?'; no move, or nothing typed, goes on", held && same && free, { held, same, free });
}

S("K-09: two team leads allocating the same claims at the same moment: history and bell say only what each really got");
{
  const pool = await poolOf(30), t0 = Date.now();
  // lead 1's write waits until lead 2 has taken claims 11 to 30 (lead 1 picked 1 to 20)
  const release = holdNext(/UPDATE claims SET assigned_to = \?, assigned_at = \?, state = 'assigned'/);
  const p1 = L1("alloc.apply", { client_id: sun.id, strategy: "smart", assignments: pool.slice(0, 20).map((c) => ({ id: c.id, user_id: U("Biller Rk One"), priority: 50 })) });
  await tick();
  const r2 = await L2("alloc.apply", { client_id: sun.id, strategy: "smart", assignments: pool.slice(10, 30).map((c) => ({ id: c.id, user_id: U("Biller Rk Two"), priority: 50 })) });
  release(); const r1 = await p1; unhold();
  const both = pool.slice(10, 20).map((c) => c.id);
  const ev = await q("SELECT claim_id, COUNT(*) AS n, MAX(text) AS who FROM claim_events WHERE kind = 'assigned' AND claim_id IN (SELECT value FROM json_each(?)) GROUP BY claim_id", JSON.stringify(both));
  const own = await q("SELECT assigned_to FROM claims WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(both));
  const bell1 = (await q("SELECT text FROM user_notices WHERE kind = 'alloc' AND user_id = ? AND at >= ? AND text LIKE '%Lead Rk One%' ORDER BY at DESC LIMIT 1", U("Biller Rk One"), t0))[0];
  ok("K-09: the claims both leads picked went to one biller and their history names that one assignment only",
    r2.applied === 20 && r1.applied === 10 && ev.length === 10 && ev.every((e) => e.n === 1 && e.who === "Biller Rk Two") && own.every((o) => o.assigned_to === U("Biller Rk Two")), { r1: r1.applied, r2: r2.applied, ev: ev.slice(0, 3) });
  ok("K-09: the first lead's biller is told of the 10 claims they got, not 20", bell1 && /^10 new claims were allocated to you/.test(bell1.text), bell1);
}
{
  // the same in Rebalance (share equally): a claim its biller opens while the desk is shared out stays with them, and the history,
  // the bell and the counts say what really moved
  const seven = (await A("users.list")).users.find((u) => u.name === "Biller Rk Seven").id;
  await as(null)("auth.firstPassword", { user_id: seven, passHash: await sha("pw-rk-b7") });
  const S7 = as((await login("rk-b7@purview-healthcare.com", "pw-rk-b7")).token), t0 = Date.now();
  await sql("UPDATE claims SET assigned_to = NULL, state = 'open' WHERE assigned_to = ? AND state IN ('assigned','in_progress')", seven);
  const four = (await poolOf(4)).map((c) => c.id);
  await A("alloc.reassign", { ids: four, user_id: seven });
  const before2 = (await q("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", U("Biller Rk Two")))[0].n;
  const release = holdNext(/WHERE id = \? AND state = 'assigned' AND assigned_to = \? RETURNING id|WHERE id = \? AND state = 'assigned' AND assigned_to = \?/);
  const day = new Date(Date.now() + 330 * 60000 - 5 * 3600000).toISOString().slice(0, 10);
  const pr = A("team.rebalance", { user_id: seven, today: day });
  await tick();
  const opened = await S7("queue.next", {});
  release(); const rb = await pr; unhold();
  const evs = (await q("SELECT COUNT(*) AS n FROM claim_events WHERE kind = 'assigned' AND claim_id IN (SELECT value FROM json_each(?)) AND data_json LIKE '%rebalance%'", JSON.stringify(four)))[0].n;
  const after2 = (await q("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", U("Biller Rk Two")))[0].n;
  const bell2 = (await q("SELECT text FROM user_notices WHERE kind = 'alloc' AND user_id = ? AND at >= ? AND text LIKE '%shared equally%' ORDER BY at DESC LIMIT 1", U("Biller Rk Two"), t0))[0];
  const stays = (await q("SELECT assigned_to, state FROM claims WHERE id = ?", opened.claim.id))[0];
  ok("K-09 (same in Rebalance): the claim the biller opened meanwhile stays with them; 3 moved, 3 history lines, the bell says 3",
    stays.assigned_to === seven && stays.state === "in_progress" && rb.moved === 3 && evs === 3 && after2 - before2 === 3 && bell2 && /^3 new claims were allocated to you/.test(bell2.text), { rb, evs, moved: after2 - before2, bell: bell2 && bell2.text, stays });
}

S("K-03: the SAAG reference shows where the four desk actions really land");
{
  const L = (action, effective) => rig.app.saagLanding({ action, effective });
  const post = L("Need to Post/Posting Correction", "Pending-Collectible Insurance"), paper = L("Need to Submit Paper Claim", "Pending-Client Assistance");
  const corr = L("Correction, Resubmission & Reprocessing", "Pending-Collectible Insurance"), resub = L("Need to Resubmit", "Pending-Purview internal review");
  const plain = L("EOB not Available/Requested EOB", "Pending-Collectible Insurance");
  ok("K-03: Need to Post/Posting Correction lands in AR Closed-Pending Posting (Closed); the three submission actions in Pending-Submission (Purview), as the work form saves them",
    post.effective === "AR Closed-Pending Posting" && post.bucket === "Closed" && post.routed && [paper, corr, resub].every((x) => x.effective === "Pending-Submission" && x.bucket === "Purview" && x.routed), { post, paper, corr, resub });
  ok("K-03: every other action still shows the workbook's effective matrix and bucket", plain.effective === "Pending-Collectible Insurance" && plain.bucket === "Payer" && !plain.routed, plain);
}

S("K-15: money on the digest from $999,500 up is written in millions ($1M, not $1000K)");
{
  const m = (n) => rig.app.digestMoney(n);
  ok("K-15: the digest page writes $999,600 as $1M and keeps the other forms", m(999600) === "$1M" && m(999500) === "$1M" && m(999400) === "$999K" && m(1234567) === "$1.23M" && m(45600) === "$46K",
    [m(999600), m(999500), m(999400), m(1234567), m(45600)]);
  // the Monday email's AR box (dShort): a span whose clients' AR at the end of the week adds up to 999,600
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-11-09T05:30:00Z");
    const spans = (await A("digest.spans", {})).spans || [];
    const sp = spans.find((x) => (x.clients || []).some((c) => c.id === sun.id));
    const ids = sp.clients.map((c) => c.id);
    await sql("DELETE FROM client_snapshots WHERE client_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids));
    for (const [i, cid] of ids.entries()) await sql("INSERT INTO client_snapshots (client_id, day, ar_balance, ar_claims, over90_balance, over90_claims, over120_balance, ar_owed, over90_owed, at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      cid, "2026-11-08", i === 0 ? 999600 - 100 * (ids.length - 1) : 100, 10, 0, 0, 0, i === 0 ? 999600 - 100 * (ids.length - 1) : 100, 0, Date.parse("2026-11-08T18:00:00Z"));
    const mail = await A("digest.preview", { span: sp.key });
    const html = String(mail.html || "");
    ok("K-15: the Monday email's AR for that week reads $1M, not $1000K", html.includes("$1M") && !html.includes("1000K"), (html.match(/\$[0-9.,]+[KM]?/g) || []).slice(0, 8));
  } finally { Date.now = realNow; }
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
