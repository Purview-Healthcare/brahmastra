/* Suite 48: bug test round 2, tester K's findings (fixer RK). Uploads that lose or mix up work (an upload part writing back a state
   it read a moment earlier, an upload stopped half way, two loads of the same file at once), allocation history at the same moment,
   OneDrive names for long client names, the floor feed's past days, comp off on Live status, the digest's AR for its week, text cut
   without a word, and the SAAG reference page. Made-up people and data only. */
import { makeRig } from "./rig.mjs";
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
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
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
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {};
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name), passHash: await sha("pw-" + email) }); TOK[name] = (await login(email, "pw-" + email)).token; return as(TOK[name]); };
const L1 = await firstIn("Lead Rk One", "rk-lead1@purview-healthcare.com"), L2 = await firstIn("Lead Rk Two", "rk-lead2@purview-healthcare.com");
const B1 = await firstIn("Biller Rk One", "rk-b1@purview-healthcare.com");
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
  } finally { rig.liveEnv.DEMO = true; }
  const files = [...OD.items.values()].filter((x) => x.kind === "file" && /^AR Production/.test(x.name)).map((x) => x.name);
  ok("K-12: a name that fits keeps exactly today's file name", files.includes("AR Production - Rk Meadow Dental - Nov 2026.xlsx"), files);
  const lf = files.filter((f) => f.startsWith("AR Production - Rk Valley"));
  ok("K-12: a long client name keeps the month: one AR Production file for November and one for December, each 80 characters or less before .xlsx",
    lf.length === 2 && lf.some((f) => f.endsWith(" - Nov 2026.xlsx")) && lf.some((f) => f.endsWith(" - Dec 2026.xlsx")) && lf.every((f) => f.length <= 85), lf);
  const folders = (await q("SELECT od_folder_id FROM clients WHERE name LIKE 'Rk %' AND od_folder_id IS NOT NULL")).map((r) => r.od_folder_id);
  ok("K-12: each client has a folder of its own", folders.length >= 2 && new Set(folders).size === folders.length, folders);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
