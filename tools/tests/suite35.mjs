/* Suite 35: regression checks for the bug-test fixes in inventory, upload, allocation and money (tester A's findings, and F-07).
   Files go through the page's own reader and claim builder (readWorkbook > tableFromSheet > autoMap > buildClaims > uploadClaims)
   against the real worker, on a frozen clock for both the server and the page. Made-up clients, patients and claims only. */
import { makeRig } from "./rig.mjs";
import vm from "vm";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const rig = await makeRig({});
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB;
const q = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results;
const q1 = async (sql, ...a) => (await q(sql, ...a))[0] || null;
const x = (sql, ...a) => DB.prepare(sql).bind(...a).run();
const ev = (code) => vm.runInContext(code, app);
await app.seedDemo(() => {});
const A = as((await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") })).token);
const login = async (email) => as((await as(null)("auth.login", { email, passHash: await sha("brahmastra-demo") })).token);
// the clock, frozen for the server (this process) and for the page's code (its own context)
const RealDate = globalThis.Date;
const freeze = (iso) => {
  const ms = Date.parse(iso);
  globalThis.Date = class extends RealDate { constructor(...a) { if (!a.length) super(ms); else super(...a); } static now() { return ms; } };
  ev(`(() => { const R = globalThis.__RD || Date; globalThis.__RD = R; globalThis.Date = class extends R { constructor(...a) { if (!a.length) super(${ms}); else super(...a); } static now() { return ${ms}; } }; })()`);
};
freeze("2026-11-10T06:00:00Z");   // Tue 10 Nov 2026, 11:30 IST
const TODAY = "2026-11-10";
// a made-up client with one location, made through the real op
let nClient = 0;
const adminId = (await q1("SELECT id FROM users WHERE role = 'admin' LIMIT 1")).id;
const mkClient = async (name) => {
  const r = await A("clients.save", { name, code: "T" + (++nClient), follow_up_days: 30, active: true, locations: ["Main Office"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: adminId } } } });
  const loc = await q1("SELECT id FROM locations WHERE client_id = ?", r.client.id);
  return { id: r.client.id, loc: loc.id };
};
// a CSV the way Excel writes it, read and loaded by the page's own code
const toCsv = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
const bytesOf = (text) => { const b = new TextEncoder().encode(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const readCsv = (rows, name = "inventory.csv") => app.tableFromSheet(app.readWorkbook(bytesOf(toCsv(rows)), name)[0].rows);
const build = (rows, kind = "fresh") => { const t = readCsv(rows); return app.buildClaims({ rows: t.rows, mapping: app.autoMap(t.headers), kind, today: TODAY }); };
const upload = async (cl, rows, { kind = "fresh", name = "inventory.csv" } = {}) => {
  const t = readCsv(rows, name), mapping = app.autoMap(t.headers), built = app.buildClaims({ rows: t.rows, mapping, kind, today: TODAY });
  const r = await app.uploadClaims({ client_id: cl.id, location_id: cl.loc, kind, file_name: name, claims: built.claims, summary: { ...built.summary, mapping }, rows_read: t.rows.length });
  return { built, r };
};
const claimsOf = (cl) => q("SELECT * FROM claims WHERE client_id = ? ORDER BY claim_no", cl.id);
const H = ["Claim ID", "Account #", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "Comments"];

S("A-08: a CSV is read as text");
{
  const cl = await mkClient("Made-up Clinic S35 A08");
  await upload(cl, [H,
    ["123456789012345678", "000451", "Test Patient One", "Aetna", "09/15/2026", "100.00", "Denied", "==called=="],
    ["123456789012345679", "000452", "Test Patient Two", "Aetna", "09/16/2026", "200.00", "Denied", ""],
    ["00012345", "000453", "Test Patient Three", "Cigna", "09/17/2026", "50.00", "Pending", ""],
    ["12/14", "000454", "Test Patient Four", "Cigna", "09/18/2026", "75.00", "Pending", ""]]);
  const got = await claimsOf(cl), by = (n) => got.find((c) => c.claim_no === n) || {};
  ok("A-08: two 18-digit claim numbers stay two claims with every digit, each with its own balance", by("123456789012345678").balance === 100 && by("123456789012345679").balance === 200 && got.length === 4, got.map((c) => [c.claim_no, c.balance]));
  ok("A-08: leading zeros stay on claim and account numbers", by("00012345").account_no === "000453" && by("123456789012345678").account_no === "000451", got.map((c) => [c.claim_no, c.account_no]));
  ok("A-08: a claim id written 12/14 stays 12/14 (not a date)", by("12/14").balance === 75, got.map((c) => c.claim_no));
  ok("A-08: a comment that starts with = comes through as written", by("123456789012345678").file_comments === "==called==", by("123456789012345678").file_comments);
  const t = readCsv([["Claim ID", "DOS", "Balance"], ["9800001", "2026-10-26", "1,234.50"]]);
  ok("A-08: an ISO date and an amount stay text in the cell (no time zone can move the day)", t.rows[0].DOS === "2026-10-26" && t.rows[0].Balance === "1,234.50", t.rows[0]);
  ok("A-08: a formula written as text in a money column is no amount", app.parseMoney("=SUM(F2:F9)") === null && app.parseMoney("$1,234.50") === 1234.5 && app.parseMoney("(45.00)") === -45, [app.parseMoney("=SUM(F2:F9)")]);
  const b = build([["Claim ID", "Patient Name", "DOS", "Balance"], ["9800002", "Test Patient Five", "02/30/2026", "10"], ["9800003", "Test Patient Six", "03/15/95", "10"], ["9800004", "Test Patient Seven", "10/26/26", "10"]]);
  const dos = Object.fromEntries(b.claims.map((c) => [c.claim_no, c.dos]));
  ok("A-08: an impossible date (02/30/2026) is no date; 03/15/95 is 1995 and 10/26/26 is 2026, as before", dos["9800002"] === "" && dos["9800003"] === "1995-03-15" && dos["9800004"] === "2026-10-26", dos);
}

globalThis.Date = RealDate;
const fails = results.filter((r) => !r.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
