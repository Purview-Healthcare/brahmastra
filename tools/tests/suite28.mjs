/* Suite 28: TAT reminders. Every TAT counts Monday to Friday only (IST). Needs attention closes within 48 working hours, the
   Escalation tracker asks for a reason after 24 working hours. Inventory status shows what is pending with the desks and team
   leads; the bell has categories with Past TAT first; every supervisor, SME and above on the client gets a reminder email:
   Payment posting, Submission and Rejections at 09:00 IST, AR (Needs attention) at 19:00 IST, never twice the same day. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", project: "Sunrise Eye Care", also_on_projects: "Lakeview Dental Group", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Joseph Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "sima@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" })];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mails = []; let MAIL_DOWN = false;
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("mail-hook.test")) { if (MAIL_DOWN) return new Response("down", { status: 500 }); mails.push(JSON.parse(init.body)); return new Response("ok"); }
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LEO = await firstIn("Leo Lead", "leo@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
// the test moves the clock forward a few days: keep these sessions alive
await sql("UPDATE sessions SET expires_at = expires_at + ?", 30 * 86400000);
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
// IST times as UTC milliseconds
const IST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const at = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };
const runJob = (ms, cron = "30 3,13 * * 1-5") => at(ms, async () => { const ps = []; await rig.worker.default.scheduled({ cron }, { ...rig.backend.env, ...rig.liveEnv, DEMO: false, DB: rig.backend.env.DB }, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); });
await sql("UPDATE clients SET posting_tat_hours = 36, submission_tat_hours = 24 WHERE id = ?", sun.id);
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 40 })).rows;
const lpool = (await A("claims.list", { client_id: lake.id, state: "open", page_size: 10 })).rows;

S("Needs attention: 48 working hours, Monday to Friday");
const thu10 = IST(2026, 11, 5, 10);
await sql("UPDATE claims SET escalated = 1, escalated_at = ?, escalated_by = ?, assigned_to = ?, state = 'completed' WHERE id = ?", thu10, U("Arun Agent").id, U("Arun Agent").id, pool[0].id);
let al = await at(IST(2026, 11, 9, 9), () => TI("attention.list", {}));
let row = al.rows.find((r) => r.id === pool[0].id);
ok("the TAT is 48 hours", al.tat_hours === 48, al.tat_hours);
ok("flagged Thursday 10:00, Monday 09:00 is 47 working hours (the weekend skipped): not past", row && !row.overdue && Math.round(row.waiting_ms / 3600000) === 47, row && row.waiting_ms / 3600000);
al = await at(IST(2026, 11, 9, 11), () => TI("attention.list", {}));
ok("Monday 11:00 is 49 working hours: past", al.rows.find((r) => r.id === pool[0].id).overdue);
ok("the Needs attention count agrees", (await at(IST(2026, 11, 9, 11), () => TI("attention.count", {}))).overdue >= 1 && (await at(IST(2026, 11, 9, 9), () => TI("attention.count", {}))).overdue === 0);

S("Escalation tracker: the reason is due after 24 working hours");
const e = await A("escalations.save", { location_id: "all", channels: ["Email"], comment: "Logged for the test from the email", kind: "external", client_id: sun.id, day: "2026-11-06", dept: "Account Receivable", raised_who: "Office manager", reported_to: "Tina Lead", email_subject: "Posting delay", description: "Payment not posted", owner_id: U("Tina Lead").id, status: "open" });
await sql("UPDATE escalations SET created_at = ? WHERE client_id = ?", IST(2026, 11, 6, 18), sun.id);
let ec = await at(IST(2026, 11, 9, 10), () => TI("escalations.count", {}));
ok("logged Friday 18:00, Monday 10:00 is 16 working hours: no reason asked yet", ec.needs_reason === 0, ec);
ec = await at(IST(2026, 11, 9, 20), () => TI("escalations.count", {}));
ok("Monday 20:00 is 26 working hours: the reason is due", ec.needs_reason === 1, ec);
const el = await at(IST(2026, 11, 9, 20), () => TI("escalations.list", { client_id: sun.id }));
ok("the tracker shows working hours open", el.rows[0].open_hours === 26 && el.rows[0].past_24, el.rows[0]);
void e;

S("Inventory status: pending with the desks and team leads");
const now = IST(2026, 11, 9, 11);
const ho = (id, claim, dept, due, extra = "") => sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, lead_id${extra ? ", available_at" : ""}) VALUES (?,?,?,?,'pending',?,'Arun Agent',?,?${extra ? ",?" : ""})`,
  ...[id, claim.id, claim.client_id || sun.id, dept, due - 36 * 3600000, due, U("Tina Lead").id, ...(extra ? [extra] : [])]);
await ho("p1", pool[1], "posting", now - 5 * 3600000);      // past
await ho("p2", pool[2], "posting", now - 3 * 3600000);      // past (since 08:00)
await ho("p3", pool[3], "posting", now + 2 * 3600000);      // due soon
await ho("p4", pool[4], "posting", now + 30 * 3600000);     // within
await ho("s1", pool[5], "submission", now + 3 * 3600000);   // due soon
await ho("s2", pool[6], "subcheck", now - 3 * 3600000, now - 4 * 3600000);    // a recheck open and past
await ho("s3", pool[7], "subcheck", now + 99 * 3600000, now + 3600000); // a recheck not open yet: not counted
await ho("r1", pool[8], "rejection", now + 20 * 3600000);
await sql("UPDATE claims SET state = 'in_process' WHERE id IN (?,?,?,?,?,?,?,?)", ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => pool[i].id));
// a client request waiting to be sent, from last Wednesday; a claim sent back by Posting on Friday
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, paused_at, client_req_by_name) VALUES ('c1', ?, ?, 'posting', 'client', ?, ?, ?, 'Neha Post')", pool[9].id, sun.id, IST(2026, 11, 4, 12), IST(2026, 11, 6, 12), IST(2026, 11, 4, 12));
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, done_at, done_by_name) VALUES ('b1', ?, ?, 'posting', 'assistance', ?, ?, ?, 'Neha Post')", pool[10].id, sun.id, IST(2026, 11, 6, 9), IST(2026, 11, 7, 9), IST(2026, 11, 6, 10));
// Lakeview: one Posting hand-off past TAT (only Leo, Joseph and the admin are on Lakeview)
await ho("lp", lpool[0], "posting", now - 3 * 3600000);
let inv = await at(now, () => TI("inventory.status", { client_id: sun.id, today: "2026-11-09" }));
const pd = inv.pending;
// the task waiting on the client (c1) keeps its TAT clock running: it is one of Posting's tasks, past TAT
ok("Payment posting: 5 pending (1 waiting on the client), 3 past TAT, 1 due soon, 1 within", pd.desks.posting.n === 5 && pd.desks.posting.late === 3 && pd.desks.posting.soon === 1 && pd.desks.posting.ok === 1, pd.desks.posting);
ok("Submission counts its open recheck, not the one that has not opened yet", pd.desks.submission.n === 2 && pd.desks.submission.rechecks === 1 && pd.desks.submission.late === 1 && pd.desks.submission.soon === 1, pd.desks.submission);
ok("Rejections: 1 within TAT", pd.desks.rejection.n === 1 && pd.desks.rejection.ok === 1, pd.desks.rejection);
ok("Needs attention: flagged by billers, sent back, client requests", pd.attn.flagged.n === 1 && pd.attn.back.n === 1 && pd.attn.requests.n === 1 && pd.attn.n === 3, pd.attn);
ok("the client request from Wednesday is past 48 working hours, the Friday send-back is not yet", pd.attn.requests.late === 1 && pd.attn.back.late === 0, pd.attn);
ok("the client's TAT is shown (Posting 36, Submission 24, Needs attention 48)", pd.tat.posting === 36 && pd.tat.submission === 24 && pd.tat.attention === 48, pd.tat);
const all = await at(now, () => A("inventory.status", { today: "2026-11-09" }));
ok("everyone's view adds up both clients", all.pending.desks.posting.n === 6 && all.pending.desks.posting.late === 4, all.pending.desks.posting);

S("The bell: categories, Past TAT first");
let nt = await at(now, () => TI("notify.list", { today: "2026-11-09" }));
const tat = nt.items.filter((x) => x.cat === "tat");
ok("past-TAT items for Payment posting, Submission and Needs attention on Tina's client", tat.some((x) => x.key === `tat:${sun.id}:posting` && x.n === 3) && tat.some((x) => x.key === `tat:${sun.id}:submission`) && tat.some((x) => x.key === `tat:${sun.id}:attn`), tat.map((x) => x.key + "=" + x.n));
ok("each says the client and how long the oldest waited", tat.every((x) => /Sunrise/.test(x.text) && /working hours/.test(x.sub || "")), tat.map((x) => x.text + " | " + x.sub));
ok("nothing from Lakeview, which is not Tina's", !nt.items.some((x) => x.key.includes(lake.id)));
ok("due in the next 4 hours goes under Desks", nt.items.some((x) => x.cat === "desks" && x.key === `soon:${sun.id}:posting`));
ok("every item has a category", nt.items.every((x) => ["tat", "attention", "desks", "escalations", "team", "setup", "work", "updates"].includes(x.cat)), nt.items.filter((x) => !x.cat).map((x) => x.key));
ok("claims flagged by billers are under Needs attention", nt.items.some((x) => x.key === "escalations" && x.cat === "attention"), nt.items.map((x) => x.key + ":" + x.cat));
const ntl = await at(IST(2026, 11, 9, 20), () => TI("notify.list", { today: "2026-11-09" }));
ok("the client escalation past 24 working hours is under Client escalations", ntl.items.some((x) => x.key === "esc_reason" && x.cat === "escalations"), ntl.items.map((x) => x.key + ":" + x.cat));
ok("past_tat counts every item past TAT", nt.past_tat === tat.reduce((t, x) => t + x.n, 0) && nt.past_tat === 6, nt.past_tat);
const nb = await at(now, () => AR("notify.list", { today: "2026-11-09" }));
ok("a biller gets no Past TAT reminders, only My work and Updates", !nb.items.some((x) => x.cat === "tat") && nb.items.every((x) => ["work", "updates"].includes(x.cat)), nb.items.map((x) => x.key + ":" + x.cat));
const nl = await at(now, () => LEO("notify.list", { today: "2026-11-09" }));
ok("Leo sees Lakeview's past TAT only", nl.items.some((x) => x.key === `tat:${lake.id}:posting`) && !nl.items.some((x) => x.key.includes(sun.id)));

S("The reminder email");
const pv = await at(now, () => TI("tat.preview", { kind: "desks" }));
ok("09:00: Payment posting and Submission past TAT, with the claim numbers", pv.hour === 9 && pv.mail && pv.mail.n === 4 && pv.mail.html.includes(pool[1].claim_no) && /Payment posting · TAT 36 working hours/.test(pv.mail.html), pv.mail && pv.mail.subject);
ok("no patient names in it", ![pool[1], pool[2], pool[6]].some((c) => c.patient && pv.mail.html.includes(c.patient)));
const pa = await at(now, () => TI("tat.preview", { kind: "ar" }));
ok("19:00: Needs attention past 48 working hours (flagged, client request)", pa.hour === 19 && pa.mail && pa.mail.n === 2 && /Flagged by billers/.test(pa.mail.html) && /Client requests to send/.test(pa.mail.html), pa.mail && pa.mail.text);
const pb = await T(() => AR("tat.preview", { kind: "desks" }));
ok("billers cannot open it", !pb.ok && pb.status === 403);

S("Sent at 09:00 and 19:00 IST, Monday to Friday, to supervisors, SMEs and above");
mails.length = 0;
await runJob(IST(2026, 11, 9, 8, 47), "17 * * * *");
ok("08:47: nothing yet", mails.length === 0);
await runJob(IST(2026, 11, 9, 9, 0));
const to = mails.map((m) => m.to).sort();
ok("09:00: Tina, Sima (SME), Joseph (manager) and the admin get Sunrise; Leo gets Lakeview", ["tina@purview-healthcare.com", "sima@purview-healthcare.com", "joseph@purview-healthcare.com", "leo@purview-healthcare.com", "supervisor@purview-healthcare.com"].every((x) => to.includes(x)), to);
ok("not the biller", !to.includes("arun@purview-healthcare.com"));
const tinaMail = mails.find((m) => m.to === "tina@purview-healthcare.com");
ok("Tina's has Sunrise only, Leo's Lakeview only", !tinaMail.html.includes(lpool[0].claim_no) && mails.find((m) => m.to === "leo@purview-healthcare.com").html.includes(lpool[0].claim_no));
ok("the 09:00 email is Posting, Submission and Rejections", /Payment posting, Submission and Rejections/.test(tinaMail.subject), tinaMail.subject);
const n9 = mails.length;
await runJob(IST(2026, 11, 9, 9, 47), "17 * * * *");
ok("the hourly run at 09:47 does not send it again", mails.length === n9, mails.length);
await runJob(IST(2026, 11, 9, 19, 0));
const ar19 = mails.slice(n9).filter((m) => /past TAT/.test(m.subject));
ok("19:00: the AR reminder", ar19.length >= 4 && ar19.every((m) => /Needs attention \(AR\)/.test(m.subject)), mails.slice(n9).map((m) => m.subject));
ok("only to people with an AR item past TAT (Sunrise)", ar19.every((m) => m.to !== "leo@purview-healthcare.com"));
const n19 = mails.length;
await runJob(IST(2026, 11, 14, 9, 0), "17 * * * *");
ok("Saturday: no reminders", mails.length === n19);
// email down at 09:00 Tuesday: tried again on the next hourly run
MAIL_DOWN = true; await runJob(IST(2026, 11, 10, 9, 0)); MAIL_DOWN = false;
const failedRows = await rows("SELECT COUNT(*) AS n FROM tat_mail_log WHERE day = '2026-11-10' AND kind = 'desks' AND ok = 0");
ok("a failed send is logged as not sent", failedRows[0].n >= 4, failedRows[0]);
const before = mails.length;
await runJob(IST(2026, 11, 10, 9, 47), "17 * * * *");
ok("and sent on the next run in the window", mails.length - before >= 4, mails.length - before);
await runJob(IST(2026, 11, 10, 12, 47), "17 * * * *");
ok("after 12:00 no more tries for the 09:00 reminder", mails.length - before >= 4 && (await rows("SELECT COUNT(*) AS n FROM tat_mail_log WHERE day = '2026-11-10' AND kind = 'desks' AND ok = 0"))[0].n === 0);
// closing the tasks: no reminder the next day
await sql("UPDATE handoffs SET status = 'complete', done_at = ? WHERE status IN ('pending','assigned','client')", IST(2026, 11, 10, 15));
await sql("UPDATE claims SET escalated = 0");
await sql("UPDATE claims SET reviewed_at = ? WHERE id = ?", IST(2026, 11, 10, 15), pool[10].id);
const n2 = mails.length;
await runJob(IST(2026, 11, 11, 9, 0)); await runJob(IST(2026, 11, 11, 19, 0));
ok("everything closed: no reminder the next day", !mails.slice(n2).some((m) => /past TAT/.test(m.subject)), mails.slice(n2).map((m) => m.subject));
nt = await at(IST(2026, 11, 11, 10), () => TI("notify.list", { today: "2026-11-11" }));
ok("and the bell's Past TAT is empty", !nt.items.some((x) => x.cat === "tat") && nt.past_tat === 0);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
