// shared set-up for the QA2 suites (inventory uploads and allocation). Made-up people and data only.
import { makeRig } from "./rig.mjs";
export const results = []; let section = "";
export const S = (n) => { section = n; console.log("\n## " + n); };
export const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 700))); };
export const done = () => { const p = results.filter((r) => r.pass).length; console.log(`\n==== ${p} passed, ${results.length - p} failed of ${results.length}`); process.exit(0); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
export const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project) => P({ emp_id, name, project, reports_to: lead, email: mail(name) });
export const SUN_B = ["Arun Agent", "Bela Agent", "Cy Agent", "Dee Agent", "Eli Agent", "Fay Agent"], LAKE_B = ["Dev Agent", "Eve Agent"];
export const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  ...SUN_B.map((n, i) => AG("A" + (i + 1), n, "Tina Lead", SUN)), ...LAKE_B.map((n, i) => AG("L" + (i + 1), n, "Leo Lead", LAKE)),
];
export async function setup() {
  const fetchMock = async (url) => {
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
    if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
    if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
    return new Response("nope", { status: 500 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
  const { as, sha, app } = rig; const DB = rig.backend.env.DB;
  const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
  const q1 = async (s, ...a) => (await q(s, ...a))[0];
  const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
  await app.seedDemo(() => {});
  const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
  const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  await A("roster.syncShastra");
  const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id; const NAME = (id) => (users.find((u) => u.id === id) || {}).name;
  const TOK = {};
  for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); TOK[f.name] = (await login(f.email, "pw-" + f.email)).token; }
  const TI = as(TOK["Tina Lead"]), LE = as(TOK["Leo Lead"]);
  const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN), lake = clients.find((c) => c.name === LAKE);
  const downtown = sun.locations.find((l) => l.name === "Downtown"), westside = sun.locations.find((l) => l.name === "Westside");
  let SEQ = 0; const made = (prefix, n, o = {}) => { const base = 7300000 + (SEQ++) * 100000; return Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(base + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (i + 1),
    payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", cpt: "99213", ...o }; }); };
  const wipe = async (cid) => { for (const t of ["claim_events", "notes"]) await sql(`DELETE FROM ${t} WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)`, cid); await sql("DELETE FROM claims WHERE client_id = ?", cid); await sql("DELETE FROM attendance"); await sql("UPDATE users SET assign_per_day = NULL"); };
  const upload = async (who, cid, locId, rows, kind = "fresh", extra = {}) => { app.setToken(TOK[who]); return app.uploadClaims({ client_id: cid, location_id: locId || null, kind, file_name: "qa.xlsx", claims: rows, summary: {}, rows_read: rows.length, ...extra }); };
  const clientOf = async (who, c) => (await as(TOK[who])("clients.list")).clients.find((x) => x.id === c.id);
  const alloc = async (who, c, loc) => { const cl = await clientOf(who, c); app.setToken(TOK[who]); return app.autoAllocate({ client: cl, loc: loc || null }); };
  const mine = async (name, cid) => (await q("SELECT id, claim_no, priority, state FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')" + (cid ? " AND client_id = ?" : ""), U(name), ...(cid ? [cid] : [])));
  const ready = async (who) => ((await as(TOK[who])("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 })).ready || {}).n || 0;
  const counts = async (cid) => Object.fromEntries((await q("SELECT state, COUNT(*) n FROM claims WHERE client_id = ? GROUP BY state", cid)).map((r) => [r.state, r.n]));
  const setTeam = async (c, names, loc) => (loc ? TI("clients.saveTeam", { location_id: loc.id, team: names.map(U) }) : A("clients.saveTeam", { client_id: c.id, team: names.map(U) }));
  const setTarget = (cid, ar) => sql("UPDATE clients SET targets_json = ? WHERE id = ?", JSON.stringify(ar ? { ar } : {}), cid);
  const setCap = (name, n) => sql("UPDATE users SET capacity = ? WHERE id = ?", n, U(name));
  const setOwn = (name, n) => sql("UPDATE users SET assign_per_day = ? WHERE id = ?", n, U(name));
  const today = async (who, c, loc) => (await as(TOK[who])("team.today", { client_id: c.id, location_id: loc ? loc.id : undefined })).members;
  return { rig, app, as, sha, DB, q, q1, sql, A, TI, LE, TOK, U, NAME, sun, lake, downtown, westside, made, wipe, upload, alloc, mine, ready, counts, setTeam, setTarget, setCap, setOwn, today, clientOf, users };
}
