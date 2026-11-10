/* Suite 33: Team tasks. A team lead gives a task to people on their team (client, scope, what, how many, TAT, files); each
   person gets their share with a notice, sees it in My tasks, updates the count (In progress, Completed, Need help) with a
   comment and files; the team lead gets a notice; reminders, Can't close yet, past the TAT on the bell and in the 19:00 email
   (no task text in it), the task done when everyone completes, edit and reassign, close, and the items counted on Team status. */
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
  P({ emp_id: "A3", name: "Cyra Agent", project: "Lakeview Dental Group", reports_to: "Lara Lead", email: "cyra@purview-healthcare.com" })];
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
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LA = await firstIn("Lara Lead", "lara@purview-healthcare.com");
const AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com"), CY = await firstIn("Cyra Agent", "cyra@purview-healthcare.com");
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
const arun = U("Arun Agent").id, bela = U("Bela Agent").id, lara = U("Lara Lead").id;
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const PDF = Buffer.from("%PDF-1.4 made-up denials list\n%%EOF").toString("base64"), PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const HTML = Buffer.from("<script>alert(1)</script>").toString("base64");
const base = { client_id: sun.id, scope: "AR follow-up", title: "Recheck the BCBS denials the client sent", description: "Made-up: check each claim on the portal and note the reference (SECRET-DESC-123).",
  source: "Client", tat: { kind: "24" }, count: 40, people: [{ user_id: arun, share: 20 }, { user_id: bela, share: 20 }] };

S("1. Who can give a task, and to whom");
let r = await T(() => AR("tasks.create", base));
ok("a biller cannot give a task", !r.ok && r.status === 403, r);
r = await T(() => AR("tasks.list", {})); ok("nor list the team's tasks", !r.ok && r.status === 403, r);
const ppl = (await TI("tasks.people", { client_id: sun.id })).people;
ok("the team lead can pick the people on their team (on the client first), not another team lead's", ppl.some((p) => p.id === arun && p.on_client) && ppl.some((p) => p.id === bela) && !ppl.some((p) => p.id === lara), ppl.map((p) => p.name));
for (const [why, extra, re] of [
  ["the shares must add up to the count", { count: 30 }, /add up to 40, not 30/],
  ["someone off the team is refused", { people: [{ user_id: lara, share: 40 }] }, /Only people on your team/],
  ["someone picked twice is refused", { people: [{ user_id: arun, share: 20 }, { user_id: arun, share: 20 }] }, /picked twice/],
  ["a share under 1 is refused", { count: 20, people: [{ user_id: arun, share: 20 }, { user_id: bela, share: 0 }] }, /at least 1/],
  ["nobody picked is refused", { people: [] }, /Pick who does it/],
  ["the scope is needed", { scope: "Something" }, /Pick the scope/],
  ["a name of a few words is needed", { title: "ab" }, /a few words/],
  ["a description over 4,000 characters is refused, never cut", { description: "x".repeat(4001) }, /up to 4,000/],
  ["Other TAT needs 1 to 480 working hours", { tat: { kind: "hours", hours: 0 } }, /1 to 480/],
  ["a due date in the past is refused", { tat: { kind: "date", date: "2020-01-01" } }, /in the past/],
]) { r = await T(() => TI("tasks.create", { ...base, ...extra })); ok(why, !r.ok && re.test(r.e || JSON.stringify(r)), r); }
r = await T(() => TI("tasks.create", { ...base, files: [{ name: "denials.pdf", type: "application/pdf", data: PDF }, { name: "Screenshot 1.png", type: "image/png", data: PNG }, { name: "page.html", type: "text/html", data: HTML }] }));
ok("the team lead gives a task: 40 items, 20 each, TAT 24 working hours, 3 files", r.ok && r.r.task.id && r.r.task.tat_hours === 24 && r.r.task.due_at > Date.now(), r);
const tid = r.r.task.id;
const fl = await DB.prepare("SELECT name, type FROM team_task_files WHERE task_id = ? ORDER BY name").bind(tid).all();
ok("a file that is not safe to open (HTML) is kept as a plain download", fl.results.find((f) => f.name === "page.html").type === "application/octet-stream" && fl.results.find((f) => f.name === "denials.pdf").type === "application/pdf", fl.results);
ok("the task is in the audit trail", !!(await row("SELECT id FROM audit_log WHERE action = 'task.create'")));

S("2. The person given it: a notice, My tasks, the task");
let c = await AR("tasks.count", {});
ok("Arun has 1 open task, not seen yet", c.open === 1 && c.unseen === 1 && c.any >= 1, c);
let nt = await AR("notify.list", { today });
let ni = nt.items.find((x) => x.key.startsWith("task_new:"));
ok("his bell: New task from Tina Lead, with the client, his share and the due time", ni && ni.cat === "tasks" && ni.view === "mytasks" && /New task from Tina Lead: Recheck the BCBS/.test(ni.text) && /Sunrise Eye Care · 0 of 20 items done · due/.test(ni.sub), ni);
let mine = await AR("tasks.mine", {});
let mr = mine.rows[0];
ok("My tasks: his share of 20, not started, to do, with the task's files", mine.rows.length === 1 && mr.share === 20 && mr.done === 0 && mr.todo && mr.files === 3 && mr.new && mine.stats.todo === 1 && mine.stats.items_left === 20, mr);
let g = await AR("tasks.get", { id: tid });
ok("he opens it: the task, only his own share, the files", g.task.title === base.title && g.task.people.length === 1 && g.task.people[0].user_id === arun && g.files.length === 3 && g.me.share === 20 && !g.can_lead, { people: g.task.people, files: g.files.length });
c = await AR("tasks.count", {}); nt = await AR("notify.list", { today });
ok("opening it clears the New task notice", c.unseen === 0 && !nt.items.some((x) => x.key.startsWith("task_new:")), c);
const fid = g.files.find((f) => f.name === "denials.pdf").id;
let fr = await AR("tasks.file", { id: fid });
ok("he opens a file", fr.name === "denials.pdf" && fr.data === PDF);
r = await T(() => CY("tasks.get", { id: tid })); ok("a biller not on the task cannot open it", !r.ok && r.status === 403, r);
r = await T(() => CY("tasks.file", { id: fid })); ok("nor its files", !r.ok && r.status === 403, r);
r = await T(() => LA("tasks.get", { id: tid })); ok("nor another client's team lead", !r.ok && r.status === 403, r);

S("3. Updates: the count, the status, a comment and files; the team lead's notice");
const ap = mr.person_id, bp = (await BE("tasks.mine", {})).rows[0].person_id;
for (const [why, p, re] of [
  ["more than his share is refused", { done: 25, status: "in_progress" }, /0 to 20/],
  ["a status is needed", { done: 5 }, /Pick In progress/],
  ["Need help needs what he needs", { done: 5, status: "help" }, /what you need help with/],
  ["Completed with some not done needs why", { done: 15, status: "completed" }, /write why the rest/],
]) { r = await T(() => AR("tasks.update", { person_id: ap, ...p })); ok(why, !r.ok && re.test(r.e || JSON.stringify(r)), r); }
r = await T(() => BE("tasks.update", { person_id: ap, done: 5, status: "in_progress", comment: "not mine" })); ok("someone else cannot update his share", !r.ok && r.status === 403, r);
r = await T(() => AR("tasks.update", { person_id: ap, done: 12, status: "in_progress", comment: "12 checked on the portal: 9 in process, 3 need records.", files: [{ name: "Status sheet.csv", type: "text/csv", data: Buffer.from("claim,ref\n1,AB").toString("base64") }] }));
ok("Arun: 12 of 20, in progress, with a comment and a file", r.ok && !r.r.closed, r);
nt = await TI("notify.list", { today });
let up = nt.items.find((x) => x.key.startsWith("task_upd:" + tid));
ok("Tina's bell: Arun Agent updated a task: 12 of 20 done", up && up.cat === "tasks" && /Arun Agent updated a task: 12 of 20 done/.test(up.text) && up.view === "attention" && up.params.tab === "tasks" && up.params.task === tid, up);
let tl = await TI("tasks.list", {});
let tr = tl.rows.find((x) => x.id === tid);
ok("Team tasks: 12 of 40 done, the latest update, not yet seen", tr && tr.done === 12 && tr.count === 40 && tr.unseen_update && tr.last_update.by === "Arun Agent" && tl.stats.open === 1 && tl.stats.items_left === 28, tr && { done: tr.done, unseen: tr.unseen_update });
g = await TI("tasks.get", { id: tid });
ok("the team lead sees everyone's share, every step and every file", g.can_lead && g.task.people.length === 2 && g.updates.some((u) => u.kind === "update" && u.done_n === 12 && /9 in process/.test(u.comment)) && g.files.length === 4, { people: g.task.people.length, files: g.files.length });
nt = await TI("notify.list", { today });
ok("opening the task clears the update notice", !nt.items.some((x) => x.key.startsWith("task_upd:" + tid)));
const bf = (await BE("tasks.get", { id: tid })).files;
ok("Bela sees the task's files but not Arun's own update file", bf.length === 3 && !bf.some((f) => f.name === "Status sheet.csv"), bf.map((f) => f.name));
r = await BE("tasks.update", { person_id: bp, done: 4, status: "help", comment: "The portal asks for a new login; who has it?" });
nt = await TI("notify.list", { today });
let hp = nt.items.find((x) => x.key.startsWith("task_help:"));
let ac = await TI("attention.count", {});
ok("Bela asks for help: Tina's bell says so, and it counts on Needs attention", r.ok && hp && /Bela Agent needs your help on a task/.test(hp.text) && ac.tasks === 1 && ac.tasks_help === 1, { hp, ac });

S("4. Past the TAT: the bell, the reminder, Can't close yet, the 19:00 email (no task text)");
await sql("UPDATE team_tasks SET due_at = ? WHERE id = ?", Date.now() - 3 * 3600000, tid);
tl = await TI("tasks.list", {}); tr = tl.rows.find((x) => x.id === tid);
nt = await TI("notify.list", { today }); ac = await TI("attention.count", {});
ok("late: first on Team tasks, counted Past TAT, on the bell and on the badge", tr.late && tl.stats.late === 1 && nt.items.some((x) => x.key === "tasks_late" && x.tone === "red") && ac.tasks_late === 1, { late: tr.late, stats: tl.stats });
ok("Arun's bell: a task is past the TAT", (await AR("notify.list", { today })).items.some((x) => x.key.startsWith("task_late:") && /past the TAT/.test(x.text)));
const pv = await TI("tat.preview", { kind: "ar" });
ok("Tina's 19:00 email lists it: client, scope, done of total, due, who has it", pv.mail && /Team tasks you gave · past the TAT/.test(pv.mail.html) && /Sunrise Eye Care · AR follow-up/.test(pv.mail.html) && /16 of 40/.test(pv.mail.html) && /Arun Agent, Bela Agent|Bela Agent, Arun Agent/.test(pv.mail.html), pv.mail && pv.mail.text);
ok("never the task's name or description", !/Recheck the BCBS/.test(pv.mail.html + pv.mail.text) && !/SECRET-DESC-123/.test(pv.mail.html + pv.mail.text));
ok("and not in another team lead's email", !((await LA("tat.preview", { kind: "ar" })).mail || { html: "" }).html.includes("Team tasks you gave"));
r = await TI("tasks.remind", { id: tid });
ok("Remind reaches both", r.reminded === 2);
ok("Arun's bell: Reminder from Tina Lead", (await AR("notify.list", { today })).items.some((x) => x.key.startsWith("task_remind:") && /Reminder from Tina Lead/.test(x.text)));
r = await T(() => TI("tasks.hold", { id: tid, reason: "Waiting on the client", until: "2020-01-01" })); ok("Can't close yet needs a date today or later", !r.ok, r);
const plus = (d) => new Date(Date.now() + 330 * 60000 + d * 86400000).toISOString().slice(0, 10);
r = await TI("tasks.hold", { id: tid, reason: "Waiting on the client", note: "New login requested", until: plus(3) });
tl = await TI("tasks.list", {}); tr = tl.rows.find((x) => x.id === tid);
ok("on hold: not late, off the bell's past-TAT line and out of the email", tr.held && !tr.late && tl.stats.held === 1 && !(await TI("notify.list", { today })).items.some((x) => x.key === "tasks_late") && !(await TI("tat.preview", { kind: "ar" })).mail, tr.hold);
await TI("tasks.unhold", { id: tid });
ok("clearing the hold puts it back past the TAT", (await TI("tasks.list", {})).rows.find((x) => x.id === tid).late);
r = await T(() => AR("tasks.remind", { id: tid })); ok("a biller cannot remind or hold", !r.ok && r.status === 403, r);

S("5. Done when everyone completes; within TAT or not");
r = await AR("tasks.update", { person_id: ap, done: 20, status: "completed", comment: "" });
ok("Arun completes his 20: the task stays open for Bela", r.ok && !r.closed, r);
r = await T(() => AR("tasks.update", { person_id: ap, done: 20, status: "in_progress", comment: "again" })); ok("a completed share cannot be updated again", !r.ok, r);
r = await BE("tasks.update", { person_id: bp, done: 20, status: "completed", comment: "" });
ok("Bela completes hers: the task is done by itself", r.ok && r.closed, r);
const doneNote = (await TI("notify.list", { today })).items.find((x) => x.key.startsWith("task_upd:" + tid + ":"));
ok("the team lead hears of it on the bell: completed, the task is done", doneNote && /Bela .* completed a task: 20 of 20 done/.test(doneNote.text) && /the task is done/.test(doneNote.sub), doneNote);
tl = await TI("tasks.list", { view: "done" }); tr = tl.rows.find((x) => x.id === tid);
ok("it is under Done, past its TAT (within TAT: no)", tr && tr.status === "done" && tr.within_tat === false && tl.stats.done_7 === 1 && tl.stats.done_7_in_tat === 0, tr && { status: tr.status, within: tr.within_tat });
r = await T(() => AR("tasks.update", { person_id: ap, done: 20, status: "completed", comment: "x" })); ok("nothing more to update on a done task", !r.ok && /closed/.test(r.e || ""), r);
mine = await AR("tasks.mine", {});
ok("Arun's My tasks: under Done, 1 done in 7 days", mine.rows[0] && !mine.rows[0].todo && mine.stats.done_7 === 1 && mine.stats.todo === 0, mine.stats);

S("6. Edit or reassign, and close");
r = await TI("tasks.create", { ...base, title: "Call the patients with missing insurance", scope: "Eligibility (EV)", count: 10, people: [{ user_id: arun, share: 10 }], tat: { kind: "72" } });
const t2 = r.task.id, a2 = (await AR("tasks.mine", {})).rows.find((x) => x.task_id === t2).person_id;
await AR("tasks.update", { person_id: a2, done: 3, status: "in_progress", comment: "3 called" });
r = await T(() => TI("tasks.edit", { id: t2, people: [{ user_id: bela, share: 10 }] })); ok("someone who has done some cannot be taken off", !r.ok && /has done 3/.test(r.e || ""), r);
r = await T(() => TI("tasks.edit", { id: t2, people: [{ user_id: arun, share: 2 }] })); ok("nor given a share below what they did", !r.ok && /can't be below 3/.test(r.e || ""), r);
r = await TI("tasks.edit", { id: t2, title: "Call the patients with missing insurance (Sunrise)", people: [{ user_id: arun, share: 8 }, { user_id: bela, share: 5 }], tat: { kind: "hours", hours: 48 } });
g = await TI("tasks.get", { id: t2 });
ok("reassigned: Arun 8, Bela 5 (13 items), TAT 48 working hours, the change in its history", r.ok && g.task.count === 13 && g.task.people.length === 2 && g.task.tat_hours === 48 && g.updates.some((u) => u.kind === "edit" && /gave 5 to Bela Agent/.test(u.comment)), { count: g.task.count, ups: g.updates.map((u) => u.comment) });
ok("Bela gets it as new", (await BE("notify.list", { today })).items.some((x) => x.key.startsWith("task_new:") && /missing insurance/.test(x.text)));
r = await TI("tasks.close", { id: t2, comment: "The client called the patients themselves." });
mine = await AR("tasks.mine", {});
ok("closed by the team lead: off Arun's to do, shown as closed", r.ok && mine.rows.some((x) => x.task_id === t2 && !x.todo && x.closed_by_lead) && mine.stats.todo === 0, mine.rows.map((x) => [x.title, x.todo]));

S("7. Team status: task items count toward the person's count");
const ts = await TI("team.status", { from: today, to: today, today });
const ra = ts.rows.find((x) => x.id === arun), rb = ts.rows.find((x) => x.id === bela);
ok("Arun: 23 task items today (12, then 8, then 3), 1 task completed", ra && ra.task_items === 23 && ra.tasks_completed === 1 && ra.count === ra.worked + 23, ra && { items: ra.task_items, done: ra.tasks_completed, count: ra.count, worked: ra.worked });
ok("Bela: 20 items (4, then 16), 1 completed", rb && rb.task_items === 20 && rb.tasks_completed === 1, rb && { items: rb.task_items, done: rb.tasks_completed });
ok("the attainment counts claims and task items together", ra.attain_basis !== "today" || ra.attain === (ra.target_today ? Math.round((ra.worked_today + ra.task_items_today) / ra.target_today * 1000) / 10 : null), { attain: ra.attain, basis: ra.attain_basis, wt: ra.worked_today, ti: ra.task_items_today, tt: ra.target_today });
ok("the totals carry the task items", ts.totals.task_items >= 43 && ts.totals.tasks_completed >= 2, ts.totals);
// Arun's first update (12) moved to the last working day: it counts on the finished days, in the attainment and in its words
let prev = new Date(Date.now() + 330 * 60000 - 86400000); while ([0, 6].includes(prev.getUTCDay())) prev = new Date(prev.getTime() - 86400000);
const prevIso = prev.toISOString().slice(0, 10), prevNoon = Date.parse(prevIso + "T12:00:00Z") - 330 * 60000;
await sql("UPDATE team_task_updates SET at = ? WHERE kind = 'update' AND user_id = ? AND done_n = 12", prevNoon, arun);
const ts2 = await TI("team.status", { from: prevIso, to: today, today }), ra2 = ts2.rows.find((x) => x.id === arun);
ok("the 12 items count on the finished day, with the claims", ra2 && ra2.task_items_done === 12 && ra2.count_done === ra2.worked_done + 12 && (ra2.attain_basis !== "done" || ra2.attain === Math.round(ra2.count_done / ra2.target_done * 1000) / 10), ra2 && { done: ra2.task_items_done, cd: ra2.count_done, wd: ra2.worked_done, td: ra2.target_done, attain: ra2.attain, basis: ra2.attain_basis });
const said = [...ts2.suggestions.today, ...ts2.suggestions.week, ...ts2.suggestions.good].filter((x) => x.user_id === arun && /^Attainment/.test(x.seen));
ok("the suggestions name the claims and the task items", !said.length || said.every((x) => /\+ 12 task items/.test(x.seen)), said);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
