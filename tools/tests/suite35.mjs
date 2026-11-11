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

S("A-15: one day / month order per date column");
{
  const cl = await mkClient("Made-up Clinic S35 A15");
  await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "Date Worked"],
    ["9815001", "Test Patient One", "Aetna", "13/06/2026", "400.00", "Pending", "13/10/2026"],
    ["9815002", "Test Patient Two", "Aetna", "05/06/2026", "400.00", "Pending", "05/11/2026"]], { kind: "worked" });
  const c2 = (await claimsOf(cl)).find((c) => c.claim_no === "9815002") || {};
  ok("A-15: a day-first column (13/06/2026 in it) reads 05/06/2026 as 5 June and a Date Worked of 05/11/2026 as 5 Nov", c2.dos === "2026-06-05" && c2.last_worked_on === "2026-11-05", [c2.dos, c2.last_worked_on]);
  const b = build([["Claim ID", "Patient Name", "DOS", "Balance"], ["9815003", "Test Patient Three", "06/13/2026", "10"], ["9815004", "Test Patient Four", "05/06/2026", "10"]]);
  const d = Object.fromEntries(b.claims.map((c) => [c.claim_no, c.dos]));
  ok("A-15: a month-first column (06/13/2026 in it) reads 05/06/2026 as 6 May", d["9815003"] === "2026-06-13" && d["9815004"] === "2026-05-06", d);
  const b2 = build([["Claim ID", "Patient Name", "DOS", "Balance"], ["9815005", "Test Patient Five", "05/06/2026", "10"], ["9815006", "Test Patient Six", "2026-07-01", "10"]]);
  ok("A-15: a column with no part over 12 stays month first", b2.claims.find((c) => c.claim_no === "9815005").dos === "2026-05-06", b2.claims.map((c) => c.dos));
  const order = typeof app.dateOrderOf === "function" ? app.dateOrderOf : () => "none";
  ok("A-15: the order is decided per column (13/06 day first, 06/13 month first, both: each date on its own, neither: month first)",
    order(["13/06/2026", "05/06/2026"]) === "dmy" && order(["06/13/2026", "05/06/2026"]) === "mdy" && order(["13/06/2026", "06/14/2026"]) === "" && order(["05/06/2026", 46280]) === "mdy",
    [order(["13/06/2026", "05/06/2026"]), order(["06/13/2026"]), order(["13/06/2026", "06/14/2026"])]);
  const mixed = build([["Claim ID", "Patient Name", "DOS", "Balance"], ["9815007", "Test Patient Seven", "13/06/2026", "10"], ["9815008", "Test Patient Eight", "06/14/2026", "10"]]);
  ok("A-15: a column with both orders reads each date the only way it can be read", mixed.claims.map((c) => c.dos).sort().join() === "2026-06-13,2026-06-14", mixed.claims.map((c) => c.dos));
}

S("F-07: the Client 360 EV upload reads a day-first file and keeps other months' rows");
{
  const cl = await mkClient("Made-up Clinic S35 F07");
  const sep = Array.from({ length: 10 }, (_, i) => ({ wd: "2026-09-" + String(i + 1).padStart(2, "0"), py: "Aetna", st: "Active coverage", by: "Test EV A" }));
  await A("creport.evUpload", { client_id: cl.id, file_name: "EV Sep.xlsx", rows: sep });
  let csv = "Date Verified,DOS,Insurance,Status,Verified By\n", n = 0;
  for (let d = 1; d <= 31; d++) { const w = new RealDate(Date.UTC(2026, 9, d)).getUTCDay(); if (w === 0 || w === 6) continue; n++; csv += `${String(d).padStart(2, "0")}/10/2026,${String(d).padStart(2, "0")}/09/2026,Aetna,Active coverage,Test EV B\n`; }
  const draft = app.crReadEV(new TextEncoder().encode(csv), "EV Oct.csv");
  ok("F-07: 01/10/2026 to 30/10/2026 is read as 1 to 30 Oct (the start screen shows the range before saving)", draft.from === "2026-10-01" && draft.to === "2026-10-30" && draft.n === n && draft.rows.every((r) => r.wd.slice(0, 7) === "2026-10" && r.dos.slice(0, 7) === "2026-09"), [draft.from, draft.to, draft.n]);
  const r = await A("creport.evUpload", { client_id: cl.id, file_name: draft.file, rows: draft.rows });
  const cnt = async (m) => (await q1("SELECT COUNT(*) AS n FROM ev_rows WHERE client_id = ? AND work_date LIKE ?", cl.id, m + "-%")).n;
  ok("F-07: saving October keeps September's 10 rows and keeps all of October's checks", r.n === n && (await cnt("2026-09")) === 10 && (await cnt("2026-10")) === n, [r.n, await cnt("2026-09"), await cnt("2026-10")]);
  // a file whose dates really are spread (one stray check in July): only that day's rows in July are replaced, never August and September
  await A("creport.evUpload", { client_id: cl.id, file_name: "EV Aug.xlsx", rows: [{ wd: "2026-08-03", py: "Cigna", st: "Active coverage", by: "Test EV A" }, { wd: "2026-07-15", py: "Cigna", st: "Active coverage", by: "Test EV A" }] });
  await A("creport.evUpload", { client_id: cl.id, file_name: "EV Oct fixed.xlsx", rows: [...draft.rows, { wd: "2026-07-15", py: "Cigna", st: "Inactive", by: "Test EV B" }] });
  ok("F-07: a stray date in July replaces only that day's July rows; August and September stay", (await cnt("2026-08")) === 1 && (await cnt("2026-09")) === 10 && (await cnt("2026-07")) === 1 && (await cnt("2026-10")) === n
    && (await q1("SELECT status FROM ev_rows WHERE client_id = ? AND work_date = '2026-07-15'", cl.id)).status === "Inactive", [await cnt("2026-07"), await cnt("2026-08"), await cnt("2026-09"), await cnt("2026-10")]);
  await A("creport.evUpload", { client_id: cl.id, file_name: "EV Oct again.xlsx", rows: draft.rows.filter((x) => x.wd !== "2026-10-15") });
  ok("F-07: a new file for the same month still replaces that month's rows from its first to its last check", (await cnt("2026-10")) === n - 1 && (await cnt("2026-09")) === 10, [await cnt("2026-10")]);
}

globalThis.Date = RealDate;
const fails = results.filter((r) => !r.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
