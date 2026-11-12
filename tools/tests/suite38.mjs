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
  // with the desk rule (D-08) a Posting person is refused AR work outright; either way no AR claim is handed out
ok("E-03: Work the next claim no longer hands them an AR claim", (nx.ok && !nx.r.claim) || (!nx.ok && /AR's work/.test(nx.e || "")), nx);
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

{
  S("M-12: a profile saved from an older copy never undoes someone else's change");
  const w = await world();
  const TI = await w.firstIn("Tina Lead");
  const tina = await w.U("Tina Lead"), pavan = await w.U("Pavan Poster"), pia = await w.U("Pia Postlead");
  const sunOf = async (who) => (await who("clients.list")).clients.find((c) => c.id === w.sun.id);
  await w.A("clients.save", { id: w.sun.id, name: w.sun.name, code: w.sun.code, follow_up_days: 30, active: true, profile: { scope: ["ar", "posting"], targets: { ar: 40 }, tat: { posting: 24 }, resp: { ar: { lead: tina.id }, posting: { lead: pavan.id } } } });
  const profileFrom = vm.runInContext("profileFrom", w.rig.app);
  // what ClientProfileForm sends for a client it opened (its own payload, from the page's code)
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("M-12: the profile form sends the client as it opened it (seen: its stamp)", /rpc\("clients\.save", \{[^}]*seen: client \? client\.stamp : undefined/.test(src));
  const formSave = (c, patch) => { const f = profileFrom(c); return { id: c.id, name: c.name, code: c.code, follow_up_days: c.follow_up_days, active: c.active, seen: c.stamp, profile: { scope: f.scope, targets: f.targets, tat: f.tat, resp: f.resp }, ...patch }; };
  const opened = await sunOf(w.A);
  ok("M-12: clients.list gives each client a stamp", typeof opened.stamp === "string" && opened.stamp.length > 3, opened.stamp);
  await TI("clients.saveResponsibility", { client_id: w.sun.id, dept: "posting", mode: "person", lead: pia.id });   // the team lead changes the posting person
  let r = await w.T(() => w.A("clients.save", formSave(opened, { follow_up_days: 45 })));
  let now = await w.row("SELECT posting_lead, follow_up_days FROM clients WHERE id = ?", w.sun.id);
  ok("M-12: the admin's save from the older copy is refused with plain words", !r.ok && r.status === 409 && /Someone else changed this client after you opened it/.test(r.e), r);
  ok("M-12: the team lead's change stays and nothing of the stale save is applied", now.posting_lead === pia.id && now.follow_up_days === 30, now);
  const fresh = await sunOf(w.A);
  r = await w.T(() => w.A("clients.save", formSave(fresh, { follow_up_days: 45 })));
  now = await w.row("SELECT posting_lead, follow_up_days FROM clients WHERE id = ?", w.sun.id);
  ok("M-12: opened again, the same change saves and keeps the team lead's", r.ok && now.posting_lead === pia.id && now.follow_up_days === 45, { e: r.e, now });
  // two people opening the same copy: the first save goes through, the second is refused
  const c1 = await sunOf(w.A), c2 = await sunOf(TI);
  const s1 = await w.T(() => w.A("clients.save", formSave(c1, { code: "SUN" })));
  const s2 = await w.T(() => TI("clients.save", formSave(c2, { follow_up_days: 12 })));
  ok("M-12: of two people saving the same copy, the first saves and the second is told to reopen", s1.ok && !s2.ok && s2.status === 409 && (await w.row("SELECT code, follow_up_days FROM clients WHERE id = ?", w.sun.id)).code === "SUN", [s1.e, s2.e]);
  // a change the form does not hold (the client's billers) does not stop a profile save
  const c3 = await sunOf(w.A);
  await w.A("clients.saveTeam", { client_id: w.sun.id, team: [(await w.U("Arun Agent")).id] });
  r = await w.T(() => w.A("clients.save", formSave(c3, { follow_up_days: 20 })));
  ok("M-12: a change to the client's billers does not block a profile save", r.ok, r.e);
  // a caller that sends no stamp (an older page) saves as before
  r = await w.T(() => w.A("clients.save", { id: w.sun.id, name: w.sun.name, follow_up_days: 25 }));
  ok("M-12: a save without a stamp still saves", r.ok && (await w.row("SELECT follow_up_days FROM clients WHERE id = ?", w.sun.id)).follow_up_days === 25, r.e);
}

/* Sunrise with AR and Payment posting (Pavan, backup Pia), and a biller who sends one of their claims to Posting (Need to Post). */
const postingWorld = async ({ backup = true } = {}) => {
  const w = await world();
  const AR = await w.firstIn("Arun Agent");
  const tina = await w.U("Tina Lead"), pavan = await w.U("Pavan Poster"), pia = await w.U("Pia Postlead"), arun = await w.U("Arun Agent");
  await w.A("clients.save", { id: w.sun.id, name: w.sun.name, code: w.sun.code, follow_up_days: 30, active: true, profile: { scope: ["ar", "posting"], targets: { ar: 40 }, tat: { posting: 24 }, resp: { ar: { lead: tina.id }, posting: { lead: pavan.id, backup: backup ? pia.id : "" } } } });
  const c = await w.row("SELECT id, claim_no FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT 1", w.sun.id);
  await w.sql("UPDATE claims SET assigned_to = ?, state = 'assigned', assigned_at = ? WHERE id = ?", arun.id, Date.now(), c.id);
  await AR("attachments.add", { claim_id: c.id, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 made-up eob").toString("base64") });
  await AR("queue.complete", { id: c.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Payment-Cash In Bank" }, note: { source: "Portal", findings: "Paid per EOB, posting needed", action: "follow up" } });
  const h = await w.row("SELECT id, lead_id, backup_id FROM handoffs WHERE claim_id = ?", c.id);
  return { w, AR, pavan, pia, arun, claim: c, h };
};
{
  S("E-08: deleting a person moves their open hand-offs on, as switching them off does");
  let { w, pavan, pia, h } = await postingWorld();
  ok("E-08: the claim is on Pavan's posting desk, Pia the backup", h && h.lead_id === pavan.id && h.backup_id === pia.id, h);
  let r = await w.T(() => w.A("users.delete", { id: pavan.id }));
  const PI = await w.firstIn("Pia Postlead");
  const after = await w.row("SELECT lead_id, backup_id, status FROM handoffs WHERE id = ?", h.id);
  const row = (await PI("handoffs.list", {})).rows.find((x) => x.id === h.id);
  ok("E-08: after Delete the hand-off is Pia's (the backup)", r.ok && after.lead_id === pia.id && after.status === "pending", { e: r.e, after });
  ok("E-08: Pia sees it on her desk under her name", row && row.lead_name === "Pia Postlead", row);
  // the same as switching him off
  ({ w, pavan, pia, h } = await postingWorld());
  await w.A("users.save", { id: pavan.id, first_name: "Pavan", last_name: "Poster", designation: "Biller", role: "user", capacity: 35, active: false });
  const off = await w.row("SELECT lead_id FROM handoffs WHERE id = ?", h.id);
  ok("E-08: switching him off moves it the same way", off.lead_id === pia.id, off);
  // with no backup set, it stays where switching off leaves it too (for the team lead on the desk dashboard), and the account is gone
  ({ w, pavan, h } = await postingWorld({ backup: false }));
  r = await w.T(() => w.A("users.delete", { id: pavan.id }));
  ok("E-08: no backup: the delete still works and the account is gone", r.ok && !(await w.row("SELECT id FROM users WHERE id = ?", pavan.id)), r.e);
}

{
  S("E-09 and D-12: README says what the app does about accounts (only the admin adds or deletes; no sign-up, no self delete)");
  const readme = fs.readFileSync(REPO + "/README.md", "utf8").replace(/\s+/g, " ");
  const gone = [/a team lead deletes a team member/i, /Anyone can delete their own account/i, /Team leads\*\* create their own account/i, /Billers\*\* are created by a team lead/i, /open \*\*Team\*\* and create the billers/i, /Create a team lead account/i];
  ok("E-09/D-12: README no longer describes Delete my account, team lead sign-up, or team leads adding or deleting people", gone.every((re) => !re.test(readme)), gone.filter((re) => re.test(readme)).map(String));
  ok("E-09/D-12: README says only the admin deletes an account and people come from Purview Shastra", /only the admin deletes an account/.test(readme) && /nobody deletes their own account/.test(readme) && /People come from Purview Shastra/.test(readme) && /Only the admin can add someone by hand/.test(readme));
  const w = await world();
  const TI = await w.firstIn("Tina Lead"), AR = await w.firstIn("Arun Agent");
  const bela = await w.U("Bela Agent");
  const rs = [await w.T(() => TI("users.delete", { id: bela.id })), await w.T(() => AR("auth.deleteMyAccount", { confirm: "arun@purview-healthcare.com" })),
    await w.T(() => w.as(null)("auth.signup", { email: "x.y@purview-healthcare.com", first_name: "X", last_name: "Y", designation: "TL", passHash: "a".repeat(64) })),
    await w.T(() => TI("users.save", { first_name: "New", last_name: "Biller", email: "new.biller@purview-healthcare.com", role: "user" }))];
  ok("E-09/D-12: the app still refuses all four (nobody gained a right)", rs.every((r) => !r.ok), rs.map((r) => r.e));
  const me = (await w.A("auth.me")).user;
  const self = await w.T(() => w.A("users.delete", { id: me.id }));
  ok("E-09: the admin deleting their own account is told plainly (no Delete my account to point to)", !self.ok && self.e === "You can't delete your own account.", self.e);
  const otp = await w.T(() => w.as(null)("auth.sendOtp", { email: "nobody.here@purview-healthcare.com" }));
  ok("D-12: an email with no account points to the roster, not to a sign-up", !otp.ok && /Purview Shastra roster/.test(otp.e) && !/create a team lead account/i.test(otp.e), otp.e);
}

{
  S("E-11: a team task closes when everyone left on it has completed, also after Edit or reassign");
  const w = await world();
  const TI = await w.firstIn("Tina Lead"), AR = await w.firstIn("Arun Agent");
  const arun = (await w.U("Arun Agent")).id, bela = (await w.U("Bela Agent")).id;
  const mk = async () => (await TI("tasks.create", { client_id: w.sun.id, scope: "AR follow-up", title: "Work the client's list", description: "made up", source: "Client", tat: { kind: "24" }, count: 10, people: [{ user_id: arun, share: 5 }, { user_id: bela, share: 5 }] })).task.id;
  const tid = await mk();
  const ap = (await AR("tasks.mine", {})).rows.find((x) => x.task_id === tid).person_id;
  await AR("tasks.update", { person_id: ap, done: 5, status: "completed", comment: "" });
  const r = await w.T(() => TI("tasks.edit", { id: tid, people: [{ user_id: arun, share: 5 }] }));
  const t = (await TI("tasks.list", { view: "all" })).rows.find((x) => x.id === tid);
  const row = await w.row("SELECT status, closed_at, closed_by_name FROM team_tasks WHERE id = ?", tid);
  ok("E-11: taking off the only one who had not completed closes the task as done", r.ok && r.r.closed === true && row.status === "done" && row.closed_at && row.closed_by_name === "everyone completed their share", { r, row });
  ok("E-11: it is no longer open on the team lead's list", t && t.status !== "open", t && t.status);
  // an edit that leaves someone not completed keeps it open
  const tid2 = await mk();
  const r2 = await w.T(() => TI("tasks.edit", { id: tid2, title: "Work the client's list again" }));
  ok("E-11: an edit with people still to complete leaves the task open", r2.ok && !r2.r.closed && (await w.row("SELECT status FROM team_tasks WHERE id = ?", tid2)).status === "open", r2);
}

{
  S("E-12: deleting a client takes its team tasks and holds with it");
  const { w, AR, arun, h } = await postingWorld();
  const TI = await w.firstIn("Tina Lead");
  const t = (await TI("tasks.create", { client_id: w.sun.id, scope: "AR follow-up", title: "Work the client's list", description: "made up", source: "Client", tat: { kind: "24" }, count: 4, people: [{ user_id: arun.id, share: 4 }] })).task.id;
  const t2 = (await w.A("tasks.create", { client_id: w.lake.id, scope: "AR follow-up", title: "Another client's list", description: "made up", source: "Client", tat: { kind: "24" }, count: 2, people: [{ user_id: (await w.U("Cyra Agent")).id, share: 2 }] })).task.id;
  const pid = (await AR("tasks.mine", {})).rows.find((x) => x.task_id === t).person_id;
  await AR("tasks.update", { person_id: pid, done: 1, status: "in_progress", comment: "started on it", files: [{ name: "list.txt", type: "text/plain", data: Buffer.from("made-up list").toString("base64") }] });
  const file = await w.row("SELECT id FROM team_task_files WHERE task_id = ?", t);
  await w.sql("UPDATE team_tasks SET due_at = ? WHERE id = ?", Date.now() - 3600000, t);
  const hold = await w.T(() => w.A("tat.hold", { kind: "handoff", id: h.id, reason: "Other", note: "waiting on the clearinghouse", until: w.today() }));
  const n = async (q, ...a) => (await w.row(q, ...a)).n;
  const before = { tasks: await n("SELECT COUNT(*) AS n FROM team_tasks WHERE client_id = ?", w.sun.id), holds: await n("SELECT COUNT(*) AS n FROM tat_holds WHERE client_id = ?", w.sun.id), file: !!file };
  const r = await w.T(() => w.A("clients.delete", { id: w.sun.id, confirm: "Sunrise Eye Care" }));
  const after = { tasks: await n("SELECT COUNT(*) AS n FROM team_tasks WHERE client_id = ?", w.sun.id), people: await n("SELECT COUNT(*) AS n FROM team_task_people WHERE task_id = ?", t),
    updates: await n("SELECT COUNT(*) AS n FROM team_task_updates WHERE task_id = ?", t), files: await n("SELECT COUNT(*) AS n FROM team_task_files WHERE task_id = ?", t),
    parts: file ? await n("SELECT COUNT(*) AS n FROM attachment_parts WHERE attachment_id = ?", file.id) : 0, holds: await n("SELECT COUNT(*) AS n FROM tat_holds WHERE client_id = ?", w.sun.id) };
  ok("E-12: before the delete the client has a task with a file, and a hold", hold.ok && before.tasks === 1 && before.holds === 1 && before.file, { hold: hold.e, before });
  ok("E-12: after it, the task, its people, updates, files and file data are gone", r.ok && !after.tasks && !after.people && !after.updates && !after.files && !after.parts, { e: r.e, after });
  ok("E-12: the client's holds are gone too", !after.holds, after);
  const bell = (await AR("notify.list", { today: w.today() })).items.filter((x) => x.key.startsWith("task_late:"));
  ok("E-12: the biller's bell and My tasks no longer show it", !bell.length && !(await AR("tasks.mine", {})).rows.some((x) => x.task_id === t), bell);
  ok("E-12: another client's task stays", t2 && (await n("SELECT COUNT(*) AS n FROM team_tasks WHERE id = ?", t2)) === 1);
}

{
  S("E-14: Search finds the claims on a Payment posting or Submission person's desk");
  const { w, claim } = await postingWorld();
  const PA = await w.firstIn("Pavan Poster"), BE = await w.firstIn("Bela Agent"), SA = await w.firstIn("Sahil Submitter"), CY = await w.firstIn("Cyra Agent");
  // a made-up patient name of its own, so the search has one claim to find
  await w.sql("UPDATE claims SET patient = 'Quill, Zora' WHERE id = ?", claim.id);
  const patient = "Quill, Zora";
  const found = async (who, q) => (await who("search.global", { q })).claims.some((x) => x.id === claim.id);
  ok("E-14: the posting person finds the claim on their desk by its number", await found(PA, claim.claim_no));
  ok("E-14: and by the patient's name", await found(PA, patient));
  const lakeClaim = await w.row("SELECT id, claim_no FROM claims WHERE client_id = ? LIMIT 1", w.lake.id);
  ok("E-14: the posting person does not find another client's claim", !(await PA("search.global", { q: lakeClaim.claim_no })).claims.some((x) => x.id === lakeClaim.id));
  ok("E-14: another biller, a Submission person not on it, and another client's biller still find nothing", !(await found(BE, claim.claim_no)) && !(await found(SA, claim.claim_no)) && !(await found(CY, claim.claim_no)));
  const opened = await w.T(() => PA("claims.get", { id: claim.id }));
  ok("E-14: what Search finds, the person can open", opened.ok, opened.e);
}

{
  S("E-15: Load sample data makes three billers with the designation Biller");
  const w = await world({ feed: [] });
  const rows = await w.rows("SELECT name, role, designation FROM users WHERE email IN ('aisha@purview-healthcare.com','rohan@purview-healthcare.com','priya@purview-healthcare.com') ORDER BY name");
  ok("E-15: Aisha, Priya and Rohan are billers named Biller", rows.length === 3 && rows.every((r) => r.role === "user" && r.designation === "Biller"), rows);
  const isSmeUI = vm.runInContext("isSmeUI", w.rig.app);
  ok("E-15: the page does not take them for SMEs", rows.every((r) => !isSmeUI(r)));
}

{
  S("E-17: another team's lead cannot turn an every-client template into their own client's");
  const w = await world();
  const TI = await w.firstIn("Tina Lead"), LA = await w.firstIn("Lara Lead"), AR = await w.firstIn("Arun Agent");
  const g = (await TI("templates.save", { title: "For every client", text: "Called the payer, claim in process." })).id;
  const r = await w.T(() => LA("templates.save", { id: g, client_id: w.lake.id, title: "For every client", text: "Lara's text now." }));
  const row = await w.row("SELECT client_id, text, by_name FROM note_templates WHERE id = ?", g);
  ok("E-17: moving it to one client is refused with plain words", !r.ok && /This template is for every client/.test(r.e), r);
  ok("E-17: the template stays for every client with its own text", row.client_id === null && row.text === "Called the payer, claim in process.", row);
  ok("E-17: Sunrise's billers still see it", (await AR("templates.list", { client_id: w.sun.id })).rows.some((x) => x.id === g));
  const own = await w.T(() => LA("templates.save", { client_id: w.lake.id, title: "Lakeview only", text: "Lakeview's own wording here." }));
  ok("E-17: the lead can still add a new template for their own client", own.ok, own.e);
  const adm = await w.T(() => w.A("templates.save", { id: g, client_id: w.sun.id, title: "For every client", text: "Called the payer, claim in process." }));
  ok("E-17: someone who may change every client (the admin) can still move it", adm.ok && (await w.row("SELECT client_id FROM note_templates WHERE id = ?", g)).client_id === w.sun.id, adm.e);
}

{
  S("E-19: an escalation can be updated and closed after its responding person has left");
  const w = await world();
  const SI = await w.firstIn("Sima Expert");
  const tina = await w.U("Tina Lead"), lara = await w.U("Lara Lead"), bela = await w.U("Bela Agent");
  const base = { client_id: w.sun.id, kind: "external", day: w.today(), dept: "Account Receivable", raised_who: "Client office", reported_to: "Tina Lead", owner_id: tina.id, location_id: "all", channels: ["Email"], email_subject: "Claims not followed", description: "Made-up description here.", comment: "Looking into it", is_error: "Y", error_by_id: bela.id, error_dow: w.today() };
  const sr = (await SI("escalations.save", base)).sr;
  const e = await w.row("SELECT id FROM escalations WHERE sr = ? AND client_id = ?", sr, w.sun.id);
  // the responding person leaves (as the roster does) and whoever made the error is removed altogether
  await w.sql("UPDATE users SET active = 0 WHERE id = ?", tina.id);
  await w.sql("DELETE FROM users WHERE id = ?", bela.id);
  const c = await w.T(() => SI("escalations.save", { ...base, id: e.id, comment: "Client sent the records" }));
  const r = await w.T(() => SI("escalations.save", { ...base, id: e.id, status: "resolved", rca: "root cause found", corrective: "fixed the process", preventive: "added a check", close_on: w.today(), review_on: w.today(), rework: "Yes" }));
  const row = await w.row("SELECT status, owner_id, owner_name, error_by_name, comment FROM escalations WHERE id = ?", e.id);
  ok("E-19: a plain update keeps the responding person who left", c.ok, c.e);
  ok("E-19: closing works too, and the register keeps who it was at the time", r.ok && row.status === "resolved" && row.owner_id === tina.id && row.owner_name === "Tina Lead" && row.error_by_name === "Bela Agent", { e: r.e, row });
  const n = await w.T(() => SI("escalations.save", { ...base, owner_id: tina.id, is_error: "N", error_by_id: "" }));
  ok("E-19: a new escalation still needs someone active as the responding person", !n.ok && n.e === "Pick the responding person at Purview.", n);
  const m = await w.T(() => SI("escalations.save", { ...base, id: e.id, owner_id: lara.id, status: "open", is_error: "N", error_by_id: "" }));
  ok("E-19: the responding person can still be changed to someone active", m.ok && (await w.row("SELECT owner_name FROM escalations WHERE id = ?", e.id)).owner_name === "Lara Lead", m.e);
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("E-19: the form keeps that person in the responding-person list, marked no longer active", /owner_name: r\.owner_name/.test(src) && /form\.owner_name \+ " \(no longer active\)"/.test(src));
}

{
  S("E-13: an Assistant Vice President keeps that title and is not RACI's Vice President");
  const avp = (o) => P({ position: "Assistant Vice President", department: "All", function: "Management", reports_to: "Vera Vice", ...o });
  const f = [avp({ emp_id: "D1", name: "Avi Avp", email: "avi@purview-healthcare.com" }), ...baseFeed(),
    avp({ emp_id: "D2", name: "Asha Asstvp", position: "Asst. Vice President", email: "asha@purview-healthcare.com" }), avp({ emp_id: "D3", name: "Ajay Avp", position: "AVP", email: "ajay@purview-healthcare.com" })];
  let w = await world({ feed: f });
  const TI = await w.firstIn("Tina Lead");
  const who = async (n) => w.row("SELECT designation, access_all FROM users WHERE name = ?", n);
  const avs = [await who("Avi Avp"), await who("Asha Asstvp"), await who("Ajay Avp")], vera = await who("Vera Vice");
  ok("E-13: Assistant Vice President and Asst. Vice President keep the title Assistant Vice President", avs.slice(0, 2).every((u) => u && u.designation === "Assistant Vice President"), avs);
  ok("E-13: their access is as before (every project), and the Vice President is still the Vice President", avs.slice(0, 2).every((u) => u && u.access_all === 1) && vera.designation === "Vice President" && vera.access_all === 1, { avs, vera });
  ok("E-13: nobody gains access: the bare code AVP still gets none, as before", !avs[2], avs[2]);
  const L = await TI("raci.list", { today: w.today() });
  const row = L.rows.find((x) => x.client_id === w.sun.id);
  ok("E-13: RACI's VP is the Vice President, first in Informed", L.vp && L.vp.name === "Vera Vice" && row.i[0] && row.i[0].name === "Vera Vice", { vp: L.vp, i: row.i });
  const s = await TI("raci.save", { client_id: w.sun.id, r: row.r, a: row.a, c: row.c, i: [(await w.U("Avi Avp")).id] });
  ok("E-13: saving RACI keeps the Vice President first; the AVP can be the second Informed", s.row.i.map((x) => x.name).join(", ") === "Vera Vice, Avi Avp", s.row.i);
  const roleLabel = vm.runInContext("roleLabel", w.rig.app);
  ok("E-13: the page calls the AVP by their title, the VP Vice President", roleLabel({ access_all: true, designation: "Assistant Vice President", role: "supervisor" }) === "Assistant Vice President" && roleLabel({ access_all: true, designation: "Vice President", role: "supervisor" }) === "Vice President");
  // with no Vice President at all, an AVP does not take that place
  w = await world({ feed: [avp({ emp_id: "D1", name: "Avi Avp", reports_to: "", email: "avi@purview-healthcare.com" }), ...baseFeed().filter((x) => x.emp_id !== "V1").map((x) => (x.reports_to === "Vera Vice" ? { ...x, reports_to: "Avi Avp" } : x))] });
  const T2 = await w.firstIn("Tina Lead");
  const L2 = await T2("raci.list", { today: w.today() });
  ok("E-13: with no Vice President, RACI has no VP (the AVP is not put in that place)", L2.vp === null && !L2.rows.find((x) => x.client_id === w.sun.id).i.length, { vp: L2.vp });
}

{
  // The badges are drawn by the page's Shell (React), which this rig does not render: the page itself is checked by
  // fix-E/repro-E-20.js in a browser; here the count behind each badge and the page's badge rule are checked.
  S("E-20: the Live status tab carries the escalation count, not the whole Needs attention count");
  const w = await world();
  const TI = await w.firstIn("Tina Lead");
  await w.sql("UPDATE claims SET escalated = 0");
  const tk = await TI("tasks.create", { client_id: w.sun.id, scope: "AR follow-up", title: "Recheck the client list", description: "made up", source: "Client", tat: { kind: "24" }, count: 4, people: [{ user_id: (await w.U("Arun Agent")).id, share: 4 }] });
  await w.sql("UPDATE team_tasks SET due_at = ? WHERE id = ?", Date.now() - 3600000, tk.task.id);
  const at = await TI("attention.count", {});
  const strip = (await TI("notify.list", { today: w.today() })).items.filter((i) => i.key === "escalations" && i.n > 0);
  ok("E-20: one late team task counts on Needs attention but is no escalation (the Live status Needs you line shows none)", at.n === 1 && at.tasks_late === 1 && at.escalations === 0 && !strip.length, at);
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("E-20: the page gives the Live status tab the escalation count and Needs attention the attention count",
    /k === "attention" && attention && attention\.n > 0 \?/.test(src) && /k === "live" && attention && attention\.escalations > 0 \?[\s\S]{0,300}?\{attention\.escalations\}<\/span>/.test(src) && !/\(k === "attention" \|\| k === "live"\)/.test(src));
}

{
  // The chip and its dialog are page code (checked in a browser by the tester's repro-E-21.js and fix-E/page-E-21.js); here the rule.
  S("E-21: a location chip asks before switching a location off");
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("E-21: the chip asks first when the location is on, and switches it back on in one click", /const clickLoc = \(c, l\) => \(l\.active \? setLocOff\(/.test(src) && /onClick=\{c\.can_edit === false \? undefined : \(\) => clickLoc\(c, l\)\}/.test(src) && !/=> toggleLoc\(l\)\}>/.test(src));
  ok("E-21: the last active location says what switching it off means", /only active location of \$\{locOff\.client\}/.test(src) && /nothing reaches anyone/.test(src));
}

{
  S("E-16: a roster project never makes a client without its profile; Create opens the Add client setup");
  const f = baseFeed().map((r) => (r.emp_id === "S1" ? { ...r, also_on_projects: "Hillcrest Clinic" } : r.emp_id === "T1" ? { ...r, also_on_projects: "Hillcrest Clinic" } : r));
  const w = await world({ feed: f });
  const SI = await w.firstIn("Sima Expert"), TI = await w.firstIn("Tina Lead");
  const n0 = (await w.row("SELECT COUNT(*) AS n FROM clients")).n;
  const bySme = await w.T(() => SI("projects.map", { name: "Hillcrest Clinic", create: true, client_name: "Hillcrest Clinic" }));
  const byLead = await w.T(() => TI("projects.map", { name: "Hillcrest Clinic", create: true }));
  ok("E-16: the pop-up's old create is refused for an SME and a team lead, pointing to Add client", !bySme.ok && !byLead.ok && /Add client/.test(byLead.e) && (await w.row("SELECT COUNT(*) AS n FROM clients")).n === n0, [bySme.e, byLead.e]);
  const sme = await w.T(async () => SI("clients.save", { name: "Hillcrest Clinic", locations: ["Main"], profile: await profileOf(w, { posting: 24, submission: 24, subcheck: 48 }) }));
  ok("E-16: an SME still cannot add the client (Add client is for team leads and up)", !sme.ok && /team leads and above/.test(sme.e), sme.e);
  const add = await w.T(async () => TI("clients.save", { name: "Hillcrest Clinic", code: "HC", follow_up_days: 30, active: true, locations: ["Main"], profile: await profileOf(w, { posting: 24, submission: 24, subcheck: 48 }) }));
  const c = add.ok ? await w.row("SELECT id, roster_names_json FROM clients WHERE id = ?", add.r.client.id) : null;
  const au = c ? (await w.row("SELECT COUNT(*) AS n FROM audit_log WHERE client_id = ?", c.id)).n : 0;
  ok("E-16: the team lead adds it with its whole profile: the project is matched to it and the audit trail has it", add.ok && /Hillcrest Clinic/.test(c.roster_names_json) && au >= 1, { e: add.e, c, au });
  const again = await w.T(() => TI("projects.map", { name: "Hillcrest Clinic", client_id: c.id }));
  ok("E-16: matching the project to the client just made (what the page does after the setup) works", again.ok, again.e);
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  // the admin can still make one straight from a project through the API (test set-ups do): a new name only, in the audit trail
  const adm = await w.T(() => w.A("projects.map", { name: "Cedar Clinic", create: true, client_name: "Cedar Clinic" }));
  const dupe = await w.T(() => w.A("projects.map", { name: "Hillcrest Clinic", create: true, client_name: "hillcrest  CLINIC" }));
  // (the create and, since D-05, the project match each have an audit row)
  const ac = adm.ok ? (await w.row("SELECT COUNT(*) AS n FROM audit_log WHERE client_id = ?", adm.r.client_id)).n : 0;
  ok("E-16: the admin's own create through the API still works, is in the audit trail, and refuses a name another client has", adm.ok && ac >= 1 && !dupe.ok && /already exists/.test(dupe.e), { a: adm.e, ac, d: dupe.e });
  ok("E-16: the page opens the setup for Create, and SMEs are not offered it", /canCreate=\{!isSmeUI\(me\)\} onCreate=/.test(src) && /if \(make && onCreate\) onCreate\(make\)/.test(src) && !/create: true/.test(src) && /initialName=\{newFor\}/.test(src));
}

{
  // The upload wizard is page code (React) this rig does not render; the page itself is checked in a browser by
  // fix-E/repro-N-17.js. Here: the server answer the page relies on, and the page's rule.
  S("N-17: an upload never puts claims into a switched-off location");
  const w = await world();
  const west = await w.row("SELECT id, name FROM locations WHERE client_id = ? AND name = 'Westside'", w.sun.id);
  await w.A("locations.save", { id: west.id, name: west.name, active: false });
  const on = await w.T(() => w.A("locations.save", { id: west.id, name: west.name, active: true }));
  ok("N-17: switching a location back on answers with the location, on", on.ok && on.r.location.active === true && (await w.row("SELECT active FROM locations WHERE id = ?", west.id)).active === 1, on.e);
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("N-17: the upload reads the client's locations as they are now, not as the page loaded them", /const locsNow = \(\(await rpc\("clients\.list"\)\)\.clients\.find\(\(x\) => x\.id === client\.id\)/.test(src) && /loc = locsNow\.find\(/.test(src) && /groups\.push\(\{ loc: locsNow\.find\(\(l\) => l\.id === locId\)/.test(src));
  ok("N-17: a switched-off location that would receive claims is switched on again, and the result says so", /for \(const g of groups\) if \(g\.loc && !g\.loc\.active\) \{ const r = await rpc\("locations\.save", \{ id: g\.loc\.id, name: g\.loc\.name, active: true \}\)/.test(src) && /\$\{r\.note \? " \(" \+ r\.note \+ "\)" : ""\}/.test(src));
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
