/* Suite 38: regression checks for the bug-test fixes in manage, the Shastra people link, escalations, team tasks and search
   (tester E's findings E-01 to E-21, D-12, and the earlier hunt's manage #12 and #13 as M-12 and M-13). Each section builds
   its own small world: the demo seed plus a made-up Shastra roster. Made-up data only. */
import fs from "fs";
import vm from "vm";
import { makeRig, REPO } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const baseFeed = () => [
  P({ emp_id: "V1", name: "Vera Vice", position: "Vice President", department: "All", function: "Management", email: "vera@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vera Vice", email: "mona@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Mona Manager", email: "lara@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sima Expert", position: "Subject Matter Expert", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "sima@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "bela@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cyra Agent", project: "Lakeview Dental Group", reports_to: "Lara Lead", email: "cyra@purview-healthcare.com" }),
  P({ emp_id: "PT", name: "Pia Postlead", position: "Team Lead", department: "Posting", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "pia@purview-healthcare.com" }),
  P({ emp_id: "PA", name: "Pavan Poster", department: "Posting", project: "Sunrise Eye Care", reports_to: "Pia Postlead", email: "pavan@purview-healthcare.com" }),
  P({ emp_id: "ST", name: "Suri Sublead", position: "Team Lead", department: "Submission", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "suri@purview-healthcare.com" }),
  P({ emp_id: "SB", name: "Sahil Submitter", department: "Submission", project: "Sunrise Eye Care", reports_to: "Suri Sublead", email: "sahil@purview-healthcare.com" })];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
/* A seeded rig with the roster synced. Worlds are used one after the other (the rig's fetch stand-in is process-wide). */
async function world({ feed = baseFeed() } = {}) {
  const st = { feed };
  const fetchMock = async (url) => {
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: st.feed });
    if (/brahmastra_(wfm|holidays|floor|live)/.test(url)) return J({ code: "PGRST202", message: "not set up" }, 404);
    return new Response("nope", { status: 500 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
  const { as, tryOp, sha } = rig;
  const DB = rig.backend.env.DB;
  const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
  const row = async (q, ...a) => (await rows(q, ...a))[0];
  await rig.app.seedDemo(() => {});
  const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
  const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  const sync = () => tryOp(() => A("roster.syncShastra"));
  if (feed.length) await sync();
  const U = async (name) => row("SELECT * FROM users WHERE name = ? ORDER BY created_at", name);
  // first password (demo mode) and a signed-in session for someone from the roster
  const firstIn = async (name) => { const u = await U(name); await tryOp(async () => as(null)("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + u.email) })); return as((await login(u.email, "pw-" + u.email)).token); };
  const cl = (await A("clients.list")).clients;
  const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return { rig, as, T: tryOp, sha, DB, sql, rows, row, A, sync, U, firstIn, login, st, today, sun: cl.find((c) => /Sunrise/.test(c.name)), lake: cl.find((c) => /Lakeview/.test(c.name)) };
}
const giveClaims = async (w, userId, n, clientId) => {
  const ids = (await w.rows("SELECT id FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT ?", clientId || w.sun.id, n)).map((r) => r.id);
  for (const id of ids) await w.sql("UPDATE claims SET assigned_to = ?, state = 'assigned', assigned_at = ? WHERE id = ?", userId, Date.now(), id);
  return ids;
};
const heldBy = async (w, userId) => (await w.row("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", userId)).n;

{
  S("E-01: a namesake from Shastra never takes over someone's account");
  let w = await world();
  await w.firstIn("Arun Agent");
  const arun = await w.U("Arun Agent");
  await giveClaims(w, arun.id, 3);
  // a second Arun (own Emp ID and email) joins Lakeview and is listed first (Shastra sorts by name only)
  const f = baseFeed(); f.splice(f.findIndex((r) => r.emp_id === "A1"), 0, P({ emp_id: "A9", name: "Arun Agent", project: "Lakeview Dental Group", reports_to: "Lara Lead", email: "arun.agent2@purview-healthcare.com" }));
  w.st.feed = f; let r = await w.sync();
  const mine = await w.row("SELECT emp_id, email, active, projects_json FROM users WHERE id = ?", arun.id);
  const other = await w.row("SELECT id, emp_id, email, active, pass_hash FROM users WHERE emp_id = 'A9'");
  ok("E-01: the first Arun keeps his Emp ID, email and project when a namesake is listed before him", r.ok && mine.emp_id === "A1" && mine.email === "arun@purview-healthcare.com" && mine.active === 1 && /Sunrise/.test(mine.projects_json), mine);
  ok("E-01: the newcomer gets an account of their own (no password yet)", other && other.id !== arun.id && other.email === "arun.agent2@purview-healthcare.com" && other.active === 1 && !other.pass_hash, other);
  ok("E-01: the first Arun's claims stay his, and his row is not skipped", (await heldBy(w, arun.id)) === 3 && !r.r.warnings.some((x) => x.skipped && /Arun/.test(x.name)), r.r && r.r.warnings);
  ok("E-01: he still signs in with his own email and password", (await w.T(() => w.login("arun@purview-healthcare.com", "pw-arun@purview-healthcare.com"))).ok);
  r = await w.sync();
  ok("E-01: the next sync changes nothing for either Arun", r.ok && r.r.summary.new === 0 && (await w.row("SELECT emp_id FROM users WHERE id = ?", arun.id)).emp_id === "A1", r.r && r.r.summary);

  // a person with no access (HR) with the biller's name, listed first, does not switch the biller off
  w = await world();
  const ar2 = await w.U("Arun Agent"); await giveClaims(w, ar2.id, 2);
  const f2 = baseFeed(); f2.splice(f2.findIndex((x) => x.emp_id === "A1"), 0, P({ emp_id: "H9", name: "Arun Agent", position: "Executive", department: "HR", function: "Administration", email: "arun.hr@purview-healthcare.com" }));
  w.st.feed = f2; r = await w.sync();
  const still = await w.row("SELECT active FROM users WHERE id = ?", ar2.id);
  ok("E-01: an HR namesake (no access) listed first does not switch the biller off or free their claims", r.ok && still && still.active === 1 && (await heldBy(w, ar2.id)) === 2, still);

  // a leaver's account is never handed to a new joiner with the same name
  w = await world();
  await w.firstIn("Arun Agent"); const gone = await w.U("Arun Agent");
  w.st.feed = baseFeed().filter((x) => x.emp_id !== "A1"); await w.sync();
  w.st.feed = [...baseFeed().filter((x) => x.emp_id !== "A1"), P({ emp_id: "A9", name: "Arun Agent", project: "Lakeview Dental Group", reports_to: "Lara Lead", email: "arun.new@purview-healthcare.com" })];
  r = await w.sync();
  const left = await w.row("SELECT emp_id, email, active FROM users WHERE id = ?", gone.id);
  const nj = await w.row("SELECT id, active, pass_hash FROM users WHERE emp_id = 'A9'");
  ok("E-01: the leaver's account stays switched off with their own Emp ID and email", r.ok && left.active === 0 && left.emp_id === "A1" && left.email === "arun@purview-healthcare.com", left);
  ok("E-01: the new joiner with the leaver's name gets a new account", nj && nj.id !== gone.id && nj.active === 1 && !nj.pass_hash, nj);
  ok("E-01: the leaver's old password does not sign in as the new joiner", !(await w.T(() => w.login("arun.new@purview-healthcare.com", "pw-arun@purview-healthcare.com"))).ok);
  // the same person coming back with the same Emp ID gets their own account back
  w.st.feed = baseFeed(); r = await w.sync();
  ok("E-01: a rejoin with the same Emp ID brings the same account back", r.ok && (await w.row("SELECT active FROM users WHERE id = ?", gone.id)).active === 1);

  // people with no Emp ID yet keep their account (matched by email, or by name when there is no email either)
  w = await world({ feed: [...baseFeed(), P({ name: "Nina Noid", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "nina@purview-healthcare.com" }), P({ name: "Omar Nomail", project: "Sunrise Eye Care", reports_to: "Tina Lead" })] });
  await w.firstIn("Nina Noid");
  const nina = await w.U("Nina Noid"), omar = await w.U("Omar Nomail");
  w.st.feed = [...baseFeed(), P({ emp_id: "N1", name: "Nina Noid", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "nina@purview-healthcare.com" }), P({ emp_id: "O1", name: "Omar Nomail", project: "Sunrise Eye Care", reports_to: "Tina Lead" })];
  r = await w.sync();
  const n2 = await w.row("SELECT id, emp_id, active FROM users WHERE name = 'Nina Noid'"), o2 = await w.rows("SELECT id, emp_id, active FROM users WHERE name = 'Omar Nomail'");
  ok("E-01: someone with no Emp ID yet keeps their account when Shastra gives them one (matched by email)", r.ok && n2.id === nina.id && n2.emp_id === "N1" && n2.active === 1, n2);
  ok("E-01: someone with no Emp ID and no email keeps their account by name and takes the Emp ID", o2.length === 1 && o2[0].id === omar.id && o2[0].emp_id === "O1" && o2[0].active === 1, o2);
  // an account made by hand (no Emp ID) still joins its roster row by name when Shastra has no other email for it
  w = await world();
  const hand = (await w.A("users.save", { first_name: "Hana", last_name: "Hand", email: "hana@purview-healthcare.com", role: "user", designation: "Biller" })).user;
  w.st.feed = [...baseFeed(), P({ emp_id: "H1", name: "Hana Hand", project: "Sunrise Eye Care", reports_to: "Tina Lead" })];
  r = await w.sync();
  const hh = await w.rows("SELECT id, emp_id, email, source FROM users WHERE name = 'Hana Hand'");
  ok("E-01: a hand-made account with no Emp ID still joins its Shastra row by name (one account, Emp ID set)", r.ok && hh.length === 1 && hh[0].id === hand.id && hh[0].emp_id === "H1" && hh[0].source === "roster", hh);
  // ... but not when Shastra gives that name another email
  w = await world();
  const hand2 = (await w.A("users.save", { first_name: "Hana", last_name: "Hand", email: "hana@purview-healthcare.com", role: "user", designation: "Biller" })).user;
  w.st.feed = [...baseFeed(), P({ emp_id: "H1", name: "Hana Hand", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "hana.h@purview-healthcare.com" })];
  r = await w.sync();
  const hh2 = await w.row("SELECT email, emp_id, source FROM users WHERE id = ?", hand2.id);
  ok("E-01: a name alone does not join a row to an account with another email (the hand-made account is left as it was)", r.ok && hh2.email === "hana@purview-healthcare.com" && !hh2.emp_id && hh2.source !== "roster", hh2);
}

{
  S("E-02: a short Shastra answer changes nothing, also for a small team");
  const w = await world();
  const arun = await w.U("Arun Agent"); await giveClaims(w, arun.id, 3);
  const before = (await w.row("SELECT COUNT(*) AS n FROM users WHERE source = 'roster' AND active = 1")).n;
  w.st.feed = baseFeed().slice(0, 3);
  let r = await w.sync();
  const after = (await w.row("SELECT COUNT(*) AS n FROM users WHERE source = 'roster' AND active = 1")).n;
  ok("E-02: 3 people sent while 12 are active: refused, with the reason", !r.ok && r.e === "Shastra sent 3 people while 12 are active here, so nothing was changed.", r.e);
  ok("E-02: nobody is switched off and the biller keeps their claims", before === 12 && after === 12 && (await heldBy(w, arun.id)) === 3, { before, after });
  const card = JSON.parse((await w.row("SELECT value_json FROM settings WHERE key = 'shastra_sync'")).value_json);
  ok("E-02: the Roster card says why", card.ok === false && /nothing was changed/.test(card.error), card);
  w.st.feed = baseFeed().slice(0, 1); r = await w.sync();
  ok("E-02: one person sent reads '1 person'", !r.ok && /^Shastra sent 1 person while 12 are active here/.test(r.e), r.e);
  // half of the active people is not "under half", so it is applied
  w.st.feed = baseFeed().slice(0, 6); r = await w.sync();
  ok("E-02: exactly half (6 of 12) is applied", r.ok && (await w.row("SELECT COUNT(*) AS n FROM users WHERE source = 'roster' AND active = 1")).n === 6, r.e);
}

{
  S("E-03: someone Shastra moves off AR does not keep AR claims");
  const w = await world({ feed: baseFeed().map((r) => (r.emp_id === "A2" ? { ...r, also_in_departments: "Posting" } : r)) });
  const AR = await w.firstIn("Arun Agent"), TI = await w.firstIn("Tina Lead");
  const arun = await w.U("Arun Agent"), bela = await w.U("Bela Agent"), cyra = await w.U("Cyra Agent");
  await giveClaims(w, arun.id, 4); await giveClaims(w, bela.id, 2); await giveClaims(w, cyra.id, 2, w.lake.id);
  // Bela (AR, also in Posting) is on a posting hand-off; she moves to Posting only
  const hc = (await w.row("SELECT id FROM claims WHERE client_id = ? AND state = 'open' LIMIT 1", w.sun.id)).id;
  await w.sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, lead_id) VALUES ('ho-e03', ?, ?, 'posting', 'pending', ?, ?, ?)", hc, w.sun.id, Date.now(), Date.now() + 86400000, bela.id);
  w.st.feed = baseFeed().map((r) => (r.emp_id === "A1" ? { ...r, department: "Posting" } : r.emp_id === "A2" ? { ...r, department: "Posting" } : r.emp_id === "A3" ? { ...r, department: "Posting", also_in_departments: "AR" } : r));
  const r = await w.sync();
  const nx = await w.T(() => AR("queue.next", {}));
  ok("E-03: moved from AR to Posting: their 4 AR claims go back to the pool", r.ok && (await heldBy(w, arun.id)) === 0 && (await w.row("SELECT COUNT(*) AS n FROM claims WHERE assigned_to IS NULL AND state = 'open' AND client_id = ?", w.sun.id)).n > 0, r.e);
  ok("E-03: Work the next claim no longer hands them an AR claim", nx.ok && !nx.r.claim, nx);
  ok("E-03: AR plus Posting moved to Posting only: AR claims back too, the posting hand-off stays theirs", (await heldBy(w, bela.id)) === 0 && (await w.row("SELECT lead_id FROM handoffs WHERE id = 'ho-e03'")).lead_id === bela.id);
  ok("E-03: still on AR as an also-in department: they keep their claims", (await heldBy(w, cyra.id)) === 2);
  const ts = await TI("team.status", { from: w.today(), to: w.today(), today: w.today() });
  ok("E-03: the moved biller is no longer on the team lead's Team status (their claims are in the pool, not stuck with them)", !ts.rows.some((x) => x.id === arun.id), ts.rows.map((x) => x.name));
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
