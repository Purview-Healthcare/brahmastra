import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "18:30-03:30", location: "Pune", doj: "2026-03-01", exit_date: null, email: "", ...o });
let feed = [
  P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", reports_to: "Mo Manager", email: "tina@purview-healthcare.com", doj: "2023-04-10" }),
  P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "E3", name: "Bela Agent", email: "bela@purview-healthcare.com" }),
  P({ emp_id: "E4", name: "Snail Post", department: "Posting", reports_to: "Paula PostLead", email: "snail@purview-healthcare.com" }),
  P({ emp_id: "E5", name: "Mark Sub", department: "Submission", reports_to: "Paula PostLead", email: "mark@purview-healthcare.com" }),
  P({ emp_id: "E6", name: "Paula PostLead", position: "Team Lead", department: "Posting", reports_to: "Mo Manager", email: "paula@purview-healthcare.com" }),
  P({ emp_id: "E7", name: "Eve Ev", department: "Eligibility Verification", email: "eve@purview-healthcare.com" }),
  P({ emp_id: "E8", name: "Pat Pcc", department: "PCC", email: "pat@purview-healthcare.com" }),
  P({ emp_id: "E9", name: "Ava Both", department: "Eligibility Verification", also_in_departments: "AR", email: "ava@purview-healthcare.com" }),
  P({ emp_id: "E10", name: "Mo Manager", position: "Manager", department: "All", project: "", reports_to: "", email: "mo@purview-healthcare.com" }),
  P({ emp_id: "E11", name: "Quinn Both", department: "Posting", also_in_departments: "Submission", reports_to: "Paula PostLead", email: "quinn@purview-healthcare.com" }),
];
let feedMode = "ok";
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) {
    const b = JSON.parse(init.body || "{}");
    if (feedMode === "down") throw new Error("network down");
    if (b.p_key !== FEED_KEY) return new Response(JSON.stringify({ ok: false, error: "Not allowed" }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, rows: feedMode === "empty" ? [] : feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig;
const T = (fn) => tryOp(fn);

S("Demo setup and admin sign-in");
const admin = await rig.app.seedDemo(() => {});
const ADMIN = rig.app.TOKEN_FOR_TEST || null;
const login = async (email, pw) => (await as(null)("auth.login", { email, passHash: await sha(pw) }));
const adm = await login("supervisor@purview-healthcare.com", "brahmastra-demo"); const A = as(adm.token);
ok("admin signs in", adm.user && adm.user.is_admin);
const bad = await T(async () => login("supervisor@purview-healthcare.com", "wrong-password"));
ok("wrong password refused", !bad.ok && bad.status === 401, bad);
ok("meta.info answers", (await A("meta.info")).app === "brahmastra-api");
const cl = (await A("clients.list")).clients; const sunrise = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
ok("two demo clients", sunrise && lake, cl.map((c) => c.name));

S("Settings: theme, text size, sessions, password");
let r = await T(async () => A("auth.savePrefs", { theme: "navy", text: "large" }));
ok("save theme navy + large text", r.ok && r.r.prefs.theme === "navy" && r.r.prefs.text === "large", r);
r = await T(async () => A("auth.savePrefs", { theme: "purple" })); ok("unknown theme refused", !r.ok, r);
ok("prefs come back on auth.me", (await A("auth.me")).user.prefs.theme === "navy");
const adm2 = await login("supervisor@purview-healthcare.com", "brahmastra-demo");
ok("second device counted", (await A("auth.sessions")).others >= 1);
r = await A("auth.signOutOthers"); ok("sign out everywhere else", r.ended >= 1, r);
r = await T(async () => as(adm2.token)("auth.me")); ok("other device is signed out", !r.ok && r.status === 401, r);
r = await T(async () => A("auth.changePassword", { oldHash: await sha("nope-nope"), newHash: await sha("new-password-1") })); ok("change password with wrong current refused", !r.ok, r);
r = await T(async () => A("auth.changePassword", { oldHash: await sha("brahmastra-demo"), newHash: await sha("new-password-1") })); ok("change password", r.ok, r);
r = await T(async () => login("supervisor@purview-healthcare.com", "new-password-1")); ok("signs in with the new password", r.ok, r);
await A("auth.changePassword", { oldHash: await sha("new-password-1"), newHash: await sha("brahmastra-demo") });

S("Roster from Purview Shastra");
feedMode = "empty"; r = await T(async () => A("roster.syncShastra")); ok("empty Shastra answer changes nothing", !r.ok && /sent 0 people/.test(r.e), r);
feedMode = "down"; r = await T(async () => A("roster.syncShastra")); ok("Shastra unreachable is reported", !r.ok, r);
feedMode = "ok"; r = await T(async () => A("roster.syncShastra"));
ok("sync works", r.ok && r.r.synced, r);
const sm = r.ok ? r.r.summary : {};
ok("EV-only and PCC-only get no access", r.ok && r.r.excluded.some((x) => x.name === "Eve Ev" && /Eligibility/.test(x.reason)) && r.r.excluded.some((x) => x.name === "Pat Pcc" && /PCC/.test(x.reason)), r.ok && r.r.excluded);
ok("EV + AR keeps access", r.ok && r.r.people.some((p) => p.name === "Ava Both" && p.active), r.ok && r.r.people.map((p) => p.name));
const meta = await A("roster.meta"); ok("roster.meta shows the last sync", meta.shastra && meta.shastra.connected && meta.shastra.last && meta.shastra.last.ok, meta.shastra);
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
ok("date of joining kept", U("Tina Lead") && U("Tina Lead").doj === "2023-04-10", U("Tina Lead"));
ok("Tina is a team lead", U("Tina Lead") && U("Tina Lead").role === "supervisor");
ok("Mo Manager gets access", U("Mo Manager") && U("Mo Manager").active);
ok("reports_to set", U("Arun Agent") && U("Arun Agent").reports_to === (U("Tina Lead") || {}).id, U("Arun Agent"));
r = await T(async () => A("roster.import", { rows: [] })); ok("file upload of the roster is gone", !r.ok, r);
const r2 = await A("roster.syncShastra"); ok("second sync: nothing changes", r2.summary.new === 0 && r2.summary.updated === 0 && r2.summary.deactivated === 0, r2.summary);

S("First sign-in of roster people");
const firstIn = async (name, email) => { const m = (await as(null)("auth.lookup", { q: name.split(" ")[0] })).matches.find((x) => x.name === name); if (!m) return null; await as(null)("auth.firstPassword", { user_id: m.id, passHash: await sha("pass-" + name) }); return login(email, "pass-" + name); };
const tina = await firstIn("Tina Lead", "tina@purview-healthcare.com"), arun = await firstIn("Arun Agent", "arun@purview-healthcare.com"), snail = await firstIn("Snail Post", "snail@purview-healthcare.com"),
  mark = await firstIn("Mark Sub", "mark@purview-healthcare.com"), paula = await firstIn("Paula PostLead", "paula@purview-healthcare.com"), quinn = await firstIn("Quinn Both", "quinn@purview-healthcare.com");
ok("everyone signs in with a first password", tina && arun && snail && mark && paula && quinn);
r = await T(async () => as(null)("auth.firstPassword", { user_id: U("Tina Lead").id, passHash: await sha("again") })); ok("first password only once", !r.ok, r);
const TI = as(tina.token), AR = as(arun.token), SN = as(snail.token), MK = as(mark.token), PA = as(paula.token), QU = as(quinn.token);
const desk = async (X) => (await X("handoffs.count")).desk;
ok("desks: Snail posting, Mark submission, Paula posting, Quinn both, Tina none", (await desk(SN)) === "posting" && (await desk(MK)) === "submission" && (await desk(PA)) === "posting" && (await desk(QU)) === "both" && (await desk(TI)) == null,
  [await desk(SN), await desk(MK), await desk(PA), await desk(QU), await desk(TI)]);
r = await T(async () => as(null)("auth.lookup", { q: "Eve" })); ok("EV-only person cannot be found to sign in", r.ok && !r.r.matches.some((m) => m.name === "Eve Ev"), r);

const mo = await firstIn("Mo Manager", "mo@purview-healthcare.com");
ok("manager signs in", !!mo);
if (mo) { const MO = as(mo.token); const mr = await T(async () => MO("claims.list", {})); ok("manager sees his team's client (Sunrise) through Tina", mr.ok && mr.r.rows.length > 0 && mr.r.rows.every((x) => x.client_id === sunrise.id), mr.ok ? mr.r.rows.length : mr); }
S("Permissions");
r = await T(async () => AR("claims.list", {})); ok("biller cannot list all claims", !r.ok, r);
r = await T(async () => AR("users.list")); ok("biller cannot list users", !r.ok, r);
r = await T(async () => TI("roster.syncShastra")); ok("team lead cannot sync the roster (admin only)", !r.ok, r);
r = await T(async () => PA("inventory.batches", {})); ok("posting lead: no inventory", !r.ok && /AR/.test(r.e), r);
r = await T(async () => PA("alloc.apply", { client_id: sunrise.id, assignments: [] })); ok("posting lead: no allocation", !r.ok, r);
r = await T(async () => PA("claims.list", {})); ok("posting lead: claims list works but empty (nothing handed over yet)", r.ok && r.r.rows.length === 0, r.ok ? r.r.rows.length : r);
r = await T(async () => TI("claims.list", { client_id: lake.id })); ok("AR lead refused Lakeview (not their project)", !r.ok && r.status === 403, r);
r = await T(async () => TI("claims.list", {})); ok("AR lead all-claims list holds only Sunrise", r.ok && r.r.rows.every((x) => x.client_id === sunrise.id), r.ok ? [...new Set(r.r.rows.map((x) => x.client_id))] : r);
r = await T(async () => TI("claims.list", { client_id: sunrise.id })); ok("AR lead sees Sunrise claims", r.ok && r.r.rows.length > 0, r);
r = await T(async () => SN("claims.list", {})); ok("posting agent cannot list claims", !r.ok, r);

S("AR work: allocate, work, skip, escalate");
const pool = (await A("claims.list", { client_id: sunrise.id, state: "open", page_size: 50 })).rows;
ok("open claims to allocate", pool.length >= 6, pool.length);
r = await T(async () => A("alloc.reassign", { ids: pool.slice(0, 6).map((c) => c.id), user_id: U("Arun Agent").id })); ok("assign 6 claims to Arun", r.ok, r);
let q = await AR("queue.list", {}); ok("Arun's list has them", q.rows.filter((c) => pool.slice(0, 6).some((p) => p.id === c.id)).length === 6, q.rows.length);
const qs = await AR("queue.summary", {}); ok("queue summary answers", qs && typeof qs === "object");
const c1 = pool[0], c2 = pool[1], c3 = pool[2], c4 = pool[3], c5 = pool[4];
r = await T(async () => AR("queue.open", { id: c1.id })); ok("open a claim", r.ok, r);
const work = (extra) => ({ saag: { status: "Denied", sub_status: "Denied for medical necessity", action: "Need to Appeal", bucket: "Payer", effective: "Appeal" }, note: { source: "Web", findings: "Checked the payer portal, claim denied for medical necessity", action: "appeal filed", tfl: "90", afl: "180", denial_date: "2026-10-20" }, ...extra });
r = await T(async () => AR("queue.complete", { id: c1.id, ...work() })); ok("appeal without the document is refused", !r.ok && /attach|document|file/i.test(r.e), r);
await AR("attachments.add", { claim_id: c1.id, name: "appeal.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 test").toString("base64") });
r = await T(async () => AR("queue.complete", { id: c1.id, ...work() })); ok("work saved with the document", r.ok, r);
r = await T(async () => AR("queue.complete", { id: c2.id, saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, note: { source: "Call", findings: "Called the payer, claim in process", action: "called payer", ref: "", call_start: "10:00", call_end: "10:12" } }));
ok("call without a reference refused", !r.ok && /REF/.test(r.e), r);
r = await T(async () => AR("queue.complete", { id: c2.id, saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, note: { source: "Call", findings: "Called the payer, claim in process", action: "called payer", ref: "REF123", call_start: "10:00", call_end: "10:12" }, escalate: true }));
ok("call saved and escalated", r.ok, r);
r = await T(async () => AR("queue.complete", { id: c3.id, saag: { status: "x", sub_status: "", action: "" } })); ok("missing SAAG refused", !r.ok, r);
await AR("queue.open", { id: c3.id }); r = await T(async () => AR("queue.skip", { id: c3.id, reason: "Payer portal down" })); ok("skip a claim", r.ok, r);
r = await T(async () => AR("queue.complete", { id: pool[10].id, ...work() })); ok("cannot work a claim not on my desk", !r.ok, r);
const hist = await AR("history.mine", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("My work lists my entries", hist.rows.length >= 2, hist.rows.length);
const tl = await A("claims.timeline", { id: c1.id }).catch((e) => ({ err: e.message })); ok("claim timeline answers", !tl.err, tl);
const cg = await A("claims.get", { id: c1.id }); ok("claim profile answers with notes", cg && (cg.claim || cg.notes), Object.keys(cg || {}));
const lim = await A("payers.limits", {}); ok("TFL / AFL saved from the note", lim.rows.some((x) => x.tfl_days === 90 && x.afl_days === 180), lim.rows.slice(0, 3));
const ct = await A("supervisor.callTime", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("call time counted (12 min)", ct.total && ct.total.minutes === 12, ct.total);

S("Needs attention");
const att = await A("attention.list"); ok("escalated claim is listed", att.rows.some((x) => x.id === c2.id), att.rows.length);
r = await T(async () => A("attention.answer", { id: c2.id, comment: "Call again next week and ask for the reprocessing number", send_back: true })); ok("answer the escalation", r.ok, r);
ok("count goes down", (await A("attention.count")).n === 0);

S("Hand-offs to Payment posting and Submission");
r = await T(async () => A("clients.saveResponsibility", { client_id: sunrise.id, dept: "posting", mode: "person", lead: U("Snail Post").id, backup: U("Paula PostLead").id })); ok("posting person set on Sunrise", r.ok, r);
r = await T(async () => A("clients.saveResponsibility", { client_id: sunrise.id, dept: "submission", mode: "person", lead: U("Mark Sub").id })); ok("submission person set", r.ok, r);
await AR("attachments.add", { claim_id: c4.id, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 eob").toString("base64") });
r = await T(async () => AR("queue.complete", { id: c4.id, saag: { status: "Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Web", findings: "Paid, EOB downloaded from the portal", action: "eob requested" } }));
ok("biller sends a claim to posting", r.ok, r);
r = await T(async () => AR("queue.complete", { id: c5.id, saag: { status: "Rejected", sub_status: "Missing information", action: "Need to Resubmit", bucket: "Purview", effective: "Rejected" }, note: { source: "Web", findings: "Rejected for missing modifier, corrected", action: "claim corrected" } }));
ok("biller sends a claim to submission", r.ok, r);
const snCount = await SN("handoffs.count"); ok("Snail has 1 waiting", snCount.n === 1, snCount);
const mkCount = await MK("handoffs.count"); ok("Mark has 1 waiting", mkCount.n === 1, mkCount);
const snList = await SN("handoffs.list", {}); ok("Snail sees only posting", snList.rows.length === 1 && snList.rows[0].dept === "posting", snList.rows.map((h) => h.dept));
const mkList = await MK("handoffs.list", {}); ok("Mark sees only submission", mkList.rows.length === 1 && mkList.rows[0].dept === "submission", mkList.rows.map((h) => h.dept));
r = await T(async () => SN("handoffs.close", { id: snList.rows[0].id, outcome: "complete", proof: {} })); ok("posting without check number refused", !r.ok, r);
r = await T(async () => SN("handoffs.close", { id: snList.rows[0].id, outcome: "complete", proof: { date: "2026-11-01", ref: "CHK-1001", amount: 120.5 } })); ok("Snail completes the posting", r.ok, r);
r = await T(async () => MK("handoffs.close", { id: snList.rows[0].id, outcome: "complete", proof: { date: "2026-11-01", ref: "x" } })); ok("Mark cannot close a posting hand-off", !r.ok, r);
r = await T(async () => MK("handoffs.close", { id: mkList.rows[0].id, outcome: "assistance", reason: "Missing information", note: "Need the corrected NPI from the client" })); ok("old outcome 'assistance' still lands as Need assistance from AR", r.ok, r);
{ const fd = await TI("attention.fromDesks", {}); const row = fd.rows.find((x) => x.claim_id === c5.id);
  ok("the AR team lead sees it in Needs attention: Sent back by Posting / Submission, with the reason", row && row.dept === "submission" && row.reason === "Missing information" && /NPI/.test(row.note), fd.rows.length);
  ok("and it counts on the Needs attention badge", (await TI("attention.count", {})).from_desks >= 1);
  await AR("queue.complete", { id: c5.id, saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, note: { source: "Web", findings: "Asked the client for the corrected NPI" } });
  ok("once the biller saves an entry on the claim it leaves the list", !(await TI("attention.fromDesks", {})).rows.some((x) => x.claim_id === c5.id)); }
const pc = await PA("claims.list", { page_size: 500 }); ok("posting lead (backup on Sunrise) sees Sunrise's claims, the posting claim included, and no other client's", pc.rows.length > 1 && pc.rows.some((x) => x.id === c4.id) && pc.rows.every((x) => x.client_id === sunrise.id), [pc.rows.length, [...new Set(pc.rows.map((x) => x.client_id))]]);
const dash = await PA("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("posting dashboard: 1 received, 1 posted, amount", dash.totals.received === 1 && dash.totals.done === 1, dash.totals);
const dashM = await MK("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("submission dashboard for Mark", dashM.dept === "submission" && dashM.totals.received === 1, dashM.totals);
const dashQ = await QU("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("both-desk dashboard answers", dashQ.dept === "both", dashQ.dept);
const prodPP = await A("reports.production", { scope: "pp", from_ms: 0, to_ms: Date.now() + 1e7 }); ok("Production for Payment Posting has the posted claim", prodPP.rows.length === 1, prodPP.rows.length);

S("Reports");
const rw = await A("reports.work", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("Every entry lists the work with SAAG and comment", rw.rows.length >= 4 && rw.rows.every((x) => x.comment !== undefined), rw.rows.length);
const rd = await A("reports.desk", { from_ms: 0, to_ms: Date.now() + 1e7 });
const row1 = rd.rows.find((x) => x.claim_id === c1.id); ok("Team allocations: worked claim shows its latest SAAG and comment", row1 && row1.entries >= 1 && row1.status === "Denied" && row1.comment, row1);
const row6 = rd.rows.find((x) => x.claim_id === pool[5].id); ok("Team allocations: untouched claim has no entries", row6 && !row6.entries, row6);
const rdT = await TI("reports.desk", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("AR lead's Team allocations stay in scope", rdT.rows.every((x) => x.client_name === sunrise.name), [...new Set(rdT.rows.map((x) => x.client_name))]);
const pr = await A("reports.production", { scope: "ar", from_ms: 0, to_ms: Date.now() + 1e7 }); ok("AR production rows", pr.rows.length >= 4, pr.rows.length);
const inv = await A("reports.arInventory", { client_id: sunrise.id }); ok("AR inventory report", inv.rows.length > 0 && inv.header.length > 5, inv.rows.length);
r = await T(async () => A("reports.saveArInventory", { client_id: sunrise.id, name: "x", file_b64: "AAAA" })); ok("save AR inventory without Microsoft set up gives a clear error", !r.ok && /Microsoft 365 is not set up/.test(r.e), r);
r = await T(async () => A("reports.drishtiSession")); ok("Drishti sign-in without its secret gives a clear error", !r.ok && /not switched on/.test(r.e), r);
const leads = await A("reports.clientLeads"); ok("each client's team lead", leads.leads[sunrise.name] && leads.leads[sunrise.name].includes("Tina Lead"), leads.leads);
const prod = await A("supervisor.productivity", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("productivity answers", prod && (prod.rows || prod.days || prod), Object.keys(prod));
const st = await A("claims.stats", {}); ok("dashboard stats answer", st && typeof st === "object");
r = await T(async () => A("claims.setPriority", { ids: [pool[6].id], level: "top", category: "Client request", comment: "Client asked for this one first" })); ok("priority change with reason", r.ok, r);
const plog = await A("claims.priorityLog", {}); ok("priority change logged", plog.rows.length >= 1, plog);
r = await T(async () => A("claims.setState", { ids: [pool[7].id], state: "excluded" })); ok("exclude a claim", r.ok, r);
r = await T(async () => A("claims.setState", { ids: [pool[7].id], state: "open" })); ok("reopen it", r.ok, r);
r = await T(async () => A("team.saveToday", { client_id: sunrise.id, day: new Date().toISOString().slice(0, 10), on: [U("Arun Agent").id], caps: { [U("Arun Agent").id]: 30 } })); ok("save today's team", r.ok, r);
const tt = await A("team.today", { client_id: sunrise.id, day: new Date().toISOString().slice(0, 10) }); ok("today's team reads back", tt && JSON.stringify(tt).includes(U("Arun Agent").id), tt);
r = await T(async () => A("inventory.enrich", { client_id: sunrise.id, purpose: "Missing patient details", file_name: "demo.csv", rows: [{ "Claim #": pool[8].claim_no, "Patient DOB": "1980-02-03", "Member ID": "M123" }] })); ok("patient details report", r.ok, r);
r = await T(async () => A("alloc.unassign", { user_id: U("Arun Agent").id, client_id: sunrise.id })); ok("take claims back from a biller", r.ok, r);

S("Roster leftovers");
feed = feed.filter((p) => p.name !== "Ava Both" && p.name !== "Arun Agent");
r = await A("roster.syncShastra");
const users2 = (await A("users.list")).users; const U2 = (n) => users2.find((u) => u.name === n);
ok("Ava (never signed in, no work) removed", !U2("Ava Both"), U2("Ava Both"));
ok("Arun (has work) kept but switched off", U2("Arun Agent") && !U2("Arun Agent").active, U2("Arun Agent"));
r = await T(async () => AR("auth.me")); ok("Arun is signed out", !r.ok, r);
ok("removed count reported", r && (await A("roster.meta")).shastra.last.removed >= 1, (await A("roster.meta")).shastra.last);

console.log("\n==== " + results.filter((x) => x.pass).length + " passed, " + results.filter((x) => !x.pass).length + " failed of " + results.length);
for (const f of results.filter((x) => !x.pass)) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(results.some((x) => !x.pass) ? 1 : 0);
