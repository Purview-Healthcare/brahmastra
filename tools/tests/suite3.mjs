import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "", location: "Pune", doj: "2026-03-01", exit_date: null, email: "", ...o });
const feed = [P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", email: "tina@purview-healthcare.com" }), P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "E4", name: "Snail Post", department: "Posting", email: "snail@purview-healthcare.com" }), P({ emp_id: "E5", name: "Mark Sub", department: "Submission", email: "mark@purview-healthcare.com" }),
  P({ emp_id: "E6", name: "Paula PostLead", position: "Team Lead", department: "Posting", email: "paula@purview-healthcare.com" }),
  P({ emp_id: "E7", name: "Rina Rej", department: "Submission", email: "rina@purview-healthcare.com" })];
const fetchMock = async (url, init, real) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : real(url, init);
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), SN = await firstIn("Snail Post", "snail@purview-healthcare.com"), MK = await firstIn("Mark Sub", "mark@purview-healthcare.com"),
  RI = await firstIn("Rina Rej", "rina@purview-healthcare.com"), TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), PA = await firstIn("Paula PostLead", "paula@purview-healthcare.com");
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
await A("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Snail Post").id, backup: U("Paula PostLead").id });
await A("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Mark Sub").id });
await A("clients.saveResponsibility", { client_id: sun.id, dept: "rejection", mode: "person", lead: U("Rina Rej").id });
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 40 })).rows;
await A("alloc.reassign", { ids: pool.slice(0, 10).map((c) => c.id), user_id: U("Arun Agent").id });
const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
const toPost = async (c) => { await AR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: pdf }); return AR("queue.complete", { id: c.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Portal", findings: "Paid, EOB attached for posting", action: "eob requested" } }); };
const toSub = (c, status = "Claim Denied") => AR("queue.complete", { id: c.id, saag: { status, sub_status: "Missing/ Invalid Information", action: "Need to Resubmit", bucket: "Purview", effective: "Rejected" }, note: { source: "Portal", findings: "Corrected, ready to resubmit", action: "claim corrected" } });
const hOf = async (X, c, view) => (await X("handoffs.list", view ? { view } : {})).rows.find((h) => h.claim_id === c.id);
const [c1, c2, c3, c4, c5] = pool;

S("Client requests for the AR team lead");
await toPost(c1); let h1 = await hOf(SN, c1);
await SN("handoffs.close", { id: h1.id, outcome: "client", reason: "Need EOB / ERA from the client", note: "Need the ERA for the Oct deposit" });
let cnt = await TI("attention.count"); ok("AR lead's Needs attention counts 1 client request", cnt.client_to_send === 1 && cnt.n >= 1, cnt);
let cr = await TI("attention.clientRequests"); const r1 = cr.rows.find((r) => r.claim_id === c1.id);
ok("listed To send with who asked and what is needed", r1 && !r1.client_sent_at && r1.asked_by === "Snail Post" && /ERA/.test(r1.reason), r1);
ok("not late yet", r1 && !r1.late && cr.late === 0);
h1 = await hOf(SN, c1, "client"); ok("desk sees: not sent to the client yet", h1 && !h1.client_sent_at);
let r = await T(async () => TI("attention.clientSent", { id: r1.id })); ok("marking sent needs how", !r.ok, r);
r = await T(async () => TI("attention.clientSent", { id: r1.id, how: "Email", note: "Emailed the office manager" })); ok("AR lead marks it sent by email", r.ok, r);
h1 = await hOf(SN, c1, "client"); ok("desk sees who sent it, when and how", h1 && h1.client_sent_by_name === "Tina Lead" && h1.client_sent_how === "Email", h1 && [h1.client_sent_by_name, h1.client_sent_how]);
const days = (h1.chase_at - h1.client_sent_at) / 86400000; ok("chase set 3 working days after sending (3 to 5 calendar days)", days >= 2.99 && days <= 5.01, days.toFixed(2));
ok("count drops after sending", (await TI("attention.count")).client_to_send === 0);
r = await T(async () => SN("attention.clientRequests")); ok("desk staff cannot open the team lead's list", !r.ok, r);
const tl = await A("claims.timeline", { id: c1.id }); ok("timeline has Sent to the client", (tl.events || tl.items || tl.rows || []).some((e) => e.kind === "handoff_client_sent"));

S("Chase the client after 3 working days");
await sql("UPDATE handoffs SET chase_at = ? WHERE id = ?", Date.now() - 60000, h1.id);
let open = await SN("handoffs.list", { view: "open" }); const ch = open.rows.find((h) => h.id === h1.id);
ok("comes back to Open as Chase the client", ch && ch.chase && ch.status === "client", ch && [ch.status, ch.chase]);
ok("chase counted", open.stats.chase_n === 1, open.stats);
await sql("UPDATE handoffs SET client_sent_at = NULL, paused_at = ? WHERE id = ?", Date.now() - 6 * 86400000, h1.id);
cr = await TI("attention.clientRequests"); ok("unsent for over a working day shows late (red) for the lead", cr.rows.some((x) => x.id === h1.id && x.late) && cr.late === 1, cr.rows.map((x) => x.late));

S("4-hour warning");
await toPost(c2); const h2 = await hOf(SN, c2);
await sql("UPDATE handoffs SET due_at = ? WHERE id = ?", Date.now() + 2 * 3600000, h2.id);
const l2 = await SN("handoffs.list", {}); const r2 = l2.rows.find((h) => h.id === h2.id);
ok("flagged under 4 hours left", r2 && r2.due_soon && !r2.overdue, r2 && [r2.due_soon, r2.overdue]);
ok("at the top of Open (soonest due first)", l2.rows[0].id === h2.id || l2.rows[0].chase, l2.rows.map((h) => h.id === h2.id));
ok("counted for the top bar", (await SN("handoffs.count")).due_soon >= 1, await SN("handoffs.count"));
const dP = await PA("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("posting lead's Needs you now lists it", dP.attention.some((x) => x.id === h2.id && x.why === "soon"), dP.attention.map((x) => x.why));

S("Returned 3 times");
await toPost(c3);
for (let i = 1; i <= 3; i++) {
  const h = await hOf(SN, c3);
  await SN("handoffs.close", { id: h.id, outcome: "back", reason: "Missing or wrong information from AR", note: "Wrong EOB attached, round " + i });
  const cl = (await A("claims.get", { id: c3.id })).claim;
  if (i < 3) { ok("return " + i + ": not escalated yet", !cl.escalated, cl.escalated); await AR("attachments.add", { claim_id: c3.id, name: "eob" + i + ".pdf", type: "application/pdf", data: pdf }); await AR("queue.open", { id: c3.id }).catch(() => {}); await toPost(c3); }
  else ok("3rd return: escalated to the AR team lead", cl.escalated === 1, cl.escalated);
}
ok("AR lead's Escalations list has it", (await TI("attention.list")).rows.some((x) => x.id === c3.id));
const ret = await SN("handoffs.list", { view: "assist" }); ok("desk rows show Returned 3×", ret.rows.some((h) => h.claim_id === c3.id && h.returns === 3), ret.rows.map((h) => h.returns));
const dP2 = await PA("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 });
ok("why claims came back: reason counted 3", dP2.back_reasons.some((x) => x.reason === "Missing or wrong information from AR" && x.n === 3), dP2.back_reasons);
ok("...and the biller (Arun) counted", dP2.back_billers.some((x) => x.biller === "Arun Agent" && x.n === 3), dP2.back_billers);

S("Rechecks due now and rejection codes");
await toSub(c4); const h4 = await hOf(MK, c4);
await MK("handoffs.close", { id: h4.id, outcome: "complete", proof: { date: "2026-11-02", ref: "B1" } });
const chk = (await MK("handoffs.list", { dept: "subcheck" })).rows.find((h) => h.claim_id === c4.id);
ok("recheck not due yet", (await MK("handoffs.list", {})).stats.recheck_now_n === 0);
await sql("UPDATE handoffs SET available_at = ? WHERE id = ?", Date.now() - 60000, chk.id);
ok("recheck due now counted", (await MK("handoffs.list", {})).stats.recheck_now_n === 1);
r = await T(async () => MK("handoffs.close", { id: chk.id, outcome: "rejected", reason: "Subscriber / member ID invalid", note: "Clearinghouse 999 rejection for subscriber ID" })); ok("recheck Rejected with a code", r.ok, r);
await toSub(c5, "Claim Rejected"); const h5 = await hOf(RI, c5);
r = await T(async () => RI("handoffs.close", { id: h5.id, outcome: "complete", proof: { date: "2026-11-02", ref: "B2" } })); ok("resubmitting a rejection without its code refused", !r.ok, r);
r = await T(async () => RI("handoffs.close", { id: h5.id, outcome: "complete", proof: { date: "2026-11-02", ref: "B2", code: "CPT or modifier invalid" } })); ok("resubmitted with its code", r.ok, r);
const dS = await A("handoffs.dashboard", { dept: "submission", from_ms: 0, to_ms: Date.now() + 1e7 });
const dM = await MK("handoffs.dashboard", { from_ms: 0, to_ms: Date.now() + 1e7 }); ok("an agent sees only his own (Mark: 1)", dM.rejections.total === 1, dM.rejections.total);
ok("rejections by code: 2 recorded, both codes counted", dS.rejections.total === 2 && dS.rejections.by_code.some((x) => x.name === "Subscriber / member ID invalid") && dS.rejections.by_code.some((x) => x.name === "CPT or modifier invalid"), dS.rejections);
ok("...by client and by biller", dS.rejections.by_client.some((x) => x.name === sun.name && x.n === 2) && dS.rejections.by_biller.some((x) => x.name === "Arun Agent"), [dS.rejections.by_client, dS.rejections.by_biller]);

console.log("\n==== " + results.filter((x) => x.pass).length + " passed, " + results.filter((x) => !x.pass).length + " failed of " + results.length);
for (const f of results.filter((x) => !x.pass)) console.log("FAILED: [" + f.section + "] " + f.name);
