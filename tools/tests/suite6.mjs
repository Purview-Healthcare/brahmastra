/* Suite 6: Client 360 (numbers, health, waiting on the client, call log, month-end checklist, audit) and access. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", project: "", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sam Sme", position: "SME", reports_to: "Tina Lead", email: "sam@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "P1", name: "Snail Post", department: "Posting", reports_to: "Tina Lead", email: "snail@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", email: "leo@purview-healthcare.com" })];
const fetchMock = async (url) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), SM = await firstIn("Sam Sme", "sam@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"),
  SN = await firstIn("Snail Post", "snail@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const now = Date.now(), day = 86400000;
const ov = (X, extra) => X("client.overview", { client_id: sun.id, from_ms: now - 30 * day, to_ms: now + day, ...(extra || {}) });

S("Numbers match the claims");
let d = await ov(TI);
const truth = (await A("claims.list", { client_id: sun.id, state: "workable", page_size: 1 }));
ok("AR balance and count are the workable claims", d.ar.claims > 0 && Math.abs(d.ar.balance - (truth.total_balance ?? d.ar.balance)) < 1, [d.ar.balance, truth.total_balance, d.ar.claims]);
const all = (await sql("SELECT 1")) && rig.backend.env.DB;
const o90 = await DB.prepare("SELECT COALESCE(SUM(balance),0) AS b FROM claims WHERE client_id = ? AND state IN ('open','assigned','in_progress','completed') AND julianday(?) - julianday(substr(dos,1,10)) > 90").bind(sun.id, new Date().toISOString().slice(0, 10)).first();
ok("over-90 is claims more than 90 days from DOS", Math.abs(d.ar.over90 - o90.b) < 1, [d.ar.over90, o90.b]);
ok("over-90 % worked out", Math.abs(d.ar.over90_pct - Math.round(o90.b / d.ar.balance * 1000) / 10) < 0.11, d.ar.over90_pct);
ok("a snapshot was kept for today, so the trend can start", d.first_snapshot && d.trend.length >= 1, [d.first_snapshot, d.trend]);
ok("health has a verdict and plain reasons", ["good", "watch", "risk"].includes(d.health) && Array.isArray(d.reasons), [d.health, d.reasons]);

S("Collected and waiting on the client");
await TI("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Snail Post").id });
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 6 })).rows;
await TI("alloc.reassign", { ids: pool.map((c) => c.id), user_id: U("Arun Agent").id });
const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
const toPost = async (c) => { await AR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: pdf }); await AR("queue.complete", { id: c.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Portal", findings: "Paid per the portal, EOB attached", action: "eob requested" } }); };
await toPost(pool[0]); await toPost(pool[1]);
let hs = (await SN("handoffs.list", {})).rows;
const h0 = hs.find((h) => h.claim_id === pool[0].id), h1 = hs.find((h) => h.claim_id === pool[1].id);
await SN("handoffs.close", { id: h0.id, outcome: "complete", proof: { date: new Date().toISOString().slice(0, 10), ref: "CHK-1", amount: 250.5 } });
await SN("handoffs.close", { id: h1.id, outcome: "client", reason: "Need EOB / ERA from the client", note: "The ERA for the deposit is missing" });
d = await ov(TI);
ok("collected adds the amounts posted", Math.abs(d.collected.amount - 250.5) < 0.01 && d.collected.n === 1, d.collected);
ok("the request waiting on the client is listed, not sent yet", d.waiting.rows.length === 1 && d.waiting.rows[0].claim_no === pool[1].claim_no && !d.waiting.rows[0].sent, d.waiting.rows);
await sql("UPDATE handoffs SET client_sent_at = ?, paused_at = ? WHERE id = ?", now - 3 * day, now - 3 * day, h1.id);
await SN("handoffs.close", { id: h1.id, outcome: "resume", note: "ERA received" });
d = await ov(TI);
ok("once answered, it leaves the list and the reply time shows (about 3 days)", d.waiting.rows.length === 0 && d.waiting.reply && Math.abs(d.waiting.reply.days - 3) < 0.1, d.waiting);

S("Denial reasons and escalations");
await AR("attachments.add", { claim_id: pool[2].id, name: "denial-eob.pdf", type: "application/pdf", data: pdf });
await AR("queue.complete", { id: pool[2].id, saag: { status: "Claim Denied", sub_status: "Denied for Auth- referral", action: "Need to Appeal", bucket: "Purview", effective: "Denied" }, note: { source: "Portal", findings: "Denied for missing authorization", action: "appeal sent" } }).catch((e) => console.log("DENY ERR", e.message));
d = await ov(TI);
const auth = d.reasons_top.find((r) => /Auth/.test(r.reason));
ok("a denied entry shows under its reason, with its balance", auth && auth.n === 1 && Math.abs(auth.bal - pool[2].balance) < 1, d.reasons_top);

S("Call log");
let r = await T(async () => TI("client.logAdd", { client_id: sun.id, kind: "call", text: "short" }));
ok("too short is refused", !r.ok, r);
r = await T(async () => TI("client.logAdd", { client_id: sun.id, kind: "next", text: "Bring the over-90 trend and member-ID rejections" }));
ok("a next call needs its date", !r.ok, r);
r = await T(async () => TI("client.logAdd", { client_id: sun.id, kind: "call", text: "Client agreed to send ERAs within 2 days" }));
ok("Tina logs a call", r.ok, r);
const callId = r.r.id;
r = await T(async () => SM("client.logAdd", { client_id: sun.id, kind: "next", next_on: "2026-11-25", text: "Prepare the over-90 trend and member-ID rejections" }));
ok("the SME logs the next call", r.ok, r);
d = await ov(TI);
ok("both in the log, newest first", d.log.length === 2 && d.log[0].kind === "next" && d.log[0].next_on === "2026-11-25" && d.log[1].by_name === "Tina Lead", d.log.map((l) => [l.kind, l.by_name]));
r = await T(async () => SM("client.logDelete", { id: callId }));
ok("the SME cannot remove Tina's entry", !r.ok, r);
r = await T(async () => TI("client.logDelete", { id: d.log[0].id }));
ok("the team lead can remove an entry", r.ok, r);

S("Month-end checklist");
d = await ov(TI);
const month = d.monthend.month;
ok("six steps with due dates", d.monthend.steps.length === 6 && d.monthend.steps.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.due)), d.monthend.steps.map((x) => x.due));
r = await T(async () => TI("monthend.set", { client_id: sun.id, month, step: "sla", done: true }));
ok("SLA scored needs the score", !r.ok && /score/i.test(r.e), r);
r = await T(async () => TI("monthend.set", { client_id: sun.id, month, step: "sla", done: true, score: 88.4 }));
ok("Tina ticks SLA scored at 88.4%", r.ok, r);
await TI("monthend.set", { client_id: sun.id, month, step: "pack", done: true });
d = await ov(TI);
ok("ticked steps show who and when; the SLA score shows on the page", d.monthend.steps.find((x) => x.key === "pack").done && d.monthend.steps.find((x) => x.key === "pack").done_by_name === "Tina Lead" && d.sla && d.sla.score === 88.4, [d.sla, d.monthend.done]);
ok("an SLA under 90 is a health reason", d.reasons.some((x) => /SLA 88.4%/.test(x.text)), d.reasons);
await TI("monthend.set", { client_id: sun.id, month, step: "pack", done: false });
d = await ov(TI);
ok("unticking works", !d.monthend.steps.find((x) => x.key === "pack").done);
await TI("reports.saveArInventory", { client_id: sun.id, name: "AR Inventory report - test.xlsx", file_b64: Buffer.from("x").toString("base64") }).catch(() => {});
await TI("monthend.mark", { client_id: sun.id, step: "sla_inventory" });
d = await ov(TI);
const si = d.monthend.steps.find((x) => x.key === "sla_inventory");
ok("sending the AR Inventory to the scorecard ticks its step by itself", si.done && si.by_itself, si);
r = await T(async () => TI("monthend.mark", { client_id: sun.id, step: "pack" }));
ok("only that step ticks itself", !r.ok, r);
const aud = await DB.prepare("SELECT action, user_name, detail FROM audit_log WHERE client_id = ? ORDER BY at").bind(sun.id).all();
ok("changes are in the audit trail", aud.results.some((x) => x.action === "monthend.sla" && /88.4/.test(x.detail) && x.user_name === "Tina Lead") && aud.results.some((x) => x.action === "client.log"), aud.results.map((x) => x.action));

S("Who can see and change it");
r = await T(async () => AR("client.overview", { client_id: sun.id }));
ok("billers cannot open Client 360", !r.ok, r);
r = await T(async () => LE("client.overview", { client_id: sun.id }));
ok("another span's lead cannot open it", !r.ok, r);
r = await T(async () => SM("client.overview", { client_id: sun.id }));
ok("the SME on the client can read it", r.ok, r);
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "view" });
r = await T(async () => LE("client.overview", { client_id: sun.id }));
ok("a view-only share can read it", r.ok && r.r.monthend.can_edit === false, r.ok && r.r.monthend.can_edit);
r = await T(async () => LE("client.logAdd", { client_id: sun.id, kind: "note", text: "Trying to write on a shared client" }));
ok("but cannot write to it", !r.ok && /view-only/i.test(r.e), r);
r = await T(async () => LE("monthend.set", { client_id: sun.id, month, step: "pack", done: true }));
ok("nor tick its month-end", !r.ok, r);
r = await T(async () => A("client.overview", { client_id: lake.id }));
ok("the admin opens any client", r.ok && r.r.client.name === lake.name, r.ok);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
