/* Suite 35: regression checks for the bug-test fixes in inventory, upload, allocation and money (tester A's findings, and F-07).
   Files go through the page's own reader and claim builder (readWorkbook > tableFromSheet > autoMap > buildClaims > uploadClaims)
   against the real worker, on a frozen clock for both the server and the page. Made-up clients, patients and claims only. */
import { makeRig } from "./rig.mjs";
import vm from "vm";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
// ---- a fake Microsoft Graph for the OneDrive checks (as suite34 has): folders, files and worksheets per workbook. A new month's
// file starts the way OneDrive makes it from the template, with the AR header on Sheet1 (OD.blankNext: the next file starts empty). ----
const AR_HEADER = ["Sr. No", "Location", "Project", "Practice", "Uni", "IG Claim ID#/Charge ID#", "Patient Name", "DOS", "Payer", "Age", "Bucket", "Billed Amount($)", "Balance Amount($)", "CPT",
  "Comments/Notes", "Status", "Sub Status", "Action", "Bucket", "Mode of Work", "Start Time", "End Time", "Total Duration", "Date Worked", "Emp. ID", "Associate Name", "Status", "Errors", "Team Lead", "Date Range", "Week"];
const OD = { items: new Map(), seq: 0, books: new Map(), blankNext: false };
const odMk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it);
  if (kind === "file") { OD.books.set(id, { n: 1, sheets: [{ id: "s1", name: "Sheet1", rows: OD.blankNext ? [] : [AR_HEADER.slice()], fmts: [] }] }); OD.blankNext = false; } return it; };
const odChild = (parent, name) => [...OD.items.values()].find((i) => i.parent === parent && i.name.toLowerCase() === name.toLowerCase());
const odOut = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const colNum = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const graph = async (url, init) => {
  const m = (init && init.method) || "GET", path = decodeURIComponent(new URL(url).pathname.replace(/^\/v1\.0/, "")); let r;
  const bk = (id) => OD.books.get(id), sh = (b, sid) => b && b.sheets.find((s) => s.id === sid);
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (odChild("root", b.name)) return J({}, 409); return J(odOut(odMk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = odChild("root", r[1]); return it ? J(odOut(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (odChild(r[1], b.name)) return J({}, 409); return J(odOut(odMk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (odChild(r[1], r[2])) return J({}, 409); return J(odOut(odMk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = odChild(r[1], r[2].replace(/:$/, "")); return it ? J(odOut(it)) : J({}, 404); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: bk(r[1]).sheets.map((s) => ({ id: s.id, name: s.name })) });
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/add$/))) { const b = bk(r[1]), s = { id: "s" + (++b.n), name: JSON.parse(init.body).name, rows: [], fmts: [] }; b.sheets.push(s); return J({ id: s.id, name: s.name }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)$/))) { const s = sh(bk(r[1]), r[2]); s.name = JSON.parse(init.body).name; return J({ id: s.id, name: s.name }); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/usedRange/))) { const s = sh(bk(r[1]), r[2]), n = Math.max(1, s.rows.length); return J({ rowCount: n, address: s.name + "!A1:AE" + n, values: s.rows.length ? s.rows : [[""]] }); }
  if (m === "PATCH" && path.match(/\/range\(address='[A-Z]+\d+:[A-Z]+\d+'\)\/format\//)) return J({});
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/range\(address='([A-Z]+)(\d+):[A-Z]+\d+'\)$/))) {
    const s = sh(bk(r[1]), r[2]), at = Number(r[4]) - 1, c0 = colNum(r[3]) - 1, body = JSON.parse(init.body);
    body.values.forEach((row, i) => { const cur = s.rows[at + i] || []; row.forEach((v, k) => { cur[c0 + k] = v; }); s.rows[at + i] = cur; s.fmts[at + i] = body.numberFormat ? body.numberFormat[i] : null; }); return J({}); }
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
const fetchMock = async (url, init) => (url.includes("login.microsoftonline.com") ? J({ access_token: "t" }) : url.includes("graph.microsoft.com") ? graph(url, init) : new Response("nope", { status: 500 }));
const rig = await makeRig({ envExtra: { MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
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
// OneDrive copies are off in demo mode: a check that needs them switches them on for its own steps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withOneDrive = async (fn) => { rig.liveEnv.DEMO = false; try { return await fn(); } finally { await sleep(300); rig.liveEnv.DEMO = true; } };
const odFile = (clientName, scopeFolder, prefix) => { const root = odChild("root", "Brahmastra Clients"), f = root && odChild(root.id, clientName), prod = f && odChild(f.id, "Production"), sc = prod && odChild(prod.id, scopeFolder);
  const it = sc && odChild(sc.id, `${prefix} Production - ${clientName} - Nov 2026.xlsx`); return it ? OD.books.get(it.id) : null; };
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

S("A-04: dates of birth from a patient details report");
if (typeof app.detailRows !== "function") ok("A-04: the patient details report reads its date-of-birth column as dates of birth", false, "detailRows is missing");
else {
  const cl = await mkClient("Made-up Clinic S35 A04");
  await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"],
    ...["9804001", "9804002", "9804003", "9804004", "9804005"].map((n, i) => [n, "Test Patient " + i, "Medicare", "09/15/2026", "300", "Pending"])]);
  const fill = async (rows, name) => { const t = name.endsWith(".csv") ? readCsv(rows, name) : app.tableFromSheet(rows); return A("inventory.enrich", { client_id: cl.id, purpose: "DOB / member ID needed for calls", file_name: name, rows: app.detailRows({ rows: t.rows, map: app.detailAutoMap(t.headers) }) }); };
  await fill([["Claim ID", "DOB"], ["9804001", "06/15/1952"], ["9804002", "03/15/95"]], "details.csv");
  await fill([["Claim ID", "DOB"], ["9804003", 19160], ["9804004", "12/15/26"], ["9804005", 95000]], "details.xlsx");   // an Excel date cell, text, a number that is no date
  const dob = Object.fromEntries((await claimsOf(cl)).map((c) => [c.claim_no, c.patient_dob]));
  ok("A-04: 06/15/1952 from a CSV is 15 Jun 1952 (not a serial number)", dob["9804001"] === "1952-06-15", dob);
  ok("A-04: an Excel date cell before 1954 (19160) is 15 Jun 1952", dob["9804003"] === "1952-06-15", dob);
  ok("A-04: a two-digit year in a date of birth: 03/15/95 is 1995, and 12/15/26 (still to come on 10 Nov 2026) is 1926", dob["9804002"] === "1995-03-15" && dob["9804004"] === "1926-12-15", dob);
  ok("A-04: a number that cannot be a date of birth is left out, never stored as the bare number", dob["9804005"] === "", dob);
  ok("A-04: other dates keep their rule: a follow-up written 12/15/26 is 15 Dec 2026", app.parseDateAny("12/15/26") === "2026-12-15" && app.parseDateAny("06/15/1952") === "", [app.parseDateAny("12/15/26"), app.parseDateAny("06/15/1952")]);
  ok("A-04: a date of birth is never after today", app.parseDateAny("2026-11-11", { dob: true }) === "" && app.parseDateAny("2026-11-10", { dob: true }) === "2026-11-10", app.parseDateAny("2026-11-11", { dob: true }));
}

S("A-01: a file status of Unpaid or Not paid is open money");
{
  const cl = await mkClient("Made-up Clinic S35 A01");
  const up = await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "CPT", "AR Balance", "Status"],
    ["9801001", "Test Patient One", "Aetna", "09/15/2026", "99213", "1250.00", "Unpaid"], ["9801002", "Test Patient Two", "Cigna", "09/20/2026", "99214", "980.00", "Not paid"],
    ["9801003", "Test Patient Three", "UHC", "09/22/2026", "99213", "400.00", "Pending"], ["9801004", "Test Patient Four", "UHC", "09/22/2026", "99213", "300.00", "Paid in full"]]);
  const got = Object.fromEntries((await claimsOf(cl)).map((c) => [c.claim_no, c.state + " " + c.status_class]));
  ok("A-01: Unpaid and Not paid load as open claims (awaiting payer); Paid in full still closes", got["9801001"] === "open awaiting" && got["9801002"] === "open awaiting" && got["9801004"] === "closed paid" && up.r.inserted === 3 && up.r.closed === 1, [got, up.r]);
  const st = await A("inventory.status", { client_id: cl.id, today: TODAY });
  ok("A-01: Inventory status counts their money: AR $2,630", Math.round(st.ar * 100) === 263000, st.ar);
  const cls = (s) => app.classifyOne(s);
  ok("A-01: paid and closed are read as words (Prepaid, Overpaid are not paid; PAID_IN_FULL, Paid/Closed, Claim closed are)", cls("Prepaid") !== "paid" && cls("Overpaid") !== "paid" && cls("No payment") === "awaiting" && cls("Not closed") === "awaiting"
    && cls("PAID_IN_FULL") === "paid" && cls("Paid/Closed") === "paid" && cls("Claim closed") === "paid" && cls("Underpaid") === "partial" && cls("Denied - not paid") === "denied",
    ["Prepaid", "Overpaid", "No payment", "Not closed", "PAID_IN_FULL", "Paid/Closed", "Claim closed", "Underpaid", "Denied - not paid"].map((s) => s + ":" + cls(s)));
  // a later file that says Unpaid does not close a claim already on file
  await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "CPT", "AR Balance", "Status"], ["9801003", "Test Patient Three", "UHC", "09/22/2026", "99213", "400.00", "Unpaid"]], { name: "next.csv" });
  ok("A-01: a later file with Unpaid leaves the claim open", (await q1("SELECT state FROM claims WHERE client_id = ? AND claim_no = '9801003'", cl.id)).state === "open");
}

S("A-02: credit balances");
{
  const pm = (v) => app.parseMoney(v);
  ok("A-02: 45.00CR, 45.00 CR, CR 45.00, CR45.00 and a minus sign (U+2212) are all a credit of 45", [pm("45.00CR"), pm("45.00 CR"), pm("CR 45.00"), pm("CR45.00"), pm("\u221245.00"), pm("45.00 cr")].every((n) => n === -45),
    [pm("45.00CR"), pm("45.00 CR"), pm("CR 45.00"), pm("CR45.00"), pm("\u221245.00")]);
  ok("A-02: the forms read before still read: (45.00), -45, 45-, $-45, $1,234.50, 45.00DR, a plain number", pm("(45.00)") === -45 && pm("-45") === -45 && pm("45-") === -45 && pm("$-45") === -45 && pm("$1,234.50") === 1234.5 && pm("45.00DR") === 45 && pm(12.5) === 12.5 && pm("N/A") === null,
    [pm("(45.00)"), pm("-45"), pm("45-"), pm("$-45"), pm("$1,234.50"), pm("45.00DR")]);
  const cl = await mkClient("Made-up Clinic S35 A02");
  await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"],
    ["9802001", "Test Patient One", "Aetna", "09/15/2026", "45.00CR", "Pending"], ["9802002", "Test Patient Two", "Aetna", "09/15/2026", "45.00 CR", "Pending"],
    ["9802003", "Test Patient Three", "Aetna", "09/15/2026", "CR 45.00", "Pending"], ["9802004", "Test Patient Four", "Aetna", "09/15/2026", "\u221245.00", "Pending"],
    ["9802005", "Test Patient Five", "Aetna", "09/15/2026", "45.00", "Pending"]]);
  const got = await claimsOf(cl), credits = got.filter((c) => c.claim_no !== "9802005");
  ok("A-02: the four credits are set aside as credit balances (-45), not loaded as workable claims", credits.length === 4 && credits.every((c) => c.balance === -45 && c.state === "excluded" && c.state_reason === "credit balance"), got.map((c) => [c.claim_no, c.balance, c.state, c.state_reason]));
  const st = await A("inventory.status", { client_id: cl.id, today: TODAY });
  ok("A-02: Inventory status counts only the real balance: AR $45", st.ar === 45, st.ar);
  // the same reading on the server: the client's own balance column in the Submission file
  const sc = await mkClient("Made-up Clinic S35 A02 Sub");
  await upload(sc, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "VEC Patient Balance"],
    ["9802101", "Test Patient One", "Aetna", "09/15/2026", "300.00", "Rejected", "45.00CR"], ["9802102", "Test Patient Two", "Aetna", "09/16/2026", "200.00", "Rejected", "$1,035.50"]]);
  const row = await withOneDrive(async () => {
    await A("clients.saveResponsibility", { client_id: sc.id, dept: "submission", mode: "person", lead: adminId });
    const ids = (await claimsOf(sc)).map((c) => c.id);
    await A("alloc.reassign", { ids, user_id: adminId });
    for (const id of ids) {
      await A("queue.complete", { id, today: TODAY, saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Member ID corrected, to be resubmitted", action: "follow up" } });
      const h = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission'", id);
      const r = await T(() => A("handoffs.close", { id: h && h.id, outcome: "complete", today: TODAY, note: "Resubmitted", proof: { date: TODAY, ref: "B-1", mode: "Portal", inv_status: "Resubmitted", bucket: "Payer", claim_type: "Resubmission", type: "" } }));
      if (!r.ok) return r;
      await sleep(400);
    }
    const book = odFile("Made-up Clinic S35 A02 Sub", "Submission", "Submission"), tab = book && book.sheets.find((t) => t.name === "Submission");
    return tab ? tab.rows : null;
  });
  const iBal = Array.isArray(row) && row[0] ? row[0].indexOf("VEC Patient Balance") : -1;
  ok("A-02: in the Submission file a client balance written 45.00CR is -45, and $1,035.50 stays 1035.5", iBal >= 0 && row[1][iBal] === -45 && row[2][iBal] === 1035.5, row && row.e ? row.e : row && row.slice(0, 3).map((x) => x[iBal]));
}

S("A-03: a claim is not a total row because a name starts with Total");
{
  const cl = await mkClient("Made-up Clinic S35 A03");
  const HH = ["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"];
  const up = await upload(cl, [HH,
    ["9803001", "Test Patient One", "Total Health Plan", "09/15/2026", "1500.00", "Denied"], ["9803002", "Total, Tomas", "Aetna", "09/16/2026", "700.00", "Pending"],
    ["9803003", "Test Patient Three", "Cigna", "09/17/2026", "300.00", "Pending"], ["9803004", "Test Patient Four", "Total Health Plan", "", "250.00", "Pending"],
    ["Total", "", "", "", "2750.00", ""]]);
  const got = (await claimsOf(cl)).map((c) => c.claim_no);
  ok("A-03: claims with payer Total Health Plan (one with no DOS) and patient Total, Tomas load; only the Total row is skipped", ["9803001", "9803002", "9803003", "9803004"].every((n) => got.includes(n)) && got.length === 4 && up.built.summary.footer === 1 && up.r.inserted === 4,
    [got, up.built.summary.footer, up.r.inserted]);
  const b = build([HH, ["9803011", "Test Patient One", "Aetna", "09/15/2026", "100.00", "Pending"],
    ["Grand Total: 3 claims", "", "", "", "100.00", ""], ["", "Sub total", "", "", "100.00", ""], ["3", "", "Totals", "", "100.00", ""], ["", "", "Total Aetna", "", "100.00", ""], ["", "TOTAL:", "", "", "100.00", ""]]);
  ok("A-03: real footer rows are still skipped (Grand Total: 3 claims, Sub total, Totals beside a count, Total Aetna, TOTAL:)", b.claims.length === 1 && b.claims[0].claim_no === "9803011" && b.summary.footer + b.summary.blank === 5, [b.claims.map((c) => c.claim_no || c.patient || c.payer), b.summary.footer, b.summary.blank]);
}

S("A-13: a claim loaded without a claim number, then with its real number");
{
  const HH = ["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"];
  const cl = await mkClient("Made-up Clinic S35 A13");
  await upload(cl, [HH, ["", "Test Patient One", "Aetna", "09/05/2026", "500.00", "Pending"]], { name: "October file.csv" });
  const first = (await claimsOf(cl))[0];
  const r2 = await upload(cl, [HH, ["9813001", "Test Patient One", "Aetna", "09/05/2026", "450.00", "Denied"]], { name: "November file.csv" });
  let got = await claimsOf(cl);
  ok("A-13: the later file with the real number refreshes the BR-... claim: one claim, number 9813001, $450", /^BR-[0-9A-F]{8}$/.test(first.claim_no) && got.length === 1 && got[0].id === first.id && got[0].claim_no === "9813001" && got[0].balance === 450 && r2.r.inserted === 0 && r2.r.updated === 1,
    [first.claim_no, got.map((c) => [c.claim_no, c.balance]), r2.r]);
  const st = await A("inventory.status", { client_id: cl.id, today: TODAY });
  ok("A-13: the money is counted once (AR $450) and Merge duplicates has nothing to merge", st.ar === 450 && (await A("inventory.dedupe", { client_id: cl.id, dry_run: true })).duplicates === 0, st.ar);
  await upload(cl, [HH, ["9813001", "Test Patient One", "Aetna", "09/05/2026", "440.00", "Denied"]], { name: "December file.csv" });
  await upload(cl, [HH, ["", "Test Patient One", "Aetna", "09/05/2026", "430.00", "Denied"]], { name: "A file without numbers again.csv" });
  got = await claimsOf(cl);
  ok("A-13: later files find it again, by number or without one, and a file without numbers keeps the real number", got.length === 1 && got[0].claim_no === "9813001" && got[0].balance === 430, got.map((c) => [c.claim_no, c.balance]));
  // the other way round: the number first, then a file without numbers
  const c2 = await mkClient("Made-up Clinic S35 A13 b");
  await upload(c2, [HH, ["9813101", "Test Patient Two", "Cigna", "09/06/2026", "300.00", "Pending"]]);
  await upload(c2, [HH, ["", "Test Patient Two", "Cigna", "09/06/2026", "280.00", "Pending"]], { name: "next.csv" });
  got = await claimsOf(c2);
  ok("A-13: number first, then a file without numbers: still one claim, with its number", got.length === 1 && got[0].claim_no === "9813101" && got[0].balance === 280, got.map((c) => [c.claim_no, c.balance]));
  // genuinely different claims stay apart
  const c3 = await mkClient("Made-up Clinic S35 A13 c");
  await upload(c3, [HH, ["", "Test Patient Three", "Aetna", "09/07/2026", "100.00", "Pending"], ["", "Test Patient Three", "Cigna", "09/07/2026", "150.00", "Pending"]]);
  ok("A-13: two rows without a number for one patient and DOS but different payers are two claims", (await claimsOf(c3)).length === 2, (await claimsOf(c3)).map((c) => [c.claim_no, c.payer]));
  await upload(c3, [HH, ["9813201", "Test Patient Three", "UHC", "09/07/2026", "200.00", "Pending"], ["9813202", "Test Patient Four", "Aetna", "09/08/2026", "50.00", "Pending"], ["9813203", "Test Patient Four", "Aetna", "09/08/2026", "60.00", "Pending"]], { name: "next.csv" });
  got = await claimsOf(c3);
  ok("A-13: a real number with another payer does not take over a BR-... claim, and two different real numbers are two claims", got.length === 5 && got.filter((c) => /^BR-/.test(c.claim_no)).length === 2, got.map((c) => [c.claim_no, c.payer]));
  ok("A-13: Merge duplicates leaves these different claims alone", (await A("inventory.dedupe", { client_id: c3.id, dry_run: true })).duplicates === 0);
  // copies made before the fix (a BR-... claim and the same claim under its real number) are found and merged, keeping the real number
  await x("UPDATE claims SET payer = 'Aetna' WHERE client_id = ? AND claim_no = '9813201'", c3.id);
  const dry = await A("inventory.dedupe", { client_id: c3.id, dry_run: true });
  await A("inventory.dedupe", { client_id: c3.id });
  got = await claimsOf(c3);
  ok("A-13: Merge duplicates finds a BR-... claim and its real-number copy and keeps the real number", dry.duplicates === 1 && got.length === 4 && got.filter((c) => c.payer === "Aetna" && c.patient === "Test Patient Three").map((c) => c.claim_no).join() === "9813201",
    [dry, got.map((c) => [c.claim_no, c.payer])]);
}

const billers = await q("SELECT id, name, email FROM users WHERE role = 'user' AND active = 1 ORDER BY name");
S("A-07: previously worked claims wait for their follow-up date");
{
  const HW = ["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "Date Worked", "Comments"];
  const cl = await mkClient("Made-up Clinic S35 A07");
  await A("clients.saveTeam", { client_id: cl.id, team: [billers[0].id] });
  const up = await upload(cl, [HW,
    ["9807001", "Test Patient One", "Aetna", "09/10/2026", "800.00", "Pending", "11/05/2026", "Called the payer, claim in process, call back in 30 days"],
    ["9807002", "Test Patient Two", "Aetna", "08/10/2026", "600.00", "Pending", "09/01/2026", "Called the payer, in process"],
    ["9807003", "Test Patient Three", "Aetna", "08/11/2026", "500.00", "Pending", "", ""]], { kind: "worked" });
  const st = async () => Object.fromEntries((await claimsOf(cl)).map((c) => [c.claim_no, c.state + " " + c.follow_up_on + " " + (c.assigned_to ? "on a list" : "no list")]));
  let now = await st();
  ok("A-07: worked 11/05 (follow-up 12/05) is stored as worked and waiting; one whose follow-up has come, or with no date worked, is open", now["9807001"] === "completed 2026-12-05 no list" && now["9807002"] === "open 2026-10-01 no list" && now["9807003"] === "open  no list" && up.r.inserted === 3, [now, up.r]);
  const pool = async (today) => (await A("claims.eligible", { client_id: cl.id, today })).claims.map((c) => c.claim_no).sort().join();
  const inv = await A("inventory.status", { client_id: cl.id, today: TODAY });
  ok("A-07: it is not in the pool today and is not counted as unassigned (Inventory status: 2 unassigned, 1 follow-up later)", (await pool(TODAY)) === "9807002,9807003" && inv.stages.open.n === 2 && inv.stages.later.n === 1, [await pool(TODAY), inv.stages.open.n, inv.stages.later.n]);
  const al = await app.autoAllocate({ ctx: null, client: { id: cl.id }, loc: { id: cl.loc } });
  now = await st();
  ok("A-07: the allocation after loading hands out the two open claims and leaves the waiting one", al.applied === 2 && now["9807001"] === "completed 2026-12-05 no list" && /^assigned .* on a list$/.test(now["9807002"]), [al.applied, now]);
  ok("A-07: on its follow-up date it is back in the pool, and can be allocated", (await pool("2026-12-04")) === "" && (await pool("2026-12-05")) === "9807001"
    && (await A("alloc.apply", { client_id: cl.id, today: "2026-12-05", assignments: [{ id: (await q1("SELECT id FROM claims WHERE client_id = ? AND claim_no = '9807001'", cl.id)).id, user_id: billers[0].id, priority: 10 }] })).applied === 1, [await pool("2026-12-04"), await pool("2026-12-05")]);
  // a claim already on file: an unassigned one leaves the pool when a worked file gives it a later follow-up, one on a list stays there
  const c2 = await mkClient("Made-up Clinic S35 A07 b");
  await A("clients.saveTeam", { client_id: c2.id, team: [billers[0].id] });
  const HF = ["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"];
  await upload(c2, [HF, ["9807101", "Test Patient One", "Aetna", "09/10/2026", "800.00", "Pending"], ["9807102", "Test Patient Two", "Aetna", "09/11/2026", "700.00", "Pending"]]);
  await A("alloc.reassign", { ids: [(await q1("SELECT id FROM claims WHERE client_id = ? AND claim_no = '9807102'", c2.id)).id], user_id: billers[0].id });
  const up2 = await upload(c2, [HW, ["9807101", "Test Patient One", "Aetna", "09/10/2026", "800.00", "Pending", "11/05/2026", "In process"], ["9807102", "Test Patient Two", "Aetna", "09/11/2026", "700.00", "Pending", "11/05/2026", "In process"]], { kind: "worked", name: "worked.csv" });
  const s2 = Object.fromEntries((await claimsOf(c2)).map((c) => [c.claim_no, c.state]));
  ok("A-07: a worked file with a later follow-up takes an unassigned claim out of the pool; a claim on a biller's list stays on it", s2["9807101"] === "completed" && s2["9807102"] === "assigned" && up2.r.updated === 2, [s2, up2.r]);
  await A("inventory.undoBatch", { batch_id: up2.r.batch_id });
  ok("A-07: undoing that worked file puts the claim back in the pool", (await q1("SELECT state FROM claims WHERE client_id = ? AND claim_no = '9807101'", c2.id)).state === "open");
}

S("A-05: Undo upload after the upload allocated its claims");
{
  const HF = ["Claim ID", "Patient Name", "Payer", "Date of Service", "CPT", "AR Balance", "Status"];
  const cl = await mkClient("Made-up Clinic S35 A05");
  await A("clients.saveTeam", { client_id: cl.id, team: billers.map((b) => b.id) });
  const up = await upload(cl, [HF, ...Array.from({ length: 6 }, (_, i) => [String(9805001 + i), "Test Patient " + i, "Aetna", "09/10/2026", "99213", "250.00", "Pending"])], { name: "wrong file.csv" });
  const al = await app.autoAllocate({ ctx: null, client: { id: cl.id }, loc: { id: cl.loc } });
  const onLists = await q("SELECT assigned_to, COUNT(*) AS n FROM claims WHERE client_id = ? AND assigned_to IS NOT NULL GROUP BY assigned_to", cl.id);
  const r = await A("inventory.undoBatch", { batch_id: up.r.batch_id });
  ok("A-05: the wrong file's 6 claims, handed to billers but never opened, are all removed by Undo", al.applied === 6 && r.removed === 6 && r.kept === 0 && (await claimsOf(cl)).length === 0, [al.applied, r]);
  const told = await q("SELECT user_id, text FROM user_notices WHERE client_id = ? AND text LIKE '%taken off your list%'", cl.id);
  ok("A-05: each biller who had them is told in the bell how many left the list (no claim or patient details)", told.length === onLists.length && onLists.every((o) => told.some((t) => t.user_id === o.assigned_to && t.text.startsWith(o.n + " claim") && /the upload they came from was undone \(Made-up Clinic S35 A05\)\.$/.test(t.text))), [onLists, told]);
  ok("A-05: an upload is still undone only once", !(await T(() => A("inventory.undoBatch", { batch_id: up.r.batch_id }))).ok);
  // what somebody opened or worked stays
  const c2 = await mkClient("Made-up Clinic S35 A05 b");
  await A("clients.saveTeam", { client_id: c2.id, team: [billers[0].id] });
  const up2 = await upload(c2, [HF, ...Array.from({ length: 5 }, (_, i) => [String(9805101 + i), "Test Patient " + i, "Aetna", "09/10/2026", "99213", "250.00", "Pending"])], { name: "second file.csv" });
  await app.autoAllocate({ ctx: null, client: { id: c2.id }, loc: { id: c2.loc } });
  const idOf = async (n) => (await q1("SELECT id FROM claims WHERE client_id = ? AND claim_no = ?", c2.id, n)).id;
  const B = await login(billers[0].email);
  await B("queue.open", { id: await idOf("9805101") }); await B("queue.skip", { id: await idOf("9805101"), count: false });   // opened, then back to my day
  await B("queue.open", { id: await idOf("9805102") });                                                                  // open on the desk right now
  const r2 = await A("inventory.undoBatch", { batch_id: up2.r.batch_id });
  const left = (await claimsOf(c2)).map((c) => c.claim_no + " " + c.state);
  ok("A-05: a claim a biller opened (even if put back) and one open on the desk stay; the three nobody opened go", r2.removed === 3 && r2.kept === 2 && left.join() === "9805101 assigned,9805102 in_progress", [r2, left]);
  const evLeft = await q("SELECT c.claim_no, COUNT(*) AS n FROM claim_events e LEFT JOIN claims c ON c.id = e.claim_id WHERE e.claim_id IN (SELECT id FROM claims WHERE client_id = ?) GROUP BY 1", c2.id);
  const orphans = await q1("SELECT COUNT(*) AS n FROM claim_events e WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.id = e.claim_id)");
  ok("A-05: the claims that stay keep their history; the removed ones leave none behind", evLeft.length === 2 && evLeft.every((e) => e.n >= 2) && orphans.n === 0, [evLeft, orphans]);
  // a previously worked claim still waiting for its follow-up (never worked in Brahmastra) goes with its upload too
  const c3 = await mkClient("Made-up Clinic S35 A05 c");
  const up3 = await upload(c3, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "Date Worked"], ["9805201", "Test Patient One", "Aetna", "09/10/2026", "800.00", "Pending", "11/05/2026"]], { kind: "worked" });
  const r3 = await A("inventory.undoBatch", { batch_id: up3.r.batch_id });
  ok("A-05: Undo also removes a worked-file claim that was waiting for its follow-up date", r3.removed === 1 && (await claimsOf(c3)).length === 0, r3);
}

S("A-06: one age bucket for a claim, as of today");
{
  const cl = await mkClient("Made-up Clinic S35 A06");
  // loaded on 1 Nov: DOS 08/08/2026 was 85 days old then (61-90); on 10 Nov it is 94 days old (91-120)
  const t = readCsv([["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"], ["9806001", "Test Patient One", "Aetna", "08/08/2026", "1000.00", "Denied"],
    ["9806002", "Test Patient Two", "Aetna", "12/20/2026", "200.00", "Pending"], ["9806003", "Test Patient Three", "Aetna", "", "300.00", "Pending"]]);
  const built = app.buildClaims({ rows: t.rows, mapping: app.autoMap(t.headers), kind: "fresh", today: "2026-11-01" });
  await app.uploadClaims({ client_id: cl.id, location_id: cl.loc, kind: "fresh", file_name: "nov1.csv", claims: built.claims, summary: built.summary, rows_read: 3 });
  const stored = (await q1("SELECT bucket FROM claims WHERE client_id = ? AND claim_no = '9806001'", cl.id)).bucket;
  const list = async (bucket) => (await A("claims.list", { client_id: cl.id, state: "workable", bucket, today: TODAY })).rows.map((r) => r.claim_no).sort().join();
  ok("A-06: the Claims list's age filter ages the claim to today: 91-120 finds it, 61-90 (the bucket saved at upload) does not", stored === "61\u201390" && (await list("91\u2013120")) === "9806001" && (await list("61\u201390")) === "", [stored, await list("91\u2013120"), await list("61\u201390")]);
  ok("A-06: a DOS in the future is in 0-30; a claim with no DOS is in no age bucket", (await list("0\u201330")) === "9806002" && !(await list("120+")).includes("9806003"), await list("0\u201330"));
  const st = await A("claims.stats", { client_id: cl.id, today: TODAY });
  const bk = Object.fromEntries(st.buckets.map((b) => [b.bucket, b.n]));
  ok("A-06: Claims in detail By age counts it in 91-120, the same as the rows and the over-90 figure", bk["91\u2013120"] === 1 && !bk["61\u201390"] && bk["0\u201330"] === 1, st.buckets);
  const sel = await A("claims.stats", { client_id: cl.id, today: TODAY, bucket: "91\u2013120" });
  const none = await A("claims.stats", { client_id: cl.id, today: TODAY, bucket: "61\u201390" });
  const n = (x) => x.states.reduce((t, r) => t + r.n, 0);
  ok("A-06: clicking the 91-120 bar narrows every figure to that claim (61-90 to none), the people and location tables too", n(sel) === 1 && n(none) === 0 && sel.by_location.length === 1 && sel.by_location[0].n === 1 && none.by_location.length === 0, [n(sel), n(none), sel.by_location.length]);
  const co = await A("client.overview", { client_id: cl.id, today: TODAY });
  ok("A-06: Client 360 agrees: the claim is over 90", co.ar.over90 === 1000, co.ar);
}

S("A-11: the allocation after loading shares the claims evenly");
{
  const three = billers.slice(0, 3);
  const HA = ["Claim ID", "Account #", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"];
  const dosAgo = (n) => { const d = new RealDate(Date.UTC(2026, 10, 10) - n * 86400000); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`; };
  const rowsOf = (n, base, patientOf = (i) => "Test Patient " + i) => Array.from({ length: n }, (_, i) => [String(base + i), "AC" + (base + i), patientOf(i), i % 2 ? "Aetna" : "Cigna", dosAgo(20 + (i % 70)), String(100 + i), "Pending"]);
  const perBiller = async (cl) => { const m = Object.fromEntries((await q("SELECT assigned_to, COUNT(*) AS n FROM claims WHERE client_id = ? AND assigned_to IS NOT NULL GROUP BY assigned_to", cl.id)).map((r) => [r.assigned_to, r.n])); return three.map((b) => m[b.id] || 0); };
  const run = async (name, rows, before) => { const cl = await mkClient(name); await A("clients.saveTeam", { client_id: cl.id, team: three.map((b) => b.id) }); if (before) await before(cl); await upload(cl, [HA, ...rows]);
    const al = await app.autoAllocate({ ctx: null, client: { id: cl.id }, loc: { id: cl.loc } }); return { cl, al, per: await perBiller(cl) }; };
  const a = await run("Made-up Clinic S35 A11", rowsOf(60, 9811000));
  ok("A-11: 60 new claims and three billers (daily target 35): 20 each", a.al.applied === 60 && a.per.join() === "20,20,20", [a.al.applied, a.per]);
  const payersOf = await q("SELECT assigned_to, COUNT(DISTINCT payer) AS n FROM claims WHERE client_id = ? GROUP BY assigned_to", a.cl.id);
  ok("A-11: payers stay batched inside each share (no biller has more than the two payers)", payersOf.every((r) => r.n <= 2) && payersOf.filter((r) => r.n === 1).length >= 2, payersOf);
  // a patient's claims stay with one biller
  const b = await run("Made-up Clinic S35 A11 b", rowsOf(30, 9811100, (i) => (i < 4 ? "Test Patient Many" : "Test Patient " + i)).map((r, i) => (i < 4 ? [r[0], "AC-MANY", ...r.slice(2)] : r)));
  const many = await q("SELECT DISTINCT assigned_to FROM claims WHERE client_id = ? AND account_no = 'AC-MANY'", b.cl.id);
  ok("A-11: 30 claims, 10 each, and the four claims of one patient go to one biller", b.per.join() === "10,10,10" && many.length === 1, [b.per, many.length]);
  // a smaller daily target: that biller gets their target and the others share the rest evenly
  const capWas = (await q1("SELECT capacity FROM users WHERE id = ?", three[0].id)).capacity;
  const c = await run("Made-up Clinic S35 A11 c", rowsOf(60, 9811200), async () => x("UPDATE users SET capacity = 10 WHERE id = ?", three[0].id));
  await x("UPDATE users SET capacity = ? WHERE id = ?", capWas, three[0].id);
  ok("A-11: a biller with a daily target of 10 gets 10; the other two share the other 50 (25 each)", c.per.join() === "10,25,25", c.per);
  // more claims than the targets: each gets their target, the rest stays in the pool (the owner's rule for the target)
  const d = await run("Made-up Clinic S35 A11 d", rowsOf(150, 9811400));
  ok("A-11: 150 claims: 35 each (the daily target), 45 stay in the pool", d.per.join() === "35,35,35" && d.al.applied === 105, [d.per, d.al.applied]);
}

S("A-16: the Claims exports hold every claim, past 10,000");
if (typeof app.rpcAllPages !== "function") ok("A-16: the Claims exports read every page of the list", false, "rpcAllPages is missing");
else {
  const cl = await mkClient("Made-up Clinic S35 A16");
  const N = 10500, now = Date.now();
  await x(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ${N - 1})
    INSERT INTO claims (id, client_id, location_id, match_key, claim_no, patient, payer, dos, balance, priority, state, created_at, updated_at)
    SELECT 's35a16-' || i, ?, ?, 'claim:' || (9816000 + i), CAST(9816000 + i AS TEXT), 'Test Patient ' || i, 'Aetna', '2026-09-15', 100, i % 7, 'open', ?, ? FROM n`, cl.id, cl.loc, now, now);
  const p = { client_id: cl.id, state: "workable" };
  const total = (await A("claims.list", { ...p, page_size: 10 })).total;
  const cols = await app.rpcAllPages("claims.list", p);
  const prod = await app.rpcAllPages("reports.claimsProduction", p);
  const sr = prod.rows.map((r) => r[0]);
  ok("A-16: Brahmastra columns has all 10,500 claims, each once", total === N && cols.rows.length === N && new Set(cols.rows.map((r) => r.id)).size === N, [total, cols.rows.length]);
  ok("A-16: Download CSV (Production layout) has all 10,500 rows, Sr. No 1 to 10,500 in order across the parts", prod.rows.length === N && sr.every((v, i) => v === i + 1) && prod.header.length === AR_HEADER.length, [prod.rows.length, sr[0], sr[sr.length - 1]]);
  const whole = await A("reports.claimsProduction", p);
  ok("A-16: the server op asked without a page still gives every row", whole.rows.length === N && whole.total === N, [whole.rows.length, whole.total]);
  await x("DELETE FROM claims WHERE client_id = ?", cl.id);
}

S("A-09: dates in the AR production file and the Production CSVs");
{
  const name = "Made-up Clinic S35 A09";
  const cl = await mkClient(name);
  await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "Billed Amount", "AR Balance", "Status"], ["9809001", "Test Patient One", "Aetna", "09/15/2026", "2000.00", "1234.50", "Pending"]]);
  const id = (await q1("SELECT id FROM claims WHERE client_id = ? AND claim_no = '9809001'", cl.id)).id;
  const tab = await withOneDrive(async () => {
    await A("alloc.reassign", { ids: [id], user_id: adminId });
    await A("queue.complete", { id, today: TODAY, saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, note: { source: "Web", findings: "Checked the payer portal, the claim is in process" } });
    for (let i = 0; i < 40 && !(odFile(name, "AR", "AR") || { sheets: [{ rows: [] }] }).sheets[0].rows[1]; i++) await sleep(50);
    const book = odFile(name, "AR", "AR"); return book && book.sheets[0];
  });
  const col = (h) => AR_HEADER.indexOf(h), row = tab && tab.rows[1], f = tab && tab.fmts[1];
  ok("A-09: the OneDrive AR row keeps DOS and Date Worked as Excel dates (09/15/2026, 11/10/2026)", row && row[col("DOS")] === 46280 && row[col("Date Worked")] === 46336, row && [row[col("DOS")], row[col("Date Worked")]]);
  ok("A-09: and sends their format: mm/dd/yyyy for DOS and Date Worked, money for Billed and Balance, General elsewhere", f && f[col("DOS")] === "mm/dd/yyyy" && f[col("Date Worked")] === "mm/dd/yyyy" && f[col("Billed Amount($)")] === "#,##0.00" && f[col("Balance Amount($)")] === "#,##0.00"
    && f[col("Patient Name")] === "General" && f[col("Uni")] === "General" && f.length === AR_HEADER.length, f);
  ok("A-09: the template's header row is left as it is", tab && tab.rows[0][0] === "Sr. No" && !tab.fmts[0], tab && tab.fmts[0]);
  const cp = await A("reports.claimsProduction", { client_id: cl.id, state: "workable", today: TODAY });
  const ep = await A("reports.production", { client_id: cl.id, from_ms: 0, to_ms: Date.now() });
  ok("A-09: Claims' production rows carry DOS and Date Worked as dates, like Entries' (and Third Eye's feed is unchanged)", cp.rows[0][col("DOS")] === "2026-09-15" && cp.rows[0][col("Date Worked")] === TODAY && ep.rows[0][col("DOS")] === "2026-09-15" && ep.rows[0][col("Date Worked")] === TODAY,
    [cp.rows[0][col("DOS")], cp.rows[0][col("Date Worked")], ep.rows[0][col("DOS")], ep.rows[0][col("Date Worked")]]);
  const csvRow = (text) => app.readWorkbook(bytesOf(text), "back.csv")[0].rows[1];   // read back as a CSV, quotes and commas in cells too
  const toCsvText = typeof app.productionCSV === "function" ? app.productionCSV : app.arrayCSV;   // the snapshot wrote the rows as they came
  const c1 = csvRow(toCsvText(cp.header, cp.rows)), c2 = csvRow(toCsvText(ep.header, ep.rows));
  ok("A-09: Claims > Download CSV and Entries > Download CSV write them as 09/15/2026 and 11/10/2026", c1[col("DOS")] === "09/15/2026" && c1[col("Date Worked")] === "11/10/2026" && c2[col("DOS")] === "09/15/2026" && c2[col("Date Worked")] === "11/10/2026",
    [c1[col("DOS")], c1[col("Date Worked")], c2[col("DOS")], c2[col("Date Worked")]]);
  ok("A-09: the week and date range columns stay as they were (mm/dd/yyyy text)", /^\d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}$/.test(c1[col("Date Range")]) && /^WE-\d{2}\/\d{2}\/\d{4}$/.test(c1[col("Week")]), [c1[col("Date Range")], c1[col("Week")]]);
}

S("N-06: an amount written with the word Credit is a credit");
{
  const pm = (v) => app.parseMoney(v);
  ok("N-06: 45.00 CREDIT, Credit 45.00, 45.00 Cr. and 45.00 cr are a credit of 45, like 45.00CR", [pm("45.00 CREDIT"), pm("Credit 45.00"), pm("45.00 Cr."), pm("45.00 cr"), pm("45.00CR")].every((n) => n === -45),
    [pm("45.00 CREDIT"), pm("Credit 45.00"), pm("45.00 Cr."), pm("45.00 cr")]);
  ok("N-06: a debit stays positive (45.00 DR, 45.00 DEBIT)", pm("45.00 DR") === 45 && pm("45.00 DEBIT") === 45, [pm("45.00 DR"), pm("45.00 DEBIT")]);
  const cl = await mkClient("Made-up Clinic S35 N06");
  await upload(cl, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status"],
    ["9806601", "Test Patient One", "Aetna", "09/15/2026", "45.00 CREDIT", "Pending"], ["9806602", "Test Patient Two", "Aetna", "09/15/2026", "45.00 Cr.", "Pending"]]);
  const got = await claimsOf(cl);
  ok("N-06: both load as credit balances (-45, set aside), not as workable claims", got.length === 2 && got.every((c) => c.balance === -45 && c.state === "excluded" && c.state_reason === "credit balance"), got.map((c) => [c.claim_no, c.balance, c.state]));
  // the same reading on the server: the client's own balance column copied into the Submission file
  const sc = await mkClient("Made-up Clinic S35 N06 Sub");
  await upload(sc, [["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "VEC Patient Balance"],
    ["9806701", "Test Patient One", "Aetna", "09/15/2026", "300.00", "Rejected", "45.00 CREDIT"], ["9806702", "Test Patient Two", "Aetna", "09/16/2026", "200.00", "Rejected", "Credit 12.50"]]);
  const row = await withOneDrive(async () => {
    await A("clients.saveResponsibility", { client_id: sc.id, dept: "submission", mode: "person", lead: adminId });
    const ids = (await claimsOf(sc)).map((c) => c.id);
    await A("alloc.reassign", { ids, user_id: adminId });
    for (const id of ids) {
      await A("queue.complete", { id, today: TODAY, saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Member ID corrected, to be resubmitted", action: "follow up" } });
      const h = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission'", id);
      const r = await T(() => A("handoffs.close", { id: h && h.id, outcome: "complete", today: TODAY, note: "Resubmitted", proof: { date: TODAY, ref: "B-2", mode: "Portal", inv_status: "Resubmitted", bucket: "Payer", claim_type: "Resubmission", type: "" } }));
      if (!r.ok) return r;
      await sleep(400);
    }
    const book = odFile("Made-up Clinic S35 N06 Sub", "Submission", "Submission"), tab = book && book.sheets.find((t) => t.name === "Submission");
    return tab ? tab.rows : null;
  });
  const iBal = Array.isArray(row) && row[0] ? row[0].indexOf("VEC Patient Balance") : -1;
  ok("N-06: in the Submission file a client balance written 45.00 CREDIT is -45 and Credit 12.50 is -12.5", iBal >= 0 && row[1][iBal] === -45 && row[2][iBal] === -12.5, row && row.e ? row.e : row && row.slice(0, 3).map((x) => x[iBal]));
}

S("N-05: a date with no year (or no day) is no date, and the screen says so");
{
  const pd = (v, o) => app.parseDateAny(v, o);
  ok("N-05: 26-Oct, Oct 26, Dec-25, October 2026 and Week 44 are no date (the browser would make up 2001, the 1st or 2044)", ["26-Oct", "Oct 26", "Dec-25", "October 2026", "Week 44"].every((v) => pd(v) === ""),
    ["26-Oct", "Oct 26", "Dec-25", "October 2026", "Week 44"].map((v) => v + ":" + pd(v)));
  ok("N-05: dates that say their year and day still read: Oct 26, 2026 / 26-Oct-26 / Oct 1, 2026 / 26 October 2026", pd("Oct 26, 2026") === "2026-10-26" && pd("26-Oct-26") === "2026-10-26" && pd("Oct 1, 2026") === "2026-10-01" && pd("26 October 2026") === "2026-10-26",
    [pd("Oct 26, 2026"), pd("26-Oct-26"), pd("Oct 1, 2026"), pd("26 October 2026")]);
  ok("N-05: a date of birth needs its day and year too (March 15, 1952 reads; June 1952 and 1952 do not)", pd("March 15, 1952", { dob: true }) === "1952-03-15" && pd("June 1952", { dob: true }) === "" && pd("1952", { dob: true }) === "",
    [pd("March 15, 1952", { dob: true }), pd("June 1952", { dob: true }), pd("1952", { dob: true })]);
  const HN = ["Claim ID", "Patient Name", "Payer", "Date of Service", "AR Balance", "Status", "Date Worked"];
  const fresh = build([HN, ["9805501", "Test Patient One", "Aetna", "26-Oct", "100", "Pending", "N/A"], ["9805502", "Test Patient Two", "Aetna", "10/26/2026", "100", "Pending", "26-Oct"], ["Total", "", "", "Grand total", "200", "", ""]]);
  const d1 = fresh.claims.find((c) => c.claim_no === "9805501");
  ok("N-05: in an inventory file the DOS 26-Oct is left empty (no DOS), never 2001", d1 && d1.dos === "" && d1.age_days === null, d1 && [d1.dos, d1.age_days]);
  ok("N-05: the upload counts it as a date not read (a fresh file's Date Worked column and the footer row are not counted)", fresh.summary.datesUnread === 1, fresh.summary.datesUnread);
  const worked = build([HN, ["9805503", "Test Patient Three", "Aetna", "10/20/2026", "100", "Pending", "26-Oct"]], "worked");
  ok("N-05: in a previously worked file a Date Worked of 26-Oct is no date, and counted", worked.claims[0].last_worked_on === "" && worked.summary.datesUnread === 1, [worked.claims[0].last_worked_on, worked.summary.datesUnread]);
  const ev = app.crReadEV(new TextEncoder().encode("Date Verified,Insurance,Status\n26-Oct,Aetna,Active coverage\n10/27/2026,Aetna,Active coverage\n"), "EV.csv");
  ok("N-05: the EV upload leaves a check dated 26-Oct out (and says how many) instead of filing it in 2001", ev.n === 1 && ev.skipped === 1 && ev.from === "2026-10-27" && ev.to === "2026-10-27", [ev.n, ev.skipped, ev.from, ev.to]);
}

globalThis.Date = RealDate;
const fails = results.filter((r) => !r.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
