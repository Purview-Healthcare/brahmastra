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

/* A new client of Tina's with every part of the profile: AR, Payment posting and Submission (the people from the roster). */
const profileOf = async (w, tat, over = {}) => {
  const id = async (n) => (await w.U(n)).id;
  return { scope: ["ar", "posting", "submission"], targets: { ar: 40 }, tat, resp: { ar: { lead: await id("Tina Lead") }, posting: { lead: await id("Pavan Poster") }, submission: { lead: await id("Sahil Submitter") }, subcheck: { mode: "biller" } }, ...over };
};
{
  S("E-04: a TAT change is kept in the client's change history");
  const w = await world();
  const TI = await w.firstIn("Tina Lead");
  const nc = (await TI("clients.save", { name: "Tat Clinic", code: "TC", follow_up_days: 30, active: true, locations: ["Main"], profile: await profileOf(w, { posting: 24, submission: 24, subcheck: 48 }) })).client.id;
  const h0 = (await TI("clients.history", { client_id: nc })).rows.length;
  const r = await w.T(async () => TI("clients.save", { id: nc, name: "Tat Clinic", code: "TC", follow_up_days: 30, active: true, profile: await profileOf(w, { posting: 8, submission: 72, subcheck: 48 }) }));
  const h = (await TI("clients.history", { client_id: nc })).rows;
  const said = h.slice(0, h.length - h0).map((x) => x.detail).join(" | ");
  ok("E-04: the TATs are saved and the change history gets a line for it", r.ok && h.length === h0 + 1, { e: r.e, said });
  ok("E-04: Payment posting TAT 24 -> 8 shows with what it was", /Payment posting: in scope, Pavan Poster, TAT 8 working hours\s+\(was: in scope, Pavan Poster, TAT 24 working hours\)/.test(said), said);
  ok("E-04: Submission TAT 24 -> 72 shows with what it was", /Submission: in scope, Sahil Submitter, TAT 72 working hours\s+\(was: in scope, Sahil Submitter, TAT 24 working hours\)/.test(said), said);
  const created = h[h.length - 1].detail;
  ok("E-04: the line made when the client was added names the TATs too", /Payment posting: in scope, Pavan Poster, TAT 24 working hours/.test(created), created);
}

{
  S("E-05: client names and a client's location names are one of a kind (case and extra spaces do not count)");
  const w = await world();
  const { A, T, sun, lake } = w;
  const same = async (n) => (await w.rows("SELECT id FROM clients")).length;
  const n0 = await same();
  let r = await T(() => A("clients.save", { id: lake.id, name: "Sunrise Eye Care", code: lake.code, follow_up_days: 30, active: true }));
  ok("E-05: renaming a client to another client's name is refused", !r.ok && r.e === "A client with that name already exists.", r);
  r = await T(() => A("clients.save", { id: lake.id, name: "  sunrise   EYE care ", code: lake.code, follow_up_days: 30, active: true }));
  ok("E-05: also with other case and extra spaces", !r.ok && /already exists/.test(r.e), r);
  r = await T(() => A("clients.save", { id: lake.id, name: "LAKEVIEW Dental  Group", code: lake.code, follow_up_days: 30, active: true }));
  ok("E-05: a client can still change the case of its own name", r.ok && (await w.row("SELECT name FROM clients WHERE id = ?", lake.id)).name === "LAKEVIEW Dental  Group", r.e);
  await A("clients.save", { id: lake.id, name: "Lakeview Dental Group", code: lake.code, follow_up_days: 30, active: true });
  r = await T(async () => A("clients.save", { name: "Sunrise  Eye Care", code: "X", follow_up_days: 30, active: true, locations: ["Main"], profile: await profileOf(w, { posting: 24, submission: 24, subcheck: 48 }) }));
  ok("E-05: adding a client whose name differs only by spaces is refused", !r.ok && /already exists/.test(r.e) && (await same()) === n0, r);
  r = await T(async () => A("clients.save", { name: "Hill Clinic", code: "HC", follow_up_days: 30, active: true, locations: ["Main St", "main  st", "MAIN ST", "Annex"], profile: await profileOf(w, { posting: 24, submission: 24, subcheck: 48 }) }));
  const hl = r.ok ? (await w.rows("SELECT name FROM locations WHERE client_id = ? ORDER BY name", r.r.client.id)).map((x) => x.name) : [];
  ok("E-05: a new client's locations are kept once each (case and spaces ignored)", r.ok && JSON.stringify(hl) === JSON.stringify(["Annex", "Main St"]), { e: r.e, hl });
  const locs = await w.rows("SELECT id, name FROM locations WHERE client_id = ? ORDER BY name", sun.id);   // Downtown, Westside
  r = await T(() => A("locations.save", { id: locs[1].id, name: "DOWNTOWN", active: true }));
  ok("E-05: renaming a location to another location's name of the client is refused", !r.ok && r.e === "That location already exists for this client.", r);
  r = await T(() => A("locations.save", { client_id: lake.id, name: "  main   STREET " }));
  ok("E-05: adding a location that differs only by case or spaces is refused", !r.ok && r.e === "That location already exists for this client.", r);
  r = await T(() => A("locations.save", { id: locs[1].id, name: "Westside North", active: true }));
  const r3 = await T(() => A("locations.save", { id: locs[1].id, name: "westside north", active: false }));
  ok("E-05: a location can still be renamed, switched off or change its own case", r.ok && r3.ok && (await w.row("SELECT name, active FROM locations WHERE id = ?", locs[1].id)).active === 0, [r.e, r3.e]);
  // the same location name under another client is fine
  r = await T(() => A("locations.save", { client_id: lake.id, name: "Downtown" }));
  ok("E-05: another client may have a location of the same name", r.ok, r.e);
  // two clients that already share a name (from before) can still be edited and renamed apart
  await w.sql("INSERT INTO clients (id, name, code, active, follow_up_days, created_at) VALUES ('dup-old', 'Lakeview dental group', '', 1, 30, ?)", Date.now());
  r = await T(() => A("clients.save", { id: "dup-old", name: "Lakeview dental group", code: "", follow_up_days: 14, active: true }));
  const r4 = await T(() => A("clients.save", { id: "dup-old", name: "Lakeview Dental Annex", code: "", follow_up_days: 14, active: true }));
  ok("E-05: an old same-name pair is not locked: it saves, and can be renamed apart", r.ok && r4.ok, [r.e, r4.e]);
}

{
  S("M-13: a client or location save keeps what it does not send");
  const w = await world();
  const { A, T, sun } = w;
  const get = (id) => w.row("SELECT name, code, active, follow_up_days FROM clients WHERE id = ?", id);
  await A("clients.save", { id: sun.id, name: sun.name, code: "SEC", follow_up_days: 21, active: false });
  let r = await T(() => A("clients.save", { id: sun.id, name: sun.name }));
  let c = await get(sun.id);
  ok("M-13: a save with only the name keeps the code, Active (off) and the follow-up days", r.ok && c.code === "SEC" && c.active === 0 && c.follow_up_days === 21, { e: r.e, c });
  r = await T(() => A("clients.save", { id: sun.id, follow_up_days: 9 }));
  c = await get(sun.id);
  ok("M-13: a save with only the follow-up days keeps the name", r.ok && c.name === sun.name && c.follow_up_days === 9 && c.code === "SEC", { e: r.e, c });
  r = await T(() => A("clients.save", { id: sun.id, name: sun.name, code: "", follow_up_days: 30, active: true }));
  c = await get(sun.id);
  ok("M-13: what is sent still changes: an empty code clears it, Active on switches it on", r.ok && c.code === "" && c.active === 1 && c.follow_up_days === 30, { e: r.e, c });
  r = await T(() => A("clients.save", { id: sun.id, name: "  " }));
  ok("M-13: an empty name is still refused", !r.ok && r.e === "Give the client a name.", r);
  const loc = await w.row("SELECT id, name FROM locations WHERE client_id = ? ORDER BY name LIMIT 1", sun.id);
  await A("locations.save", { id: loc.id, name: loc.name, active: false });
  r = await T(() => A("locations.save", { id: loc.id, name: loc.name }));
  const l1 = await w.row("SELECT name, active FROM locations WHERE id = ?", loc.id);
  ok("M-13: a location save without Active keeps it switched off", r.ok && l1.active === 0, { e: r.e, l1 });
  r = await T(() => A("locations.save", { id: loc.id, active: true }));
  const l2 = await w.row("SELECT name, active FROM locations WHERE id = ?", loc.id);
  ok("M-13: a location save without a name keeps its name", r.ok && l2.name === loc.name && l2.active === 1, { e: r.e, l2 });
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
