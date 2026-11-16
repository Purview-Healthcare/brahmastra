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
const made = (prefix, n, extra = {}) => Array.from({ length: n }, (_, i) => { const no = prefix + String(100001 + i); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (i + 1),
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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
