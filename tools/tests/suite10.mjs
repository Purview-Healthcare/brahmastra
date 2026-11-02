/* Suite 10: the Monday digest, one email per manager's span (Sweety's, Sandesh's, Joseph's clients) to every supervisor on them: who gets it, what it says, no patient data, once a week, the Monday job. */
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
  P({ emp_id: "M3", name: "Sweety Manager", position: "Manager", reports_to: "Sasha Vice", email: "sweety@purview-healthcare.com" }),
  P({ emp_id: "T3", name: "Kiran Lead", position: "Team Lead", project: "Orchid Family Clinic", reports_to: "Sweety Manager", email: "kiran@purview-healthcare.com" }),
  P({ emp_id: "A4", name: "Omar Agent", project: "Orchid Family Clinic", reports_to: "Kiran Lead", email: "omar@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" })];
const mails = [];
const fetchMock = async (url, init) => { if (url.includes("brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }); if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); } return new Response("nope", { status: 500 }); };
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40), APP_URL: "https://brahmastra.example.test" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
const adminId = (await A("auth.me")).user.id;
const prof = { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: adminId } } };
await A("clients.save", { name: "Orchid Family Clinic", code: "ORC", follow_up_days: 30, active: true, locations: ["Main"], profile: prof });
await A("clients.save", { name: "Willow Pediatrics", code: "WIL", follow_up_days: 30, active: true, locations: ["Main"], profile: prof });
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"), SW = await firstIn("Sweety Manager", "sweety@purview-healthcare.com"), KI = await firstIn("Kiran Lead", "kiran@purview-healthcare.com");
const orchid = cl.find((c) => /Orchid/.test(c.name)), willow = cl.find((c) => /Willow/.test(c.name));
const done = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } };
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows;
await TI("alloc.reassign", { ids: pool.map((c) => c.id), user_id: U("Arun Agent").id });
for (const c of pool.slice(0, 6)) await AR("queue.complete", { id: c.id, ...done });
const IST = 330 * 60000;
const mondayOf = (ms) => { const d = new Date(ms + IST); const dow = (d.getUTCDay() + 6) % 7; return Date.parse(d.toISOString().slice(0, 10) + "T00:00:00Z") - dow * 86400000 - IST; };
const thisMonday = mondayOf(Date.now());
await sql("UPDATE notes SET created_at = ? WHERE kind = 'work'", thisMonday - 3 * 86400000);
const span = (r, re) => r.spans.find((s) => re.test(s.title));
const names = (s) => s.recipients.map((p) => p.name).sort();

S("Spans");
let r = await T(async () => SA("digest.spans"));
ok("the VP sees every span", r.ok, r);
const sp = r.r;
ok("one per manager: Joseph's, Sandesh's and Sweety's clients", span(sp, /^Joseph Manager's clients$/) && span(sp, /^Sandesh Manager's clients$/) && span(sp, /^Sweety Manager's clients$/), sp.spans.map((s) => s.title));
ok("each with the clients under that manager", span(sp, /Joseph/).clients.map((c) => c.id).join() === sun.id && span(sp, /Sandesh/).clients.map((c) => c.id).join() === lake.id && span(sp, /Sweety/).clients.map((c) => c.id).join() === orchid.id, sp.spans.map((s) => s.title + ": " + s.clients.map((c) => c.name)));
ok("a client under no manager goes in 'Clients without a manager'", span(sp, /without a manager/) && span(sp, /without a manager/).clients.some((c) => c.id === willow.id), sp.spans.map((s) => s.title));
const jo = span(sp, /Joseph/);
ok("Joseph's goes to Joseph, his team lead, the VP and the admin", ["Joseph Manager", "Sasha Vice", "Tina Lead", "Supervisor"].every((n) => names(jo).includes(n)), names(jo));
ok("not to other managers, their team leads or billers", !names(jo).some((n) => /Leo|Sandesh|Sweety|Kiran|Agent/.test(n)), names(jo));
ok("Sweety's goes to Sweety and Kiran", ["Sweety Manager", "Kiran Lead"].every((n) => names(span(sp, /Sweety/)).includes(n)), names(span(sp, /Sweety/)));
ok("'without a manager' goes only to the VP and admins", names(span(sp, /without a manager/)).every((n) => /Sasha|Supervisor|Admin/i.test(n)), names(span(sp, /without a manager/)));
r = await TI("digest.spans");
ok("a team lead sees only their own span", r.spans.filter((s) => s.visible).map((s) => s.title).join() === "Joseph Manager's clients", r.spans.map((s) => s.title));
r = await SW("digest.spans");
ok("a manager sees their own", r.spans.filter((s) => s.visible).map((s) => s.title).join() === "Sweety Manager's clients", r.spans.map((s) => s.title));
r = await TI("digest.spans", { client_id: sun.id });
ok("Client 360 shows the span the client is in", r.spans.length === 1 && r.spans[0].title === "Joseph Manager's clients", r.spans.map((s) => s.title));
r = await T(async () => AR("digest.spans"));
ok("billers have no digest", !r.ok, r);
r = await T(async () => LE("digest.preview", { span: jo.key }));
ok("another span's team lead cannot preview it", !r.ok, r);
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "view" });
ok("a view-only share does not add someone", !names(span(await SA("digest.spans"), /Joseph/)).includes("Leo Lead"));
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "edit" });
ok("an edit share does", names(span(await SA("digest.spans"), /Joseph/)).includes("Leo Lead"));
await TI("clients.accessRemove", { client_id: sun.id, user_id: U("Leo Lead").id }).catch(() => {});
await KI("auth.savePrefs", { digest: "off" });
ok("someone who turned it off in Settings shows as off", span(await SA("digest.spans"), /Sweety/).recipients.find((p) => p.name === "Kiran Lead").off);

S("What it says");
r = await T(async () => TI("digest.preview", { span: jo.key }));
ok("a preview with a subject, HTML and text", r.ok && r.r.subject && r.r.html.length > 1500 && r.r.text.length > 100, r);
const pv = r.r;
ok("subject names the span and the week", pv.subject.startsWith("Joseph Manager's clients · week of "), pv.subject);
ok("totals, what needs attention, client by client and the team", ["AR now", "Over 90 days", "Collected", "Entries", "Needs your attention", "Client by client", "The team last week"].every((k) => pv.html.includes(k)), pv.html.slice(0, 200));
ok("every client of the span has its row, and no other client", pv.html.includes("<b>" + sun.name + "</b>") && !pv.html.includes(lake.name) && !pv.html.includes(orchid.name));
ok("last week's entries are counted", /Entries<\/div><div[^>]*>6</.test(pv.html) && pv.html.includes("Arun Agent"), pv.html.match(/Entries<\/div><div[^>]*>[^<]*/));
const claims = (await SA("claims.list", { page_size: 2000 })).rows;
const leakIn = (txt) => claims.filter((c) => (c.patient && txt.includes(c.patient)) || (c.claim_no && txt.includes(">" + c.claim_no + "<")) || (c.account_no && c.account_no.length > 4 && txt.includes(c.account_no)));
ok("no patient names, claim or account numbers anywhere in it", !leakIn(pv.html).length && !leakIn(pv.text).length, leakIn(pv.html).slice(0, 3).map((c) => c.claim_no));
ok("links to Client 360 when the app address is set", pv.html.includes("https://brahmastra.example.test/#/client"));
ok("says why you get it and how to stop it", /You get this because you are a supervisor on Joseph Manager's clients/.test(pv.html) && /Settings, Email/.test(pv.html));
ok("no em dashes", !/—/.test(pv.html + pv.subject + pv.text));

S("Copy to me");
mails.length = 0;
r = await T(async () => TI("digest.sendMe", { span: jo.key }));
ok("a team lead emails themselves a copy", r.ok && mails.length === 1 && mails[0].to === "tina@purview-healthcare.com" && mails[0].subject.startsWith("[Copy] "), mails.map((m) => m.to));

S("Sending by hand");
await JO("auth.savePrefs", { digest: "off" });
r = await T(async () => TI("digest.sendNow", { span: jo.key }));
ok("team leads cannot send it to everyone by hand", !r.ok, r);
mails.length = 0;
r = await T(async () => SA("digest.sendNow", { span: jo.key }));
const toJo = mails.map((m) => m.to).sort();
ok("the VP can, to everyone on the span except who turned it off", r.ok && r.r.sent === toJo.length && toJo.includes("tina@purview-healthcare.com") && toJo.includes("sasha@purview-healthcare.com") && !toJo.includes("joseph@purview-healthcare.com"), [r.r, toJo]);
ok("one email each", new Set(toJo).size === toJo.length);
mails.length = 0;
r = await SA("digest.sendNow", { span: jo.key });
ok("sending again the same week sends nothing", r.sent === 0 && mails.length === 0, r);
const jo2 = span(await TI("digest.spans"), /Joseph/);
ok("the card shows when it went and to how many", jo2.runs[0] && jo2.runs[0].sent === toJo.length && jo2.runs[0].by_name === "Sasha Vice", jo2.runs);
ok("it is in the audit trail", (await A("audit.list", {})).rows.some((x) => x.action === "digest.sendNow"));
await JO("auth.savePrefs", { digest: "on" });

S("The Monday job");
const runJob = async (at) => { const real = Date.now; Date.now = () => at; try { const ps = []; await rig.worker.default.scheduled({ cron: "*/10 3-7 * * 1" }, rig.backend.env, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };
const nextMon = thisMonday + 7 * 86400000;
mails.length = 0;
await runJob(nextMon + 7 * 3600000);
ok("nothing before 8:30 IST", mails.length === 0, mails.length);
await runJob(nextMon + 9 * 3600000);
ok("at 9:00 IST it sends", mails.length > 0, mails.length);
for (let i = 0; i < 6; i++) await runJob(nextMon + 9 * 3600000 + (i + 1) * 600000);
const title = (m) => m.subject.split(" · ")[0];
const got = (who) => mails.filter((m) => m.to === who).map(title).sort();
ok("the VP gets one email per span", got("sasha@purview-healthcare.com").join() === ["Clients without a manager", "Joseph Manager's clients", "Sandesh Manager's clients", "Sweety Manager's clients"].join(), got("sasha@purview-healthcare.com"));
ok("each manager gets their own span", got("joseph@purview-healthcare.com").join() === "Joseph Manager's clients" && got("sandesh@purview-healthcare.com").join() === "Sandesh Manager's clients" && got("sweety@purview-healthcare.com").join() === "Sweety Manager's clients", [got("joseph@purview-healthcare.com"), got("sandesh@purview-healthcare.com"), got("sweety@purview-healthcare.com")]);
ok("each team lead gets their manager's span", got("tina@purview-healthcare.com").join() === "Joseph Manager's clients" && got("leo@purview-healthcare.com").join() === "Sandesh Manager's clients", [got("tina@purview-healthcare.com"), got("leo@purview-healthcare.com")]);
ok("someone who turned it off gets none", !got("kiran@purview-healthcare.com").length);
ok("billers get none", !mails.some((m) => /agent|arun|bela|omar/i.test(m.to)));
const per = {}; for (const m of mails) { const k = m.to + "|" + title(m); per[k] = (per[k] || 0) + 1; }
ok("nobody gets the same span twice", Object.values(per).every((n) => n === 1), per);
ok("no patient names, claim or account numbers in any of them", mails.length > 0 && mails.every((m) => !leakIn(m.html).length && !leakIn(m.text).length && !leakIn(m.subject).length));
const n1 = mails.length; await runJob(nextMon + 11 * 3600000);
ok("later runs that Monday send nothing more", mails.length === n1, mails.length - n1);
mails.length = 0; await runJob(nextMon + 86400000 + 9 * 3600000);
ok("nothing on Tuesday", mails.length === 0);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
