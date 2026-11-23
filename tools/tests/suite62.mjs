/* Suite 62: the allocation file (My allocations › Download CSV for billers, Allocate › Download allocation CSV for team leads):
   each claim's details, then the note's own fields in the note's order, left empty for the person to fill in. Made-up data. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const rig = await makeRig({}); const app = rig.app;
const NOTE = "DENIAL,SOURCE,REF,PRE CALL CHECK,RCA/FINDINGS,DENIAL DATE,TFL (days),AFL (days),SAAG STATUS,SAAG SUB STATUS,SAAG ACTION,BUCKET,EFFECTIVE,FOLLOW-UP,CALL START,CALL END";
const HEAD = "Claim #,Account #,Patient,Payer,DOS,CPT,Balance,Age,File status,Due," + NOTE;
const rows = [{ claim_no: "7711042", account_no: "AC1001", patient: "Testpatient, A1", payer: "Aetna", dos: "2026-09-14", cpt: "99213", balance: 625, age_days: 70, file_status: "Claim rejected", follow_up_on: "2026-11-23", assigned_name: "Arun Agent" },
  { claim_no: "7711043", account_no: "", patient: "=Testpatient B2", payer: "Cigna", dos: "", cpt: "99214, 99215", balance: "410.5", age_days: null, file_status: "", follow_up_on: "", assigned_name: "Bela Agent" }];
S("The biller's file");
{ const lines = app.allocationCSV(rows, { due: (r) => r.follow_up_on }).split("\r\n");
  ok("the header: the claim details, then the 16 note columns in the note's order", lines[0] === HEAD, lines[0]);
  ok("a row: details filled (DOS and Due as mm/dd/yyyy, balance with cents), the note columns empty", lines[1] === '7711042,AC1001,"Testpatient, A1",Aetna,09/14/2026,99213,625.00,70,Claim rejected,11/23/2026' + ",".repeat(16), lines[1]);
  ok("a cell that would run as a formula in Excel is made plain text; commas are quoted", lines[2].startsWith("7711043,,'=Testpatient B2,Cigna,,\"99214, 99215\",410.50,,,"), lines[2]); }
S("The team lead's file");
{ const lines = app.allocationCSV(rows, { biller: true }).split("\r\n");
  ok("the Biller column comes first, then the same columns", lines[0] === "Biller," + HEAD && lines[1].startsWith("Arun Agent,7711042,"), lines.slice(0, 2));
  ok("one row for each claim", lines.length === 3); }
S("On the page");
{ const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("My allocations has Download CSV (the claims shown) and Allocate has Download allocation CSV", />Download CSV<\/button>/.test(src) && /allocationCSV\(rows, \{ due:/.test(src) && />Download allocation CSV<\/button>/.test(src) && /allocationCSV\(on, \{ biller: true \}\)/.test(src)); }
const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
