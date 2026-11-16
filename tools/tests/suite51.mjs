/* Suite 51: a real floor's size (tester Z) and the Monday digest's attention and the bell (tester X). Z-01 the Monday digest
   reads a span's figures for all its clients at once (its database calls stay the same as clients are added) and gives Client
   360's figures; the calls that read once for many people or clients (review people, the desks, the client leads); Z-02 repeat
   denials count every claim denied again; Z-DH what worked counts the whole year; Z-03 Reports and Team allocations list every
   row, in pages; Z-04 Live status lists every open escalation and flagged claim; X-03 one over-90 figure in the digest; X-04 an
   escalation open over 24 hours named once; X-06 the bell keeps the month-end line. Made-up data only. */
import vm from "vm";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const D = "@purview-healthcare.com", SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const clinic = (k) => "Test Clinic " + String(k).padStart(3, "0");
const NC = 24;   // made-up clinics: 4 at first, the rest added later to see what stays the same
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2025-06-02", email: "" }, o);
const BILLERS = ["Arun Agent", "Bela Agent", "Cyra Agent"];
let extraBillers = 0;
const feed = () => [
  P({ emp_id: "V1", name: "Vera Vice", position: "Vice President", project: SUN, email: "vera" + D }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", project: SUN, reports_to: "Vera Vice", email: "mona" + D }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, also_on_projects: [LAKE, ...Array.from({ length: NC }, (_, k) => clinic(k + 1))].join(", "), reports_to: "Mona Manager", email: "tina" + D }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: clinic(1), reports_to: "Mona Manager", email: "lara" + D }),
  P({ emp_id: "S1", name: "Sami Sme", position: "SME", project: SUN, reports_to: "Tina Lead", email: "sami" + D }),
  ...BILLERS.map((n, i) => P({ emp_id: "A" + i, name: n, project: i === 2 ? LAKE : SUN, also_on_projects: i === 2 ? clinic(1) : "", reports_to: "Tina Lead", email: n.split(" ")[0].toLowerCase() + D })),
  ...Array.from({ length: extraBillers }, (_, i) => P({ emp_id: "B" + i, name: "Made-up Biller " + String(i + 1).padStart(2, "0"), project: LAKE, reports_to: "Tina Lead", email: "mb" + i + D })),
  P({ emp_id: "PA", name: "Pavan Poster", department: "Posting", project: SUN, reports_to: "Tina Lead", email: "pavan" + D }),
];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mails = [];
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed() });
  if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("mail-hook.test")) { try { mails.push(JSON.parse(init.body)); } catch (e) {} return new Response("ok"); }
  return new Response("no outside network in tests", { status: 503 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; DB.onWrite = null;
const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const rows = async (q, ...a) => ((await DB.prepare(q).bind(...a).all()).results || []);
const row1 = async (q, ...a) => (await rows(q, ...a))[0];
// D1 calls made by one request or one scheduled run: each first / all / run / raw and each batch is one (as D1 counts them)
let CUR = null;
const ST = Object.getPrototypeOf(DB.prepare("SELECT 1")), SH = Object.getPrototypeOf(DB);
for (const m of ["first", "all", "run", "raw"]) { const f = ST[m]; ST[m] = async function (...a) { if (CUR) CUR.n++; return f.apply(this, a); }; }
{ const f = SH.batch; SH.batch = async function (st) { if (CUR) CUR.n++; return f.call(this, st); }; }
const counted = async (fn) => { const me = { n: 0 }; CUR = me; try { const r = await fn(); return { r, n: me.n }; } finally { CUR = null; } };
const VDate = vm.runInContext("Date", app);
const keepSessions = () => sql("UPDATE sessions SET expires_at = ?", Date.now() + 400 * 86400000);   // the clock moves a week ahead in places
const at = async (ms, fn) => { await keepSessions(); const r1 = Date.now, r2 = VDate.now; Date.now = () => ms; VDate.now = () => ms; try { return await fn(); } finally { Date.now = r1; VDate.now = r2; } };
const MAIL = { EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "made-up-hook-0000", EMAIL_FROM: "Brahmastra <no-reply" + D + ">", DEMO: false };
const runJob = async (cron, ms, env = {}) => { const r1 = Date.now, r2 = VDate.now, log = console.log; Date.now = () => ms; VDate.now = () => ms; console.log = () => {};
  try { const waits = []; await rig.worker.default.scheduled({ cron, scheduledTime: ms }, { ...rig.backend.env, ...rig.liveEnv, DB, ...env }, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); }
  finally { Date.now = r1; VDate.now = r2; console.log = log; } };
const IST = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const mondayIst = (t) => { const d = new Date(t + 330 * 60000), w = d.getUTCDay(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((w + 6) % 7)) - 330 * 60000; };   // 00:00 IST
const H = 3600000, DAY = 86400000;
await app.seedDemo(() => {});
const anon = as(null);
const admin = await anon("auth.login", { email: "supervisor" + D, passHash: await sha("brahmastra-demo") });
const A = as(admin.token);
await A("roster.syncShastra");
const U = async (name) => row1("SELECT * FROM users WHERE name = ? ORDER BY created_at", name);
const signIn = async (name) => { const u = await U(name); await anon("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + name) }).catch(() => {});
  const r = await anon("auth.loginById", { user_id: u.id, passHash: await sha("pw-" + name) }); return { call: as(r.token), token: r.token, user: r.user }; };
let clients = (await A("clients.list")).clients;
const sun = clients.find((c) => c.name === SUN), lake = clients.find((c) => c.name === LAKE);
const TI = await signIn("Tina Lead"), MO = await signIn("Mona Manager");
const mon = mondayIst(Date.now()), nextMon = mon + 7 * DAY;
// every client made before this month: each has a month-end to close
await sql("UPDATE clients SET created_at = ?", Date.parse("2026-08-03T05:00:00Z"));

S("X-03 / X-04: the Monday digest's Needs your attention");
{
  // Sunday's AR reading (the hourly job), then on Monday morning over-90 claims closed before the digest goes out
  await runJob("17 * * * *", nextMon - 13 * 60000);
  const old = await rows("SELECT id FROM claims WHERE client_id = ? AND state IN ('open','assigned') AND balance > 0 AND julianday(?) - julianday(substr(dos, 1, 10)) > 90 ORDER BY balance DESC LIMIT 10", sun.id, IST(nextMon));
  ok("X-03: there are over-90 claims to close (made-up)", old.length >= 5, old.length);
  // an external escalation logged on the week's Monday, no reason given: open over 24 working hours at the week's end
  const loc = (await row1("SELECT id FROM locations WHERE client_id = ? AND active = 1", sun.id)).id;
  const e = await at(mon + 5.5 * H, () => T(() => TI.call("escalations.save", { client_id: sun.id, kind: "external", day: IST(mon), dept: "Account Receivable", raised_who: "Client office manager", reported_to: "Tina Lead",
    description: "Made-up: claims were not followed up in time", email_subject: "Made-up follow-up", comment: "Looking into it", owner_id: TI.user.id, location_id: loc, channels: ["Email"] })));
  ok("X-04: the escalation is logged", e.ok, e.e);
  await at(nextMon + 1.5 * H, () => TI.call("claims.setState", { ids: old.map((r) => r.id), state: "closed", reason: "Paid (made-up)" }));
  mails.length = 0;
  await runJob("*/10 3-7 * * MON", nextMon + 8.5 * H, MAIL);   // Monday 08:30 IST
  const m = mails.find((x) => x.to === "tina" + D && /clients · week/.test(x.subject)), text = (m && m.text) || "";
  const head = (text.match(/over 90 ([\d.]+)% \(target/) || [])[1], line = (text.match(/- Sunrise Eye Care:[^\n]*over 90 ([\d.]+)%/) || [])[1], att = (text.match(/Sunrise Eye Care: Over-90 AR is ([\d.]+)%/) || [])[1];
  ok("X-03: the team lead's digest went out", !!m, mails.map((x) => x.to + " " + x.subject));
  const snaps = await rows("SELECT client_id, ar_owed, over90_owed FROM client_snapshots WHERE client_id IN (?, ?) AND day = ?", sun.id, lake.id, IST(nextMon - DAY)), snap = snaps.find((x) => x.client_id === sun.id);
  ok("X-03: one over-90 figure for Sunrise: its line and Needs your attention say the same", line && att === line, { line, att });
  ok("X-03: and it is Sunday's reading, not the AR after Monday's closures (the totals too)", snap && Number(line) === Math.round(snap.over90_owed / snap.ar_owed * 1000) / 10
    && snaps.length === 2 && Number(head) === Math.round(snaps.reduce((t, x) => t + x.over90_owed, 0) / snaps.reduce((t, x) => t + x.ar_owed, 0) * 1000) / 10, { head, line, snaps });
  const escLines = text.split("\n").filter((l) => /^- Sunrise Eye Care: .*escalation.*open over 24/.test(l));
  ok("X-04: the escalation open over 24 hours is listed once under Needs your attention", escLines.length === 1, escLines);
  const shown = text.split("Needs your attention:")[1].split("\n\n")[0].split("\n").filter((l) => /^- /.test(l));
  ok("X-04: no line under Needs your attention is there twice", shown.length && new Set(shown).size === shown.length, shown);
  // the digest page for that week: the same figure on the card and under Needs your attention
  const dash = await at(nextMon + 9.5 * H, () => TI.call("digest.dashboard", {}));
  const card = dash.clients.find((c) => c.name === SUN), attn = dash.rollup.attention.filter((x) => x[1] === SUN);
  ok("X-03: the digest page: Sunrise's over 90 and its attention line agree", card && attn.some((x) => x[2] === `Over-90 AR is ${card.ar.over90_pct}%, above the 15% target`) && !attn.some((x) => /Over-90 AR is/.test(x[2]) && !x[2].includes(card.ar.over90_pct + "%")), { pct: card && card.ar.over90_pct, attn });
  ok("X-04: the digest page names the escalation once, and lists the month-end steps past due", attn.filter((x) => /escalation/.test(x[2]) && /24 h/.test(x[2])).length === 1 && attn.some((x) => /month-end for .* past due/.test(x[2])), attn);
}

S("X-06: the bell keeps the month-end line and it opens Client 360 on that month");
{
  const mid = Date.parse(IST(Date.now()).slice(0, 8) + "16T04:30:00Z");   // the 16th of this month: last month's steps are past due
  const bell = await at(mid, () => TI.call("notify.list", { today: IST(mid) }));
  const me = bell.items.find((x) => x.key === "monthend");
  ok("X-06: the server sends the team lead the month-end line", !!me && me.view === "client" && me.params && me.params.month, me);
  let openable = () => []; try { openable = vm.runInContext("openableViews", app); } catch (e) { console.log("  (the page has no one list of the pages a person may open)"); }
  const lead = openable(TI.user, [], null), biller = openable({ role: "user" }, [], null);
  ok("X-06: the pages a team lead may open include Client 360 and the digest (the bell keeps their lines)", lead.includes("client") && lead.includes("digest") && bell.items.filter((x) => lead.includes(x.view)).some((x) => x.key === "monthend"), lead);
  ok("X-06: a biller's do not", !biller.includes("client") && !biller.includes("digest"), biller);
}

S("Z-01: the Monday digest reads a span's figures for all its clients at once");
{
  const addClinics = async (from, to) => { for (let k = from; k <= to; k++) await A("clients.save", { name: clinic(k), code: "TC" + k, locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 30 }, resp: { ar: { lead: admin.user.id } } } }); await A("roster.syncShastra"); };
  await addClinics(1, 4);
  // made-up claims on the clinics, and work on them last week
  clients = (await A("clients.list")).clients;
  const upload = async (c, n, seed) => { const r = app.makeSampleRows({ kind: "fresh", seed, count: n, today: IST(Date.now()) }), t = app.tableFromObjects(r), mp = app.autoMap(t.headers), b = app.buildClaims({ rows: t.rows, mapping: mp, kind: "fresh", today: IST(Date.now()) });
    app.setToken(admin.token); await app.uploadClaims({ client_id: c.id, location_id: c.locations[0].id, kind: "fresh", file_name: "made-up-" + seed + ".xlsx", claims: b.claims, summary: b.summary, rows_read: t.rows.length }); };
  for (const k of [1, 2, 3, 4]) await upload(clients.find((c) => c.name === clinic(k)), 40, 700 + k);
  const span = "span:" + MO.user.id;
  const dash1 = await counted(() => MO.call("digest.dashboard", { span }));   // the first read keeps today's AR reading
  const d1 = await counted(() => MO.call("digest.dashboard", { span }));
  const p1 = await counted(() => MO.call("digest.preview", { span }));
  ok("Z-01: the manager's span has the demo's clients and the 4 clinics", d1.r.clients.length === 6, d1.r.clients.map((c) => c.name));
  await addClinics(5, NC);
  clients = (await A("clients.list")).clients;
  for (const k of [5, 9, 13, 24]) await upload(clients.find((c) => c.name === clinic(k)), 40, 700 + k);
  await counted(() => MO.call("digest.dashboard", { span }));
  const d2 = await counted(() => MO.call("digest.dashboard", { span }));
  const p2 = await counted(() => MO.call("digest.preview", { span }));
  ok(`Z-01: the digest page makes the same number of D1 queries for 6 and for ${NC + 2} clients (it was about 35 a client)`, d2.r.clients.length === NC + 2 && d1.n === d2.n && d2.n < 100, { six: d1.n, more: d2.n, clients: d2.r.clients.length });
  ok("Z-01: so does the preview", p1.n === p2.n && p2.n < 100, { six: p1.n, more: p2.n });
  // the digest's figures for a client are Client 360's for the same week (a client with no Sunday reading: live AR)
  const wk = d2.r.week, to = Date.parse(wk.week + "T00:00:00Z") - 330 * 60000, from = to - 7 * DAY;
  for (const name of [SUN, clinic(1), clinic(24)]) {
    const card = d2.r.clients.find((c) => c.name === name), cid = clients.find((c) => c.name === name).id;
    const ov = await MO.call("client.overview", { client_id: cid, from_ms: from, to_ms: to, today: wk.week });
    const live = !card.ar.as_of;
    ok(`Z-01: ${name}: the digest gives Client 360's figures for the week (AR, collected, entries, month-end${live ? ", health" : ""})`,
      (!live || (card.ar.now === ov.ar.balance && card.ar.over90_pct === ov.ar.over90_pct && card.health === ov.health)) && JSON.stringify(card.collected) === JSON.stringify(ov.collected) && card.worked.n === ov.worked.entries
      && card.worked.people === ov.worked.people && card.monthend.month === ov.monthend.month && card.monthend.done === ov.monthend.done, { card: { ar: card.ar, collected: card.collected, worked: card.worked, monthend: card.monthend, health: card.health },
        ov: { ar: ov.ar, collected: ov.collected, worked: ov.worked, monthend: { month: ov.monthend.month, done: ov.monthend.done }, health: ov.health } });
  }
  // a team lead's own clients only, and the same numbers as on the manager's page
  const tl = await TI.call("digest.dashboard", { span });
  ok("Z-01: a team lead's digest of the span holds their clients, with the same figures", tl.clients.length >= 1 && tl.clients.every((c) => JSON.stringify(c) === JSON.stringify(d2.r.clients.find((x) => x.id === c.id))), tl.clients.map((c) => c.name));
  // the Monday job: one run (one invocation) sends the spans; its D1 calls do not grow with the clients
  const wkNow = (await A("digest.spans", {})).week.week;
  const cron = async () => { await sql("DELETE FROM digest_log WHERE week = ?", wkNow); await sql("DELETE FROM digest_runs WHERE week = ?", wkNow); mails.length = 0;
    return counted(() => runJob("*/10 3-7 * * MON", mon + 8.5 * H, MAIL)); };
  await cron();   // the first run of the week sends the one-off reminders too (an escalation's 24 hours): the next ones are compared
  const c1 = await cron(), sent1 = mails.length;
  await sql("UPDATE clients SET active = 0 WHERE name IN (" + Array.from({ length: NC - 4 }, (_, k) => `'${clinic(k + 5)}'`).join(",") + ")");
  const c0 = await cron(), sent0 = mails.length;
  await sql("UPDATE clients SET active = 1 WHERE name LIKE 'Test Clinic %'");
  ok(`Z-01: the Monday run makes the same D1 queries with 6 or ${NC + 2} clients, far under D1's 1,000`, sent1 > 0 && sent1 === sent0 && c0.n === c1.n && c1.n < 400, { six: c0.n, more: c1.n, mails: [sent0, sent1] });
  const lm = mails.find((x) => x.to === "lara" + D), lines = lm ? lm.text.split("Client by client:")[1].split("\n\n")[0].split("\n").filter((l) => /^- /.test(l)) : [];
  ok("Z-01: a team lead on one clinic gets the manager's span with that clinic only", lines.length === 1 && lines[0].startsWith("- " + clinic(1) + ":"), lines);
}

S("Z-01 (the same pattern): one read for many people or clients");
{
  const sunClaim = (await rows("SELECT id FROM claims WHERE client_id = ? AND escalated = 0 LIMIT 1", lake.id))[0].id;
  await sql("UPDATE claims SET escalated = 1, escalated_at = ?, escalated_by = (SELECT id FROM users WHERE name = 'Cyra Agent') WHERE id = ?", Date.now() - H, sunClaim);
  const r1 = await counted(() => A("attention.reviewPeople", { id: sunClaim }));
  extraBillers = 20; await A("roster.syncShastra");
  const r2 = await counted(() => A("attention.reviewPeople", { id: sunClaim }));
  ok("Z-01: who may take a reviewed claim: every active biller on its client", r2.r.people.some((p) => p.name === "Cyra Agent") && r2.r.people.filter((p) => /^Made-up Biller/.test(p.name)).length === 20 && !r2.r.people.some((p) => p.name === "Arun Agent"), r2.r.people.map((p) => p.name));
  ok("Z-01: and its D1 queries stay the same with 20 billers more (it was 3 a biller)", r2.n === r1.n && r2.n < 40, { before: r1.n, after: r2.n });
  const l1 = await counted(() => A("reports.clientLeads", {}));
  ok("Z-01: Reports' client leads: the roster team lead, or the lead most of the client's billers report to", JSON.stringify(l1.r.leads[SUN]) === JSON.stringify(["Tina Lead"]) && l1.r.leads[clinic(1)].includes("Lara Lead") && l1.r.leads[clinic(1)].includes("Tina Lead"), { sun: l1.r.leads[SUN], c1: l1.r.leads[clinic(1)] });
  ok(`Z-01: and it makes a few queries for ${NC + 2} clients (it was 2 or 3 a client)`, l1.n < 12, l1.n);
}

S("Z-02 / Z-DH: repeat denials count every claim denied again; what worked counts the whole year");
{
  // 2,600 more claims at Lakeview, each denied twice for the same reason (resubmitted in between), the second 2 days ago
  const today = IST(Date.now()), r = app.makeSampleRows({ kind: "fresh", seed: 5151, count: 2600, today }), t = app.tableFromObjects(r), mp = app.autoMap(t.headers), b = app.buildClaims({ rows: t.rows, mapping: mp, kind: "fresh", today });
  app.setToken(admin.token); await app.uploadClaims({ client_id: lake.id, location_id: lake.locations[0].id, kind: "fresh", file_name: "made-up-denials.xlsx", claims: b.claims, summary: b.summary, rows_read: t.rows.length });
  const biller = await U("Cyra Agent"), open = await rows("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND first_batch_id = (SELECT id FROM batches WHERE file_name = 'made-up-denials.xlsx') ORDER BY id", lake.id);
  const now = Date.now(), notes = [];
  open.forEach((c, i) => { notes.push(["s51a-" + i, c.id, biller.id, biller.name, "Claim Denied", "COB Issue", "Correction, Resubmission & Reprocessing", now - 10 * DAY + i]);
    notes.push(["s51b-" + i, c.id, biller.id, biller.name, "Claim Denied", "COB Issue", "INFORM", now - 2 * DAY + i]); });
  // the last 40 claims by id: paid after the first denial and denied again for another reason after that (what worked: the resubmission)
  open.slice(-40).forEach((c, i) => { notes.push(["s51p-" + i, c.id, biller.id, biller.name, "Claim Paid", "Paid to provider", "Need to Post", now - 9 * DAY + i]); });
  const NOTE = `INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, status_code, sub_status, action, action_code, created_at)
    SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), 'work', json_extract(value,'$[4]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[6]'), json_extract(value,'$[7]') FROM json_each(?)`;
  for (let i = 0; i < notes.length; i += 1000) await sql(NOTE, JSON.stringify(notes.slice(i, i + 1000)));
  const reps = new Set(open.slice(0, -40).map((c) => c.id));   // the 40 paid in between are not denied again since a payment
  const bell = await A("notify.list", {}), item = bell.items.find((x) => x.key === "repeat_denials");
  ok(`Z-02: the bell counts every claim denied again in 14 days (${reps.size}, more than the 2,000 it looked at)`, reps.size > 2000 && item && item.n >= reps.size, item);
  const dr = await counted(() => A("denials.repeats", { client_id: lake.id }));
  ok("Z-02: Repeat denials gives the whole count and lists the latest 500", dr.r.total >= reps.size && dr.r.claims.length === 500 && dr.r.claims.every((c, i, xs) => !i || xs[i - 1].last_at >= c.last_at), { total: dr.r.total, listed: dr.r.claims.length });
  const latest = [...reps].map((id) => notes.find((n) => n[1] === id && n[0].startsWith("s51b-"))[7]).sort((x, y) => y - x)[499];
  ok("Z-02: the 500 listed are the newest (none older than the 500th newest)", dr.r.claims.every((c) => c.last_at >= latest), latest);
  ok("Z-02: within D1's limits (claims read 500 a query, as one value)", dr.n < 40, dr.n);
  // what worked: the claims paid between their denials sort last by id; read by claim id up to 50,000 entries they were left out
  const filler = [], fill = open.slice(0, 1200);
  fill.forEach((c, i) => { for (let j = 0; j < 42; j++) filler.push(["s51f-" + i + "-" + j, c.id, biller.id, biller.name, "Claim Denied", "Medical necessity", "INFORM", now - (20 + j) * DAY]); });
  for (let i = 0; i < filler.length; i += 1000) await sql(NOTE, JSON.stringify(filler.slice(i, i + 1000)));
  const n = (await row1("SELECT COUNT(*) AS n FROM notes n JOIN claims c ON c.id = n.claim_id WHERE c.client_id = ? AND n.kind = 'work' AND n.status IN ('Claim Denied','Claim Rejected','Claim Paid','Partially Paid')", lake.id)).n;
  const dr2 = await A("denials.repeats", { client_id: lake.id });
  const cob = dr2.claims.find((c) => c.reason === "COB Issue");
  const paidAll = (await A("denials.repeats", { client_id: lake.id })).claims.filter((c) => c.reason === "COB Issue").map((c) => c.worked.top.find((x) => x.action === "Correction, Resubmission & Reprocessing")).filter(Boolean);
  ok(`Z-DH: with ${n} denial and payment entries in the year (over 50,000), what worked still counts the claims that sort last`, n > 50000 && cob && paidAll.length && paidAll.every((x) => x.paid > 0), cob && cob.worked);
  // a claim's tips name the same
  const payerOf = new Map((await rows("SELECT id, payer FROM claims WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(open.map((c) => c.id)))).map((x) => [x.id, x.payer]));
  const paidPayers = new Set(open.slice(-40).map((c) => payerOf.get(c.id))), tc = fill.find((c) => paidPayers.has(payerOf.get(c.id)));
  const tip = await A("claims.tips", { id: tc.id });
  ok("Z-DH: a claim denied again: its tips name what worked before at its payer, from the claims that sort last", tip.repeat && tip.repeat.times === 2 && tip.repeat.worked && tip.repeat.worked.top.some((x) => x.action === "Correction, Resubmission & Reprocessing" && x.paid > 0), tip.repeat);
}

S("Z-DH: what worked follows the same rules as before (each denial, the next payment or denial for the same reason)");
{
  // a few made-up claims at Sunrise with mixed entries; what worked computed here the way the page always counted it
  const biller = await U("Arun Agent"), cs = await rows("SELECT id, payer FROM claims WHERE client_id = ? AND state IN ('open','assigned','completed') ORDER BY id LIMIT 60", sun.id);
  const SA = [["Claim Denied", "COB Issue", "Correction, Resubmission & Reprocessing"], ["Claim Denied", "  cob   ISSUE ", "Need to Appeal"], ["Claim Paid", "Paid to provider", "Need to Post"],
    ["Claim Denied", "Missing information", "INFORM"], ["Claim Rejected", "Missing information", "Correction, Resubmission & Reprocessing"], ["Partially Paid", "Paid to provider", "Need to Post"], ["Claim Denied", "COB Issue", ""]];
  const t0 = Date.now() - 60 * DAY, notes = [];
  cs.forEach((c, i) => { for (let j = 0; j < 6; j++) { const s = SA[(i * 7 + j * 3 + (i % 5)) % SA.length]; notes.push(["s51w-" + i + "-" + j, c.id, biller.id, biller.name, s[0], s[1], s[2], t0 + i * 1000 + j * DAY]); } });
  await sql(`INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, status_code, sub_status, action, action_code, created_at)
    SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), 'work', json_extract(value,'$[4]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[6]'), json_extract(value,'$[7]') FROM json_each(?)`, JSON.stringify(notes));
  // the walk the page used: every denial and payment entry of the year, per claim in time order
  const hist = await rows(`SELECT n.claim_id, n.created_at, n.action, n.sub_status, COALESCE(NULLIF(n.status, ''), n.status_code) AS status, c.client_id, c.payer FROM notes n JOIN claims c ON c.id = n.claim_id
    WHERE n.kind = 'work' AND c.client_id = ? AND n.created_at > ? AND COALESCE(NULLIF(n.status, ''), n.status_code) IN ('Claim Denied', 'Claim Rejected', 'Claim Paid', 'Partially Paid') ORDER BY n.claim_id, n.created_at, n.rowid`, sun.id, Date.now() - 365 * DAY);
  const rk = (r) => String(r || "Other").trim().toLowerCase().replace(/\s+/g, " "), tally = new Map(), add = (k, a, paid) => { if (!a) return; const m = tally.get(k) || new Map(); const x = m.get(a) || { action: a, tried: 0, paid: 0 }; x.tried++; if (paid) x.paid++; m.set(a, x); tally.set(k, m); };
  for (let i = 0; i < hist.length; i++) { const d = hist[i]; if (d.status !== "Claim Denied" && d.status !== "Claim Rejected") continue; const k = rk(d.sub_status); let paid = false;
    for (let j = i + 1; j < hist.length && hist[j].claim_id === d.claim_id; j++) { const x = hist[j]; if (x.status === "Claim Paid" || x.status === "Partially Paid") { paid = true; break; } if (rk(x.sub_status) === k) break; }
    add(d.client_id + "|" + d.payer + "|" + k, d.action, paid); add(d.client_id + "||" + k, d.action, paid); }
  const best = (k) => { const m = tally.get(k); return m ? [...m.values()].filter((x) => x.paid > 0).sort((a, b) => b.paid - a.paid || b.paid / b.tried - a.paid / a.tried).slice(0, 3) : []; };
  const want = (c, p, r) => { const own = best(c + "|" + p + "|" + rk(r)); return own.length ? { any_payer: false, top: own } : { any_payer: true, top: best(c + "||" + rk(r)) }; };
  const dr = await A("denials.repeats", { client_id: sun.id });
  const items = [...dr.claims.map((c) => [c.client_id, c.payer, c.reason, c.worked]), ...dr.patterns.map((p) => [p.client_id, p.payer, p.reason, p.worked])];
  const bad = items.filter(([c, p, r, w]) => JSON.stringify(w) !== JSON.stringify(want(c, p, r)));
  ok("Z-DH: every what-worked on Repeat denials equals the walk over each claim's entries (the same rules, the same order)", items.length > 5 && !bad.length && items.some(([, , , w]) => w.top.length), { items: items.length, bad: bad.slice(0, 2) });
}

S("Z-03: Reports and Team allocations list every row, in pages of 5,000");
{
  // 5,200 claims at Sunrise, each worked once this week by one of 3 billers and left on that biller's list
  const today = IST(Date.now()), r = app.makeSampleRows({ kind: "fresh", seed: 5353, count: 5200, today }), t = app.tableFromObjects(r), mp = app.autoMap(t.headers), b = app.buildClaims({ rows: t.rows, mapping: mp, kind: "fresh", today });
  app.setToken(admin.token); await app.uploadClaims({ client_id: sun.id, location_id: sun.locations[0].id, kind: "fresh", file_name: "made-up-week.xlsx", claims: b.claims, summary: b.summary, rows_read: t.rows.length });
  const bs = await rows(`SELECT id, name FROM users WHERE name IN ('Arun Agent', 'Bela Agent', 'Pavan Poster') ORDER BY name`);
  const mine = await rows("SELECT id FROM claims WHERE first_batch_id = (SELECT id FROM batches WHERE file_name = 'made-up-week.xlsx') ORDER BY claim_no");
  const now = Date.now(), from = now - 6 * DAY - 12 * H, notes = [], ups = [];
  mine.forEach((c, i) => { const u = bs[i % 3], at2 = from + Math.floor((now - H - from) * ((i + 0.5) / mine.length)); notes.push(["s51r-" + i, c.id, u.id, u.name, "Claim In Process", "Need to allow some time", "EOB not Available/Requested EOB", at2]); ups.push([c.id, u.id, at2]); });
  for (let i = 0; i < notes.length; i += 1000) {
    await sql(`INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, status_code, sub_status, action, action_code, created_at)
      SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), 'work', json_extract(value,'$[4]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'), json_extract(value,'$[6]'), json_extract(value,'$[6]'), json_extract(value,'$[7]') FROM json_each(?)`, JSON.stringify(notes.slice(i, i + 1000)));
    await sql(`UPDATE claims SET assigned_to = json_extract(j.value,'$[1]'), assigned_at = json_extract(j.value,'$[2]'), state = 'completed', completed_at = json_extract(j.value,'$[2]'), last_worked_by = json_extract(j.value,'$[1]')
      FROM json_each(?) AS j WHERE claims.id = json_extract(j.value,'$[0]')`, JSON.stringify(ups.slice(i, i + 1000)));
  }
  const to = now + H, all = (await row1("SELECT COUNT(*) AS n FROM notes WHERE kind = 'work' AND created_at BETWEEN ? AND ?", from, to)).n;
  const one = await A("reports.work", { kind: "work", from_ms: from, to_ms: to });
  // the page's own loader (every page); a server that does not page answers the same rows to every page: asked once then
  const pages = (op, p) => { app.setToken(admin.token); return one.total != null ? app.rpcAllPages(op, p, 5000) : A(op, p); };
  const work = await pages("reports.work", { kind: "work", from_ms: from, to_ms: to });
  ok(`Z-03: Reports for the week: every entry (${all}), loaded in pages of 5,000`, work.rows.length === all && work.total === all && new Set(work.rows.map((x) => x.claim_id + x.created_at)).size === all, { rows: work.rows.length, total: work.total, all });
  ok("Z-03: asked in one answer (an older page): the latest 5,000, with the total so it can be said", one.rows.length === 5000 && one.total === all && one.rows[0].created_at >= one.rows[4999].created_at, { rows: one.rows.length, total: one.total });
  const p2 = await A("reports.work", { kind: "work", from_ms: from, to_ms: to, page: 2, page_size: 99999 });
  ok("Z-03: a page holds at most 5,000", p2.page_size === 5000 && p2.rows.length === Math.min(5000, all - 5000), { size: p2.page_size, rows: p2.rows.length });
  const desk = await pages("reports.desk", { from_ms: from, to_ms: to });
  const people = new Set(desk.rows.map((x) => x.assigned_name).filter(Boolean)), ids = new Set(desk.rows.map((x) => x.claim_id));
  ok("Z-03: Team allocations: every biller is there (all 3), every claim once", ["Arun Agent", "Bela Agent", "Pavan Poster"].every((nm) => people.has(nm)) && ids.size === desk.rows.length && desk.rows.length === desk.total && mine.every((c) => ids.has(c.id)), { people: [...people], rows: desk.rows.length, total: desk.total });
  const deskOne = await A("reports.desk", { from_ms: from, to_ms: to });
  ok("Z-03: Team allocations in one answer: the first 5,000 by biller, with the total", deskOne.rows.length === 5000 && deskOne.total === desk.total, { rows: deskOne.rows.length, total: deskOne.total });
}

S("Z-04: Live status lists every open escalation and flagged claim, as its tab counts them");
{
  const open0 = (await A("attention.count", {})).esc_open;
  for (let i = 1; open0 + i <= 310; i++) await A("escalations.save", { kind: i % 4 ? "external" : "internal", client_id: i % 2 ? sun.id : lake.id, day: IST(Date.now()), dept: "Account Receivable", raised_who: "Office manager at the client", reported_to: "the team lead",
    owner_id: admin.user.id, email_subject: "Made-up escalation " + i, description: "Made-up escalation for the test: a follow-up was missed", comment: "Being looked at", location_id: "all", channels: ["Email"] });
  const biller = await U("Bela Agent"), ids = (await rows("SELECT id FROM claims WHERE state IN ('open','assigned','completed') AND escalated = 0 ORDER BY claim_no LIMIT 320")).map((x) => x.id);
  await sql("UPDATE claims SET escalated = 1, escalated_at = ?, escalated_by = ? WHERE id IN (SELECT value FROM json_each(?))", Date.now() - H, biller.id, JSON.stringify(ids));
  // the newest red one: past its expected close date
  const newest = await row1("SELECT id FROM escalations ORDER BY created_at DESC, sr DESC LIMIT 1");
  await sql("UPDATE escalations SET expected_on = ? WHERE id = ?", IST(Date.now() - 2 * DAY), newest.id);
  const live = await A("team.huddle", {}), tab = await A("attention.count", {});
  ok("Z-04: the open escalations list holds every one the tab counts (over 300)", tab.esc_open > 300 && live.escalations.length === tab.esc_open, { list: live.escalations.length, tab: tab.esc_open });
  ok("Z-04: the flagged list holds every one the tab counts (over 300)", tab.escalations > 300 && live.flagged.length === tab.escalations, { list: live.flagged.length, tab: tab.escalations });
  ok("Z-04: red first: the newest escalation, past its expected date, is among the first shown", live.escalations.slice(0, 12).some((e) => e.id === newest.id && e.red), live.escalations.slice(0, 3));
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
