/* Shared set-up for the QA1 people / access / teams checks (made-up people and data only). */
import { makeRig } from "./rig.mjs";
export const results = []; let section = "";
export const S = (n) => { section = n; console.log("\n## " + n); };
export const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 700))); };
export const finish = () => { const failed = results.filter((x) => !x.pass); console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`); for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name); process.exit(failed.length ? 1 : 0); };
export const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
export const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
export const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
export const AG = (emp_id, name, lead, project, extra = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...extra });
export const parseTeam = (t) => { try { const v = JSON.parse(t || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
export async function boot(FEED, { envExtra = {}, seed = true } = {}) {
  const fetchMock = async (url) => {
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
    if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
    if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
    return new Response("nope", { status: 500 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), ...envExtra }, fetchMock });
  const { as, sha, app } = rig; const DB = rig.backend.env.DB;
  const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results; const q1 = async (s, ...a) => (await q(s, ...a))[0];
  const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
  if (seed) await app.seedDemo(() => {});
  const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
  const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  const sync = () => A("roster.syncShastra");
  await sync();
  const env = { rig, as, sha, app, DB, q, q1, sql, A, sync, FEED, TOK: {}, login };
  env.users = async () => (await A("users.list")).users;
  env.U = async (n) => (await q1("SELECT id FROM users WHERE name = ?", n) || {}).id;
  env.tokens = async (names) => { for (const f of FEED) { if (names && !names.includes(f.name)) continue; if (env.TOK[f.name]) continue; const id = await env.U(f.name); if (!id) continue; await as(null)("auth.firstPassword", { user_id: id, passHash: await sha("pw-" + f.email) }); const r = await login(f.email, "pw-" + f.email); env.TOK[f.name] = r.token; } };
  env.AS = (n) => as(env.TOK[n]);
  env.team = async (cid) => parseTeam((await q1("SELECT team_json FROM clients WHERE id = ?", cid)).team_json);
  env.locTeam = async (lid) => parseTeam((await q1("SELECT team_json FROM locations WHERE id = ?", lid)).team_json);
  env.client = async (name) => await q1("SELECT * FROM clients WHERE name = ?", name);
  env.mkClient = async (name, locs = ["Main"], lead) => { const sup = lead || (await q1("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'")).id;
    await A("clients.save", { name, code: name.slice(0, 3).toUpperCase(), follow_up_days: 30, active: true, locations: locs, profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: sup } } } }); return await env.client(name); };
  env.made = (prefix, n, off = 0) => Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(7300000 + off + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: "Testpatient, " + prefix + (off + i + 1),
    payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", cpt: "99213" }; });
  /* upload n claims as `by` (a name with a token) to a client/location, then allocate them with the page's own autoAllocate */
  env.load = async (by, cid, lid, prefix, n, off = 0) => { app.setToken(env.TOK[by] || undefined); return app.uploadClaims({ client_id: cid, location_id: lid, kind: "fresh", file_name: prefix + ".xlsx", claims: env.made(prefix, n, off), summary: {}, rows_read: n }); };
  env.alloc = async (by, cid, lid) => { app.setToken(env.TOK[by]); const cl = (await env.AS(by)("clients.list")).clients.find((c) => c.id === cid); const loc = cl.locations.find((l) => l.id === lid); return app.autoAllocate({ client: cl, loc }); };
  env.ready = async (who) => { const r = await env.AS(who)("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 }); return r; };
  return env;
}
