// Portfolio & SLA: Drishti's scorecard read by Brahmastra (Drishti's overview answered by a stand-in), scored with
// Drishti's own rules; the Portfolio carries each client's score; the scorecard page's figures, formulas, sources,
// trend and period picking; the month-end SLA tick from the score; who may see what; Drishti down or not connected.
// Also the Claims CSVs in the Production Conso layout, the Entries filter by biller, and the team lead's own desk count.
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Joseph Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
];
// Drishti's answer to "overview": two clients named as Brahmastra's, with the short copies of their periods (made-up figures)
const cell = (value, extra) => ({ value, method: "upload", ...(extra || {}) });
const month = (id, label, from, to, ar, sub, pp, sla, createdBy) => ({ id, kind: "month", label, range: { from, to }, numDays: 31, createdAt: to + "T09:00:00.000Z", createdBy: createdBy || "leo@purview-healthcare.com",
  scopes: { ar: { crit: ar }, submission: { crit: sub }, pp: { crit: pp }, sla: { tasks: sla } }, reports: { inventory: { stub: true, fileName: "AR Inventory report - " + label + ".xlsx" } } });
const OCT = month("p-oct", "October 2026", "2026-10-01", "2026-10-31",
  { arAging: cell(0.18, { reason: "Two payers hold 70% of the old balance" }), collectionRate: cell(0.91, { method: "manual" }), denialRate: cell(0.124, { reason: "CO-16 missing information" }), daysInAR: cell(28), appeal: cell(0.04), quality: cell(0.965), escalations: cell(0) },
  { cleanClaim: cell(0.842, { reason: "Payer ID and modifier errors" }), submissionTAT: cell("Met", { method: "manual" }), rejectionRate: cell(0.021) },
  { ppTAT: cell("Met", { method: "manual" }), paymentCycle: cell(21), varianceRate: cell(0.012) },
  [{ name: "Production SLA", target: "1,380", received: 1380, achieved: 1420, comment: "" }]);
const SEP = month("p-sep", "September 2026", "2026-09-01", "2026-09-30",
  { arAging: cell(0.16), collectionRate: cell(0.88), denialRate: cell(0.09), daysInAR: cell(31), appeal: cell(0.03), quality: cell(0.99), escalations: cell(1) },
  { cleanClaim: cell(0.93), submissionTAT: cell("Met"), rejectionRate: cell(0.03) }, { ppTAT: cell("Not Met"), paymentCycle: cell(26), varianceRate: cell(0.02) },
  [{ name: "Production SLA", target: "1,300", received: 1300, achieved: 1250 }]);
const AUG = month("p-aug", "August 2026", "2026-08-01", "2026-08-31", { arAging: cell(0.2), collectionRate: cell(0.8) }, { cleanClaim: cell(0.85) }, {}, []);
const WEEK = { id: "p-w44", kind: "week", label: "Week of 26 Oct 2026", range: { from: "2026-10-26", to: "2026-11-01" }, numDays: 7, createdAt: "2026-11-02T09:00:00.000Z", createdBy: "", scopes: { ar: { crit: { arAging: cell(0.14), collectionRate: cell(0.9) } } }, reports: {} };
const FUTURE = month("p-dec", "December 2026", "2026-12-01", "2026-12-31", { arAging: cell(0.1) }, {}, {}, []);
let DR_CLIENTS = [
  { id: "d-sun", name: "Sunrise Eye Care", ownerId: "u1", ownerName: "Tina Lead", scopes: ["ar", "submission", "pp"], rules: {}, periods: [OCT, SEP, AUG, WEEK, FUTURE] },
  { id: "d-lake", name: "Lakeview Dental Group", ownerId: "u2", ownerName: "Leo Lead", scopes: ["ar", "submission"], rules: { "ar.arAging": { good: 0.2, fair: 0.25 } },
    periods: [month("p-l-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.18), collectionRate: cell(0.7) }, { cleanClaim: cell(0.95) }, {}, [])] },
  { id: "d-x", name: "Nobody In Brahmastra", ownerId: "u2", ownerName: "Leo Lead", scopes: ["ar"], rules: {}, periods: [], archived: false },
];
let drCalls = 0, drDown = false;
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("supabase.co")) return new Response(JSON.stringify({ code: "PGRST202", message: "not set up" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (url.includes("script.google.com")) {
    drCalls++; if (drDown) throw new Error("ECONNRESET");
    const body = JSON.parse((init && init.body) || "{}");
    if (body.a === "overview") return new Response(JSON.stringify({ ok: true, value: DR_CLIENTS }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: false, error: "not in the stand-in", code: "bad" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY, DRISHTI_TOKEN_SECRET: "s".repeat(40) }, fetchMock });
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => ((await DB.prepare(q).bind(...a).all()).results || []);
const fresh = () => sql("DELETE FROM settings WHERE key = 'drishti_sync'");
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"), VP = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const clients = (await A("clients.list")).clients; const sunrise = clients.find((c) => /Sunrise/.test(c.name)), lake = clients.find((c) => /Lakeview/.test(c.name)), other = clients.find((c) => !/Sunrise|Lakeview/.test(c.name));
const TODAY = { today: "2026-11-04" };
let r, it;
const find = (d, key) => d.items.find((x) => x.key === key);

S("Who may see the scorecard");
r = await T(() => AR("sla.summary", TODAY)); ok("billers cannot", !r.ok, r);
r = await T(() => LE("sla.scorecard", { client_id: sunrise.id, ...TODAY })); ok("a team lead cannot open another team's client", !r.ok, r);
r = await TI("sla.summary", TODAY); ok("a team lead sees their own clients only", r.state === "ok" && r.rows.every((x) => x.client_id === sunrise.id || !x.matched || x.client_id !== lake.id), r.rows.map((x) => x.client));

S("The Portfolio: Drishti's latest month score per client");
r = await VP("sla.summary", TODAY);
const sun = r.rows.find((x) => x.client_id === sunrise.id), lk = r.rows.find((x) => x.client_id === lake.id);
ok("Sunrise matched by name, scored on October (the latest finished month; December is still to come)", sun && sun.matched && sun.period && sun.period.label === "October 2026" && sun.period.kind === "month", sun);
ok("the score is the green share of everything scored, with its band", sun && sun.score === Math.round(sun.counts.ok / (sun.counts.ok + sun.counts.warn + sun.counts.miss) * 100) && ["ok", "warn", "miss"].includes(sun.band), sun && [sun.score, sun.counts, sun.band]);
ok("the change against September", sun && typeof sun.delta === "number", sun && sun.delta);
ok("the scopes and what pulls it down travel with it", sun && sun.scopes.some((x) => x.short === "AR") && sun.drags.some((x) => x.name === "AR Aging" && x.status === "miss"), sun && { scopes: sun.scopes, drags: sun.drags });
ok("Lakeview: its own rule override makes 18% AR aging green", lk && lk.matched && !lk.drags.some((x) => x.name === "AR Aging"), lk && lk.drags);
ok("a client Drishti does not know is listed unmatched", other ? r.rows.some((x) => x.client_id === other.id && !x.matched) : true);
ok("totals: the average, the bands and the red KPIs by name", r.totals.avg != null && r.totals.bands.ok + r.totals.bands.warn + r.totals.bands.miss === 2 && r.totals.red > 0 && r.totals.red_names.includes("AR Aging"), r.totals);
const c0 = drCalls; await VP("sla.summary", TODAY); ok("Drishti is asked once per ten minutes", drCalls === c0);
r = await VP("portfolio.overview", TODAY);
const pr = r.rows.find((x) => x.client_id === sunrise.id);
ok("the Portfolio rows carry Drishti's score, band, scopes and drags", pr && pr.drishti && pr.drishti.score === sun.score && pr.drishti.band === sun.band && pr.drishti.scopes.length >= 3, pr && pr.drishti);
ok("and the totals: the average, bands and KPIs in the red", r.drishti && r.drishti.state === "ok" && r.drishti.avg != null && r.drishti.red > 0, r.drishti);
ok("the month-end SLA is scored from Drishti (no 'not scored yet' for Sunrise)", pr.sla && pr.sla.score === sun.score && !r.freshness.some((f) => f.client_id === sunrise.id && /SLA/.test(f.text)), { sla: pr.sla, fresh: r.freshness });

S("Month-end: the SLA step ticks itself, a score typed by hand stays");
let me = await rows("SELECT month, score, auto, done_by_name FROM client_monthend WHERE client_id = ? AND step = 'sla'", sunrise.id);
ok("Sunrise October: ticked by Drishti with the score", me.some((x) => x.month === "2026-10" && x.score === sun.score && x.auto === 1 && x.done_by_name === "Drishti"), me);
await LE("monthend.set", { client_id: lake.id, month: "2026-10", step: "sla", done: true, score: 77 });
await VP("sla.summary", TODAY);
me = await rows("SELECT score, auto FROM client_monthend WHERE client_id = ? AND step = 'sla' AND month = '2026-10'", lake.id);
ok("Lakeview October typed as 77 stays 77", me.length === 1 && me[0].score === 77 && me[0].auto === 0, me);

S("The scorecard page: one client, one period, every KPI with its formula");
r = await TI("sla.scorecard", { client_id: sunrise.id, ...TODAY });
ok("October by default, compared with September, with the periods to pick from", r.state === "ok" && r.period.label === "October 2026" && r.prev && r.prev.label === "September 2026" && r.periods.some((p) => p.kind === "week") && !r.periods.some((p) => p.label === "December 2026"), { p: r.period, prev: r.prev, n: r.periods.length });
it = find(r, "arAging"); ok("AR aging 18% is red against 15%, with Drishti's formula, source and the comment", it && it.status === "miss" && it.shown === "18%" && it.target === "≤ 15%" && it.formula === "Balance in >90-day buckets ÷ Total AR balance × 100" && it.source === "AR Inventory report" && /Two payers/.test(it.reason), it);
it = find(r, "collectionRate"); ok("collection rate 91% green; typed in place of the file says so", it && it.status === "ok" && it.shown === "91%" && /Typed in by the supervisor/.test(it.source) && /Payments ÷ \(Charges − Contractual Adjustments\)/.test(it.formula), it);
it = find(r, "cleanClaim"); ok("clean claim 84.2% amber (90 green, 80 amber), the formula book's formula", it && it.status === "warn" && it.shown === "84.2%" && it.formula === "(Submitted − Rejected − Denied) ÷ Submitted × 100", it);
it = find(r, "quality"); ok("quality 96.5% amber (98 green, 95 amber)", it && it.status === "warn", it);
it = find(r, "submissionTAT"); ok("a Met / Not met KPI: green, standard Met, typed", it && it.status === "ok" && it.target === "Met" && it.source === "Typed in by the supervisor", it);
it = find(r, "daysInAR"); ok("days in AR 28 green against 30, shown in days", it && it.status === "ok" && it.shown === "28 days" && it.target === "≤ 30 days", it);
it = find(r, "task:Production SLA"); ok("the SLA task: 1,420 of 1,380 is 103%, green", it && it.status === "ok" && it.shown === "103%" && it.kind === "SLA", it);
ok("the scopes: AR, Submission, Payment Posting and SLA tasks with their bands", r.scopes.map((x) => x.short).join() === "AR,Submission,Payment Posting,SLA" && r.scopes.every((x) => x.pct != null), r.scopes.map((x) => [x.short, x.pct, x.band]));
ok("the score, counts and the change from September add up", r.score === sun.score && r.counts.ok + r.counts.warn + r.counts.miss === r.scored && r.delta === r.score - r.prev.pct, { s: r.score, c: r.counts, d: r.delta, prev: r.prev.pct });
ok("what pulls it down: red first, then amber", r.drags.length >= 3 && r.drags[0].status === "miss" && r.drags.every((x, i) => i === 0 || x.status !== "miss" || r.drags[i - 1].status === "miss"), r.drags.map((x) => [x.name, x.status]));
ok("the trend: August, September, October", r.trend.map((x) => x.label).join() === "August 2026,September 2026,October 2026" && r.trend.every((x) => x.pct != null), r.trend);
ok("where the figures come from, grouped by report", r.sources.some((x) => x.from === "AR Inventory report" && x.metrics.includes("AR Aging")) && r.period.reports.some((x) => /AR Inventory report/.test(x.file)), r.sources);
r = await TI("sla.scorecard", { client_id: sunrise.id, to: "2026-09-30", ...TODAY }); ok("another period can be picked", r.period.label === "September 2026" && r.prev && r.prev.label === "August 2026");
r = await TI("sla.scorecard", { client_id: sunrise.id, kind: "week", ...TODAY }); ok("weekly picks the latest week", r.period.kind === "week" && r.period.label === "Week of 26 Oct 2026" && !r.prev, r.period);
r = await TI("sla.scorecard", { client_id: sunrise.id, kind: "latest", ...TODAY }); ok("Latest is the newest finished period of any kind", r.period.kind === "week", r.period);
if (other) { r = await VP("sla.scorecard", { client_id: other.id, ...TODAY }); ok("a client Drishti does not know: says so, and names Drishti's clients", r.state === "unmatched" && r.others.includes("Sunrise Eye Care"), r); }

S("Drishti down, or not connected");
drDown = true; await fresh();
r = await VP("sla.summary", TODAY); ok("Drishti not answering: an error state, nobody scored", r.state === "error" && r.rows.every((x) => !x.matched), r.state);
r = await VP("portfolio.overview", TODAY); ok("the Portfolio still opens, without Drishti's column", r.rows.length > 0 && r.rows.every((x) => !x.drishti) && r.drishti.state === "error", r.drishti);
drDown = false; await fresh();
r = await VP("sla.scorecard", { client_id: sunrise.id, ...TODAY }); ok("back up: the scorecard reads again", r.state === "ok", r.state);

S("Claims CSVs in the Production Conso layout; Entries by biller; the team lead's own desk");
const claims = (await TI("claims.list", { client_id: sunrise.id, state: "", page_size: 50 })).rows;
const saag = { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" };
await TI("alloc.reassign", { ids: [claims[0].id, claims[1].id], user_id: U("Arun Agent").id });
await AR("queue.complete", { id: claims[0].id, saag, note: { source: "Portal", findings: "In process per the payer portal", action: "follow up later" } });
r = await TI("reports.claimsProduction", { client_id: sunrise.id, state: "" });
ok("the header is the Production Conso's 31 columns", r.header.length === 31 && r.header[0] === "Sr. No" && r.header.includes("Associate Name") && r.header[r.header.length - 1] === "Week", r.header.slice(0, 6));
ok("one row per claim, every page", r.rows.length === r.total && r.total === (await TI("claims.list", { client_id: sunrise.id, state: "", page_size: 10 })).total, [r.rows.length, r.total]);
const iStatus = r.header.indexOf("Status"), iAssoc = r.header.indexOf("Associate Name"), iClaim = r.header.indexOf("IG Claim ID#/Charge ID#");
const worked = r.rows.find((x) => x[iClaim] === claims[0].claim_no), unworked = r.rows.find((x) => x[iClaim] === claims[1].claim_no);
ok("a worked claim carries its last entry and who worked it", worked && worked[iStatus] === "Claim In Process" && worked[iAssoc] === "Arun Agent", worked);
ok("a claim nobody worked has the work columns blank", unworked && unworked[iStatus] === "" && unworked[iAssoc] === "", unworked);
r = await TI("reports.production", { scope: "ar", client_id: sunrise.id, user_id: U("Arun Agent").id, from_ms: 0, to_ms: Date.now() + 1e7 });
ok("Entries by one biller: only Arun's entries, same columns", r.rows.length === 1 && r.rows[0][iAssoc] === "Arun Agent" && r.header.length === 31, r.rows.length);
r = await TI("reports.production", { scope: "ar", client_id: sunrise.id, user_id: U("Tina Lead").id, from_ms: 0, to_ms: Date.now() + 1e7 }); ok("and nothing for someone who wrote none", r.rows.length === 0);
r = await TI("attention.count"); ok("a team lead with no claims on their desk: My desk 0", r.my_desk === 0, r.my_desk);
await TI("alloc.reassign", { ids: [claims[2].id], user_id: U("Tina Lead").id });
r = await TI("attention.count"); ok("with a claim allocated to them: 1 (the My desk entry shows)", r.my_desk === 1, r.my_desk);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
