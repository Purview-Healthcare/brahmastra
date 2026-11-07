/* Suite 22: Dashboard › Inventory status. One stage per workable claim, the age of the AR against the over-90 target,
   the SLA checks, and the "do these first" list worked out from the claims; per client and for everyone in scope. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const rig = await makeRig({});
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const row = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results[0];
const today = new Date().toISOString().slice(0, 10), iso = (d) => new Date(Date.parse(today + "T12:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const cl = (await A("clients.list")).clients[0];
const users = (await A("users.list")).users.filter((u) => u.role === "user" && u.active);
const pool = (await A("claims.list", { client_id: cl.id, state: "open", page_size: 60 })).rows;
// shape the inventory: 4 on a list, 3 worked with a follow-up overdue (one 10 days), 2 due today, 2 later, 1 waiting on the client, 1 at Posting past TAT
await A("alloc.reassign", { ids: pool.slice(0, 14).map((c) => c.id), user_id: users[0].id });
const setC = (c, st, fu) => sql("UPDATE claims SET state = ?, follow_up_on = ? WHERE id = ?", st, fu, c.id);
await setC(pool[4], "completed", iso(-1)); await setC(pool[5], "completed", iso(-2)); await setC(pool[6], "completed", iso(-10));
await setC(pool[7], "completed", today); await setC(pool[8], "completed", today);
await setC(pool[9], "completed", iso(5)); await setC(pool[10], "completed", iso(9));
await setC(pool[11], "completed", "");
const now = Date.now();
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, client_sent_at) VALUES ('hw1', ?, ?, 'submission', 'client', ?, ?, ?)", pool[11].id, cl.id, now - 12 * 86400000, now, now - 12 * 86400000);
await setC(pool[12], "in_process", "");
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at) VALUES ('hp1', ?, ?, 'posting', 'pending', ?, ?)", pool[12].id, cl.id, now - 3 * 86400000, now - 3600000);
// two big claims over 90 days, so the over-90 share is above 15%
await sql("UPDATE claims SET dos = ?, balance = 90000, state = 'open', assigned_to = NULL WHERE id = ?", iso(-200), pool[20].id);
await sql("UPDATE claims SET dos = ?, balance = 60000, state = 'open', assigned_to = NULL WHERE id = ?", iso(-150), pool[21].id);
await sql("INSERT INTO escalations (id, client_id, sr, day, dept, status, created_at, updated_at) VALUES ('e1', ?, 1, ?, 'Account Receivable', 'open', ?, ?)", cl.id, today, now, now).catch(() => null);

S("Stages: one per workable claim");
const all = await A("inventory.status", { today });
const one = await A("inventory.status", { client_id: cl.id, today });
const sum = (x) => Object.values(x.stages).reduce((t, s) => t + s.n, 0);
const workable = await row(`SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND (state IN ('open','assigned','in_progress','completed') OR id = ?)`, cl.id, pool[12].id);
ok("every workable claim is in exactly one stage", sum(one) === workable.n, { stages: one.stages, workable: workable.n });
ok("overdue follow-ups counted, and the ones over 7 days", one.stages.overdue.n >= 3 && one.o7 >= 1, { o: one.stages.overdue, o7: one.o7 });
ok("due today counted", one.stages.due.n >= 2, one.stages.due);
ok("waiting on the client wins over the claim's own state", one.stages.waiting.n === 1 && one.w10 === 1, { w: one.stages.waiting, w10: one.w10 });
ok("at a desk, and past the TAT", one.stages.desk.n === 1 && one.late === 1, { d: one.stages.desk, late: one.late });
ok("on a biller's list", one.stages.list.n >= 4, one.stages.list);
ok("everyone's totals cover this client", sum(all) >= sum(one) && all.clients.some((c) => c.client_id === cl.id));

S("Age of the AR and the SLA checks");
ok("four age buckets add up to the workable AR", Math.abs(one.ages.reduce((t, a) => t + a.bal, 0) - one.ar) < 0.01 && one.ages.length === 4);
ok("over-90 share above the 15% target", one.over90_pct > 15 && one.target === 15, one.over90_pct);
const ck = Object.fromEntries(one.checks.map((c) => [c.key, c]));
ok("checks: over 90, follow-ups, timely filing, desks, escalations, pace", ["o90", "fu", "tfl", "desk", "esc", "pace"].every((k) => ck[k]), Object.keys(ck));
ok("over 90 and desks are not met", !ck.o90.ok && !ck.desk.ok && !ck.fu.ok);
ok("working days left in the month", one.wd_left >= 1 && one.wd_left <= 23, one.wd_left);

S("Do these first");
const ins = one.insights;
ok("the over-90 card says how many of the biggest claims bring it under 15%", ins[0].tone === "red" && /Over-90 AR/.test(ins[0].title) && /under 15%/.test(ins[0].text), ins[0]);
ok("its list opens the claims over 90 days, biggest first", ins[0].act[0].to === "claims" && ins[0].act[0].params.min_age === 91 && ins[0].act[0].params.sort === "balance");
ok("overdue follow-ups name who holds them", ins.some((i) => /Follow-up dates/.test(i.title) && /Most are with/.test(i.text)), ins.map((i) => i.title));
ok("waiting on the client, past the desk TAT and open escalations are there", ins.some((i) => /waited on the client/.test(i.title)) && ins.some((i) => /past the client's TAT/.test(i.title)));
ok("red first, green last", ins.findIndex((i) => i.tone === "green") === -1 || ins.findIndex((i) => i.tone === "green") > ins.findIndex((i) => i.tone === "red"));
ok("each client row has its own do-first", all.clients.find((c) => c.client_id === cl.id).do_first.length >= 1);
const list = await A("claims.list", { client_id: cl.id, min_age: 91, sort: "balance", dir: "desc", state: "workable", today });
ok("claims.list min_age gives the over-90 claims, biggest first", list.rows.length >= 2 && list.rows[0].balance === 90000, list.rows.slice(0, 2).map((r) => r.balance));

S("Who can see it");
await as(null)("auth.firstPassword", { user_id: users[0].id, passHash: await sha("pw-b") }).catch(() => null);
const bt = await T(async () => as((await login(users[0].email, "pw-b")).token)("inventory.status", { today }));
ok("billers cannot open it", !bt.ok, bt);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
