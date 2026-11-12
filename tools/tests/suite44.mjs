/* Suite 44: what only showed on Cloudflare's own runtime (workerd + D1) in the second bug test (tester I). The test rig's
   database (lib/local-backend.js, which the demo uses too) now refuses what D1 refuses, in D1's words, so these checks and every
   other suite run under D1's rules:
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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
