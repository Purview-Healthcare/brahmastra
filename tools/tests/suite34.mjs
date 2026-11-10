/* Suite 34: the desks' production files in OneDrive. Submission in the team's Production Format Conso layout (the client's own inventory
   columns, the old status, who did it, and the four fields the person enters), Payment posting with the amounts entered per claim
   (allowed, paid, adjustment, patient responsibility, write-off), Rejections as before; each in its own tab with its own header, never
   under the AR template's header. A fake Microsoft Graph that keeps worksheets per workbook, and starts a new file from the AR template
   the way OneDrive does. Made-up data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", email: "" }, o);
const feed = [
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Paula Post", department: "Posting", project: "Sunrise Eye Care", email: "paula@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sam Sub", department: "Submission", project: "Sunrise Eye Care", email: "sam@purview-healthcare.com" })];
// the AR template's header (what a new month's file has on Sheet1 when OneDrive makes it from the template)
const AR_TEMPLATE = ["Sr. No", "Location", "Project", "Practice", "Uni", "IG Claim ID#/Charge ID#", "Patient Name", "DOS", "Payer", "Age", "Bucket", "Billed Amount($)", "Balance Amount($)", "CPT",
  "Comments/Notes", "Status", "Sub Status", "Action", "Bucket", "Mode of Work", "Start Time", "End Time", "Total Duration", "Date Worked", "Emp. ID", "Associate Name", "Status", "Errors", "Team Lead", "Date Range", "Week"];
const SUB = ["Client", "UID", "Date", "Patient", "Invoice", "NAEC Order No", "VEC S/W Insurance Name", "Insurance", "Balance", "VEC Patient Balance", "Location", "Type",
  "VEC Claims Sourse", "VEC Submission Type", "Old status", "Old Comment", "old bucket", " Old Onhold/Pending ", "Allocation Date", "Allocation", "DOW", "EMPID", "Worked by",
  "Inventory Status", "Comment", "Bucket", "Claim Type"];
const POST = ["Client", "UID", "Date", "Patient", "Invoice", "Insurance", "Location", "CPT", "Billed", "Balance", "Check / EFT #", "Check / EFT date", "Payment type", "Posted date",
  "Allowed", "Paid", "Adjustment", "Adjustment reason", "Deductible", "Co-insurance", "Co-pay", "Patient responsibility", "Write-off", "Balance after posting",
  "Allocation Date", "Allocation", "DOW", "EMPID", "Posted by", "Status", "Comment"];
// ---- a fake Microsoft Graph: folders, files, and worksheets per workbook (rename, add, used range, range writes) ----
const OD = { items: new Map(), seq: 0, books: new Map() };
const mk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it);
  if (kind === "file") OD.books.set(id, { n: 1, sheets: [{ id: "s1", name: "Sheet1", rows: [AR_TEMPLATE.slice()] }] }); return it; };
const child = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const out = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const u = new URL(url); const path = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));
  let r;
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (child("root", b.name)) return J({}, 409); return J(out(mk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = child("root", r[1]); return it ? J(out(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (child(r[1], r[2])) return J({}, 409); return J(out(mk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
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
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const row1 = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results[0];
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const PA = await firstIn("Paula Post", "paula@purview-healthcare.com"), SA = await firstIn("Sam Sub", "sam@purview-healthcare.com");
rig.liveEnv.DEMO = false;   // from here on OneDrive copies are on
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
await sql("UPDATE clients SET code = 'SEC' WHERE id = ?", sun.id);
for (const [dept, who] of [["posting", "Paula Post"], ["submission", "Sam Sub"], ["rejection", "Sam Sub"]]) {
  const r = await T(() => A("clients.saveResponsibility", { client_id: sun.id, dept, mode: "person", lead: U(who).id })); if (!r.ok) console.log("responsibility", dept, r.e);
}
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows;
await TI("alloc.apply", { client_id: sun.id, assignments: pool.map((c) => ({ id: c.id, user_id: U("Arun Agent").id })) });
// the client's inventory file had its own columns, and its old status, comment and bucket (made up)
await sql("UPDATE claims SET raw_json = ?, file_status = 'Rejected', file_comments = 'Invalid member ID', file_bucket = 'Purview' WHERE id = ?",
  JSON.stringify({ "UID": "U-1001", "NAEC Order No": "ORD-77", "vec s/w insurance name": "AETNA PPO", "VEC Patient Balance": "$35.00", "Type": "Primary", "VEC Claims Sourse": "EHR",
    "VEC Submission Type": "Electronic", "Old Onhold/Pending": "Pending" }), pool[0].id);
const c0 = await row1("SELECT * FROM claims WHERE id = ?", pool[0].id), c1 = await row1("SELECT * FROM claims WHERE id = ?", pool[1].id);
// dates go in as Excel date numbers (the cell shows them as mm/dd/yyyy)
const mdy = (iso) => { if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const todayIso = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const mon = () => { const d = new Date(Date.now() + 330 * 60000); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()] + " " + d.getUTCFullYear(); };
const fileIn = (scopeFolder, prefix) => { const root = child("root", "Brahmastra Clients"), f = root && child(root.id, sun.name), prod = f && child(f.id, "Production"), sc = prod && child(prod.id, scopeFolder);
  return sc && child(sc.id, `${prefix} Production - ${sun.name} - ${mon()}.xlsx`); };
const tab = (file, name) => file && OD.books.get(file.id).sheets.find((x) => x.name === name);
const sub = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal", action: "follow up" } };
const post = { saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Payment-Cash In Bank" }, note: { source: "Portal", findings: "Paid per EOB, posting needed", action: "follow up" } };
await AR("queue.complete", { id: pool[0].id, ...sub });
await AR("attachments.add", { claim_id: pool[1].id, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 made-up eob").toString("base64") });
await AR("queue.complete", { id: pool[1].id, ...post });
await AR("queue.complete", { id: pool[2].id, ...sub });

S("Payment posting: the amounts entered per claim, one row per claim");
const ph = (await PA("handoffs.list", {})).rows.find((h) => h.claim_id === pool[1].id);
ok("the desk list carries the billed amount for the form", ph && "billed" in ph, ph && Object.keys(ph));
let r = await T(() => PA("handoffs.close", { id: ph.id, outcome: "complete", proof: { date: todayIso, ref: "CHK-9001", paid: "abc" } }));
ok("an amount that is not a number is refused", !r.ok && /Paid is not a number/.test(r.e || ""), r);
r = await T(() => PA("handoffs.close", { id: ph.id, outcome: "complete", proof: { date: todayIso, ref: "CHK-9001", allowed: "190", paid: "80", coinsurance: "20" } }));
ok("amounts that do not add up are refused: allowed must be paid + deductible + co-insurance + co-pay", !r.ok && /do not add up: allowed 190\.00, but paid \+ deductible \+ co-insurance \+ co-pay = 100\.00/.test(r.e || ""), r);
r = await T(() => PA("handoffs.close", { id: ph.id, outcome: "complete", proof: { date: todayIso, ref: "CHK-9001", paid: "80" } }));
ok("paid without the allowed is refused too", !r.ok && /Enter the allowed and the paid amounts/.test(r.e || ""), r);
r = await T(() => PA("handoffs.close", { id: ph.id, outcome: "complete", note: "Posted per ERA", proof: { date: todayIso, ref: "CHK-9001", check_date: "2026-11-05", pay_type: "EFT",
  allowed: "100", paid: "80", adjustment: "40", adj_reason: "CO-45", deductible: "0", coinsurance: "20", copay: "", writeoff: "" } }));
ok("posted with the EOB amounts", r.ok, r);
const pr = (await row1("SELECT proof_json FROM handoffs WHERE id = ?", ph.id)).proof_json, pj = JSON.parse(pr);
ok("saved with the posting: paid is also the amount the reports add up", pj.paid === 80 && pj.amount === 80 && pj.allowed === 100 && pj.adjustment === 40 && pj.coinsurance === 20 && pj.adj_reason === "CO-45" && pj.pay_type === "EFT" && !("copay" in pj), pj);
await sleep(500);
const pf = fileIn("Payment posting", "Payment posting"), pt = tab(pf, "Payment posting");
ok("this month's Payment posting file: the template's tab renamed Payment posting, no other tab", pf && pt && OD.books.get(pf.id).sheets.length === 1, pf && OD.books.get(pf.id).sheets.map((x) => x.name));
ok("its header is the posting header, not the AR template's", pt && POST.every((h, i) => pt.rows[0][i] === h) && pt.rows[0].slice(POST.length).every((v) => v === ""), pt && pt.rows[0]);
const prow = pt ? pt.rows[1] : [], P_ = (h) => prow[POST.indexOf(h)];
ok("the row: client code, patient, DOS, invoice, insurance, CPT, billed and balance by themselves", prow && P_("Client") === "SEC" && P_("Patient") === c1.patient && P_("Date") === mdy(c1.dos) && P_("Invoice") === c1.claim_no && P_("Insurance") === c1.payer && P_("CPT") === c1.cpt && P_("Balance") === c1.balance,
  { client: P_("Client"), date: P_("Date"), dos: c1.dos, inv: P_("Invoice"), bal: P_("Balance") });
ok("the entered details: check, check date, type, posted date, allowed, paid, adjustment, reason, co-insurance", P_("Check / EFT #") === "CHK-9001" && P_("Check / EFT date") === mdy("2026-11-05") && P_("Payment type") === "EFT" && P_("Posted date") === mdy(todayIso)
  && P_("Allowed") === 100 && P_("Paid") === 80 && P_("Adjustment") === 40 && P_("Adjustment reason") === "CO-45" && P_("Co-insurance") === 20 && P_("Co-pay") === "", prow);
ok("patient responsibility and the balance after posting add up by themselves", P_("Patient responsibility") === 20 && P_("Balance after posting") === Math.round((c1.balance - 80 - 40) * 100) / 100, { pr: P_("Patient responsibility"), after: P_("Balance after posting") });
ok("who and when: DOW today, EMPID, Posted by, Posted, the comment; Allocation blank", P_("DOW") === mdy(todayIso) && P_("EMPID") === "D1" && P_("Posted by") === "Paula Post" && P_("Status") === "Posted" && P_("Comment") === "Posted per ERA" && P_("Allocation") === "", prow);
const pfm = pt && pt.fmts && pt.fmts[1], PF = (h) => pfm && pfm[POST.indexOf(h)];
ok("dates show as mm/dd/yyyy and amounts as money, whatever OneDrive's language", PF("Date") === "mm/dd/yyyy" && PF("Check / EFT date") === "mm/dd/yyyy" && PF("Posted date") === "mm/dd/yyyy" && PF("DOW") === "mm/dd/yyyy"
  && PF("Paid") === "#,##0.00" && PF("Balance after posting") === "#,##0.00" && PF("Patient") === "General", pfm);

S("Submission: the team's Conso layout, mostly filled by itself");
const sh0 = (await SA("handoffs.list", {})).rows.find((h) => h.claim_id === pool[0].id);
r = await T(() => SA("handoffs.close", { id: sh0.id, outcome: "complete", note: "Member ID corrected from the card", proof: { date: todayIso, ref: "B-1", mode: "Portal", inv_status: "Resubmitted", bucket: "Payer", claim_type: "Resubmission", type: "" } }));
ok("submitted, with the four fields for the file", r.ok, r);
await sleep(500);
const sf = fileIn("Submission", "Submission"), st = tab(sf, "Submission");
ok("this month's Submission file: one tab named Submission with the team's header (their spelling kept)", sf && st && OD.books.get(sf.id).sheets.length === 1 && SUB.every((h, i) => st.rows[0][i] === h), st && st.rows[0]);
const srow = st ? st.rows[1] : [], S_ = (h) => srow[SUB.indexOf(h)];
ok("from the inventory row: client code, UID, DOS, patient, invoice, insurance, balance, location", S_("Client") === "SEC" && S_("UID") === "U-1001" && S_("Date") === mdy(c0.dos) && S_("Patient") === c0.patient && S_("Invoice") === c0.claim_no && S_("Insurance") === c0.payer && S_("Balance") === c0.balance,
  srow);
ok("the client's own columns, whatever their case: NAEC Order No, VEC insurance name, VEC patient balance, source, submission type", S_("NAEC Order No") === "ORD-77" && S_("VEC S/W Insurance Name") === "AETNA PPO" && S_("VEC Patient Balance") === 35 && S_("VEC Claims Sourse") === "EHR" && S_("VEC Submission Type") === "Electronic",
  srow);
ok("Type left empty in the form: the inventory file's Type", S_("Type") === "Primary", S_("Type"));
ok("the old status, comment, bucket and on hold / pending, as the inventory file had them", S_("Old status") === "Rejected" && S_("Old Comment") === "Invalid member ID" && S_("old bucket") === "Purview" && S_(" Old Onhold/Pending ") === "Pending", srow);
ok("allocation date (when AR sent it), Allocation blank, DOW, EMPID, worked by", S_("Allocation Date") === mdy(new Date(sh0.created_at + 330 * 60000).toISOString().slice(0, 10)) && S_("Allocation") === "" && S_("DOW") === mdy(todayIso) && S_("EMPID") === "S1" && S_("Worked by") === "Sam Sub", srow);
ok("what the person entered: Inventory Status, Comment, Bucket, Claim Type", S_("Inventory Status") === "Resubmitted" && S_("Comment") === "Member ID corrected from the card" && S_("Bucket") === "Payer" && S_("Claim Type") === "Resubmission", srow);
const sfm = st && st.fmts && st.fmts[1], SF = (h) => sfm && sfm[SUB.indexOf(h)];
ok("the Submission file's dates and money formatted too", SF("Date") === "mm/dd/yyyy" && SF("Allocation Date") === "mm/dd/yyyy" && SF("DOW") === "mm/dd/yyyy" && SF("Balance") === "#,##0.00" && SF("Invoice") === "General", sfm);

S("A file that already holds rows in another layout gets a tab of its own");
// as if the month's Submission file had been written earlier in the old layout (the AR template's header, an old row)
st.name = "Sheet1"; st.rows = [AR_TEMPLATE.slice(), ["1", "an old row"]];
const sh2 = (await SA("handoffs.list", {})).rows.find((h) => h.claim_id === pool[2].id);
r = await T(() => SA("handoffs.close", { id: sh2.id, outcome: "back", reason: "Corrected claim needs the modifier", note: "Please add modifier 25 and send again" }));
ok("sent back to AR", r.ok, r);
await sleep(500);
const tabs = OD.books.get(sf.id).sheets, nt = tab(sf, "Submission");
ok("a new Submission tab is added; the old tab is left as it was", tabs.length === 2 && tabs[0].name === "Sheet1" && tabs[0].rows.length === 2 && nt && SUB.every((h, i) => nt.rows[0][i] === h), tabs.map((x) => [x.name, x.rows.length]));
const brow = nt ? nt.rows[1] : [], B_ = (h) => brow[SUB.indexOf(h)];
ok("Need assistance from AR: the status, Purview bucket, the reason and comment, the claim type from the biller's SAAG action", B_("Inventory Status") === "Need assistance from AR" && B_("Bucket") === "Purview"
  && B_("Comment") === "Corrected claim needs the modifier: Please add modifier 25 and send again" && B_("Claim Type") === "Corrected claim", brow);
ok("no UID in this client's inventory row: the same key as the AR file (patient, DOS, payer, CPT)", typeof B_("UID") === "string" && B_("UID").startsWith(pool[2].patient || "") && B_("UID").length > 3, B_("UID"));

S("The recheck rows go to the Submission file; Rejections to its own tab");
const chk = await row1("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'subcheck'", pool[0].id);
await sql("UPDATE handoffs SET available_at = ? WHERE id = ?", Date.now() - 1000, chk.id);
r = await T(() => SA("handoffs.close", { id: chk.id, outcome: "rejected", reason: "Subscriber / member ID invalid", note: "Payer rejected it again for the member ID" }));
ok("the recheck is marked rejected", r.ok, r);
await sleep(500);
const rrow = tab(sf, "Submission").rows.slice(-1)[0], R_ = (h) => rrow[SUB.indexOf(h)];
ok("a Submission row: Rejected, Purview, with the reason and comment", R_("Inventory Status") === "Rejected" && R_("Bucket") === "Purview" && /member ID/.test(R_("Comment")), rrow);
const rj = await row1("SELECT id, dept FROM handoffs WHERE claim_id = ? AND dept = 'rejection' AND status = 'pending'", pool[0].id);
if (rj) {
  r = await T(() => SA("handoffs.close", { id: rj.id, outcome: "complete", proof: { date: todayIso, ref: "B-2", code: "Subscriber / member ID invalid" } }));
  await sleep(500);
  const rf = fileIn("Rejections", "Rejections"), rt = tab(rf, "Rejections");
  ok("Rejections: its own tab with the desk header (not the AR template's), Sr. No 1", r.ok && rt && rt.rows[0][0] === "Sr. No" && rt.rows[0][2] === "Department" && rt.rows[1][0] === 1 && rt.rows[1].includes("B-2"), rt && rt.rows.slice(0, 2));
} else ok("the rejected recheck went to the Rejections person", false, "no rejection hand-off");

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
