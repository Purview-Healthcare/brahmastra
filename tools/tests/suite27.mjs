/* Suite 27: the owner's calls after the A-to-Z test.
   1. 5 wrong passwords lock the account; only a code to the official email (Forgot it?) or the admin opens it, never a team lead.
   2. Live: the first password always needs a one-time code (no choosing one by name alone).
   3. Monday digest: a team lead sees only their own clients of the manager's digest. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const FEED_KEY = "k".repeat(48);
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "Tina Lead", shift: "", location: "Pune", doj: "2026-03-01", exit_date: null, email: "", ...o });
const feed = [P({ emp_id: "E0", name: "Mona Manager", position: "Manager", project: "Sunrise Eye Care", also_on_projects: "Lakeview Dental", reports_to: "", email: "mona@purview-healthcare.com" }),
  P({ emp_id: "E1", name: "Tina Lead", position: "Team Lead", reports_to: "Mona Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "E9", name: "Lena Lead", position: "Team Lead", project: "Lakeview Dental", reports_to: "Mona Manager", email: "lena@purview-healthcare.com" }),
  P({ emp_id: "E2", name: "Arun Agent", email: "arun@purview-healthcare.com" }), P({ emp_id: "E3", name: "Nomail Agent", email: "" })];
const fetchMock = async (url, init, real) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : real(url, init);
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: FEED_KEY }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const cls = (await A("clients.list")).clients;
for (const c of cls) await A("projects.map", { client_id: c.id, names: [/Sunrise/.test(c.name) ? "Sunrise Eye Care" : "Lakeview Dental"] }).catch(() => null);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const TL = await firstIn("Tina Lead", "tina@purview-healthcare.com");
await firstIn("Arun Agent", "arun@purview-healthcare.com");
const DB = rig.backend.env.DB; const row = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results[0];

S("1. Five wrong passwords lock the account");
const arun = U("Arun Agent");
let r;
for (let i = 1; i <= 4; i++) r = await T(() => login("arun@purview-healthcare.com", "wrong" + i));
ok("4 wrong: refused, says how many tries are left", !r.ok && r.status === 401 && /1 try left/.test(r.e), r);
r = await T(() => login("arun@purview-healthcare.com", "wrong5"));
ok("the 5th wrong password locks it", !r.ok && r.status === 423 && /locked/.test(r.e), r);
r = await T(() => login("arun@purview-healthcare.com", "pw-arun@purview-healthcare.com"));
ok("the right password no longer works while locked", !r.ok && r.status === 423, r);
r = await T(() => as(null)("auth.loginById", { user_id: arun.id, passHash: "0".repeat(64) }));
ok("sign-in by name is locked too", !r.ok && r.status === 423, r);
r = await T(() => TL("users.loginCode", { id: arun.id }));
ok("a team lead cannot give a sign-in code to a locked account", !r.ok && r.status === 403 && /locked/.test(r.e), r);
r = await T(async () => TL("users.resetPassword", { id: arun.id, passHash: await sha("temp-12345") }));
ok("a team lead cannot reset a locked account", !r.ok && r.status === 403, r);
// Forgot it?: a code to the official email, then a new password
const sc = await as(null)("auth.setupCode", { user_id: arun.id });
ok("Forgot it? sends a code to the official email on the account", sc.via === "email" && /@/.test(sc.email_hint) && sc.demo_code, sc);
r = await as(null)("auth.completeSetup", { user_id: arun.id, code: sc.demo_code, passHash: await sha("new-pass-arun") });
ok("the code and a new password open the account", !!r.token && !(await row("SELECT locked_at FROM users WHERE id = ?", arun.id)).locked_at);
ok("the new password works", !!(await login("arun@purview-healthcare.com", "new-pass-arun")).token);
// lock again, then the admin opens it
for (let i = 1; i <= 5; i++) await T(() => login("arun@purview-healthcare.com", "bad" + i));
ok("locked again", !!(await row("SELECT locked_at FROM users WHERE id = ?", arun.id)).locked_at);
await A("users.resetPassword", { id: arun.id, passHash: await sha("admin-temp-1") });
ok("the admin's reset opens it", !(await row("SELECT locked_at FROM users WHERE id = ?", arun.id)).locked_at && !!(await login("arun@purview-healthcare.com", "admin-temp-1")).token);
// a right password resets the count
for (let i = 1; i <= 3; i++) await T(() => login("arun@purview-healthcare.com", "x" + i));
await login("arun@purview-healthcare.com", "admin-temp-1");
ok("a right password starts the count again", (await row("SELECT failed_logins FROM users WHERE id = ?", arun.id)).failed_logins === 0);
// locked with no email: Forgot it? says ask the admin
const nm = U("Nomail Agent");
await DB.prepare("UPDATE users SET pass_salt = 'x', pass_hash = 'y', locked_at = ? WHERE id = ?").bind(Date.now(), nm.id).run();
ok("locked with no email: Forgot it? says ask the admin", (await as(null)("auth.setupCode", { user_id: nm.id })).via === "admin");

S("2. Live: the first password needs a code");
rig.liveEnv.DEMO = false;
const lena = U("Lena Lead");
r = await T(async () => as(null)("auth.firstPassword", { user_id: lena.id, passHash: await sha("no-code-pw") }));
ok("choosing a first password with no code is refused", !r.ok && /one-time code/.test(r.e), r);
ok("and nothing was saved", !(await row("SELECT pass_hash FROM users WHERE id = ?", lena.id)).pass_hash);
rig.liveEnv.DEMO = true;
const sc2 = await as(null)("auth.setupCode", { user_id: lena.id });
r = await as(null)("auth.completeSetup", { user_id: lena.id, code: sc2.demo_code, passHash: await sha("lena-pass") });
ok("with the emailed code the first password is set", !!r.token);

S("3. Monday digest: a team lead sees only their own clients");
const LN = as((await as(null)("auth.loginById", { user_id: lena.id, passHash: await sha("lena-pass") })).token);
const mine = (await LN("clients.list")).clients.map((c) => c.id);
const dd = await T(() => LN("digest.dashboard", {}));
ok("the digest page opens for the team lead", dd.ok, dd);
const shown = dd.ok && !dd.r.empty ? (dd.r.clients || []).map((c) => c.client_id || (c.client && c.client.id) || c.id) : [];
ok("it lists only the team lead's own clients", dd.ok && (dd.r.empty || (shown.length > 0 && shown.every((id) => mine.includes(id)))), { shown, mine });
const full = await A("digest.dashboard", { span: dd.ok && dd.r.span ? dd.r.span.key : undefined });
ok("the admin still sees the whole digest", (full.clients || []).length >= shown.length, { admin: (full.clients || []).length, tl: shown.length });

S("4. Escalations = the client escalations in the tracker only");
const sun = cls.find((c) => /Sunrise/.test(c.name));
const flag = (await A("claims.list", { client_id: sun.id, state: "workable", page_size: 1 })).rows[0];
await DB.prepare("UPDATE claims SET escalated = 1, escalated_at = ? WHERE id = ?").bind(Date.now() - 30 * 3600000, flag.id).run();
let ov = await A("client.overview", { client_id: sun.id });
ok("a claim flagged by a biller is not a client escalation", ov.escalations.open === 0 && ov.escalations.late === 0, ov.escalations);
await A("escalations.save", { client_id: sun.id, day: new Date().toISOString().slice(0, 10), dept: "Account Receivable", raised_who: "Office manager", reported_to: "Tina Lead", email_subject: "Posting delay", description: "Payment not posted for 3 days", owner_id: U("Tina Lead").id, status: "open" });
await DB.prepare("UPDATE escalations SET created_at = ? WHERE client_id = ?").bind(Date.now() - 30 * 3600000, sun.id).run();
ov = await A("client.overview", { client_id: sun.id });
ok("a client escalation in the tracker is counted, and flagged over 24 hours with no reason", ov.escalations.open === 1 && ov.escalations.late === 1, ov.escalations);
const pf = await A("portfolio.overview", { client_id: sun.id });
ok("client health names it as a client escalation", pf.rows[0].reasons.some((x) => /client escalation/.test(x)), pf.rows[0].reasons);
const at = await A("attention.count", {});
ok("Needs attention still counts the biller's flag on its own", at.escalations >= 1, at);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
