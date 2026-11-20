/* Suite 58: an inventory file whose sheet has summary lines above its column names, or whose first sheet is a summary (the
   owner's OneDrive inventory): the page finds the row of column names and the inventory sheet by itself, the team lead can pick
   the row by hand, and the guesses for the location, the payer and the bucket are right. Header names only; no data. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const rig = await makeRig({});
const app = rig.app;
const H = ["Service Date", "ClaimID", "Trim", "Order ID", "Patient Name", "PlanName", "CarrierName", "Aging", "Aging Bucket", "CurrentState", "TotalBalance", "Comment", "Status", "Action", "Worked by", "Work date", "Move To", "Allocation type", "Denial Summary", "MM"];
const row = (n) => ["2026-10-01", "C10" + n, "", "", "Testpatient, A" + n, "Plan A", "Carrier B", 40, "31-60", "Open", 120.5, "", "", "", "", "", "", "Fresh", "", ""];
const summary = [["Billed", 301, "18 claims assigned to Tina Lead", ""], ["Open", 120, "Closed", 4]];

S("The row of column names");
const above = [...summary, [], H, row(1), row(2)];
ok("summary lines above the table never pass for its column names: row 4 is found", app.detectHeaderRow(above) === 3, app.detectHeaderRow(above));
const t = app.tableFromSheet(above);
ok("the table has the file's columns and its two claim rows", t.headers[1] === "ClaimID" && t.headers.length === H.length && t.rows.length === 2 && t.headerRow === 3, [t.headers.slice(0, 3), t.rows.length]);
ok("a plain file (names in row 1) is read as before", app.detectHeaderRow([H, row(1)]) === 0);
ok("a file of another kind (no inventory names) keeps the first row that looks like names", app.detectHeaderRow([["Title", "of", "report"], ["Name", "Score", "Rank"], ["A", 1, 2]]) === 0);
ok("the team lead's pick of the row wins", app.tableFromSheet(above, 3).headers[0] === "Service Date" && app.tableFromSheet(above, 0).headers[0] === "Billed");

S("The sheet");
const sheets = [{ name: "Summary", rows: summary }, { name: "Inventory", rows: above }];
ok("a summary sheet first in the workbook is passed over: the inventory sheet is picked", sheets[app.bestInventorySheet(sheets)].name === "Inventory", sheets[app.bestInventorySheet(sheets)].name);
ok("a workbook of one sheet takes it", app.bestInventorySheet([{ name: "Only", rows: [H, row(1)] }]) === 0);

S("The guesses for this file's columns");
const m = app.autoMap(H);
ok("the four key columns: Claim # = ClaimID, Patient = Patient Name, Date of service = Service Date, Balance = TotalBalance", m.claim_no === "ClaimID" && m.patient === "Patient Name" && m.dos === "Service Date" && m.balance === "TotalBalance", m);
ok("\"Allocation type\" is not taken for the location (it only holds the letters of the word)", !m.location, m.location);
ok("the payer is the carrier (CarrierName), not the plan (PlanName)", m.payer === "CarrierName", m.payer);
ok("the bucket is Aging Bucket, not Aging", m.file_bucket === "Aging Bucket", m.file_bucket);
ok("a real location column is still found (Service Location, Practice Location Name)", app.autoMap(["Claim #", "Service Location"]).location === "Service Location" && app.autoMap(["Claim #", "Practice Location Name"]).location === "Practice Location Name");
ok("a file with only Plan Name still takes it for the payer", app.autoMap(["Claim #", "Plan Name"]).payer === "Plan Name");

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
process.exit(failed.length ? 1 : 0);
