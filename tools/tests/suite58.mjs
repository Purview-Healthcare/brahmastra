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

S("Allocation: every biller gets the same number of claims");
{
  const team = ["Arun Agent", "Bela Agent", "Cara Agent", "Dev Agent", "Esha Agent"].map((name, i) => ({ id: "u" + i, name, cap: 40 }));
  // 150 claims, one claim per patient, from three payers: grouping by payer used to fill one biller up to the target before the next
  const claims = Array.from({ length: 150 }, (_, i) => ({ id: "c" + i, patient: "Testpatient, P" + i, payer: ["Aetna", "Cigna", "Humana"][i % 3], priority: 50, balance: 100 + i }));
  const counts = (plan) => plan.perUser.map((u) => u.count);
  const old = app.planAllocation({ claims, users: team.map((u) => ({ id: u.id, name: u.name, capacity: u.cap })), strategy: "smart" });
  const share = app.evenShares(team, (u) => u.cap, claims.length);
  const even = app.planAllocation({ claims, users: team.map((u) => ({ id: u.id, name: u.name, capacity: share[u.id] })), strategy: "smart" });
  ok("set-up: with each target as the limit, the split was uneven (the last biller got none)", Math.min(...counts(old)) < Math.max(...counts(old)), counts(old));
  ok("split evenly: 150 claims for 5 billers is 30 each", counts(even).every((n) => n === 30), counts(even));
  for (const strategy of ["patient", "payer", "round_robin", "even_dollars"]) {
    const p = app.planAllocation({ claims, users: team.map((u) => ({ id: u.id, name: u.name, capacity: share[u.id] })), strategy });
    ok("the same 30 each with the " + strategy + " way of keeping claims together", counts(p).every((n) => n === 30), counts(p));
  }
  const s2 = app.evenShares([{ id: "a", cap: 10 }, { id: "b", cap: 40 }, { id: "c", cap: 40 }], (u) => u.cap, 60);
  ok("a lower target is kept (10), and the rest is shared evenly (25 and 25)", s2.a === 10 && s2.b === 25 && s2.c === 25, s2);
  const s3 = app.evenShares(team, (u) => u.cap, 300);
  ok("more claims than the team's targets: each gets their full target (40), the rest stays in the pool", Object.values(s3).every((n) => n === 40), s3);
  const s4 = app.evenShares(team, (u) => u.cap, 152);
  ok("when it does not divide, some get one more (31, 31, 30, 30, 30)", Object.values(s4).sort().join(",") === "30,30,30,31,31", s4);
  const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("the Allocate screen and the upload's own allocation both use the even split", (src.match(/evenShares\(/g) || []).length >= 3 && /capacity: shareIn\[m\.id\]/.test(src));
}

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
process.exit(failed.length ? 1 : 0);
