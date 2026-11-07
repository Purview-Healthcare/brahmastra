/* Suite 23: access and server-wide fixes. claims.byPatient for billers, projects.map, the email allow-list on sign-in by name,
   templates of another client, settings read and save, team.saveToday on a view-only share, ids sent as objects, impossible
   dates, the Production week at a month end, portfolio "vs a month ago", snapshots of a client with nothing open, a stale
   Shastra feed, the hand-off TAT and outside calls with a time limit. */
import fs from "fs";
import { makeRig, REPO } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const rig = await makeRig({});
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const ADM = await login("supervisor@purview-healthcare.com", "brahmastra-demo");
const A = as(ADM.token);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results; const row = async (q, ...a) => (await rows(q, ...a))[0];
const today = new Date().toISOString().slice(0, 10);
const [cA, cB] = (await A("clients.list")).clients.sort((x, y) => x.name.localeCompare(y.name)).reverse();
await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(["ProjA"]), cA.id);
await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(["ProjB"]), cB.id);
const now = Date.now(); let n = 0;
const mk = async (key, f) => {
  const id = "u-" + key;
  await sql(`INSERT INTO users (id,email,name,role,must_change,active,capacity,created_at,source,projects_json,scope_projects_json,department,designation,roster_kind,access_all,email_missing,pass_hash) VALUES (?,?,?,?,0,1,35,?,?,?,?,?,?,?,0,?,'')`,
    id, f.email || key.toLowerCase() + "@purview-healthcare.com", f.name, f.role || "user", now, f.source || "roster", JSON.stringify((f.projects || []).map((p) => ({ name: p }))), JSON.stringify(f.projects || []), f.dept || "", f.desig || "", f.kind || "", f.missing ? 1 : 0);
  if (f.nologin) return id;
  const t = "tok-23-" + key + "-" + (n++);
  await sql("INSERT INTO sessions (token,user_id,created_at,expires_at,via) VALUES (?,?,?,?,?)", t, id, now, now + 25 * 3600e3, "password");
  return as(t);
};
const leadA = await mk("leadA", { name: "Lead Alpha", role: "supervisor", projects: ["ProjA"], desig: "Team Lead", kind: "lead" });
const billerA = await mk("billerA", { name: "Biller Alpha", projects: ["ProjA"] });
const viewer = await mk("viewer", { name: "Viewer Share", role: "supervisor", projects: [] });
await sql("INSERT INTO client_access (id, client_id, user_id, level, granted_by, granted_by_name, at) VALUES ('ca23',?,?, 'view', ?, 'x', ?)", cA.id, "u-viewer", ADM.user.id, now);
const poolA = (await rows("SELECT id FROM claims WHERE client_id = ? AND state = 'open' LIMIT 10", cA.id)).map((r) => r.id);
const poolB = (await rows("SELECT id FROM claims WHERE client_id = ? AND state = 'open' LIMIT 10", cB.id)).map((r) => r.id);
await A("alloc.reassign", { ids: poolA.slice(0, 3), user_id: "u-billerA" });

S("claims.byPatient follows who may open the claim");
let r = await T(() => billerA("claims.byPatient", { id: poolB[0] }));
ok("a biller cannot list another client's patient", !r.ok && r.status === 403, r);
r = await T(() => billerA("claims.byPatient", { id: poolA[5] }));
ok("nor a claim of their client that is not theirs", !r.ok && r.status === 403, r);
r = await T(() => billerA("claims.byPatient", { id: poolA[0] }));
ok("a claim on their own list works", r.ok && r.r.rows.some((x) => x.id === poolA[0]), r);

S("projects.map: a team lead cannot take over another client");
r = await T(() => leadA("projects.map", { name: "ProjA", client_id: cB.id }));
ok("mapping their project to a client matched to another project is refused", !r.ok && r.status === 403, r);
ok("both clients keep their projects", JSON.parse((await row("SELECT roster_names_json AS j FROM clients WHERE id = ?", cB.id)).j).join() === "ProjB" && JSON.parse((await row("SELECT roster_names_json AS j FROM clients WHERE id = ?", cA.id)).j).join() === "ProjA");
r = await T(() => leadA("claims.list", { client_id: cB.id }));
ok("and client B stays out of their scope", !r.ok, r);
const cNew = { id: "c-new-23" }; await sql("INSERT INTO clients (id, name, code, active, follow_up_days, created_at, roster_names_json) VALUES (?, 'Unmatched Clinic', '', 1, 30, ?, '[]')", cNew.id, now);
r = await T(() => leadA("projects.map", { name: "ProjA", client_id: cNew.id }));
ok("a client with no project yet can still be matched by the lead", r.ok, r);
await sql("UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(["ProjA"]), cA.id); await sql("UPDATE clients SET roster_names_json = '[]' WHERE id = ?", cNew.id);

S("Sign-in by name keeps the email allow-list");
await mk("gmail", { name: "Gee Mail", email: "gee.mail@gmail.com", projects: ["ProjA"], nologin: true });
await mk("nomail", { name: "No Mail", email: "nomail-1@no-email.invalid", projects: ["ProjA"], missing: true, nologin: true });
const P = await sha("pw-23");
r = await T(() => as(null)("auth.firstPassword", { user_id: "u-gmail", passHash: P }));
ok("firstPassword refuses a non-Purview email", !r.ok && r.status === 403 && /not a Purview address/.test(r.e), r);
ok("and sets no password", !(await row("SELECT pass_hash FROM users WHERE id = 'u-gmail'")).pass_hash);
r = await T(() => as(null)("auth.completeSetup", { user_id: "u-gmail", passHash: P, code: "123456" }));
ok("completeSetup refuses it too", !r.ok && r.status === 403, r);
await A("roster.saveEmails", { emails: ["gee.mail@gmail.com"] });
r = await T(() => as(null)("auth.firstPassword", { user_id: "u-gmail", passHash: P }));
ok("once the admin allows the email, firstPassword works", r.ok && r.r.token, r);
await A("roster.saveEmails", { emails: [] });
r = await T(() => as(null)("auth.loginById", { user_id: "u-gmail", passHash: P }));
ok("loginById refuses it when the email is no longer allowed", !r.ok && r.status === 403, r);
const PW = await sha("wrong"); r = await T(() => as(null)("auth.loginById", { user_id: "u-gmail", passHash: PW }));
ok("a wrong password still says only that", !r.ok && r.status === 401, r);
r = await T(() => as(null)("auth.firstPassword", { user_id: "u-nomail", passHash: P }));
ok("someone with no email at all can still set their first password", r.ok, r);

S("Templates of another client");
const tB = await A("templates.save", { client_id: cB.id, title: "Bravo template", text: "Bravo template text here" });
r = await T(() => leadA("templates.save", { id: tB.id, title: "hijacked", text: "hijacked text here ok" }));
ok("a lead cannot overwrite another client's template", !r.ok && r.status === 403, r);
r = await T(() => leadA("templates.save", { id: tB.id, client_id: cA.id, title: "hijacked", text: "hijacked text here ok" }));
ok("nor move it to their own client", !r.ok && r.status === 403, r);
const tb = await row("SELECT client_id, title FROM note_templates WHERE id = ?", tB.id);
ok("the template is unchanged", tb.client_id === cB.id && tb.title === "Bravo template", tb);
const tA = await T(() => leadA("templates.save", { client_id: cA.id, title: "Alpha one", text: "Alpha template text" }));
r = await T(() => leadA("templates.save", { id: tA.r.id, client_id: cA.id, title: "Alpha two", text: "Alpha template text" }));
ok("their own client's template can still be edited", tA.ok && r.ok, [tA, r]);

S("Settings: who reads and who saves");
const put = (k, v) => sql("INSERT INTO settings (key, value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json", k, JSON.stringify(v));
await put("extra_emails", ["x@gmail.com"]); await put("live_sync", { at: now, rows: [{ e: "E1" }] }); await put("wfm_projects", { ok: true, rows: [] });
await put("workbook_status:" + cA.id, { ok: true, file: "A" }); await put("workbook_status:" + cB.id, { ok: true, file: "B" }); await put("onedrive_folder", { link: "https://x" });
const bs = (await billerA("settings.get")).settings;
ok("a biller reads only the pinned folder", Object.keys(bs).join() === "onedrive_folder", Object.keys(bs));
const ls = (await leadA("settings.get")).settings;
ok("a lead gets their client's file status, not another client's", ls["workbook_status:" + cA.id] && !ls["workbook_status:" + cB.id], Object.keys(ls));
ok("and no sign-in list, sync state or WFM data", !ls.extra_emails && !ls.live_sync && !ls.wfm_projects, Object.keys(ls));
const as_ = (await A("settings.get")).settings;
ok("the admin reads everything", as_.extra_emails && as_.live_sync && as_["workbook_status:" + cB.id]);
await T(() => viewer("settings.save", { settings: { digest_enabled: false, snap_at: 9e15, wfm_projects: { ok: false }, "cp:F:abc": { driveId: "x" } } }));
await T(() => leadA("settings.save", { settings: { digest_enabled: false, live_sync: { at: 9e15 }, ["escfile:" + cA.id]: { itemId: "x" }, onedrive_folder: { link: "https://lead" } } }));
const keys = (await rows("SELECT key FROM settings")).map((x) => x.key);
ok("a lead or a view-only share cannot save the digest switch, sync state, file ids or snapshot time", !keys.includes("digest_enabled") && Number(JSON.parse(((await row("SELECT value_json AS v FROM settings WHERE key = 'snap_at'")) || { v: "0" }).v)) < 9e15 && !keys.some((k) => /^(cp:|escfile:)/.test(k)) && JSON.parse((await row("SELECT value_json AS v FROM settings WHERE key = 'live_sync'")).v).at === now, keys);
ok("a lead can still pin the OneDrive folder", JSON.parse((await row("SELECT value_json AS v FROM settings WHERE key = 'onedrive_folder'")).v).link === "https://lead");
await A("settings.save", { settings: { digest_enabled: false, live_sync: { at: 1 } } });
ok("the admin saves the digest switch, never the server's own keys", JSON.parse((await row("SELECT value_json AS v FROM settings WHERE key = 'digest_enabled'")).v) === false && JSON.parse((await row("SELECT value_json AS v FROM settings WHERE key = 'live_sync'")).v).at === now);
await A("settings.save", { settings: { digest_enabled: true } });

S("team.saveToday on a view-only share");
r = await T(() => viewer("team.saveToday", { client_id: cA.id, on: [], caps: { "u-billerA": 500 } }));
ok("a view-only share cannot set the day's team", !r.ok && r.status === 403, r);
ok("caps unchanged", !JSON.parse((await row("SELECT caps_json AS j FROM clients WHERE id = ?", cA.id)).j || "{}")["u-billerA"]);

S("Odd input gives 400, not 500");
for (const [who, op, p] of [[billerA, "claims.get", { id: {} }], [billerA, "claims.byPatient", { id: [1] }], [billerA, "queue.skip", { id: { x: 1 } }], [leadA, "claims.list", { client_id: { x: 1 } }], [A, "users.save", { id: {} }], [A, "handoffs.close", { id: [] }]]) {
  r = await T(() => who(op, p)); ok(op + " with an object id", !r.ok && r.status === 400, r);
}
r = await T(() => A("inventory.status", { today: "2026-99-99" }));
ok("inventory.status with an impossible today works (today is used instead)", r.ok, r);
r = await T(() => A("alloc.apply", { client_id: cA.id, assignments: [null] }));
ok("alloc.apply with a null assignment says there is nothing to assign", !r.ok && r.status === 400, r);
r = await T(() => A("team.range", { from: "2026-02-30", to: "2026-03-02" }));
ok("an impossible date is not a date (team.range asks for the dates)", !r.ok && r.status === 400 && /Pick the dates/.test(r.e), r);
r = await T(() => A("handoffs.close", { id: "no-such" }));
ok("an unknown hand-off says not found", !r.ok && /not found/.test(r.e), r);

S("Production week at a month end");
const src = fs.readFileSync(REPO + "/worker.js", "utf8");
const grab = (re) => src.match(re)[0];
const weekOf = new Function(grab(/const IST_MIN = .*\n/) + grab(/const istDate = .*\n/) + grab(/const mdy = .*\n/) + grab(/function weekOf\(ms\) \{[\s\S]*?\n\}/) + "\nreturn weekOf;")();
const at = (iso) => Date.parse(iso + "T06:30:00Z");
let w = weekOf(at("2026-04-30"));
ok("Thu 30 Apr: its range ends on 30 Apr", w.range === "04/26/2026 - 04/30/2026" && w.week === "WE-04/30/2026", w);
w = weekOf(at("2026-05-01"));
ok("Fri 1 May: its range starts on 1 May", w.range === "05/01/2026 - 05/02/2026" && w.week === "WE-05/02/2026", w);
w = weekOf(at("2026-05-13"));
ok("a week inside a month is Sunday to Saturday", w.range === "05/10/2026 - 05/16/2026", w);

S("Portfolio vs a month ago");
const monthAgo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
await sql("DELETE FROM client_snapshots");
await sql("INSERT INTO client_snapshots (client_id, day, ar_balance, ar_claims, over90_balance, over90_claims, over120_balance, at) VALUES (?,?,?,?,0,0,0,?)", cA.id, monthAgo, 1000, 5, now);
await sql("UPDATE settings SET value_json = ? WHERE key = 'snap_at'", JSON.stringify(Date.now()));
const pf = await A("portfolio.overview", { today });
const rA = pf.rows.find((x) => x.client_id === cA.id || x.id === cA.id);
ok("the comparison uses only clients with a snapshot then", rA && pf.totals.ar_month_ago === 1000 && Math.abs(pf.totals.ar_comparable - rA.ar) < 0.01 && pf.totals.ar > pf.totals.ar_comparable, pf.totals);

S("Snapshots of a client with nothing open");
await sql("UPDATE claims SET state = 'closed' WHERE client_id = ?", cB.id);
await sql("DELETE FROM settings WHERE key = 'snap_at'");
await A("portfolio.overview", { today });
const snapDay = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const sB = await row("SELECT ar_balance, ar_claims FROM client_snapshots WHERE client_id = ? AND day = ?", cB.id, snapDay);
ok("today's AR row is written, at 0", sB && sB.ar_balance === 0 && sB.ar_claims === 0, sB);
const iB = await row("SELECT cells_json FROM inv_snapshots WHERE client_id = ? AND day = ?", cB.id, snapDay);
ok("and an empty inventory day", iB && iB.cells_json === "[]", iB);
const sNew = await row("SELECT 1 AS x FROM client_snapshots WHERE client_id = ?", cNew.id);
ok("a client with no claims yet gets none", !sNew);

S("Shastra feed down for a while is stale, not ok");
rig.liveEnv.SHASTRA_FEED_KEY = "k";
await put("live_sync", { at: now - 30 * 60000, fail_at: Date.now(), state: "error", error: "HTTP 500", rows: [{ e: "E1", st: "present" }] });
const hu = await A("team.huddle", { today });
ok("team.huddle says stale", hu.shastra_state === "stale", hu.shastra_state);
await put("live_sync", { at: Date.now(), rows: [] });
ok("a fresh read is ok", (await A("team.huddle", { today })).shastra_state === "ok");
delete rig.liveEnv.SHASTRA_FEED_KEY;

S("Hand-off TAT is the client's own");
await sql("UPDATE clients SET posting_tat_hours = 48 WHERE id = ?", cA.id);
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at) VALUES ('h23', ?, ?, 'posting', 'pending', ?, ?)", poolA[7], cA.id, now, now + 86400e3);
const hl = await A("handoffs.list", { dept: "posting", client_id: cA.id });
ok("handoffs.list: the client's 48 hours, on top and on the row", hl.tat_hours === 48 && hl.rows.find((x) => x.id === "h23").tat_hours === 48, [hl.tat_hours, (hl.rows[0] || {}).tat_hours]);
const hd = await A("handoffs.dashboard", { dept: "posting", client_id: cA.id });
ok("handoffs.dashboard: 48 hours", hd.tat_hours === 48 && !hd.tat_varies, [hd.tat_hours, hd.tat_varies]);
await sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at) VALUES ('h23b', ?, ?, 'posting', 'pending', ?, ?)", poolB[7], cB.id, now, now + 86400e3);
const hd2 = await A("handoffs.dashboard", { dept: "posting" });
ok("clients with different TATs: tat_varies", hd2.tat_varies === true, [hd2.tat_hours, hd2.tat_varies]);

S("Outside calls have a time limit");
ok("every outside fetch goes through fetchT (AbortSignal.timeout)", /AbortSignal\.timeout/.test(src) && !/await fetch\(/.test(src));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
