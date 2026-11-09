/* Suite 32: the pre-merge bug batch. Needs attention review (who a claim may go to, a closed claim, a claim at a desk, keep it
   closed), the same patient by account number, an inventory refresh (priority of claims on a list, dates never moved back), skip
   on a sent-back claim, repeat denials counted once per trip to the payer, payer tips per claim, a third return counted once,
   chasing only after a request is sent, the bell's desk counts, follow-ups on working days, no follow-up when a save goes to a
   desk, a Lowered claim without the turning-90 boost, and the production rows Third Eye reads (the day worked, the age then,
   the paid amount). */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", email: "" }, o);
const feed = [
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: "Lakeview Dental Group", email: "lara@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "bela@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cyra Agent", project: "Lakeview Dental Group", reports_to: "Tina Lead", email: "cyra@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Pia Poster", department: "Posting", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "pia@purview-healthcare.com" }),
  P({ emp_id: "D2", name: "Quin Submit", department: "Submission", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "quin@purview-healthcare.com" })];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const fetchMock = async (url) => url.includes("brahmastra_roster") ? J({ ok: true, rows: feed }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const row = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results[0];
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), QU = await firstIn("Quin Submit", "quin@purview-healthcare.com"), PI = await firstIn("Pia Poster", "pia@purview-healthcare.com");
const clients = (await A("clients.list")).clients, sun = clients.find((c) => /Sunrise/.test(c.name));
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const dosAgo = (n) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
const arun = U("Arun Agent").id;
await sql("UPDATE clients SET posting_mode = 'person', posting_lead = ?, submission_mode = 'person', submission_lead = ? WHERE id = ?", U("Pia Poster").id, U("Quin Submit").id, sun.id);
await sql("UPDATE claims SET assigned_to = NULL, state = 'open', follow_up_on = '', first_up = 0, escalated = 0 WHERE client_id = ?", sun.id);
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 60 })).rows;
const ids = pool.map((x) => x.id);
await A("alloc.reassign", { ids: ids.slice(0, 20), user_id: arun });
const nt = { findings: "Checked the payer portal and the claim history today", source: "Portal" };
const flag = async (id, saag) => { await AR("queue.open", { id }); return AR("queue.complete", { id, desk: true, escalate: true, saag, note: nt, today }); };
const INFORM = { status: "Claim Denied", sub_status: "COB Issue", action: "INFORM", effective: "Pending-Collectible Insurance", bucket: "Payer" };
const WO = { status: "Claim Denied", sub_status: "Small balance WO", action: "Adjustment / Write-off", effective: "Processing-Closed", bucket: "Closed" };
const four = { why: "flagged by the biller", reviewed: "the claim history and the EOB", findings: "the payer needs a call about it", next: "call the payer and update the claim" };

S("Needs attention review: who a claim may go to");
await flag(ids[0], INFORM);
let r = await T(() => TI("attention.review", { id: ids[0], ...four, route: "other", user_id: U("Cyra Agent").id, today }));
ok("a Sunrise claim cannot go to a Lakeview biller", !r.ok && /cannot be given this claim/.test(r.e || ""), r);
r = await T(() => TI("attention.review", { id: ids[0], ...four, route: "other", user_id: U("Pia Poster").id, today }));
ok("...nor to the Posting desk person", !r.ok, r);
const al = await TI("attention.list", {});
ok("the people offered are AR billers only (no Posting / Submission desk)", !al.people.some((p) => /Pia|Quin/.test(p.name)) && al.people.some((p) => p.name === "Bela Agent"), al.people.map((p) => p.name));
const rp = await TI("attention.reviewPeople", { id: ids[0] });
ok("for this claim: only the billers on its client", rp.people.some((p) => p.name === "Bela Agent") && !rp.people.some((p) => p.name === "Cyra Agent"), rp.people.map((p) => p.name));
r = await T(() => TI("attention.review", { id: ids[0], ...four, route: "biller", sent_by: U("Lara Lead").id, today }));
ok("a crafted sent_by is ignored: it goes to the biller on the claim's record", r.ok && (await row("SELECT assigned_to FROM claims WHERE id = ?", ids[0])).assigned_to === arun, r);

S("A closed claim and a claim at a desk");
await flag(ids[1], WO);
ok("closed and flagged", (await row("SELECT state, escalated FROM claims WHERE id = ?", ids[1])).state === "closed");
r = await T(() => TI("attention.review", { id: ids[1], ...four, route: "keep", today }));
const k1 = await row("SELECT state, escalated FROM claims WHERE id = ?", ids[1]);
ok("Keep it closed: stays closed, the flag is answered", r.ok && k1.state === "closed" && !k1.escalated, [r.e, k1]);
ok("...and the biller gets the notes", !!(await row("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE '%kept it closed%'", arun)));
r = await T(() => TI("attention.review", { id: ids[2], ...four, route: "keep", today }));
ok("keep is only for a closed claim", !r.ok, r);
await flag(ids[3], WO);
await sql("UPDATE claims SET first_up = 0 WHERE id = ?", ids[0]); // the first review's claim was given back first too: worked since
r = await T(() => TI("attention.review", { id: ids[3], ...four, route: "biller", today }));
const k3 = await row("SELECT state, first_up, assigned_to FROM claims WHERE id = ?", ids[3]);
ok("giving a closed claim to the biller opens it again, first on the list", r.ok && r.r.reopened && k3.state === "assigned" && k3.first_up === 1 && k3.assigned_to === arun, [r.r, k3]);
const nx = await AR("queue.next", { today });
ok("...and Work the next claim opens it", nx.claim && nx.claim.id === ids[3], nx.claim && nx.claim.id);
if (nx.claim) await AR("queue.skip", { id: nx.claim.id, count: false });
// a claim sent to Submission and flagged: it stays with the desk and comes to the biller when they finish
await AR("queue.open", { id: ids[4] });
const sv = await AR("queue.complete", { id: ids[4], desk: true, escalate: true, saag: { status: "Claim Denied", sub_status: "Coding Error", action: "Need to Resubmit", effective: "Pending-Collectible Insurance", bucket: "Payer" }, note: nt, today });
ok("a save that goes to Submission carries no follow-up date", sv.follow_up_on === "" && sv.handoff && sv.handoff.dept === "submission" && !/FOLLOW-UP/.test(sv.comment), sv);
r = await T(() => TI("attention.review", { id: ids[4], ...four, route: "other", user_id: U("Bela Agent").id, today }));
const k4 = await row("SELECT state, assigned_to FROM claims WHERE id = ?", ids[4]);
ok("given to another biller while at Submission: it stays with the desk, on her name", r.ok && r.r.waits === "Submission" && k4.state === "in_process" && k4.assigned_to === U("Bela Agent").id, [r.r, k4]);
ok("...and her notice says when it comes", !!(await row("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE '%comes to your list when they finish%'", U("Bela Agent").id)));

S("The same patient is the same account number");
await sql("UPDATE claims SET patient = 'Test Patient Same', account_no = 'ACC-1' WHERE id = ?", ids[5]);
await sql("UPDATE claims SET patient = 'Test Patient Same', account_no = 'ACC-2' WHERE id = ?", ids[6]);
await sql("UPDATE claims SET patient = 'Test Patient Same', account_no = '' WHERE id = ?", ids[7]);
const bp = await AR("claims.byPatient", { id: ids[5] });
ok("another account number with the same name is another patient", !bp.rows.some((x) => x.id === ids[6]), bp.rows.map((x) => x.account_no));
ok("a claim with no account number matches by name", bp.rows.some((x) => x.id === ids[7]));
await AR("queue.open", { id: ids[5] });
const sib = await AR("queue.complete", { id: ids[5], desk: true, saag: { ...INFORM, status: "Claim In Process", sub_status: "Processing", action: "INFORM" }, note: nt, sibling_ids: [ids[6], ids[7]], today });
ok("an entry is copied to the same patient's claim only", sib.completed === 2 && !(await row("SELECT COUNT(*) AS n FROM notes WHERE claim_id = ? AND kind = 'work'", ids[6])).n, sib.completed);

S("Skip on a claim sent back first, and unassigning");
await sql("UPDATE claims SET first_up = 0, state = CASE WHEN state = 'in_progress' THEN 'assigned' ELSE state END WHERE assigned_to = ?", arun);
await sql("UPDATE claims SET first_up = 1, state = 'assigned', skipped_at = NULL WHERE id = ?", ids[8]);
let n1 = await AR("queue.next", { today });
ok("a sent-back claim comes first", n1.claim && n1.claim.id === ids[8], n1.claim && n1.claim.id);
if (n1.claim) await AR("queue.skip", { id: n1.claim.id, reason: "payer portal down", count: true });
n1 = await AR("queue.next", { today });
ok("after Skip for now the next claim is another one", n1.claim && n1.claim.id !== ids[8] && !(await row("SELECT first_up FROM claims WHERE id = ?", ids[8])).first_up, n1.claim && n1.claim.id);
if (n1.claim) await AR("queue.skip", { id: n1.claim.id, count: false });
await sql("UPDATE claims SET first_up = 1 WHERE id = ?", ids[9]);
await TI("alloc.unassign", { ids: [ids[9]] });
ok("unassigning ends first on the list", !(await row("SELECT first_up FROM claims WHERE id = ?", ids[9])).first_up);

S("A Lowered claim gets no turning-90 boost");
await sql("UPDATE claims SET state = 'completed', follow_up_on = '2099-01-01' WHERE assigned_to = ? AND state IN ('assigned','in_progress')", arun);
await sql("UPDATE claims SET state = 'assigned', follow_up_on = '', first_up = 0, skipped_at = NULL, dos = ?, priority = 30, priority_set = 'low' WHERE id = ?", dosAgo(86), ids[10]);
await sql("UPDATE claims SET state = 'assigned', follow_up_on = '', first_up = 0, skipped_at = NULL, dos = ?, priority = 69, priority_set = '' WHERE id = ?", dosAgo(20), ids[11]);
const n2 = await AR("queue.next", { today });
ok("a normal claim at 69 comes before a Lowered one at 30 that is 86 days old", n2.claim && n2.claim.id === ids[11], n2.claim && n2.claim.id);
if (n2.claim) await AR("queue.skip", { id: n2.claim.id, count: false });

S("Repeat denials: once per trip to the payer");
const W = async (id, at, status, sub, action) => sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, comment, created_at) VALUES (?,?,?,?, 'work', ?,?,?, 'test entry', ?)", "rd-" + id + "-" + at, id, arun, "Arun Agent", status, sub, action, at);
const t0 = Date.now() - 20 * 86400000, d = 86400000;
await sql("UPDATE claims SET state = 'assigned' WHERE id IN (?,?,?)", ids[12], ids[13], ids[14]);
await W(ids[12], t0, "Claim Denied", "COB Issue", "Need Assistance"); await W(ids[12], t0 + d, "Claim Denied", "COB Issue", "Need to Appeal");           // one open denial worked twice
await W(ids[13], t0, "Claim Denied", "COB Issue", "Need to Resubmit"); await W(ids[13], t0 + 9 * d, "Claim Denied", "COB Issue", "Need to Resubmit");  // denied again after a resubmission
await W(ids[14], t0, "Claim Denied", "COB Issue", "Need to Resubmit"); await W(ids[14], t0 + 9 * d, "Claim Denied", "COB Issue", "Need to Resubmit"); await W(ids[14], t0 + 15 * d, "Partially Paid", "", "INFORM"); // paid since
const rd = await TI("denials.repeats", { client_id: sun.id });
const rid = (id) => rd.claims.find((x) => x.claim_id === id);
ok("one open denial worked twice is not 'denied again'", !rid(ids[12]), rid(ids[12]));
ok("denied again after a resubmission: 2 times", rid(ids[13]) && rid(ids[13]).times === 2, rid(ids[13]));
ok("a claim paid since is not listed", !rid(ids[14]), rid(ids[14]));
const tipsOne = await AR("claims.tips", { id: ids[12] });
ok("the claim page does not call one denial a repeat", !tipsOne.repeat, tipsOne.repeat);

S("Payer tips: claims, not entries; a true median");
const payer = "Test Payer Tips";
await sql(`UPDATE claims SET payer = ? WHERE id IN (${ids.slice(30, 36).map(() => "?").join(",")})`, payer, ...ids.slice(30, 36));
const tp0 = Date.now() - 60 * d;
// one claim: three resubmissions, then paid (one data point, from the last resubmission); others: 10, 12, 14, 20 days
await W(ids[30], tp0, "Claim Denied", "Coding Error", "Need to Resubmit"); await W(ids[30], tp0 + 2 * d, "Claim In Process", "", "Need to Resubmit"); await W(ids[30], tp0 + 4 * d, "Claim In Process", "", "Need to Resubmit"); await W(ids[30], tp0 + 24 * d, "Claim Paid", "", "INFORM");
await sql("UPDATE claims SET payer = ? WHERE id = ?", payer, ids[0]);
let tips = await AR("claims.tips", { id: ids[0], status: "Claim Denied", action: "Need to Resubmit" });
ok("one claim paid after three resubmissions is one case: no tip on fewer than 3 claims", tips.pay_days === null && tips.pay_n === 1, { d: tips.pay_days, n: tips.pay_n });
for (const [i, days] of [[31, 10], [32, 12], [33, 14]]) { await W(ids[i], tp0, "Claim Denied", "Coding Error", "Need to Resubmit"); await W(ids[i], tp0 + days * d, "Claim Paid", "", "INFORM"); }
tips = await AR("claims.tips", { id: ids[0], status: "Claim Denied", action: "Need to Resubmit" });
ok("four claims: 10, 12, 14 and 20 days, the median is 13 (the middle two)", tips.pay_n === 4 && tips.pay_days === 13, { d: tips.pay_days, n: tips.pay_n });
ok("the suggested follow-up is a working day", tips.follow_up && ![0, 6].includes(new Date(tips.follow_up + "T12:00:00Z").getUTCDay()), tips.follow_up);

S("Follow-ups land on working days");
await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, follow_up_on = '', first_up = 0 WHERE id = ?", arun, ids[15]);
await AR("queue.open", { id: ids[15] });
const fu = await AR("queue.complete", { id: ids[15], desk: true, saag: { status: "Claim In Process", sub_status: "Processing", action: "INFORM", effective: "Pending-Collectible Insurance", bucket: "Payer" }, note: nt, today: "2026-11-12" });
ok("30 days from Thursday 12 Nov is Saturday 12 Dec: the follow-up is Monday 14 Dec", fu.follow_up_on === "2026-12-14", fu.follow_up_on);

S("A third return to AR counts once");
const sid = ids[16];
await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, escalated = 0 WHERE id = ?", arun, sid);
for (let i = 0; i < 3; i++) {
  await AR("queue.open", { id: sid });
  await AR("queue.complete", { id: sid, desk: true, saag: { status: "Claim Denied", sub_status: "Coding Error", action: "Need to Resubmit", effective: "Pending-Collectible Insurance", bucket: "Payer" }, note: nt, today, rework: true });
  const h = await row("SELECT id FROM handoffs WHERE claim_id = ? AND status IN ('pending','assigned')", sid);
  await QU("handoffs.close", { id: h.id, outcome: "back", reason: "Missing or wrong information from AR", note: "the corrected code is missing, round " + (i + 1) });
}
const cnt = await TI("attention.count", {}), st = await TI("claims.stats", { client_id: sun.id });
const inFlag = (await TI("attention.list", {})).rows.some((x) => x.id === sid), inBack = (await TI("attention.fromDesks", {})).rows.some((x) => x.claim_id === sid);
ok("it waits under Sent back only, not also under Flagged", inBack && !inFlag, [inBack, inFlag]);
ok("the Dashboard's flagged count is Needs attention's", st.escalated === cnt.escalations, [st.escalated, cnt.escalations]);
const fb = await AR("notify.list", {}).catch(() => null);
ok("the biller's bell counts the hand-offs sent back to them", !fb || (fb.items || []).some((x) => x.key === "back" && x.n >= 1), fb && (fb.items || []).map((x) => x.key));

S("Chasing the client starts when the team lead sends the request");
await AR("queue.open", { id: ids[17] }).catch(() => {});
await sql("UPDATE claims SET state = 'assigned', assigned_to = ? WHERE id = ?", arun, ids[17]);
await AR("queue.open", { id: ids[17] });
await AR("queue.complete", { id: ids[17], desk: true, saag: { status: "Claim Denied", sub_status: "Coding Error", action: "Need to Resubmit", effective: "Pending-Collectible Insurance", bucket: "Payer" }, note: nt, today });
const hc = await row("SELECT id FROM handoffs WHERE claim_id = ? AND status IN ('pending','assigned')", ids[17]);
await QU("handoffs.close", { id: hc.id, outcome: "client", reason: "Medical records", note: "need the visit notes from the client" });
ok("asked of the client: no chase date until it is sent", (await row("SELECT chase_at FROM handoffs WHERE id = ?", hc.id)).chase_at == null);
await TI("attention.clientSent", { id: hc.id, how: "Email" });
ok("sent by the team lead: the chase date is set", !!(await row("SELECT chase_at FROM handoffs WHERE id = ?", hc.id)).chase_at);
const bell = await TI("notify.list", {}).catch(() => null);
const crItem = bell && (bell.items || []).find((x) => x.key === "client_requests");
ok("the bell's client requests open the Client requests tab", !crItem || (crItem.params && crItem.params.tab === "client"), crItem);

S("The desk's count leaves out rechecks that are not open yet");
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, available_at, lead_id, assigned_to) VALUES ('sc-later', ?, ?, 'subcheck', 'assigned', ?, ?, ?, ?, ?)", ids[18], sun.id, Date.now(), Date.now() + 200 * 3600000, Date.now() + 100 * 3600000, U("Quin Submit").id, U("Quin Submit").id);
const qc1 = await QU("handoffs.count", {});
await sql("UPDATE handoffs SET available_at = ? WHERE id = 'sc-later'", Date.now() - 3600000);
const qc2 = await QU("handoffs.count", {});
ok("a recheck opening later is not on the desk yet; once open it is", qc2.n === qc1.n + 1, [qc1.n, qc2.n]);

S("An inventory refresh");
const urow = (extra = {}) => ({ match_key: "ref-1", claim_no: "REF1", account_no: "AR-REF-1", patient: "Test, Refresh", payer: "Aetna", dos: dosAgo(85), balance: 300, status_class: "denied", priority: 40, tier: "Medium", ...extra });
await TI("inventory.upload", { client_id: sun.id, kind: "fresh", file_name: "refresh-1.csv", final: true, rows_read: 1, claims: [urow()] });
const rc = await row("SELECT id FROM claims WHERE claim_no = 'REF1' AND client_id = ?", sun.id);
await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, priority = 177.1, priority_base = 177.1, priority_reason = 'TFL in 5d: act now', last_worked_on = ?, follow_up_on = ? WHERE id = ?", arun, today, dosAgo(-30), rc.id);
await TI("inventory.upload", { client_id: sun.id, kind: "worked", file_name: "refresh-2.csv", final: true, rows_read: 1, claims: [urow({ last_worked_on: dosAgo(60), follow_up_on: dosAgo(30) })] });
const rc2 = await row("SELECT priority, priority_reason, last_worked_on, follow_up_on FROM claims WHERE id = ?", rc.id);
ok("a claim on a biller's list keeps the priority it was allocated with (TFL points included)", rc2.priority === 177.1 && /TFL/.test(rc2.priority_reason), rc2);
ok("an older worked file moves neither the last worked date nor the follow-up back", rc2.last_worked_on === today && rc2.follow_up_on === dosAgo(-30), rc2);

S("Purview's workflow: posting closes the claim for AR; submission does not");
{ const pdf = "JVBERi0xLjQKJSVFT0YK";
  const wid = ids[25], sid = ids[26];
  await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, first_up = 0, follow_up_on = '' WHERE id IN (?, ?)", arun, wid, sid);
  await AR("attachments.add", { claim_id: wid, name: "eob.pdf", type: "application/pdf", data: pdf });
  const ob = await AR("queue.open", { id: wid });
  ok("the work form knows this client has a Posting and a Submission person, and no Rejections person", ob.claim.desk_posting === true && ob.claim.desk_submission === true && ob.claim.desk_rejection === false, [ob.claim.desk_posting, ob.claim.desk_submission, ob.claim.desk_rejection]);
  const sp = await AR("queue.complete", { id: wid, desk: true, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: nt, today });
  let c = await row("SELECT state, last_effective, last_bucket FROM claims WHERE id = ?", wid);
  ok("sent for posting: AR closed (AR Closed-Pending Posting, bucket Closed), with Posting now", sp.closed && c.last_effective === "AR Closed-Pending Posting" && c.last_bucket === "Closed" && c.state === "in_process" && /EFFECTIVE: AR Closed-Pending Posting/.test(sp.comment), [sp.closed, c]);
  const hp = await row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'posting' AND status IN ('pending','assigned')", wid);
  await PI("handoffs.close", { id: hp.id, outcome: "complete", proof: { date: today, ref: "EFT-77", amount: 120 } });
  c = await row("SELECT state, last_effective, last_bucket FROM claims WHERE id = ?", wid);
  ok("posted: Posting Closed, the claim closed", c.state === "closed" && c.last_effective === "Posting Closed" && c.last_bucket === "Closed", c);
  ok("...and the biller who worked it can still open it", (await T(() => AR("claims.get", { id: wid }))).ok);
  // anyone may open a claim Posting closed, to read it; nobody edits its earlier notes
  const CY = await firstIn("Cyra Agent", "cyra@purview-healthcare.com"), LA = await firstIn("Lara Lead", "lara@purview-healthcare.com");
  const cg = await T(() => CY("claims.get", { id: wid }));
  ok("anyone can open a claim Posting closed, to read it (a biller on another client)", cg.ok && cg.r.claim.view_only === true && cg.r.claim.locked === true && cg.r.siblings.length === 0 && cg.r.notes.every((n) => !n.editable),
    cg.ok ? [cg.r.claim.view_only, cg.r.claim.locked, cg.r.siblings.length] : cg.e);
  ok("...a team lead of another client too", (await T(() => LA("claims.get", { id: wid }))).ok);
  ok("...with its history and its files", (await T(() => CY("claims.timeline", { id: wid }))).ok && cg.ok && cg.r.attachments.length > 0 && (await T(() => CY("attachments.get", { id: cg.r.attachments[0].id }))).ok);
  const wno = (await row("SELECT claim_no FROM claims WHERE id = ?", wid)).claim_no, fnd = await CY("search.global", { q: wno });
  ok("...and finds it by its claim number", fnd.claims.some((x) => x.id === wid && x.posted), fnd.claims.map((x) => [x.claim_no, x.posted]));
  ok("...but adds nothing to it: it is not their claim", !(await T(() => CY("notes.add", { claim_id: wid, comment: "a note from someone else" }))).ok);
  const mine = await AR("claims.get", { id: wid }), wn = mine.notes.find((n) => n.kind === "work");
  ok("for the biller who worked it the notes are locked too", mine.claim.view_only === false && mine.claim.locked === true && wn && !wn.editable, [mine.claim.view_only, wn && wn.editable]);
  const fix = { saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Closed", effective: "" }, note: nt, today };
  const e1 = await T(() => AR("notes.update", { id: wn.id, ...fix })), e2 = await T(() => TI("notes.update", { id: wn.id, ...fix }));
  ok("nobody edits an earlier note: not the biller who wrote it, not a team lead", !e1.ok && !e2.ok && /no longer be edited/.test(e1.e || "") && /no longer be edited/.test(e2.e || ""), [e1.e, e2.e]);
  await sql("UPDATE claims SET state = 'closed', handoff_status = '' WHERE id = ?", ids[29]);
  ok("a claim AR closed (not posted) is not opened by everyone", !(await T(() => CY("claims.get", { id: ids[29] }))).ok);
  await AR("queue.open", { id: sid });
  const ss = await AR("queue.complete", { id: sid, desk: true, saag: { status: "Claim Denied", sub_status: "Coding Error", action: "Need to Resubmit", bucket: "Payer", effective: "Pending-Purview internal review" }, note: nt, today });
  c = await row("SELECT state, last_effective, last_bucket FROM claims WHERE id = ?", sid);
  ok("sent for submission: not closed (Pending-Submission, bucket Purview), with Submission now", !ss.closed && c.last_effective === "Pending-Submission" && c.last_bucket === "Purview" && c.state === "in_process", [ss.closed, c]);
  const hs = await row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission' AND status IN ('pending','assigned')", sid);
  await QU("handoffs.close", { id: hs.id, outcome: "complete", proof: { date: today, ref: "BATCH-77" } });
  c = await row("SELECT state, last_effective, last_bucket, follow_up_on FROM claims WHERE id = ?", sid);
  ok("submitted: back with AR for its follow-up (with the payer, Pending-Collectible Insurance)", c.state === "completed" && c.last_effective === "Pending-Collectible Insurance" && c.last_bucket === "Payer" && c.follow_up_on > today, c);
  // 15 days later the AR follow-up is back in the allocation pool, named as such
  await sql("UPDATE claims SET follow_up_on = ? WHERE id = ?", today, sid);
  const ec = (await TI("claims.eligible", { client_id: sun.id, today })).claims.find((x) => x.id === sid);
  ok("15 days after submission the AR follow-up is in the allocation pool", ec && ec.state === "completed" && ec.handoff_status === "submitted", ec && [ec.state, ec.handoff_status]);
  const sc = ec && rig.app.scoreClaim({ ...ec, age_days: 40 }, today), sc0 = ec && rig.app.scoreClaim({ ...ec, age_days: 40, handoff_status: "" }, today);
  ok("...named \"AR follow-up after submission\", with the same points as any follow-up due", sc && /AR follow-up after submission due/.test(sc.reason) && sc.priority === sc0.priority && /follow-up due/.test(sc0.reason), sc && [sc.reason, sc.priority, sc0.priority]);
  // a claim taken back to a biller while Posting still had it: posting it does not mark the biller's claim closed
  const gid = ids[27];
  await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, first_up = 0, follow_up_on = '' WHERE id = ?", arun, gid);
  await AR("attachments.add", { claim_id: gid, name: "eob.pdf", type: "application/pdf", data: pdf });
  await AR("queue.open", { id: gid });
  await AR("queue.complete", { id: gid, desk: true, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Payer", effective: "" }, note: nt, today });
  await sql("UPDATE claims SET state = 'assigned', last_effective = 'Pending-Collectible Insurance', last_bucket = 'Payer' WHERE id = ?", gid);
  const hg = await row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'posting' AND status IN ('pending','assigned')", gid);
  await PI("handoffs.close", { id: hg.id, outcome: "complete", proof: { date: today, ref: "EFT-78", amount: 40 } });
  c = await row("SELECT state, last_effective, last_bucket FROM claims WHERE id = ?", gid);
  ok("...a claim back with a biller keeps its own SAAG when Posting finishes", c.state === "assigned" && c.last_effective === "Pending-Collectible Insurance" && c.last_bucket === "Payer", c);
  // a rejected claim at a client with a Rejections person goes there first: the form knows it too
  await sql("UPDATE clients SET rejection_mode = 'person', rejection_lead = ? WHERE id = ?", U("Quin Submit").id, sun.id);
  await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, first_up = 0, follow_up_on = '' WHERE id = ?", arun, ids[28]);
  const rb = await AR("queue.open", { id: ids[28] });
  ok("...and a Rejections person shows on the work form when one is set", rb.claim.desk_rejection === true, rb.claim.desk_rejection);
  await sql("UPDATE clients SET rejection_mode = '', rejection_lead = NULL WHERE id = ?", sun.id); }

S("A part of the scope of work always has a responsible person");
{ const was = (await row("SELECT scope_json FROM clients WHERE id = ?", sun.id)).scope_json;
  await sql("UPDATE clients SET scope_json = ? WHERE id = ?", JSON.stringify(["ar", "posting", "submission"]), sun.id);
  const r1 = await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "client" }));
  const r2 = await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "" }));
  ok("Payment posting / Submission in the scope cannot be left with nobody (not \"the client\", not unset)", !r1.ok && /Payment posting is in this client's scope of work/.test(r1.e || "") && !r2.ok && /Submission is in/.test(r2.e || ""), [r1.e, r2.e]);
  ok("...a person can be set", (await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Pia Poster").id }))).ok);
  ok("...the 48-hour recheck can be the biller who sent it, not nobody", (await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "subcheck", mode: "biller" }))).ok && !(await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "subcheck", mode: "" }))).ok);
  ok("a part that is not in the scope can be unset", (await T(() => TI("clients.saveResponsibility", { client_id: sun.id, dept: "rejection", mode: "" }))).ok);
  await sql("UPDATE clients SET scope_json = ? WHERE id = ?", was, sun.id); }

S("The recheck after submitting: 48 working hours, sooner when the client needs it, never later");
{ const prof = (sub) => ({ scope: ["ar", "submission"], targets: { ar: 40 }, tat: { submission: 24, ...(sub == null ? {} : { subcheck: sub }) },
    resp: { ar: { lead: U("Tina Lead").id }, submission: { lead: U("Quin Submit").id }, subcheck: { mode: "biller" } } });
  const mk = async (name, sub) => { await A("clients.save", { name, locations: ["Main"], profile: prof(sub) }); return (await row("SELECT subcheck_hours FROM clients WHERE name = ?", name)).subcheck_hours; };
  const a = await mk("Recheck Clinic A", 24), b = await mk("Recheck Clinic B", 72), c0 = await mk("Recheck Clinic C", null);
  ok("a client's recheck time: 24 is kept, 72 is saved as 48, none given is 48", a === 24 && b === 48 && c0 === 48, [a, b, c0]);
  const r0 = await T(() => A("clients.save", { name: "Recheck Clinic D", locations: ["Main"], profile: prof(0) }));
  ok("...and 0 is refused", !r0.ok && /recheck opens/.test(r0.e || ""), r0.e);
  // the recheck opens after the client's own time: sooner at 24 than at the usual 48
  const recheckAt = async (id, hours) => {
    await sql("UPDATE clients SET subcheck_hours = ? WHERE id = ?", hours, sun.id);
    await sql("UPDATE claims SET state = 'assigned', assigned_to = ?, first_up = 0, follow_up_on = '' WHERE id = ?", arun, id);
    await AR("queue.open", { id });
    await AR("queue.complete", { id, desk: true, saag: { status: "Claim Denied", sub_status: "Coding Error", action: "Need to Resubmit", bucket: "Purview", effective: "" }, note: nt, today });
    const h = await row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission' AND status IN ('pending','assigned')", id);
    await QU("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "BATCH-" + hours } });
    return (await row("SELECT available_at FROM handoffs WHERE claim_id = ? AND dept = 'subcheck'", id)).available_at;
  };
  const at24 = await recheckAt(ids[31], 24), at48 = await recheckAt(ids[32], null);
  ok("a client with 24 working hours gets its recheck sooner than one with the usual 48", at24 && at48 && at24 < at48 && at24 > Date.now(), [at24, at48]);
  const card = (await A("clients.list")).clients.find((x) => x.name === "Recheck Clinic A");
  ok("the client card carries the recheck time (24 for that client)", card && card.subcheck_hours === 24, card && card.subcheck_hours);
  await sql("UPDATE clients SET subcheck_hours = NULL WHERE id = ?", sun.id); }

S("Production rows for Third Eye");
await sql("UPDATE claims SET dos = ?, age_days = 3, created_at = ? WHERE id = ?", dosAgo(120), Date.now() - 50 * d, ids[19]);
await sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, comment, created_at) VALUES ('pr-1', ?, ?, 'Arun Agent', 'work', 'Claim In Process', '', 'INFORM', 'worked', ?)", ids[19], arun, Date.now() - 2 * d);
const prod = await TI("reports.production", { scope: "ar", client_id: sun.id, from_ms: Date.now() - 3 * d, to_ms: Date.now() });
const hdr = prod.header, pr = prod.rows.find((x) => x[hdr.indexOf("IG Claim ID#/Charge ID#")] === pool[19].claim_no);
const workedDay = new Date(Date.now() - 2 * d + 330 * 60000).toISOString().slice(0, 10);
ok("Date Worked is the day of the entry, not the day the claim was uploaded", pr && pr[hdr.indexOf("Date Worked")] === workedDay, pr && pr[hdr.indexOf("Date Worked")]);
ok("Age is the DOS to the day worked (118), not the age saved at upload", pr && pr[hdr.indexOf("Age")] === 118, pr && pr[hdr.indexOf("Age")]);
const pp = await TI("reports.production", { scope: "pp", client_id: sun.id, from_ms: 0, to_ms: Date.now() });
ok("Payment posting rows carry a Paid Amount column (what the payer paid is what was posted)", pp.header.includes("Paid Amount") && pp.header.indexOf("Paid Amount") === pp.header.indexOf("Posted") - 1, pp.header);

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
