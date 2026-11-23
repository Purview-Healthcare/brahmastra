/* Suite 63: the server's own resilience. (A) Two fresh copies of the server starting at the same moment after an update that adds
   a column both answer (the second finds the column there already); a fresh start reads the setup mark instead of checking every
   table. (B) An unexpected error answers "Server error." and is kept in the audit trail (the action and the error text), and a
   table that vanished is made again on the next request. Made-up data. */
import { makeRig } from "./rig.mjs";
const rig = await makeRig({}); const app = rig.app; await app.seedDemo(() => {});
let captured = null; const of = rig.backend.fetch.bind(rig.backend);
rig.backend.fetch = async (url, init) => { if (!captured && String((init && init.body) || "").includes('"auth.login"')) captured = { url, init: { ...init } }; return of(url, init); };
const A = rig.as((await rig.as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await rig.sha("brahmastra-demo") })).token);
const db = rig.backend.env.DB, q = async (s, ...a) => (await db.prepare(s).bind(...a).all()).results;
const ctx = { waitUntil() {}, passThroughOnException() {} };
const fresh = async () => { const w = (await import(new URL("../../worker.js?" + Math.random(), import.meta.url).href)).default; const res = await w.fetch(new Request(captured.url, captured.init), rig.backend.env, ctx); return res.status; };
let ok = true;
// A: an update adds a column, and two fresh copies of the server start at the same moment
let dropped = true; try { await db.prepare("ALTER TABLE users DROP COLUMN assign_per_day").run(); } catch (e) { dropped = false; console.log("drop column not supported here:", e.message); }
await db.prepare("DELETE FROM settings WHERE key = 'schema_rev'").run();
const both = await Promise.all([fresh(), fresh()]);
const col = (await q("PRAGMA table_info(users)")).some((c) => c.name === "assign_per_day");
console.log("A: two fresh starts together after an update:", JSON.stringify(both), "| column there:", col, "| column was removed first:", dropped); ok = ok && both.every((s) => s === 200) && col;
let dupMsg = ""; try { await db.prepare("ALTER TABLE users ADD COLUMN assign_per_day INTEGER").run(); } catch (e) { dupMsg = e.message; }
console.log("A: the database's message for a column already there:", JSON.stringify(dupMsg), "| recognised:", /duplicate column/i.test(dupMsg)); ok = ok && /duplicate column/i.test(dupMsg);
// B: an unexpected error is kept in the audit trail, and the app mends itself
await db.prepare("DROP TABLE user_notices").run();
let r1; try { await A("notify.list", {}); r1 = "no error"; } catch (e) { r1 = e.message + " (" + e.status + ")"; }
const row = (await q("SELECT user_name, action, detail FROM audit_log WHERE action = 'server.error' ORDER BY at DESC LIMIT 1"))[0];
console.log("B: the page got:", r1, "| audit trail:", JSON.stringify(row)); ok = ok && /Server error/.test(r1) && row && /^notify\.list: .*no such table: user_notices/.test(row.detail) && row.user_name === "Supervisor";
let r2; try { await A("notify.list", {}); r2 = "ok"; } catch (e) { r2 = e.message; }
console.log("B: the next request:", r2, "| table back:", (await q("SELECT name FROM sqlite_master WHERE name = 'user_notices'")).length === 1); ok = ok && r2 === "ok";
let r3; try { await A("notify.list", {}); r3 = "ok"; } catch (e) { r3 = e.message; }
console.log("B: and after that:", r3); ok = ok && r3 === "ok";
console.log(`\n==== ${ok ? "1 passed, 0 failed of 1" : "0 passed, 1 failed of 1"}`); process.exit(ok ? 0 : 1);
