/* Suite 31: the Escalation tracker's two types and the error details. The type comes first: External (raised by the client) or
   Internal (raised inside Purview). A new escalation tells the project's team lead (bell and email, never the description or the
   client's email subject). "Y · our error" needs who made it and the DOW (the date the work was done). Only external escalations
   count in the client's SLA: the screen's SLA box, the month's SLA copy for Drishti, the open count and the digest. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const mails = [];
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_holidays") || url.includes("brahmastra_wfm") || url.includes("brahmastra_live") || url.includes("brahmastra_floor")) return J({ ok: false, error: "not here" }, 404);
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); }
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40), APP_URL: "https://brahmastra.example" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
await rig.app.seedDemo(() => {});
rig.liveEnv.DEMO = false;
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
rig.liveEnv.DEMO = true;
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), SM = await firstIn("Sima Expert", "sima@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
rig.liveEnv.DEMO = false;
const sun = (await A("clients.list")).clients.find((c) => /Sunrise/.test(c.name));
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const daysBefore = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
const mdy = (iso) => iso.slice(5, 7) + "/" + iso.slice(8, 10) + "/" + iso.slice(0, 4);
const base = { client_id: sun.id, day: today, dept: "Payment Posting", raised_who: "Office manager", reported_to: "Tina Lead", email_subject: "Payment for Jane Roe not posted", description: "Payment for patient Jane Roe was posted to the wrong claim", owner_id: U("Tina Lead").id };
const tinaNotices = async () => (await rows("SELECT text FROM user_notices WHERE user_id = ? AND view = 'escalations' ORDER BY at", U("Tina Lead").id)).map((x) => x.text);

S("The type comes first");
let r = await T(() => SM("escalations.save", { ...base }));
ok("without a type it is not saved: pick External or Internal first", !r.ok && /type first/i.test(r.e), r);
r = await T(() => SM("escalations.save", { ...base, kind: "client" }));
ok("only External or Internal", !r.ok && /type first/i.test(r.e), r);
r = await T(() => SM("escalations.save", { ...base, kind: "constructor" }));
ok("not a crafted value either", !r.ok && /type first/i.test(r.e), r);
r = await T(() => SM("escalations.save", { ...base, kind: "external" }));
ok("the SME logs an external one: SR1", r.ok && r.r.sr === 1, r);
r = await T(() => SM("escalations.save", { ...base, kind: "internal", raised_who: "QA team", reported_to: "Tina Lead", email_subject: "", description: "QA found the wrong adjustment code used on three claims" }));
ok("and an internal one: SR2 (one register, one SR count)", r.ok && r.r.sr === 2, r);
r = await T(() => SM("escalations.save", { ...base, kind: "internal", raised_who: "" }));
ok("an internal one asks who raised it at Purview", !r.ok && /at Purview/.test(r.e), r);
r = await T(() => AR("escalations.save", { ...base, kind: "external" }));
ok("a biller still cannot log one", !r.ok && r.status === 403, r);

S("The project's team lead hears about each new one");
let tn = await tinaNotices();
ok("Tina (the team lead of the project) got a notice for each", tn.length === 2 && /new external escalation at Sunrise Eye Care: SR1, Payment Posting, received/.test(tn[0]) && /new internal escalation/.test(tn[1]), tn);
ok("the notice names who logged it", tn.every((t) => /^Sima Expert logged/.test(t)), tn);
ok("never the description or the client's email subject (they can carry patient details)", tn.every((t) => !/Jane Roe|wrong claim|adjustment code/.test(t)), tn);
await sleep(300);
const toTina = mails.filter((m) => /tina@/.test(JSON.stringify(m.to || m)));
ok("and an email to the team lead for each", toTina.length === 2 && /New external escalation SR1: Sunrise Eye Care \(Payment Posting\)/.test(toTina[0].subject) && /New internal escalation SR2/.test(toTina[1].subject), mails.map((m) => m.subject));
ok("the email has no description or email subject, and opens the tracker on the client", toTina.every((m) => !/Jane Roe|wrong claim|adjustment code/.test(JSON.stringify(m))) && /#\/escalations\?client_id=/.test(toTina[0].html), toTina[0] && toTina[0].text);
ok("nobody outside the project's leads gets it (the SME who logged it, the biller)", !mails.some((m) => /sima@|arun@/.test(JSON.stringify(m.to || ""))), mails.map((m) => m.to));
const bell = await TI("notify.list", {});
const bi = bell.items.find((x) => x.key.startsWith("notice:") && /SR1/.test(x.text));
ok("in Tina's bell under Escalations, opening the tracker on that client", bi && bi.cat === "escalations" && bi.view === "escalations" && bi.params && bi.params.client_id === sun.id, bi);
r = await T(() => TI("escalations.save", { ...base, kind: "external", dept: "Submission" }));
ok("the team lead logs one herself: SR3", r.ok && r.r.sr === 3, r);
ok("and is not told about her own", (await tinaNotices()).length === 2);

S("Y · our error: who made it and the DOW");
const L0 = await TI("escalations.list", { client_id: sun.id, status: "all" });
const sr1 = L0.rows.find((x) => x.sr === 1), sr2 = L0.rows.find((x) => x.sr === 2);
ok("rows carry their type", sr1.kind === "external" && sr1.kind_label === "External" && sr2.kind === "internal", [sr1.kind, sr2.kind]);
const edit = (row, o) => T(() => TI("escalations.save", { ...row, id: row.id, ...o }));
r = await edit(sr1, { is_error: "Y" });
ok("our error without the person: not saved", !r.ok && /who made the error/.test(r.e), r);
r = await edit(sr1, { is_error: "Y", error_by_id: U("Arun Agent").id });
ok("our error without the DOW: not saved", !r.ok && /DOW/.test(r.e), r);
r = await edit(sr1, { is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: "2026-02-30" });
ok("an impossible DOW: not saved", !r.ok && /real date|pick the DOW/.test(r.e), r);
r = await edit(sr1, { is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: daysBefore(today, -1) });
ok("a DOW after the received date: not saved", !r.ok && /after the received date/.test(r.e), r);
const dow = daysBefore(today, 3);
r = await edit(sr1, { is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: dow });
ok("with the person and the DOW it is saved", r.ok, r);
let L1 = await TI("escalations.list", { client_id: sun.id, status: "all" });
let s1 = L1.rows.find((x) => x.sr === 1);
ok("the row shows who made it and the DOW", s1.is_error === "Y" && s1.error_by_name === "Arun Agent" && s1.error_dow === dow, s1);
r = await edit(sr2, { is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: dow });
ok("internal escalations need the same", r.ok, r);
ok("Sima hears nothing; Tina saved them herself, so no notice to her either", (await tinaNotices()).length === 2);
// the SME marks one as our error: the team lead is told who and when
await T(() => TI("escalations.save", { ...base, kind: "external", dept: "Account Receivable" }));
const sr4 = (await TI("escalations.list", { client_id: sun.id, status: "all" })).rows.find((x) => x.sr === 4);
r = await T(() => SM("escalations.save", { ...sr4, id: sr4.id, is_error: "Y", error_by_id: U("Arun Agent").id, error_dow: dow }));
tn = await tinaNotices();
ok("marked as our error later: the team lead is told, with who made it and the DOW", r.ok && /Sima Expert marked external escalation SR4 \(Account Receivable\) at Sunrise Eye Care as our error\. Our error: made by Arun Agent, DOW /.test(tn[tn.length - 1]) && tn[tn.length - 1].includes(mdy(dow).slice(0, 6)), tn[tn.length - 1]);
r = await T(() => SM("escalations.save", { ...sr4, id: sr4.id, is_error: "N" }));
L1 = await TI("escalations.list", { client_id: sun.id, status: "all" });
const s4 = L1.rows.find((x) => x.sr === 4);
ok("N · not our error clears the person and the DOW", r.ok && s4.is_error === "N" && !s4.error_by_name && !s4.error_dow, s4);

S("Only external escalations count in the client's SLA");
L1 = await TI("escalations.list", { client_id: sun.id, status: "all", today });
ok("the screen's SLA box counts the external ones: 3 (SR1, SR3, SR4), not the internal SR2", L1.sla && L1.sla.n === 3 && !L1.sla.met, L1.sla);
ok("this month's split: 3 external, 1 internal", L1.stats.logged_external === 3 && L1.stats.logged_internal === 1, L1.stats);
const LI = await TI("escalations.list", { client_id: sun.id, status: "all", kind: "internal" });
const LE = await TI("escalations.list", { client_id: sun.id, status: "all", kind: "external" });
ok("the Type filter: Internal shows SR2 only, External the other three", LI.rows.map((x) => x.sr).join() === "2" && LE.rows.map((x) => x.sr).sort().join() === "1,3,4", [LI.rows.map((x) => x.sr), LE.rows.map((x) => x.sr)]);
const inv = await TI("inventory.status", { client_id: sun.id, today });
const escCk = inv.checks.find((x) => x.key === "esc");
ok("Inventory status: Escalations open counts the external ones only", escCk && escCk.now === "3", escCk);
const X = await TI("sla.extras", { client_id: sun.id, today });
ok("the SLA scorecard's escalations: 3 external, the internal one counted apart", X.esc && X.esc.n === 3 && X.esc.internal === 1, X.esc && { n: X.esc.n, internal: X.esc.internal });
await sleep(800);
const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(today.slice(5, 7)) - 1] + " " + today.slice(0, 4);
const slaDir = () => { const root = child("root", "Brahmastra Reports"); const ld = root && child(root.id, "Tina Lead"); const cf = ld && child(ld.id, sun.name); return cf && child(cf.id, "SLA & KPI"); };
const slaFile = slaDir() && child(slaDir().id, "Escalation Tracker - " + sun.name + " - " + mon + ".xlsx");
let sr = slaFile ? OD.rows.get(slaFile.id) : [];
ok("the month's SLA copy (what Drishti counts) has the external ones only", sr.length === 4 && sr.slice(1).map((x) => x[0]).sort().join() === "SR1,SR3,SR4", sr.map((x) => x[0]));
const cf = child(child("root", "Brahmastra Clients") ? child("root", "Brahmastra Clients").id : "", sun.name);
const main = cf && child(cf.id, "Escalation Tracker - " + sun.name + ".xlsx");
const mr = main ? OD.rows.get(main.id) : [];
ok("the client's tracker file has all four, with the new columns at the end", mr.length === 5 && mr[0].slice(-3).join("|") === "Escalation type|Error by|DOW of error (mm/dd/yy)", mr[0] && mr[0].slice(-3));
const m1 = mr.find((x) => x[0] === "SR1"), m2 = mr.find((x) => x[0] === "SR2");
ok("SR1: External, made by Arun Agent, the DOW as an Excel date; SR2: Internal", m1 && m1[21] === "External" && m1[22] === "Arun Agent" && typeof m1[23] === "number" && m2 && m2[21] === "Internal", [m1 && m1.slice(-3), m2 && m2.slice(-3)]);
ok("the first columns stay where Drishti reads them", mr[0].slice(0, 4).join("|") === "SR No|Department|Client Name|Received (mm/dd/yy)");
// changing SR3 to internal takes it out of the SLA copy
const sr3 = L1.rows.find((x) => x.sr === 3);
r = await T(() => TI("escalations.save", { ...sr3, id: sr3.id, kind: "internal", raised_who: "Operations manager" }));
await sleep(800);
sr = OD.rows.get(slaFile.id);
ok("an escalation changed to internal leaves the SLA copy", r.ok && sr.length === 3 && !sr.some((x) => x[0] === "SR3"), sr.map((x) => x[0]));
ok("and the screen's SLA count", (await TI("escalations.list", { client_id: sun.id, status: "all", today })).sla.n === 2);
r = await T(() => TI("escalations.save", { ...sr3, id: sr3.id, kind: undefined, raised_who: "Operations manager" }));
const s3 = (await TI("escalations.list", { client_id: sun.id, status: "all" })).rows.find((x) => x.sr === 3);
ok("an edit without a type keeps the one it has", r.ok && s3.kind === "internal", s3 && s3.kind);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
