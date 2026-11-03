// The hand-off workflow end to end, as a biller, the desks and the team lead see it:
// a biller sends a claim to Payment posting or Submission, it lands at once with the person set on the client
// (a posting agent, or a team lead), and when the desk marks it Complete (or sends it back) the biller sees it at once:
// the bell, My work and the claim's history. No scheduled job is needed for any of it.
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", reports_to: "", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "E4", name: "Snail Post", department: "Posting", reports_to: "", email: "snail@purview-healthcare.com" }),
  P({ emp_id: "E5", name: "Mark Sub", department: "Submission", reports_to: "", email: "mark@purview-healthcare.com" }),
  P({ emp_id: "E6", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "", email: "bela@purview-healthcare.com" }),
];
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"),
  SN = await firstIn("Snail Post", "snail@purview-healthcare.com"), MK = await firstIn("Mark Sub", "mark@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sunrise = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const pool = (await A("claims.list", { client_id: sunrise.id, state: "open", page_size: 10 })).rows;
await A("alloc.reassign", { ids: pool.slice(0, 6).map((c) => c.id), user_id: U("Arun Agent").id });
const [c1, c2, c3, c4] = pool;
const pdf = Buffer.from("%PDF-1.4 eob").toString("base64");
const postWork = { saag: { status: "Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Web", findings: "Paid, EOB downloaded from the portal", action: "sent to posting" } };
const subWork = { saag: { status: "Rejected", sub_status: "Missing information", action: "Need to Resubmit", bucket: "Purview", effective: "Rejected" }, note: { source: "Web", findings: "Rejected for missing modifier, corrected", action: "claim corrected" } };
const bell = async (X) => (await X("notify.list", {})).items.filter((i) => /^notice:/.test(i.key)).map((i) => i.text);
const mine = async (X, id) => (await X("history.mine", { from_ms: 0, to_ms: Date.now() + 1e7 })).rows.find((r) => r.claim_id === id && r.kind === "work");
const events = async (X, id) => (await X("claims.timeline", { id })).items || (await X("claims.timeline", { id })).rows || [];

S("Set up: Posting goes to Snail, Submission to the team lead Tina");
let r = await T(async () => TI("clients.saveResponsibility", { client_id: sunrise.id, dept: "posting", mode: "person", lead: U("Snail Post").id }));
ok("team lead sets Snail on Payment posting", r.ok, r);
r = await T(async () => TI("clients.saveResponsibility", { client_id: sunrise.id, dept: "submission", mode: "person", lead: U("Tina Lead").id }));
ok("team lead sets herself on Submission", r.ok, r);

S("Payment posting: biller sends it, Snail gets it at once");
await AR("attachments.add", { claim_id: c1.id, name: "eob.pdf", type: "application/pdf", data: pdf });
r = await T(async () => AR("queue.complete", { id: c1.id, ...postWork }));
ok("biller saves Need to Post/Posting Correction", r.ok, r);
ok("the reply says it went to Snail", r.ok && r.r.handoff && r.r.handoff.dept === "posting" && r.r.handoff.to === "Snail Post", r.ok && r.r.handoff);
ok("Snail's desk count is 1 straight away", (await SN("handoffs.count")).n === 1);
const snRows = (await SN("handoffs.list", {})).rows;
ok("it is on Snail's list with the claim and who sent it", snRows.length === 1 && snRows[0].claim_id === c1.id && /Arun/.test(snRows[0].created_by_name || ""), snRows[0]);
ok("Snail's bell shows it", (await SN("notify.list", {})).items.some((i) => i.key === "handoffs" && i.n === 1));
{ const q1 = (await AR("queue.list", {})).rows.find((x) => x.id === c1.id);
  ok("not work to do for the biller while posting has it (In process, done today)", !q1 || q1.state === "in_process", q1 && q1.state); }
let h = await mine(AR, c1.id);
ok("biller's My work: With Payment posting · Snail", h && h.handoff && h.handoff.status === "pending" && h.handoff.to === "Snail Post", h && h.handoff);
ok("Mark (Submission) does not get it", (await MK("handoffs.count")).n === 0);

S("Snail marks it Complete: the biller sees it at once");
r = await T(async () => SN("handoffs.close", { id: snRows[0].id, outcome: "complete", proof: { date: "2026-11-03", ref: "CHK-1001", amount: 120.5 } }));
ok("Snail completes the posting", r.ok, r);
ok("Snail's desk is clear", (await SN("handoffs.count")).n === 0);
ok("biller's bell: Snail Post posted claim …", (await bell(AR)).some((t) => /Snail Post posted claim/.test(t)), await bell(AR));
h = await mine(AR, c1.id);
ok("biller's My work: Posted by Snail", h && h.handoff && h.handoff.status === "complete" && h.handoff.by === "Snail Post", h && h.handoff);
const ev1 = await events(AR, c1.id);
ok("the claim's history (biller's view) has sent and completed", JSON.stringify(ev1).includes("handoff_sent") && JSON.stringify(ev1).includes("handoff_done"), ev1.map((e) => e.kind || e.type));
const g1 = (await AR("claims.get", { id: c1.id })).claim;
ok("the claim closes for AR as Payment posted", g1.state === "closed" && g1.handoff_status === "posted", { state: g1.state, ho: g1.handoff_status });

S("Submission: goes to the team lead set on the client");
r = await T(async () => AR("queue.complete", { id: c2.id, ...subWork }));
ok("biller saves Need to Resubmit", r.ok && r.r.handoff && r.r.handoff.to === "Tina Lead", r.ok ? r.r.handoff : r);
const tiRows = (await TI("handoffs.list", {})).rows;
ok("it is on Tina's list at once", tiRows.some((x) => x.claim_id === c2.id && x.dept === "submission"), tiRows.map((x) => x.dept));
ok("Tina's bell shows it", (await TI("notify.list", {})).items.some((i) => i.key === "handoffs" && i.n >= 1));
r = await T(async () => TI("handoffs.close", { id: tiRows.find((x) => x.claim_id === c2.id).id, outcome: "complete", proof: { date: "2026-11-03", ref: "BATCH-77", mode: "Electronic" } }));
ok("Tina marks it Complete", r.ok, r);
ok("biller's bell: Tina Lead submitted claim …", (await bell(AR)).some((t) => /Tina Lead submitted claim/.test(t)), await bell(AR));
h = await mine(AR, c2.id);
ok("biller's My work: Submitted by Tina", h && h.handoff && h.handoff.status === "complete" && h.handoff.by === "Tina Lead", h && h.handoff);
const g2 = (await AR("claims.get", { id: c2.id })).claim;
ok("back with the biller for a 15-day follow-up", g2.handoff_status === "submitted" && !!g2.follow_up_on, { ho: g2.handoff_status, fu: g2.follow_up_on });

S("Snail sends one back: the biller sees it at once and it is on their list");
await AR("attachments.add", { claim_id: c3.id, name: "eob.pdf", type: "application/pdf", data: pdf });
await AR("queue.complete", { id: c3.id, ...postWork });
const back = (await SN("handoffs.list", {})).rows.find((x) => x.claim_id === c3.id);
r = await T(async () => SN("handoffs.close", { id: back.id, outcome: "back", reason: "Amount mismatch", note: "EOB amount does not match the ERA, please check with the payer" }));
ok("Snail sends it back with the reason", r.ok, r);
ok("biller's bell: sent claim … back to you", (await bell(AR)).some((t) => /sent claim .* back to you \(Amount mismatch\)/.test(t)), await bell(AR));
ok("on the biller's list again", (await AR("queue.list", {})).rows.some((x) => x.id === c3.id));
h = await mine(AR, c3.id);
ok("biller's My work: Back to you · Amount mismatch", h && h.handoff && h.handoff.status === "back" && h.handoff.reason === "Amount mismatch", h && h.handoff);

S("Change who does posting: open hand-offs follow");
await AR("attachments.add", { claim_id: c4.id, name: "eob.pdf", type: "application/pdf", data: pdf });
await AR("queue.complete", { id: c4.id, ...postWork });
await TI("clients.saveResponsibility", { client_id: sunrise.id, dept: "posting", mode: "person", lead: U("Tina Lead").id });
ok("the open posting hand-off moved from Snail to Tina", (await SN("handoffs.count")).n === 0 && (await TI("handoffs.list", {})).rows.some((x) => x.claim_id === c4.id && x.dept === "posting"));

S("Nobody set for posting on a client: the biller is told");
const lp = (await A("claims.list", { client_id: lake.id, state: "open", page_size: 2 })).rows;
await A("alloc.reassign", { ids: [lp[0].id], user_id: U("Bela Agent").id });
await BE("attachments.add", { claim_id: lp[0].id, name: "eob.pdf", type: "application/pdf", data: pdf });
r = await T(async () => BE("queue.complete", { id: lp[0].id, ...postWork }));
ok("saved, and the reply says nobody is set (the app warns the biller)", r.ok && r.r.handoff && r.r.handoff.mode === "unset", r.ok ? r.r.handoff : r);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
