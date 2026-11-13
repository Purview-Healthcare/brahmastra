/* Suite 44: what only showed on Cloudflare's own runtime (workerd + D1) in the second bug test (tester I). The test rig's
   database (lib/local-backend.js, which the demo uses too) now refuses what D1 refuses, in D1's words, so these checks and every
   other suite run under D1's rules:
   I-01: Team status, team.range and Live status work for the admin, the VP, a manager and a team lead with a big team: every
         person's id was bound one value each (D1 takes at most 100 values a statement), now the list is one JSON value.
   I-05: Inventory status, the bell, Past TAT, the TAT emails, the digest and repeat denials work with 120 active clients: the
         client list is one JSON value too. Checked at scale: 150 AR billers (a third on a night shift) and 120 active clients.
   I-07: a manager who can edit many clients can Close, Exclude, Reopen, Assign, Unassign and Set priority on 80 or more ticked
         claims, and opens every page: the person's own client list (scopeSql, editScopeSql) is one JSON value as well.
   I-08: a month's production (reports.production, which Third Eye's page and the Production Conso download load) no longer
         reads every claim's 73 columns (the file's own row among them), and comes in pages of 5,000: a whole month in one answer
         passed a Worker's 128 MB on Cloudflare.
   I-02: a search longer than 48 characters works (Dashboard > a payer bar > Open these claims with a long payer name): D1
         refuses a LIKE pattern over 50 bytes, so typed text is cut to its first 48 bytes inside the % signs.
   I-03: closing claims answers how many claims were closed: D1 counts the closed_at trigger's change too (3 closed read 6), so
         the claims are counted (RETURNING); the rig now counts changes the way D1 does.
   I-04: a call that leaves out the id it needs answers the op's own message ("Claim not found."), never a 500: D1 refuses an
         undefined value, and the database helpers now bind a left-out value as NULL.
   Made-up data only. */
import fs from "fs";
import path from "path";
import { makeRig, REPO } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const errOf = async (fn) => { try { await fn(); return ""; } catch (e) { return String(e && e.message); } };
const syncErrOf = (fn) => { try { fn(); return ""; } catch (e) { return String(e && e.message); } };

const rig = await makeRig();
const { as, sha, tryOp } = rig;
await rig.app.seedDemo(() => {});
const adm = await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") });
const A = as(adm.token);
const DB = rig.backend.env.DB;

S("The rig's database refuses the values D1 refuses, in D1's words (measured on workerd's D1)");
ok("rig: an undefined value is refused when it is bound, not turned into NULL", syncErrOf(() => DB.prepare("SELECT ? AS v").bind(undefined)) === "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'",
  syncErrOf(() => DB.prepare("SELECT ? AS v").bind(undefined)));
ok("rig: an object is refused", syncErrOf(() => DB.prepare("SELECT ? AS v").bind({ a: 1 })) === "D1_TYPE_ERROR: Type 'object' not supported for value '[object Object]'");
ok("rig: a bigint is refused", syncErrOf(() => DB.prepare("SELECT ? AS v").bind(10n)) === "D1_TYPE_ERROR: Type 'bigint' not supported for value '10'");
ok("rig: numbers, text, true / false, null and bytes are taken; NaN arrives as NULL",
  JSON.stringify(await DB.prepare("SELECT ? AS a, ? AS b, ? AS c, ? AS d, ? AS e, length(?) AS f").bind(1.5, "x", true, null, NaN, new Uint8Array([1, 2, 3])).first()) === JSON.stringify({ a: 1.5, b: "x", c: 1, d: null, e: null, f: 3 }));
const WRONG = "D1_ERROR: Wrong number of parameter bindings for SQL query.";
ok("rig: fewer values than ?s are refused (sql.js alone used NULL)", (await errOf(() => DB.prepare("SELECT ? AS a, ? AS b").bind(1).first())) === WRONG);
ok("rig: more values than ?s are refused", (await errOf(() => DB.prepare("SELECT ? AS a").bind(1, 2).first())) === WRONG);
ok("rig: a ? in a string or a comment is not a value to bind", JSON.stringify(await DB.prepare("SELECT 'a?b' AS s, ? AS v -- one more ?\n").bind(7).first()) === JSON.stringify({ s: "a?b", v: 7 }));
ok("rig: a batch with a refused statement changes nothing", await (async () => {
  await DB.prepare("CREATE TABLE IF NOT EXISTS t44 (x TEXT)").run();
  const e = await errOf(() => DB.batch([DB.prepare("INSERT INTO t44 VALUES (?)").bind("a"), DB.prepare("INSERT INTO t44 VALUES (?, ?)").bind("b")]));
  return e === WRONG && (await DB.prepare("SELECT COUNT(*) AS n FROM t44").first()).n === 0;
})());

S("I-04: a call without the id it needs answers a plain message, as the demo does, never a 500");
// what the demo answers (and Cloudflare now answers too) for each call with its id left out
const CALLS = [["claims.get", {}, "Claim not found."], ["claims.timeline", {}, "Claim not found."], ["queue.open", {}, "Claim not found."], ["queue.complete", {}, "Claim not found."],
  ["queue.skip", {}, "This claim is not in your queue."], ["notes.add", {}, "Claim not found."], ["notes.update", {}, "Note not found."], ["attachments.add", {}, "Claim not found."],
  ["attachments.get", {}, "This file is no longer attached."], ["attachments.delete", {}, "This file is no longer attached."], ["handoffs.assign", {}, "That hand-off was not found."],
  ["handoffs.close", {}, "That hand-off was not found."], ["users.loginCode", {}, "Unknown user."], ["inventory.dedupe", {}, "Pick a client."], ["team.today", {}, "Unknown client."],
  ["team.saveToday", {}, "Unknown client."], ["alloc.reassign", { ids: ["x"] }, "Pick claims and an active team member."]];
for (const [op, p, want] of CALLS) {
  const r = await tryOp(() => A(op, p));
  ok(`I-04: ${op} with no ${op === "alloc.reassign" ? "user_id" : "id"} answers "${want}"`, !r.ok && r.status < 500 && r.e === want, r.ok ? "answered ok" : r.status + " " + r.e);
}
// a biller's own calls without ids too (the queue, notes, files)
const bl = await as(null)("auth.login", { email: "aisha@purview-healthcare.com", passHash: await sha("brahmastra-demo") });
const B = as(bl.token);
const bad = [];
for (const op of ["claims.get", "claims.timeline", "queue.open", "queue.complete", "queue.skip", "notes.add", "notes.update", "attachments.add", "attachments.get", "attachments.delete"]) {
  const r = await tryOp(() => B(op, {})); if (!r.ok && !(r.status < 500)) bad.push(op + " " + r.status + " " + r.e);
}
ok("I-04: the same calls by a biller answer a message, none crashes", !bad.length, bad);

S("I-03: closing claims counts the claims; the rig counts changes the way D1 does (the closed_at trigger too)");
const sun = (await A("clients.list")).clients.find((c) => c.name === "Sunrise Eye Care");
const todayIst = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const mk = (i) => ({ match_key: "s44-close-" + i, claim_no: "4419" + (10 + i), account_no: "C44" + i, patient: "Sample, Close " + i, payer: "Aetna", dos: "2026-09-0" + i, balance: 100 * i, billed: 150 * i,
  lines: 1, status_class: "denied", file_status: "Denied", bucket: "61–90", age_days: 70 });
const upload = (file, claims) => A("inventory.upload", { client_id: sun.id, location_id: sun.locations[0].id, kind: "fresh", file_name: file, rows_read: claims.length, claims, final: true, summary: {}, today: todayIst });
await upload("s44-close-1.xlsx", [1, 2, 3].map(mk));
const closeIds = (await A("claims.list", { client_id: sun.id, q: "Sample, Close", state: "", page_size: 50 })).rows.map((r) => r.id);
// D1's meta.changes (miniflare's D1: total_changes() before and after) counts the trigger that stamps closed_at on the same claim
{ const c0 = closeIds[0], now = Date.now();
  const r1 = await DB.prepare("UPDATE claims SET state = 'closed', updated_at = ? WHERE id = ?").bind(now, c0).run();
  const r2 = await DB.prepare("UPDATE claims SET state = 'open', updated_at = ? WHERE id = ?").bind(now, c0).run();
  ok("rig: closing one claim counts 2 changes, as on D1 (the claim and its closed_at trigger); reopening counts 1", r1.meta.changes === 2 && r2.meta.changes === 1, [r1.meta.changes, r2.meta.changes]); }
const cl3 = await A("claims.setState", { ids: closeIds, state: "closed" });
const nClosed = (await A("claims.list", { client_id: sun.id, q: "Sample, Close", state: "closed", page_size: 50 })).total;
ok("I-03: closing 3 claims answers changed: 3 (the page says Closed: 3 claims.), and 3 are closed", closeIds.length === 3 && cl3.changed === 3 && nClosed === 3, { cl3, nClosed });
ok("I-03: reopening the 3 answers changed: 3", (await A("claims.setState", { ids: closeIds, state: "open" })).changed === 3);
ok("I-03: excluding the 3 answers changed: 3", (await A("claims.setState", { ids: closeIds, state: "excluded" })).changed === 3);
ok("I-03: closing 1 claim (from excluded) answers changed: 1", (await A("claims.setState", { ids: closeIds.slice(0, 1), state: "closed" })).changed === 1);
await A("claims.setState", { ids: closeIds, state: "closed" });
// a later file has the 3 closed claims again, so it reopens them; undoing that file puts them back to closed
const up2 = await upload("s44-close-2.xlsx", [1, 2, 3].map(mk));
const und = await A("inventory.undoBatch", { batch_id: up2.batch_id });
const backClosed = (await A("claims.list", { client_id: sun.id, q: "Sample, Close", state: "closed", page_size: 50 })).total;
ok("I-03: undoing a file that reopened 3 closed claims puts 3 back and says reverted: 3", up2.reopened === 3 && und.reverted === 3 && backClosed === 3, { reopened: up2.reopened, und, backClosed });

S("I-02: a long search works, as the demo's does, and finds what its first 48 characters find; the rig refuses long LIKE patterns");
const TOO_COMPLEX = "D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR";
ok("rig: a LIKE pattern of 50 bytes is taken", (await errOf(() => DB.prepare("SELECT 'a' LIKE ? AS m").bind("%" + "a".repeat(48) + "%").first())) === "");
ok("rig: a LIKE pattern of 51 bytes is refused in D1's words", (await errOf(() => DB.prepare("SELECT 'a' LIKE ? AS m").bind("%" + "a".repeat(49) + "%").first())) === TOO_COMPLEX);
ok("rig: the limit is in bytes: 17 dashes of 3 bytes (51 bytes) are refused", (await errOf(() => DB.prepare("SELECT 'a' LIKE ? AS m").bind("–".repeat(17)).first())) === TOO_COMPLEX);
ok("rig: NOT LIKE, LIKE ... ESCAPE and GLOB are held to it too", (await errOf(() => DB.prepare("SELECT 'a' NOT LIKE ? AS m").bind("%" + "a".repeat(49) + "%").first())) === TOO_COMPLEX
  && (await errOf(() => DB.prepare("SELECT 'a' LIKE ? ESCAPE '\\' AS m").bind("%" + "a".repeat(49) + "%").first())) === TOO_COMPLEX
  && (await errOf(() => DB.prepare("SELECT 'a' GLOB ? AS m").bind("*" + "a".repeat(49) + "*").first())) === TOO_COMPLEX);
ok("rig: a pattern written in the SQL itself is held to it", (await errOf(() => DB.prepare(`SELECT 'a' LIKE '%${"a".repeat(49)}%' AS m`).first())) === TOO_COMPLEX);
ok("rig: a long text compared with a short pattern is fine (only the pattern is limited)", (await errOf(() => DB.prepare("SELECT ? LIKE '%admin%' AS m").bind("x".repeat(200)).first())) === "");
// Dashboard > Claims in detail > a payer bar > Open these claims: the Claims page opens with the payer's whole name in Search (q)
const LONG = "Blue Cross Blue Shield of Texas Federal Employee Program";   // 56 characters, a made-up but ordinary payer name
const rows = rig.app.makeSampleRows({ kind: "fresh", seed: 401, count: 40, today: todayIst }).map((r, i) => (i % 4 === 0 ? { ...r, Payer: LONG } : r));
const tb = rig.app.tableFromObjects(rows), mapping = rig.app.autoMap(tb.headers);
const built = rig.app.buildClaims({ rows: tb.rows, mapping, kind: "fresh", today: todayIst });
await rig.app.uploadClaims({ client_id: sun.id, location_id: sun.locations[0].id, kind: "fresh", file_name: "long-payer.xlsx", claims: built.claims, summary: built.summary, rows_read: tb.rows.length });
const bar = (await A("claims.stats", { client_id: sun.id })).payers.find((p) => p.payer === LONG);
const openThese = await tryOp(() => A("claims.list", { client_id: sun.id, q: LONG, state: "workable", page: 1, page_size: 50 }));
ok("I-02: Open these claims for a 56-character payer lists the payer bar's claims", !!bar && bar.n > 0 && openThese.ok && openThese.r.total === bar.n && openThese.r.rows.every((r) => r.payer === LONG),
  { bar: bar && bar.n, got: openThese.ok ? openThese.r.total : openThese.status + " " + openThese.e });
const first48 = await A("claims.list", { client_id: sun.id, q: LONG.slice(0, 48), state: "workable", page: 1, page_size: 50 });
ok("I-02: the long search finds exactly what its first 48 characters find", openThese.ok && first48.total === openThese.r.total, { long: openThese.ok && openThese.r.total, first48: first48.total });
const t49 = async (op, p) => { const r = await tryOp(() => A(op, p)); return r.ok ? "ok" : r.status + " " + r.e; };
ok("I-02: Claims search with 49 characters answers (none found)", (await t49("claims.list", { q: "x".repeat(49), state: "" })) === "ok");
ok("I-02: Claims filters provider, payer (contains) and CPT take long text", (await t49("claims.list", { provider: "p".repeat(80), payer_like: LONG + LONG, cpt: "–".repeat(40), state: "" })) === "ok");
const sg = await tryOp(() => A("search.global", { q: LONG }));
ok("I-02: Ctrl+K with 49+ characters answers", (await t49("search.global", { q: "x".repeat(49) })) === "ok" && sg.ok, sg.ok ? "" : sg.status + " " + sg.e);
const sug = await tryOp(() => A("claims.suggest", { field: "payer", q: LONG }));
ok("I-02: the payer suggestions for the long name offer it", sug.ok && sug.r.values.includes(LONG), sug.ok ? sug.r.values : sug.status + " " + sug.e);
ok("I-02: the claim suggestions take 49+ characters", (await t49("claims.suggest", { q: "Sample, Patient With A Long Made Up Name 0123456789" })) === "ok");
ok("I-02: sign-in by name with 49 characters answers (no match)", (await t49("auth.lookup", { q: "y".repeat(49) })) === "ok");
ok("I-02: the audit trail's action filter takes 40 characters of any kind", (await t49("audit.list", { action: "–".repeat(40) })) === "ok");
const qb = await tryOp(() => B("queue.list", { day_from_ms: 0, q: "z".repeat(60), payer: LONG, provider: "p".repeat(80), cpt: "–".repeat(40) }));
ok("I-02: a biller's My list filters take long text", qb.ok, qb.ok ? "" : qb.status + " " + qb.e);
ok("I-02: a search of 48 characters or less is as before (the demo's sample payer)", (await A("claims.list", { client_id: sun.id, q: "Aetna", state: "", page_size: 500 })).rows.every((r) => /aetna/i.test(r.claim_no + r.patient + r.account_no + r.payer)));

S("I-08: the month's production reads only what a row needs and comes in pages");
{ // 40 made-up work entries by the demo's billers on the claims loaded above, some in the same millisecond
  const billers = (await A("users.list")).users.filter((u) => u.role === "user" && u.active).slice(0, 3);
  const onFile = (await A("claims.list", { client_id: sun.id, state: "", page_size: 40 })).rows, t0 = Date.now() - 3 * 3600000;
  for (let i = 0; i < 40; i++) await DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at, status, sub_status, action, bucket, comment, fields_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind("s44-prod-" + i, onFile[i % onFile.length].id, billers[i % 3].id, billers[i % 3].name, "work", t0 + Math.floor(i / 4) * 60000, "Claim In Process", "Need to allow some time", "Follow Up", "Payer",
      "Made-up note " + i, JSON.stringify({ source: "Call", call_start: "10:05", call_end: "10:19" })).run();
  // and 8 finished Payment posting and 8 finished Submission tasks (two finished in the same millisecond each time)
  for (let i = 0; i < 16; i++) await DB.prepare("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, done_at, done_by, done_by_name, proof_json, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind("s44-ho-" + i, onFile[i % onFile.length].id, sun.id, i % 2 ? "posting" : "submission", "complete", t0, "Supervisor", t0 + 86400000, t0 + Math.floor(i / 4) * 60000, billers[0].id, billers[0].name,
      JSON.stringify(i % 2 ? { ref: "CHK" + i, check_date: "2026-11-02", allowed: 120, amount: 80, adjustment: 40, deductible: 0 } : { ref: "B" + i, mode: "Electronic" }), "Made-up desk note " + i).run(); }
{ // the database rows read for Production: only the fields a row uses, not the claim's 73 columns
  const ST = Object.getPrototypeOf(DB.prepare("SELECT 1")), ex = ST._exec; let widest = 0;
  ST._exec = function () { const r = ex.call(this); if (/FROM notes nt JOIN claims c/.test(this.sql)) for (const row of r.results) widest = Math.max(widest, Object.keys(row).length); return r; };
  let whole; try { whole = await A("reports.production", { scope: "ar", from_ms: 0, to_ms: Date.now() + 86400000 }); } finally { ST._exec = ex; }
  ok("I-08: the Production query reads at most 20 fields an entry (it read the claim's 73 columns and the file's own row)", whole.rows.length > 10 && widest > 0 && widest <= 20, { rows: whole.rows.length, widest });
  const strip = (rows) => rows.map((r) => JSON.stringify(r.slice(1))).sort();   // the SR No apart: entries worked in the same millisecond may come in either order
  const pages = []; let pg = null;
  for (let page = 1; page <= 50; page++) { pg = await A("reports.production", { scope: "ar", from_ms: 0, to_ms: Date.now() + 86400000, page, page_size: 7 }); pages.push(...pg.rows); if (pages.length >= pg.total || !pg.rows.length) break; }
  ok("I-08: pages of 7 put together give the very entries of the one answer, numbered 1 on", pg.total === whole.rows.length && JSON.stringify(strip(pages)) === JSON.stringify(strip(whole.rows)) && pages.every((r, i) => r[0] === i + 1),
    { total: pg && pg.total, got: pages.length, whole: whole.rows.length });
  const big = await A("reports.production", { scope: "ar", from_ms: 0, to_ms: Date.now() + 86400000, page: 1, page_size: 99999 });
  ok("I-08: a page is at most 5,000 entries", big.page_size === 5000 && big.page === 1 && big.total === whole.rows.length);
  for (const sc of ["pp", "sub"]) { const w = await A("reports.production", { scope: sc, from_ms: 0, to_ms: Date.now() + 86400000 }), parts = [];
    for (let page = 1; page <= 50; page++) { const x = await A("reports.production", { scope: sc, from_ms: 0, to_ms: Date.now() + 86400000, page, page_size: 1 }); parts.push(...x.rows); if (parts.length >= x.total || !x.rows.length) break; }
    ok(`I-08: ${sc === "pp" ? "Payment posting" : "Submission"}'s production pages too, the same 8 entries`, w.rows.length === 8 && JSON.stringify(parts.map((r) => JSON.stringify(r)).sort()) === JSON.stringify(w.rows.map((r) => JSON.stringify(r)).sort()), { whole: w.rows.length, pages: parts.length }); }
  const viaPage = await rig.app.rpcAllPages("reports.production", { scope: "ar", from_ms: 0, to_ms: Date.now() + 86400000 }, 5000);
  ok("I-08: the page's own code (rpcAllPages, pages of 5,000) gets the same entries", JSON.stringify(strip(viaPage.rows)) === JSON.stringify(strip(whole.rows)));
  const jsx = fs.readFileSync(path.join(REPO, "app", "app.jsx"), "utf8");
  ok("I-08: Third Eye's page and the Production Conso download both load it in pages of 5,000", (jsx.match(/rpcAllPages\("reports\.production", \{[^\n]*\}, 5000\)/g) || []).length === 2 && !/[^l]rpc\("reports\.production"/.test(jsx)); }

// ---------------------------------------------------------------------------------------------------------------------------
// I-01 and I-05 at scale, in a second rig (its own database): a made-up Shastra roster of a VP, 3 managers, 12 team leads and 150
// AR billers (every third one on a night shift; 110 report to one team lead), and 120 active clients ("Test Clinic 003".."120"
// and the demo's two). Every statement still runs under D1's rules, so a list bound one value per item fails here as it does on D1.
S("I-01, I-05: the team and client views at scale (150 AR billers, 120 active clients), for the admin, the VP, a manager and a team lead");
const pad = (i) => String(i).padStart(3, "0");
const NC = 120, NB = 150, clinic = (k) => "Test Clinic " + pad(k);   // clinics 003..120 with the demo's two: 120 active clients
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "",
  reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const feed = [P({ emp_id: "V1", name: "Test VP 001", position: "Vice President", project: "Sunrise Eye Care", email: "tvp1@purview-healthcare.com" })];
for (let m = 1; m <= 3; m++) feed.push(P({ emp_id: "M" + m, name: "Test Manager " + pad(m), position: "Manager", project: "Sunrise Eye Care", reports_to: "Test VP 001", email: `tm${m}@purview-healthcare.com` }));
for (let t = 1; t <= 12; t++) feed.push(P({ emp_id: "T" + t, name: "Test Lead " + pad(t), position: "Team Lead", project: t === 1 ? clinic(3) : clinic(2 + t),
  also_on_projects: t === 1 ? Array.from({ length: NC - 3 }, (_, k) => clinic(k + 4)).join(", ") + ", Sunrise Eye Care" : t % 2 ? "Sunrise Eye Care" : "Lakeview Dental Group",
  reports_to: "Test Manager " + pad(t <= 6 ? 1 : t <= 10 ? 2 : 3), email: `tl${t}@purview-healthcare.com` }));
for (let i = 1; i <= NB; i++) feed.push(P({ emp_id: "B" + pad(i), name: "Test Biller " + pad(i), project: clinic(3 + ((i - 1) % (NC - 2))), reports_to: "Test Lead " + pad(i <= 110 ? 1 : 2 + ((i - 111) % 11)),
  shift: i % 3 === 0 ? "18:30-03:30" : "09:00-18:00", email: `tb${pad(i)}@purview-healthcare.com` }));
feed.push(P({ emp_id: "D1", name: "Test Poster 001", department: "Payment Posting", project: "Sunrise Eye Care", reports_to: "Test Lead 002", email: "tp1@purview-healthcare.com" }));
const mails = [];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const rigS = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "made-up-test-key-" + "k".repeat(32), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40) },
  fetchMock: async (url, init) => { if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed }); if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); } return J({ ok: false, error: "stub" }, 500); } });
await rigS.app.seedDemo(() => {});
const loginS = async (email, pw) => rigS.as(null)("auth.login", { email, passHash: await rigS.sha(pw) });
const AS = rigS.as((await loginS("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
const meS = (await AS("auth.me")).user;
await AS("roster.syncShastra");   // the people first; the clinics' Payment posting person is one of them
const posterId = (await AS("users.list")).users.find((u) => u.name === "Test Poster 001").id;
for (let k = 3; k <= NC; k++) await AS("clients.save", { name: clinic(k), code: "TC" + k, locations: ["Main"], profile: { scope: ["ar", "posting"], targets: { ar: 30 }, resp: { ar: { lead: meS.id }, posting: { lead: posterId } } } });
const sync = await AS("roster.syncShastra");   // again, now that the clinics match the roster's projects
const usersS = (await AS("users.list")).users, US = (n) => usersS.find((u) => u.name === n);
const firstIn = async (name, email) => { await rigS.as(null)("auth.firstPassword", { user_id: US(name).id, passHash: await rigS.sha("pw-" + email) }); return rigS.as((await loginS(email, "pw-" + email)).token); };
const VP = await firstIn("Test VP 001", "tvp1@purview-healthcare.com"), MG = await firstIn("Test Manager 001", "tm1@purview-healthcare.com"), TL = await firstIn("Test Lead 001", "tl1@purview-healthcare.com");
const PO = await firstIn("Test Poster 001", "tp1@purview-healthcare.com");
const activeClients = (await AS("clients.list")).clients.filter((c) => c.active);
const billersS = usersS.filter((u) => u.role === "user" && u.active && /^Test Biller/.test(u.name));
ok("I-01/I-05 setup: 150 AR billers synced (50 on a night shift) and 120 active clients", billersS.length === NB && billersS.filter((u) => /18:30/.test(u.shift || "")).length === 50 && activeClients.length === NC,
  { billers: billersS.length, night: billersS.filter((u) => /18:30/.test(u.shift || "")).length, clients: activeClients.length, sync: sync.summary });
// some claims on a few clinics (the page's own upload), so the views count real work
for (const k of [3, 4, 5]) {
  const c = activeClients.find((x) => x.name === clinic(k));
  const rows = rigS.app.makeSampleRows({ kind: "fresh", seed: 498 + k, count: 20, today: todayIst }), t = rigS.app.tableFromObjects(rows), m = rigS.app.autoMap(t.headers);
  const b = rigS.app.buildClaims({ rows: t.rows, mapping: m, kind: "fresh", today: todayIst });
  await rigS.app.uploadClaims({ client_id: c.id, location_id: c.locations[0].id, kind: "fresh", file_name: "scale-" + k + ".xlsx", claims: b.claims, summary: b.summary, rows_read: t.rows.length });
}
const m1 = todayIst.slice(0, 8) + "01";
const who = { admin: AS, VP, manager: MG, "team lead": TL };
const views = (X) => [["Team status", () => X("team.status", { from: m1, to: todayIst })], ["team.range", () => X("team.range", { from: m1, to: todayIst })], ["Live status", () => X("team.huddle", {})],
  ["Inventory status", () => X("inventory.status", {})], ["the bell", () => X("notify.list", {})], ["Past TAT", () => X("tat.list", {})], ["the TAT email preview", () => X("tat.preview", {})],
  ["the digest", () => X("digest.dashboard", {})], ["Client 360", () => X("client.overview", { client_id: activeClients.find((c) => c.name === clinic(50)).id, from_ms: Date.parse(m1 + "T00:00:00Z"), to_ms: Date.now() })],
  ["repeat denials", () => X("denials.repeats", { from: m1, to: todayIst })], ["Portfolio", () => X("portfolio.overview", {})], ["Needs attention", () => X("attention.list", {})], ["Claims", () => X("claims.list", { page_size: 50 })],
  ["Claims in detail", () => X("claims.stats", {})], ["Posting & submission", () => X("handoffs.list", {})], ["team.activity", () => X("team.activity", { from_ms: Date.parse(m1 + "T00:00:00Z"), to_ms: Date.now() })],
  ["the hand-off dashboard", () => X("handoffs.dashboard", {})], ["the reports", () => X("reports.work", { from_ms: Date.parse(m1 + "T00:00:00Z"), to_ms: Date.now() })],
  ["the desk report", () => X("reports.desk", { from_ms: Date.parse(m1 + "T00:00:00Z"), to_ms: Date.now() })], ["the Production export", () => X("reports.claimsProduction", { from: m1, to: todayIst, page: 1 })],
  ["Escalations", () => X("escalations.list", {})], ["the Needs attention badge", () => X("attention.count", {})], ["Users", () => X("users.list", {})]];
const answers = {};
for (const [k, X] of Object.entries(who)) {
  const bad = []; answers[k] = {};
  for (const [name, fn] of views(X)) { const r = await rigS.tryOp(fn); answers[k][name] = r.ok ? r.r : null; if (!r.ok) bad.push(name + ": " + r.status + " " + r.e); }
  ok(`I-01/I-05: the ${k} opens Team status, team.range, Live status, Inventory status, the bell, Past TAT, the digest, Client 360 and the rest`, !bad.length, bad);
}
const tsRows = (k) => (answers[k]["Team status"] || { rows: [] }).rows;
ok("I-01: the admin's and the VP's Team status list every AR biller (150 + the demo's 3), team.range and Live status too",
  ["admin", "VP"].every((k) => tsRows(k).length === NB + 3 && answers[k]["team.range"].rows.length === NB + 3 && answers[k]["Live status"].rows.length === NB + 3),
  Object.fromEntries(["admin", "VP"].map((k) => [k, [tsRows(k).length, answers[k]["team.range"] && answers[k]["team.range"].rows.length, answers[k]["Live status"] && answers[k]["Live status"].rows.length]])));
ok("I-01: the team lead with 110 billers sees all 110 on Team status; the manager sees at least them", tsRows("team lead").filter((r) => /^Test Biller/.test(r.name)).length >= 110 && tsRows("manager").length >= 110,
  { lead: tsRows("team lead").length, manager: tsRows("manager").length });
ok("I-05: the admin's and the VP's Inventory status cover all 120 active clients, and so does Portfolio", ["admin", "VP"].every((k) => answers[k]["Inventory status"] && answers[k]["Inventory status"].clients.length === NC
  && answers[k].Portfolio.rows.length === NC), Object.fromEntries(["admin", "VP"].map((k) => [k, answers[k]["Inventory status"] && answers[k]["Inventory status"].clients.length])));
const tlAsMgr = await rigS.tryOp(() => MG("team.status", { from: m1, to: todayIst, lead_id: US("Test Lead 001").id }));
const tlAsAdm = await rigS.tryOp(() => AS("team.range", { from: m1, to: todayIst, lead_id: US("Test Lead 001").id }));
ok("I-01: a manager (and the admin) picking that team lead see their 110 billers", tlAsMgr.ok && tlAsMgr.r.rows.length === 110 && tlAsAdm.ok && tlAsAdm.r.rows.length === 110,
  { mgr: tlAsMgr.ok ? tlAsMgr.r.rows.length : tlAsMgr.e, adm: tlAsAdm.ok ? tlAsAdm.r.rows.length : tlAsAdm.e });
// I-07: the manager (who can edit all 120 clients) ticks 100 claims and uses the Claims page's bulk buttons
{ // the claims are picked from the admin's list (all of them are on the manager's clients), so this checks the buttons themselves
  const listed = await rigS.tryOp(() => AS("claims.list", { state: "workable", page_size: 200 })), pick = listed.ok ? listed.r.rows.map((r) => r.id).slice(0, 100) : [];
  const handBiller = usersS.find((u) => u.role === "user" && u.source !== "roster" && u.active);   // a biller added by hand can be given any client's claims
  const bad = [], counts = {};
  for (const [label, op, p] of [["Exclude", "claims.setState", { ids: pick, state: "excluded" }], ["Reopen", "claims.setState", { ids: pick, state: "open" }],
    ["Set priority", "claims.setPriority", { ids: pick, level: "high", category: "Payer follow-up", comment: "Made-up reason for this test run" }], ["Assign", "alloc.reassign", { ids: pick, user_id: handBiller.id }],
    ["Unassign", "alloc.unassign", { ids: pick }], ["Close", "claims.setState", { ids: pick, state: "closed" }], ["Reopen again", "claims.setState", { ids: pick, state: "open" }],
    ["Set priority for 80", "claims.setPriority", { ids: pick.slice(0, 80), level: "", category: "Payer follow-up", comment: "Made-up reason for this test run" }]]) {
    const r = await rigS.tryOp(() => MG(op, p)); if (!r.ok) bad.push(label + ": " + r.status + " " + r.e); else counts[label] = r.r.changed != null ? r.r.changed + (r.r.at_desk || 0) + (r.r.posted || 0) : "ok";
  }
  ok("I-07: a manager who can edit 120 clients can Exclude, Reopen, Set priority, Assign, Unassign and Close 100 ticked claims", pick.length === 100 && !bad.length, { picked: listed.ok ? pick.length : listed.status + " " + listed.e, bad });
  ok("I-07: and each of Exclude, Reopen and Close accounts for all 100 (changed, or left with a desk or Posting)", ["Exclude", "Reopen", "Close"].every((k) => counts[k] === 100), counts); }
// a Payment posting person set on all 118 clinics: their own clients are one list too (Claims, its suggestions, Ctrl+K, the desk)
{ const bad = [];
  const c5 = activeClients.find((c) => c.name === clinic(5));
  const calls = [["Claims", () => PO("claims.list", { page_size: 50 })], ["Claims of one clinic", () => PO("claims.list", { client_id: c5.id, page_size: 50 })], ["Claims in detail", () => PO("claims.stats", {})],
    ["payer suggestions", () => PO("claims.suggest", { field: "payer", q: "a" })], ["claim suggestions", () => PO("claims.suggest", { q: "Sa" })], ["Ctrl+K", () => PO("search.global", { q: "Sa" })],
    ["Posting & submission", () => PO("handoffs.list", {})], ["the bell", () => PO("notify.list", {})]];
  const got = {};
  for (const [name, fn] of calls) { const r = await rigS.tryOp(fn); got[name] = r.ok ? r.r : null; if (!r.ok) bad.push(name + ": " + r.status + " " + r.e); }
  ok("I-01/I-05: a Payment posting person responsible for 118 clinics opens Claims, Claims in detail, the suggestions, Ctrl+K, the desk and the bell", !bad.length, bad);
  ok("I-01/I-05: and sees the claims of those clinics (the 20 uploaded to one of them)", !!got["Claims of one clinic"] && got["Claims of one clinic"].total === 20, got["Claims of one clinic"] && got["Claims of one clinic"].total); }
// the night shift still under way after midnight: Team status at 04:42 IST binds the night-shift people twice more (the day roll, not finished yet)
{ const real = Date.now, istDay0 = new Date(real() + 330 * 60000).toISOString().slice(0, 10);   // the latest 04:42 IST before now (the session is still good then)
  let at = Date.parse(istDay0 + "T04:42:00Z") - 330 * 60000; if (at > real()) at -= 86400000;
  const day = new Date(at + 330 * 60000).toISOString().slice(0, 10); Date.now = () => at;
  let r; try { r = await rigS.tryOp(() => AS("team.status", { from: day.slice(0, 8) + "01", to: day, today: day })); } finally { Date.now = real; }
  ok("I-01: Team status at 04:42 IST with 50 night-shift billers still on their shift answers, every biller listed", r.ok && r.r.rows.length === NB + 3, r.ok ? r.r.rows.length : r.status + " " + r.e); }
// the scheduled jobs with 120 active clients: the 09:00 TAT emails and the Monday digest (clock set; a stand-in mail webhook)
{ const logs = [], l0 = console.log, e0 = console.error; console.log = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" "));
  const fire = async (cron, at) => { const real = Date.now; Date.now = () => at; try { const ps = []; await rigS.worker.default.scheduled({ cron, scheduledTime: at }, { ...rigS.backend.env, ...rigS.liveEnv, DEMO: false, DB: rigS.backend.env.DB }, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };
  try {
    await fire("30 3,13 * * MON-FRI", Date.UTC(2026, 10, 16, 3, 30));   // Monday 16 Nov 2026, 09:00 IST
    await fire("*/10 3-7 * * MON", Date.UTC(2026, 10, 16, 3, 10));      // the same Monday, 08:40 IST
  } finally { console.log = l0; console.error = e0; }
  const d1 = logs.filter((l) => /D1_|SQLITE|too many SQL|too complex|not supported/.test(l));
  ok("I-05: the 09:00 TAT emails and the Monday digest run with 120 active clients, no database error, the digest is sent", !d1.length && mails.some((m) => !/TAT/i.test(m.subject || "")), { d1, mails: mails.length, logs: logs.slice(0, 6) }); }

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
