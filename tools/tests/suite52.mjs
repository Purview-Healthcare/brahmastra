/* Suite 52: bug test round 3, tester W's findings (a claim's whole life) and the ones that share their causes (testers X, V and
   the Extra production builder), fixer FW. Key columns of an inventory file guessed only when they really are one, a file split
   across locations that stops between two of them, Undo after Load the file again and after the upload's own allocation, one
   location written two ways, assigning a claim to the biller who has it, someone who no longer works a client (a share taken
   back or made view only, Shastra moving them to another client), typed text refused rather than cut, the Rejections file's
   dates, Excel numbers with leading zeros, proof file names, a date column's order, and notes written before Posting closed a
   claim. Checks named by finding ("W-01: ..."). Made-up people and data only: a stand-in for Purview Shastra's roster feed and
   for Microsoft Graph. */
import vm from "vm";
import { createRequire } from "module";
import { makeRig } from "./rig.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
/* Tina leads Sunrise (Arun, Bela, Cara, Esha), Leo leads Lakeview (Dev); Paula posts, Sam submits and Rex works rejections for Sunrise. */
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Cara Agent", "Tina Lead", SUN), AG("A5", "Esha Agent", "Tina Lead", SUN),
  AG("A4", "Dev Agent", "Leo Lead", LAKE),
  AG("D1", "Paula Post", "Tina Lead", SUN, { department: "Posting" }), AG("S1", "Sam Sub", "Tina Lead", SUN, { department: "Submission" }), AG("S2", "Rex Rej", "Tina Lead", SUN, { department: "Submission" }),
];
// ---- a fake Microsoft Graph (as suite34): folders, files, worksheets per workbook, cell formats kept per row ----
const AR_TEMPLATE = ["Sr. No", "Location", "Project", "Practice", "Uni", "IG Claim ID#/Charge ID#", "Patient Name", "DOS", "Payer", "Age", "Bucket", "Billed Amount($)", "Balance Amount($)", "CPT",
  "Comments/Notes", "Status", "Sub Status", "Action", "Bucket", "Mode of Work", "Start Time", "End Time", "Total Duration", "Date Worked", "Emp. ID", "Associate Name", "Status", "Errors", "Team Lead", "Date Range", "Week"];
const OD = { items: new Map(), seq: 0, books: new Map() };
const odMk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it);
  if (kind === "file") OD.books.set(id, { n: 1, sheets: [{ id: "s1", name: "Sheet1", rows: [AR_TEMPLATE.slice()] }] }); return it; };
const odChild = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const odOut = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const path = decodeURIComponent(new URL(url).pathname.replace(/^\/v1\.0/, "")); let r;
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (odChild("root", b.name)) return J({}, 409); return J(odOut(odMk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = odChild("root", r[1]); return it ? J(odOut(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (odChild(r[1], b.name)) return J({}, 409); return J(odOut(odMk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://share.example/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (odChild(r[1], r[2])) return J({}, 409); return J(odOut(odMk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = odChild(r[1], r[2].replace(/:$/, "")); return it ? J(odOut(it)) : J({}, 404); }
  const bk = (id) => OD.books.get(id), sh = (b, sid) => b && b.sheets.find((x) => x.id === sid);
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: bk(r[1]).sheets.map((x) => ({ id: x.id, name: x.name })) });
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/add$/))) { const b = bk(r[1]); const nm = JSON.parse(init.body).name;
    if (b.sheets.some((x) => x.name.toLowerCase() === nm.toLowerCase())) return J({ error: { message: "exists" } }, 409); const s = { id: "s" + (++b.n), name: nm, rows: [] }; b.sheets.push(s); return J({ id: s.id, name: s.name }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)$/))) { const s = sh(bk(r[1]), r[2]); s.name = JSON.parse(init.body).name; return J({ id: s.id, name: s.name }); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/usedRange/))) { const s = sh(bk(r[1]), r[2]); const n = Math.max(1, s.rows.length);
    return J({ rowCount: n, address: s.name + "!A1:AE" + n, values: s.rows.length ? s.rows : [[""]] }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/range\(address='([A-Z]+)(\d+):[A-Z]+\d+'\)\/format\//))) return J({});
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/range\(address='([A-Z]+)(\d+):[A-Z]+\d+'\)$/))) {
    const s = sh(bk(r[1]), r[2]), at = Number(r[4]) - 1, c0 = colNum(r[3]) - 1, body = JSON.parse(init.body); s.fmts = s.fmts || [];
    body.values.forEach((row, i) => { const cur = s.rows[at + i] || []; row.forEach((v, k) => { cur[c0 + k] = v; }); s.rows[at + i] = cur; if (body.numberFormat) s.fmts[at + i] = body.numberFormat[i]; }); return J({}); }
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn); const app = rig.app;
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const q1 = async (s, ...a) => (await q(s, ...a))[0];
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
const pageConst = (name) => vm.runInContext(name, app);   // a const of the page's code (app.js), as the page has it
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
let users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {}, R = {};
for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); TOK[f.name] = (await login(f.email, "pw-" + f.email)).token; R[f.name] = as(TOK[f.name]); }
const TI = R["Tina Lead"], LEO = R["Leo Lead"], AR = R["Arun Agent"], DEV = R["Dev Agent"], ESHA = R["Esha Agent"];
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN), lake = clients.find((c) => c.name === LAKE);
const downtown = sun.locations.find((l) => l.name === "Downtown");
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const FOLLOW = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal, check again later" } };
const POST = { saag: { status: "Claim Paid", sub_status: "Applied to Ded/Copay/Coins", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Paid per EOB, posting needed" } };
const SUBMIT = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal, resubmitting" } };
const REJECTED = { saag: { status: "Claim Rejected", sub_status: "COB Issue", action: "Need to Resubmit", bucket: "Purview", effective: "Pending-Purview internal review" }, note: { source: "Portal", findings: "Rejected for COB, corrected the primary payer" } };
for (const [dept, who] of [["posting", "Paula Post"], ["submission", "Sam Sub"], ["rejection", "Rex Rej"]]) await A("clients.saveResponsibility", { client_id: sun.id, dept, mode: "person", lead: U(who) });
const poolOf = async (n, clientId = sun.id) => (await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL ORDER BY id LIMIT ?", clientId, n)).map((x) => x.id);
const give = (ids, who, by = TI, clientId = sun.id) => by("alloc.apply", { client_id: clientId, strategy: "smart", assignments: ids.map((id) => ({ id, user_id: U(who), priority: 50, tier: "Medium" })) });
// made-up claims of a file: the same prefix gives the same claims; each prefix its own numbers (Brahmastra reads one long run of
// digits as the claim number, whatever letters are around it)
const madeBase = new Map(), baseOf = (p) => { if (!madeBase.has(p)) madeBase.set(p, 7100000 + madeBase.size * 1000); return madeBase.get(p); };
const made = (prefix, n, extra = {}) => Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(baseOf(prefix) + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (i + 1),
  payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + (i % 300), status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", cpt: "99213", ...extra }; });

S("W-01, W-02: a key column is taken only when it really is one; a file whose key columns are not all recognised stops at the column check");
{
  const map = (h) => app.autoMap(h);
  const m1 = map(["Patient Name", "DOS", "Insurance", "CPT", "Balance", "Claim Submitted Date", "Status"]);
  ok("W-01: Claim Submitted Date is not taken as the claim number", !m1.claim_no, m1);
  const odd = map(["Claim Type", "Claim Balance", "Claim Age", "State of claim", "Claim Notes", "Claim Frequency"]);
  ok("W-01: Claim Type, Claim Age, State of claim, Claim Notes, Claim Frequency are no claim number; Claim Balance is the balance", !odd.claim_no && odd.balance === "Claim Balance", odd);
  const good = map(["Claim #", "Primary Claim Number", "Account No"]);
  ok("W-01: Claim # is the claim number (the first one that is); Account No the account", good.claim_no === "Claim #" && good.account_no === "Account No", good);
  ok("W-01: a camelCase header is read as words (ClaimNo, AcctNo, PatientName, DateOfService, BalanceAmount)",
    JSON.stringify(map(["ClaimNo", "AcctNo", "PatientName", "DateOfService", "BalanceAmount"])) === JSON.stringify({ claim_no: "ClaimNo", account_no: "AcctNo", patient: "PatientName", dos: "DateOfService", balance: "BalanceAmount" }), map(["ClaimNo", "AcctNo", "PatientName", "DateOfService", "BalanceAmount"]));
  const acc = map(["Account Balance", "Account Name", "Account Type", "Chart Notes", "Record Date"]);
  ok("W-01: Account Balance, Account Name, Account Type, Chart Notes and Record Date are no account number (Account Balance is the balance)", !acc.account_no && acc.balance === "Account Balance", acc);
  const pat = map(["Patient DOB", "Patient Balance", "Associate Name", "Rendering Name", "Patient Phone"]);
  ok("W-01: Patient DOB, Patient Balance, Associate Name, Rendering Name and Patient Phone are no patient name", !pat.patient, pat);
  ok("W-01: Patient First Name and Name (Last, First) are the patient", map(["Patient First Name"]).patient === "Patient First Name" && map(["Name (Last, First)"]).patient === "Name (Last, First)");
  const dos = map(["Next Visit Date", "Coverage From Date", "Date of Service To", "Claim Submitted Date"]);
  ok("W-01: Next Visit Date, Coverage From Date, Date of Service To are no date of service", !dos.dos, dos);
  ok("W-01: Visit Date and Svc Date are the date of service", map(["Visit Date"]).dos === "Visit Date" && map(["Svc Date"]).dos === "Svc Date");
  const bal = map(["Paid Amount", "Allowed Amount", "Patient Balance", "Balance Date", "Outstanding Days"]);
  ok("W-02 (same cause): Paid Amount, Allowed Amount, Patient Balance, Balance Date and Outstanding Days are no balance", !bal.balance, bal);
  ok("W-02: Amount alone and Current Balance are the balance", map(["Amount"]).balance === "Amount" && map(["Current Balance"]).balance === "Current Balance");
  const sample = map(["IG Claim ID#/Charge ID#", "Account #", "Patient Name", "Payer", "DOS", "CPT", "Provider", "Billed Amount($)", "Balance Amount($)", "Bucket / Responsibility", "Status", "Sub Status", "Action", "Comments/Notes"]);
  ok("W-01: the sample file's columns are all recognised as before", sample.claim_no === "IG Claim ID#/Charge ID#" && sample.account_no === "Account #" && sample.patient === "Patient Name" && sample.dos === "DOS" && sample.balance === "Balance Amount($)" && sample.billed === "Billed Amount($)" && sample.comments === "Comments/Notes", sample);
  const keys = pageConst("UPLOAD_KEYS");
  ok("W-01, W-02: a file loads at once only with its claim number, patient, date of service and balance recognised", JSON.stringify([...keys]) === JSON.stringify(["claim_no", "patient", "dos", "balance"]), keys);
  // the W-01 file: with no claim number column, its 12 patients are 12 claims (patient + date of service), never 3 merged by a date
  const rows = []; for (let i = 1; i <= 12; i++) rows.push({ "Patient Name": "Testpatient, A" + i, DOS: "09/" + String(i).padStart(2, "0") + "/2026", Insurance: i % 2 ? "Aetna" : "Cigna", CPT: "99213", Balance: 100 + i, "Claim Submitted Date": "10/0" + (1 + (i % 3)) + "/2026", Status: "Denied" });
  const built = app.buildClaims({ rows, mapping: m1, kind: "fresh", today: todayIST() });
  ok("W-01: loaded from the column check, the file is 12 claims, one per patient", built.claims.length === 12 && new Set(built.claims.map((c) => c.patient)).size === 12, built.claims.length);
  // the patient details report uses the same guess: a Patient DOB column is its date of birth, not the patient's name
  const dm = app.detailAutoMap(["Claim Number", "Patient DOB", "Member ID"]);
  ok("W-01 (sibling, patient details report): Patient DOB is the date of birth there, not the patient name", !dm.patient && dm.patient_dob === "Patient DOB", dm);
}

S("W-03, W-04: a file split across locations: a stop between two locations says so; one location written two ways is one upload");
{
  ok("W-04: Downtown, DOWNTOWN and ' downtown ' are one location (the key the upload groups by and matches with)", app.locKey("Downtown") === app.locKey("DOWNTOWN") && app.locKey(" down   town ") === app.locKey("Down Town") && app.locKey("Downtown") !== app.locKey("Westside"));
  const westside = sun.locations.find((l) => l.name === "Westside");
  const up = (loc, claims, extra) => { app.setToken(TOK["Tina Lead"]); return app.uploadClaims({ client_id: sun.id, location_id: loc.id, kind: "fresh", file_name: "W-03 two locations.xlsx", claims, summary: {}, rows_read: claims.length, ...extra }); };
  const st = async (id) => (await TI("inventory.batches", { client_id: sun.id })).batches.find((x) => x.id === id);
  // the page loads Downtown (held), then the page stops before Westside starts
  const r1 = await up(downtown, made("WT3A", 5), { hold: true });
  const b1 = await st(r1.batch_id);
  ok("W-03: a location's upload that is not the file's last stays unfinished after its last part (still loading, not finished)", b1 && b1.unfinished && !b1.stopped && r1.inserted === 5, b1);
  const realNow = Date.now; Date.now = () => realNow() + 4 * 60000;
  try { const b1b = await st(r1.batch_id); ok("W-03: with no next location coming, it shows as stopped part way after three minutes", b1b.unfinished && b1b.stopped, b1b); }
  finally { Date.now = realNow; }
  // the whole file again: Downtown held, Westside last: Westside's last part finishes both
  const r2 = await up(downtown, made("WT3A", 5), { hold: true });
  const mid = await st(r2.batch_id);
  const r3 = await up(westside, made("WT3B", 4), { held: [r2.batch_id] });
  const [a, b] = [await st(r2.batch_id), await st(r3.batch_id)];
  ok("W-03: while the next location loads the earlier one is still loading; the last location's last part finishes both", mid.unfinished && !a.unfinished && !b.unfinished && r3.inserted === 4, [mid.unfinished, a.unfinished, b.unfinished, r3.inserted]);
  // another person's upload is never finished by someone else's held list
  const other = await R["Leo Lead"]("inventory.upload", { client_id: lake.id, location_id: null, kind: "fresh", file_name: "W-03 Leo.xlsx", rows_read: 1, claims: made("WT3L", 1), final: true, hold: true, summary: {} });
  await up(downtown, made("WT3C", 1), { held: [other.batch_id] });
  ok("W-03: a held list finishes only the uploader's own uploads of that client", (await LEO("inventory.batches", { client_id: lake.id })).batches.find((x) => x.id === other.batch_id).unfinished);
}

S("W-05, W-08: Undo after Load the file again, and after the upload's own automatic allocation");
{
  const file = made("WU5", 600);
  app.setToken(TOK["Tina Lead"]);
  let parts = 0;
  const r1 = await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-05 wrong file.xlsx", claims: file, summary: {}, rows_read: 600, onProgress: () => { if (++parts === 1) throw new Error("page closed"); } }).then(() => "finished", (e) => e.message);
  const b1 = await q1("SELECT id, inserted, finished FROM batches WHERE file_name = 'W-05 wrong file.xlsx' ORDER BY uploaded_at LIMIT 1");
  app.setToken(TOK["Tina Lead"]);
  const r2 = await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-05 wrong file.xlsx", claims: file, summary: {}, rows_read: 600 });
  ok("W-05: set-up: the first load stopped after 250, Load the file again added 350 and refreshed 250", r1 === "page closed" && b1.inserted === 250 && !b1.finished && r2.inserted === 350 && r2.updated === 250, [r1, b1, r2.inserted, r2.updated]);
  // a claim of the stopped part that a biller opened stays
  const kept = (await q1("SELECT id FROM claims WHERE first_batch_id = ? ORDER BY claim_no LIMIT 1", b1.id)).id;
  await give([kept], "Arun Agent"); await AR("queue.open", { id: kept });
  const u1 = await TI("inventory.undoBatch", { batch_id: b1.id });
  const u2 = await TI("inventory.undoBatch", { batch_id: r2.batch_id });
  const left = (await q1("SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE 'WU5%'")).n;
  ok("W-05: Undo of the stopped upload, then of the load that finished it, removes all 599 untouched claims; the one Arun opened stays", left === 1 && u1.removed + u2.removed === 599 && !!(await q1("SELECT id FROM claims WHERE id = ?", kept)), [u1, u2, left]);
  // the other order: Undo of the finishing load alone takes the stopped part's untouched claims with it
  const f2 = made("WU6", 300);
  app.setToken(TOK["Tina Lead"]); parts = 0;
  await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-05 second.xlsx", claims: f2, summary: {}, rows_read: 300, onProgress: () => { if (++parts === 1) throw new Error("cut off"); } }).catch(() => {});
  app.setToken(TOK["Tina Lead"]);
  const r4 = await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-05 second.xlsx", claims: f2, summary: {}, rows_read: 300 });
  const u4 = await TI("inventory.undoBatch", { batch_id: r4.batch_id });
  ok("W-05: Undo of the load that finished a stopped one removes the whole file's untouched claims (300)", u4.removed === 300 && (await q1("SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE 'WU6%'")).n === 0, u4);
  // a later, different load of a same-named file never takes a stopped upload's claims it did not refresh
  const f3 = made("WU7", 260);
  app.setToken(TOK["Tina Lead"]); parts = 0;
  await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-05 monthly.xlsx", claims: f3, summary: {}, rows_read: 260, onProgress: () => { if (++parts === 1) throw new Error("cut off"); } }).catch(() => {});
  app.setToken(TOK["Tina Lead"]);
  const r6 = await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-05 monthly.xlsx", claims: made("WU8", 3), summary: {}, rows_read: 3 });
  const u6 = await TI("inventory.undoBatch", { batch_id: r6.batch_id });
  ok("W-05: Undo of a later file of the same name removes only what it added or refreshed (the other file's claims stay)", u6.removed === 3 && (await q1("SELECT COUNT(*) AS n FROM claims WHERE claim_no LIKE 'WU7%'")).n === 250, u6);

  // W-08: the next file reopens two claims the team lead closed; the upload's own allocation hands them out; Undo puts them back
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND location_id = ? AND state = 'open'", sun.id, downtown.id);
  const rows = made("WH8", 6);
  app.setToken(TOK["Tina Lead"]);
  await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-08 Nov.xlsx", claims: rows, summary: {}, rows_read: 6 });
  const ids = (await q("SELECT id FROM claims WHERE claim_no IN (?, ?, ?) ORDER BY claim_no", ...rows.slice(0, 3).map((r) => r.claim_no))).map((x) => x.id);
  await TI("claims.setState", { ids, state: "closed" });
  app.setToken(TOK["Tina Lead"]);
  const up = await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "W-08 Dec.xlsx", claims: rows, summary: {}, rows_read: 6 });
  app.setToken(TOK["Tina Lead"]);
  const al = await app.autoAllocate({ client: (await TI("clients.list")).clients.find((c) => c.id === sun.id), loc: downtown });
  const mid = await q("SELECT id, state, assigned_to FROM claims WHERE id IN (?, ?, ?) ORDER BY claim_no", ...ids);
  // one of the three is opened by its biller before the Undo: it stays with them
  const biller = mid[2].assigned_to; const opened = mid[2].id;
  await as(TOK[users.find((u) => u.id === biller).name])("queue.open", { id: opened });
  const bell0 = (await q("SELECT id FROM user_notices WHERE user_id = ?", mid[0].assigned_to)).length;
  const u = await TI("inventory.undoBatch", { batch_id: up.batch_id });
  const end = await q("SELECT id, state, assigned_to, state_reason FROM claims WHERE id IN (?, ?, ?) ORDER BY claim_no", ...ids);
  const bell = await q1("SELECT text FROM user_notices WHERE user_id = ? ORDER BY at DESC LIMIT 1", mid[0].assigned_to);
  ok("W-08: set-up: the upload reopened 3 closed claims and its automatic allocation handed them out", up.reopened === 3 && al.applied >= 3 && mid.every((x) => x.state === "assigned" && x.assigned_to), [up.reopened, al.applied, mid]);
  ok("W-08: Undo closes again the two nobody opened (off the biller's list) and counts them", end[0].state === "closed" && !end[0].assigned_to && end[1].state === "closed" && !end[1].assigned_to && u.reverted === 2, [end, u]);
  ok("W-08: the claim its biller opened stays open with them", end[2].state === "in_progress" && end[2].assigned_to === biller, end[2]);
  ok("W-08: the biller is told the claims were taken off their list", (await q("SELECT id FROM user_notices WHERE user_id = ?", mid[0].assigned_to)).length > bell0 && /taken off your list: the upload they came from was undone/.test((bell || {}).text || ""), bell);
}

S("W-13: an Excel number shown with leading zeros keeps them");
{
  const ws = XLSX.utils.aoa_to_sheet([["Claim Number", "Account Number", "Patient Name", "DOS", "Payer", "Balance"], [12, 345, "Testpatient, Z1", 46265, "Aetna", 1234.5], [7711041, 99, "Testpatient, Z2", 46266, "Cigna", 80]]);
  ws.A2.z = "00000"; ws.B2.z = "000000"; ws.D2.z = "mm/dd/yyyy"; ws.F2.z = "#,##0.00"; ws.D3.z = "mm/dd/yyyy";
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inv"); const b = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const sheets = app.readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "W-13 zeros.xlsx");
  const t = app.tableFromSheet(sheets[0].rows); const built = app.buildClaims({ rows: t.rows, mapping: app.autoMap(t.headers), kind: "fresh", today: todayIST() });
  const [c1, c2] = built.claims;
  ok("W-13: Excel shows claim 00012 and account 000345: Brahmastra reads 00012 and 000345", c1.claim_no === "00012" && c1.account_no === "000345", [c1.claim_no, c1.account_no]);
  ok("W-13: numbers with no such format, money and dates are read as before", c2.claim_no === "7711041" && c2.account_no === "99" && c1.balance === 1234.5 && c1.dos === "2026-08-31" && c2.dos === "2026-09-01", [c2.claim_no, c2.account_no, c1.balance, c1.dos, c2.dos]);
}

S("W-07: assigning a claim to the biller who already has it changes nothing");
{
  const pool = await poolOf(4);
  await give(pool.slice(0, 3), "Bela Agent");
  const open = await R["Bela Agent"]("queue.next", {});
  const id = open.claim.id;
  const lines = async (cid) => (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'assigned'", cid)).n;
  const bells = async () => (await q1("SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ? AND text LIKE '%allocated to you%'", U("Bela Agent"))).n;
  const [l0, b0] = [await lines(id), await bells()];
  // a page of claims: Bela's three (one open on her desk) and one from the pool
  const rs = await TI("alloc.reassign", { ids: pool, user_id: U("Bela Agent") });
  const st = await q1("SELECT state, assigned_to FROM claims WHERE id = ?", id);
  ok("W-07: only the claim that moved counts (1 of 4); the three already hers are not counted", rs.changed === 1, rs);
  ok("W-07: no new history line on a claim already on her list", (await lines(id)) === l0 && (await lines(pool.find((x) => x !== id && pool.indexOf(x) < 3))) === 1);
  ok("W-07: her bell gets one notice, for the one new claim", (await bells()) === b0 + 1 && /^1 new claim was allocated to you/.test((await q1("SELECT text FROM user_notices WHERE user_id = ? ORDER BY at DESC LIMIT 1", U("Bela Agent"))).text));
  ok("W-07: the claim open on her desk stays open", st.state === "in_progress" && st.assigned_to === U("Bela Agent"), st);
  const save = await T(() => R["Bela Agent"]("queue.complete", { id, ...FOLLOW, desk: true }));
  ok("W-07: her Save on My day goes through", save.ok, save.e);
  // the claim profile's Assign of one claim already hers: nothing changed, and the profile says so
  const other = pool.find((x) => x !== id && pool.indexOf(x) < 3);
  const one1 = await TI("alloc.reassign", { ids: [other], user_id: U("Bela Agent") });
  ok("W-07: Assign of one claim already on her list changes nothing", one1.changed === 0 && (await lines(other)) === 1, one1);
  // a real move still moves: the claim to Cara, with history and her bell
  const mv = await TI("alloc.reassign", { ids: [other], user_id: U("Cara Agent") });
  ok("W-07: assigning it to someone else still moves it (history line, counted)", mv.changed === 1 && (await lines(other)) === 2 && (await q1("SELECT assigned_to FROM claims WHERE id = ?", other)).assigned_to === U("Cara Agent"), mv);
  // a worked claim of hers waiting for its follow-up comes back on her list when assigned to her (it is not on her list now)
  const done = (await q1("SELECT state, assigned_to FROM claims WHERE id = ?", id));
  const back = await TI("alloc.reassign", { ids: [id], user_id: U("Bela Agent") });
  ok("W-07: a claim she worked (waiting for its follow-up) is put back on her list when assigned to her", done.state === "completed" && back.changed === 1 && (await q1("SELECT state FROM claims WHERE id = ?", id)).state === "assigned", [done, back]);
}

S("W-12, X-07, V-04: someone who no longer works a client gives its claims back to the pool, and cannot open or work them");
{
  const onList = async (who, cid = sun.id) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND client_id = ? AND state IN ('assigned','in_progress')", U(who), cid)).n;
  const bellOf = async (who) => ((await q1("SELECT text FROM user_notices WHERE user_id = ? ORDER BY at DESC LIMIT 1", U(who))) || {}).text || "";
  // W-12: Dev (Lakeview) gets Sunrise to edit, is given 3 Sunrise claims; the share becomes view only
  await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "edit" });
  const p1 = await poolOf(3); await give(p1, "Dev Agent");
  const vo = await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "view" });
  const st = await q("SELECT state, assigned_to FROM claims WHERE id IN (?, ?, ?)", ...p1);
  ok("W-12: made view only, his 3 Sunrise claims go back to the pool (open, nobody's) and the answer says 3", vo.returned === 3 && st.every((x) => x.state === "open" && !x.assigned_to) && (await onList("Dev Agent")) === 0, [vo, st]);
  ok("W-12: each claim's history says it was taken off his list", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id IN (?, ?, ?) AND kind = 'unassigned'", ...p1)).n === 3);
  ok("W-12: his bell tells him", /3 claims were taken off your list: you no longer work Sunrise Eye Care/.test(await bellOf("Dev Agent")), await bellOf("Dev Agent"));
  const el = (await TI("claims.eligible", { client_id: sun.id })).claims.filter((c) => p1.includes(c.id)).length;
  ok("W-12: they are in Sunrise's pool for the team", el === 3, el);
  // any left on a view-only list (put there before this fix) are not counted or listed as ready, as Next claim does not open them
  await sql("UPDATE claims SET assigned_to = ?, state = 'assigned' WHERE id = ?", U("Dev Agent"), p1[0]);
  const sm = await DEV("queue.summary", {}), ls = (await DEV("queue.list", { day_from_ms: Date.now() - 3600000 })).rows.filter((r) => r.client_id === sun.id);
  ok("W-12: My day neither counts nor lists a claim of a view-only client as ready", sm.ready.n === 0 && ls.length === 0 && !(await DEV("queue.next", {})).claim, [sm.ready, ls.length]);
  await sql("UPDATE claims SET assigned_to = NULL, state = 'open' WHERE id = ?", p1[0]);

  // X-07: the share is made "can edit" again, Dev is given 2 claims, works one and opens the other; then the share is taken back
  await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "edit" });
  const p2 = await poolOf(3); await give(p2, "Dev Agent");
  const w1 = (await DEV("queue.next", {})).claim.id; await DEV("queue.complete", { id: w1, ...FOLLOW, desk: true });
  const note = (await q1("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work'", w1)).id;
  const w2 = (await DEV("queue.next", {})).claim.id;
  const rm = await TI("clients.accessRemove", { client_id: sun.id, user_id: U("Dev Agent") });
  ok("X-07: taken back, the 2 Sunrise claims still on his list (one open on his desk) go back to the pool", rm.returned === 2 && (await onList("Dev Agent")) === 0 && (await q1("SELECT state FROM claims WHERE id = ?", w2)).state === "open", rm);
  const nx = await DEV("queue.next", {});
  ok("X-07: Next claim gives him no Sunrise claim", !nx.claim || nx.claim.client_id !== sun.id, nx.claim && nx.claim.client_id);
  const tries = { get: await T(() => DEV("claims.get", { id: w1 })), complete: await T(() => DEV("queue.complete", { id: w2, ...FOLLOW })), open: await T(() => DEV("queue.open", { id: w2 })),
    note: await T(() => DEV("notes.add", { claim_id: w1, comment: "Called the payer again about this made-up claim." })), edit: await T(() => DEV("notes.update", { id: note, ...FOLLOW })),
    file: await T(() => DEV("attachments.add", { claim_id: w1, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 made-up").toString("base64") })) };
  ok("X-07: he cannot open the claim he worked, nor open, save, note, edit or attach on Sunrise claims", Object.values(tries).every((x) => !x.ok), Object.fromEntries(Object.entries(tries).map(([k, x]) => [k, x.ok ? "allowed" : x.e])));
  const cno = (await q1("SELECT claim_no FROM claims WHERE id = ?", w1)).claim_no;
  ok("X-07: Search finds no Sunrise claim for him (no patient shown)", !(await DEV("search.global", { q: cno })).claims.some((c) => c.client_id === sun.id));
  ok("X-07: the team lead still opens it and its history keeps his entry", !!(await TI("claims.get", { id: w1 })).claim && (await q1("SELECT user_id FROM notes WHERE id = ?", note)).user_id === U("Dev Agent"));
  // a share of a client that is the person's own anyway: taking it back leaves their claims
  await TI("clients.accessSave", { client_id: sun.id, user_id: U("Arun Agent"), level: "edit" });
  const p3 = await poolOf(2); await give(p3, "Arun Agent");
  const rm2 = await TI("clients.accessRemove", { client_id: sun.id, user_id: U("Arun Agent") });
  ok("X-07: a share taken back from someone whose own project is the client leaves their claims", rm2.returned === 0 && (await q("SELECT assigned_to FROM claims WHERE id IN (?, ?)", ...p3)).every((x) => x.assigned_to === U("Arun Agent")), rm2);
  const vo2 = await TI("clients.accessSave", { client_id: sun.id, user_id: U("Arun Agent"), level: "view" });
  ok("X-07: a view-only share of his own client changes nothing for him either", vo2.returned === 0 && (await q("SELECT assigned_to FROM claims WHERE id IN (?, ?)", ...p3)).every((x) => x.assigned_to === U("Arun Agent")), vo2);
  await TI("clients.accessRemove", { client_id: sun.id, user_id: U("Arun Agent") });

  // V-04: Shastra moves Esha from Tina's team (Sunrise) to Leo's (Lakeview); Bela moves to another team lead on Sunrise
  const p4 = await poolOf(6); await TI("alloc.reassign", { ids: p4, user_id: U("Esha Agent") });
  const p5 = await poolOf(2); await give(p5, "Bela Agent");
  const e = FEED.find((x) => x.emp_id === "A5"); e.reports_to = "Leo Lead"; e.project = LAKE;
  const b = FEED.find((x) => x.emp_id === "A2"); b.reports_to = "Mona Manager";
  await A("roster.syncShastra");
  // since 2.116.0 (the owner's rule) nothing automatic takes anyone off a client: Esha keeps Sunrise and its claims until Tina takes her off
  ok("V-04 (2.116.0): after the sync Esha is still on Sunrise's billers, with her 6 claims", (await onList("Esha Agent")) === 6, await onList("Esha Agent"));
  const sunT = JSON.parse((await q1("SELECT team_json FROM clients WHERE id = ?", sun.id)).team_json);
  await TI("clients.saveTeam", { client_id: sun.id, base: sunT, team: sunT.filter((x) => x !== U("Esha Agent")) });
  ok("V-04: Tina takes her off Sunrise: her 6 Sunrise claims are back in the pool", (await onList("Esha Agent")) === 0 && (await q("SELECT state, assigned_to FROM claims WHERE id IN (" + p4.map(() => "?").join(",") + ")", ...p4)).every((x) => x.state === "open" && !x.assigned_to));
  const enx = await ESHA("queue.next", {});
  ok("V-04: Next claim gives her no Sunrise claim; her bell says why", (!enx.claim || enx.claim.client_id !== sun.id) && Number(((await bellOf("Esha Agent")).match(/^(\d+) claims were taken off your list: you no longer work Sunrise Eye Care/) || [])[1]) >= 6, await bellOf("Esha Agent"));
  ok("V-04: the history names who took her off", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'unassigned' AND user_name <> ''", p4[0])).n === 1);
  ok("V-04: someone who moves to another team lead on the same client keeps the claims", (await onList("Bela Agent")) >= 2);
  users = (await A("users.list")).users;
}

S("W-10, X-05, X-08: typed text over a box's limit is refused with a message naming the box, never cut");
{
  const long = (label, n) => (label + " " + "x".repeat(n)).slice(0, n);
  const pool = await poolOf(3); await give(pool, "Arun Agent");
  await AR("queue.open", { id: pool[0] });
  const tooLong = { ref: [long("Call reference 4471-55", 120), "REF"], denial: [long("CO-197 Precertification absent; RARC N54", 260), "Denial"], clm: [long("CLM", 100), "CLM#"], source: [long("Payer's provider services line", 70), "Source"], precheck_text: [long("Also verified the referral dates", 380), "Pre call check"] };
  for (const [k, [v, label]] of Object.entries(tooLong)) {
    const r = await T(() => AR("queue.complete", { id: pool[0], ...FOLLOW, note: { ...FOLLOW.note, [k]: v }, desk: true }));
    ok(`W-10: the work entry's ${label} box over its limit is refused, naming it (nothing saved)`, !r.ok && r.e.startsWith(label) && /too long/.test(r.e) && (await q1("SELECT state FROM claims WHERE id = ?", pool[0])).state === "in_progress", r.e);
  }
  const fits = { ref: long("Call reference 4471-55", 80), denial: long("CO-197 Precertification absent", 200), source: long("Payer's provider services", 40), precheck_text: long("Also verified", 300) };
  const saved = await AR("queue.complete", { id: pool[0], ...FOLLOW, note: { ...FOLLOW.note, ...fits }, desk: true });
  const f = JSON.parse((await q1("SELECT fields_json FROM notes WHERE claim_id = ? AND kind = 'work'", pool[0])).fields_json);
  ok("W-10: text up to each limit is kept whole", saved && f.ref === fits.ref && f.denial === fits.denial && f.source === fits.source && f.precheck_text === fits.precheck_text, f);
  const nid = (await q1("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work'", pool[0])).id;
  const ed = await T(() => AR("notes.update", { id: nid, ...FOLLOW, note: { ...FOLLOW.note, denial: long("Denied", 201) } }));
  ok("W-10: editing the entry with a Denial over 200 is refused too", !ed.ok && /^Denial is too long: 201 characters, and it takes up to 200/.test(ed.e), ed.e);
  const na = await T(() => AR("notes.add", { claim_id: pool[0], note: { ...FOLLOW.note, ref: long("Ref", 81) } }));
  ok("W-10: a note in the standard format with a REF over 80 is refused", !na.ok && /^REF is too long/.test(na.e), na.e);
  // the desks' Completed form
  await AR("queue.open", { id: pool[1] }); await AR("queue.complete", { id: pool[1], ...SUBMIT, desk: true });
  const hs = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission'", pool[1]);
  const subTry = async (proof) => T(() => R["Sam Sub"]("handoffs.close", { id: hs.id, outcome: "complete", seen: "pending", proof: { date: todayIST(), ref: "BATCH-1", mode: "Electronic", ...proof } }));
  for (const [k, n, label] of [["inv_status", 81, "Inventory Status"], ["bucket", 61, "Bucket"], ["claim_type", 61, "Claim Type"], ["type", 61, "Type"], ["ref", 81, "The check / EFT number or batch ID"]]) {
    const r = await subTry({ [k]: long("Text", n) });
    ok(`W-10: Submission's Completed form: ${label} over its limit is refused (the hand-off stays open)`, !r.ok && r.e.startsWith(label) && (await q1("SELECT status FROM handoffs WHERE id = ?", hs.id)).status !== "complete", r.e);
  }
  const subOk = await subTry({ inv_status: long("Corrected claim resubmitted", 80), bucket: long("Payer", 60) });
  const p2 = JSON.parse((await q1("SELECT proof_json FROM handoffs WHERE id = ?", hs.id)).proof_json);
  ok("W-10: Submission's text up to the limits is kept whole", subOk.ok && p2.inv_status.length === 80 && p2.bucket.length === 60, subOk.e || p2);
  await AR("queue.open", { id: pool[2] });
  await AR("attachments.add", { claim_id: pool[2], name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 made-up").toString("base64") });
  await AR("queue.complete", { id: pool[2], ...POST, desk: true });
  const hp = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'posting'", pool[2]);
  for (const [k, n, label] of [["pay_type", 41, "Payment type"], ["adj_reason", 61, "Adjustment reason"], ["ref", 81, "The check / EFT number or batch ID"]]) {
    const r = await T(() => R["Paula Post"]("handoffs.close", { id: hp.id, outcome: "complete", seen: "pending", proof: { date: todayIST(), ref: "EFT-1", allowed: "100", paid: "100", [k]: long("Text", n) } }));
    ok(`W-10: Payment posting's Completed form: ${label} over its limit is refused`, !r.ok && r.e.startsWith(label), r.e);
  }
  // X-08: a first or last name on Team › Edit
  const nia = users.find((u) => u.name === "Cara Agent");
  const fn = await T(() => A("users.save", { id: nia.id, first_name: "Cara" + "-Made-Up-Double-Barrelled-Name".repeat(2), last_name: "Agent", designation: nia.designation, role: nia.role, capacity: nia.capacity, active: true, projects: nia.projects, reports_to: nia.reports_to || "", emp_id: nia.emp_id }));
  ok("X-08: a first name over 60 characters is refused, naming the box (not cut)", !fn.ok && /^The first name is too long: 64 characters, and it takes up to 60/.test(fn.e) && (await q1("SELECT first_name FROM users WHERE id = ?", nia.id)).first_name === "Cara", fn.e);
  const ln = await T(() => A("users.save", { id: nia.id, first_name: "Cara", last_name: "L".repeat(61), designation: nia.designation, role: nia.role, capacity: nia.capacity, active: true, projects: nia.projects, reports_to: nia.reports_to || "", emp_id: nia.emp_id }));
  ok("X-08: a last name over 60 characters is refused too", !ln.ok && /^The last name is too long/.test(ln.e), ln.e);
  // X-05: the team task's name; the client's short code
  const tk = await T(() => TI("tasks.create", { client_id: sun.id, title: "Recheck the made-up denials " + "and note each portal reference ".repeat(6), description: "Made-up task", scope: "AR", count: 1, tat: "24", shares: [{ user_id: U("Arun Agent"), count: 1 }] }));
  ok("X-05: a task name over 160 characters is refused with a message naming it", !tk.ok && /^The task name is too long/.test(tk.e), tk.e);
  const sc = await T(() => TI("clients.save", { id: sun.id, code: "SUNRISEEYECARE" }));
  ok("X-05 (sibling): a client's short code over 12 characters is refused with a message, not cut", !sc.ok && /^The short code is too long: 14 characters/.test(sc.e), sc.e);
  const fs = await import("fs");
  const code = fs.readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("X-05: the Task box and the Short code boxes no longer cut what is typed (no maxLength); they count near the limit", !/placeholder="What is to be done, in a few words" maxLength=/.test(code) && !/code: e\.target\.value\.toUpperCase\(\) \}\)\} maxLength=\{12\}/.test(code) && !/maxLength=\{12\} onChange=\{\(e\) => set\(\{ code:/.test(code)
    && /<TextLimit v=\{f\.title\} max=\{160\} \/>/.test(code) && /<TextLimit v=\{f\.code\} max=\{12\} \/>/.test(code) && /<TextLimit v=\{edit\.code\} max=\{12\} \/>/.test(code));
}

S("W-11: My day's work form asks before Back, Forward or a reload drops a typed entry (the browser walk is the proof; here the wiring)");
{
  const fs = await import("fs");
  const code = fs.readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  const panel = code.slice(code.indexOf("function WorkPanel("), code.indexOf("function HandoffCell("));
  ok("W-11: the page has the guard for forms on the page (useTypedGuard: the same Discard question and Leave site?)", typeof app.useTypedGuard === "function" && /LAYER_GUARDS\.add\(g\); window\.addEventListener\("beforeunload", unload\)/.test(code.slice(code.indexOf("function useTypedGuard("), code.indexOf("function DiscardAsk("))));
  ok("W-11: My day's work panel holds its typed entry with it (its root and the question)", /const TG = useTypedGuard\(\)/.test(panel) && /ref=\{TG\.ref\}/.test(panel) && /\{TG\.ask\}/.test(panel));
}

S("EP-1: one impossible date does not decide a date column's order");
{
  const order = (vals) => app.dateOrderOf(vals);
  ok("EP-1: 31/31/2026 alone says nothing: the column is read month first", order(["05/06/2026", "31/31/2026"]) === "mdy", order(["05/06/2026", "31/31/2026"]));
  ok("EP-1: 30/02/2026 (no such day) says nothing either", order(["05/06/2026", "30/02/2026"]) === "mdy", order(["05/06/2026", "30/02/2026"]));
  ok("EP-1: a real day-first date (13/06/2026) still makes the column day first", order(["05/06/2026", "13/06/2026", "31/31/2026"]) === "dmy");
  ok("EP-1: a real month-first date (06/13/2026) month first; both kinds: each date on its own", order(["06/13/2026"]) === "mdy" && order(["13/06/2026", "06/13/2026"]) === "");
  const read = pageConst("dateReader")(["05/06/2026", "31/31/2026"]);
  ok("EP-1: so 05/06/2026 in that column is 6 May, and 31/31/2026 is no date", read("05/06/2026") === "2026-05-06" && read("31/31/2026") === "", [read("05/06/2026"), read("31/31/2026")]);
}

S("W-09: the Rejections tab writes its dates as Excel dates in mm/dd/yyyy, as the other desks do");
{
  rig.liveEnv.DEMO = false;
  try {
    const [c] = await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL AND dos <> '' ORDER BY id LIMIT 1", sun.id);
    await give([c.id], "Arun Agent"); await AR("queue.open", { id: c.id }); await AR("queue.complete", { id: c.id, ...REJECTED, desk: true });
    const h = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'rejection'", c.id);
    await R["Rex Rej"]("handoffs.close", { id: h.id, outcome: "complete", seen: "pending", proof: { date: todayIST(), ref: "BATCH-2", code: "Coordination of benefits" } });
    await new Promise((r) => setTimeout(r, 400));
    const pathOf = (id) => { const p = []; let it = OD.items.get(id); while (it) { p.unshift(it.name); it = OD.items.get(it.parent); } return p.join("/"); };
    const it = [...OD.items.values()].find((i) => i.kind === "file" && pathOf(i.id).includes("/Production/Rejections/"));
    const sh = it && OD.books.get(it.id).sheets.find((x) => x.name === "Rejections");
    const hdr = sh ? sh.rows[0] : [], row = sh ? sh.rows[sh.rows.length - 1] : [], fm = (sh && sh.fmts && sh.fmts[sh.rows.length - 1]) || [];
    const dateOk = (n) => { const i = hdr.indexOf(n); return typeof row[i] === "number" && fm[i] === "mm/dd/yyyy"; };
    ok("W-09: Date, DOS, Proof date and Sent at are Excel dates shown as mm/dd/yyyy", sh && ["Date", "DOS", "Proof date", "Sent at"].every(dateOk), sh ? ["Date", "DOS", "Proof date", "Sent at"].map((n) => [n, row[hdr.indexOf(n)], fm[hdr.indexOf(n)]]) : "no Rejections tab");
    ok("W-09: Balance is money (#,##0.00)", sh && fm[hdr.indexOf("Balance")] === "#,##0.00" && typeof row[hdr.indexOf("Balance")] === "number");
  } finally { rig.liveEnv.DEMO = true; }
}

S("W-15: a long proof file name keeps its .pdf in the hand-off's list, as on the claim");
{
  const [c] = await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL ORDER BY id LIMIT 1", sun.id);
  await give([c.id], "Arun Agent"); await AR("queue.open", { id: c.id }); await AR("queue.complete", { id: c.id, ...SUBMIT, desk: true });
  const h = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission'", c.id);
  const name = "Clearinghouse acceptance report for the corrected claim batch of November " + "with every line item listed ".repeat(6) + "final.pdf";
  const a = await R["Sam Sub"]("attachments.add", { claim_id: c.id, name, type: "application/pdf", data: Buffer.from("%PDF-1.4 made-up").toString("base64") });
  await R["Sam Sub"]("handoffs.close", { id: h.id, outcome: "complete", seen: "pending", proof: { date: todayIST(), ref: "BATCH-1", files: [name, "short.pdf"] } });
  const proof = JSON.parse((await q1("SELECT proof_json FROM handoffs WHERE id = ?", h.id)).proof_json);
  ok("W-15: the 251-character name is listed exactly as attached (200 characters, ends .pdf)", proof.files[0] === a.attachment.name && proof.files[0].length === 200 && /\.pdf$/.test(proof.files[0]), [proof.files[0].length, proof.files[0].slice(-12), a.attachment.name.slice(-12)]);
  ok("W-15: a short name is listed as it is", proof.files[1] === "short.pdf");
}

S("W-06: an upload reopening a Posting Closed claim is kept (the owner's decision); its entries and files from before stay locked");
{
  const [c] = await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL ORDER BY id LIMIT 1", sun.id);
  const cl = await q1("SELECT * FROM claims WHERE id = ?", c.id);
  await give([c.id], "Arun Agent"); await AR("queue.open", { id: c.id });
  const eob = await AR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 made-up eob").toString("base64") });
  await AR("queue.complete", { id: c.id, ...POST, desk: true });
  const h = await q1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'posting'", c.id);
  await R["Paula Post"]("handoffs.close", { id: h.id, outcome: "complete", seen: "pending", proof: { date: todayIST(), ref: "CHK-77", allowed: "180", paid: "150", adjustment: "30" } });
  const before = await q1("SELECT state, handoff_status FROM claims WHERE id = ?", c.id);
  // the client's next file lists it again (a payer take-back)
  app.setToken(TOK["Tina Lead"]);
  const row = { match_key: cl.match_key, claim_no: cl.claim_no, patient: cl.patient, payer: cl.payer, dos: cl.dos, balance: 30, status_class: "denied", tier: "Low", priority: 20, file_status: "Denied", cpt: cl.cpt };
  const up = await app.uploadClaims({ client_id: sun.id, location_id: cl.location_id, kind: "fresh", file_name: "W-06 next month.xlsx", claims: [row], summary: {}, rows_read: 1 });
  const after = await q1("SELECT state, state_reason FROM claims WHERE id = ?", c.id);
  ok("W-06 (not a bug: the owner keeps it): the next file reopens the Posting Closed claim", before.state === "closed" && before.handoff_status === "posted" && up.reopened === 1 && after.state === "open" && /Reopened by fresh upload/.test(after.state_reason), [before, up.reopened, after]);
  const note = (await q1("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work'", c.id)).id;
  const byBiller = await T(() => AR("notes.update", { id: note, ...FOLLOW })), byLead = await T(() => TI("notes.update", { id: note, ...FOLLOW }));
  ok("W-06: the entry written before Posting closed it stays locked for its biller and the team lead", !byBiller.ok && !byLead.ok && /before an upload reopened it/.test(byBiller.e), [byBiller.e, byLead.e]);
  const rm = await T(() => TI("attachments.delete", { id: eob.attachment.id }));
  ok("W-06: the EOB attached before stays too", !rm.ok && /files from before can no longer be removed/.test(rm.e), rm.e);
  const tl = await TI("claims.timeline", { id: c.id }), bd = await TI("claims.get", { id: c.id });
  ok("W-06: the claim's history and profile offer no Edit or remove for them", !tl.items.some((x) => x.id === note && x.editable) && !bd.notes.some((x) => x.id === note && x.editable) && !bd.attachments.some((x) => x.id === eob.attachment.id && x.deletable));
  // new work after the reopening is edited as usual
  await give([c.id], "Arun Agent"); await AR("queue.open", { id: c.id }); await AR("queue.complete", { id: c.id, ...FOLLOW, desk: true });
  const fresh = (await q1("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC LIMIT 1", c.id)).id;
  const ed = await T(() => AR("notes.update", { id: fresh, ...FOLLOW }));
  ok("W-06: an entry written after the reopening can be edited as any entry", fresh !== note && ed.ok, ed.e);
}

S("W-14: any team lead may change any note template, and every change shows who made it (the owner's decision)");
{
  const TINA = TI;
  // a template from before changes were recorded: no made-up history, its saver shown as "added by"
  const oldId = "tpl-old-" + Date.now();
  await sql("INSERT INTO note_templates (id, client_id, title, text, by_id, by_name, at) VALUES (?,?,?,?,?,?,?)", oldId, null, "Older template", "Called the payer, claim in process, call back in 15 days.", U("Tina Lead"), "Tina Lead", Date.UTC(2026, 9, 1));
  const h0 = await LEO("templates.history", { id: oldId });
  ok("W-14: an older template has no made-up history: its saver and date show as added by", h0.log.length === 0 && h0.added.by_name === "Tina Lead" && h0.added.at === Date.UTC(2026, 9, 1), h0);
  const l0 = (await LEO("templates.list", {})).rows.find((r) => r.id === oldId);
  ok("W-14: the list says added by for it (nothing logged yet)", l0 && !l0.logged && l0.by_name === "Tina Lead");
  // Tina adds one for every client; Leo (another team) edits it, then removes it; Tina restores it
  const t = await TINA("templates.save", { title: "Claim in process", text: "Called the payer, the claim is in process since [date], call back in 15 days.", client_id: "" });
  const e1 = await T(() => LEO("templates.save", { id: t.id, title: "Claim in process (Lakeview)", text: "Called the payer, the claim is in process since [date], call back in 10 days.", client_id: "" }));
  ok("W-14: Leo Lead (another team) may still edit Tina's every-client template", e1.ok, e1.e);
  const after = (await LEO("templates.list", {})).rows.find((r) => r.id === t.id);
  ok("W-14: the list shows last changed by Leo Lead", after && after.logged && after.by_name === "Leo Lead", after);
  const h1 = await TINA("templates.history", { id: t.id });
  const ed = h1.log.find((x) => x.action === "edited");
  ok("W-14: the timeline has Added by Tina, then Edited by Leo with the old and the new title and text", h1.log[0].action === "created" && h1.log[0].by_name === "Tina Lead" && ed && ed.by_name === "Leo Lead"
    && ed.old.title === "Claim in process" && ed.new.title === "Claim in process (Lakeview)" && /15 days/.test(ed.old.text) && /10 days/.test(ed.new.text) && !h1.added, h1.log.map((x) => x.action + " " + x.by_name));
  // two changes in the same millisecond (as on a fast machine) still read in the order they were made, whatever their random ids
  await DB.prepare("UPDATE note_template_log SET at = (SELECT MIN(at) FROM note_template_log WHERE template_id = ?) WHERE template_id = ?").bind(t.id, t.id).run();
  await DB.prepare("UPDATE note_template_log SET id = CASE action WHEN 'created' THEN 'zz-' || id ELSE 'aa-' || id END WHERE template_id = ?").bind(t.id).run();
  const tie = (await TINA("templates.history", { id: t.id })).log.map((x) => x.action);
  ok("W-14: two changes saved in the same millisecond still read added, then edited", tie.join(",") === "created,edited", tie);
  const same = await LEO("templates.save", { id: t.id, title: "Claim in process (Lakeview)", text: "Called the payer, the claim is in process since [date], call back in 10 days.", client_id: "" });
  ok("W-14: saving it unchanged adds nothing to the timeline", same.ok && (await TINA("templates.history", { id: t.id })).log.length === 2);
  const rm = await T(() => LEO("templates.delete", { id: t.id }));
  const inUse = (await TINA("templates.list", {})).rows.some((r) => r.id === t.id), forBiller = (await AR("templates.list", { client_id: sun.id })).rows.some((r) => r.id === t.id);
  const gone = (await TINA("templates.list", { removed: true })).rows.find((r) => r.id === t.id);
  ok("W-14: Leo may remove it: it leaves the lists billers insert from, kept under Removed with who and when", rm.ok && !inUse && !forBiller && gone && gone.removed_by_name === "Leo Lead" && gone.removed_at > 0, [rm.e, inUse, forBiller, gone]);
  const ed2 = await T(() => TINA("templates.save", { id: t.id, title: "Claim in process", text: "Called the payer, the claim is in process since [date].", client_id: "" }));
  ok("W-14: a removed template is not edited until restored", !ed2.ok && /restore it first/i.test(ed2.e), ed2.e);
  const rs = await TINA("templates.restore", { id: t.id });
  const back = (await TINA("templates.list", {})).rows.find((r) => r.id === t.id);
  ok("W-14: Restore puts it back in use, last changed by the one who restored it", rs.ok && back && back.by_name === "Tina Lead" && !(await TINA("templates.list", { removed: true })).rows.some((r) => r.id === t.id), back);
  const h2 = await TINA("templates.history", { id: t.id });
  ok("W-14: the timeline reads added, edited, removed, restored, each with who and when", JSON.stringify(h2.log.map((x) => [x.action, x.by_name])) === JSON.stringify([["created", "Tina Lead"], ["edited", "Leo Lead"], ["removed", "Leo Lead"], ["restored", "Tina Lead"]]) && h2.log.every((x) => x.at > 0), h2.log.map((x) => [x.action, x.by_name]));
  const aud = (await A("audit.list", { action: "template" })).rows.filter((x) => /Claim in process/.test(x.detail)).map((x) => x.action + " " + x.user_name).reverse();
  ok("W-14: every change is in the audit trail (added, edited, removed, restored)", JSON.stringify(aud) === JSON.stringify(["template.add Tina Lead", "template.edit Leo Lead", "template.remove Leo Lead", "template.restore Tina Lead"]), aud);
  // an older template edited: the timeline keeps who saved it first, from what the template said (not made up)
  await LEO("templates.save", { id: oldId, title: "Older template", text: "Called the payer, claim in process, call back in 30 days.", client_id: "" });
  const h3 = await LEO("templates.history", { id: oldId });
  ok("W-14: an older template edited keeps its added by (Tina, her date) and the edit by Leo", h3.added && h3.added.by_name === "Tina Lead" && h3.added.at === Date.UTC(2026, 9, 1) && h3.log.length === 1 && h3.log[0].by_name === "Leo Lead", h3);
  // still: billers and SMEs do not change templates; a client's template needs edit access to that client; moving an every-client one to one client stays refused
  ok("W-14: a biller cannot change or remove templates", !(await T(() => AR("templates.save", { title: "Mine", text: "A biller's own template text here.", client_id: "" }))).ok && !(await T(() => AR("templates.delete", { id: t.id }))).ok && !(await T(() => AR("templates.restore", { id: t.id }))).ok);
  const sunT = await TINA("templates.save", { title: "Sunrise only", text: "Sunrise's own follow-up template text.", client_id: sun.id });
  ok("W-14: Leo cannot change or remove a template of a client he cannot edit", !(await T(() => LEO("templates.save", { id: sunT.id, title: "Sunrise only", text: "Changed by another team lead.", client_id: sun.id }))).ok && !(await T(() => LEO("templates.delete", { id: sunT.id }))).ok);
  ok("W-14: moving an every-client template to one client stays refused for a team lead (E-17)", !(await T(() => LEO("templates.save", { id: t.id, title: "Claim in process", text: "Called the payer, the claim is in process since [date], call back in 15 days.", client_id: lake.id }))).ok);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
