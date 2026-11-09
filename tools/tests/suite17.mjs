// Client 360 › Client report: Sasha's Third Eye's client report pages from Brahmastra's own data.
// Server: the records a report period needs (inventory now and at the end of the period before, live / kept snapshot /
// rebuilt from the claims' history), AR work, Payment posting, Submission, Rejections, requests waiting on the client, the
// six-month trend, the asks; the team's edits; the client's logo; who may open and change it.
// Page engine (the app's own code): the same rules as Third Eye: reduction, Pareto 80%, top denials set, rates, movers.
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
];
const fetchMock = async (url, init, real) => {
  if (url.includes("supabase.co/rest/v1/rpc/brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("supabase.co")) return new Response(JSON.stringify({ code: "PGRST202", message: "not set up" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (url.includes("login.microsoftonline.com") || url.includes("graph.microsoft.com")) throw new Error("no Microsoft in tests");
  return real(url, init);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => ((await DB.prepare(q).bind(...a).all()).results || []);
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const clients = (await A("clients.list")).clients; const sunrise = clients.find((c) => /Sunrise/.test(c.name)), lake = clients.find((c) => /Lakeview/.test(c.name));
const OCT = { client_id: sunrise.id, from: "2026-10-01", to: "2026-10-31", prev_from: "2026-09-01", prev_to: "2026-09-30", period_key: "month:2026-10" };
const ist = (d, h) => Date.parse(d + "T" + String(h).padStart(2, "0") + ":00:00+05:30");
const claims = (await A("claims.list", { client_id: sunrise.id, state: "", page_size: 300 })).rows;
const workable = claims.filter((c) => ["open", "assigned", "in_progress", "completed"].includes(c.state));
let r;

S("Who may open and change a client report");
r = await T(() => AR("creport.get", OCT)); ok("billers cannot open it", !r.ok, r);
r = await T(() => LE("creport.get", OCT)); ok("a team lead cannot open another team's client", !r.ok, r);
r = await TI("creport.get", OCT); ok("the client's team lead opens it, and may edit", r.client.name === sunrise.name && r.can_edit === true, { name: r.client.name, can: r.can_edit });
ok("it carries every dataset", ["inventory", "inventoryPrev", "worked", "payment", "submission", "rejection", "clientAssistance"].every((k) => k in r.data), Object.keys(r.data));
r = await T(() => TI("creport.get", { ...OCT, from: "2026-10-31", to: "2026-10-01" })); ok("dates the wrong way round are refused", !r.ok, r);

S("The inventory at the period end: live, a kept snapshot, or rebuilt");
r = await TI("creport.get", { ...OCT, from: "2026-11-01", to: "2026-11-30", prev_from: "2026-10-01", prev_to: "2026-10-31", period_key: "month:2026-11" });
ok("this month's inventory is live: every workable claim", r.data.inventory.source === "live" && r.data.inventory.rows.length === workable.length, { src: r.data.inventory.source, n: r.data.inventory.rows.length, want: workable.length });
const bal = workable.reduce((a, c) => a + (Number(c.balance) || 0), 0);
ok("live rows carry the age group from the date of service", r.data.inventory.rows.every((x) => ["future", "0-30", "31-60", "61-90", "91-120", "121-180", "181-360", "360+", ""].includes(x.bk)));
const today = r.today;
let snap = (await rows("SELECT * FROM inv_snapshots WHERE client_id = ? AND day = ?", sunrise.id, today))[0];
ok("opening it keeps today's snapshot (cells by location, age, payer, status, action)", !!snap, today);
const cells = snap ? JSON.parse(snap.cells_json) : [];
ok("the snapshot adds up to the inventory: claims and balance", cells.reduce((a, x) => a + x.n, 0) === workable.length && Math.abs(cells.reduce((a, x) => a + x.amt, 0) - bal) < 0.05, { n: cells.reduce((a, x) => a + x.n, 0), amt: cells.reduce((a, x) => a + x.amt, 0), bal });
// the end of September: rebuilt from the claims' history
await sql("UPDATE claims SET created_at = ? WHERE client_id = ?", Date.parse("2026-07-01T00:00:00Z"), sunrise.id);
const [cA, cB] = workable;
await sql("UPDATE claims SET state = 'closed' WHERE id IN (?, ?)", cA.id, cB.id);
await sql("INSERT INTO claim_events (id, claim_id, at, kind, data_json) VALUES (?,?,?,?,?)", "e-a", cA.id, ist("2026-10-15", 12), "refreshed", JSON.stringify({ changes: { state: ["open", "closed"] } }));
await sql("INSERT INTO claim_events (id, claim_id, at, kind, data_json) VALUES (?,?,?,?,?)", "e-b", cB.id, ist("2026-09-10", 12), "state", JSON.stringify({ changes: { state: ["assigned", "closed"] } }));
r = await TI("creport.get", OCT);
ok("31 October is rebuilt when no snapshot was kept then", r.data.inventory.source === "rebuilt" && r.data.inventory.as_of === "2026-10-31", r.data.inventory.source);
const n = (inv) => (inv.cells || []).reduce((a, x) => a + x.n, 0);
// claims with a desk now were still AR before they were sent (today); claims that came in closed never were
const inProc = claims.filter((c) => c.state === "in_process").length;
ok("rebuilt 30 September: claim A (closed 15 Oct) was still open, claim B (closed 10 Sep) was not", n(r.data.inventoryPrev) === workable.length - 1 + inProc, { n: n(r.data.inventoryPrev), want: workable.length - 1 + inProc });
ok("rebuilt 31 October: both had left by then", n(r.data.inventory) === workable.length - 2 + inProc, { n: n(r.data.inventory), want: workable.length - 2 + inProc });
ok("claims that came in already closed are never counted", claims.some((c) => c.state === "closed" || c.state === "excluded"));
await sql("INSERT INTO inv_snapshots (client_id, day, cells_json, at) VALUES (?,?,?,?)", sunrise.id, "2026-09-30", JSON.stringify([{ loc: "", bk: "31-60", py: "Aetna", st: "", pms: "", act: "", n: 5, amt: 1000 }]), Date.now());
r = await TI("creport.get", OCT);
ok("a kept snapshot wins over the rebuild", r.data.inventoryPrev.source === "snapshot" && n(r.data.inventoryPrev) === 5, r.data.inventoryPrev);
await sql("UPDATE claims SET state = 'open' WHERE id IN (?, ?)", cA.id, cB.id);

S("Activity in the period: AR work, posting, submission, rejections, the client");
const cl = workable.slice(2, 12);
const notesIns = [["2026-10-05", "Claim Paid", "Paid in full", "Closed", "Closed"], ["2026-10-06", "Claim Denied", "CO-16 · Missing information", "Corrected claim sent", "Payer"],
  ["2026-10-07", "Claim Denied", "CO-16 · Missing information", "Appeal filed", "Payer"], ["2026-10-08", "Claim In Process", "Need to allow some time", "Follow up", "Payer"],
  ["2026-10-09", "Pending with client", "Medical records needed", "Pending with client", "Client"], ["2026-09-15", "Claim Denied", "CO-22 · Coordination of benefits", "Appeal filed", "Payer"]];
for (const [i, x] of notesIns.entries()) await sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, bucket, created_at) VALUES (?,?,?,?, 'work', ?,?,?,?,?)", "n" + i, cl[i].id, U("Arun Agent").id, "Arun Agent", x[1], x[2], x[3], x[4], ist(x[0], 11));
const H = (id, claim, dept, status, created, done, proof, reason, extra = "") => sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, due_at, done_at, done_by, done_by_name, proof_json, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  id, claim, sunrise.id, dept, status, created, U("Tina Lead").id, "Tina Lead", created + 86400000, done, done ? U("Tina Lead").id : null, done ? "Snail Post" : "", JSON.stringify(proof || {}), reason || "");
await H("p1", cl[0].id, "posting", "complete", ist("2026-10-05", 9), ist("2026-10-05", 15), { date: "2026-10-04", ref: "EFT-1", amount: 120.5 });
await H("p2", cl[1].id, "posting", "complete", ist("2026-10-20", 9), ist("2026-10-20", 15), { date: "2026-10-19", ref: "EFT-1", amount: 79.5 });
await H("p3", cl[2].id, "posting", "complete", ist("2026-09-20", 9), ist("2026-09-20", 15), { date: "2026-09-19", ref: "CHK-7", amount: 150 });
await H("p4", cl[3].id, "posting", "pending", ist("2026-10-28", 9), null, {});
await H("s1", cl[4].id, "submission", "complete", ist("2026-10-02", 9), ist("2026-10-02", 14), { mode: "Electronic", ref: "B1" });
await H("s2", cl[5].id, "submission", "complete", ist("2026-10-03", 9), ist("2026-10-03", 14), { mode: "Paper", ref: "B2" });
await H("s3", cl[6].id, "submission", "pending", ist("2026-10-27", 9), null, {}, "Authorization missing");
await H("r1", cl[7].id, "rejection", "complete", ist("2026-10-10", 9), ist("2026-10-10", 17), { code: "Subscriber / member ID invalid" });
await H("r2", cl[8].id, "rejection", "pending", ist("2026-10-12", 9), null, {});
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, reason, paused_at, client_sent_at) VALUES (?,?,?,?, 'client', ?,?,?,?,?,?)", "c1", cl[9].id, sunrise.id, "posting", ist("2026-10-21", 9), "Snail Post", ist("2026-10-22", 9), "No EOB / ERA", ist("2026-10-21", 10), ist("2026-10-22", 10));
r = await TI("creport.get", OCT);
const D = r.data;
ok("AR work entries in the period and the one before, with SAAG status, sub-status, action and where the ball is", D.worked.length === 6 && D.worked.some((x) => x.st === "Claim Denied" && x.sub === "CO-16 · Missing information" && x.mv === "Payer" && x.by === "Arun Agent"), D.worked.length);
ok("a work entry's age group is worked out at the work date", D.worked.every((x) => typeof x.bk === "string"));
const p1 = D.payment.find((x) => x.chk === "EFT-1" && x.paid === 120.5);
ok("postings: paid amount, check / EFT, paid date, week", p1 && p1.st === "Posted" && p1.pd === "2026-10-04" && p1.wk === "Oct week 1", p1);
ok("a posting still open shows as not posted", D.payment.some((x) => x.st === "Pending" && x.paid == null));
ok("submissions: submitted with their mode, and the one not submitted with its reason", D.submission.filter((x) => x.ok).length === 2 && D.submission.some((x) => !x.ok && /Authorization missing/.test(x.cm)), D.submission);
ok("rejections: the code, and what became of it", D.rejection.some((x) => x.st === "Subscriber / member ID invalid" && x.act === "Corrected and resubmitted") && D.rejection.some((x) => x.st === "Not coded yet"), D.rejection);
ok("requests waiting on the client: open, and sent", D.clientAssistance.some((x) => x.open && x.act === "Sent to the client" && x.st === "No EOB / ERA"), D.clientAssistance);
ok("the asks: what the client owes now, biggest first", r.asks.some((a) => a.what === "No EOB / ERA" && a.n === 1 && a.sent === 1), r.asks);
const oct = r.trend.find((x) => x.m === "2026-10"), sep = r.trend.find((x) => x.m === "2026-09");
ok("six months to October, with what was posted each month", r.trend.length === 6 && r.trend[0].m === "2026-05" && oct.coll === 200 && sep.coll === 150, r.trend);
r = await TI("creport.get", { ...OCT, location_id: sunrise.locations[0].id });
ok("a location narrows every dataset to it", r.data.worked.every((x) => x.loc === sunrise.locations[0].id) && (r.data.inventory.cells || []).every((x) => x.loc === sunrise.locations[0].id));

S("The team's words, kept with the report");
r = await TI("creport.save", { client_id: sunrise.id, period_key: "month:2026-10", page_id: "rca", data: { rca: { "co 16 missing information": { rca: "NPI missing", plan: "Checklist" } } } });
ok("the team lead saves the RCA", r.ok && r.by === "Tina Lead", r);
r = await A("creport.get", OCT);
ok("everyone who opens the report sees it, with who saved it", r.edits.rca && r.edits.rca.rca["co 16 missing information"].plan === "Checklist" && r.edits.rca._by === "Tina Lead", r.edits);
r = await T(() => AR("creport.save", { client_id: sunrise.id, period_key: "month:2026-10", page_id: "rca", data: {} })); ok("billers cannot change it", !r.ok, r);
r = await T(() => LE("creport.save", { client_id: sunrise.id, period_key: "month:2026-10", page_id: "rca", data: {} })); ok("nor a team lead of another team", !r.ok, r);
r = await T(() => TI("creport.save", { client_id: sunrise.id, period_key: "month:2026-10", page_id: "../x", data: {} })); ok("an unknown page is refused", !r.ok, r);
r = await T(() => TI("creport.save", { client_id: sunrise.id, period_key: "month:2026-10", page_id: "ar", data: { title: "x".repeat(50000) } })); ok("too much text is refused", !r.ok, r);
r = await TI("creport.get", { ...OCT, from: "2026-09-01", to: "2026-09-30", prev_from: "2026-08-01", prev_to: "2026-08-31", period_key: "month:2026-09" });
ok("edits belong to their period: September has none", !r.edits.rca, r.edits);
ok("and the audit trail records the change", (await A("audit.list", {})).rows.some((x) => x.action === "creport.edit"));

S("The client's logo");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
r = await TI("clients.setLogo", { client_id: sunrise.id, logo: PNG }); ok("the team lead adds it", r.ok);
r = await TI("creport.get", OCT); ok("the report carries it", r.client.logo === PNG);
const c2 = (await TI("clients.list")).clients.find((c) => c.id === sunrise.id);
ok("the client list only says there is one (the image is not sent with every list)", c2.has_logo === true && !("logo" in c2), Object.keys(c2).filter((k) => /logo/.test(k)));
r = await T(() => TI("clients.setLogo", { client_id: sunrise.id, logo: "data:image/svg+xml;base64,PHN2Zz4=" })); ok("other kinds of file are refused", !r.ok, r);
r = await T(() => AR("clients.setLogo", { client_id: sunrise.id, logo: PNG })); ok("billers cannot change it", !r.ok, r);
r = await TI("clients.setLogo", { client_id: sunrise.id, logo: "" }); ok("empty removes it", r.ok && !(await TI("creport.get", OCT)).client.logo);

S("EV production: the file uploaded for the report");
const evRow = (wd, py, st, by) => ({ wd, dos: "2026-10-20", no: "A1", py, st, act: "Verified on the portal", by, cm: "" });
const octEV = [1, 2, 3, 4, 5, 6].map((d) => evRow("2026-10-0" + d, d % 2 ? "Aetna" : "Medicare", d % 3 ? "Active coverage" : "Inactive coverage", "Riya"));
r = await T(() => AR("creport.evUpload", { client_id: sunrise.id, file_name: "ev.xlsx", rows: octEV })); ok("billers cannot upload one", !r.ok, r);
r = await T(() => LE("creport.evUpload", { client_id: sunrise.id, file_name: "ev.xlsx", rows: octEV })); ok("a team lead of another client cannot", !r.ok, r);
r = await TI("creport.evUpload", { client_id: sunrise.id, file_name: "EV Oct.xlsx", rows: [...octEV, { wd: "", py: "Cigna" }] });
ok("the client's team lead uploads it: 6 rows kept, the row without a date left out", r.ok && r.n === 6 && r.skipped === 1 && r.from === "2026-10-01" && r.to === "2026-10-06", r);
r = await TI("creport.get", OCT);
ok("the report carries the EV rows and the file", r.data.ev.length === 6 && r.ev_files.length === 1 && r.ev_files[0].n === 6 && r.ev_files[0].file === "EV Oct.xlsx", { ev: r.data.ev.length, files: r.ev_files });
ok("only the report's columns are kept (nothing about the patient)", Object.keys(r.data.ev[0]).sort().join(",") === "act,by,cm,dos,id,loc,no,py,st,wd", Object.keys(r.data.ev[0]));
const ev2 = [4, 5, 6, 7, 8, 9, 10].map((d) => evRow("2026-10-" + String(d).padStart(2, "0"), "BCBS", "Benefits verified", "Sam"));
r = await TI("creport.evUpload", { client_id: sunrise.id, file_name: "EV week 2.xlsx", rows: ev2 }); ok("a second file is taken", r.ok && r.n === 7, r);
r = await TI("creport.get", OCT);
ok("it replaces the same dates: 3 rows of the first file stay, 10 in all", r.data.ev.length === 10 && r.ev_files.length === 2 && r.ev_files.find((f) => f.file === "EV Oct.xlsx").n === 3, { n: r.data.ev.length, files: r.ev_files.map((f) => [f.file, f.n]) });
r = await TI("creport.get", { ...OCT, from: "2026-11-01", to: "2026-11-30", prev_from: "2026-10-01", prev_to: "2026-10-31", period_key: "month:2026-11" });
ok("November's report has October's EV for the comparison only", r.data.ev.length === 10 && r.ev_files.length === 2);
r = await T(() => TI("creport.evUpload", { client_id: sunrise.id, file_name: "x", rows: [{ wd: "2025-01-01" }, { wd: "2026-10-05" }] })); ok("one file over more than a year is refused", !r.ok, r);
r = await T(() => TI("creport.evUpload", { client_id: sunrise.id, file_name: "x", rows: [{ py: "Aetna" }] })); ok("a file with no dates is refused", !r.ok, r);
ok("uploads are in the audit trail", (await A("audit.list", {})).rows.some((x) => x.action === "creport.ev" && /EV week 2\.xlsx: 7 EV rows/.test(x.detail || "")));
let evFiles = (await TI("creport.get", OCT)).ev_files;
r = await T(() => AR("creport.evRemove", { client_id: sunrise.id, id: evFiles[0].id })); ok("billers cannot remove one", !r.ok, r);
r = await TI("creport.evRemove", { client_id: sunrise.id, id: evFiles.find((f) => f.file === "EV week 2.xlsx").id }); ok("the team lead removes a file", r.ok);
r = await TI("creport.get", OCT); ok("its rows go with it", r.data.ev.length === 3 && r.ev_files.length === 1, { n: r.data.ev.length, files: r.ev_files.length });
await TI("creport.save", { ...OCT, page_id: "_made", data: { made: true } });
r = await TI("creport.get", OCT); ok("reports made before are listed for the start screen", r.made.some((m) => m.period_key === "month:2026-10"), r.made);

S("The page engine: Third Eye's rules on Brahmastra's records");
const raw = await TI("creport.get", OCT);
// a fixed inventory for the engine: September 1,000 in 31-60 days; October 400 in 31-60 and 300 in 0-30
raw.data.inventoryPrev = { source: "snapshot", as_of: "2026-09-30", cells: [{ loc: "", bk: "31-60", py: "Aetna", st: "", pms: "", act: "", n: 10, amt: 1000 }] };
raw.data.inventory = { source: "snapshot", as_of: "2026-10-31", cells: [{ loc: "", bk: "31-60", py: "Aetna", st: "Claim In Process", pms: "", act: "", n: 4, amt: 400 }, { loc: "", bk: "0-30", py: "Medicare Part B", st: "", pms: "", act: "", n: 3, amt: 300 }] };
const DS = app.crDatasets(raw);
const R = { range: { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31), kind: "month" }, compare: true, client: "Sunrise Eye Care", periodName: "October", cardMeasure: {} };
const ctxOf = (pid, sel) => app.crCtx(DS, R, pid, sel || {});
const inv = app.crBuildInventory(ctxOf("inventory"));
ok("inventory: reduction 30% (1,000 to 700), 3 claims fewer", inv.kpis[1].value === "30.0%" && /\$300 off the open AR · 3 claims/.test(inv.kpis[1].sub) && inv.headline === "AR came down 30% in October", { k: inv.kpis[1], h: inv.headline });
ok("inventory: the 31-60 bucket cleared the most, 0-30 grew", inv.insights.some((x) => /largest reduction came from the 31 to 60 days bucket: \$600/.test(x)) && inv.insights.some((x) => /0 to 30 days bucket grew by \$300/.test(x)), inv.insights);
ok("inventory: unworked claims count as Not worked yet in the status mix", DS.inventory.labels.purviewStatus["not worked yet"] === "Not worked yet");
const inv2 = app.crBuildInventory2(ctxOf("inventory2"));
ok("breakdown: the payers holding 80% of the balance (Pareto)", inv2.cards[0].items[0].label === "Aetna" && inv2.cards[0].items.filter((x) => x.emph).length === 2, inv2.cards[0].items.map((x) => [x.label, x.emph]));
{ const top = inv2.cards[0].items.filter((x) => x.emph), pct = Math.round(top.reduce((a, x) => a + x.share, 0) * 100);
  ok("...and the insight gives the share they really hold (" + pct + "%), not the 80% line", pct >= 80 && inv2.insights.some((x) => x.includes("hold " + pct + "% of the open balance")), inv2.insights[0]); }
const sel = { payerKey: new Set(["medicare"]) };
const invF = app.crBuildInventory2(ctxOf("inventory2", sel));
ok("click to filter: only Medicare's balance is left on the page", invF.kpis[0].value === "$300", invF.kpis[0]);
const ar = app.crBuildAR(ctxOf("ar"));
ok("AR production: 5 entries in October, 1 confirmed paid (20%), 2 denied (40%)", ar.kpis[0].value === "5" && ar.kpis[2].value === "20%" && ar.kpis[3].value === "40%", ar.kpis.map((k) => k.value));
const den = app.crBuildDenials(ctxOf("denials"));
ok("denials: 2 of 5 claims worked, from the AR entries", den.kpis[0].value === "2" && den.kpis[2].value === "40.0%", den.kpis.map((k) => k.value));
const tops = app.crTopDenials([{ label: "a", emph: true }, { label: "b", emph: true }, { label: "c", emph: false }, { label: "d", emph: false }, { label: "e", emph: false }]);
ok("top denials: under 3 reasons to reach 80% shows the top 3", tops.label === "Top 3" && tops.rows.length === 3, tops);
const pay = app.crBuildPayment(ctxOf("payment"));
ok("payment posting: $200 posted on 2 lines, 1 EFT, up from $150", pay.kpis[0].value === "$200" && pay.kpis[1].value === "2" && pay.kpis[2].value === "1" && pay.headline === "Collections rose 33% to $200", { k: pay.kpis.map((k) => k.value), h: pay.headline });
const sub = app.crBuildSubmission(ctxOf("submission"));
ok("submission: 2 submitted, 1 not submitted with its reason", sub.kpis[0].value === "2" && sub.insights.some((x) => /1 claims .* still not submitted; the main blocker is "Authorization missing/.test(x)), { k: sub.kpis[0], i: sub.insights });
const rej = app.crBuildRejection(ctxOf("rejection"));
ok("rejections: 2 rejected against 2 submitted (100.0%)", rej.kpis[0].value === "2" && rej.kpis[1].value === "100.0%", rej.kpis.map((k) => k.value));
const ca = app.crBuildCA(ctxOf("ca"));
ok("client assistance: the desk's request and the AR entry with the ball at the client", ca.kpis[0].value === "2", ca.kpis.map((k) => k.value));
const ex = app.crBuildExec(ctxOf("exec"), raw);
ok("executive summary: AR $700, collected $200, the ask and a focus line", ex.kpis[0].value === "$700" && ex.kpis[1].value === "$200" && ex.exec.asks.some((a) => /No EOB/.test(a)) && ex.exec.focus.length >= 1, { k: ex.kpis.map((k) => k.value), asks: ex.exec.asks, focus: ex.exec.focus });

// EV: the columns read from a file, never the patient's; the EV page
const mEV = app.crMatchEV(["Patient Name", "DOB", "Member ID", "Date of Service", "Verified On", "Insurance Name", "Eligibility Status", "Verification Type", "Verified By", "Effective Date", "Comments"]);
ok("EV file: the columns are found by their usual names", mEV.wd === "Verified On" && mEV.dos === "Date of Service" && mEV.py === "Insurance Name" && mEV.st === "Eligibility Status" && mEV.ty === "Verification Type" && mEV.by === "Verified By" && mEV.cm === "Comments", mEV);
ok("EV file: the patient's name, birth date and member ID are never read", !Object.values(mEV).some((h) => /Patient|DOB|Member/.test(h)), mEV);
const mEV2 = app.crMatchEV(["Account #", "DOS", "Effective Date", "Term Date", "Payer", "Status"]);
ok("EV file: a coverage date is not taken for the date of the check", !mEV2.wd && mEV2.dos === "DOS" && mEV2.no === "Account #", mEV2);
ok("a saved report period reads back", app.crRangeFromKey("month:2026-10").kind === "month" && app.crRangeFromKey("week:2026-10-26").start.getDate() === 26 && app.crRangeFromKey("custom:2026-10-01:2026-10-15").end.getDate() === 15 && app.crRangeFromKey("x") === null);
const rawEV = { ...raw, data: { ...raw.data, ev: [...octEV, ...[1, 2, 3].map((d) => evRow("2026-09-0" + d, "Aetna", "Active coverage", "Sam"))] } };
const DSE = app.crDatasets(rawEV);
const evp = app.crBuildEV(app.crCtx(DSE, R, "ev", {}));
ok("EV page: 6 verifications in October, up from 3, Active coverage the largest group", evp.kpis[0].value === "6" && evp.headline === "6 eligibility verifications" && evp.insights.some((x) => /Active coverage made up 67%/.test(x)) && evp.insights.some((x) => /3 to 6/.test(x)), { k: evp.kpis.map((k) => k.value), i: evp.insights });
ok("EV page: by insurance and by verification type / status", evp.cards.length === 2 && evp.cards[0].title === "Insurance wise breakdown", evp.cards.map((c) => c.title));
ok("no EV file, no EV page", app.crHasPage(app.crDatasets({ ...raw, data: { ...raw.data, ev: [] } }), "ev") === false && app.crHasPage(DSE, "ev") === true);

S("Where the claims open at the period before went, and a DOS in the future");
{ const D = (d) => Date.parse(d + "T12:00:00+05:30");
  const moveOf = async () => { const mv = (await TI("creport.get", OCT)).data.movement || []; return (k) => (mv.find((x) => x.k === k) || { n: 0 }).n; };
  const before = await moveOf();
  const pick = (await rows("SELECT id FROM claims WHERE client_id = ? AND state IN ('open','assigned','completed') ORDER BY id LIMIT 6", sunrise.id)).map((x) => x.id);
  const [a, b, cc, d, e, f] = pick;
  await sql(`UPDATE claims SET created_at = ? WHERE id IN (${pick.map(() => "?").join(",")})`, D("2026-08-01"), ...pick);
  const ev = (id, at, from, to) => sql("INSERT INTO claim_events (id, claim_id, at, kind, data_json) VALUES (?,?,?,?,?)", "mv-" + id + at, id, at, "state", JSON.stringify({ changes: { state: [from, to] } }));
  const ho = (id, dept, status, created, done) => sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, done_at) VALUES (?,?,?,?,?,?,?,?)", "mvh-" + id + created, id, sunrise.id, dept, status, created, created + 86400000, done || null);
  await ev(a, D("2026-10-10"), "assigned", "closed");                        // closed by AR
  await ho(b, "posting", "complete", D("2026-10-12"), D("2026-10-14"));      // the payment posted
  await ho(cc, "submission", "pending", D("2026-10-15"));                    // still with Submission
  await ho(d, "submission", "complete", D("2026-10-16"), D("2026-10-18"));   // submitted, back with AR
  await ho(e, "posting", "complete", D("2026-09-20"), D("2026-10-05"));      // at Posting before 30 Sep: not open AR then, not counted
  const after = await moveOf(), up = (k) => after(k) - before(k);
  ok("each claim once, by its latest step: AR close, Posting close, Submission close, Pending Submission", up("ar_close") === 1 && up("posting_close") === 1 && up("submission_close") === 1 && up("pending_submission") === 1 && up("pending_posting") === 0,
    ["ar_close", "posting_close", "submission_close", "pending_submission", "pending_posting"].map((k) => k + " " + up(k)));
  await sql("UPDATE claims SET dos = ? WHERE id = ?", "2099-01-01", f);
  const live = (await TI("creport.get", { ...OCT, from: "2026-11-01", to: "2026-11-30", prev_from: "2026-10-01", prev_to: "2026-10-31", period_key: "month:2026-11" })).data.inventory.rows.find((x) => x.id === f);
  ok("a date of service in the future is its own age group: Future DOS", live && live.bk === "future", live && live.bk);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
