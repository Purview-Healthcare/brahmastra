/* Suite 25: the reading side, as the testers found it. Inventory status stages open the claims they count; shared equally
   is equal; an impossible DOS is aged by the file; credit balances do not skew the over-90 share; Live status at the weekend;
   month-end months and scores; Drishti's scorecard (one matcher, odd values, Latest stepping, weeks-only, re-scores, junk
   entries); the Monday digest (retried after a failure, never sent twice, links that name an unknown span or week); WFM
   projects shared between clients; the digest page on an empty database. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const today = new Date().toISOString().slice(0, 10), iso = (d) => new Date(Date.parse(today + "T12:00:00Z") + d * 86400000).toISOString().slice(0, 10);

/* ---------------- Part 1: the demo data ---------------- */
{
  const rig = await makeRig({});
  const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
  await rig.app.seedDemo(() => {});
  const A = as((await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") })).token);
  const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  const cls = (await A("clients.list")).clients, cl = cls[0], cl2 = cls[1];
  const bs = (await A("users.list")).users.filter((u) => u.role === "user" && u.active);
  const pool = (await A("claims.list", { client_id: cl.id, state: "open", page_size: 100 })).rows;
  await A("alloc.reassign", { ids: pool.slice(0, 30).map((c) => c.id), user_id: bs[0].id });
  for (let i = 0; i < 4; i++) await sql("UPDATE claims SET state = 'completed', follow_up_on = ? WHERE id = ?", iso(-(i + 1)), pool[i].id);
  for (let i = 4; i < 6; i++) await sql("UPDATE claims SET state = 'completed', follow_up_on = ? WHERE id = ?", today, pool[i].id);
  for (let i = 6; i < 9; i++) await sql("UPDATE claims SET state = 'completed', follow_up_on = ? WHERE id = ?", iso(5), pool[i].id);
  for (let i = 9; i < 12; i++) await sql("UPDATE claims SET state = 'in_progress' WHERE id = ?", pool[i].id);
  // an overdue claim waiting on the client, and one at Posting: the stage puts them under the hand-off, not overdue
  const now = Date.now();
  await sql("UPDATE claims SET state = 'completed', follow_up_on = ? WHERE id = ?", iso(-3), pool[12].id);
  await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, client_sent_at) VALUES ('s25w', ?, ?, 'submission', 'client', ?, ?, ?)", pool[12].id, cl.id, now - 86400000, now, now - 86400000);
  await sql("UPDATE claims SET state = 'completed', follow_up_on = ? WHERE id = ?", iso(-4), pool[13].id);
  await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at) VALUES ('s25p', ?, ?, 'posting', 'pending', ?, ?)", pool[13].id, cl.id, now - 86400000, now - 3600000);

  S("Inventory status: each stage button opens the claims it counts");
  const inv = await A("inventory.status", { client_id: cl.id, today });
  const L = async (p) => (await A("claims.list", { client_id: cl.id, today, page_size: 10, ...p })).total;
  for (const k of ["open", "list", "later", "due", "overdue", "waiting", "desk"]) {
    const n = await L({ stage: k, state: "" });
    ok(`stage ${k}: ${inv.stages[k].n} counted, the list has the same`, n === inv.stages[k].n, { stage: inv.stages[k].n, list: n });
  }
  ok("on a biller's list counts in progress too (3 here)", inv.stages.list.n >= 3 && (await L({ stage: "list", state: "" })) > (await L({ state: "assigned" })) - 1);
  ok("due today is today only, not the overdue ones", inv.stages.due.n === (await L({ stage: "due", state: "" })) && (await L({ stage: "due", state: "" })) < (await L({ follow_up_due: true, state: "" })));
  ok("Overdue (the Claims checkbox) leaves out claims with an open hand-off, like the stage", (await L({ overdue: true, state: "" })) === inv.stages.overdue.n, { list: await L({ overdue: true, state: "" }), stage: inv.stages.overdue.n });
  const st = await A("claims.stats", { client_id: cl.id, today });
  ok("the Claims in detail banner counts the same overdue claims", st.overdue.n === inv.stages.overdue.n, { banner: st.overdue.n, stage: inv.stages.overdue.n });
  const r0 = await T(() => A("claims.list", { stage: "constructor" }));
  ok("an unknown stage is refused", !r0.ok && r0.status === 400, r0);

  S("Do-first buttons keep the picked client");
  const acts = inv.insights.flatMap((i) => i.act);
  const by = (to) => acts.find((a) => a.to === to);
  ok("overdue follow-ups open the overdue stage of this client", acts.some((a) => a.to === "claims" && a.params.stage === "overdue" && a.params.clientId === cl.id), acts);
  ok("Open Client requests carries the client", by("attention") && by("attention").params.client_id === cl.id, by("attention"));
  ok("Open the desks carries the client", by("handoffs") && by("handoffs").params.client_id === cl.id, by("handoffs"));
  const cr = await A("attention.clientRequests", {});
  ok("Client requests rows carry their client, so the page can show only one", cr.rows.length > 0 && cr.rows.every((r) => r.client_id), cr.rows.slice(0, 1));

  S("A DOS that looks like a date but is not one");
  await sql("UPDATE claims SET dos = '2025-13-45', age_days = 400, balance = 1234.5, state = 'open', assigned_to = NULL WHERE id = ?", pool[40].id);
  const old = (await A("claims.list", { client_id: cl.id, min_age: 91, state: "workable", today, page_size: 500 })).rows;
  ok("it is in the over-90 list, aged by the file (400 days)", old.some((c) => c.id === pool[40].id));
  const inv2 = await A("inventory.status", { client_id: cl.id, today });
  const big = await A("claims.list", { client_id: cl.id, min_age: 91, state: "workable", today, page_size: 500 });
  ok("the 90+ bucket and the min_age 91 list agree", Math.abs(inv2.ages[3].bal - big.amount) < 0.01, { bucket: inv2.ages[3].bal, list: big.amount });

  S("Credit balances and the over-90 share");
  const w2 = (await A("claims.list", { client_id: cl2.id, state: "workable", page_size: 500 })).rows;
  await sql(`UPDATE claims SET balance = -ABS(balance) - 1 WHERE client_id = ? AND state IN ('open','assigned','in_progress','completed')`, cl2.id);
  const neg = await A("inventory.status", { client_id: cl2.id, today });
  ok("a client whose AR is all credit balances has 0% over 90, met", neg.over90_pct === 0 && neg.checks.find((c) => c.key === "o90").ok, { pct: neg.over90_pct, n: w2.length });
  ok("and no 'Resolve the 0 biggest claims' card", !neg.insights.some((i) => /Resolve the 0|\$0\)/.test(i.short || "") || /^Over-90 AR is/.test(i.title)), neg.insights.map((i) => i.short || i.title));
  const pf = await A("portfolio.overview", { client_id: cl2.id, today });
  ok("the Portfolio's over-90 share agrees", pf.rows[0].over90_pct === 0 && pf.totals.over90_pct === 0, [pf.rows[0].over90_pct, pf.totals.over90_pct]);
  // one big credit beside an old debit: the share is of the money owed, never negative
  await sql("UPDATE claims SET balance = 1000, dos = ? WHERE id = ?", iso(-200), w2[0].id);
  await sql("UPDATE claims SET balance = -99999, dos = ? WHERE id = ?", iso(-5), w2[1].id);
  const mix = await A("inventory.status", { client_id: cl2.id, today });
  ok("a big credit does not make the over-90 share negative or 'within target'", mix.over90_pct > 15 && !mix.checks.find((c) => c.key === "o90").ok, mix.over90_pct);
  const card = mix.insights.find((i) => /^Over-90 AR is/.test(i.title));
  ok("the card names at least one claim", card && !/Resolve the 0 /.test(card.short), card && card.short);

  S("Shared equally is equal");
  const [src, x, y] = bs;
  await sql("UPDATE claims SET state = 'open', assigned_to = NULL WHERE state IN ('assigned','in_progress')");
  await sql("DELETE FROM handoffs WHERE id IN ('s25w','s25p')");
  for (const c of cls.slice(0, 2)) await A("clients.saveTeam", { client_id: c.id, team: [src.id, x.id, y.id] });
  for (const c of cls.slice(0, 2)) { const one = (await A("claims.list", { client_id: c.id, state: "open", page_size: 10 })).rows[0]; await A("alloc.reassign", { ids: [one.id], user_id: src.id }); }
  let rb = await A("team.rebalance", { user_id: src.id, dry: true });
  ok("1 claim at each of 2 clients: one each, not both to the same person", rb.to.length === 2 && rb.to.every((p) => p.count === 1), rb.to);
  await sql("UPDATE claims SET state = 'open', assigned_to = NULL WHERE state IN ('assigned','in_progress')");
  for (const [i, c] of cls.slice(0, 2).entries()) { const ids = (await A("claims.list", { client_id: c.id, state: "open", page_size: 10 })).rows.slice(0, i ? 1 : 3).map((z) => z.id); await A("alloc.reassign", { ids, user_id: src.id }); }
  rb = await A("team.rebalance", { user_id: src.id });
  ok("3 + 1 claims: 2 and 2", rb.moved === 4 && rb.to.every((p) => p.count === 2), rb.to);

  S("Live status at the weekend");
  const sat = (() => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); })();
  const wed = new Date(Date.parse(sat + "T12:00:00Z") - 3 * 86400000).toISOString().slice(0, 10);
  const hs = await A("team.huddle", { today: sat }), hw = await A("team.huddle", { today: wed });
  ok("Saturday: weekend, no target, nobody counted in who has not worked", hs.weekend === true && hs.totals.capacity === 0 && hs.totals.in_weekend === 0 && hs.rows.every((r) => r.expected === 0 && !r.behind), [hs.weekend, hs.totals.capacity, hs.totals.in_weekend]);
  ok("a weekday keeps the target", hw.weekend === false && (hw.totals.people === 0 || hw.totals.capacity > 0), [hw.weekend, hw.totals.capacity]);

  S("Month-end: real months and a real score");
  const month = today.slice(0, 7);
  for (const m of ["2026-13", "2026-00", "2099-12", "0000-01"]) { const r = await T(() => A("monthend.set", { client_id: cl.id, month: m, step: "sla", done: true, score: 90 })); ok("month " + m + " is refused", !r.ok && r.status === 400, r); }
  for (const sc of ["", null, undefined, true]) { const r = await T(() => A("monthend.set", { client_id: cl.id, month, step: "sla", done: true, score: sc })); ok("score " + JSON.stringify(sc) + " is refused, not saved as 0", !r.ok, r); }
  ok("this month with a score is fine", (await T(() => A("monthend.set", { client_id: cl.id, month, step: "sla", done: true, score: 88 }))).ok);
  const ov = await A("client.overview", { client_id: cl.id, month: "2026-13", today });
  ok("Client 360 with an impossible month shows the closing month instead", /^\d{4}-(0[1-9]|1[0-2])$/.test(ov.monthend.month) && ov.monthend.month <= month, ov.monthend.month);
  const lg = await T(() => A("client.logAdd", { client_id: cl.id, kind: "next", text: "Call the office manager about the denials", next_on: "2020-01-01" }));
  ok("a next call date in the past is refused", !lg.ok && /past/.test(lg.e), lg);
  ok("a next call today is fine", (await T(() => A("client.logAdd", { client_id: cl.id, kind: "next", text: "Call the office manager about the denials", next_on: iso(1) }))).ok);

  S("Insurance limits");
  const sl = await T(() => A("payers.saveLimit", { client_id: "no-such-client", payer: "Aetna", tfl_days: 90 }));
  ok("an unknown client is refused", !sl.ok && sl.status === 400, sl);
  ok("a limit for a real client is saved", (await T(() => A("payers.saveLimit", { client_id: cl.id, payer: "Aetna", tfl_days: 90, afl_days: 180 }))).ok);
  const au = await A("audit.list", { action: "payers.limit" });
  ok("and written to the audit trail", au.rows.some((r) => r.client_id === cl.id && /Aetna/.test(r.detail)), au.rows.slice(0, 2));
}

/* ---------------- Part 2: an empty database ---------------- */
{
  const rig = await makeRig({});
  const { as, sha } = rig;
  const A = as((await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") })).token);
  S("Empty database");
  const d = await rig.tryOp(() => A("digest.dashboard", {}));
  ok("the digest page gets an empty state, not an error", d.ok && d.r.empty === true && Array.isArray(d.r.clients), d);
}

/* ---------------- Part 3: Drishti's scorecard ---------------- */
{
  const FEED_KEY = "k".repeat(48);
  const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
  const feed = [P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" })];
  const cell = (value, extra) => ({ value, method: "upload", ...(extra || {}) });
  const month = (id, label, from, to, ar, sub, pp, sla) => ({ id, kind: "month", label, range: { from, to }, numDays: 31, createdAt: to + "T09:00:00.000Z", createdBy: "",
    scopes: { ar: { crit: ar }, submission: { crit: sub || {} }, pp: { crit: pp || {} }, sla: { tasks: sla || [] } }, reports: {} });
  const OCT = month("p-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.18), collectionRate: cell(0.91), denialRate: cell(0.124), daysInAR: cell(28), escalations: cell(0) }, { cleanClaim: cell(0.842), submissionTAT: cell("Met") });
  const SEP = month("p-sep", "September 2026", "2026-09-01", "2026-09-30", { arAging: cell(0.16), collectionRate: cell(0.88) }, { cleanClaim: cell(0.93) });
  const WK = { id: "w-end", kind: "week", label: "Week of 25 Oct 2026", range: { from: "2026-10-25", to: "2026-10-31" }, scopes: { ar: { crit: { arAging: cell(0.1) } } }, reports: {} };
  const WEEK = { id: "p-w44", kind: "week", label: "Week of 26 Oct 2026", range: { from: "2026-10-26", to: "2026-11-01" }, scopes: { ar: { crit: { arAging: cell(0.14) } } }, reports: {} };
  const base = { id: "d-sun", name: "Sunrise Eye Care", ownerName: "Tina Lead", scopes: ["ar", "submission", "pp"], rules: {} };
  let DR = [];
  const fetchMock = async (url, init, real) => {
    if (url.includes("brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("supabase.co")) return new Response(JSON.stringify({ message: "not set up" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (url.includes("script.google.com")) { const body = JSON.parse((init && init.body) || "{}"); return new Response(JSON.stringify(body.a === "overview" ? { ok: true, value: DR } : { ok: false, error: "no" }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    if (url.includes("microsoft")) throw new Error("no Microsoft in tests");
    return real(url, init);
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY, DRISHTI_TOKEN_SECRET: "s".repeat(40) }, fetchMock });
  const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
  const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  await rig.app.seedDemo(() => {});
  const A = as((await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") })).token);
  const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
  const TODAY = { today: "2026-11-04" };
  const setDR = async (list) => { DR = list; await sql("DELETE FROM settings WHERE key = 'drishti_sync'"); };
  const item = (d, key) => d.items.find((x) => x.key === key);

  S("Drishti: one matcher for the Portfolio and the scorecard");
  await setDR([{ ...base, id: "d-A", name: "Sunrise Eye-Care", periods: [OCT] }, { ...base, id: "d-B", name: "Sunrise Eye Care", periods: [month("b-oct", "October 2026", "2026-10-01", "2026-10-31", { arAging: cell(0.05), collectionRate: cell(0.99) })] }]);
  const sm = (await A("sla.summary", TODAY)).rows.find((x) => x.client_id === sun.id), sc = await A("sla.scorecard", { client_id: sun.id, ...TODAY });
  ok("both read the same Drishti client (the exact spelling)", sm.drishti_id === sc.drishti.id && sc.drishti.id === "d-B" && sm.score === sc.score, [sm.drishti_id, sm.score, sc.drishti.id, sc.score]);
  ok("and the scorecard names the clash", sc.ambiguous.length === 2 && sm.ambiguous.length === 2, sc.ambiguous);

  S("Drishti: one null client in the list");
  await setDR([{ ...base, periods: [OCT] }, null, { name: null }, 7]);
  const jn = await T(() => A("sla.scorecard", { client_id: sun.id, ...TODAY }));
  ok("junk entries are skipped, the scorecard still reads", jn.ok && jn.r.state === "ok", jn.ok ? [jn.r.state, jn.r.error] : jn);

  S("Drishti: Latest steps by period, not by end date");
  await setDR([{ ...base, periods: [OCT, SEP, WK] }]);
  const lt = await A("sla.scorecard", { client_id: sun.id, kind: "latest", period_id: "p-oct", ...TODAY });
  ok("October, which ends the same day as a week, can be shown", lt.period.id === "p-oct", lt.period);
  const lt2 = await A("sla.scorecard", { client_id: sun.id, kind: "latest", period_id: "w-end", ...TODAY });
  ok("and the week too", lt2.period.id === "w-end", lt2.period);

  S("Drishti: Monthly asked, only weeks");
  await setDR([{ ...base, periods: [WEEK, WK] }]);
  const wo = await A("sla.scorecard", { client_id: sun.id, kind: "month", ...TODAY });
  ok("the answer says it fell back from monthly, and the period is a week", wo.fallback === "month" && wo.period.kind === "week" && wo.kind === "week", [wo.fallback, wo.kind, wo.period.kind]);
  const wm = await A("sla.scorecard", { client_id: sun.id, kind: "week", ...TODAY });
  ok("Weekly asked: no fallback", !wm.fallback, wm.fallback);

  S("Drishti: odd values");
  const ODD = month("o-oct", "October 2026", "2026-10-01", "2026-10-31",
    { arAging: cell("0.10"), collectionRate: cell("91%"), denialRate: cell(null), daysInAR: cell(""), quality: cell("abc") },
    { submissionTAT: cell("Not met"), cleanClaim: cell(0.95) }, { ppTAT: cell(" met ") });
  await setDR([{ ...base, periods: [ODD] }]);
  const od = await A("sla.scorecard", { client_id: sun.id, ...TODAY });
  ok("'0.10' is read as 0.10 and scored", item(od, "arAging").value === 0.1 && item(od, "arAging").status === "ok", item(od, "arAging"));
  ok("'91%' on a percent KPI is 0.91 and scored", item(od, "collectionRate").value === 0.91 && item(od, "collectionRate").status !== "info", item(od, "collectionRate"));
  const arMissing = od.scopes.find((s) => s.key === "ar").missing.map((m) => m.key);
  ok("a null or empty value is 'not scored yet', not an item", arMissing.includes("denialRate") && arMissing.includes("daysInAR") && !item(od, "denialRate") && !item(od, "daysInAR"), arMissing);
  ok("text that is not a number stays unscored", item(od, "quality").status === "info");
  ok("'Not met' is red and ' met ' is green", item(od, "submissionTAT").status === "miss" && item(od, "ppTAT").status === "ok", [item(od, "submissionTAT").status, item(od, "ppTAT").status]);

  S("Drishti: the month-end SLA follows a re-score");
  await sql("DELETE FROM client_monthend WHERE client_id = ?", sun.id);
  await setDR([{ ...base, periods: [OCT, SEP] }]);
  const s1 = (await A("sla.summary", TODAY)).rows.find((x) => x.client_id === sun.id).score;
  const OCT2 = JSON.parse(JSON.stringify(OCT)); OCT2.scopes.ar.crit.arAging.value = 0.05; OCT2.scopes.submission.crit.cleanClaim.value = 0.99; OCT2.scopes.ar.crit.denialRate.value = 0.01;
  await setDR([{ ...base, periods: [OCT2, SEP] }]);
  const s2 = (await A("sla.summary", TODAY)).rows.find((x) => x.client_id === sun.id).score;
  const co = await A("client.overview", { client_id: sun.id, ...TODAY });
  ok("Client 360 shows the new score", s1 !== s2 && co.sla && co.sla.score === s2, { s1, s2, c360: co.sla });
  await A("monthend.set", { client_id: sun.id, month: "2026-10", step: "sla", done: true, score: 77 });
  await setDR([{ ...base, periods: [OCT, SEP] }]); await A("sla.summary", TODAY);
  const co2 = await A("client.overview", { client_id: sun.id, ...TODAY });
  // G-05 (bug test): one SLA score per client and month. The typed row stays as typed; Client 360 shows Drishti's score for the
  // month (as the scorecard, the Portfolio and the digest do) and its month-end step says what was typed.
  const kept = (await DB.prepare("SELECT score, auto FROM client_monthend WHERE client_id = ? AND month = '2026-10' AND step = 'sla'").bind(sun.id).all()).results;
  const st = co2.monthend.steps.find((x) => x.key === "sla");
  ok("a score typed by a person is kept in the month-end table, and Client 360 shows Drishti's score for the month with the typed one beside it",
    kept.length === 1 && kept[0].score === 77 && kept[0].auto === 0 && co2.sla && co2.sla.score === s1 && st && st.score === s1 && st.typed === 77, { kept, sla: co2.sla, step: st, s1 });

  S("Drishti: a period with nothing scored does not reach the Portfolio as a band");
  await setDR([{ ...base, periods: [month("e", "October 2026", "2026-10-01", "2026-10-31", {})] }]);
  const pe = await A("portfolio.overview", { client_id: sun.id, today: TODAY.today });
  ok("no drishti block with a null score", !pe.rows[0].drishti, pe.rows[0].drishti);
  const ie = await T(() => A("inventory.status", { client_id: sun.id, today: TODAY.today }));
  ok("Inventory status reads", ie.ok && (!ie.r.clients[0].drishti || ie.r.clients[0].drishti.band), ie.ok ? ie.r.clients[0].drishti : ie);
}

/* ---------------- Part 4: the Monday digest and WFM ---------------- */
{
  const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
  const feed = [
    P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
    P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
    P({ emp_id: "M2", name: "Sandesh Manager", position: "Manager", reports_to: "Sasha Vice", email: "sandesh@purview-healthcare.com" }),
    P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
    P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Sandesh Manager", email: "leo@purview-healthcare.com" })];
  const mails = []; let mailDown = false, slow = 0;
  const fetchMock = async (url, init) => {
    if (url.includes("brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } });
    if (url.includes("mail-hook.test")) { if (slow) await new Promise((r) => setTimeout(r, slow)); if (mailDown) return new Response("down", { status: 500 }); mails.push(JSON.parse(init.body)); return new Response("ok"); }
    if (url.includes("brahmastra_wfm")) return new Response("x", { status: 404 });
    return new Response("nope", { status: 500 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40), APP_URL: "https://brahmastra.example.test" }, fetchMock });
  const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
  const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => ((await DB.prepare(q).bind(...a).all()).results || []);
  await rig.app.seedDemo(() => {});
  const A = as((await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") })).token);
  await A("roster.syncShastra");
  const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
  const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await as(null)("auth.login", { email, passHash: await sha("pw-" + email) })).token); };
  const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), TI = await firstIn("Tina Lead", "tina@purview-healthcare.com");
  const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
  const IST = 330 * 60000;
  const mon = (ms) => { const d = new Date(ms + IST); const dow = (d.getUTCDay() + 6) % 7; return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z") - dow * 86400000 - IST; };
  const nextMon = mon(Date.now()) + 7 * 86400000, wkKey = new Date(nextMon + IST).toISOString().slice(0, 10);
  const runJob = async (at, cron = "*/10 3-7 * * MON") => { const real = Date.now; Date.now = () => at; try { const ps = []; await rig.worker.default.scheduled({ cron }, rig.backend.env, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };
  const runBoth = async (at) => { const real = Date.now; Date.now = () => at; try { const ps = []; await Promise.all(["*/10 3-7 * * MON", "*/10 3-7 * * MON"].map((cron) => rig.worker.default.scheduled({ cron }, rig.backend.env, { waitUntil: (p) => ps.push(p) }))); await Promise.all(ps); } finally { Date.now = real; } };

  S("Digest: a failed send is tried again by the next Monday run");
  mails.length = 0; mailDown = true;
  for (let i = 0; i < 6; i++) await runJob(nextMon + 9 * 3600000 + i * 600000);
  const failedRuns = await rows("SELECT client_id, sent, failed FROM digest_runs WHERE week = ?", wkKey);
  ok("with the mail down, every span is recorded as failed", failedRuns.length > 0 && failedRuns.every((r) => r.failed > 0 && !r.sent), failedRuns);
  mailDown = false;
  for (let i = 0; i < 6; i++) await runJob(nextMon + 10 * 3600000 + i * 600000);
  const okRuns = await rows("SELECT client_id, sent, failed FROM digest_runs WHERE week = ?", wkKey);
  const logs = await rows("SELECT user_id, client_id, ok FROM digest_log WHERE week = ?", wkKey);
  ok("once the mail is back, the later runs send them", mails.length > 0 && okRuns.every((r) => r.failed === 0), { mails: mails.length, okRuns });
  ok("everyone has it once (one sent row per person and span)", logs.every((l) => l.ok === 1) && mails.length === logs.length, { mails: mails.length, logs: logs.length });
  const n1 = mails.length; for (let i = 0; i < 3; i++) await runJob(nextMon + 11 * 3600000 + i * 600000);
  ok("and nobody gets it twice from later runs", mails.length === n1, mails.length);

  S("Digest: two runs at once never send it twice");
  await sql("DELETE FROM digest_runs"); await sql("DELETE FROM digest_log"); mails.length = 0; slow = 30;
  await runBoth(nextMon + 9 * 3600000);
  slow = 0;
  const per = new Map(); for (const m of mails) { const k = m.to + "|" + m.subject; per.set(k, (per.get(k) || 0) + 1); }
  ok("each person gets each span's mail once", mails.length > 0 && [...per.values()].every((v) => v === 1), [...per.entries()].filter(([, v]) => v > 1).slice(0, 3));
  await sql("DELETE FROM digest_runs"); await sql("DELETE FROM digest_log"); mails.length = 0;
  await runJob(nextMon + 9 * 3600000, "17 * * * *");
  ok("the hourly job does not send the digest (only the Monday job does)", mails.length === 0, mails.length);

  S("Digest: links to a span or week that is not there");
  const sp = (await SA("digest.spans", {})).spans;
  const bad1 = await TI("digest.dashboard", { span: "span:nobody", week: "garbage" });
  ok("an unknown span and week say so", bad1.notices.length === 2 && /not one you can see/.test(bad1.notices[0]) && /not one of the last 9 Mondays/.test(bad1.notices[1]), bad1.notices);
  const good = await TI("digest.dashboard", { span: bad1.span.key, week: bad1.week.week });
  ok("a good link has no notice", good.notices.length === 0, good.notices);
  const sn = await T(() => SA("digest.sendNow", { span: "span:nobody" }));
  ok("Send now for an unknown span says there is no such digest", !sn.ok && /no such digest/.test(sn.e), sn);
  ok("spans are there to send", sp.length > 0);

  S("WFM: a project matched to two clients is shared, not counted twice");
  await sql("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES ('wfm_projects', ?, ?)", JSON.stringify({ ok: true, at: Date.now(), today, rows: [{ name: "Shared Proj", billable: 10, assigned_fte: 8 }, null, { name: "Solo", billable: "x", assigned_fte: 2 }] }), Date.now());
  await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(["Sunrise Eye Care", "Shared Proj"]), sun.id);
  await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(["Lakeview Dental Group", "shared proj", "Solo"]), lake.id);
  const xs = await A("sla.extras", { client_id: sun.id }), xl = await A("sla.extras", { client_id: lake.id });
  ok("each client gets half", xs.wfm.billable === 5 && xs.wfm.assigned_fte === 4 && xl.wfm.billable === 5 && xl.wfm.assigned_fte === 6, [xs.wfm, xl.wfm]);
  ok("and the share is named", xs.wfm.shared.length === 1 && xs.wfm.shared[0].clients === 2, xs.wfm.shared);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
