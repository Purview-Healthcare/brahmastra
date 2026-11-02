/* Suite 10: the Monday digest (one email per client to its supervisors): who gets it, what it says, no patient data, once a week, the Monday job. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "M2", name: "Sandesh Manager", position: "Manager", reports_to: "Sasha Vice", email: "sandesh@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Sandesh Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" })];
const mails = [];
const fetchMock = async (url, init) => { if (url.includes("brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }); if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); } return new Response("nope", { status: 500 }); };
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40), APP_URL: "https://brahmastra.example.test" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const done = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } };
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows;
await TI("alloc.reassign", { ids: pool.map((c) => c.id), user_id: U("Arun Agent").id });
for (const c of pool.slice(0, 6)) await AR("queue.complete", { id: c.id, ...done });
// move those entries into last week, so they are "last week" for a digest sent this Monday
const IST = 330 * 60000;
const mondayOf = (ms) => { const d = new Date(ms + IST); const dow = (d.getUTCDay() + 6) % 7; return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z") - dow * 86400000 - IST; };
const thisMonday = mondayOf(Date.now());
await sql("UPDATE notes SET created_at = ? WHERE kind = 'work'", thisMonday - 3 * 86400000);

S("Who gets it");
let r = await T(async () => TI("digest.info", { client_id: sun.id }));
ok("a team lead sees the digest card for their client", r.ok, r);
const names = (x) => x.recipients.map((p) => p.name).sort();
ok("the client's team lead, its manager, the VP and the admin get it", ["Joseph Manager", "Sasha Vice", "Tina Lead"].every((n) => names(r.r).includes(n)) && r.r.recipients.some((p) => /admin|supervisor/i.test(p.name) || p.designation === "Admin"), names(r.r));
ok("not the other client's team lead or manager, and no billers", !names(r.r).some((n) => /Leo|Sandesh|Agent/.test(n)), names(r.r));
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "view" });
ok("a view-only share does not add someone", !names(await TI("digest.info", { client_id: sun.id })).includes("Leo Lead"));
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "edit" });
ok("an edit share does", names(await TI("digest.info", { client_id: sun.id })).includes("Leo Lead"));
await TI("clients.accessRemove", { client_id: sun.id, user_id: U("Leo Lead").id }).catch(() => {});
r = await T(async () => AR("digest.info", { client_id: sun.id }));
ok("billers have no digest card", !r.ok, r);
r = await T(async () => LE("digest.preview", { client_id: sun.id }));
ok("another client's lead cannot preview it", !r.ok, r);
await JO("auth.savePrefs", { digest: "off" });
const off = (await TI("digest.info", { client_id: sun.id })).recipients.find((p) => p.name === "Joseph Manager");
ok("someone who turned it off in Settings shows as off", off && off.off, off);

S("What it says");
r = await T(async () => TI("digest.preview", { client_id: sun.id }));
ok("a preview with a subject, HTML and text", r.ok && r.r.subject && r.r.html.length > 1000 && r.r.text.length > 100, r);
const pv = r.r;
ok("subject names the client and the week", pv.subject.startsWith(sun.name + " · week of "), pv.subject);
ok("has AR, over 90, collected, entries and what needs attention", ["AR now", "Over 90 days", "Collected", "Entries", "Needs your attention", "Month-end"].every((k) => pv.html.includes(k)), pv.html.slice(0, 200));
ok("last week's entries are counted", /Entries<\/div><div[^>]*>6</.test(pv.html) && pv.html.includes("Arun Agent"), pv.html.match(/Entries<\/div><div[^>]*>[^<]*/));
const claims = (await TI("claims.list", { client_id: sun.id, page_size: 500 })).rows;
const leak = claims.filter((c) => (c.patient && pv.html.includes(c.patient)) || (c.claim_no && pv.html.includes(">" + c.claim_no + "<")) || (c.account_no && c.account_no.length > 4 && pv.html.includes(c.account_no)));
ok("no patient names, claim or account numbers anywhere in it", !leak.length && !claims.some((c) => c.patient && pv.text.includes(c.patient)), leak.slice(0, 3).map((c) => c.claim_no));
ok("links to Client 360 when the app address is set", pv.html.includes("https://brahmastra.example.test/#/client"));
ok("says why you get it and how to stop it", /You get this because you are a supervisor on/.test(pv.html) && /Settings, Email/.test(pv.html));
ok("no em dashes", !/—/.test(pv.html + pv.subject + pv.text));

S("Copy to me");
mails.length = 0;
r = await T(async () => TI("digest.sendMe", { client_id: sun.id }));
ok("a team lead emails themselves a copy", r.ok && mails.length === 1 && mails[0].to === "tina@purview-healthcare.com" && mails[0].subject.startsWith("[Copy] "), mails.map((m) => m.to));

S("Sending by hand");
r = await T(async () => TI("digest.sendNow", { client_id: sun.id }));
ok("team leads cannot send it to everyone by hand", !r.ok, r);
mails.length = 0;
r = await T(async () => SA("digest.sendNow", { client_id: sun.id }));
const toSun = mails.map((m) => m.to).sort();
ok("the VP can, and it goes to everyone on the client except who turned it off", r.ok && r.r.sent === toSun.length && toSun.includes("tina@purview-healthcare.com") && toSun.includes("sasha@purview-healthcare.com") && !toSun.includes("joseph@purview-healthcare.com"), [r.r, toSun]);
ok("one email each", new Set(toSun).size === toSun.length);
mails.length = 0;
r = await SA("digest.sendNow", { client_id: sun.id });
ok("sending again the same week sends nothing", r.sent === 0 && mails.length === 0, r);
const inf = await TI("digest.info", { client_id: sun.id });
ok("the card shows when it went and to how many", inf.runs[0] && inf.runs[0].sent === toSun.length && inf.runs[0].by_name === "Sasha Vice", inf.runs);
ok("it is in the audit trail", (await A("audit.list", {})).rows.some((x) => x.action === "digest.sendNow"));

S("The Monday job");
const runJob = async (at) => { const real = Date.now; Date.now = () => at; try { const ps = []; await rig.worker.default.scheduled({ cron: "*/10 3-7 * * 1" }, rig.backend.env, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };
const nextMon = thisMonday + 7 * 86400000;
mails.length = 0;
await runJob(nextMon + 7 * 3600000);   // 7:00 IST Monday: too early
ok("nothing before 8:30 IST", mails.length === 0, mails.length);
await runJob(nextMon + 9 * 3600000);   // 9:00 IST
const first = mails.length;
ok("at 9:00 IST it sends, a few clients per run", first > 0, first);
for (let i = 0; i < 6; i++) await runJob(nextMon + 9 * 3600000 + (i + 1) * 600000);
const byClient = {}; for (const m of mails) { const c = m.subject.split(" · ")[0]; byClient[c] = (byClient[c] || 0) + 1; }
ok("by the end every client has gone out", cl.filter((c) => c.active).every((c) => byClient[c.name] > 0), byClient);
const perPerson = {}; for (const m of mails) { const k = m.to + "|" + m.subject.split(" · ")[0]; perPerson[k] = (perPerson[k] || 0) + 1; }
ok("each person gets each client once", Object.values(perPerson).every((n) => n === 1), perPerson);
ok("the VP gets one per client, a team lead only their own", mails.filter((m) => m.to === "sasha@purview-healthcare.com").length === cl.filter((c) => c.active).length && mails.filter((m) => m.to === "leo@purview-healthcare.com").every((m) => m.subject.startsWith(lake.name)), Object.keys(perPerson));
ok("someone who turned it off gets none", !mails.some((m) => m.to === "joseph@purview-healthcare.com"));
const n1 = mails.length; await runJob(nextMon + 11 * 3600000);
ok("later runs that Monday send nothing more", mails.length === n1, mails.length - n1);
mails.length = 0; await runJob(nextMon + 86400000 + 9 * 3600000);
ok("nothing on Tuesday", mails.length === 0);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
