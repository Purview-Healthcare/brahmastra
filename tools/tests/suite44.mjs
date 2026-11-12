/* Suite 44: the Stack report. (1) The owner's scoring rules, band by band: every threshold just below, at and just above,
   checked against the numbers of her April sheet copied here by hand (not read from worker.js). (2) The month's rows worked
   out from Brahmastra's own data (Team status's productivity) and Purview Shastra's days, the typed values, who sees and
   types what, the lock and the unlock, and an associate's own locked months. A made-up team on the demo data and a stand-in
   for Purview Shastra's roster and floor feeds. Nothing here is a real person. */
import fs from "fs";
import vm from "vm";
import { REPO } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };

// ---- (1) the scoring rules, run on their own: the block between the two markers in worker.js holds only pure functions ----
const src = fs.readFileSync(REPO + "/worker.js", "utf8");
const B0 = src.indexOf("/* ---- stack scoring rules: begin ----"), B1 = src.indexOf("/* ---- stack scoring rules: end ---- */");
const SC = vm.runInNewContext(src.slice(B0, B1) + "\n({ STACK_RULES, stackBand, stackAttendance, stackAssocScore, stackTlScore, stackBandTexts, stackApplied, stackAttApplied, STACK_BREAK_LIMIT_MIN });", {});
const R = SC.STACK_RULES;

/* The April sheet's bands, as the build spec gives them (percentages as fractions). Each rule: [threshold, score] from the top,
   "value >= threshold" unless marked more-than, and the score below the last threshold. */
const SPEC = {
  prod: { step: 0.0001, bands: [[1.1051, 10], [0.9951, 8], [0.9551, 6], [0.9051, 4], [0.8451, 2]], other: 0 },
  qual: { step: 0.0001, bands: [[0.99, 10], [0.9451, 8], [0.9251, 6], [0.8951, 4], [0.8451, 2]], other: 0 },
  pkt: { step: 0.0001, bands: [[0.9951, 2], [0.9451, 1], [0.8951, 0.5]], other: 0 },
  tos: { step: 1, bands: [[7 * 60 + 59, 5], [7 * 60 + 30, 3]], other: 0 },
  stack: { step: 0.0001, bands: [[0.92, 5], [0.85, 4], [0.72, 3], [0.70, 2], [0.65, 1]], other: 0 },
  tlProd: { step: 0.0001, bands: [[0.9951, 10], [0.9451, 8], [0.8951, 6]], other: 0 },
  tlQual: { step: 0.0001, bands: [[0.99, 10], [0.9651, 8], [0.9451, 6]], other: 0 },
  tlShrink: { step: 0.0001, bands: [[0.16, 0], [0.1349, 2], [0.1149, 4], [0.0949, 6], [0.08, 8]], other: 10 },
  tlStack: { step: 0.0001, bands: [[0.96, 5], [0.91, 4], [0.86, 3], [0.81, 2], [0.76, 1]], other: 0 },
};
const pctTxt = (v) => (Math.round(v * 1e6) / 1e4) + "%";
for (const [key, spec] of Object.entries(SPEC)) {
  S("Bands: " + key);
  const rule = R[key];
  ok(key + ": the same thresholds and scores as the April sheet", rule && JSON.stringify(rule.bands.map((b) => [b[1], b[2]])) === JSON.stringify(spec.bands) && rule.bands.every((b) => b[0] === ">=") && rule.other === spec.other,
    rule && { code: rule.bands, other: rule.other });
  spec.bands.forEach(([t, s], i) => {
    const below = i + 1 < spec.bands.length ? spec.bands[i + 1][1] : spec.other;
    const show = key === "tos" ? (v) => v + " min" : pctTxt;
    for (const [what, v, want] of [["just below", t - spec.step, below], ["a hair below", t - 1e-7, below], ["at", t, s], ["just above", t + spec.step, s]]) {
      const got = SC.stackBand(rule, v);
      ok(`${key}: ${what} ${show(t)} (${show(v)}) scores ${want}`, got === want, { v, got });
    }
  });
  ok(key + ": far above the top band and 0 score as the top and the bottom band", SC.stackBand(rule, spec.bands[0][0] * 3) === spec.bands[0][1] && SC.stackBand(rule, 0) === spec.other);
  ok(key + ": an empty value scores 0", SC.stackBand(rule, null) === 0 && SC.stackBand(rule, "") === 0 && SC.stackBand(rule, undefined) === 0);
}

S("Bands: the counts (late logins, breaks over), attrition and adherence");
for (const [n, want] of [[0, 1], [1, 0.5], [2, 0.5], [3, 0], [4, 0], [30, 0]]) ok(`late logins or breaks over: ${n} scores ${want} (0: 1; 1 or 2: 0.5; more than 2: 0)`, SC.stackBand(R.count, n) === want, SC.stackBand(R.count, n));
for (const [n, want] of [[0, 5], [1, 4], [2, 3], [3, 0], [9, 0]]) ok(`attrition: ${n} left scores ${want} (more than 2: 0; 2: 3; 1: 4; 0: 5)`, SC.stackBand(R.tlAttr, n) === want, SC.stackBand(R.tlAttr, n));
for (const [n, want] of [[0, 5], [5, 5], [6, 4], [7, 4], [8, 4], [9, 3], [10, 3], [12, 3], [13, 0], [40, 0]]) ok(`team adherence: ${n} scores ${want} (more than 12: 0; 9 and up: 3; 6 and up: 4; else 5)`, SC.stackBand(R.tlAdh, n) === want, SC.stackBand(R.tlAdh, n));

S("Bands: attendance (LWP first, then AL + LWP)");
for (const [al, lwp, want] of [[0, 0, 10], [2.5, 0, 10], [2.9, 0, 10], [3, 0, 8], [3.5, 0, 8], [3.9, 0, 8], [4, 0, 6], [4.5, 0, 6], [5, 0, 4], [5.5, 0, 4], [5.9, 0, 4], [6, 0, 2], [6.5, 0, 2], [12, 0, 2],
  [0, 0.5, 0], [0, 1, 0], [3, 0.5, 0], [0, 0.4999, 10], [2.5, 0.4999, 10], [3, 0.4999, 8]]) {
  ok(`AL ${al}, LWP ${lwp} scores ${want}`, SC.stackAttendance(al, lwp) === want, SC.stackAttendance(al, lwp));
}

S("Bands: time on system in minutes (7 h 59 min and 7 h 30 min)");
for (const [m, want] of [[478, 3], [478.99, 3], [479, 5], [479.01, 5], [480, 5], [449, 0], [449.99, 0], [450, 3], [450.5, 3], [0, 0], [720, 5]]) ok(`average ${m} min a day scores ${want}`, SC.stackBand(R.tos, m) === want, SC.stackBand(R.tos, m));

S("Percentages worked out by division land on the threshold itself");
ok("9951 of 10000 (99.51%) is productivity 8 and PKT 2; 9950 is 6 and 1", SC.stackBand(R.prod, 9951 / 10000) === 8 && SC.stackBand(R.pkt, 9951 / 10000) === 2 && SC.stackBand(R.prod, 9950 / 10000) === 6 && SC.stackBand(R.pkt, 9950 / 10000) === 1);
ok("11051 of 10000 (110.51%) is productivity 10; 11050 is 8", SC.stackBand(R.prod, 11051 / 10000) === 10 && SC.stackBand(R.prod, 11050 / 10000) === 8);
ok("a typed 99.51 (stored as 99.51 / 100) is quality 10 at 99%, PKT 2", SC.stackBand(R.qual, Math.round(99.51 * 100) / 10000) === 10 && SC.stackBand(R.pkt, Math.round(99.51 * 100) / 10000) === 2);
ok("1349 of 10000 shrinkage is 2, 1348 is 4", SC.stackBand(R.tlShrink, 1349 / 10000) === 2 && SC.stackBand(R.tlShrink, 1348 / 10000) === 4);
// the associate's Stack from its total out of 40: 0.92 * 40 = 36.8 is not a total anyone can have (totals go in halves)
for (const [total, want] of [[40, 5], [37, 5], [36.5, 4], [34, 4], [33.5, 3], [29, 3], [28.5, 2], [28, 2], [27.5, 1], [26, 1], [25.5, 0], [0, 0]]) {
  ok(`a total of ${total} of 40 (${pctTxt(total / 40)}) is Stack ${want}`, SC.stackBand(R.stack, total / 40) === want, SC.stackBand(R.stack, total / 40));
}
for (const [total, want] of [[55, 5], [48, 5], [47.9, 4], [45.5, 4], [45.4, 3], [43, 3], [42.9, 2], [40.5, 2], [40.4, 1], [38, 1], [37.9, 0]]) {
  ok(`a team lead total of ${total} of 50 (${pctTxt(total / 50)}) is Stack ${want}`, SC.stackBand(R.tlStack, total / 50) === want, SC.stackBand(R.tlStack, total / 50));
}

S("A whole associate: the five groups, the total of 40 and the Stack");
let a = SC.stackAssocScore({ pct: 712 / 630, quality: 0.986, al: 1, lwp: 0, late: 0, brk: 2, tp: true, pkt: 1, tos: 486 });
ok("113% productivity 10, 98.6% quality 8, 1 day AL 10, no late 1, 2 breaks over 0.5, team player 1, PKT 100% 2, 8 h 06 a day 5", a.prod === 10 && a.qual === 8 && a.att === 10 && a.late === 1 && a.brk === 0.5 && a.tp === 1 && a.pkt === 2 && a.tos === 5, a);
ok("Others is late + breaks + team player + PKT = 4.5; the total 37.5 of 40 is 93.75%, Stack 5", a.others === 4.5 && a.total === 37.5 && a.pct === 0.9375 && a.stack === 5, a);
a = SC.stackAssocScore({ pct: 1.2, quality: 1, al: 0, lwp: 0, late: 0, brk: 0, tp: true, pkt: 1, tos: 500 });
ok("everything at the top is 40 of 40, 100%, Stack 5", a.total === 40 && a.pct === 1 && a.stack === 5, a);
a = SC.stackAssocScore({ pct: null, quality: null, al: 0, lwp: 1, late: 3, brk: 4, tp: false, pkt: null, tos: null });
ok("nothing earned is 0 of 40, Stack 0 (an empty PKT counts as 0; Team player No 0)", a.total === 0 && a.pct === 0 && a.stack === 0 && a.tp === 0 && a.pkt === 0, a);
a = SC.stackAssocScore({ pct: 0.96, quality: 0.94, al: 2, lwp: 0, late: 1, brk: 0, tp: true, pkt: 0.92, tos: 455 });
ok("96% → 6, 94% → 6, 2 days AL → 10, 1 late → 0.5, no breaks over → 1, Yes → 1, PKT 92% → 0.5, 7 h 35 → 3: 28 of 40, exactly 70%, Stack 2", a.prod === 6 && a.qual === 6 && a.att === 10 && a.others === 3 && a.tos === 3 && a.total === 28 && a.pct === 0.7 && a.stack === 2, a);

S("A whole team lead: the parameters, the ticks, the addition point, the total and the Stack");
let t = SC.stackTlScore({ prod: 1.04, quality: 0.974, shrink: 0.061, attrition: 0, adherence: 4, th: [true, true, true, true, false], cf: [true, true, true, true, true], addition: 3.2 });
ok("104% → 10, 97.4% → 8, 6.1% shrinkage → 10, nobody left → 5, adherence 4 → 5, 4 + 5 ticks, addition 3.2: 50.2 of 50, 100.4%, Stack 5", t.prod === 10 && t.qual === 8 && t.shrink === 10 && t.attr === 5 && t.adh === 5 && t.th === 4 && t.cf === 5 && Math.abs(t.total - 50.2) < 1e-9 && t.stack === 5, t);
t = SC.stackTlScore({ prod: 0.98, quality: 0.959, shrink: 0.094, attrition: 1, adherence: 6, th: [true, true, true, false, true], cf: [true, true, true, true, true], addition: 2.6 });
ok("98% → 8, 95.9% → 6, 9.4% shrinkage → 8, 1 left → 4, adherence 6 → 4, 4 + 5 ticks, addition 2.6: 41.6 of 50, 83.2%, Stack 2", t.prod === 8 && t.qual === 6 && t.shrink === 8 && t.attr === 4 && t.adh === 4 && t.th === 4 && t.cf === 5 && Math.abs(t.total - 41.6) < 1e-9 && t.stack === 2, t);
t = SC.stackTlScore({ prod: 0.9, quality: 0.95, shrink: 0.14, attrition: 2, adherence: 13, th: [], cf: [], addition: 2 });
ok("90% → 6, 95% → 6, 14% → 2, 2 left → 3, 13 → 0, no ticks, addition 2: 19 of 50, Stack 0", t.prod === 6 && t.qual === 6 && t.shrink === 2 && t.attr === 3 && t.adh === 0 && t.th === 0 && t.cf === 0 && t.total === 19 && t.stack === 0, t);
t = SC.stackTlScore({ prod: 1, quality: 1, shrink: 0, attrition: 0, adherence: 0, th: [true, true, true, true, true], cf: [true, true, true, true, true], addition: 5 });
ok("everything at the top is 55 of 50 (the addition point is added as it is): 110%, Stack 5", t.total === 55 && t.pct === 1.1 && t.stack === 5, t);
t = SC.stackTlScore({ prod: null, quality: null, shrink: null, attrition: 0, adherence: 0, th: ["yes", 1, true], cf: [], addition: null });
ok("an empty average scores 0 (not the 10 a low shrinkage earns); only a real Yes tick counts", t.prod === 0 && t.qual === 0 && t.shrink === 0 && t.th === 1 && t.add === 0, t);

S("The bands in plain words");
const words = (k) => SC.stackBandTexts(R[k]).map((b) => b.text + ": " + b.score).join(" · ");
ok("productivity", words("prod") === "110.51% and above: 10 · 99.51% to 110.5%: 8 · 95.51% to 99.5%: 6 · 90.51% to 95.5%: 4 · 84.51% to 90.5%: 2 · under 84.51%: 0", words("prod"));
ok("attendance (AL + LWP)", words("leave") === "6 days and above: 2 · 5 to 5.5 days: 4 · 4 to 4.5 days: 6 · 3 to 3.5 days: 8 · under 3 days: 10", words("leave"));
ok("late logins and breaks over", words("count") === "more than 2: 0 · 1 or 2: 0.5 · none: 1", words("count"));
ok("time on system", words("tos") === "7 h 59 min and above: 5 · 7 h 30 min to 7 h 58 min: 3 · under 7 h 30 min: 0", words("tos"));
ok("the associate's Stack", words("stack") === "92% and above: 5 · 85% to 91.99%: 4 · 72% to 84.99%: 3 · 70% to 71.99%: 2 · 65% to 69.99%: 1 · under 65%: 0", words("stack"));
ok("shrinkage", words("tlShrink") === "16% and above: 0 · 13.49% to 15.99%: 2 · 11.49% to 13.48%: 4 · 9.49% to 11.48%: 6 · 8% to 9.48%: 8 · under 8%: 10", words("tlShrink"));
ok("attrition", words("tlAttr") === "more than 2: 0 · 2: 3 · 1: 4 · none: 5", words("tlAttr"));
ok("adherence", words("tlAdh") === "more than 12: 0 · 9 to 12: 3 · 6 to 8: 4 · 0 to 5: 5", words("tlAdh"));
ok("the band that applied: 113% is 110.51% and above, 99.5% is 95.51% to 99.5%, empty is 0", SC.stackApplied(R.prod, 1.13) === "110.51% and above → 10" && SC.stackApplied(R.prod, 0.995) === "95.51% to 99.5% → 6" && SC.stackApplied(R.pkt, null) === "empty → 0", [SC.stackApplied(R.prod, 1.13), SC.stackApplied(R.prod, 0.995)]);
ok("attendance's band: half a day of LWP is 0 whatever the AL", SC.stackAttApplied(1, 0.5) === "LWP of half a day or more → 0" && SC.stackAttApplied(3, 0) === "AL + LWP 3: 3 to 3.5 days → 8", SC.stackAttApplied(3, 0));
ok("the break limit is one number, 60 minutes", SC.STACK_BREAK_LIMIT_MIN === 60);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
