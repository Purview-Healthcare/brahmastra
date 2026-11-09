/* Suite 29: the TAT suggestions. (1) The TAT clock skips the company holidays from Purview Shastra, not only weekends.
   (2) "Can't close yet": a team lead gives the reason and the expected close date; the task leaves the reminders until then and
   comes back once the date passes. (3) The month's TAT, worked out by Brahmastra, on the SLA scorecard, and the TAT report in the
   client's SLA & KPI folder after the month closes. (4) Last week's TAT in the Monday digest (no claim numbers in it). */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", project: "Sunrise Eye Care", also_on_projects: "Lakeview Dental Group", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "sima@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" })];
// ---- a small fake of Microsoft Graph (as in suite 20): folders, files and one worksheet per workbook
const OD = { items: new Map(), seq: 0, rows: new Map(), patches: 0 };
const mk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it); if (kind === "file") OD.rows.set(id, []); return it; };
const child = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const out = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const pathOf = (id) => { const p = []; let it = OD.items.get(id); while (it) { p.unshift(it.name); it = OD.items.get(it.parent); } return p.join("/"); };
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const u = new URL(url); const path = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));
  let r;
  const walk = (parts, make) => { let cur = "root"; for (const nm of parts) { let it = child(cur, nm); if (!it) { if (!make) return null; it = mk(nm, cur, "folder"); } cur = it.id; } return cur; };
  if ((r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+\/.+?):(\/content)?$/))) {
    const parts = r[1].split("/"), nm = parts.pop();
    if (m === "PUT" && r[2]) { const dir = walk(parts, true); if (child(dir, nm)) return J({}, 409); return J(out(mk(nm, dir, "file")), 201); }
    if (m === "GET" && !r[2]) { const dir = walk(parts, false); const it = dir && child(dir, nm); return it ? J(out(it)) : J({}, 404); }
  }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range\(address='A(\d+):[A-Z]+\d+'\)\/clear$/))) { const rows = OD.rows.get(r[1]); if (rows) rows.length = Math.min(rows.length, Number(r[2]) - 1); return J({}); }
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (child("root", b.name)) return J({}, 409); return J(out(mk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+)$/))) { const it = child("root", r[1]); return it ? J(out(it)) : J({}, 404); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (child(r[1], r[2])) return J({}, 409); return J(out(mk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: [{ id: "s1", name: "Sheet1" }] });
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/usedRange/))) { const rows = OD.rows.get(r[1]) || []; return J({ rowCount: Math.max(1, rows.length), address: "Sheet1!A1:Z" + Math.max(1, rows.length), values: rows.length ? rows : [[""]] }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/s1\/range\(address='A(\d+):/))) { OD.patches++; const b = JSON.parse(init.body); const rows = OD.rows.get(r[1]) || []; b.values.forEach((v, i) => { rows[Number(r[2]) - 1 + i] = v; }); OD.rows.set(r[1], rows); return J({}); }
  if (m === "POST" && /\/workbook\/(tables|worksheets)\//.test(path)) return J({});
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
let HOLIDAYS_ON = true;
const mails = [];
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_holidays")) return HOLIDAYS_ON ? J({ ok: true, today: "2026-11-08", holidays: [{ date: "2026-11-09", name: "Diwali" }, { date: "2026-12-25", name: "Christmas" }] }) : J({ code: "PGRST202", message: "Could not find the function public.brahmastra_holidays" }, 404);
  if (url.includes("brahmastra_wfm") || url.includes("brahmastra_live") || url.includes("brahmastra_floor")) return J({ ok: false, error: "not here" }, 404);
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); }
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
await sql("UPDATE sessions SET expires_at = expires_at + ?", 60 * 86400000);
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name));
await sql("UPDATE clients SET posting_tat_hours = 24, submission_tat_hours = 24 WHERE id = ?", sun.id);
const IST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const at = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };
const runJob = (ms, cron = "17 * * * *") => at(ms, async () => { const ps = []; await rig.worker.default.scheduled({ cron }, { ...rig.backend.env, ...rig.liveEnv, DEMO: false, DB: rig.backend.env.DB }, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); });
const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 60 })).rows;
let k = 0; const next = () => pool[k++];
const ho = async (dept, created, due, extra = {}) => { const c = next(); const id = "h" + k; await sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, lead_id, done_at, done_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  id, c.id, sun.id, dept, extra.status || "pending", created, "Arun Agent", due, U("Tina Lead").id, extra.done || null, extra.done_by || ""); await sql("UPDATE claims SET state = 'in_process' WHERE id = ?", c.id); return { id, claim: c }; };

S("1. Company holidays from Shastra: the TAT clock skips them");
const hs = (await rows("SELECT value_json FROM settings WHERE key = 'holidays'"))[0];
ok("the roster sync brought the holidays", hs && /Diwali/.test(hs.value_json), hs);
{ const me = await TI("auth.me"); ok("auth.me brings the coming holidays, so the work form's follow-up date skips them before saving", Array.isArray(me.holidays) && me.holidays.includes("2026-12-25"), me.holidays); }
// flagged Thursday 10:00; Monday Nov 9 is Diwali: Tuesday 09:00 is 47 working hours, Tuesday 11:00 is 49
const flag = next();
await sql("UPDATE claims SET escalated = 1, escalated_at = ?, escalated_by = ?, assigned_to = ?, state = 'completed' WHERE id = ?", IST(2026, 11, 5, 10), U("Arun Agent").id, U("Arun Agent").id, flag.id);
let row = (await at(IST(2026, 11, 10, 9), () => TI("attention.list", {}))).rows.find((r) => r.id === flag.id);
ok("flagged Thursday 10:00, Tuesday 09:00 is 47 working hours (weekend and Diwali skipped): not past", row && !row.overdue && Math.round(row.waiting_ms / 3600000) === 47, row && row.waiting_ms / 3600000);
row = (await at(IST(2026, 11, 10, 11), () => TI("attention.list", {}))).rows.find((r) => r.id === flag.id);
ok("Tuesday 11:00: past", row && row.overdue);
const inv = await at(IST(2026, 11, 8, 12), () => TI("inventory.status", { client_id: sun.id, today: "2026-11-08" }));
ok("Inventory status names the next holidays", inv.pending.holidays.ok && inv.pending.holidays.next[0].name === "Diwali", inv.pending.holidays);
HOLIDAYS_ON = false; await A("roster.syncShastra"); HOLIDAYS_ON = true;
const hs2 = JSON.parse((await rows("SELECT value_json FROM settings WHERE key = 'holidays'"))[0].value_json);
ok("Shastra without the function: the last list stays, with the error", hs2.ok === false && hs2.rows.length === 2 && /brahmastra_holidays/.test(hs2.error), hs2);
await A("roster.syncShastra");

S("2. Can't close yet: reason and expected date");
const now = IST(2026, 11, 11, 11);
const late1 = await ho("posting", IST(2026, 11, 5, 10), IST(2026, 11, 6, 10));
const late2 = await ho("posting", IST(2026, 11, 5, 11), IST(2026, 11, 6, 11));
let tl = await at(now, () => TI("tat.list", {}));
ok("Past TAT lists both hand-offs and the flagged claim", tl.late.filter((x) => x.client_id === sun.id).length === 3 && tl.late.every((x) => x.can_hold), tl.late.map((x) => x.type + " " + x.claim_no));
const H = (p) => T(() => at(now, () => TI("tat.hold", p)));
let r = await H({ kind: "handoff", id: late1.id, until: "2026-11-13" });
ok("a reason is needed", !r.ok && /why/.test(r.e), r);
r = await H({ kind: "handoff", id: late1.id, reason: "Other", note: "", until: "2026-11-13" });
ok("Other needs the reason written", !r.ok && /Write the reason/.test(r.e), r);
r = await H({ kind: "handoff", id: late1.id, reason: "Waiting on the payer", until: "2026-11-10" });
ok("the date cannot be in the past", !r.ok && /today or later/.test(r.e), r);
r = await H({ kind: "handoff", id: late1.id, reason: "Waiting on the payer", until: "2026-12-30" });
ok("at most 30 days ahead", !r.ok && /30 days/.test(r.e), r);
r = await T(() => at(now, () => AR("tat.hold", { kind: "handoff", id: late1.id, reason: "Waiting on the payer", until: "2026-11-13" })));
ok("billers cannot", !r.ok && r.status === 403, r);
r = await H({ kind: "handoff", id: late1.id, reason: "Waiting on the payer", note: "Reprocessing takes 2 days", until: "2026-11-13" });
ok("a team lead puts it on hold until Friday", r.ok && r.r.until === "2026-11-13", r);
r = await H({ kind: "flag", id: flag.id, reason: "Needs a manager's decision", until: "2026-11-12" });
ok("a flagged claim can be held too", r.ok, r);
tl = await at(now, () => TI("tat.list", {}));
ok("held: off Past TAT, on the On hold list with the reason", tl.late.filter((x) => x.client_id === sun.id).length === 1 && tl.held.length === 2 && tl.held.some((x) => x.hold.reason === "Waiting on the payer" && x.hold.note === "Reprocessing takes 2 days"), { late: tl.late.length, held: tl.held.map((x) => x.hold.reason) });
let nt = await at(now, () => TI("notify.list", { today: "2026-11-11" }));
ok("the bell and the red bar count only the one not on hold", nt.past_tat === 1, nt.past_tat);
{ // Needs attention counts: the held flag is not "over 48 working hours"; the page's Client filter narrows the tab counts
  const ac = await at(now, () => TI("attention.count", {}));
  ok("the Needs attention count leaves the held flag out of 'over 48 working hours'", ac.escalations >= 1 && ac.overdue === 0, ac);
  const oc = (await rows("SELECT id, client_id, state FROM claims WHERE client_id <> ? AND escalated = 0 AND state = 'open' LIMIT 1", sun.id))[0];
  await sql("UPDATE claims SET escalated = 1, escalated_at = ?, state = 'completed' WHERE id = ?", now - 3600000, oc.id);
  const al = (await at(now, () => A("attention.list", {}))).rows, byC = {};
  for (const x of al) byC[x.client_id] = (byC[x.client_id] || 0) + 1;
  const per = {}; for (const cid of Object.keys(byC)) per[cid] = (await at(now, () => A("attention.count", { client_id: cid }))).escalations;
  ok("with the Client filter, each client's tab count is that client's flagged claims only", Object.keys(byC).length >= 2 && Object.keys(byC).every((cid) => per[cid] === byC[cid])
    && (await at(now, () => A("attention.count", {}))).escalations === al.length, { byC, per });
  await sql("UPDATE claims SET escalated = 0, escalated_at = NULL, state = ? WHERE id = ?", oc.state, oc.id); }
// no separate Past TAT page: the Posting & submission tab shows the hold on the row, and its cards count it as On hold
const hl = await at(now, () => TI("handoffs.list", { client_id: sun.id, view: "open" }));
const hr1 = hl.rows.find((x) => x.id === late1.id), hr2 = hl.rows.find((x) => x.id === late2.id);
ok("in Posting & submission the held claim is On hold with its reason, not past TAT; the other one is past TAT", hr1 && hr1.hold && hr1.hold.active && hr1.hold.reason === "Waiting on the payer" && !hr1.overdue && hr1.can_hold
  && hr2 && hr2.overdue && !hr2.hold && hl.stats.held_n === 1 && hl.stats.overdue === hl.rows.filter((x) => x.overdue).length && hl.hold_reasons.includes("Waiting on the payer"), [hr1 && hr1.hold, hr2 && hr2.overdue, hl.stats.held_n, hl.stats.overdue]);
ok("...and a biller cannot hold it (the row says so)", !(await at(now, () => AR("handoffs.list", { view: "open" }))).rows.some((x) => x.can_hold));
{ // the cards list exactly what they count: one more claim, waiting on the client, past its TAT, not yet time to chase
  const wc = await ho("posting", IST(2026, 11, 5, 12), IST(2026, 11, 6, 12), { status: "client" });
  await sql("UPDATE handoffs SET paused_at = ?, client_sent_at = ?, chase_at = ? WHERE id = ?", IST(2026, 11, 9, 10), IST(2026, 11, 9, 11), IST(2026, 11, 12, 11), wc.id);
  const L = (view, extra = {}) => at(now, () => TI("handoffs.list", { client_id: sun.id, view, ...extra }));
  const op = await L("open"), lt = await L("late"), hd = await L("held");
  ok("Past TAT lists exactly what its card counts, the late claim waiting on the client included", lt.rows.length === op.stats.overdue && lt.rows.some((x) => x.id === wc.id) && lt.rows.every((x) => x.overdue), [lt.rows.length, op.stats.overdue]);
  ok("On hold lists exactly what its card counts", hd.rows.length === op.stats.held_n && hd.rows.every((x) => x.hold && x.hold.active), [hd.rows.length, op.stats.held_n]);
  ok("Open counts what Open lists (not the one waiting on the client before its chase date)", op.rows.length === op.stats.open_n && !op.rows.some((x) => x.id === wc.id), [op.rows.length, op.stats.open_n]);
  const hc = await L("late", { hide_client: true }), oh = await L("open", { hide_client: true });
  ok("Hide claims waiting on the client takes it out of the Past TAT list and count alike", !hc.rows.some((x) => x.id === wc.id) && hc.rows.length === oh.stats.overdue, [hc.rows.length, oh.stats.overdue]);
  await sql("UPDATE handoffs SET chase_at = ? WHERE id = ?", IST(2026, 11, 10, 11), wc.id);
  const op2 = await L("open");
  ok("once it is time to chase the client it is on Open and in the Open count", op2.rows.some((x) => x.id === wc.id && x.chase) && op2.rows.length === op2.stats.open_n, [op2.rows.length, op2.stats.open_n]);
  await sql("DELETE FROM handoffs WHERE id = ?", wc.id); await sql("UPDATE claims SET state = 'open' WHERE id = ?", wc.claim.id); }
{ const hc = await at(now, () => TI("handoffs.count", {}));
  const all1 = (await rows("SELECT COUNT(*) AS n FROM handoffs WHERE status IN ('pending','assigned','client') AND due_at < ? AND (lead_id = ? OR backup_id = ? OR assigned_to = ?)", now, U("Tina Lead").id, U("Tina Lead").id, U("Tina Lead").id))[0];
  ok("the red bar on other pages counts the held one out too (Tina leads every hand-off here)", all1.n >= 2 && hc.overdue === all1.n - 1, [hc.overdue, all1.n]); }
const pv = await at(now, () => TI("tat.preview", { kind: "desks" }));
ok("the 09:00 email leaves out the held one", pv.mail && pv.mail.n === 1 && !pv.mail.html.includes(late1.claim.claim_no) && pv.mail.html.includes(late2.claim.claim_no));
const inv2 = await at(now, () => TI("inventory.status", { client_id: sun.id, today: "2026-11-11" }));
ok("Inventory status shows it as on hold", inv2.pending.desks.posting.hold === 1 && inv2.pending.desks.posting.late === 1 && inv2.pending.attn.hold === 1, inv2.pending.desks.posting);
const hist = await TI("claims.timeline", { id: late1.claim.id }).catch((e) => ({ error: e.message }));
ok("the hold is on the claim's timeline", hist && (hist.items || hist.rows || []).some((x) => x.kind === "tat_hold" && /payer/.test(x.text)), hist && (hist.items || hist.rows || []).map((x) => x.kind));
// the date passes: back on the reminders, saying so
const after = IST(2026, 11, 16, 10);
tl = await at(after, () => TI("tat.list", {}));
const back = tl.late.find((x) => x.ref_id === late1.id);
ok("after Friday it is back on Past TAT, marked past the expected date", back && back.hold_past && back.hold_past.until === "2026-11-13", back);
const pv2 = await at(after, () => TI("tat.preview", { kind: "desks" }));
ok("and the email says the date has passed", pv2.mail && /expected 2026-11-13 \(waiting on the payer\): the date has passed/.test(pv2.mail.html), pv2.mail && pv2.mail.text);
// re-flagged later: the old hold does not carry over
await sql("UPDATE claims SET escalated_at = ? WHERE id = ?", IST(2026, 11, 11, 12), flag.id);
tl = await at(IST(2026, 11, 11, 13), () => TI("tat.list", {}));
ok("a claim flagged again is not covered by the old hold", !tl.held.some((x) => x.ref_id === flag.id));
// clear
const held = (await at(now, () => TI("tat.list", {}))).held.find((x) => x.ref_id === late1.id);
r = await T(() => at(now, () => TI("tat.unhold", { id: held.hold.id })));
ok("clearing the hold puts it back on the reminders", r.ok && (await at(now, () => TI("tat.list", {}))).late.some((x) => x.ref_id === late1.id));
r = await T(() => at(now, () => TI("tat.unhold", { id: held.hold.id })));
ok("clearing twice says it is already cleared", !r.ok && r.status === 404, r);
// claims waiting on the client can be left out of Open (and out of the Past TAT count)
await sql("UPDATE handoffs SET status = 'client', paused_at = ?, chase_at = ? WHERE id = ?", now - 7200000, now - 3600000, late2.id);
const withC = await at(now, () => TI("handoffs.list", { client_id: sun.id, view: "open" })), noC = await at(now, () => TI("handoffs.list", { client_id: sun.id, view: "open", hide_client: true }));
ok("Hide claims waiting on the client: they leave Open and the Past TAT count", withC.rows.some((x) => x.id === late2.id) && !noC.rows.some((x) => x.id === late2.id) && noC.stats.overdue === withC.stats.overdue - 1, [withC.stats.overdue, noC.stats.overdue]);
await sql("UPDATE handoffs SET status = 'pending', paused_at = NULL, chase_at = NULL WHERE id = ?", late2.id);
r = await T(() => at(now, () => TI("tat.hold", { kind: "handoff", id: "nope", reason: "Waiting on the payer", until: "2026-11-13" })));
ok("an unknown task is a 404", !r.ok && r.status === 404, r);

S("3. The month's TAT on the SLA scorecard, and the TAT report in OneDrive");
// November: 3 Posting due (2 closed in time, 1 late), Submission 2 + Rejections 1 due (all in time), 1 Posting still open past due
const N = (d, h) => IST(2026, 11, d, h);
await ho("posting", N(2, 9), N(3, 9), { status: "complete", done: N(3, 8) });
await ho("posting", N(2, 10), N(3, 10), { status: "complete", done: N(3, 9) });
await ho("posting", N(2, 11), N(3, 11), { status: "complete", done: N(4, 11) });
await ho("submission", N(2, 9), N(3, 9), { status: "complete", done: N(2, 15) });
await ho("submission", N(2, 10), N(3, 10), { status: "back", done: N(3, 9) });
await ho("rejection", N(2, 11), N(3, 11), { status: "complete", done: N(3, 10) });
// every hand-off to Submission counts, the same claim sent again included; the recheck after submitting does not, even late
const sub1 = await ho("submission", N(5, 9), N(6, 9), { status: "complete", done: N(5, 15) });
await sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, lead_id, done_at, done_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  "resub-1", sub1.claim.id, sun.id, "submission", "complete", N(9, 9), "Arun Agent", N(10, 9), U("Tina Lead").id, N(9, 12), "");
await sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, available_at, lead_id, done_at, done_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  "recheck-1", sub1.claim.id, sun.id, "subcheck", "complete", N(5, 15), "Arun Agent", N(10, 15), N(9, 15), U("Arun Agent").id, N(12, 10), "");
const ex = await at(IST(2026, 11, 20, 12), () => TI("sla.extras", { client_id: sun.id, from: "2026-11-01", to: "2026-11-30", today: "2026-11-20" }));
ok("Payment posting: closed after the TAT and still open past it both count as missed", ex.tat.posting.due === 5 && ex.tat.posting.met === 2 && ex.tat.posting.missed === 3, ex.tat.posting);
ok("Submission counts Rejections too (they resubmit to the Submission TAT)", ex.tat.submission.due === 5 && ex.tat.submission.met === 5 && ex.tat.submission.pct === 100, ex.tat.submission);
ok("every time a claim goes to Submission counts (a resubmission of the same claim too); the late recheck after submitting does not", ex.tat.submission.due === 5 && !ex.tat.missed.some((m) => m.dept === "submission"), ex.tat.missed);
ok("each part has its TAT and the missed claims are listed", ex.tat.posting.tat === 24 && ex.tat.missed.some((m) => m.dept === "posting" && m.closed), ex.tat.missed.slice(0, 2));
// December 1: the November TAT report goes to the SLA & KPI folder under each team lead, once
const p0 = OD.patches;
await runJob(IST(2026, 12, 1, 10));
const file = [...OD.items.values()].find((x) => x.kind === "file" && /^TAT Report - Sunrise Eye Care - Nov 2026\.xlsx$/.test(x.name));
ok("the TAT report is in Brahmastra Reports / Tina Lead / Sunrise Eye Care / SLA & KPI", file && /Brahmastra Reports\/Tina Lead\/Sunrise Eye Care\/SLA & KPI/.test(pathOf(file.id)), file && pathOf(file.id));
const sheet = file ? OD.rows.get(file.id) : [];
ok("a header and one row per hand-off due in November, Within TAT Yes / No", sheet[0] && sheet[0][0] === "Claim #" && sheet[0][5] === "Within TAT" && sheet.length - 1 === 10 && !sheet.some((x) => /recheck/i.test(String(x[1]))) && sheet.some((x) => x[5] === "No") && sheet.some((x) => x[5] === "Yes"), sheet.slice(0, 3));
ok("no patient names in it", !sheet.some((x) => pool.some((c) => c.patient && x.includes(c.patient))));
const p1 = OD.patches;
await runJob(IST(2026, 12, 1, 11));
ok("written once: the next run leaves it", OD.patches === p1 && p1 > p0, { p0, p1, now: OD.patches });

S("4. Last week's TAT in the Monday digest");
// the week of Nov 16 to 22: 2 Posting due (1 late), 1 Submission in time
await ho("posting", IST(2026, 11, 16, 9), IST(2026, 11, 17, 9), { status: "complete", done: IST(2026, 11, 17, 8), done_by: "Neha Post" });
await ho("posting", IST(2026, 11, 16, 10), IST(2026, 11, 17, 10), { status: "complete", done: IST(2026, 11, 18, 10), done_by: "Neha Post" });
await ho("submission", IST(2026, 11, 16, 10), IST(2026, 11, 17, 10), { status: "complete", done: IST(2026, 11, 16, 15) });
const dd = await at(IST(2026, 11, 23, 9), () => A("digest.dashboard", {}));
const card = (dd.clients || []).find((c) => /Sunrise/.test(c.name));
ok("the digest card has last week's TAT", card && card.tat && card.tat.parts.some((x) => x.k === "posting" && x.due === 2 && x.met === 1 && x.pct === 50), card && card.tat);
ok("and says where it was missed most, with whom", card.tat.worst && card.tat.worst.label === "Payment posting" && card.tat.worst.who === "Neha Post", card.tat.worst);
ok("the line reads plainly", /Payment posting 50% \(1 of 2\)/.test(card.tat_line) && /most missed: Payment posting, 1 \(1 with Neha Post\)/.test(card.tat_line), card.tat_line);
ok("the top of the digest adds it up", dd.rollup.tat && dd.rollup.tat.posting.due >= 2, dd.rollup.tat);
mails.length = 0;
await at(IST(2026, 11, 23, 9), () => A("digest.sendNow", { span: dd.span.key }));
const dm = mails.find((m) => /TAT LAST WEEK/.test(m.html));
ok("the Monday email has a TAT section", !!dm, mails.map((m) => m.subject));
ok("with no claim numbers in it", dm && !pool.slice(0, k).some((c) => c.claim_no && dm.html.includes(c.claim_no)));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
