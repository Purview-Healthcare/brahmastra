/* suite40: regression checks for the bug-test fixes in the reports: the Client 360 report (Dashboard › Client 360 report), Client 360,
   its call log, and the production Brahmastra hands Sasha's Third Eye. One section per finding (F-01 ... F-18, A-12, A-14).
   The server's clock is fixed at Tue 10 Nov 2026 14:00 IST; the report pages are the page's own engine (the built app.js).
   Made-up data only ("Test Patient N", made-up claim numbers). */
import vm from "vm";
import fs from "fs";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2025-01-01", exit_date: null, email: "", ...o });
const feed = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: "mona@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Tara Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "tara@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
];
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("supabase.co")) return new Response(JSON.stringify({ code: "PGRST202", message: "not set up" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => ((await DB.prepare(q).bind(...a).all()).results || []);
const NOW = Date.parse("2026-11-10T08:30:00Z"), realNow = Date.now; Date.now = () => NOW;   // Tue 10 Nov 2026, 14:00 IST
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), TA = await firstIn("Tara Lead", "tara@purview-healthcare.com");
const sunrise = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
const me = (await rows("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'"))[0];
// ---- made-up data ----
const X = (expr) => vm.runInContext(expr, app);
const ist = (d, hm = "11:00") => Date.parse(d + "T" + hm + ":00+05:30");
let seq = 0;
const mkClient = async (id, name) => { await sql("INSERT INTO clients (id, name, created_at) VALUES (?,?,?)", id, name, Date.parse("2026-01-01T00:00:00Z")); return id; };
const claim = async (cid, o = {}) => { const id = o.id || "c40-" + (++seq); seq++;
  await sql(`INSERT INTO claims (id, client_id, match_key, claim_no, patient, payer, dos, balance, billed, state, created_at, updated_at, age_days, last_status_code, last_action_code, file_action, raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, cid, "mk-" + id, o.no || "CLM-" + id, "Test Patient " + seq, o.payer || "Aetna", o.dos == null ? "" : o.dos, o.bal ?? 100, o.billed ?? null,
    o.state || "open", Date.parse("2026-07-01T00:00:00Z"), NOW, o.age ?? null, o.st || "", o.act || "", o.fact || "", o.raw ? JSON.stringify(o.raw) : "{}"); return id; };
const note = (claimId, at, st, sub, act, mv) => sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, bucket, created_at) VALUES (?,?,?,?, 'work', ?,?,?,?,?)",
  "n40-" + (++seq), claimId, me.id, "Test Biller", st, sub || "", act || "", mv || "", at);
const ho = (cid, claimId, dept, status, created, done, proof, o = {}) => sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, due_at, done_at, done_by, done_by_name, proof_json, reason, saag_action, paused_at, client_sent_at, client_answered_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.id || "h40-" + (++seq), claimId, cid, dept, status, created, me.id, "Test Lead", created + 86400000, done, done ? me.id : null, done ? "Test Poster" : "",
  JSON.stringify(proof || {}), o.reason || "", o.saag || "", o.paused ?? null, o.sent ?? null, o.answered ?? null);
// ---- the report as the page builds it ----
const period = (ym) => { const [y, m] = ym.split("-").map(Number); const range = { start: new Date(y, m - 1, 1), end: new Date(y, m, 0), kind: "month" }, prev = app.crShift(range);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return { range, payload: { from: iso(range.start), to: iso(range.end), prev_from: iso(prev.start), prev_to: iso(prev.end), period_key: X("crPeriodKey")(range) } }; };
const report = async (cid, ym, who = A) => { const per = period(ym); const raw = await who("creport.get", { client_id: cid, ...per.payload });
  const DS = app.crDatasets(raw), R = { range: per.range, compare: true, client: "Test Clinic", periodName: X("CRM_L")[per.range.start.getMonth()], cardMeasure: {} };
  const page = (pid, sel = {}) => { const c = app.crCtx(DS, R, pid, sel); return pid === "exec" ? app.crBuildExec(c, raw) : app[{ inventory: "crBuildInventory", inventory2: "crBuildInventory2", ar: "crBuildAR", denials: "crBuildDenials", rca: "crBuildRCA",
    submission: "crBuildSubmission", rejection: "crBuildRejection", payment: "crBuildPayment", ca: "crBuildCA", ev: "crBuildEV" }[pid]](c); };
  return { raw, DS, R, page, has: (pid) => app.crHasPage(DS, pid) }; };
const kpi = (m, label) => (m.kpis.find((k) => k.label === label) || {});
const words = (m) => [m.headline, m.sub, ...(m.insights || []), ...(m.kpis || []).map((k) => k.label + " " + k.value + " " + (k.sub || "")), ...(m.cards || []).map((c) => c.callout || ""), ...((m.exec && m.exec.focus) || [])].join(" | ");

S("F-01: the report's Over 90 days is the Dashboard's (Future DOS and a claim with no age are owed, never older)");
{ const cid = await mkClient("c40-f01", "Test Clinic F01");
  await claim(cid, { dos: "2026-08-02", bal: 100 });               // 100 days: over 90
  await claim(cid, { dos: "2026-12-01", bal: 900 });               // a DOS typed in the future
  await claim(cid, { dos: "2026-10-31", bal: 400 });               // 10 days
  await claim(cid, { dos: "", age: null, bal: 300 });              // no DOS and no age
  const r = await report(cid, "2026-11"), inv = r.page("inventory"), ex = r.page("exec");
  const dash = (await A("portfolio.overview", { client_id: cid, today: "2026-11-10" })).rows[0].over90_pct, c360 = (await A("client.overview", { client_id: cid, today: "2026-11-10" })).ar.over90_pct;
  ok("F-01: Over 90 days 5.9% ($100 of the $1,700 owed) on the Inventory page and the summary, as the Dashboard and Client 360", kpi(inv, "Over 90 days").value === "5.9%" && kpi(ex, "Over 90 days").value === "5.9%" && dash === 5.9 && c360 === 5.9,
    { inv: kpi(inv, "Over 90 days").value, ex: kpi(ex, "Over 90 days").value, dash, c360 });
  ok("F-01: a claim with no age is not older than 120 or 360 days", !/older than 120 days/.test(words(inv)) && !/over 360 days/.test(words(ex)), words(inv) + " || " + ex.exec.focus);
  const bars = inv.cards.find((c) => /^inv\.bucket\./.test(c.id)), now = (x) => (x.cur != null ? x.cur : x.value);
  ok("F-01: the aging chart keeps the claim with no age as Unknown age, so its bars add up to the open AR ($1,700)", bars && bars.items.some((x) => x.label === "Unknown age" && now(x) === 300) && Math.round(bars.items.reduce((t, x) => t + now(x), 0)) === 1700,
    bars && bars.items.map((x) => [x.label, now(x)]));
  ok("F-01: the heaviest age group is a share of the money owed with a known age (Future DOS $900, 53%)", inv.insights.some((x) => /^Future DOS is the heaviest open bucket at \$900, 53% of the open balance/.test(x)), inv.insights);
}
{ const cid = await mkClient("c40-f01b", "Test Clinic F01b");
  await claim(cid, { dos: "2025-09-01", bal: 700 });               // over 360 days
  await claim(cid, { dos: "2025-08-01", bal: -200, payer: "BCBS" });   // a credit, over 360 days
  await claim(cid, { dos: "", age: null, bal: 300 });
  const ex = (await report(cid, "2026-11")).page("exec");
  ok("F-01: the summary's over-360 focus counts the money owed with a known age only: 1 claim, $700", ex.exec.focus.some((x) => x === "Clear 1 claim over 360 days ($700) before filing limits close."), ex.exec.focus);
}

S("F-02: the AR production charts count claims, as its KPIs do");
{ const cid = await mkClient("c40-f02", "Test Clinic F02");
  const a = await claim(cid, { dos: "2026-09-01", bal: 400, billed: 1000, payer: "Medicare", state: "assigned" }), b = await claim(cid, { dos: "2026-09-02", bal: 300, billed: 500, payer: "Aetna", state: "assigned" });
  await note(a, ist("2026-10-05"), "Claim Denied", "CO-16 Missing information", "Corrected claim sent", "Payer");
  await note(a, ist("2026-10-20"), "Claim Denied", "CO-16 Missing information", "Appeal filed", "Payer");
  await note(b, ist("2026-10-06"), "Claim Paid", "Paid in full", "Close", "Closed");
  const ar = (await report(cid, "2026-10")).page("ar"), card = (f) => ar.cards.find((c) => c.id === "ar.worked." + f), sum = (c, k) => c.items.reduce((t, x) => t + x[k], 0);
  ok("F-02: KPIs 2 claims worth $1,500", kpi(ar, "Claims worked").value === "2" && kpi(ar, "Amount worked").value === "$1,500", ar.kpis.map((k) => k.value));
  ok("F-02: Aging wise production counts 2 claims; Status wise breakdown, Action required and Insurance wise add up to $1,500 (denied $1,000)",
    sum(card("bucket"), "count") === 2 && sum(card("purviewStatus"), "amount") === 1500 && card("purviewStatus").items.find((x) => /denied/i.test(x.label)).amount === 1000 && sum(card("action"), "amount") === 1500 && sum(card("payerKey"), "amount") === 1500,
    ["bucket", "purviewStatus", "action", "payerKey"].map((f) => [f, sum(card(f), "count"), sum(card(f), "amount")]));
}
{ const cid = await mkClient("c40-f02r", "Test Clinic F02r");   // no Rejections desk: the rejections are read from the AR entries
  const a = await claim(cid, { dos: "2026-09-01", bal: 200, billed: 200, state: "assigned" });
  await note(a, ist("2026-10-05"), "Claim Rejected", "Invalid member ID", "Corrected and resubmitted", "Payer"); await note(a, ist("2026-10-12"), "Claim Rejected", "Invalid member ID", "Corrected and resubmitted", "Payer");
  const rej = (await report(cid, "2026-10")).page("rejection");
  ok("F-02 (same mistake): a claim rejected twice in the AR entries is one rejected claim", kpi(rej, "Rejected claims").value === "1", rej.kpis.map((k) => k.value));
}

S("F-03: a page with nothing in the period is greyed out and stays out of the PDF");
{ const cid = await mkClient("c40-f03", "Test Clinic F03");
  const s = await claim(cid, { dos: "2026-10-01", bal: 250, billed: 250, state: "in_process" });
  await ho(cid, s, "submission", "complete", ist("2026-10-02", "09:00"), ist("2026-10-02", "14:00"), { date: "2026-10-02", ref: "B1", mode: "Electronic" });
  await A("creport.evUpload", { client_id: cid, file_name: "EV Oct.xlsx", rows: [{ wd: "2026-10-05", py: "Aetna", st: "Active coverage", by: "Test EV" }] });
  const nov = await report(cid, "2026-11"), oct = await report(cid, "2026-10");
  ok("F-03: November (only October's rows, fetched for the comparison) has no EV or Submission page", !nov.has("ev") && !nov.has("submission"), { ev: nov.has("ev"), sub: nov.has("submission") });
  ok("F-03: October, the month with the rows, has both", oct.has("ev") && oct.has("submission"));
}

S("F-04: the Inventory breakdown's shares are of the money owed (credit balances left out)");
{ const cid = await mkClient("c40-f04", "Test Clinic F04");
  await claim(cid, { dos: "2026-10-10", bal: 1000, payer: "Medicare" }); await claim(cid, { dos: "2026-10-01", bal: 500, payer: "BCBS" }); await claim(cid, { dos: "2026-09-10", bal: -900, payer: "Aetna" });
  const m = (await report(cid, "2026-11")).page("inventory2"), payer = m.cards.find((c) => c.id === "inv2.payer");
  ok("F-04: Largest payer 67% (Medicare); the two payers hold 100% of the money owed (not 167%)", kpi(m, "Largest payer").value === "67%" && kpi(m, "Largest payer").sub === "Medicare" && kpi(m, "Payers").sub === "2 hold 100% of the money owed", m.kpis);
  ok("F-04: no payer share is over 100% or below 0 (no Aetna -150% bar)", payer.items.every((x) => x.share >= 0 && x.share <= 1) && !payer.items.some((x) => x.label === "Aetna"), payer.items.map((x) => [x.label, x.share]));
  ok("F-04: the page says the shares are of the $1,500 owed and the $900 of credits is left out", m.insights.includes("Payer, status and action shares are of the $1,500 owed; credit balances ($900) are left out."), m.insights);
  ok("F-04: the headline says it too", m.headline === "Medicare holds 67% of the money owed", m.headline);
}

S("F-05: Client 360's denial reasons count a claim's balance once");
{ const cid = await mkClient("c40-f05", "Test Clinic F05");
  const c = await claim(cid, { dos: "2026-09-01", bal: 400, billed: 1000, state: "assigned" }), d = await claim(cid, { dos: "2026-09-02", bal: 70, state: "assigned" });
  await note(c, ist("2026-10-05"), "Claim Denied", "CO-16 Missing information", "Corrected claim sent", "Payer"); await note(c, ist("2026-10-20"), "Claim Denied", "CO-16 Missing information", "Appeal filed", "Payer");
  await note(d, ist("2026-10-07"), "Claim Denied", "CO-16 Missing information", "Appeal filed", "Payer");
  const co = await A("client.overview", { client_id: cid, from_ms: ist("2026-10-01", "00:00"), to_ms: ist("2026-10-31", "23:59"), today: "2026-11-10" });
  const r = co.reasons_top.find((x) => /CO-16/.test(x.reason));
  ok("F-05: CO-16 Missing information: 2 claims, $470 (each balance once, though one claim was denied twice)", r && r.n === 2 && r.bal === 470, co.reasons_top);
}

S("F-06: a request asked before the period before and answered in the period is in the period's Client assistance");
{ const cid = await mkClient("c40-f06", "Test Clinic F06");
  const c = await claim(cid, { dos: "2026-07-20", bal: 60, state: "in_process" });
  await ho(cid, c, "submission", "pending", ist("2026-08-15", "09:00"), null, {}, { reason: "Missing documents", paused: ist("2026-08-15", "10:00"), sent: ist("2026-08-15", "11:00"), answered: ist("2026-10-10", "10:00") });
  const sep = (await report(cid, "2026-09")).page("ca"), oct = await report(cid, "2026-10"), dec = await report(cid, "2026-12");
  ok("F-06: September (still waiting) and October (answered in it) both show 1 claim needing the client", kpi(sep, "Claims needing the client").value === "1" && oct.has("ca") && kpi(oct.page("ca"), "Claims needing the client").value === "1",
    { sep: kpi(sep, "Claims needing the client").value, oct: oct.has("ca") });
  const oca = oct.has("ca") ? oct.page("ca") : null;
  ok("F-06: in October it is answered, and the comparison counts September's 1", oca && oca.claims.rows[0].action === "answered" && kpi(oca, "Claims needing the client").delta.prev === 1, oca && oca.kpis[0]);
  ok("F-06: December (answered in October) has no Client assistance page", !dec.has("ca"));
}

S("F-08: the rejection rate is of this period's submissions, never of the AR claims worked when the client has submissions");
{ const cid = await mkClient("c40-f08", "Test Clinic F08");
  const s = await claim(cid, { dos: "2026-09-01", bal: 250, billed: 250, state: "in_process" });
  await ho(cid, s, "submission", "complete", ist("2026-09-20", "09:00"), ist("2026-09-20", "14:00"), { date: "2026-09-20", ref: "B1", mode: "Electronic" });
  for (const d of ["2026-10-05", "2026-10-06"]) { const r = await claim(cid, { dos: "2026-09-01", bal: 100, billed: 100, state: "in_process" }); await ho(cid, r, "rejection", "pending", ist(d, "09:00"), null, {}); }
  for (let i = 0; i < 4; i++) { const w = await claim(cid, { dos: "2026-09-15", bal: 50, state: "assigned" }); await note(w, ist("2026-10-1" + i), "Claim In Process", "Need to allow some time", "Follow up", "Payer"); }
  const m = (await report(cid, "2026-10")).page("rejection"), k = kpi(m, "Rejection rate");
  ok("F-08: no submission in October: no rate, and it says why", k.value === "–" && k.sub === "no submissions this period (these were submitted earlier)", k);
  ok("F-08: the headline has no rate ('2 claims rejected')", m.headline === "2 claims rejected", m.headline);
}
{ const cid = await mkClient("c40-f08b", "Test Clinic F08b");   // no Submission records at all: the rate is of the claims worked, and says so
  for (const d of ["2026-10-05"]) { const r = await claim(cid, { dos: "2026-09-01", bal: 100, billed: 100, state: "in_process" }); await ho(cid, r, "rejection", "pending", ist(d, "09:00"), null, {}); }
  for (let i = 0; i < 4; i++) { const w = await claim(cid, { dos: "2026-09-15", bal: 50, state: "assigned" }); await note(w, ist("2026-10-1" + i), "Claim In Process", "Need to allow some time", "Follow up", "Payer"); }
  const m = (await report(cid, "2026-10")).page("rejection");
  ok("F-08: with no Submission records, 25.0% of the claims worked, worded so", kpi(m, "Rejection rate").value === "25.0%" && m.headline === "1 claim rejected, 25.0% of the claims worked", [kpi(m, "Rejection rate"), m.headline]);
}

S("F-09: the report's wording (no '(blank)', '1 claims', 'Top 1'; the claim change has its direction)");
{ const cid = await mkClient("c40-f09", "Test Clinic F09");
  await claim(cid, { dos: "2026-10-20", bal: 1500, payer: "Medicare" }); await claim(cid, { dos: "2026-10-25", bal: 500, payer: "Aetna" });
  await sql("INSERT INTO inv_snapshots (client_id, day, cells_json, at) VALUES (?,?,?,?)", cid, "2026-10-31", JSON.stringify([{ loc: "", bk: "0-30", py: "Aetna", st: "", pms: "", act: "", n: 7, amt: 600 }]), NOW);
  const w = await claim(cid, { dos: "2026-10-01", bal: 300, billed: 300, payer: "Cigna", state: "in_process" }); await note(w, ist("2026-11-03"), "Claim Denied", "CO-22 COB", "Appeal filed", "Payer");
  const r = await report(cid, "2026-11"), all = ["inventory", "inventory2", "ar", "denials", "rca", "exec"].map((p) => words(r.page(p))).join(" | ");
  ok("F-09: no '(blank)' action, no '1 claims', no 'Top 1', no 'all 1 denial reason'", !/\(blank\)|\b1 claims\b|Top 1\b|top 1 reasons|all 1 denial/.test(all), (all.match(/.{40}(\(blank\)|\b1 claims\b|Top 1\b|top 1 reasons|all 1 denial).{20}/g) || []).join(" ## "));
  ok("F-09: the reduction KPI says the claims went down: '$1,400 added · 5 fewer claims'", kpi(r.page("inventory"), "Change").sub === "$1,400 added · 5 fewer claims", kpi(r.page("inventory"), "Change"));
  ok("F-09: one denial reason: 'Top denial', 'The top reason covers', 'the one denial reason'", /Top denial<\/b>/.test(r.page("denials").cards[0].callout) && r.page("denials").insights.some((x) => /^The top reason covers 100%/.test(x)) && /the one denial reason/.test(r.page("rca").insights[0]),
    [r.page("denials").cards[0].callout, r.page("rca").insights[0]]);
}

S("F-10: a save made on a copy someone else has changed since is refused, never a silent overwrite");
{ const G = { client_id: sunrise.id, from: "2026-10-01", to: "2026-10-31", prev_from: "2026-09-01", prev_to: "2026-09-30", period_key: "month:2026-10" }, Pp = { client_id: sunrise.id, period_key: "month:2026-10", page_id: "ar" };
  const tara0 = ((await TA("creport.get", G)).edits.ar) || {};                                   // Tara has the report open
  const s1 = await TI("creport.save", { ...Pp, data: { title: "October: fewer denials after the COB clean-up" }, base_at: null });
  ok("F-10: Tina's first save on a page with no words yet is kept", s1.ok && s1.at > 0, s1);
  let r = await T(() => TA("creport.save", { ...Pp, data: { insights: { edits: {}, removed: [], added: [{ id: "u1", text: "Two appeals won in week 3" }] } }, base_at: tara0._at || null }));
  ok("F-10: Tara's save on her older copy is refused (409) with a plain message naming Tina", !r.ok && r.status === 409 && /Tina Lead changed this page at \d\d:\d\d IST after you opened it, so your change was not saved/.test(r.e || ""), r);
  let now = (await TI("creport.get", G)).edits.ar;
  ok("F-10: Tina's title is still there", now.title === "October: fewer denials after the COB clean-up", now);
  r = await T(() => TA("creport.save", { ...Pp, data: { insights: { added: [] } } }));
  ok("F-10: a save that does not say which copy it was made on is refused too", !r.ok && r.status === 409, r);
  const fresh = (await TA("creport.get", G)).edits.ar;                                               // Tara reloads and makes her change again
  const s2 = await TA("creport.save", { ...Pp, data: { title: fresh.title, insights: { edits: {}, removed: [], added: [{ id: "u1", text: "Two appeals won in week 3" }] } }, base_at: fresh._at });
  now = (await TI("creport.get", G)).edits.ar;
  ok("F-10: on the fresh copy her save goes through, and both changes are kept", s2.ok && now.title === "October: fewer denials after the COB clean-up" && now.insights.added.length === 1 && now._by === "Tara Lead", now);
  const s3 = await TA("creport.save", { ...Pp, data: { ...now, title: "October in one page" }, base_at: s2.at });
  ok("F-10: her next save carries the version the last one returned", s3.ok && s3.at > s2.at, s3);
  ok("F-10: the page sends base_at and reloads on a refusal (the built page)", /base_at:\s*\w+/.test(fs.readFileSync(new URL("../../app/app.js", import.meta.url), "utf8")) && /status\s*===\s*409/.test(fs.readFileSync(new URL("../../app/app.js", import.meta.url), "utf8")));
}

S("F-11: removing a call log entry, and un-ticking a month-end step, are in the audit trail");
{ await TI("client.logAdd", { client_id: sunrise.id, kind: "call", text: "Client agreed to send the missing EOBs by Friday" });
  const entry = (await TI("client.overview", { client_id: sunrise.id })).log.find((l) => /missing EOBs/.test(l.text));
  await TA("client.logDelete", { id: entry.id });
  const a = (await A("audit.list", { client_id: sunrise.id })).rows.find((x) => x.action === "client.logRemove");
  ok("F-11: a 'client.logRemove' row: who removed it, and what it said", a && a.user_name === "Tara Lead" && /^call by Tina Lead on 2026-11-10: Client agreed to send the missing EOBs/.test(a.detail), a);
  ok("F-11: the audit trail and the client's history name it", /"client\.logRemove": "Removed a client call log entry"/.test(fs.readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8")));
  const month = (await TI("client.overview", { client_id: sunrise.id })).monthend.month;
  await TI("monthend.set", { client_id: sunrise.id, month, step: "internal", done: true }); await TI("monthend.set", { client_id: sunrise.id, month, step: "internal", done: false });
  ok("F-11 (same gap): un-ticking a month-end step is audited", (await A("audit.list", { client_id: sunrise.id })).rows.some((x) => x.action === "monthend.internal" && /marked not done/.test(x.detail)));
}

S("F-12: a call log entry over 2,000 characters is refused with a message, never cut");
{ let text = ""; for (let i = 1; text.length < 2400; i++) text += `Point ${i}: the client agreed to send the EOBs for batch ${i} before the next call. `; text += "FINAL DECISION: write off the small balances.";
  const r = await T(() => TI("client.logAdd", { client_id: sunrise.id, kind: "meeting", text }));
  ok("F-12: refused with the length and the limit", !r.ok && r.status === 400 && new RegExp("This entry is " + text.length.toLocaleString("en-US") + " characters; the call log keeps up to 2,000").test(r.e || ""), r);
  const two = "x".repeat(1990) + " end here", r2 = await TI("client.logAdd", { client_id: sunrise.id, kind: "note", text: two });
  const kept = (await TI("client.overview", { client_id: sunrise.id })).log.find((l) => l.id === r2.id);
  ok("F-12: an entry of 1,999 characters is kept whole", kept && kept.text === two, kept && kept.text.length);
}

S("F-13: the Executive summary is the whole client, with a filter set or not");
{ const cid = await mkClient("c40-f13", "Test Clinic F13");
  for (const [d, py] of [["2026-09-10", "Medicare"], ["2026-09-11", "Aetna"], ["2026-10-05", "Medicare"], ["2026-10-06", "Aetna"], ["2026-10-07", "Aetna"]]) {
    const c = await claim(cid, { dos: "2026-08-01", bal: 100, billed: 100, payer: py, state: "assigned" }); await note(c, ist(d), "Claim In Process", "Need to allow some time", "Follow up", "Payer"); }
  const r = await report(cid, "2026-10"), plain = r.page("exec"), filtered = r.page("exec", { payerKey: new Set(["medicare"]) });
  const view = (m) => m.kpis.map((k) => [k.label, k.value, k.delta ? k.delta.prev : null]);
  ok("F-13: with the Medicare filter the summary's figures and its comparison are the whole client's", JSON.stringify(view(plain)) === JSON.stringify(view(filtered)), { plain: view(plain), filtered: view(filtered) });
  ok("F-13: the summary slide never carries the filter label", /filterText=\{pid === "exec" \? "" : filterText\(s\)\}/.test(fs.readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8")));
}

S("F-14: the start screen and the dashboard never share a page node (the Dates step comes back)");
{ const src = fs.readFileSync(new URL("../../app/app.js", import.meta.url), "utf8");
  ok("F-14: the start screen and the dashboard are keyed apart", /key:\s*"setup",\s*className:\s*"stack crx crx-setup"/.test(src) && /key:\s*"dash",\s*className:\s*"stack crx"/.test(src));
}

S("F-15: Third Eye gets the posting amounts and the Submission fields Brahmastra records");
{ const cid = await mkClient("c40-f15", "Test Clinic F15");
  const c = await claim(cid, { dos: "2026-10-01", bal: 200, billed: 200, state: "in_process" });
  await ho(cid, c, "posting", "assigned", ist("2026-11-09", "09:00"), null, {}, { id: "h40-f15p" });
  await A("handoffs.close", { id: "h40-f15p", outcome: "complete", proof: { date: "2026-11-10", ref: "EFT-77", check_date: "2026-11-08", allowed: "150", paid: "100", deductible: "20", coinsurance: "10", adjustment: "20", adj_reason: "Contractual", writeoff: "5" } });
  const s = await claim(cid, { dos: "2026-10-02", bal: 300, billed: 300, state: "in_process", raw: { Type: "Primary" } });
  await ho(cid, s, "submission", "assigned", ist("2026-11-09", "09:00"), null, {}, { id: "h40-f15s", saag: "Need to Resubmit" });
  await A("handoffs.close", { id: "h40-f15s", outcome: "complete", proof: { date: "2026-11-10", ref: "B-55", mode: "Electronic", type: "Regular", claim_type: "Corrected claim", inv_status: "Submitted", bucket: "Payer" } });
  const s2 = await claim(cid, { dos: "2026-10-03", bal: 90, billed: 90, state: "in_process", raw: { Type: "Secondary" } });
  await ho(cid, s2, "submission", "assigned", ist("2026-11-09", "09:00"), null, {}, { id: "h40-f15s2", saag: "Need to Resubmit" });
  await A("handoffs.close", { id: "h40-f15s2", outcome: "complete", proof: { date: "2026-11-10", ref: "B-56", mode: "Paper" } });
  const rng = { client_id: cid, from_ms: ist("2026-11-01", "00:00"), to_ms: ist("2026-11-30", "23:59") };
  const pp = await A("reports.production", { scope: "pp", ...rng }), sub = await A("reports.production", { scope: "sub", ...rng });
  const v = (r, h) => r.rows[0][r.header.indexOf(h)];
  ok("F-15: posting rows carry the check date, allowed, paid, adjustment and its reason, deductible, co-insurance, co-pay, patient responsibility and write-off",
    v(pp, "Check Date") === "2026-11-08" && v(pp, "Allowed Amount") === 150 && v(pp, "Paid Amount") === 100 && v(pp, "Posted") === 100 && v(pp, "Other Adjustment") === 20 && v(pp, "Adjustment Reason") === "Contractual"
    && v(pp, "Deductible") === 20 && v(pp, "Co-insurance") === 10 && v(pp, "Co-pay") === "" && v(pp, "Patient Responsibility") === 30 && v(pp, "Write-off") === 5, pp.header.map((h, i) => h + "=" + pp.rows[0][i]));
  ok("F-15: under the names Third Eye's Posting Details reads (allowed amount, patient responsibility, other adjustment, check date)", ["Allowed Amount", "Patient Responsibility", "Other Adjustment", "Check Date", "Paid Amount", "Posted"].every((h) => pp.header.includes(h)));
  ok("F-15: no contractual column is sent (shelved by the owner)", !pp.header.some((h) => /contractual/i.test(h)), pp.header);
  const sr = (no) => sub.rows.find((x) => x[sub.header.indexOf("Claim No")] === no), sv = (row, h) => row[sub.header.indexOf(h)];
  ok("F-15: Submission rows carry Type and Claim Type as entered", sv(sr("CLM-" + s), "Type") === "Regular" && sv(sr("CLM-" + s), "Claim Type") === "Corrected claim" && sv(sr("CLM-" + s), "Submission Type") === "Electronic", sub.rows);
  ok("F-15: left empty, Type is the inventory file's and Claim Type the one the AR biller's action says (the Submission file's rule)", sv(sr("CLM-" + s2), "Type") === "Secondary" && sv(sr("CLM-" + s2), "Claim Type") === "Resubmission", sr("CLM-" + s2));
}

S("F-18 and A-14: Client 360's Over 90 days tile and its trend are the same money (credits left out)");
{ const cid = await mkClient("c40-f18", "Test Clinic F18");
  await claim(cid, { dos: "2026-10-31", bal: 1000 }); await claim(cid, { dos: "2026-07-01", bal: 1000 }); await claim(cid, { dos: "2026-06-01", bal: -500 });
  await sql("DELETE FROM settings WHERE key = 'snap_at'");                                            // take today's reading now
  const co = await A("client.overview", { client_id: cid, today: "2026-11-10" }), last = co.trend[co.trend.length - 1];
  ok("F-18: the tile's dollars are the over-90 money owed: 50% and $1,000", co.ar.over90_pct === 50 && co.ar.over90 === 1000 && co.ar.over90_owed === 1000, co.ar);
  ok("A-14: today's point on the trend is 50% too ($1,000 of the $2,000 owed)", last && last.month === "2026-11" && last.pct === 50 && last.over90 === 1000, co.trend);
  const sn = (await rows("SELECT ar_balance, ar_owed, over90_owed FROM client_snapshots WHERE client_id = ? AND day = '2026-11-10'", cid))[0];
  ok("A-14: the day's reading keeps the money owed and its over-90 part (and the AR balance, net, as before)", sn && sn.ar_owed === 2000 && sn.over90_owed === 1000 && sn.ar_balance === 1500, sn);
  ok("F-18 (same mistake): Over 120 days is of the money owed too ($1,000, not $500)", co.ar.over120 === 1000, co.ar.over120);
  await sql("INSERT INTO client_snapshots (client_id, day, ar_balance, ar_claims, over90_balance, over90_claims, over120_balance, at) VALUES (?,?,?,?,?,?,?,?)", cid, "2026-10-31", 1500, 3, 500, 2, 500, NOW);
  const co2 = await A("client.overview", { client_id: cid, today: "2026-11-10" }), octP = co2.trend.find((t) => t.month === "2026-10");
  ok("A-14: a reading kept before the money owed was kept still shows (net figures, as it was)", octP && octP.pct === 33.3, co2.trend);
}

S("A-12: a table's Total row is the sum of the rows it shows");
{ const items = [["Aetna", 12345.6], ["Cigna", 8901.7], ["UHC", 3210.8]].map(([k, v]) => ({ key: k.toLowerCase(), label: k, value: v, count: 1 }));
  const html = app.crItemTable({ items, measureLabel: "Amount", fmtV: X("crF").money, dimLabel: "Payer", dim: "payerKey" });
  const cells = [...html.matchAll(/<tr[^>]*><td>([^<]*)<\/td><td class="n">([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]), num = (s) => Number(String(s).replace(/[$,]/g, ""));
  const shown = cells.filter(([l]) => l !== "Total"), total = cells.find(([l]) => l === "Total");
  ok("A-12: rows $12,345.60, $8,901.70, $3,210.80 and Total $24,458.10", shown.map(([, v]) => v).join(" ") === "$12,345.60 $8,901.70 $3,210.80" && total[1] === "$24,458.10", cells);
  ok("A-12: the Total equals the rows as shown", Math.abs(shown.reduce((t, [, v]) => t + num(v), 0) - num(total[1])) < 0.005);
  const cnt = app.crItemTable({ items: items.map((x) => ({ ...x, value: 2 })), measureLabel: "Claims", fmtV: X("crF").int, dimLabel: "Payer", dim: "payerKey" });
  ok("A-12: a claims table is unchanged (whole numbers, Total 6)", /<td>Total<\/td><td class="n">6<\/td>/.test(cnt), cnt.slice(-200));
}

S("N-14: the 'Claims behind this view' total is the sum of the rows as they are shown");
{ const tot = X("crShownTotal"), rowsOf = (a) => a.map((v) => ({ amount: v }));
  ok("N-14: three claims of $100.40 shown as $100 each total $300 (it said $301)", tot(rowsOf([100.4, 100.4, 100.4])) === 300, tot(rowsOf([100.4, 100.4, 100.4])));
  ok("N-14: $12,345.60 + $8,901.70 + $3,210.80 shown as $12,346 + $8,902 + $3,211 total $24,459", tot(rowsOf([12345.6, 8901.7, 3210.8])) === 24459, tot(rowsOf([12345.6, 8901.7, 3210.8])));
  ok("N-14: a credit counts as shown (-$100 and $51: -$49)", tot(rowsOf([-100.4, 50.6])) === -49, tot(rowsOf([-100.4, 50.6])));
  ok("N-14: the drawer's total uses it", /crShownTotal\(rows\)/.test(fs.readFileSync(new URL("../../app/app.js", import.meta.url), "utf8")));
}

S("N-21 (the same slip as Third Eye's): an amount that rounds to zero carries no sign on the report");
{ const f = X("crF"), hair = 0.3 - 0.1 - 0.2;                        // -0.0000000000000000277 in floating point
  ok("N-21: a hair below zero is $0.00 and $0 (never -$0.00 / -$0)", f.money(hair) === "$0.00" && f.money(hair, 0) === "$0" && f.moneyK(hair) === "$0", [f.money(hair), f.money(hair, 0), f.moneyK(hair)]);
  ok("N-21: a change of a hair above zero has no plus sign", f.signed(1e-17, f.money) === "$0.00" && f.signed(5, (v) => f.money(v, 0)) === "+$5", [f.signed(1e-17, f.money), f.signed(5, (v) => f.money(v, 0))]);
  ok("N-21: a real credit keeps its minus ($12.50, $0.01, $1,500)", f.money(-12.5) === "-$12.50" && f.money(-0.005, 2) === "-$0.01" && f.moneyK(-1500) === "-$1,500", [f.money(-12.5), f.money(-0.005, 2), f.moneyK(-1500)]);
}

Date.now = realNow;
const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
