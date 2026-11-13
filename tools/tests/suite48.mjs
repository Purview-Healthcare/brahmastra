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
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
