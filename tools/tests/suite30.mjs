/* Suite 30: Turning 90 soon (claims 77 to 90 days old move up the biller's list, a card and a check on Inventory status, a filter on
   the Claims list, a line in the Monday digest), repeat denials (the same claim denied again for the same reason, the same payer and
   reason on 3 or more claims in 30 days, what led to payment before) and payer tips on a claim (days to payment after an action,
   what worked for a status, a follow-up date to suggest). All from the team's own SAAG entries: never another claim's free text. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "bela@purview-healthcare.com" })];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const fetchMock = async (url) => url.includes("brahmastra_roster") ? J({ ok: true, rows: feed }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const dosAgo = (n) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 80 })).rows;
// start clean: no claim of this client in the turning-90 window, and none on Arun's list
await sql("UPDATE claims SET dos = ?, assigned_to = NULL, state = 'open' WHERE client_id = ?", dosAgo(20), sun.id);

S("Turning 90 soon");
const [c85, c79, c40, c95, c60] = pool;
await sql("UPDATE claims SET dos = ?, balance = 4000, priority = 50 WHERE id = ?", dosAgo(85), c85.id);
await sql("UPDATE claims SET dos = ?, balance = 2500, priority = 50 WHERE id = ?", dosAgo(79), c79.id);
await sql("UPDATE claims SET dos = ?, balance = 900, priority = 80 WHERE id = ?", dosAgo(40), c40.id);
await sql("UPDATE claims SET dos = ?, balance = 700, priority = 60 WHERE id = ?", dosAgo(95), c95.id);
await sql("UPDATE claims SET dos = ?, balance = 600, priority = 75 WHERE id = ?", dosAgo(60), c60.id);
const l7 = await A("claims.list", { client_id: sun.id, turning90: 7, state: "workable", sort: "balance", dir: "desc", today });
ok("the 7-day list: only the claim 85 days old (91 is over 90)", l7.rows.length === 1 && l7.rows[0].id === c85.id, l7.rows.map((r) => r.id));
const l14 = await A("claims.list", { client_id: sun.id, turning90: 14, state: "workable", today });
ok("the 14-day list adds the one 79 days old", l14.rows.length === 2 && l14.rows.some((r) => r.id === c79.id));
// on Arun's list: the 85-day claim (priority 50 + 40) comes before the 40-day one (80) and the 60-day one (75)
await A("alloc.reassign", { ids: [c85.id, c40.id, c60.id], user_id: U("Arun Agent").id });
await sql("UPDATE claims SET priority = 50, priority_set = '' WHERE id = ?", c85.id); await sql("UPDATE claims SET priority = 80 WHERE id = ?", c40.id); await sql("UPDATE claims SET priority = 75 WHERE id = ?", c60.id);
const nx = await AR("queue.next", { today });
ok("the claim turning 90 in 6 days is next on the biller's list, ahead of higher scores", nx.claim && nx.claim.id === c85.id, nx.claim && nx.claim.id);
await AR("queue.skip", { id: c85.id, count: false }); // back to My day (not a skip), so it keeps its place
const ql = await AR("queue.list", { today });
ok("My day lists it first too", ql.rows.length >= 3 && ql.rows.filter((r) => r.state === "assigned" || r.state === "in_progress")[0].id === c85.id, ql.rows.slice(0, 3).map((r) => r.id));
const inv = await A("inventory.status", { client_id: sun.id, today });
const card = inv.insights.find((i) => /Turning 90/.test(i.title));
ok("Inventory status: a card with the claims turning 90 in 7 days and what over 90 becomes", card && card.sub.startsWith("1 claim") && /goes from/.test(card.text) && card.act[0].params.turning90 === 7, card);
ok("and a check row", inv.checks.some((x) => x.key === "t90" && x.now === "1" && !x.ok));
const tips85 = await AR("claims.tips", { id: c85.id, today });
ok("on the claim: turns 90 in 6 days", tips85.turn90 && tips85.turn90.days_left === 6 && tips85.turn90.age === 85, tips85.turn90);
ok("not for a claim already over 90", !(await A("claims.tips", { id: c95.id, today })).turn90);
// the age saved at upload falls behind each day: the Age sort follows the date of service, as over 90 does
await sql("UPDATE claims SET age_days = 12 WHERE id = ?", c95.id);
const byAge = await A("claims.list", { client_id: sun.id, state: "workable", sort: "age_days", dir: "desc", page_size: 5 });
ok("sorting by Age puts the claim 95 days old first, though the age saved at upload was 12", byAge.rows[0] && byAge.rows[0].id === c95.id, byAge.rows.slice(0, 3).map((r) => [r.id, r.dos, r.age_days]));

S("Repeat denials");
const NT = async (claimId, daysAgo, status, sub, action, by = U("Arun Agent")) => sql(`INSERT INTO notes (id, claim_id, user_id, user_name, kind, status_code, action_code, comment, created_at, status, sub_status, action, bucket, effective)
  VALUES (?,?,?,?,'work',?,?,'',?,?,?,?,'Payer','')`, "n" + Math.random().toString(36).slice(2), claimId, by.id, by.name, status, action, Date.now() - daysAgo * 86400000, status, sub, action);
const PAYER = "Blue Ridge Health"; const REASON = "Missing/ Invalid Information";
const [x, y, z, w] = pool.slice(10, 14);
for (const c of [x, y, z, w]) await sql("UPDATE claims SET payer = ?, state = 'completed', assigned_to = ?, last_status_code = 'Claim Denied' WHERE id = ?", PAYER, U("Arun Agent").id, c.id);
// x: denied, resubmitted, denied again for the same reason (still being worked)
await NT(x.id, 20, "Claim Denied", REASON, "Need to Resubmit"); await NT(x.id, 5, "Claim Denied", REASON, "Need to Resubmit");
// y: denied, resubmitted, denied again, then corrected and resubmitted and paid. z: denied, corrected and resubmitted, paid
await NT(y.id, 25, "Claim Denied", REASON, "Need to Resubmit"); await NT(y.id, 18, "Claim Denied", REASON, "Need to Correct & Resubmit"); await NT(y.id, 12, "Claim Paid", "Paid in full", "No further action");
await NT(z.id, 24, "Claim Denied", REASON, "Need to Correct & Resubmit"); await NT(z.id, 10, "Claim Paid", "Paid in full", "No further action");
for (const c of [y, z]) await sql("UPDATE claims SET last_status_code = 'Claim Paid' WHERE id = ?", c.id);
// w: denied, a call, still denied (no payment)
await NT(w.id, 15, "Claim Denied", REASON, "Need to Call Payer");
const rd = await TI("denials.repeats", {});
const rx = rd.claims.find((r) => r.claim_id === x.id);
ok("the claim denied twice for the same reason is listed", rx && rx.times === 2 && rx.reason === REASON && rx.payer === PAYER, rx);
ok("with what led to payment with this payer: Need to Correct & Resubmit, paid 2 of 2", rx && !rx.worked.any_payer && rx.worked.top[0].action === "Need to Correct & Resubmit" && rx.worked.top[0].paid === 2 && rx.worked.top[0].tried === 2, rx && rx.worked);
ok("and the action that did not work is not offered", rx && !rx.worked.top.some((t) => t.action === "Need to Call Payer" || t.action === "Need to Resubmit"));
ok("a claim denied twice and paid since is not listed", !rd.claims.some((r) => r.claim_id === y.id || r.claim_id === z.id), rd.claims.map((r) => r.claim_id));
const pat = rd.patterns.find((p) => p.payer === PAYER);
ok("the payer and reason on 4 claims in 30 days is a pattern", pat && pat.claims === 4 && pat.reason === REASON, rd.patterns);
const nt = await TI("notify.list", { today });
ok("the team lead's bell says it, under Needs attention", nt.items.some((i) => i.key === "repeat_denials" && i.cat === "attention" && i.n >= 1 && i.params.tab === "denials"), nt.items.map((i) => i.key));
const rb = await T(() => AR("denials.repeats", {}));
ok("billers cannot open the list", !rb.ok && rb.status === 403, rb);
const tx = await AR("claims.tips", { id: x.id, today });
ok("on the claim: denied 2 times, with what worked before", tx.repeat && tx.repeat.times === 2 && tx.repeat.worked.top[0].action === "Need to Correct & Resubmit", tx.repeat);

S("Payer tips");
// three claims paid 10, 12 and 14 days after a resubmission at this payer
const [p1, p2, p3, p4] = pool.slice(20, 24);
for (const c of [p1, p2, p3, p4]) await sql("UPDATE claims SET payer = ?, state = 'completed', assigned_to = ?, last_status_code = 'Claim In Process' WHERE id = ?", PAYER, U("Arun Agent").id, c.id);
for (const [c, d] of [[p1, 10], [p2, 12], [p3, 14]]) { await NT(c.id, 40, "Claim In Process", "Claim Under Review", "Need to Resubmit"); await NT(c.id, 40 - d, "Claim Paid", "Paid in full", "No further action"); }
await NT(p4.id, 3, "Claim In Process", "Claim Under Review", "Need to Resubmit");
const tp = await AR("claims.tips", { id: p4.id, action: "Need to Resubmit", today });
ok("after Need to Resubmit this payer usually pays in 12 days (from 3 claims; the one denied again after it does not count)", tp.pay_days === 12 && tp.pay_n === 3, { d: tp.pay_days, n: tp.pay_n });
ok("a follow-up date 12 days ahead is suggested", tp.follow_up === new Date(Date.parse(today + "T00:00:00Z") + 12 * 86400000).toISOString().slice(0, 10) || tp.follow_up === new Date(Date.now() + 12 * 86400000 + 330 * 60000).toISOString().slice(0, 10), tp.follow_up);
const td = await AR("claims.tips", { id: w.id, status: "Claim Denied", sub_status: REASON, today });
ok("for Claim Denied · this reason, what led to payment: Need to Correct & Resubmit", td.worked[0] && td.worked[0].action === "Need to Correct & Resubmit" && td.worked[0].paid === 2, td.worked);
const few = await AR("claims.tips", { id: p4.id, action: "Need to Appeal", today });
ok("fewer than 3 cases: no days and no date", few.pay_days === null && few.follow_up === null);
await A("alloc.reassign", { ids: [pool[30].id], user_id: U("Bela Agent").id });
const other = await T(() => AR("claims.tips", { id: pool[30].id, today }));
ok("a biller cannot read tips on another biller's claim", !other.ok && other.status === 403, other);
ok("no free text of other claims in the tips", !JSON.stringify(tp).includes("findings") && !JSON.stringify(td).includes("comment"));

S("Monday digest: claims turning 90 in the next 7 days");
const dd = await A("digest.dashboard", {});
ok("the digest names the claims turning 90", (dd.rollup.attention || []).some(([, c, t]) => /Sunrise/.test(c) && /turn 90 in the next 7 days/.test(t)), dd.empty ? "empty digest" : dd.rollup && dd.rollup.attention);

const fails = results.filter((r) => !r.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
