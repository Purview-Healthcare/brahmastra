/* Suite 21: client TAT (working hours) and no Submission / Rejections targets; desk In process and Other; sent back to AR is first on the biller's list;
   the biller rechecks resubmitted claims; the supervisor reviews Needs attention with four notes and sends it on. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "", location: "Pune", doj: "2026-03-01", exit_date: null, email: "", ...o });
const feed = [P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", email: "tina@purview-healthcare.com" }), P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "E4", name: "Snail Post", department: "Posting", email: "snail@purview-healthcare.com" }), P({ emp_id: "E5", name: "Mark Sub", department: "Submission", email: "mark@purview-healthcare.com" }),
  P({ emp_id: "E7", name: "Rina Rej", department: "Submission", email: "rina@purview-healthcare.com" }),
  P({ emp_id: "E8", name: "Bela Agent", email: "bela@purview-healthcare.com" })];
const fetchMock = async (url, init, real) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : real(url, init);
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), SN = await firstIn("Snail Post", "snail@purview-healthcare.com"), MK = await firstIn("Mark Sub", "mark@purview-healthcare.com"), RI = await firstIn("Rina Rej", "rina@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
await A("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Snail Post").id });
await A("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Mark Sub").id });
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 40 })).rows;
await A("alloc.reassign", { ids: pool.slice(0, 8).map((c) => c.id), user_id: U("Arun Agent").id });
const [c1, c2, c3, c4, c5, c6, c7] = pool;
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const row = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results[0];
const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
const toPost = async (c) => { await AR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: pdf }); return AR("queue.complete", { id: c.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Portal", findings: "Paid, EOB attached for posting", action: "eob requested" } }); };
const toSub = (c, status = "Claim Denied") => AR("queue.complete", { id: c.id, saag: { status, sub_status: "Missing/ Invalid Information", action: "Need to Resubmit", bucket: "Purview", effective: "Rejected" }, note: { source: "Portal", findings: "Corrected the NPI, ready to resubmit", action: "claim corrected" } });
const claim = async (c) => (await A("claims.get", { id: c.id })).claim;


S("Client profile: AR target only; Posting and Submission TAT in working hours");
const resp = { ar: { lead: U("Tina Lead").id }, posting: { lead: U("Snail Post").id }, submission: { lead: U("Mark Sub").id }, rejection: { lead: U("Rina Rej").id }, subcheck: { mode: "biller" } };
let r = await T(() => A("clients.save", { name: "TAT Clinic", locations: ["Main"], profile: { scope: ["ar", "posting", "submission", "rejection"], targets: { ar: 40 }, tat: { posting: 36, submission: 0 }, resp } }));
ok("a TAT out of range is refused", !r.ok && /Submission TAT/.test(r.e), r);
r = await T(() => A("clients.save", { name: "TAT Clinic", locations: ["Main"], profile: { scope: ["ar", "posting", "submission", "rejection"], targets: { ar: 40 }, tat: { posting: 36, submission: 12 }, resp } }));
ok("no target for Posting, Submission or Rejections is needed; it saves with the TATs", r.ok, r);
const tc = (await A("clients.list")).clients.find((c) => c.name === "TAT Clinic");
ok("stored: AR target 40, Posting TAT 36, Submission TAT 12, no other targets", tc && tc.targets.ar === 40 && !tc.targets.submission && !tc.targets.rejection && tc.posting_tat_hours === 36 && tc.submission_tat_hours === 12, tc && [tc.targets, tc.posting_tat_hours, tc.submission_tat_hours]);
ok("its profile is complete without them", tc && !tc.profile_gaps.some((g) => /target/.test(g) && !/AR/.test(g)), tc && tc.profile_gaps);
r = await T(() => A("clients.save", { name: "TAT Clinic 2", locations: ["Main"], profile: { scope: ["ar"], targets: {}, resp: { ar: { lead: U("Tina Lead").id } } } }));
ok("AR still needs its daily target", !r.ok && /daily target for AR/.test(r.e), r);
// Sunrise: Posting 36 working hours, Submission 12
await sql("UPDATE clients SET posting_tat_hours = 36, submission_tat_hours = 12 WHERE id = ?", sun.id);
await toPost(c1); await toSub(c2);
const hp = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'posting'", c1.id), hsb = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'submission'", c2.id);
ok("a new posting hand-off is due 36 working hours later", hp && hp.due_at - hp.created_at >= 36 * 3600000, hp && (hp.due_at - hp.created_at) / 3600000);
ok("a new submission hand-off is due 12 working hours later", hsb && hsb.due_at - hsb.created_at >= 12 * 3600000 && hsb.due_at - hsb.created_at < 36 * 3600000 + 72 * 3600000 && hsb.due_at < hp.due_at, hsb && (hsb.due_at - hsb.created_at) / 3600000);
ok("the hand-off remembers the biller", hsb && hsb.biller_id === U("Arun Agent").id);

S("Posting and Submission desks: In process and Other");
r = await T(() => SN("handoffs.close", { id: hp.id, outcome: "inprocess", note: "" }));
ok("In process needs no comment", r.ok, r);
let L = (await SN("handoffs.list", {})).rows.find((h) => h.id === hp.id);
ok("it shows In process and stays open", L && L.desk_state === "in_process" && ["pending", "assigned"].includes(L.status), L && [L.desk_state, L.status]);
r = await T(() => SN("handoffs.close", { id: hp.id, outcome: "other", reason: "", note: "Waiting for the batch" }));
ok("Other needs a reason", !r.ok && /reason/.test(r.e), r);
r = await T(() => SN("handoffs.close", { id: hp.id, outcome: "other", reason: "Clearinghouse down", note: "Will post once it is back up" }));
L = (await SN("handoffs.list", {})).rows.find((h) => h.id === hp.id);
ok("Other with a reason and comment: saved, still open", r.ok && L.desk_state === "other" && L.reason === "Clearinghouse down" && L.note === "Will post once it is back up", L && [L.desk_state, L.reason]);
r = await T(() => SN("handoffs.close", { id: hp.id, outcome: "pending", note: "Posted 2 of 3 lines" }));
ok("Pending still works", r.ok && (await SN("handoffs.list", {})).rows.find((h) => h.id === hp.id).desk_state === "pending", r);
ok("the claim history has In process and Other", !!(await row("SELECT 1 AS x FROM claim_events WHERE claim_id = ? AND kind = 'handoff_inprocess'", c1.id)) && !!(await row("SELECT 1 AS x FROM claim_events WHERE claim_id = ? AND kind = 'handoff_other'", c1.id)));

S("Need assistance from AR: first on the biller's list, with a notice");
r = await T(() => MK("handoffs.close", { id: hsb.id, outcome: "back", reason: "Missing or wrong information from AR", note: "The NPI is still wrong, please fix" }));
ok("Submission sends it back", r.ok, r);
const cb = await row("SELECT first_up, assigned_to, state FROM claims WHERE id = ?", c2.id);
ok("the claim is first up on Arun's list", cb.first_up === 1 && cb.assigned_to === U("Arun Agent").id && cb.state === "assigned", cb);
const nxt = await AR("queue.next", {});
ok("Next opens it before every other claim", nxt.claim && nxt.claim.id === c2.id, nxt.claim && nxt.claim.claim_no);
ok("Arun has a notice", !!(await row("SELECT 1 AS x FROM user_notices WHERE user_id = ? AND text LIKE '%sent claim%back%'", U("Arun Agent").id)));

S("Recheck after a resubmission: the biller sees it and marks it");
await sql("UPDATE clients SET rejection_mode = 'person', rejection_lead = ? WHERE id = ?", U("Rina Rej").id, sun.id);
await toSub(c3); await toSub(c4);
for (const c of [c3, c4]) { const h = await row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission' AND status IN ('pending','assigned')", c.id);
  r = await T(() => MK("handoffs.close", { id: h.id, outcome: "complete", proof: { date: "2026-11-05", ref: "B-77", mode: "Electronic" } })); ok("Mark submits " + c.claim_no, r.ok, r); }
const mine = await AR("handoffs.myRechecks", {});
const rc3 = mine.rows.find((x) => x.claim_id === c3.id), rc4 = mine.rows.find((x) => x.claim_id === c4.id);
ok("Arun sees both rechecks, from Submission, with the TAT", rc3 && rc4 && rc3.from_label === "Submission" && rc3.due_at > rc3.available_at && "left_ms" in rc3, mine.rows.map((x) => x.claim_no));
ok("Bela (another biller) does not", !(await BE("handoffs.myRechecks", {})).rows.some((x) => x.claim_id === c3.id));
r = await T(() => BE("handoffs.close", { id: rc3.id, outcome: "complete", proof: { date: "2026-11-05" } }));
ok("and cannot mark it", !r.ok && r.status === 403, r);
r = await T(() => AR("handoffs.close", { id: rc4.id, outcome: "complete", proof: { date: "2026-11-05", ref: "" } }));
ok("Arun marks one accepted", r.ok && (await row("SELECT handoff_status FROM claims WHERE id = ?", c4.id)).handoff_status === "submission_accepted", r);
r = await T(() => AR("handoffs.close", { id: rc3.id, outcome: "rejected", reason: "CPT or modifier invalid", note: "Payer rejected the modifier again" }));
const re = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'rejection' AND status = 'pending'", c3.id);
ok("rejected again: straight to the Rejections person, with the client's Submission TAT", r.ok && re && re.lead_id === U("Rina Rej").id && re.due_at - re.created_at >= 12 * 3600000 && re.biller_id === U("Arun Agent").id, re);
ok("it leaves Arun's recheck list", !(await AR("handoffs.myRechecks", {})).rows.some((x) => x.claim_id === c3.id));
r = await T(() => AR("handoffs.close", { id: re.id, outcome: "complete", proof: { date: "2026-11-05", ref: "R1", code: "CPT or modifier invalid" } }));
ok("the biller cannot close the Rejections desk's own hand-off", !r.ok && r.status === 403, r);

S("Needs attention: the supervisor reviews with four notes, then sends it on");
await sql("UPDATE claims SET escalated = 1, escalated_at = ?, escalated_by = ?, state = 'completed' WHERE id = ?", Date.now() - 3600000, U("Arun Agent").id, c5.id);
await sql("UPDATE claims SET escalated = 1, escalated_at = ?, escalated_by = ?, state = 'completed' WHERE id = ?", Date.now() - 3600000, U("Arun Agent").id, c6.id);
let at = await A("attention.list", {});
const e5 = at.rows.find((x) => x.id === c5.id);
ok("the escalation names who sent it, and the people it can go to", e5 && e5.sent_by_id === U("Arun Agent").id && at.people.some((p) => p.name === "Bela Agent"), e5 && e5.sent_by_name);
const four = { why: "Escalated by Arun", reviewed: "Claim history and the payer portal", findings: "Wrong payer ID on the claim", next: "Correct the payer ID and resubmit today" };
r = await T(() => A("attention.review", { id: c5.id, ...four, findings: "", route: "biller" }));
ok("all four notes are needed", !r.ok && /findings/i.test(r.e), r);
r = await T(() => A("attention.review", { id: c5.id, ...four, route: "biller", sent_by: e5.sent_by_id }));
const r5 = await row("SELECT escalated, assigned_to, first_up, state, reviewed_by_name FROM claims WHERE id = ?", c5.id);
ok("to the biller who sent it: flag off, first on Arun's list", r.ok && r.r.to === "Arun Agent" && r5.escalated === 0 && r5.assigned_to === U("Arun Agent").id && r5.first_up === 1 && r5.state === "assigned", r5);
ok("the four notes are in the claim history", !!(await row("SELECT 1 AS x FROM notes WHERE claim_id = ? AND comment LIKE 'Supervisor review%Findings: Wrong payer ID%Next action: Correct%'", c5.id)));
r = await T(() => A("attention.review", { id: c6.id, ...four, route: "other", user_id: U("Bela Agent").id }));
const r6 = await row("SELECT assigned_to, first_up FROM claims WHERE id = ?", c6.id);
ok("to another biller: Bela gets it first, with a notice", r.ok && r6.assigned_to === U("Bela Agent").id && r6.first_up === 1 && !!(await row("SELECT 1 AS x FROM user_notices WHERE user_id = ? AND text LIKE '%reviewed claim%gave it to you%'", U("Bela Agent").id)), r6);
r = await T(() => TI("attention.review", { id: c6.id, ...four, route: "other", user_id: U("Bela Agent").id }));
const fd = await A("attention.fromDesks", {});
const d2 = fd.rows.find((x) => x.claim_id === c2.id);
ok("a claim Submission sent back shows with Review: it can go back to the department that sent it", d2 && d2.last_dept === "submission" && d2.depts.some((d) => d.id === "submission"), d2 && [d2.last_dept, d2.depts]);
r = await T(() => A("attention.review", { id: c2.id, ...four, route: "dept", dept: "submission" }));
const back = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'submission' AND status = 'pending' ORDER BY created_at DESC", c2.id);
ok("returned to Submission with the client's TAT and the next action as its note", r.ok && back && back.lead_id === U("Mark Sub").id && back.note === four.next && back.due_at - back.created_at >= 12 * 3600000, back);
ok("and it leaves Sent back", !(await A("attention.fromDesks", {})).rows.some((x) => x.claim_id === c2.id));
r = await T(() => AR("attention.review", { id: c7.id, ...four, route: "biller" }));
ok("billers cannot review", !r.ok && r.status === 403, r);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
