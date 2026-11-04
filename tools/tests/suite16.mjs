// Dashboard › Team status and Client reports, and Live status.
// Team status: status from the Shastra roster (Production, Training, OJT), ramp-up against the rules, attainment for the
// weekdays someone was in (a half day counts half), floor time needed (8 h a day, 4 h a half day), the start / end /
// comment kept in Brahmastra, and suggestions in plain pointers. Client reports: the client list (what was the Portfolio)
// for team leads too, narrowed by team lead or client, with unassigned and collected for the dates.
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Joseph Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cara Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", status: "OJT", doj: "2026-10-26", email: "cara@purview-healthcare.com" }),
  P({ emp_id: "A4", name: "Gita Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", status: "Training", doj: "2026-09-01", email: "gita@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" }),
];
// Purview Shastra's floor-time feed: not set up (404) until floorRows is set; "error" answers 500
let floorRows = null, floorCalls = 0;
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_floor")) {
    floorCalls++;
    const b = JSON.parse(init.body);
    if (!floorRows) return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.brahmastra_floor(p_from, p_key, p_to) in the schema cache" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (floorRows === "error") return new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, rows: floorRows.filter((x) => x.date >= b.p_from && x.date <= b.p_to) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const VP = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"),
  AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sunrise = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const saag = { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" };
const note = { source: "Web", findings: "In process per the payer portal", action: "follow up later" };
// A fixed week: Monday Nov 2 to Wednesday Nov 4, 2026
const mon = "2026-11-02", tue = "2026-11-03", wed = "2026-11-04";
const at = (d, h) => Date.parse(d + "T" + String(h).padStart(2, "0") + ":00:00Z");
let r;

S("Setting up the week");
const pool = (await TI("claims.list", { client_id: sunrise.id, state: "open", page_size: 40 })).rows;
await TI("alloc.reassign", { ids: pool.slice(0, 30).map((c) => c.id), user_id: U("Arun Agent").id });
for (const c of pool.slice(0, 20)) await AR("queue.complete", { id: c.id, saag, note });
// Arun's 20 entries spread over the three days
const ids20 = pool.slice(0, 20).map((c) => c.id);
for (let i = 0; i < 20; i++) await sql("UPDATE notes SET created_at = ? WHERE claim_id = ? AND kind = 'work'", at([mon, tue, wed][i % 3], 10), ids20[i]);
// Arun took a half day on Tuesday
await sql("INSERT INTO attendance (user_id, day, status, reason, by_name, at) VALUES (?,?,?,?,?,?)", U("Arun Agent").id, tue, "out", "Half day", "Tina Lead", Date.now());
// Arun's other 10 were allocated on Monday and are still not worked; 3 of them High
const rest = pool.slice(20, 30).map((c) => c.id);
await sql(`UPDATE claims SET assigned_at = ?, tier = 'Medium' WHERE id IN (${rest.map(() => "?").join(",")})`, at(mon, 9), ...rest);
await sql(`UPDATE claims SET tier = 'High' WHERE id IN (?, ?, ?)`, rest[0], rest[1], rest[2]);
ok("set up", true);

S("Team status: who and what");
const q = { from: mon, to: wed, today: wed, tz_offset_min: 0 };
r = await VP("team.status", q);
const row = (n) => r.rows.find((x) => x.name === n);
ok("AR billers in the span, with their team lead", row("Arun Agent") && row("Arun Agent").lead_name === "Tina Lead" && row("Bela Agent").lead_name === "Leo Lead", r.rows.map((x) => [x.name, x.lead_name]));
ok("status from the Shastra roster: Production, OJT, Training", row("Arun Agent").status === "Production" && row("Cara Agent").status === "OJT" && row("Gita Agent").status === "Training", r.rows.map((x) => [x.name, x.status]));
ok("three weekdays", r.workdays === 3, r.workdays);
const ar = row("Arun Agent");
ok("Arun: 2 full days and 1 half day", ar.days_full === 2 && ar.days_half === 1 && ar.days_out === 0, ar);
ok("Arun: target 35 + 35 + 17.5 = 88 (rounded)", ar.target === 88, ar.target);
// Attainment counts the finished days (Monday full, Tuesday half): 14 of 52.5 = 27%; Wednesday (today) is shown apart
ok("Arun: 20 entries; attainment on the finished days 14 of 52.5 = 27%", ar.worked === 20 && ar.attain_basis === "done" && ar.worked_done === 14 && ar.target_done === 52.5 && ar.attain === 27, { w: ar.worked, b: ar.attain_basis, wd: ar.worked_done, td: ar.target_done, a: ar.attain });
ok("Arun: today's 6 entries apart, against today's 35", ar.worked_today === 6 && ar.target_today === 35, { wt: ar.worked_today, tt: ar.target_today });
ok("Arun: floor time needed 8 h + 8 h + 4 h = 20 h", ar.floor_needed_min === 20 * 60, ar.floor_needed_min);
ok("Arun: 10 left over, 3 of them high priority", ar.left === 10 && ar.left_high === 3 && ar.left_other === 7, { left: ar.left, high: ar.left_high, other: ar.left_other });
ok("on floor and idle wait for Purview Shastra (its feed is not set up yet)", ar.on_floor_min === null && ar.idle_min === null && r.floor_source === "not_set_up", r.floor_source);
ok("Arun is below the production mark (under 90%)", ar.perf === "below", ar.perf);
ok("Training and OJT are in ramp-up, not judged against the production mark", row("Gita Agent").perf === "ramp" && row("Cara Agent").perf === "ramp", [row("Gita Agent").perf, row("Cara Agent").perf]);
const cara = row("Cara Agent"), gita = row("Gita Agent");
ok("Cara (OJT from Oct 26): due Dec 7, on track", cara.ramp.due === "2026-12-07" && cara.ramp.flag === "track", cara.ramp);
ok("Gita (Training from Sep 1): due Oct 13, overdue", gita.ramp.due === "2026-10-13" && gita.ramp.flag === "over" && gita.ramp.days < 0, gita.ramp);
ok("totals: headcount, production, training", r.totals.people === r.rows.length && r.totals.training === 2 && r.totals.ramp_over >= 1, r.totals);
ok("performance by status lists Production, OJT and Training", ["Production", "OJT", "Training"].every((s) => r.by_status.some((x) => x.status === s)), r.by_status.map((x) => x.status));
ok("roster checks are listed", Array.isArray(r.checks) && r.checks.some((c) => /names that appear twice/.test(c.text)));

S("Team status: suggestions in plain pointers");
const sg = r.suggestions;
const has = (list, who, re) => list.some((x) => x.who === who && re.test(x.seen + " " + x.do));
ok("Do today: Gita is past her ramp-up date", has(sg.today, "Gita Agent", /was due in production/), sg.today);
ok("Do today: Arun has 3 high priority claims left over", has(sg.today, "Arun Agent", /3 high priority/), sg.today);
ok("Do today: Arun's attainment is very low (up to yesterday)", has(sg.today, "Arun Agent", /Attainment 27% \(14 of 53 claims up to yesterday\)/), sg.today);
{ const t1 = await VP("team.status", { from: wed, to: wed, today: wed, tz_offset_min: 0 }), a1 = t1.rows.find((x) => x.name === "Arun Agent");
  ok("only today picked: attainment is today's (6 of 35 = 17%)", a1.attain_basis === "today" && a1.attain === 17 && t1.totals.attain_basis === "today", { b: a1.attain_basis, a: a1.attain });
  ok("only today picked: performance waits for the day to finish", a1.perf === "pending", a1.perf);
  ok("only today picked: no attainment pointer while the day is under way", !has(t1.suggestions.today, "Arun Agent", /Attainment/) && !has(t1.suggestions.week, "Arun Agent", /Attainment/), t1.suggestions); }
{ await sql("INSERT INTO attendance (user_id, day, status, reason, by_name, at) VALUES (?,?,?,?,?,?)", U("Arun Agent").id, wed, "out", "Sick", "Tina Lead", Date.now());
  const t2 = await VP("team.status", q), a2 = t2.rows.find((x) => x.name === "Arun Agent");
  ok("out today: the pointer says to rebalance, not to work the claims", a2.out_today === "out" && has(t2.suggestions.today, "Arun Agent", /out today.*Rebalance the 3 high priority/) && !has(t2.suggestions.today, "Arun Agent", /Have them work/), t2.suggestions.today);
  ok("out today: the low attainment pointer waits until they are back", has(t2.suggestions.today, "Arun Agent", /when they are back/), t2.suggestions.today);
  await sql("DELETE FROM attendance WHERE user_id = ? AND day = ?", U("Arun Agent").id, wed); }
ok("each pointer says what we see and what to do", [...sg.today, ...sg.week, ...sg.good].every((x) => x.who && x.seen && x.do && x.user_id), sg);
ok("no em dashes in the wording", !JSON.stringify(sg).includes("—"));

S("Team status: who sees what");
r = await TI("team.status", q);
ok("a team lead sees their own team only", r.rows.every((x) => x.lead_name === "Tina Lead") && r.rows.some((x) => x.name === "Arun Agent"), r.rows.map((x) => x.name));
r = await VP("team.status", { ...q, lead_id: U("Leo Lead").id });
ok("the VP picks Leo Lead: only his billers", r.rows.map((x) => x.name).join() === "Bela Agent", r.rows.map((x) => x.name));
r = await T(async () => TI("team.status", { ...q, lead_id: U("Leo Lead").id }));
ok("a team lead cannot pick another team lead", !r.ok, r);
r = await T(async () => AR("team.status", q));
ok("billers cannot open it", !r.ok, r);
r = await T(async () => VP("team.status", { from: wed, to: mon }));
ok("dates the wrong way round are refused", !r.ok, r);

S("Team status: start, end and comment kept in Brahmastra");
r = await T(async () => TI("team.saveNote", { user_id: U("Cara Agent").id, start_date: "2026-09-30", comment: "Moving to production next week" }));
ok("the team lead saves a start date and a comment", r.ok, r);
r = await VP("team.status", q);
const cara2 = r.rows.find((x) => x.name === "Cara Agent");
ok("the comment shows for every lead, with who saved it", cara2.comment === "Moving to production next week" && cara2.comment_by === "Tina Lead", cara2);
ok("the start date moves the due date: Sep 30 + 6 weeks = Nov 11, due soon", cara2.ramp.start === "2026-09-30" && cara2.ramp.due === "2026-11-11" && cara2.ramp.flag === "soon" && cara2.ramp.days === 7, cara2.ramp);
ok("a due-soon pointer appears under This week", r.suggestions.week.some((x) => x.who === "Cara Agent" && /due in production/.test(x.seen)), r.suggestions.week);
r = await T(async () => LE("team.saveNote", { user_id: U("Cara Agent").id, comment: "Not my team" }));
ok("a team lead cannot write on someone outside their team", !r.ok, r);
r = await T(async () => TI("team.saveNote", { user_id: U("Cara Agent").id, start_date: "2026-11-10", end_date: "2026-11-01" }));
ok("an end before the start is refused", !r.ok && /before the start/.test(r.e), r);
await TI("team.saveNote", { user_id: U("Cara Agent").id, start_date: "2026-09-30", end_date: "2026-11-20", comment: "Two more weeks of OJT" });
r = await VP("team.status", q);
{ const c = r.rows.find((x) => x.name === "Cara Agent");
  ok("an end date is the date agreed for production: Nov 20, on track", c.ramp.due === "2026-11-20" && c.ramp.extended === true && c.ramp.flag === "track" && c.ramp.days === 16, c.ramp); }
await TI("team.saveNote", { user_id: U("Cara Agent").id, start_date: "2026-09-30", end_date: "2026-11-03", comment: "In production now" });
r = await VP("team.status", q);
{ const c = r.rows.find((x) => x.name === "Cara Agent");
  ok("an agreed date that has passed while the roster still says OJT: overdue, pointer to update Purview Shastra", c.ramp.flag === "over" && c.ramp.days === -1 && has(r.suggestions.today, "Cara Agent", /1 day ago.*update Purview Shastra/), { ramp: c.ramp, today: r.suggestions.today }); }
ok("and the audit trail records the note", (await A("audit.list", {})).rows.some((x) => x.action === "team.note" && /Cara Agent/.test(x.detail)));

S("Client reports: the client list for team leads too");
r = await TI("portfolio.overview", {});
ok("a team lead gets their own clients", r.rows.length && r.rows.every((x) => x.client_id === sunrise.id), r.rows.map((x) => x.client));
r = await VP("portfolio.overview", {});
ok("the VP gets every client", r.rows.some((x) => x.client_id === sunrise.id) && r.rows.some((x) => x.client_id === lake.id));
const sun = r.rows.find((x) => x.client_id === sunrise.id);
ok("each client carries unassigned claims and balance", typeof sun.open_n === "number" && sun.open_n > 0 && sun.open_bal > 0 && r.totals.open_n >= sun.open_n, { n: sun.open_n, bal: sun.open_bal });
r = await VP("portfolio.overview", { lead_id: U("Leo Lead").id });
ok("picking Leo Lead: only his clients", r.rows.length && r.rows.every((x) => x.client_id === lake.id), r.rows.map((x) => x.client));
r = await VP("portfolio.overview", { client_id: sunrise.id });
ok("picking a client: that client only", r.rows.length === 1 && r.rows[0].client_id === sunrise.id);
r = await T(async () => TI("portfolio.overview", { lead_id: U("Leo Lead").id }));
ok("a team lead cannot pick another team lead", !r.ok, r);
r = await T(async () => AR("portfolio.overview", {}));
ok("billers cannot open it", !r.ok, r);
// collected for the dates: a completed posting hand-off on Monday
const hc = pool[0];
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, due_at, done_at, done_by, done_by_name, proof_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  "h-test-1", hc.id, sunrise.id, "posting", "complete", at(mon, 9), U("Arun Agent").id, "Arun Agent", at(mon, 20), at(mon, 12), U("Tina Lead").id, "Tina Lead", JSON.stringify({ date: mon, ref: "CHK-1", amount: 250.5 }));
r = await VP("portfolio.overview", { from_ms: at(mon, 0), to_ms: at(wed, 23) });
ok("collected follows the dates picked", r.rows.find((x) => x.client_id === sunrise.id).collected_month === 250.5, r.rows.find((x) => x.client_id === sunrise.id).collected_month);
r = await VP("portfolio.overview", { from_ms: at(tue, 0), to_ms: at(wed, 23) });
ok("and leaves out what was collected before them", r.rows.find((x) => x.client_id === sunrise.id).collected_month === 0);

S("Live status: the claim each biller has open");
const open1 = pool[25];
await AR("queue.open", { id: open1.id });
r = await TI("team.huddle", {});
const arun = r.rows.find((x) => x.name === "Arun Agent");
ok("the claim open carries its number, id and balance", arun.current && arun.current.id === open1.id && arun.current.claim_no === open1.claim_no && typeof arun.current.balance === "number", arun.current);
ok("working now counts people with a claim open", r.totals.working >= 1, r.totals);

S("Team status: time on the floor and idle from Purview Shastra");
r = await VP("team.status", q);
ok("before the feed is set up in Shastra: on floor and idle wait", r.floor_source === "not_set_up" && r.rows.every((x) => x.on_floor_min === null && x.idle_min === null), { src: r.floor_source });
{ const c0 = floorCalls; await VP("team.status", q); ok("and Shastra is not asked again for 10 minutes", floorCalls === c0, { before: c0, after: floorCalls }); }
const F = (o) => ({ emp_id: "", email: "", status: "present", open: false, tof_min: 0, logged_min: 0, break_min: 0, guard: true, idle_min: 0, locked_min: 0, ...o });
floorRows = [
  F({ emp_id: "A1", date: mon, tof_min: 420, idle_min: 30, locked_min: 15 }),
  F({ emp_id: "a1", date: tue, status: "half_day", tof_min: 235, idle_min: 10 }),
  F({ emp_id: "A1", date: wed, open: true, tof_min: 95 }),
  F({ email: "BELA@purview-healthcare.com", date: mon, tof_min: 490, guard: false }),
  F({ email: "bela@purview-healthcare.com", date: tue, tof_min: 485, guard: false }),
  F({ emp_id: "A3", date: mon, status: "sick_leave" }),
  F({ emp_id: "A3", date: tue, tof_min: 480, idle_min: 200, locked_min: 40 }),
  F({ emp_id: "A3", date: wed, open: true, tof_min: 60 }),
  F({ emp_id: "Z9", date: mon, tof_min: 480 }),
];
await sql("DELETE FROM settings WHERE key = 'floor_sync'");
r = await VP("team.status", q);
const fa = r.rows.find((x) => x.name === "Arun Agent"), fb = r.rows.find((x) => x.name === "Bela Agent"), fc = r.rows.find((x) => x.name === "Cara Agent"), fg = r.rows.find((x) => x.name === "Gita Agent");
ok("the feed answers: floor source ok", r.floor_source === "ok", r.floor_source);
ok("Arun: on floor 7 h + 3 h 55 m + 1 h 35 m so far = 12 h 30 m; needed 8 h + 4 h (Shastra half day) + 8 h", fa.on_floor_min === 750 && fa.floor_needed_min === 1200, { on: fa.on_floor_min, need: fa.floor_needed_min });
ok("Arun: short 1 h 05 m on the finished days (10 h 55 m of 12 h)", fa.floor === "short" && fa.on_floor_done_min === 655 && fa.floor_needed_done_min === 720 && fa.floor_short_min === 65, fa);
ok("Arun: idle is no movement plus screen locked (55 m), locked apart (15 m)", fa.idle_min === 55 && fa.locked_min === 15 && fa.guard === true, { idle: fa.idle_min, locked: fa.locked_min });
ok("Bela: matched by email; floor time met (16 h 15 m of 16 h)", fb.floor === "met" && fb.on_floor_done_min === 975, fb);
ok("Bela: no Guard machine linked, so no idle time", fb.idle_min === null && fb.guard === false, fb.idle_min);
ok("Cara: Shastra's sick leave on Monday is a day out (target and floor needed left out)", fc.days_out === 1 && fc.days_unplanned === 1 && fc.days_full === 2 && fc.floor_needed_done_min === 480 && fc.target === 70, { out: fc.days_out, full: fc.days_full, need: fc.floor_needed_done_min, target: fc.target });
ok("Gita: no attendance in Shastra for these dates", fg.floor === "no_attendance" && fg.on_floor_min === null, fg.floor);
ok("roster checks name who has no attendance in Shastra and who has no Guard", r.checks.some((c) => /no attendance in Purview Shastra/.test(c.text) && /Gita Agent/.test(c.text)) && r.checks.some((c) => /no Shastra Guard/.test(c.text) && /Bela Agent/.test(c.text)), r.checks);
ok("totals: on floor, idle, met by 2 of 3", r.totals.on_floor_min === 750 + 975 + 540 && r.totals.idle_min === 55 + 240 && r.totals.floor_judged === 3 && r.totals.floor_met === 2, r.totals);
ok("This week: Arun's floor time is short", has(r.suggestions.week, "Arun Agent", /On the floor 10 h 55 m of 12 h needed up to yesterday \(short 1 h 05 m\).*8-hour rule/), r.suggestions.week);
ok("This week: Cara was idle 4 h of 8 h on the floor", has(r.suggestions.week, "Cara Agent", /Idle 4 h of 8 h on the floor/), r.suggestions.week);
{ const c0 = floorCalls; await VP("team.status", q); ok("asked again within 10 minutes: the kept days are used", floorCalls === c0, { before: c0, after: floorCalls }); }
{ const t1 = await VP("team.status", { from: wed, to: wed, today: wed, tz_offset_min: 0 }), a1 = t1.rows.find((x) => x.name === "Arun Agent");
  ok("only today picked: on floor so far, not judged while the day is under way", a1.on_floor_min === 95 && a1.floor === "pending" && !has(t1.suggestions.today.concat(t1.suggestions.week), "Arun Agent", /On the floor/), { on: a1.on_floor_min, floor: a1.floor }); }
r = await TI("team.status", q);
ok("a team lead sees their own team's floor time", r.rows.find((x) => x.name === "Arun Agent").on_floor_min === 750 && !r.rows.some((x) => x.name === "Bela Agent"), r.rows.map((x) => x.name));
floorRows = "error";
await sql("UPDATE settings SET value_json = json_set(value_json, '$.days', json('{}'), '$.fail_at', 0) WHERE key = 'floor_sync'");
r = await VP("team.status", q);
ok("Shastra fails later: the kept figures stay, with the reason", r.floor_source === "ok" && /boom/.test(r.floor_error) && r.rows.find((x) => x.name === "Arun Agent").on_floor_min === 750, { src: r.floor_source, err: r.floor_error });

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
