/* Suite 44: the Stack report. (1) The owner's scoring rules, band by band: every threshold just below, at and just above,
   checked against the numbers of her April sheet copied here by hand (not read from worker.js). (2) The month's rows worked
   out from Brahmastra's own data (Team status's productivity) and Purview Shastra's days, the typed values, who sees and
   types what, the lock and the unlock, and an associate's own locked months. A made-up team on the demo data and a stand-in
   for Purview Shastra's roster and floor feeds. Nothing here is a real person. */
import fs from "fs";
import vm from "vm";
import { makeRig, REPO } from "./rig.mjs";
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

// ---- (2) the month from Brahmastra and Shastra, who sees and types what, the lock ----
/* A made-up floor: Vida (VP) over Mona (Manager), over Tess (team lead, Sunrise) and Lara (team lead, Lakeview); Sid is Tess's SME.
   October 2026 has 21 working days (Oct 2 is Shastra's holiday). Everyone's daily target is 10 here, so a full month is 210. */
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AS = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
let FEED = [
  P({ emp_id: "V1", name: "Vida Vice", position: "Vice President", email: mail("Vida Vice") }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vida Vice", project: SUN, also_on_projects: LAKE, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tess Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tess Lead"), doj: "2024-02-12" }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Lara Lead"), doj: "2023-07-03" }),
  P({ emp_id: "S1", name: "Sid Expert", position: "SME", project: SUN, reports_to: "Tess Lead", email: mail("Sid Expert") }),
  AS("PHC-A1", "Asha Able", "Tess Lead", SUN), AS("PHC-A2", "Bilal Bright", "Tess Lead", SUN), AS("PHC-A3", "Chen Calm", "Tess Lead", SUN),
  AS("PHC-A4", "Dora Desk", "Tess Lead", SUN, { department: "Posting" }), AS("PHC-A5", "Jo Joiner", "Tess Lead", SUN, { doj: "2026-10-19" }), AS("PHC-A6", "Gus Gone", "Tess Lead", SUN),
  AS("PHC-B1", "Lena Lake", "Lara Lead", LAKE), AS("PHC-B2", "Omar Oak", "Lara Lead", LAKE), AS("PHC-B3", "Uma Unknown", "Lara Lead", LAKE),
];
const D = (m, d) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const wk = (iso) => { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const OCTW = Array.from({ length: 31 }, (_, i) => D(10, i + 1)).filter((d) => wk(d) && d !== D(10, 2));   // 21 working days
const F = (emp, date, status, tof, brk = 45) => ({ emp_id: emp, email: "", date, status, open: false, tof_min: tof, logged_min: tof + brk, break_min: brk, guard: false, idle_min: 0, locked_min: 0 });
const per = (emp, fn) => OCTW.map((d) => fn(d)).map((x) => F(emp, ...x));
const FLOOR = [
  // Asha: approved leave Oct 9; her breaks ran over on Oct 6 (75 min) and Oct 22 (70 min); 8 h 06 on the floor a day
  ...per("PHC-A1", (d) => (d === D(10, 9) ? [d, "approved_leave", 0, 0] : [d, "present", 486, d === D(10, 6) ? 75 : d === D(10, 22) ? 70 : 50])),
  F("PHC-A1", D(10, 2), "holiday", 0, 0), F("PHC-A1", D(10, 3), "week_off", 0, 0),
  // Bilal: late on Oct 14, 15 and 16; a half day Oct 20 and sick leave Oct 21 (AL 1.5); 7 h 50 a day, the half day 4 h
  ...per("PHC-A2", (d) => ([D(10, 14), D(10, 15), D(10, 16)].includes(d) ? [d, "late", 470] : d === D(10, 20) ? [d, "half_day", 240] : d === D(10, 21) ? [d, "sick_leave", 0, 0] : [d, "present", 470])),
  // Chen: absent Oct 7 (LWP 1); a 61-minute break Oct 12
  ...per("PHC-A3", (d) => (d === D(10, 7) ? [d, "absent", 0, 0] : [d, "present", 480, d === D(10, 12) ? 61 : 45])),
  ...per("PHC-A4", (d) => [d, "present", 455]),
  // Jo joined Oct 19: not joined before it
  ...per("PHC-A5", (d) => (d < D(10, 19) ? [d, "not_joined", 0, 0] : [d, "present", 480])),
  ...per("PHC-B1", (d) => (d === D(10, 5) ? [d, "late", 500] : [d, "present", 500])),
  // Omar: a half day without pay Oct 8 (LWP 0.5); his breaks ran over on Oct 13, 14 and 15
  ...per("PHC-B2", (d) => (d === D(10, 8) ? [d, "half_day_lwp", 240] : [d, "present", 445, [D(10, 13), D(10, 14), D(10, 15)].includes(d) ? 65 : 45])),
  // November so far, Asha only (Nov 9 is Diwali)
  ...[2, 3, 4, 5, 6, 10, 11].map((d) => F("PHC-A1", D(11, d), "present", 480)),
];
const fetchMock = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : {};
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: [{ date: D(10, 2), name: "Gandhi Jayanti" }, { date: D(11, 9), name: "Diwali" }] });
  if (url.includes("brahmastra_floor")) return J({ ok: true, rows: FLOOR.filter((x) => x.date >= body.p_from && x.date <= body.p_to) });
  if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "no such function" }, 404);
  return J({ error: "no outside calls in tests" }, 500);
};

const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
// the clock: Thursday Nov 12 2026, 15:00 in India, for the server and the page alike
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const VDate = vm.runInContext("Date", rig.app);
const clock = (ms) => { Date.now = () => ms; VDate.now = () => ms; };
clock(IST(2026, 11, 12, 15));
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const AD = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await AD("roster.syncShastra");
let users = (await AD("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name) => { const email = mail(name); await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const VI = await firstIn("Vida Vice"), MO = await firstIn("Mona Manager"), TE = await firstIn("Tess Lead"), LA = await firstIn("Lara Lead"), SI = await firstIn("Sid Expert");
const ASHA = await firstIn("Asha Able"), BI = await firstIn("Bilal Bright");
// the work: claims worked in October (all on one morning: the month's count is what matters), as Team status counts them
const claimIds = (await rows("SELECT id FROM claims ORDER BY id LIMIT 50")).map((r) => r.id);
let nn = 0;
const work = async (name, day, n) => { const u = U(name); for (let i = 0; i < n; i++) { nn++; await sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) VALUES (?,?,?,?,'work',?)", "s44n" + nn, claimIds[nn % claimIds.length], u.id, u.name, IST(2026, 10, day, 11) + i * 1000); } };
await work("Asha Able", 1, 226); await work("Bilal Bright", 1, 194); await work("Chen Calm", 1, 181); await work("Jo Joiner", 19, 100); await work("Lena Lake", 1, 210); await work("Omar Oak", 1, 170);
await work("Gus Gone", 5, 40); await work("Uma Unknown", 13, 30);
await sql("UPDATE users SET capacity = 10 WHERE emp_id LIKE 'PHC-%'");
// Gus resigned (exit date Oct 20 in Shastra); Uma is no longer in Shastra at all
FEED = FEED.filter((f) => f.name !== "Uma Unknown").map((f) => (f.name === "Gus Gone" ? { ...f, status: "Resigned", exit_date: D(10, 20) } : f));
await AD("roster.syncShastra");
users = (await AD("users.list")).users;
const gus = (await rows("SELECT active, exit_date, off_at FROM users WHERE name = 'Gus Gone'"))[0], uma = (await rows("SELECT active, exit_date, off_at FROM users WHERE name = 'Uma Unknown'"))[0];
S("The roster sync keeps the day it switches someone off");
ok("Gus (resigned, exit date Oct 20) and Uma (gone from Shastra) are switched off, the day kept", gus.active === 0 && gus.exit_date === D(10, 20) && gus.off_at === IST(2026, 11, 12, 15) && uma.active === 0 && uma.off_at === IST(2026, 11, 12, 15), { gus, uma });
// Uma as if she had been switched off before Brahmastra kept the day: no exit date and no day, her last entry Oct 13
await sql("UPDATE users SET off_at = NULL WHERE name = 'Uma Unknown'");
await sql("UPDATE sessions SET expires_at = ?", IST(2027, 6, 1));
const OCT = "2026-10";
const pick = (x, ks) => (x ? Object.fromEntries(ks.map((k) => [k, x[k]])) : x);
const byName = (d, n) => d.rows.find((r) => r.name === n), tlOf = (d, n) => d.tls.find((t) => t.name === n);

S("Who may open the Stack report");
let r = await T(() => ASHA("stack.month", { month: OCT }));
ok("an associate cannot open it", !r.ok && r.status === 403, r);
r = await T(() => SI("stack.month", { month: OCT }));
ok("nor an SME", !r.ok && r.status === 403, r);
r = await T(() => as(null)("stack.month", { month: OCT }));
ok("nor anyone signed out", !r.ok && r.status === 401, r);
r = await T(() => MO("stack.month", { month: "2027-01" }));
ok("a month that has not started is refused", !r.ok && /January 2027 has not started yet/.test(r.e), r);
r = await T(() => MO("stack.month", { month: "2026-13" }));
ok("a month that is not a month is refused", !r.ok && r.status === 400, r);

S("October as the manager sees it: the associate stack");
let mo = await MO("stack.month", {});
ok("with no month picked, the manager gets October (the month before, not locked yet)", mo.month === OCT && mo.label === "October 2026" && mo.through === D(10, 31) && !mo.current && mo.over, pick(mo, ["month", "through", "current"]));
ok("her span: the 7 associates of Tess's and Lara's teams, not the SME, not the leavers, not the team leads", mo.rows.map((x) => x.name).sort().join() === "Asha Able,Bilal Bright,Chen Calm,Dora Desk,Jo Joiner,Lena Lake,Omar Oak", mo.rows.map((x) => x.name));
const KS = ["achieved", "expected", "working", "al", "lwp", "present", "late", "brk", "tos", "quality", "pkt", "tp"];
let asha = byName(mo, "Asha Able");
ok("Asha: ECN, title (the client), DOJ, team lead", asha.emp_id === "PHC-A1" && asha.title === SUN && asha.doj === "2026-01-05" && asha.lead_name === "Tess Lead", pick(asha, ["emp_id", "title", "doj", "lead_name"]));
ok("Asha: 226 done of 200 expected (20 days in at 10) = 113%: Productivity 10, from Brahmastra", asha.tracked && asha.achieved === 226 && asha.expected === 200 && asha.pct === 1.13 && asha.s.prod === 10 && asha.why.prod === "110.51% and above → 10", pick(asha, ["achieved", "expected", "pct", "why"]));
ok("Asha: 21 working days (Oct 2 is a holiday), 1 day of AL (Oct 9), 20 present, shrinkage 1/21; Attendance 10", asha.working === 21 && asha.al === 1 && asha.lwp === 0 && asha.present === 20 && Math.abs(asha.shrink - 1 / 21) < 1e-12 && asha.s.att === 10 && asha.al_days[0][0] === D(10, 9), pick(asha, KS));
ok("Asha: AVR production 226 / 20 = 11.3 a day, AVR target 10", asha.avr_prod === 11.3 && asha.avr_target === 10, pick(asha, ["avr_prod", "avr_target"]));
ok("Asha: no late login (1), breaks over on Oct 6 and Oct 22 (0.5), 8 h 06 a day over 20 days (5)", asha.late === 0 && asha.s.late === 1 && asha.brk === 2 && asha.brk_days.map((x) => x[0]).join() === D(10, 6) + "," + D(10, 22) && asha.s.brk === 0.5 && asha.tos === 486 && asha.tos_days === 20 && asha.s.tos === 5, pick(asha, KS));
ok("Asha before anything is typed: Team player Yes (1), PKT and Quality empty (0) and to enter", asha.tp === true && !asha.tp_typed && asha.pkt === null && asha.quality === null && asha.s.tp === 1 && asha.to_enter.join() === "quality,pkt", pick(asha, ["tp", "pkt", "quality", "to_enter"]));
const chen = byName(mo, "Chen Calm"), jo = byName(mo, "Jo Joiner"), dora = byName(mo, "Dora Desk"), omar = byName(mo, "Omar Oak"), bilal = byName(mo, "Bilal Bright");
ok("Bilal: 194 of 195 (a half day counts half) is 99.49%: Productivity 6, just under the 99.51% line", bilal.achieved === 194 && bilal.expected === 195 && bilal.s.prod === 6, pick(bilal, KS));
ok("Bilal: a half day and a day of sick leave are 1.5 days of AL (Attendance 10); 3 late logins (0)", bilal.al === 1.5 && bilal.lwp === 0 && bilal.s.att === 10 && bilal.late === 3 && bilal.s.late === 0, pick(bilal, KS));
ok("Bilal: time on system over the 20 days with time on floor, the half day too: 7 h 38 (3)", bilal.tos === 458.5 && bilal.tos_days === 20 && bilal.s.tos === 3, pick(bilal, KS));
ok("Chen: absent Oct 7 is LWP 1: Attendance 0", chen.lwp === 1 && chen.s.att === 0 && chen.why.att === "LWP of half a day or more → 0", pick(chen, KS));
ok("Chen: a 61-minute break is over the 60-minute limit (1 day: 0.5); 181 of 200 is 90.5%: Productivity 2", chen.brk === 1 && chen.s.brk === 0.5 && chen.pct === 0.905 && chen.s.prod === 2, pick(chen, KS));
ok("Omar: a half day without pay is LWP 0.5: Attendance 0; 3 breaks over: 0", omar.lwp === 0.5 && omar.s.att === 0 && omar.brk === 3 && omar.s.brk === 0, pick(omar, KS));
ok("Jo joined Oct 19: 10 working days from then, the not-joined days are neither AL nor LWP, 100 of 100 (Productivity 8)", jo.working === 10 && jo.al === 0 && jo.lwp === 0 && jo.achieved === 100 && jo.expected === 100 && jo.s.prod === 8, pick(jo, KS));
ok("Dora works on Posting: Team status does not count her, so Achieved and Expected are to enter (productivity 0 until then)", !dora.tracked && dora.achieved === null && dora.expected === null && dora.s.prod === 0 && dora.to_enter.includes("prod"), pick(dora, ["tracked", "achieved", "to_enter"]));
ok("the month's state: a draft, nothing locked, 7 PKT, 7 quality and 1 productivity to enter", mo.lock.locked === 0 && mo.lock.teams === 2 && mo.to_enter.pkt === 7 && mo.to_enter.quality === 7 && mo.to_enter.prod === 1, { lock: mo.lock, te: mo.to_enter });
ok("the manager can lock October (it is over) and tick; she cannot unlock", mo.can_lock && mo.manager && !mo.can_unlock, pick(mo, ["can_lock", "can_unlock", "manager"]));
const ts = await MO("team.status", { from: D(10, 1), to: D(10, 31), today: D(11, 12), tz_offset_min: 330 });
const same = ts.rows.filter((x) => mo.rows.some((y) => y.id === x.id)).map((x) => { const y = mo.rows.find((z) => z.id === x.id); return [x.name, x.count_done, y.achieved, x.target_done, y.expected]; });
ok("Achieved and Expected are exactly Team status's numbers for the same dates", same.length === 6 && same.every(([, a, b, c, d]) => a === b && c === d), same);

S("Typing: PKT, Team player, Quality and the fallbacks");
const tid = (n) => U(n).id;
const save = (who, name, field, value, note) => T(() => who("stack.save", { month: OCT, user_id: tid(name), field, value, note }));
r = await save(TE, "Asha Able", "pkt", "100"); ok("the team lead types Asha's PKT", r.ok && r.r.value === "1" && r.r.by === "Tess Lead", r);
r = await save(TE, "Asha Able", "tp", "yes", "Covered the team's deficit, mentoring"); ok("and her Team player, with a reason", r.ok && r.r.note === "Covered the team's deficit, mentoring", r);
r = await save(TE, "Asha Able", "quality", "98.6%"); ok("and her quality (a typed value until the QA tracker gives one)", r.ok && r.r.value === "0.986", r);
for (const [why, field, value, re] of [["a PKT that is not a number", "pkt", "abc", /percentage from 0 to 100/], ["a PKT over 100", "pkt", "101", /percentage from 0 to 100/], ["a negative quality", "quality", "-3", /percentage/],
  ["Team player that is not Yes or No", "tp", "maybe", /Yes or No/], ["a field that is not on the stack", "escalations", "1", /Pick what to type/]]) {
  r = await save(TE, "Bilal Bright", field, value); ok(why + " is refused", !r.ok && r.status === 400 && re.test(r.e), r);
}
r = await save(TE, "Asha Able", "achieved", "300"); ok("Achieved is never typed over what Brahmastra works out (Asha is counted by Team status)", !r.ok && /works out Asha Able's productivity/.test(r.e), r);
r = await save(TE, "Lena Lake", "pkt", "90"); ok("a team lead cannot type for another team lead's team", !r.ok && r.status === 403, r);
r = await save(TE, "Tess Lead", "th1", "yes"); ok("nor tick a team lead's tick (that is the manager's)", !r.ok && r.status === 403, r);
r = await save(SI, "Asha Able", "pkt", "90"); ok("an SME types nothing", !r.ok && r.status === 403, r);
r = await save(ASHA, "Asha Able", "pkt", "100"); ok("nor does an associate, not even their own", !r.ok && r.status === 403, r);
for (const [n, f, v, note] of [["Bilal Bright", "pkt", "94.5"], ["Bilal Bright", "quality", "94.51"], ["Chen Calm", "tp", "no", "Did not help on the backlog"], ["Dora Desk", "achieved", "230"], ["Dora Desk", "expected", "200"],
  ["Dora Desk", "quality", "99"], ["Dora Desk", "pkt", "99.51"]]) { r = await save(TE, n, f, v, note); ok(`the team lead types ${n}'s ${f}: ${v}`, r.ok, r); }
for (const [n, f, v] of [["Lena Lake", "pkt", "96"], ["Lena Lake", "quality", "97"], ["Omar Oak", "pkt", "85"], ["Omar Oak", "quality", "85"]]) { r = await save(LA, n, f, v); ok(`Lara types ${n}'s ${f}: ${v}`, r.ok, r); }
r = await save(TE, "Jo Joiner", "pkt", "50"); r = await save(TE, "Jo Joiner", "pkt", ""); ok("an empty value takes a typed one back", r.ok && r.r.value === "", r);
let te = await TE("stack.month", { month: OCT });
asha = byName(te, "Asha Able");
ok("the team lead sees her own team only (5), and no team lead row while October is a draft", te.rows.length === 5 && te.rows.every((x) => x.lead_name === "Tess Lead") && te.tls.length === 0 && !te.manager && !te.can_lock, te.rows.map((x) => x.name));
ok("Asha with her typed values: PKT 100% (2), quality 98.6% (8), Team player Yes with the reason, each with who and when", asha.pkt === 1 && asha.s.pkt === 2 && asha.quality === 0.986 && asha.s.qual === 8 && asha.tp_typed.note === "Covered the team's deficit, mentoring" && asha.pkt_typed.by === "Tess Lead" && asha.pkt_typed.at === IST(2026, 11, 12, 15), pick(asha, ["pkt", "quality", "pkt_typed", "tp_typed"]));
ok("Asha: 10 + 8 + 10 + 4.5 + 5 = 37.5 of 40, 93.75%: Stack 5", asha.s.others === 4.5 && asha.s.total === 37.5 && asha.s.pct === 0.9375 && asha.s.stack === 5, asha.s);
const B2 = byName(te, "Bilal Bright"), C2 = byName(te, "Chen Calm"), D2 = byName(te, "Dora Desk"), J2 = byName(te, "Jo Joiner");
ok("Bilal: 6 + 8 (94.51%) + 10 + 2.5 (PKT 94.5% is 0.5) + 3 = 29.5, 73.75%: Stack 3", B2.s.qual === 8 && B2.s.pkt === 0.5 && B2.s.total === 29.5 && B2.s.stack === 3, B2.s);
ok("Chen: Team player No (0, with the reason): 2 + 0 + 0 + 1.5 + 5 = 8.5: Stack 0", C2.tp === false && C2.tp_typed.note === "Did not help on the backlog" && C2.s.total === 8.5 && C2.s.stack === 0, C2.s);
ok("Dora: typed 230 of 200 (115%, 10), 99% (10), PKT 99.51% (2): 38 of 40, 95%: Stack 5", D2.achieved === 230 && D2.expected === 200 && D2.s.prod === 10 && D2.s.qual === 10 && D2.s.pkt === 2 && D2.s.total === 38 && D2.s.stack === 5 && !D2.to_enter.length, D2.s);
ok("Jo: 8 + 0 + 10 + 3 + 5 = 26 of 40, exactly 65%: Stack 1", J2.s.total === 26 && J2.s.pct === 0.65 && J2.s.stack === 1, J2.s);
ok("ranked by percentage: Dora, Asha, Bilal, Jo, Chen", te.rows.map((x) => x.rank + " " + x.name.split(" ")[0]).join() === "1 Dora,2 Asha,3 Bilal,4 Jo,5 Chen", te.rows.map((x) => x.rank + x.name));

S("The team lead stack: the manager's ticks and the attrition");
r = await save(MO, "Tess Lead", "th1", "yes"); ok("the manager ticks Tess's first Team handling tick", r.ok && r.r.by === "Mona Manager", r);
for (const k of ["th2", "th3", "th4", "cf1", "cf2", "cf3", "cf4", "cf5"]) await save(MO, "Tess Lead", k, "yes");
r = await save(MO, "Tess Lead", "th5", "no"); ok("and marks one No", r.ok && r.r.value === "no", r);
r = await save(MO, "Tess Lead", "th5", "perhaps"); ok("a tick is Yes or No", !r.ok && /Yes or No/.test(r.e), r);
r = await save(MO, "Mona Manager", "th1", "yes"); ok("a manager does not tick her own row", !r.ok && r.status === 403, r);
r = await save(MO, "Asha Able", "th1", "yes"); ok("an associate has no ticks", !r.ok && /has no team on the Stack report/.test(r.e), r);
r = await save(MO, "Tess Lead", "attrition", "3"); ok("Tess's attrition is not typed: Brahmastra counts Gus (exit date Oct 20)", !r.ok && /counts who left Tess Lead's team itself \(1 in October 2026\)/.test(r.e), r);
mo = await MO("stack.month", { month: OCT });
let tess = tlOf(mo, "Tess Lead"), lara = tlOf(mo, "Lara Lead");
ok("the manager sees both team lead rows", mo.tls.length === 2 && tess && lara, mo.tls.map((x) => x.name));
ok("Tess: productivity is the team's average (103.6%: 10), quality the average of those with one (97.37%: 8)", tess.team_n === 5 && Math.abs(tess.prod - (1.13 + 194 / 195 + 0.905 + 1.15 + 1) / 5) < 1e-12 && tess.s.prod === 10 && tess.qual_n === 3 && Math.abs(tess.quality - (0.986 + 0.9451 + 0.99) / 3) < 1e-12 && tess.s.qual === 8, pick(tess, ["prod", "quality", "qual_n"]));
ok("Tess: shrinkage averaged over the whole team (3.33%: 10), Gus left (1: 4), adherence 2 + 3 + 1 = 6 (4)", Math.abs(tess.shrink - (3.5 / 21) / 5) < 1e-12 && tess.s.shrink === 10 && tess.attrition === 1 && tess.left[0].name === "Gus Gone" && tess.left[0].day === D(10, 20) && tess.s.attr === 4 && tess.adherence === 6 && tess.s.adh === 4, pick(tess, ["shrink", "attrition", "left", "adherence"]));
ok("Tess: 4 + 5 ticks, the addition point is the average Stack (5 + 3 + 0 + 5 + 1) / 5 = 2.8", tess.s.th === 4 && tess.s.cf === 5 && tess.ticks.th1.by === "Mona Manager" && tess.ticks.th5.v === "no" && Math.abs(tess.addition - 2.8) < 1e-12, pick(tess, ["ticks", "addition"]));
ok("Tess: 10 + 8 + 10 + 4 + 4 + 4 + 5 + 2.8 = 47.8 of 50, 95.6%: Stack 4 (just under 96%)", Math.abs(tess.s.total - 47.8) < 1e-9 && tess.s.stack === 4 && !tess.to_enter.length, tess.s);
ok("Lara: Uma was switched off with no exit date and worked in October, so Brahmastra cannot tell: attrition to enter", lara.left_unknown.join() === "Uma Unknown" && lara.to_enter.includes("attrition") && lara.attrition === 0, pick(lara, ["attrition", "left_unknown", "to_enter"]));
r = await save(LA, "Lara Lead", "attrition", "1"); ok("a team lead does not type the attrition", !r.ok && r.status === 403, r);
r = await save(MO, "Lara Lead", "attrition", "1.5"); ok("the attrition is a whole number", !r.ok && /number of people who left/.test(r.e), r);
r = await save(MO, "Lara Lead", "attrition", "1"); ok("the manager types it", r.ok, r);
mo = await MO("stack.month", { month: OCT }); lara = tlOf(mo, "Lara Lead");
ok("Lara: 6 + 0 + 10 + 4 + 5 + 0 + 0 + 2 = 27 of 50, 54%: Stack 0; ten ticks still to confirm", lara.attrition === 1 && lara.attrition_typed.by === "Mona Manager" && lara.s.total === 27 && lara.s.stack === 0 && lara.to_enter.length === 10, { s: lara.s, te: lara.to_enter });
ok("the manager's to-enter list: Jo's and Chen's PKT and quality, and Lara's ten ticks", mo.to_enter.pkt === 2 && mo.to_enter.quality === 2 && mo.to_enter.prod === 0 && mo.to_enter.ticks === 10 && mo.to_enter.attrition === 0, mo.to_enter);
ok("team leads ranked by percentage: Tess, then Lara", mo.tls.map((x) => x.rank + " " + x.name).join() === "1 Tess Lead,2 Lara Lead", mo.tls.map((x) => x.name));
const vi = await VI("stack.month", { month: OCT });
ok("the VP sees every team in her span", ["Asha Able", "Lena Lake", "Omar Oak"].every((n) => byName(vi, n)) && vi.tls.length >= 2 && vi.manager, vi.rows.map((x) => x.name));

S("This month, still under way");
const nov = await MO("stack.month", { month: "2026-11" });
const an = byName(nov, "Asha Able");
ok("November so far counts the finished days (up to Nov 11): Asha's 7 working days (Nov 9 is Diwali)", nov.current && nov.through === D(11, 11) && an.working === 7 && an.tos === 480, pick(an, ["working", "tos"]));
r = await T(() => MO("stack.lock", { month: "2026-11" }));
ok("November cannot be locked before it is over", !r.ok && /November 2026 can be locked once it is over, from Dec 1/.test(r.e), r);

S("Lock the month");
r = await T(() => TE("stack.lock", { month: OCT })); ok("a team lead cannot lock", !r.ok && r.status === 403, r);
r = await T(() => MO("stack.lock", { month: OCT }));
ok("the manager locks October: 2 teams, 7 people", r.ok && r.r.locked === 2 && r.r.people === 7, r);
const audLock = (await rows("SELECT * FROM audit_log WHERE action = 'stack.lock'"))[0];
ok("the lock is in the audit trail", audLock && /October 2026 locked: 2 teams, 7 people \(/.test(audLock.detail) && audLock.user_name === "Mona Manager", audLock);
r = await T(() => MO("stack.lock", { month: OCT })); ok("locking again finds nothing left to lock", !r.ok && /already locked/.test(r.e), r);
// after the lock, the work and the typed values move on: the locked month does not
await work("Bilal Bright", 2, 20);
await sql("UPDATE stack_typed SET value = '0.5' WHERE field = 'pkt' AND subject_id = ?", tid("Asha Able"));
mo = await MO("stack.month", { month: OCT });
asha = byName(mo, "Asha Able");
ok("a locked month shows its snapshot: Bilal still 194, Asha's PKT still 100%", byName(mo, "Bilal Bright").achieved === 194 && asha.pkt === 1 && asha.s.stack === 5 && asha.locked && !asha.can_edit, pick(asha, ["pkt", "locked", "can_edit"]));
ok("Locked by Mona Manager, every team locked, nothing to lock, no ticks open", mo.lock.locked === 2 && mo.lock.teams === 2 && mo.lock.by[0].name === "Mona Manager" && mo.lock.by[0].at === IST(2026, 11, 12, 15) && !mo.can_lock && mo.tls.every((x) => !x.can_tick), mo.lock);
r = await save(TE, "Chen Calm", "pkt", "90"); ok("typed cells are closed: the team lead cannot type", !r.ok && /October 2026 is locked for Chen Calm/.test(r.e), r);
r = await save(MO, "Lara Lead", "th1", "yes"); ok("nor the manager tick", !r.ok && /locked for Lara Lead's team/.test(r.e), r);
te = await TE("stack.month", { month: OCT });
ok("the team lead now sees her own team lead row, and no one else's", te.tls.length === 1 && te.tls[0].name === "Tess Lead" && te.tls[0].locked, te.tls.map((x) => x.name));
mo = await MO("stack.month", {});
ok("with October locked, the manager's page opens on November", mo.month === "2026-11", mo.month);

S("An associate's own stack: locked months only");
let mine = await ASHA("stack.mine", {});
ok("Asha sees her October: Stack 5, 37.5 of 40, locked by Mona Manager", mine.months.length === 1 && mine.months[0].month === OCT && mine.months[0].row.s.stack === 5 && mine.months[0].row.s.total === 37.5 && mine.months[0].locked_by === "Mona Manager", mine.months.map((m) => [m.month, m.row.name]));
ok("only her own row: nobody else's name or numbers", JSON.stringify(mine).indexOf("Bilal") < 0 && JSON.stringify(mine).indexOf("Chen Calm") < 0 && mine.months[0].row.id === tid("Asha Able"), JSON.stringify(mine).length);
mine = await BI("stack.mine", {}); ok("Bilal sees his own October", mine.months.length === 1 && mine.months[0].row.name === "Bilal Bright" && mine.months[0].row.s.stack === 3, mine.months.length);
mine = await TE("stack.mine", {}); ok("a team lead has no associate row of her own", mine.months.length === 0, mine);

S("Unlock: the admin only");
r = await T(() => MO("stack.unlock", { month: OCT })); ok("the manager cannot unlock", !r.ok && r.status === 403, r);
r = await T(() => AD("stack.unlock", { month: OCT })); ok("the admin unlocks October", r.ok && r.r.unlocked === 2, r);
const audUn = (await rows("SELECT * FROM audit_log WHERE action = 'stack.unlock'"))[0];
ok("the unlock is in the audit trail, with who had locked it", audUn && /October 2026 unlocked: 2 teams \(locked by Mona Manager on Nov 12\)/.test(audUn.detail), audUn);
mo = await MO("stack.month", { month: OCT });
ok("a draft again: Bilal's later work counts now (214 of 195), Asha's changed PKT too", byName(mo, "Bilal Bright").achieved === 214 && byName(mo, "Asha Able").pkt === 0.5 && mo.lock.locked === 0 && mo.can_lock, pick(byName(mo, "Bilal Bright"), ["achieved"]));
mine = await ASHA("stack.mine", {}); ok("and Asha's My stack no longer has October", mine.months.length === 0, mine.months.length);
r = await T(() => AD("stack.unlock", { month: OCT })); ok("unlocking a month that is not locked is refused", !r.ok && /is not locked/.test(r.e), r);

S("A month with nothing in it yet");
clock(IST(2026, 12, 1, 9));
await sql("UPDATE sessions SET expires_at = ?", IST(2027, 6, 1));
const dec = await MO("stack.month", { month: "2026-12" });
ok("on Dec 1, December has no finished day yet: nothing to show", dec.rows.length === 0 && dec.tls.length === 0 && dec.current, pick(dec, ["through", "current"]));
clock(IST(2026, 11, 12, 15));

S("Back in Shastra: the day kept is cleared");
FEED = FEED.map((f) => (f.name === "Gus Gone" ? { ...f, status: "Working", exit_date: null } : f));
await AD("roster.syncShastra");
const gus2 = (await rows("SELECT active, off_at FROM users WHERE name = 'Gus Gone'"))[0];
ok("Gus is back: active, no switched-off day", gus2.active === 1 && gus2.off_at === null, gus2);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
