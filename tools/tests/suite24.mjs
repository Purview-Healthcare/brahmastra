/* Suite 24: the biller's day and the desks, after the bug hunt. Claim numbers that differ only by year or line stay different claims;
   undoing an upload keeps what anyone touched and puts back what a refresh changed; one save of a claim counts once; skips count;
   call times, long findings and follow-up dates are checked; claims go only to billers on the client; hand-offs close once, reach the
   right people, survive a deactivated lead and a deleted client; SR numbers stay unique; Needs attention sees escalations at a desk. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const rig = await makeRig({});
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results; const row = async (q, ...a) => (await rows(q, ...a))[0];
const today = new Date().toISOString().slice(0, 10);
const users = (await A("users.list")).users;
const asUser = async (u) => { await sql("UPDATE users SET pass_hash='', pass_salt='', must_change=0 WHERE id = ?", u.id); await as(null)("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + u.id) }); return as((await login(u.email, "pw-" + u.id)).token); };
const mkUser = async (first, last, dept = "") => {
  const email = (first + "." + last + "@purview-healthcare.com").toLowerCase();
  const u = (await A("users.save", { first_name: first, last_name: last, email, role: "user", designation: "Biller", capacity: 35 })).user;
  if (dept) await sql("UPDATE users SET department = ? WHERE id = ?", dept, u.id);
  return { ...u, call: await asUser(u) };
};
const W = (extra = {}) => ({ saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, ...extra,
  note: { source: "Portal", findings: "Checked the portal, claim in process", ...(extra.note || {}) } });
const aisha = users.find((u) => u.name === "Aisha Verma"), sup = users.find((u) => u.role === "supervisor" && !u.is_admin) || users.find((u) => u.role === "supervisor");
const AI = await asUser(aisha);

await A("clients.save", { name: "Zeta Clinic", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 30 }, resp: { ar: { lead: sup.id } } } });
const z = (await A("clients.list")).clients.find((c) => c.name === "Zeta Clinic");
const mk = (claim_no, patient, dos, bal, extra = {}) => ({ match_key: "claim:" + claim_no.toLowerCase(), claim_no, patient, payer: "Aetna", dos, balance: bal, lines: 1, status_class: "denied", ...extra });
const up = (file, claims, extra = {}) => A("inventory.upload", { client_id: z.id, kind: "fresh", file_name: file, claims, final: true, rows_read: claims.length, ...extra });

S("Claim numbers: a year prefix or a line suffix makes a different claim");
await up("f1.csv", [mk("CLM-2024-00001", "Doe, Jane", "2026-08-01", 100), mk("CLM-2024-00002", "Roe, Rick", "2026-08-02", 200)]);
let r = await up("f2.csv", [mk("CLM-2025-00001", "Smith, Ann", "2026-09-10", 999)]);
ok("CLM-2025-00001 is a new claim, not a refresh of CLM-2024-00001", r.inserted === 1 && r.updated === 0, r);
const jane = await row("SELECT claim_no, patient, balance FROM claims WHERE client_id = ? AND patient = 'Doe, Jane'", z.id);
ok("Doe, Jane's claim is untouched", jane && jane.claim_no === "CLM-2024-00001" && jane.balance === 100, jane);
r = await up("f3.csv", [mk("77777/1", "Line, One", "2026-08-05", 10), mk("77777/2", "Line, Two", "2026-08-06", 20)]);
ok("77777/1 and 77777/2 are two claims", r.inserted === 2, r);
const dd = await A("inventory.dedupe", { client_id: z.id, dry_run: true });
ok("dedupe finds no duplicates among them", dd.duplicates === 0, dd);
r = await up("f3b.csv", [mk("CLM 0012345", "Same, One", "2026-08-07", 5)]);
r = await up("f3c.csv", [mk("clm-12345", "Same, One", "2026-08-07", 6)]);
ok("one number written two ways is still one claim", r.updated === 1 && r.inserted === 0, r);
r = await up("dup.csv", [mk("D-55555", "Dup, A", "2026-08-01", 5), mk("d55555", "Dup, C", "2026-08-01", 7)]);
ok("two spellings of one number in one file load once", r.inserted === 1 && r.skipped === 1, r);

S("Undo an upload");
const b3 = (await A("inventory.batches", { client_id: z.id })).batches.find((b) => b.file_name === "f3.csv");
const l1 = await row("SELECT id FROM claims WHERE client_id = ? AND claim_no = '77777/1'", z.id), l2 = await row("SELECT id FROM claims WHERE client_id = ? AND claim_no = '77777/2'", z.id);
await A("alloc.reassign", { ids: [l1.id], user_id: aisha.id });
r = await A("inventory.undoBatch", { batch_id: b3.id });
ok("the claim on a biller's list stays, the untouched one goes", r.removed === 1 && r.kept === 1, r);
ok("the kept claim is still there", !!(await row("SELECT id FROM claims WHERE id = ?", l1.id)) && !(await row("SELECT id FROM claims WHERE id = ?", l2.id)));
ok("no history left behind for the removed claim", (await row("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ?", l2.id)).n === 0);
r = await up("f4.csv", [mk("CLM-2024-00002", "Roe, Rick", "2026-08-02", 0, { exclude_reason: "closed", status_class: "paid" })]);
ok("refresh closes the claim", r.closed === 1 && (await row("SELECT state FROM claims WHERE client_id = ? AND claim_no = 'CLM-2024-00002'", z.id)).state === "closed", r);
const b4 = (await A("inventory.batches", { client_id: z.id })).batches.find((b) => b.file_name === "f4.csv");
r = await A("inventory.undoBatch", { batch_id: b4.id });
ok("undoing the refresh reopens it", r.reverted === 1 && (await row("SELECT state FROM claims WHERE client_id = ? AND claim_no = 'CLM-2024-00002'", z.id)).state === "open", r);

S("A header-only file is not the month's inventory");
const month = (await row("SELECT strftime('%Y-%m', 'now', '+330 minutes') AS m")).m;
await sql("DELETE FROM client_monthend WHERE client_id = ?", z.id);
await up("headers.csv", []);
ok("month-end inventory is not ticked by an empty file", !(await row("SELECT * FROM client_monthend WHERE client_id = ? AND month = ? AND step = 'inventory'", z.id, month)));
await up("real.csv", [mk("NEW-90001", "New, Patient", "2026-08-09", 50)]);
ok("a file with claims ticks it", !!(await row("SELECT * FROM client_monthend WHERE client_id = ? AND month = ? AND step = 'inventory'", z.id, month)));

S("One save counts once");
let q = (await AI("queue.list", {})).rows.filter((x) => x.state === "assigned");
const c1 = q[0];
await AI("queue.open", { id: c1.id });
const two = await Promise.all([T(() => AI("queue.complete", { id: c1.id, ...W(), desk: true })), T(() => AI("queue.complete", { id: c1.id, ...W(), desk: true }))]);
ok("two saves at once: one goes through", two.filter((x) => x.ok).length === 1, two);
r = await T(() => AI("queue.complete", { id: c1.id, ...W() }));
ok("a stale tab's save later is refused", !r.ok && /already saved/i.test(r.e), r);
ok("one work entry, one touch", (await row("SELECT COUNT(*) AS n FROM notes WHERE claim_id = ? AND kind = 'work'", c1.id)).n === 1 && (await row("SELECT touches FROM claims WHERE id = ?", c1.id)).touches === 1);
r = await T(() => AI("queue.complete", { id: c1.id, ...W(), rework: true }));
ok("a new entry asked for on purpose (from the claim) is still allowed", r.ok, r);

S("Skips");
q = (await AI("queue.list", {})).rows.filter((x) => x.state === "assigned");
const skipsBefore = (await row("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND kind = 'skip'", aisha.id)).n;
for (let i = 0; i < 2; i++) { await AI("queue.open", { id: q[i].id }); await AI("queue.skip", { id: q[i].id, reason: "" }); }
await AI("queue.open", { id: q[2].id }); await AI("queue.skip", { id: q[2].id, reason: "portal down" });
ok("every skip counts, with or without a reason", (await row("SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND kind = 'skip'", aisha.id)).n === skipsBefore + 3);
await AI("queue.open", { id: q[3].id }); await AI("queue.skip", { id: q[3].id, reason: "typed then cancelled", count: false });
ok("Back to my day is not a skip, even with a reason sent", !(await row("SELECT id FROM notes WHERE claim_id = ? AND kind = 'skip'", q[3].id)));

S("The work entry: call times, findings, follow-up");
q = (await AI("queue.list", {})).rows.filter((x) => x.state === "assigned");
r = await T(() => AI("queue.complete", { id: q[0].id, ...W({ note: { source: "Call", ref: "R1", call_start: "10:30", call_end: "10:00" } }) }));
ok("a call that ends before it starts is refused", !r.ok && /before its start/i.test(r.e), r);
r = await T(() => AI("queue.complete", { id: q[0].id, ...W({ note: { source: "Call", ref: "R1", call_start: "23:50", call_end: "00:10" } }) }));
ok("a call past midnight is 20 minutes", r.ok && (await row("SELECT call_min FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC", q[0].id)).call_min === 20, r);
r = await T(() => AI("queue.complete", { id: q[1].id, ...W({ note: { findings: "word ".repeat(1000) + "END" } }) }));
ok("findings over 4,000 characters are refused, not cut", !r.ok && /too long/i.test(r.e), r);
const long = "checked ".repeat(480) + "END";
r = await T(() => AI("queue.complete", { id: q[1].id, ...W({ note: { findings: long } }) }));
const lf = await row("SELECT fields_json FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC", q[1].id);
ok("findings under the limit are kept whole", r.ok && JSON.parse(lf.fields_json).findings.endsWith("END"), r);
r = await T(() => AI("queue.complete", { id: q[2].id, ...W({ follow_up_on: "2099-12-31" }) }));
ok("a follow-up years ahead is refused", !r.ok && /within a year/i.test(r.e), r);

S("Who can be given a client's claims");
const zopen = (await A("claims.list", { client_id: z.id, state: "open", page_size: 10 })).rows;
r = await T(() => A("alloc.apply", { client_id: z.id, assignments: [{ id: zopen[0].id, user_id: sup.id, priority: 1 }] }));
ok("not a team lead", !r.ok, r);
const nAlloc = (await row("SELECT COUNT(*) AS n FROM allocations")).n;
r = await T(() => A("alloc.apply", { client_id: z.id, assignments: [{ id: zopen[0].id, user_id: "nobody", priority: 1 }] }));
ok("unknown people: refused, no empty allocation saved", !r.ok && (await row("SELECT COUNT(*) AS n FROM allocations")).n === nAlloc, r);
const cls = (await A("clients.list")).clients, sun = cls.find((c) => c.name.startsWith("Sunrise")), lake = cls.find((c) => c.name.startsWith("Lake"));
const priya = users.find((u) => u.name === "Priya Nair");
await sql("UPDATE users SET source = 'roster', projects_json = ? WHERE id = ?", JSON.stringify([{ name: "Sunrise Eye Care" }]), priya.id);
await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(["Sunrise Eye Care"]), sun.id);
const lc = (await A("claims.list", { client_id: lake.id, state: "open", page_size: 3 })).rows[0];
r = await T(() => A("alloc.reassign", { ids: [lc.id], user_id: priya.id }));
ok("not a biller whose projects leave out the client", !r.ok && /cannot be given/i.test(r.e), r);
const sc = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 3 })).rows[0];
r = await T(() => A("alloc.reassign", { ids: [sc.id], user_id: priya.id }));
ok("a biller on the client: yes", r.ok && r.r.changed === 1, r);
const myClients = (await AI("clients.list")).clients.map((c) => c.id);
const hers = (await rows("SELECT DISTINCT client_id FROM claims WHERE assigned_to = ? OR last_worked_by = ?", aisha.id, aisha.id)).map((x) => x.client_id).sort();
ok("a biller added by hand sees only the clients they have claims of", JSON.stringify([...myClients].sort()) === JSON.stringify(hers) && hers.length < cls.length, { myClients, hers });

S("Desks: set up");
const cl = sun;
const P = await mkUser("Pat", "Post", "Posting"), Sb = await mkUser("Sue", "Sub", "Submission"), R = await mkUser("Rex", "Rej", "Submission"), C = await mkUser("Chet", "Check", "Submission");
const P2 = await mkUser("Pia", "Backup", "Posting");
await A("clients.saveResponsibility", { client_id: cl.id, dept: "posting", mode: "person", lead: P.id, backup: P2.id });
await A("clients.saveResponsibility", { client_id: cl.id, dept: "submission", mode: "person", lead: Sb.id });
await A("clients.saveResponsibility", { client_id: cl.id, dept: "rejection", mode: "person", lead: R.id });
await A("clients.saveResponsibility", { client_id: cl.id, dept: "subcheck", mode: "person", lead: C.id });
const pool = (await A("claims.list", { client_id: cl.id, state: "open", page_size: 100 })).rows; let pi = 0;
const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
const billers = [priya];
const PR = await asUser(priya);
const send = async (action = "Need to Post/Posting Correction", status = "Claim Paid", extra = {}, claim = null) => {
  const c = claim || pool[pi++];
  await A("alloc.reassign", { ids: [c.id], user_id: priya.id });
  await PR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: pdf });
  const res = await PR("queue.complete", { id: c.id, saag: { status, sub_status: "EOB Available", action, bucket: "Purview", effective: "Paid" }, note: { source: "Portal", findings: "Paid per the portal, EOB attached" }, rework: true, ...extra });
  return { c, h: await row("SELECT * FROM handoffs WHERE claim_id = ? ORDER BY created_at DESC LIMIT 1", c.id), res };
};
ok("billers ready", billers.length === 1);

S("Needs attention sees an escalation at a desk");
let { c, h } = await send(undefined, undefined, { escalate: true });
ok("escalated in the same save that hands it off: listed", (await A("attention.list", {})).rows.some((x) => x.id === c.id) && (await A("attention.count", {})).escalations >= 1);
await P.call("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "CHK1" } });
ok("still listed after Posting closes the claim", (await A("attention.list", {})).rows.some((x) => x.id === c.id));
r = await T(() => A("attention.answer", { id: c.id, comment: "Answered for the biller, posted fine" }));
ok("it can be answered", r.ok, r);
r = await T(() => A("attention.answer", { id: c.id, comment: "Answered again for the biller" }));
ok("answer on a claim that is not escalated is refused", !r.ok, r);
r = await T(() => A("attention.review", { id: pool[90].id, why: "just because", reviewed: "the claim history", findings: "nothing special here", next: "post it please now", route: "dept", dept: "posting", today }));
ok("review of a claim never escalated or sent back is refused", !r.ok && /not waiting for a review/i.test(r.e), r);

S("Hand-offs close once");
({ c, h } = await send("Need to Resubmit", "Claim Denied"));
const both = await Promise.all([T(() => Sb.call("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "B1", mode: "EDI" } })), T(() => A("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "B2", mode: "EDI" } }))]);
ok("two closes at once: one goes through", both.filter((x) => x.ok).length === 1 && /already closed/.test((both.find((x) => !x.ok) || {}).e || ""), both);
ok("one recheck, one done event", (await rows("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'subcheck'", c.id)).length === 1 && (await rows("SELECT id FROM claim_events WHERE claim_id = ? AND kind = 'handoff_done'", c.id)).length === 1);

S("Rechecks and notices go to the AR biller");
await A("clients.saveResponsibility", { client_id: cl.id, dept: "subcheck", mode: "biller" });
({ c, h } = await send("Need to Resubmit", "Claim Denied"));
await Sb.call("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "B3", mode: "EDI" } });
let chk = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'subcheck' AND status = 'assigned'", c.id);
ok("recheck (mode biller) is the biller's", chk && chk.assigned_to === priya.id, chk);
await sql("UPDATE handoffs SET available_at = 0 WHERE id = ?", chk.id);
await A("handoffs.close", { id: chk.id, outcome: "rejected", reason: "Payer rejected", note: "Rejected again for the member id" });
const rej = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'rejection' AND status = 'pending'", c.id);
await sql("DELETE FROM user_notices");
await R.call("handoffs.close", { id: rej.id, outcome: "back", reason: "Other", note: "need the right member id please" });
const ns = await rows("SELECT user_id FROM user_notices");
ok("Rejections sending it back tells the biller, not the team lead who rejected the recheck", ns.some((n) => n.user_id === priya.id) && !ns.some((n) => n.user_id === sup.id), ns);
({ c, h } = await send("Need to Resubmit", "Claim Denied"));
await Sb.call("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "B4", mode: "EDI" } });
chk = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'subcheck' AND status = 'assigned'", c.id);
await sql("UPDATE handoffs SET available_at = 0 WHERE id = ?", chk.id);
await A("handoffs.close", { id: chk.id, outcome: "rejected", reason: "Payer rejected", note: "Rejected again for the member id" });
const rej2 = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'rejection' AND status = 'pending'", c.id);
await R.call("handoffs.close", { id: rej2.id, outcome: "complete", proof: { date: today, ref: "B5", mode: "EDI", code: "Subscriber / member ID invalid" } });
chk = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'subcheck' AND status = 'assigned'", c.id);
ok("the next recheck is the biller's too, not the rejecter's", chk && chk.assigned_to === priya.id, chk && { assigned_to: chk.assigned_to });
await A("clients.saveResponsibility", { client_id: cl.id, dept: "subcheck", mode: "person", lead: C.id });

S("A paid claim is not reopened by a later rejected recheck");
({ c, h } = await send("Need to Resubmit", "Claim Denied"));
await Sb.call("handoffs.close", { id: h.id, outcome: "complete", proof: { date: today, ref: "B6", mode: "EDI" } });
chk = await row("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'subcheck' AND status = 'assigned'", c.id);
const ph = await send(undefined, undefined, {}, c);
await P.call("handoffs.close", { id: ph.h.id, outcome: "complete", proof: { date: today, ref: "CHK9" } });
await sql("UPDATE handoffs SET available_at = 0 WHERE id = ?", chk.id);
await C.call("handoffs.close", { id: chk.id, outcome: "rejected", reason: "Payer rejected", note: "Rejected for the member id" });
const pc = await row("SELECT state, handoff_status FROM claims WHERE id = ?", c.id);
ok("still closed, Payment posted", pc.state === "closed" && pc.handoff_status === "posted", pc);

S("The third return: the biller who sent it is the AR biller");
({ c, h } = await send());
for (let i = 0; i < 3; i++) {
  const hh = await row("SELECT * FROM handoffs WHERE claim_id = ? AND status = 'pending'", c.id);
  await P.call("handoffs.close", { id: hh.id, outcome: "back", reason: "Other", note: "return number " + (i + 1) + " please fix" });
  if (i < 2) await send(undefined, undefined, {}, c);
}
// the third return waits under Sent back (once, not also under Flagged), sent by the AR biller
const ar = (await A("attention.fromDesks", {})).rows.find((x) => x.claim_id === c.id);
ok("escalated, sent by the biller", ar && ar.sent_by_id === priya.id && !(await A("attention.list", {})).rows.some((x) => x.id === c.id) && (await row("SELECT escalated FROM claims WHERE id = ?", c.id)).escalated === 1, ar && ar.sent_by_id);
r = await T(() => A("attention.review", { id: c.id, why: "bounced 3 times", reviewed: "claim history and eob", findings: "eob was missing each time", next: "attach the eob and resend", route: "biller", sent_by: ar && ar.sent_by_id, today }));
ok("review gives it back to the biller", r.ok && (await row("SELECT assigned_to FROM claims WHERE id = ?", c.id)).assigned_to === priya.id, r);
const tl = await A("claims.timeline", { id: c.id });
ok("each desk step shows once in the history", tl.items.filter((x) => x.kind === "note" && /needs assistance from AR/.test(x.text || "")).length === 0 && tl.items.filter((x) => x.kind === "handoff_back").length === 3);

S("A deactivated desk lead");
const open1 = await send();
ok("hand-off to the lead", open1.h.lead_id === P.id);
await A("users.save", { id: P.id, first_name: "Pat", last_name: "Post", role: "user", designation: "Biller", capacity: 35, active: false });
const moved = await row("SELECT lead_id FROM handoffs WHERE id = ?", open1.h.id);
ok("open hand-offs move to the backup", moved.lead_id === P2.id, moved);
const open2 = await send();
ok("new hand-offs go to the backup", open2.h && open2.h.lead_id === P2.id && open2.res.handoff.to === "Pia Backup", open2.res.handoff);

S("Deactivating a biller in Team frees their claims");
const arun = users.find((u) => u.name === "Arun Kumar") || users.find((u) => u.role === "user" && u.active && u.id !== aisha.id && u.id !== priya.id);
const held = (await row("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", arun.id)).n;
await A("users.save", { id: arun.id, first_name: arun.first_name, last_name: arun.last_name, role: "user", designation: arun.designation, capacity: 35, active: false });
ok("their open claims go back to the pool", held > 0 && (await row("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", arun.id)).n === 0, held);

S("Escalation tracker SR numbers");
const owner = users.find((u) => u.role === "supervisor");
const esc = (i) => T(() => A("escalations.save", { location_id: "all", channels: ["Email"], comment: "Logged for the test from the email", email_subject: "Follow-up " + i, kind: "external", client_id: lake.id, day: today, dept: "Account Receivable", raised_who: "Clinic manager", reported_to: "Team lead", description: "Wrong follow-up on claim " + i, owner_id: owner.id }));
const three = await Promise.all([esc(1), esc(2), esc(3)]);
const srs = three.map((x) => x.ok && x.r.sr).sort();
ok("three at once get three numbers", three.every((x) => x.ok) && new Set(srs).size === 3, three.map((x) => x.ok ? x.r.sr : x.e));
r = await T(() => A("escalations.save", { location_id: "all", channels: ["Email"], comment: "Logged for the test from the email", email_subject: "A date", kind: "external", client_id: lake.id, day: "2026-02-30", dept: "Account Receivable", raised_who: "Clinic manager", reported_to: "Team lead", description: "An impossible date here", owner_id: owner.id }));
ok("an impossible date is refused", !r.ok && /real date|received date/.test(r.e), r);

S("Deleting a client takes everything under it");
const hset = await row("SELECT COUNT(*) AS n FROM handoffs WHERE client_id = ?", cl.id);
await sql("INSERT INTO payer_limits (client_id, payer_key, payer, tfl_days, updated_at) VALUES (?, 'aetna', 'Aetna', 90, ?)", cl.id, Date.now()).catch(() => null);
const countBefore = (await A("handoffs.count", {})).n;
r = await T(() => A("clients.delete", { id: cl.id, confirm: cl.name }));
ok("deleted", r.ok && hset.n > 0, r);
const left = {};
for (const t of ["handoffs", "escalations", "client_access", "payer_limits", "raci", "client_monthend", "user_notices"]) left[t] = (await row(`SELECT COUNT(*) AS n FROM ${t} WHERE client_id = ?`, cl.id)).n;
ok("no hand-offs, escalations, shares, RACI, limits, month-end or notices left", Object.values(left).every((n) => n === 0), left);
ok("no claim history left", (await row("SELECT COUNT(*) AS n FROM claim_events e LEFT JOIN claims c ON c.id = e.claim_id WHERE c.id IS NULL")).n === 0);
ok("the hand-off badge does not count what is gone", (await A("handoffs.count", {})).n <= countBefore);
const P2c = (await P2.call("handoffs.count", {})).n;
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id) VALUES ('orph', 'no-claim', ?, 'posting', 'pending', ?, ?, ?)", lake.id, Date.now(), Date.now() + 3600000, P2.id);
ok("a hand-off whose claim is gone is not counted", (await P2.call("handoffs.count", {})).n === P2c, P2c);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
