/* Suite 11: the client profile. Whoever is set as responsible (AR, posting, submission, follow-up, rejections) or on the team gets the client and its claims; billers only look; every change is in the client's history; a new client needs its whole profile. */
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
  P({ emp_id: "D1", name: "Snail Post", project: "Lakeview Dental Group", department: "Posting", email: "snail@purview-healthcare.com" }),
  P({ emp_id: "D2", name: "Paula PostLead", project: "Lakeview Dental Group", position: "Team Lead", department: "Posting", reports_to: "Joseph Manager", email: "paula@purview-healthcare.com" }),
  P({ emp_id: "D3", name: "Mark Sub", project: "Lakeview Dental Group", department: "Submission", email: "mark@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cara Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "cara@purview-healthcare.com" }),
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
const SN = await firstIn("Snail Post", "snail@purview-healthcare.com"), PA = await firstIn("Paula PostLead", "paula@purview-healthcare.com"), MK = await firstIn("Mark Sub", "mark@purview-healthcare.com");
const LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"), CA = await firstIn("Cara Agent", "cara@purview-healthcare.com");
const has = async (who, c) => (await who("clients.list")).clients.find((x) => x.id === c.id);
const hist = async (who, c) => (await who("clients.history", { client_id: c.id })).rows;
const sunClaim = (await TI("claims.list", { client_id: sun.id, page_size: 1 })).rows[0], lakeClaim = (await LE("claims.list", { client_id: lake.id, page_size: 1 })).rows[0];

S("Responsibility gives the client and its claims");
ok("before: Snail does not see Dr. Sunrise", !(await has(SN, sun)));
let r = await T(async () => SN("claims.list", { client_id: sun.id }));
ok("nor its claims", !r.ok, r);
mails.length = 0;
await TI("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Snail Post").id, backup: U("Paula PostLead").id });
const snBell = (await SN("notify.list", {})).items.find((i) => /^notice:/.test(i.key));
ok("Snail's bell tells him who made him responsible", snBell && /Tina Lead made you the Payment posting person for Sunrise Eye Care/.test(snBell.text) && snBell.view === "clients", snBell);
ok("and he gets an email saying so", mails.some((m) => m.to === "snail@purview-healthcare.com" && /Payment posting person for Sunrise Eye Care/.test(m.subject)), mails.map((m) => m.to + ": " + m.subject));
ok("the backup is told too", mails.some((m) => m.to === "paula@purview-healthcare.com" && /Payment posting backup/.test(m.subject)));
const sc = await has(SN, sun);
ok("set as the posting person, Snail sees the client profile", sc && sc.responsible_me, sc && Object.keys(sc).length);
ok("read-only for a biller", sc && sc.can_edit === false);
ok("and knows it at sign-in (Claims page)", (await SN("auth.me")).user.resp_clients.includes(sun.id));
r = await T(async () => SN("claims.list", { client_id: sun.id, page_size: 20 }));
ok("Snail opens the client's claims", r.ok && r.r.rows.length > 0 && r.r.rows.every((c) => c.client_id === sun.id), r);
r = await SN("claims.list", { page_size: 500 });
ok("only the clients Snail is responsible for", r.rows.every((c) => c.client_id === sun.id), [...new Set(r.rows.map((c) => c.client_id))]);
r = await T(async () => SN("claims.get", { id: sunClaim.id }));
ok("and a claim's details", r.ok, r);
r = await T(async () => SN("claims.get", { id: lakeClaim.id }));
ok("not another client's claim", !r.ok, r);
for (const [op, pl] of [["clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "client" }], ["clients.save", { id: sun.id, name: "Changed by a biller" }], ["locations.save", { client_id: sun.id, name: "Biller location" }], ["clients.saveTeam", { client_id: sun.id, team: [] }]]) {
  r = await T(async () => SN(op, pl));
  ok("a biller cannot change it: " + op, !r.ok, r);
}
const pc = await has(PA, sun);
ok("the backup, a posting team lead, gets it too and can edit", pc && pc.can_edit === true, pc && pc.can_edit);
r = await T(async () => PA("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Mark Sub").id }));
ok("so a supervisor set on it can change it", r.ok, r);
ok("the submission person sees it at once", (await has(MK, sun)) && (await has(MK, sun)).responsible_me);
await TI("clients.saveResponsibility", { client_id: sun.id, dept: "subcheck", mode: "person", lead: U("Cara Agent").id });
ok("so does the follow-up checker", !!(await has(CA, sun)));
await TI("clients.saveResponsibility", { client_id: sun.id, dept: "subcheck", mode: "biller" });
ok("and loses it when taken off", !(await has(CA, sun)));
ok("and is told it was taken off", (await CA("notify.list", {})).items.some((i) => /took you off Sunrise Eye Care/.test(i.text)));
const BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
ok("Bela (Lakeview) does not see Sunrise", !(await has(BE, sun)));
await TI("clients.saveTeam", { client_id: sun.id, team: [U("Arun Agent").id, U("Bela Agent").id] });
ok("being put on a client's team brings the client too", !!(await has(BE, sun)));

S("Change history");
const h1 = await hist(PA, sun);
ok("a supervisor on the client sees who changed what, newest first", h1.length >= 3 && h1[0].at >= h1[h1.length - 1].at, h1.length);
let rh = await T(async () => SN("clients.history", { client_id: sun.id }));
ok("billers do not see the change history", !rh.ok, rh);
rh = await T(async () => SN("raci.list", {}));
ok("nor the RACI tracker", !rh.ok, rh);
ok("with names, not codes", h1.some((x) => /Payment posting: .*Snail Post \(backup Paula PostLead\)/.test(x.detail) && x.user_name === "Tina Lead"), h1.map((x) => x.detail));
ok("and what it was before", h1.some((x) => /Submission: .*Mark Sub.*\(was: not set\)/.test(x.detail) && x.user_name === "Paula PostLead"), h1.map((x) => x.detail));
await TI("locations.save", { client_id: sun.id, name: "Northside" });
const loc = (await TI("clients.list")).clients.find((x) => x.id === sun.id).locations.find((l) => l.name === "Northside");
await TI("locations.save", { id: loc.id, name: "Northside Clinic", active: true });
await TI("clients.saveTeam", { client_id: sun.id, team: [U("Arun Agent").id, U("Rohan Mehta").id] });
await TI("clients.save", { id: sun.id, name: sun.name, code: "SUN", follow_up_days: 21, active: true });
const h2 = await hist(TI, sun);
ok("the client's team lead sees the new changes too", h2.length > h1.length);
ok("locations added and renamed", h2.some((x) => x.detail === "Location added: Northside") && h2.some((x) => /renamed Northside → Northside Clinic/.test(x.detail)), h2.map((x) => x.detail));
ok("team changes", h2.some((x) => /Billers on the client: added Rohan Mehta; removed Bela Agent/.test(x.detail)), h2.map((x) => x.detail));
ok("profile field changes", h2.some((x) => /default follow-up 30 → 21 days/.test(x.detail) && /code .* → SUN/.test(x.detail)), h2.map((x) => x.detail));
r = await T(async () => LE("clients.history", { client_id: sun.id }));
ok("not for another team", !r.ok, r);

S("A new client needs its whole profile");
const me = (await A("auth.me")).user.id;
r = await T(async () => A("clients.save", { name: "Dr. Montella Eye Care", code: "MON" }));
ok("nothing but a name is refused", !r.ok && /scope of work/.test(r.e) && /at least one location/.test(r.e), r.e);
r = await T(async () => A("clients.save", { name: "Dr. Montella Eye Care", locations: ["Main"], profile: { scope: ["ar", "posting", "submission"], targets: { ar: 40 }, resp: { ar: { lead: U("Tina Lead").id } } } }));
ok("each part of the scope needs a target and a person", !r.ok && /daily target for Payment posting/.test(r.e) && /responsible for Submission/.test(r.e) && /rechecks submitted claims/.test(r.e), r.e);
r = await T(async () => A("clients.save", { name: "Dr. Montella Eye Care", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: "nobody-like-this" } } } }));
ok("only active people", !r.ok && /only people who are active/.test(r.e), r.e);
r = await T(async () => TI("clients.save", { name: "Dr. Montella Eye Care", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: U("Tina Lead").id } } } }));
ok("team leads with a span do not add clients", !r.ok, r);
const full = { scope: ["ar", "posting", "submission", "rejection"], targets: { ar: 45, posting: 60, submission: 50, rejection: 20 },
  resp: { ar: { lead: U("Tina Lead").id }, posting: { lead: U("Snail Post").id, backup: U("Paula PostLead").id }, submission: { lead: U("Mark Sub").id }, rejection: { lead: U("Mark Sub").id }, subcheck: { mode: "person", lead: U("Mark Sub").id } } };
r = await T(async () => A("clients.save", { name: "Dr. Montella Eye Care", code: "MON", follow_up_days: 30, locations: ["Main", "Westgate"], workbook_link: "", profile: full }));
ok("with everything, it is created", r.ok, r);
const mon = (await A("clients.list")).clients.find((x) => x.name === "Dr. Montella Eye Care");
ok("with its locations, scope, targets and people", mon && mon.locations.length === 2 && mon.scope_of_work.join() === "ar,posting,submission,rejection" && mon.targets.posting === 60 && mon.posting_lead === U("Snail Post").id && mon.submission_check_person === U("Mark Sub").id, mon);
ok("and nothing missing", mon && !mon.profile_gaps.length, mon && mon.profile_gaps);
ok("Snail and Mark see it in their login straight away", (await has(SN, mon)) && (await has(MK, mon)) && (await has(TI, mon)));
ok("its history starts with how it was set up", /created with locations Main, Westgate/.test((await hist(A, mon)).slice(-1)[0].detail), (await hist(A, mon)).slice(-1)[0]);
r = await T(async () => A("clients.save", { name: "dr. montella eye care", locations: ["X"], profile: full }));
ok("no two clients with the same name", !r.ok && /already exists/.test(r.e), r.e);

S("Older clients show what is missing");
const lk = (await LE("clients.list")).clients.find((x) => x.id === lake.id);
ok("a client with no profile yet says so", lk.profile_gaps.includes("scope of work"), lk.profile_gaps);
let nl = await LE("notify.list", {});
ok("and the bell tells its team lead", nl.items.some((i) => i.key === "profiles" && i.view === "clients"), nl.items.map((i) => i.key));
r = await T(async () => LE("clients.save", { id: lake.id, name: lk.name, code: lk.code, follow_up_days: lk.follow_up_days, active: true, profile: { scope: ["ar", "posting"], targets: { ar: 30, posting: 25 }, resp: { ar: { lead: U("Leo Lead").id }, posting: { lead: U("Snail Post").id } } } }));
ok("the team lead completes it", r.ok, r);
ok("gaps gone", !(await LE("clients.list")).clients.find((x) => x.id === lake.id).profile_gaps.length);
ok("the history shows each change with what it was", (await hist(LE, lake)).some((x) => /AR follow-up: in scope, target 30 a day, Leo Lead/.test(x.detail) && /Payment posting: in scope, target 25 a day, Snail Post/.test(x.detail)), (await hist(LE, lake)).map((x) => x.detail));
ok("Snail is responsible for both clients now", (await SN("auth.me")).user.resp_clients.length === 3, (await SN("auth.me")).user.resp_clients);
await sql("UPDATE users SET active = 0 WHERE id = ?", U("Snail Post").id);
const gone = (await LE("clients.list")).clients.find((x) => x.id === lake.id).profile_gaps;
ok("when the posting person leaves, the profile says so", gone.some((g) => /Payment posting responsible person \(the one set is no longer active\)/.test(g)), gone);
await sql("UPDATE users SET active = 1 WHERE id = ?", U("Snail Post").id);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
