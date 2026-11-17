/* Suite 55: Start fresh for a client (the owner's ask: "delete already available inventory and comments for a client, we will
   be starting fresh"). The admin clears one client's inventory and the work on it and keeps its setup; nobody else can; the
   other clients are untouched; a new upload starts clean. A stand-in for Purview Shastra's roster; made-up people and data. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE),
  AG("D1", "Paula Post", "Tina Lead", SUN, { department: "Posting" }), AG("S1", "Sam Sub", "Tina Lead", SUN, { department: "Submission" }),
];
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const app = rig.app;
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const q1 = async (s, ...a) => (await q(s, ...a))[0];
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {}, R = {};
for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); TOK[f.name] = (await login(f.email, "pw-" + f.email)).token; R[f.name] = as(TOK[f.name]); }
const TI = R["Tina Lead"], LEO = R["Leo Lead"], AR = R["Arun Agent"], DEV = R["Dev Agent"];
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN), lake = clients.find((c) => c.name === LAKE);
const FOLLOW = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal, check again later" } };
const SUBMIT = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the payer portal, resubmitting" } };
await A("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Paula Post") });
await A("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Sam Sub") });
const poolOf = async (n, clientId) => (await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL ORDER BY id LIMIT ?", clientId, n)).map((x) => x.id);
const give = (ids, who, by, clientId) => by("alloc.apply", { client_id: clientId, strategy: "smart", assignments: ids.map((id) => ({ id, user_id: U(who), priority: 50, tier: "Medium" })) });
const made = (prefix, n) => Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(7500000 + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (i + 1),
  payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", cpt: "99213" }; });

// ---- each client gets the same kinds of work: an upload, entries, a hand-off, and rows in every per-client table ----
const workOn = async (client, lead, biller, prefix) => {
  app.setToken(TOK[lead === TI ? "Tina Lead" : "Leo Lead"]);
  await app.uploadClaims({ client_id: client.id, location_id: null, kind: "fresh", file_name: prefix + " inventory.xlsx", claims: made(prefix, 6), summary: {}, rows_read: 6 });
  const ids = await poolOf(3, client.id); await give(ids, biller === AR ? "Arun Agent" : "Dev Agent", lead, client.id);
  await biller("queue.open", { id: ids[0] }); await biller("queue.complete", { id: ids[0], ...FOLLOW, desk: true });
  await biller("queue.open", { id: ids[1] }); await biller("queue.complete", { id: ids[1], ...(client === sun ? SUBMIT : FOLLOW), desk: true });
  const now = Date.now(), day = new Date(now + 330 * 60000).toISOString().slice(0, 10);
  await sql("INSERT INTO escalations (id, client_id, sr, day, dept, created_at) VALUES (?,?,?,?,?,?)", "esc-" + prefix, client.id, 1, day, "AR", now);
  await sql("INSERT OR IGNORE INTO inv_snapshots (client_id, day, cells_json, at) VALUES (?,?,?,?)", client.id, day, "[]", now);
  await sql("INSERT OR IGNORE INTO client_snapshots (client_id, day, at) VALUES (?,?,?)", client.id, day, now);
  await sql("INSERT INTO user_notices (id, user_id, at, text, view, client_id) VALUES (?,?,?,?,?,?)", "nt-" + prefix, U("Tina Lead"), now, "A line about this client", "clients", client.id);
  await sql("INSERT INTO tat_holds (id, kind, ref_id, client_id, claim_id, since, reason, until, at) VALUES (?,?,?,?,?,?,?,?,?)", "hold-" + prefix, "handoff", "h-" + prefix, client.id, ids[1], now, "Waiting on the client", day, now);
  await sql("INSERT INTO detail_uploads (id, client_id, created_at) VALUES (?,?,?)", "du-" + prefix, client.id, now);
  await sql("INSERT INTO attachments (id, claim_id, user_id, user_name, name, type, size, parts, created_at) VALUES (?,?,?,?,?,?,?,?,?)", "att-" + prefix, ids[0], U(biller === AR ? "Arun Agent" : "Dev Agent"), "", "EOB.pdf", "application/pdf", 10, 1, now);
  await sql("INSERT INTO attachment_parts (attachment_id, seq, data) VALUES (?,?,?)", "att-" + prefix, 0, "JVBERi0=");
};
await workOn(sun, TI, AR, "SF1");
await workOn(lake, LEO, DEV, "SF2");
// some setup to keep: a share, RACI, an insurance limit, a note template, a call-log line
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "view" });
await sql("INSERT INTO raci (client_id, r_json) VALUES (?, ?) ON CONFLICT (client_id) DO NOTHING", sun.id, JSON.stringify([{ id: U("Tina Lead"), name: "Tina Lead" }]));
await sql("INSERT INTO payer_limits (client_id, payer_key, payer, tfl_days, updated_at) VALUES (?,?,?,?,?)", sun.id, "aetna", "Aetna", 90, Date.now());
await sql("INSERT INTO note_templates (id, client_id, title, text, by_name, at) VALUES (?,?,?,?,?,?)", "tpl-sf", sun.id, "Called payer", "Called the payer", "Tina Lead", Date.now());
await TI("client.logAdd", { client_id: sun.id, kind: "call", text: "Spoke with the clinic about the new file" });

const PER_CLAIM = ["notes", "attachments", "claim_events"];
const PER_CLIENT = ["claims", "handoffs", "tat_holds", "escalations", "detail_uploads", "inv_snapshots", "client_snapshots", "user_notices", "batches", "allocations"];
const counts = async (cid) => { const o = {};
  for (const t of PER_CLAIM) o[t] = (await q1(`SELECT COUNT(*) AS n FROM ${t} WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)`, cid)).n;
  for (const t of PER_CLIENT) o[t] = (await q1(`SELECT COUNT(*) AS n FROM ${t} WHERE client_id = ?`, cid)).n;
  return o; };
const setupOf = async (cid) => ({
  client: !!(await q1("SELECT id FROM clients WHERE id = ?", cid)),
  locations: (await q1("SELECT COUNT(*) AS n FROM locations WHERE client_id = ?", cid)).n,
  team: (await q1("SELECT team_json FROM clients WHERE id = ?", cid)).team_json,
  posting: (await q1("SELECT posting_mode, posting_lead FROM clients WHERE id = ?", cid)),
  shares: (await q1("SELECT COUNT(*) AS n FROM client_access WHERE client_id = ?", cid)).n,
  raci: (await q1("SELECT COUNT(*) AS n FROM raci WHERE client_id = ?", cid)).n,
  limits: (await q1("SELECT COUNT(*) AS n FROM payer_limits WHERE client_id = ?", cid)).n,
  templates: (await q1("SELECT COUNT(*) AS n FROM note_templates WHERE client_id = ?", cid)).n,
  calllog: (await q1("SELECT COUNT(*) AS n FROM client_log WHERE client_id = ?", cid)).n,
});
const sunBefore = await counts(sun.id), lakeBefore = await counts(lake.id), setBefore = await setupOf(sun.id);

S("Set-up");
ok("Sunrise has claims, entries, a file, a hand-off, uploads, allocations and a row in every per-client table", Object.values(sunBefore).every((n) => n > 0), sunBefore);
ok("so has Lakeview (the client that must stay as it is)", lakeBefore.claims > 0 && lakeBefore.notes > 0 && lakeBefore.batches > 0 && lakeBefore.escalations > 0, lakeBefore);

S("Who may start a client fresh");
const notAdmin = await tryOp(() => TI("clients.startFresh", { id: sun.id, confirm: SUN }));
ok("a team lead of the client cannot (only the admin)", !notAdmin.ok && /Only the admin/.test(notAdmin.e), notAdmin);
const mgr = await tryOp(() => R["Mona Manager"]("clients.startFresh", { id: sun.id, confirm: SUN }));
ok("a manager cannot either", !mgr.ok && /Only the admin/.test(mgr.e), mgr);
const wrongName = await tryOp(() => A("clients.startFresh", { id: sun.id, confirm: "Sunrise" }));
ok("the admin must type the client's name exactly", !wrongName.ok && /Type the client's name exactly/.test(wrongName.e), wrongName);
const unknown = await tryOp(() => A("clients.startFresh", { id: "nope", confirm: SUN }));
ok("an unknown client is refused", !unknown.ok && /Unknown client/.test(unknown.e), unknown);
ok("nothing was cleared by the refused tries", JSON.stringify(await counts(sun.id)) === JSON.stringify(sunBefore));

S("Start fresh: Sunrise's inventory and the work on it are cleared");
const r = await A("clients.startFresh", { id: sun.id, confirm: "  sunrise eye care " });
ok("the answer counts what went: claims, notes and comments, uploads", r.ok && r.name === SUN && r.claims === sunBefore.claims && r.notes === sunBefore.notes && r.uploads === sunBefore.batches, [r, sunBefore]);
const sunAfter = await counts(sun.id);
ok("every claim, note, file, history line, hand-off, hold, escalation, upload, allocation, detail upload, snapshot and bell line of Sunrise is gone", Object.values(sunAfter).every((n) => n === 0), sunAfter);
ok("no file part, note or history line is left without its claim", (await q1("SELECT COUNT(*) AS n FROM attachment_parts WHERE attachment_id = 'att-SF1'")).n === 0 && (await q1("SELECT COUNT(*) AS n FROM attachment_parts WHERE attachment_id = 'att-SF2'")).n === 1 && (await q1("SELECT COUNT(*) AS n FROM notes WHERE claim_id NOT IN (SELECT id FROM claims)")).n === 0 && (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id NOT IN (SELECT id FROM claims)")).n === 0);
ok("Lakeview is exactly as it was", JSON.stringify(await counts(lake.id)) === JSON.stringify(lakeBefore), [await counts(lake.id), lakeBefore]);
const setAfter = await setupOf(sun.id);
ok("Sunrise's setup is kept: the client, locations, team, responsible people, shares, RACI, insurance limits, note templates, call log", JSON.stringify(setAfter) === JSON.stringify(setBefore), [setAfter, setBefore]);
const au = await q1("SELECT user_name, action, client_id, detail FROM audit_log WHERE action = 'client.startFresh' ORDER BY at DESC LIMIT 1");
ok("the audit trail (and so the client's change history) says who, which client and how much", au && au.client_id === sun.id && /started fresh: \d+ claims, \d+ notes and comments, \d+ uploads cleared; its setup kept/.test(au.detail), au);
const hist = await A("clients.history", { client_id: sun.id });
ok("the client's Change history shows it", hist.rows.some((x) => x.action === "client.startFresh"));
ok("Arun's list has nothing of Sunrise left", (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ?", U("Arun Agent"))).n === 0 && (await AR("queue.summary", {})).ready.n === 0);

S("A new file for Sunrise starts clean");
app.setToken(TOK["Tina Lead"]);
const up = await app.uploadClaims({ client_id: sun.id, location_id: null, kind: "fresh", file_name: "SF1 inventory.xlsx", claims: made("SF1", 6), summary: {}, rows_read: 6 });
ok("the same claims load again as new claims (none counted as already there)", up.inserted === 6 && !up.updated && !up.reopened, up);
const ups = (await q1("SELECT COUNT(*) AS n FROM batches WHERE client_id = ?", sun.id)).n;
ok("the upload history starts again with this one file", ups === 1, ups);

S("The page");
const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
ok("Start fresh shows only for the admin, next to Delete, and asks for the client's name", /me && me\.is_admin && <button[^\n]*>Start fresh<\/button>/.test(src) && /"Type " \+ fresh\.name \+ " to confirm"/.test(src) && /rpc\("clients\.startFresh"/.test(src));
ok("the audit trail has a plain label for it", /"client\.startFresh": "Started a client fresh/.test(src));

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
process.exit(failed.length ? 1 : 0);
