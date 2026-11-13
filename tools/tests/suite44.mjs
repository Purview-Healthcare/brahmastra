/* Suite 44: what only showed on Cloudflare's own runtime (workerd + D1) in the second bug test (tester I). The test rig's
   database (lib/local-backend.js, which the demo uses too) now refuses what D1 refuses, in D1's words, so these checks and every
   other suite run under D1's rules:
   I-02: a search longer than 48 characters works (Dashboard > a payer bar > Open these claims with a long payer name): D1
         refuses a LIKE pattern over 50 bytes, so typed text is cut to its first 48 bytes inside the % signs.
   I-03: closing claims answers how many claims were closed: D1 counts the closed_at trigger's change too (3 closed read 6), so
         the claims are counted (RETURNING); the rig now counts changes the way D1 does.
   I-04: a call that leaves out the id it needs answers the op's own message ("Claim not found."), never a 500: D1 refuses an
         undefined value, and the database helpers now bind a left-out value as NULL.
   Made-up data only. */
import { makeRig } from "./rig.mjs";
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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
