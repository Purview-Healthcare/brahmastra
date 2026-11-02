import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "", location: "Pune", doj: "2026-03-01", exit_date: null, email: "", ...o });
const feed = [P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", email: "tina@purview-healthcare.com" }), P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "E4", name: "Snail Post", department: "Posting", email: "snail@purview-healthcare.com" }), P({ emp_id: "E5", name: "Mark Sub", department: "Submission", email: "mark@purview-healthcare.com" }),
  P({ emp_id: "E7", name: "Rina Rej", department: "Submission", email: "rina@purview-healthcare.com" })];
const fetchMock = async (url, init, real) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : real(url, init);
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), SN = await firstIn("Snail Post", "snail@purview-healthcare.com"), MK = await firstIn("Mark Sub", "mark@purview-healthcare.com"), RI = await firstIn("Rina Rej", "rina@purview-healthcare.com");
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
await A("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Snail Post").id });
await A("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Mark Sub").id });
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 40 })).rows;
await A("alloc.reassign", { ids: pool.slice(0, 8).map((c) => c.id), user_id: U("Arun Agent").id });
const [c1, c2, c3, c4, c5] = pool;
const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
const toPost = async (c) => { await AR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: pdf }); return AR("queue.complete", { id: c.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Portal", findings: "Paid, EOB attached for posting", action: "eob requested" } }); };
const toSub = (c, status = "Claim Denied") => AR("queue.complete", { id: c.id, saag: { status, sub_status: "Missing/ Invalid Information", action: "Need to Resubmit", bucket: "Purview", effective: "Rejected" }, note: { source: "Portal", findings: "Corrected the NPI, ready to resubmit", action: "claim corrected" } });
const claim = async (c) => (await A("claims.get", { id: c.id })).claim;

S("In process for AR");
await toPost(c1);
let cl1 = await claim(c1); ok("sent to posting: state In process", cl1.state === "in_process" && cl1.handoff_status === "with_posting", [cl1.state, cl1.handoff_status]);
ok("not on Arun's list to work again", !(await AR("queue.list", {})).rows.some((r) => r.id === c1.id && ["assigned", "in_progress"].includes(r.state)));
const st = await A("claims.stats", {}); ok("dashboard counts In process", st.states.some((s) => s.state === "in_process" && s.n >= 1), st.states.map((s) => s.state + ":" + s.n));
await toSub(c2);
let cl2 = await claim(c2); ok("sent to submission: In process", cl2.state === "in_process" && cl2.handoff_status === "with_submission", [cl2.state, cl2.handoff_status]);

S("Pending with a comment");
let hs = (await SN("handoffs.list", {})).rows; const h1 = hs.find((h) => h.claim_id === c1.id);
ok("open list shows the TAT due time", h1 && h1.due_at > Date.now(), h1 && h1.due_at);
let rp = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "pending", note: "wip" })); ok("pending with a too-short comment refused", !rp.ok, rp);
rp = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "pending", note: "Posted 2 of 3 lines, batch closes tonight" })); ok("pending saved", rp.ok, rp);
const hp = (await SN("handoffs.list", { view: "open" })).rows.find((h) => h.id === h1.id);
ok("still open with the same due time, pending noted", hp && hp.status !== "complete" && hp.due_at === h1.due_at && hp.pending_at > 0 && /Snail/.test(hp.pending_by_name) && /batch closes/.test(hp.note), hp && [hp.status, hp.pending_at, hp.pending_by_name]);
{ const tlp = await A("claims.timeline", { id: c1.id }); const ks = (tlp.events || tlp.items || tlp.rows || []).map((e) => e.kind);
ok("timeline has the pending note", ks.includes("handoff_pending"), ks); }

S("Need client assistance, then resume");
let r = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "client", reason: "Need EOB / ERA from the client" })); ok("client assistance without a comment refused", !r.ok, r);
r = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "client", reason: "Need EOB / ERA from the client", note: "Emailed the client for the ERA on Nov 2" })); ok("client assistance with a comment", r.ok, r);
ok("not in Open any more", !(await SN("handoffs.list", { view: "open" })).rows.some((h) => h.id === h1.id));
const wc = await SN("handoffs.list", { view: "client" }); ok("listed under Waiting on client, clock still running (same due time)", wc.rows.some((h) => h.id === h1.id && h.status === "client" && h.due_at === h1.due_at) && wc.stats.client_n === 1, wc.stats);
ok("still counted in the tab badge", (await SN("handoffs.count")).n >= 1);
cl1 = await claim(c1); ok("AR sees: still In process, Posting waiting on client", cl1.state === "in_process" && cl1.handoff_status === "posting_client", [cl1.state, cl1.handoff_status, cl1.state_reason]);
r = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "resume", note: "ERA received" })); ok("client answered: resume", r.ok, r);
const h1b = (await SN("handoffs.list", {})).rows.find((h) => h.id === h1.id); ok("back in the open list with the same due time", h1b && h1b.status === "pending" && h1b.due_at === h1.due_at, h1b && [h1b.status, h1b.due_at, h1.due_at]);

S("Sent back to AR");
r = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "back", reason: "Missing or wrong information from AR" })); ok("back to AR without comment refused", !r.ok, r);
r = await T(async () => SN("handoffs.close", { id: h1.id, outcome: "back", reason: "Missing or wrong information from AR", note: "EOB attached is for another patient, please check" })); ok("back to AR with comment", r.ok, r);
cl1 = await claim(c1); ok("claim back on Arun's desk, flagged Back to AR from Posting", cl1.state === "assigned" && cl1.handoff_status === "posting_back" && cl1.escalated === 0, [cl1.state, cl1.handoff_status, cl1.escalated]);
ok("Arun sees it to work today", (await AR("queue.list", {})).rows.some((x) => x.id === c1.id));
const ret = await SN("handoffs.list", { view: "assist" }); ok("Snail's Returned to AR list has it with the comment", ret.rows.some((h) => h.id === h1.id && h.status === "back" && /another patient/.test(h.note)));
const tl = await A("claims.timeline", { id: c1.id }); const kinds = (tl.events || tl.items || tl.rows || []).map((e) => e.kind);
ok("timeline: sent, client, resume, back", ["handoff_sent", "handoff_client", "handoff_resume", "handoff_back"].every((k) => kinds.includes(k)), kinds);

S("Posting complete");
await toPost(c3);
const h3 = (await SN("handoffs.list", {})).rows.find((h) => h.claim_id === c3.id);
r = await T(async () => SN("handoffs.close", { id: h3.id, outcome: "complete", proof: { date: "2026-11-02", ref: "EFT-1" }, note: "Posted in full" })); ok("posted with an optional comment", r.ok, r);
const cl3 = await claim(c3); ok("claim closes as Payment posted", cl3.state === "closed" && cl3.handoff_status === "posted", [cl3.state, cl3.handoff_status]);

S("Submission and the 48-hour recheck");
const h2 = (await MK("handoffs.list", {})).rows.find((h) => h.claim_id === c2.id);
const before = Date.now();
r = await T(async () => MK("handoffs.close", { id: h2.id, outcome: "complete", proof: { date: "2026-11-02", ref: "BATCH-1" } })); ok("Mark submits", r.ok, r);
cl2 = await claim(c2); ok("claim back to Worked with a 15-day follow-up, Submitted", cl2.state === "completed" && cl2.handoff_status === "submitted" && cl2.follow_up_on, [cl2.state, cl2.handoff_status, cl2.follow_up_on]);
const chk = (await MK("handoffs.list", { dept: "subcheck" })).rows.find((h) => h.claim_id === c2.id);
ok("recheck created for Mark (no check person set)", chk && chk.dept === "subcheck" && chk.assigned_to === U("Mark Sub").id, chk);
const hrs = chk ? (chk.available_at - before) / 3600000 : 0;
ok("recheck opens 48 working hours later (2 to 4 calendar days)", hrs >= 47.9 && hrs <= 96.1, hrs.toFixed(1) + " h");

S("Rejections responsibility");
r = await T(async () => A("clients.saveResponsibility", { client_id: sun.id, dept: "rejection", mode: "person", lead: U("Rina Rej").id })); ok("set Rina as Rejections person", r.ok, r);
ok("Rina's desk is Submission (with rejections)", (await RI("handoffs.count")).depts.includes("rejection"), await RI("handoffs.count"));
r = await T(async () => MK("handoffs.close", { id: chk.id, outcome: "rejected", reason: "Clearinghouse rejection", note: "Rejected for invalid subscriber ID" })); ok("Mark marks the recheck Rejected", r.ok, r);
const rl = await RI("handoffs.list", {}); const rj = rl.rows.find((h) => h.claim_id === c2.id);
ok("rejection lands with Rina", rj && rj.dept === "rejection", rl.rows.map((h) => h.dept));
cl2 = await claim(c2); ok("AR sees In process · Rejections", cl2.state === "in_process" && cl2.handoff_status === "with_rejection", [cl2.state, cl2.handoff_status]);
await toSub(c4, "Claim Rejected");
const rl2 = await RI("handoffs.list", {}); ok("biller's Claim Rejected + Need to Resubmit goes to Rina, not Mark", rl2.rows.some((h) => h.claim_id === c4.id && h.dept === "rejection") && !(await MK("handoffs.list", {})).rows.some((h) => h.claim_id === c4.id), rl2.rows.map((h) => h.dept));
await toSub(c5, "Claim Denied");
const mixed = await RI("handoffs.list", { dept: "submission" }); ok("Rina's list puts rejections first", mixed.rows.length && mixed.rows[0].dept === "rejection", mixed.rows.map((h) => h.dept));
ok("Mark still gets the non-rejection resubmission", (await MK("handoffs.list", {})).rows.some((h) => h.claim_id === c5.id));
const rj2 = rl2.rows.find((h) => h.claim_id === c4.id);
r = await T(async () => RI("handoffs.close", { id: rj2.id, outcome: "complete", proof: { date: "2026-11-02", ref: "BATCH-RJ1", code: "Subscriber / member ID invalid" } })); ok("Rina resubmits", r.ok, r);
ok("recheck created for Rina after resubmitting", (await RI("handoffs.list", { dept: "subcheck" })).rows.some((h) => h.claim_id === c4.id));
const d = await RI("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("submission dashboard counts rejections work", d.totals.received >= 2, d.totals);

console.log("\n==== " + results.filter((x) => x.pass).length + " passed, " + results.filter((x) => !x.pass).length + " failed of " + results.length);
for (const f of results.filter((x) => !x.pass)) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(results.some((x) => !x.pass) ? 1 : 0);
