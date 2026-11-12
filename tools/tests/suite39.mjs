/* Suite 39: regression checks for the bug-test fixes on access, sign-in and data safety (tester D's findings and E-06 / E-07).
   Each check carries the finding it guards. A made-up Shastra roster with every kind of person, a stand-in for Drishti that checks
   the token the way Drishti does, and a mail hook that only counts. Made-up data only. */
import crypto from "crypto";
import { makeRig } from "./rig.mjs";
process.setMaxListeners(50);   // one rig per world, each adds an exit listener
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
const D = "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const FEED = () => [
  P({ emp_id: "V1", name: "Vera Vice", position: "Vice President", email: "vera" + D }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vera Vice", email: "mona" + D }),
  P({ emp_id: "M2", name: "Milan Manager", position: "Manager", reports_to: "Vera Vice", email: "milan" + D }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: "tina" + D }),
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: SUN, reports_to: "Tina Lead", email: "sima" + D }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: LAKE, reports_to: "Milan Manager", email: "lara" + D }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", email: "arun" + D }),
  P({ emp_id: "A2", name: "Bela Agent", project: SUN, reports_to: "Tina Lead", email: "bela" + D }),
  P({ emp_id: "A3", name: "Cyra Agent", project: LAKE, reports_to: "Lara Lead", email: "cyra" + D }),
  // a biller on two projects: Tina's (Sunrise) and also Lara's (Lakeview)
  P({ emp_id: "A4", name: "Dev Agent", project: SUN, also_on_projects: LAKE, reports_to: "Tina Lead", email: "dev" + D }),
  // Payment posting and Submission: a team lead and a person each; Pooja is a second posting team lead who is not the client's posting person
  P({ emp_id: "PT", name: "Pia Postlead", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: "pia" + D }),
  P({ emp_id: "P2", name: "Pooja Postlead", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: "pooja" + D }),
  P({ emp_id: "PA", name: "Pavan Poster", department: "Posting", project: SUN, reports_to: "Pia Postlead", email: "pavan" + D }),
  P({ emp_id: "ST", name: "Suri Sublead", position: "Team Lead", department: "Submission", project: SUN, reports_to: "Mona Manager", email: "suri" + D }),
  P({ emp_id: "SB", name: "Sahil Submitter", department: "Submission", project: SUN, reports_to: "Suri Sublead", email: "sahil" + D }),
  // two team leads whose roster project has no client: they see only what is shared with them
  P({ emp_id: "W1", name: "Vik Viewer", position: "Team Lead", project: "Delta Practice", reports_to: "Milan Manager", email: "vik" + D }),
  P({ emp_id: "W2", name: "Eda Editor", position: "Team Lead", project: "Delta Practice", reports_to: "Milan Manager", email: "eda" + D }),
  // a team lead the roster has no email for
  P({ emp_id: "N1", name: "Nil Nomail", position: "Team Lead", project: LAKE, reports_to: "Milan Manager", email: "" }),
];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
// ---- a stand-in for Drishti's Apps Script: checks the token's signature like its authUser, and answers the calls the single sign-in makes ----
const DR_SECRET = "s".repeat(40), DR_ADMIN_EMAIL = "drishti.admin" + D;
function drishtiStub() {
  const users = [{ id: "du-milan", email: "milan" + D, name: "Milan Manager", role: "manager" }, { id: "du-only", email: "drishti.only" + D, name: "Drishti Only", role: "manager" }, { id: "du-lara", email: "lara" + D, name: "Lara Lead", role: "tl" }];
  const managers = [{ id: "dm-milan", email: "milan" + D, name: "Milan Manager" }];
  const calls = [], state = { adminEmail: DR_ADMIN_EMAIL };
  const verify = (t) => { const [p, s] = String(t || "").split("."); if (!p || !s) return null; const payload = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    const sig = crypto.createHmac("sha256", DR_SECRET).update(payload).digest("base64").replace(/\+/g, "-").replace(/\//g, "_"); return sig === s ? payload.split("|") : null; };
  const handle = async (url, init) => {
    if (!url.includes("script.google.com")) return null;
    const b = JSON.parse(init.body); calls.push(b.a);
    if (b.a === "signup") { const u = { id: "du-" + users.length, email: b.email, name: b.name, role: b.role }; users.push(u); return J({ ok: true, user: u }); }
    const me = verify(b.t); if (!me) return J({ ok: false, code: "auth", error: "Please sign in again." });
    if (b.a === "me") return J({ ok: true, user: me[0] === "admin" ? { id: "admin", email: state.adminEmail, role: "admin" } : users.find((u) => u.id === me[0]) });
    if (b.a === "users.list") return J({ ok: true, users });
    if (b.a === "managers.list") return J({ ok: true, managers });
    return J({ ok: false, error: "not in the stand-in" });
  };
  return { handle, users, calls, verify, state };
}
/* A fresh world: the demo data, the roster synced, and a session for everyone. w.c(name) calls the server as that person. */
async function makeWorld({ feed = FEED(), envExtra = {} } = {}) {
  const st = { feed, mails: [], dr: drishtiStub() };
  const fetchMock = async (url, init) => {
    const d = await st.dr.handle(url, init); if (d) return d;
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: st.feed });
    if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "not set up" }, 404);
    if (url.includes("mail-hook.test")) { st.mails.push(JSON.parse(init.body)); return new Response("ok"); }
    return new Response("no outside network in tests", { status: 503 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), DRISHTI_TOKEN_SECRET: DR_SECRET, ...envExtra }, fetchMock });
  const { as, tryOp, sha } = rig, T = (fn) => tryOp(fn);
  const DB = rig.backend.env.DB;
  const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results || [];
  const row = async (q, ...a) => (await rows(q, ...a))[0];
  await rig.app.seedDemo(() => {});
  const anon = as(null);
  const A = as((await anon("auth.login", { email: "supervisor" + D, passHash: await sha("brahmastra-demo") })).token);
  const sync = () => A("roster.syncShastra");
  await sync();
  const U = async (name) => row("SELECT * FROM users WHERE name = ? ORDER BY created_at", name);
  const id = {}, calls = {};
  for (const r of feed) { const u = await U(r.name); if (u) id[r.name] = u.id; }
  // a session for someone: their first password (demo), then sign in by name
  const c = async (name) => { if (calls[name]) return calls[name]; const u = await U(name); if (!u) throw new Error("no such person: " + name);
    if (!u.pass_hash) await anon("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + name) });
    return (calls[name] = as((await anon("auth.loginById", { user_id: u.id, passHash: await sha("pw-" + name) })).token)); };
  const cl = (await A("clients.list")).clients, sun = cl.find((x) => /Sunrise/.test(x.name)), lake = cl.find((x) => /Lakeview/.test(x.name));
  const audits = async (action) => rows("SELECT action, detail, user_name, client_id FROM audit_log WHERE action LIKE ? ORDER BY at", action + "%");
  const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return { rig, as, anon, tryOp, T, sha, DB, sql, rows, row, A, sync, U, id, c, sun, lake, st, audits, today };
}
const refused = (r, re) => !r.ok && (r.status === 403 || r.status === 400) && (!re || re.test(r.e || ""));

/* ================= D-01 / E-06: a share or a place on a client's team never makes a person yours ================= */
{
  const w = await makeWorld();
  const { A, T, id, sun, lake } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead"), VK = await w.c("Vik Viewer"), ED = await w.c("Eda Editor"), SI = await w.c("Sima Expert"), MO = await w.c("Mona Manager"), VE = await w.c("Vera Vice");
  const pw = await w.sha("temp-for-the-test");
  S("D-01 / E-06: before any share, another team's biller is not theirs");
  let r = await T(() => LA("users.loginCode", { id: id["Arun Agent"] }));
  ok("D-01: a team lead gets no sign-in code for another team's biller", refused(r, /not on your team/), r);
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Vik Viewer"], level: "view" });
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Eda Editor"], level: "edit" });

  S("D-01 / E-06: a view-only share is look-only");
  const seen = (await VK("users.list")).users;
  ok("D-01: the view-only holder still sees the client's billers on Team, marked as not theirs", seen.some((u) => u.id === id["Arun Agent"] && u.in_span === false) && seen.find((u) => u.id === id["Vik Viewer"]).in_span === true, seen.map((u) => u.name + ":" + u.in_span));
  r = await T(() => VK("users.loginCode", { id: id["Arun Agent"] }));
  ok("D-01: no sign-in code with a view-only share", refused(r, /not on your team/), r);
  r = await T(() => VK("users.resetPassword", { id: id["Arun Agent"], passHash: pw }));
  ok("E-06: no password reset with a view-only share", refused(r, /not on your team/), r);
  r = await T(() => VK("users.save", { id: id["Bela Agent"], first_name: "Renamed", last_name: "Agent", role: "user", active: false }));
  const bela = await w.U("Bela Agent");
  ok("E-06: no rename or switch-off with a view-only share", refused(r, /not on your team/) && bela && bela.active === 1, [r, bela && bela.active]);
  r = await T(() => VK("coach.noteAdd", { user_id: id["Arun Agent"], kind: "concern", text: "a note from the view-only person" }));
  ok("D-01: no 1:1 coaching note with a view-only share", refused(r, /not in your team/) && !(await w.row("SELECT id FROM coach_notes WHERE user_id = ?", id["Arun Agent"])), r);
  await TI("coach.noteAdd", { user_id: id["Arun Agent"], kind: "concern", text: "made-up coaching note from the own team lead" });
  r = await T(() => VK("coach.profile", { user_id: id["Arun Agent"] }));
  ok("D-01: the 1:1 notes are not read with a view-only share", refused(r, /not in your team/), r);
  r = await T(() => VK("team.setOut", { user_id: id["Arun Agent"], out: true, reason: "Leave" }));
  ok("D-01: no Out today mark with a view-only share", refused(r, /not in your team/) && !(await w.row("SELECT user_id FROM attendance WHERE user_id = ?", id["Arun Agent"])), r);
  r = await T(() => VK("team.saveNote", { user_id: id["Arun Agent"], comment: "a Team status comment from the view-only person" }));
  ok("D-01: no Team status note with a view-only share", refused(r, /not in your team/) && !(await w.row("SELECT user_id FROM team_notes WHERE user_id = ?", id["Arun Agent"])), r);
  r = await T(() => VK("team.alertDismiss", { user_id: id["Arun Agent"] }));
  ok("D-01: the not-logged-in alert is not dismissed for everyone with a view-only share", refused(r, /not in your team/), r);
  r = await T(() => VK("team.shareOut", { user_id: id["Arun Agent"], today: w.today() }));
  ok("D-01: no reallocate-and-mark-out with a view-only share", refused(r, /not in your team/), r);
  const live = await VK("team.huddle", { today: w.today() }), stat = await VK("team.status", { from: w.today(), to: w.today() });
  ok("D-01: Live status and Team status still show the shared client's billers, without anything to press", live.rows.some((x) => x.id === id["Arun Agent"] && x.can_act === false) && stat.rows.some((x) => x.id === id["Arun Agent"] && x.can_act === false),
    [live.rows.map((x) => x.name + ":" + x.can_act), stat.rows.map((x) => x.name + ":" + x.can_act)]);

  S("D-01 / E-06: an edit share is about the client, not its people");
  r = await T(() => ED("users.loginCode", { id: id["Arun Agent"] }));
  ok("D-01: no sign-in code with an edit share", refused(r, /not on your team/), r);
  r = await T(() => ED("users.resetPassword", { id: id["Arun Agent"], passHash: pw }));
  ok("D-01: no password reset with an edit share", refused(r, /not on your team/), r);
  r = await T(() => ED("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "user", active: false }));
  ok("D-01: no switch-off with an edit share", refused(r, /not on your team/) && (await w.U("Arun Agent")).active === 1, r);
  r = await T(() => ED("coach.profile", { user_id: id["Arun Agent"] }));
  ok("D-01: no coaching card with an edit share", refused(r, /not in your team/), r);
  r = await T(() => ED("team.setOut", { user_id: id["Arun Agent"], out: true, reason: "Leave" }));
  ok("D-01: with an edit share the client's work goes on: Out today on its billers is kept", r.ok, r);
  await ED("team.setOut", { user_id: id["Arun Agent"], out: false });
  const pool = (await ED("claims.list", { client_id: sun.id, state: "open", page_size: 3 })).rows;
  r = await T(() => ED("alloc.reassign", { ids: [pool[0].id], user_id: id["Arun Agent"] }));
  ok("D-01: with an edit share the client's billers can still be picked in allocation", r.ok && (await w.row("SELECT assigned_to FROM claims WHERE id = ?", pool[0].id)).assigned_to === id["Arun Agent"], r);

  S("D-01 / E-06: sharing your own client with someone, or putting them on its team, gives nothing over them");
  await LA("clients.accessSave", { client_id: lake.id, user_id: id["Arun Agent"], level: "view" });
  r = await T(() => LA("users.loginCode", { id: id["Arun Agent"] }));
  ok("D-01: a team lead who shares their client with another team's biller gets no sign-in code for them", refused(r, /not on your team/), r);
  r = await T(() => LA("coach.profile", { user_id: id["Arun Agent"] }));
  ok("D-01: nor their 1:1 notes", refused(r, /not in your team/), r);
  r = await T(() => LA("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "user", active: false }));
  ok("D-01: nor can they switch them off", refused(r, /not on your team/) && (await w.U("Arun Agent")).active === 1, r);
  const team = (await TI("clients.list")).clients.find((x) => x.id === sun.id).team;
  r = await T(() => TI("clients.saveTeam", { client_id: sun.id, team: [...team, id["Cyra Agent"]], auto_allocate: true }));
  ok("E-06: a team lead can still put another team's biller on their own client's team (a crossover)", r.ok && r.r.team.includes(id["Cyra Agent"]), r);
  r = await T(() => TI("users.loginCode", { id: id["Cyra Agent"] }));
  ok("E-06: that gives no sign-in code for the biller", refused(r, /not on your team/), r);
  r = await T(() => TI("users.resetPassword", { id: id["Cyra Agent"], passHash: pw }));
  ok("E-06: and no password reset", refused(r, /not on your team/), r);
  r = await T(() => SI("clients.saveTeam", { client_id: sun.id, team: [...team, id["Cyra Agent"]], auto_allocate: true }));
  const r2 = await T(() => SI("users.loginCode", { id: id["Cyra Agent"] }));
  ok("E-06: the same for an SME", refused(r2, /not on your team/), [r.ok, r2]);
  ok("E-06: the crossover biller can still be given a team task on that client", (await T(() => TI("tasks.create", { client_id: sun.id, scope: "AR follow-up", title: "Recheck the made-up list", source: "Internal", tat: { kind: "24" }, count: 2, people: [{ user_id: id["Cyra Agent"], share: 2 }] }))).ok);

  S("D-01 / E-06: rightful access stays");
  r = await T(() => TI("users.loginCode", { id: id["Arun Agent"] }));
  ok("D-01: the biller's own team lead still gets a sign-in code", r.ok && /^\d{6}$/.test(r.r.code), r);
  r = await T(() => LA("users.loginCode", { id: id["Dev Agent"] }));
  ok("D-01: a biller on two projects is on both team leads' own projects: the second lead gets a code too", r.ok, r);
  r = await T(() => SI("users.loginCode", { id: id["Bela Agent"] }));
  ok("D-01: an SME still gets a code for a biller on their own project", r.ok, r);
  r = await T(() => MO("users.loginCode", { id: id["Arun Agent"] }));
  ok("D-01: the manager above still gets a code for a biller under them", r.ok, r);
  r = await T(() => MO("users.loginCode", { id: id["Tina Lead"] }));
  ok("D-01: and for a team lead who reports to them", r.ok, r);
  r = await T(() => VE("users.loginCode", { id: id["Cyra Agent"] }));
  ok("D-01: the VP still gets a code for any biller", r.ok, r);
  r = await T(() => TI("users.loginCode", { id: id["Mona Manager"] }));
  ok("D-01: a team lead still gets none for their manager", refused(r), r);
  r = await T(() => TI("coach.profile", { user_id: id["Arun Agent"] }));
  ok("D-01: the own team lead still opens the coaching card with its notes", r.ok && r.r.notes.length === 1, r);
  r = await T(() => TI("users.save", { id: id["Bela Agent"], first_name: "Bela", last_name: "Agent", designation: "Biller", role: "user", capacity: 30, active: true }));
  ok("D-01: the own team lead still edits their biller", r.ok && r.r.user.capacity === 30, r);
  ok("D-01: on a team lead's Team list the people of their own span are marked theirs, the crossover and share people are not", (await TI("users.list")).users.filter((u) => u.in_span).map((u) => u.name).sort().join() === ["Arun Agent", "Bela Agent", "Dev Agent", "Pavan Poster", "Pia Postlead", "Pooja Postlead", "Sahil Submitter", "Sima Expert", "Suri Sublead", "Tina Lead"].sort().join(),
    (await TI("users.list")).users.map((u) => u.name + ":" + u.in_span));

  S("E-07: a view-only share gives no team tasks on that client");
  r = await T(() => VK("tasks.create", { client_id: sun.id, scope: "AR follow-up", title: "Recheck the made-up list", source: "Internal", tat: { kind: "24" }, count: 5, people: [{ user_id: id["Arun Agent"], share: 5 }] }));
  ok("E-07: a team task on a view-only client is refused, like an escalation", refused(r, /view-only/) && refused(await T(() => VK("escalations.save", { client_id: sun.id, kind: "external" })), /view-only/), r);
  r = await T(() => VK("tasks.create", { scope: "AR follow-up", title: "Recheck the made-up list", source: "Internal", tat: { kind: "24" }, count: 5, people: [{ user_id: id["Arun Agent"], share: 5 }] }));
  ok("E-07: nor a task without a client to the people seen through the view-only share", refused(r, /Only people on your team/), r);
  ok("E-07: nothing landed on the biller's My tasks", (await (await w.c("Arun Agent"))("tasks.mine", {})).rows.length === 0);
  ok("E-07: the task form's people list leaves them out", !(await VK("tasks.people", {})).people.some((p) => p.id === id["Arun Agent"]));
  r = await T(() => ED("tasks.create", { client_id: sun.id, scope: "AR follow-up", title: "Recheck the made-up list", source: "Internal", tat: { kind: "24" }, count: 5, people: [{ user_id: id["Arun Agent"], share: 5 }] }));
  ok("E-07: with an edit share the task is given", r.ok && (await (await w.c("Arun Agent"))("tasks.mine", {})).rows.length === 1, r);
  r = await T(() => TI("tasks.create", { client_id: sun.id, scope: "AR follow-up", title: "Recheck the made-up list again", source: "Internal", tat: { kind: "24" }, count: 4, people: [{ user_id: id["Bela Agent"], share: 4 }] }));
  ok("E-07: the client's own team lead gives tasks as before", r.ok, r);
}

/* ================= Team edit (users.save): D-10 checks before writes ================= */
{
  const w = await makeWorld();
  const { A, T, id } = w;
  const TI = await w.c("Tina Lead"), NN = await w.c("Nil Nomail");
  const snap = async (name) => { const u = await w.U(name); return [u.email, u.email_missing, u.emp_id, u.projects_json, u.reports_to, u.name, u.capacity, u.active, u.role].join(" | "); };

  S("D-10: a save that is refused changes nothing");
  let before = await snap("Nil Nomail");
  let r = await T(() => NN("users.save", { id: id["Nil Nomail"], first_name: "Renamed", last_name: "Nomail", role: "supervisor", capacity: 77, active: false, email: "nil.typed" + D }));
  ok("D-10: a team lead's refused save of their own profile (Active off) leaves the email, name and target as they were", !r.ok && /deactivate or demote your own/.test(r.e) && (await snap("Nil Nomail")) === before, [r, before, await snap("Nil Nomail")]);
  const admin = await w.row("SELECT * FROM users WHERE role = 'admin'");
  before = await snap(admin.name);
  r = await T(() => A("users.save", { id: admin.id, first_name: "Changed", last_name: "Admin", active: false, email: "changed.admin" + D, emp_id: "ZZ999", projects: [{ name: SUN }], reports_to: id["Vera Vice"] }));
  ok("D-10: the admin's refused save (Active off on the own account) leaves the email, Emp ID, projects and reports-to as they were", !r.ok && /deactivate or demote your own/.test(r.e) && (await snap(admin.name)) === before, [r, before, await snap(admin.name)]);
  before = await snap("Arun Agent");
  r = await T(() => A("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "user", email: "tina" + D, emp_id: "ZZ998", projects: [{ name: LAKE }], reports_to: id["Lara Lead"] }));
  ok("D-10: a save refused for the email (another account has it) writes none of the rest", !r.ok && /already has an account/.test(r.e) && (await snap("Arun Agent")) === before, [r, before, await snap("Arun Agent")]);
  r = await T(() => A("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", designation: "Sr Biller", role: "user", capacity: 41, active: true, email: "arun.new" + D, emp_id: "A1", projects: [{ name: SUN }, { name: LAKE, share: 25 }], reports_to: id["Lara Lead"] }));
  const u = await w.U("Arun Agent");
  ok("D-10: a save that passes writes all of it together", r.ok && u.email === "arun.new" + D && u.capacity === 41 && u.designation === "Sr Biller" && u.reports_to === id["Lara Lead"] && u.reports_to_name === "Lara Lead" && JSON.parse(u.projects_json).length === 2, [r, u && [u.email, u.capacity, u.designation, u.reports_to_name, u.projects_json]]);
  r = await T(() => TI("users.save", { id: id["Bela Agent"], first_name: "Bela", last_name: "Agent", role: "user", active: false }));
  ok("D-10: switching someone off still signs them out and frees their claims", r.ok && (await w.U("Bela Agent")).active === 0, r);
}

/* ================= D-02: only the admin makes someone a team lead ================= */
{
  const w = await makeWorld();
  const { A, T, id, sun, lake } = w;
  const TI = await w.c("Tina Lead"), MO = await w.c("Mona Manager"), SI = await w.c("Sima Expert"), VE = await w.c("Vera Vice");
  const roleOf = async (n) => (await w.U(n)).role;

  S("D-02: a team lead cannot give anyone the team lead role");
  let r = await T(() => TI("users.save", { id: id["Dev Agent"], first_name: "Dev", last_name: "Agent", role: "supervisor" }));
  ok("D-02: a team lead cannot make their biller (who also works another client) a team lead", refused(r, /Only the admin can make someone a team lead/) && (await roleOf("Dev Agent")) === "user", [r, await roleOf("Dev Agent")]);
  const DV = await w.c("Dev Agent");
  r = await T(() => DV("claims.list", { client_id: lake.id }));
  ok("D-02: so that biller gets no team lead view of the other client", !r.ok && r.status === 403, r);
  r = await T(() => MO("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "supervisor" }));
  ok("D-02: a manager cannot either", refused(r, /Only the admin can make someone a team lead/) && (await roleOf("Arun Agent")) === "user", r);
  r = await T(() => VE("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "supervisor" }));
  ok("D-02: nor the VP: only the admin", refused(r, /Only the admin can make someone a team lead/) && (await roleOf("Arun Agent")) === "user", r);
  ok("D-02: nothing went to the audit trail as a role change", !(await w.audits("user.save")).some((a) => /role user → supervisor/.test(a.detail)));
  r = await T(() => TI("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", designation: "Biller", role: "user", capacity: 33 }));
  ok("D-02: a team lead still saves the rest of a biller's profile (the role left as it is)", r.ok && r.r.user.capacity === 33 && r.r.user.role === "user", r);
  r = await T(() => TI("users.save", { id: id["Tina Lead"], first_name: "Tina", last_name: "Lead", designation: "TL", role: "supervisor", capacity: 20 }));
  ok("D-02: and their own, as a team lead", r.ok && r.r.user.role === "supervisor", r);

  S("D-02: the SME designation (and its limits) is not taken off by the SME or their team lead");
  r = await T(() => SI("users.save", { id: id["Sima Expert"], first_name: "Sima", last_name: "Expert", role: "supervisor", designation: "TL" }));
  ok("D-02: an SME cannot make themselves a TL on their own profile", refused(r, /Only the admin can change an SME's designation/) && (await w.U("Sima Expert")).designation === "SME", [r, (await w.U("Sima Expert")).designation]);
  r = await T(() => SI("clients.accessSave", { client_id: sun.id, user_id: id["Cyra Agent"], level: "edit" }));
  ok("D-02: so an SME still cannot share a client", refused(r, /team leads and up/), r);
  r = await T(() => TI("users.save", { id: id["Sima Expert"], first_name: "Sima", last_name: "Expert", role: "supervisor", designation: "TL" }));
  ok("D-02: their team lead cannot take the SME designation off either", refused(r, /Only the admin can change an SME's designation/), r);
  r = await T(() => SI("users.save", { id: id["Sima Expert"], first_name: "Sima", last_name: "Expert", role: "supervisor", designation: "SME", capacity: 12 }));
  ok("D-02: an SME still saves their own profile with the designation as it is", r.ok && r.r.user.capacity === 12, r);

  S("D-02: the admin still changes roles, and it is in the audit trail");
  r = await T(() => A("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "supervisor" }));
  ok("D-02: the admin makes a biller a team lead", r.ok && (await roleOf("Arun Agent")) === "supervisor" && (await w.audits("user.save")).some((a) => /Arun Agent · role user → supervisor/.test(a.detail)), [r, await w.audits("user.save")]);
  r = await T(() => A("users.save", { id: id["Sima Expert"], first_name: "Sima", last_name: "Expert", role: "supervisor", designation: "TL" }));
  ok("D-02: and changes an SME's designation", r.ok && (await w.U("Sima Expert")).designation === "TL", r);
  r = await T(() => MO("users.save", { id: id["Tina Lead"], first_name: "Tina", last_name: "Lead", designation: "TL", role: "user" }));
  ok("D-02: taking the team lead role off someone who reports to you stays as it was (not a way up)", r.ok && (await roleOf("Tina Lead")) === "user", r);
}

/* ================= D-09: nobody puts someone else's Emp ID on a profile ================= */
{
  const feed = [...FEED(), P({ emp_id: "Z9", name: "Zed Newjoiner", project: SUN, reports_to: "Tina Lead", email: "zed" + D })];
  const w = await makeWorld({ feed });
  const { A, T, id } = w;
  const TI = await w.c("Tina Lead"), PI = await w.c("Pia Postlead");
  const emp = async (n) => (await w.U(n)).emp_id;

  S("D-09: the Emp ID is the admin's to change");
  const seen = (await w.anon("auth.lookup", { q: "Pia" })).matches.find((m) => m.id === id["Pia Postlead"]).emp_id;   // Emp IDs show on the sign-in screen
  let r = await T(() => TI("users.save", { id: id["Tina Lead"], first_name: "Tina", last_name: "Lead", role: "supervisor", emp_id: seen }));
  ok("D-09: a team lead cannot put another person's Emp ID on their own profile", refused(r, /Only the admin can change an Emp ID/) && (await emp("Tina Lead")) === "T1", [r, await emp("Tina Lead")]);
  r = await T(() => TI("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "user", emp_id: seen }));
  ok("D-09: nor on a team member's profile", refused(r, /Only the admin can change an Emp ID/) && (await emp("Arun Agent")) === "A1", r);
  await w.sync();
  const pia = await w.U("Pia Postlead");
  ok("D-09: after the roster sync that person is still switched on and signs in", pia.active === 1 && (await T(() => PI("auth.me"))).ok && (await T(async () => w.anon("auth.loginById", { user_id: pia.id, passHash: await w.sha("pw-Pia Postlead") }))).ok, pia && pia.active);
  r = await T(() => TI("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "user", capacity: 31, emp_id: "a1" }));
  ok("D-09: a team lead's save with the Emp ID as it is (any letter case, as the form sends it) still goes through", r.ok && r.r.user.capacity === 31 && (await emp("Arun Agent")) === "A1", r);

  S("D-09: the admin matches an account to its roster row, never to one in use");
  r = await T(() => A("users.save", { id: id["Arun Agent"], first_name: "Arun", last_name: "Agent", role: "user", emp_id: seen }));
  ok("D-09: the admin cannot give an account the Emp ID of another account that is in use", !r.ok && /in use/.test(r.e) && (await emp("Arun Agent")) === "A1", r);
  const admin = await w.row("SELECT * FROM users WHERE role = 'admin'");
  r = await T(() => A("users.save", { id: admin.id, first_name: admin.first_name || "Admin", last_name: admin.last_name || "One", emp_id: "T1" }));
  ok("D-09: not on the admin's own profile either", !r.ok && /in use/.test(r.e) && (await w.row("SELECT emp_id FROM users WHERE id = ?", admin.id)).emp_id !== "T1", r);
  // a hand-made account for someone who also has an unused roster copy: the admin merges them by the Emp ID (the documented use)
  const made = await A("users.save", { first_name: "Zed", last_name: "Handmade", email: "zed.hand" + D, designation: "Biller", role: "user", passHash: await w.sha("temp-for-zed") });
  r = await T(() => A("users.save", { id: made.user.id, first_name: "Zed", last_name: "Handmade", role: "user", emp_id: "z9" }));
  ok("D-09: the admin can still put the Emp ID of an unused roster copy on a hand-made account", r.ok && (await w.row("SELECT emp_id FROM users WHERE id = ?", made.user.id)).emp_id === "Z9", r);
  ok("D-09: the Emp ID change is in the audit trail", (await w.audits("user.save")).some((a) => /Zed Handmade · Emp ID none → Z9/.test(a.detail)), await w.audits("user.save"));
  await w.sync();
  const kept = await w.row("SELECT * FROM users WHERE id = ?", made.user.id), copies = await w.rows("SELECT id, active FROM users WHERE name = 'Zed Newjoiner' OR emp_id = 'Z9'");
  ok("D-09: at the next sync the hand-made account takes the roster row and the unused copy is gone or off", kept.source === "roster" && kept.name === "Zed Newjoiner" && kept.active === 1 && !!kept.pass_hash && copies.filter((c) => c.active).length === 1, [kept && [kept.source, kept.name, kept.active], copies]);
}

/* ================= D-03: a roster project is matched only onto a client of the team lead's own span ================= */
{
  const w = await makeWorld();
  const { A, T, id, sun, lake } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead"), VK = await w.c("Vik Viewer"), ED = await w.c("Eda Editor");
  const profile = (lead) => ({ scope: ["ar"], targets: { ar: 30 }, resp: { ar: { lead } } });
  const namesOn = async (cid) => JSON.parse((await w.row("SELECT roster_names_json FROM clients WHERE id = ?", cid)).roster_names_json || "[]");
  const mapAudits = async () => (await w.audits("project.map")).length;

  S("D-03: not onto a client another team lead added, and not onto a shared client");
  const echo = (await LA("clients.save", { name: "Echo Clinic", locations: ["Main"], profile: profile(id["Cyra Agent"]) })).client.id;
  let before = await T(() => VK("claims.list", { client_id: echo }));
  let n0 = await mapAudits();
  let r = await T(() => VK("projects.map", { name: "Delta Practice", client_id: echo }));
  ok("D-03: a team lead whose project has no client cannot match it onto a client another team lead just added", !before.ok && refused(r, /only to a client you are responsible for/) && (await namesOn(echo)).length === 0, [before, r, await namesOn(echo)]);
  r = await T(() => VK("claims.list", { client_id: echo }));
  ok("D-03: so that client's claims stay closed to them", !r.ok && r.status === 403, r);
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Vik Viewer"], level: "view" });
  await A("clients.accessSave", { client_id: lake.id, user_id: id["Eda Editor"], level: "edit" });
  r = await T(() => VK("projects.map", { name: "Delta Practice", client_id: sun.id }));
  ok("D-03: not onto a client shared with them view-only", refused(r, /only to a client you are responsible for/), r);
  r = await T(() => ED("projects.map", { name: "Delta Practice", client_id: lake.id }));
  ok("D-03: not onto a client shared with them to edit either (a share is not their own span)", refused(r, /only to a client you are responsible for/) && !(await namesOn(lake.id)).includes("Delta Practice"), [r, await namesOn(lake.id)]);
  r = await T(() => TI("projects.map", { name: SUN, client_id: lake.id }));
  ok("D-03: a team lead cannot move their project onto another team lead's client", refused(r, /only to a client you are responsible for/) && (await namesOn(sun.id)).includes(SUN), r);
  ok("D-03: none of the refused matches left an audit row", (await mapAudits()) === n0);
  const um = await VK("projects.unmapped");
  ok("D-03: the match pop-up offers the team lead their unmatched project, and none of those clients", um.names.includes("Delta Practice") && !um.clients.some((c) => [echo, sun.id, lake.id].includes(c.id)), um);

  S("D-03: onto a client of their own span, with an audit row");
  const fox = (await A("clients.save", { name: "Foxtrot Clinic", locations: ["Main"], profile: profile(id["Vik Viewer"]) })).client.id;
  ok("D-03: a client they are set responsible for is offered", (await VK("projects.unmapped")).clients.some((c) => c.id === fox));
  const golf = (await ED("clients.save", { name: "Golf Dental", locations: ["Main"], profile: profile(id["Cyra Agent"]) })).client.id;
  ok("D-03: and so is a client they added themselves", (await ED("projects.unmapped")).clients.some((c) => c.id === golf) && !(await VK("projects.unmapped")).clients.some((c) => c.id === golf));
  r = await T(() => VK("projects.map", { name: "Delta Practice", client_id: fox }));
  ok("D-03: the team lead matches their project to the client they are responsible for", r.ok && (await namesOn(fox)).includes("Delta Practice"), r);
  let au = await w.audits("project.map");
  ok("D-03: the match is in the audit trail: who, the project and the client", au.length === n0 + 1 && au[au.length - 1].user_name === "Vik Viewer" && au[au.length - 1].client_id === fox && /Delta Practice matched to Foxtrot Clinic/.test(au[au.length - 1].detail), au);
  ok("D-03: the other team lead on that project gets the client too", (await T(() => ED("claims.list", { client_id: fox }))).ok);
  r = await T(() => ED("projects.map", { name: "Delta Practice", client_id: golf }));
  au = await w.audits("project.map");
  ok("D-03: a team lead moves their project to a client they added, and the audit row says where it was", r.ok && (await namesOn(golf)).includes("Delta Practice") && !(await namesOn(fox)).includes("Delta Practice") && /Delta Practice matched to Golf Dental; it was on Foxtrot Clinic/.test(au[au.length - 1].detail), [r, au[au.length - 1]]);
  r = await T(() => A("projects.map", { name: "Delta Practice", client_id: echo }));
  au = await w.audits("project.map");
  ok("D-03: the admin matches any project to any client, as before, also audited", r.ok && (await namesOn(echo)).includes("Delta Practice") && /matched to Echo Clinic; it was on Golf Dental/.test(au[au.length - 1].detail) && (await A("projects.unmapped")).clients.length >= 5, [r, au[au.length - 1]]);
  const n1 = au.length;
  await A("projects.map", { name: "Delta Practice", client_id: echo });
  ok("D-03: a match that changes nothing adds no audit row", (await mapAudits()) === n1);
}

/* ================= D-04: the Drishti account is picked by an email the person cannot set themselves ================= */
{
  const feed = [...FEED(), P({ emp_id: "N2", name: "Noor Nomail", position: "Team Lead", project: LAKE, reports_to: "Milan Manager", email: "" }),
    P({ emp_id: "N3", name: "Dora Lead", position: "Team Lead", project: LAKE, reports_to: "Milan Manager", email: "dora" + D })];
  const w = await makeWorld({ feed });
  const { A, T, id, st } = w;
  const NN = await w.c("Nil Nomail"), NO = await w.c("Noor Nomail"), MI = await w.c("Milan Manager"), LA = await w.c("Lara Lead"), DO = await w.c("Dora Lead");
  const typed = async (n) => (await w.U(n)).email_typed;
  const who = (r) => (r.ok ? st.dr.verify(r.r.token) : null);

  S("D-04: an email typed in Brahmastra does not pick a Drishti account");
  let r = await T(() => NN("reports.drishtiSession", {}));
  ok("D-04: with no email on the account, Drishti is not opened and no Drishti account is made", !r.ok && /no email address yet/.test(r.e) && !st.dr.calls.includes("signup"), [r, st.dr.calls]);
  r = await T(() => NN("users.save", { id: id["Nil Nomail"], first_name: "Nil", last_name: "Nomail", role: "supervisor", email: DR_ADMIN_EMAIL }));
  ok("D-04: a person the roster has no email for can still add one on their own profile (to sign in with codes)", r.ok && (await w.U("Nil Nomail")).email === DR_ADMIN_EMAIL && (await typed("Nil Nomail")) === 1, [r, await typed("Nil Nomail")]);
  r = await T(() => NN("reports.drishtiSession", {}));
  ok("D-04: typing the address of Drishti's Admin does not open Drishti as its Admin", refused(r, /added in Brahmastra, not in Purview Shastra/) && !who(r), r);
  r = await T(() => MI("users.save", { id: id["Noor Nomail"], first_name: "Noor", last_name: "Nomail", role: "supervisor", email: "drishti.only" + D }));
  const r2 = await T(() => NO("reports.drishtiSession", {}));
  ok("D-04: nor does an address their manager typed for them: no token for that Drishti account", r.ok && (await typed("Noor Nomail")) === 1 && refused(r2, /added in Brahmastra/) && !st.dr.calls.includes("signup"), [r, r2]);
  r = await T(() => w.anon("auth.sendOtp", { email: "drishti.only" + D }));
  ok("D-04: the typed address still gets the sign-in codes, as before", r.ok && /^\d{6}$/.test(r.r.demo_code || ""), r);
  await w.sync();
  ok("D-04: a roster sync that still has no email for them keeps the address, and keeps it marked as typed", (await w.U("Noor Nomail")).email === "drishti.only" + D && (await typed("Noor Nomail")) === 1 && (await typed("Nil Nomail")) === 1);
  // as if Drishti's Admin address were the Shastra email of someone who is not Brahmastra's admin
  st.dr.state.adminEmail = "dora" + D;
  r = await T(() => DO("reports.drishtiSession", {}));
  ok("D-04: only Brahmastra's admin opens Drishti as its Admin, whatever email someone else has", refused(r, /belongs to Drishti's Admin/) && !who(r), r);
  st.dr.state.adminEmail = DR_ADMIN_EMAIL;

  S("D-04: an email from Purview Shastra, or set by the admin, does");
  r = await T(() => LA("reports.drishtiSession", {}));
  ok("D-04: a team lead with a Shastra email opens their own Drishti account", r.ok && who(r)[0] === "du-lara" && who(r)[1] === "tl" && (await typed("Lara Lead")) === 0, [r.ok ? who(r) : r]);
  r = await T(() => A("reports.drishtiSession", {}));
  ok("D-04: Brahmastra's admin opens Drishti as its Admin", r.ok && who(r)[0] === "admin" && who(r)[1] === "admin" && r.r.role === "admin", r.ok ? who(r) : r);
  r = await T(() => A("users.save", { id: id["Noor Nomail"], first_name: "Noor", last_name: "Nomail", role: "supervisor", email: "noor" + D }));
  ok("D-04: an address the admin sets counts as the person's own", r.ok && (await typed("Noor Nomail")) === 2, [r, await typed("Noor Nomail")]);
  r = await T(() => NO("reports.drishtiSession", {}));
  const made = st.dr.users.find((u) => u.email === "noor" + D);
  ok("D-04: with it Drishti opens: a new Drishti account of their own, under the manager they report to", r.ok && r.r.created === true && made && who(r)[0] === made.id && who(r)[1] !== "admin", [r.ok ? who(r) : r, made]);
  await w.sync();
  ok("D-04: the admin's address stays through a roster sync", (await w.U("Noor Nomail")).email === "noor" + D && (await typed("Noor Nomail")) === 2);
  st.feed = st.feed.map((x) => (x.name === "Nil Nomail" ? { ...x, email: "nil" + D } : x));
  await w.sync();
  r = await T(() => NN("reports.drishtiSession", {}));
  const nil = st.dr.users.find((u) => u.email === "nil" + D);
  ok("D-04: once Shastra sends the person's email, it replaces the typed one and Drishti opens as them", (await w.U("Nil Nomail")).email === "nil" + D && (await typed("Nil Nomail")) === 0 && r.ok && nil && who(r)[0] === nil.id, [(await w.U("Nil Nomail")).email, await typed("Nil Nomail"), r.ok ? who(r) : r]);
  // an address kept from before this was tracked: Shastra does not send it, nobody vouched for it
  await w.sql("UPDATE users SET email = ?, email_missing = 0, email_typed = 0 WHERE id = ?", "noor.old" + D, id["Noor Nomail"]);
  await w.sync();
  ok("D-04: an address from before, that Shastra does not send, counts as typed after the next sync", (await typed("Noor Nomail")) === 1 && refused(await T(() => NO("reports.drishtiSession", {})), /added in Brahmastra/));
}

/* ================= D-05: access changes leave an audit row, never with a code or a password in it ================= */
{
  const w = await makeWorld();
  const { A, T, id } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead"), NN = await w.c("Nil Nomail"), VE = await w.c("Vera Vice"), MO = await w.c("Mona Manager");
  const count = async () => (await w.row("SELECT COUNT(*) AS n FROM audit_log")).n;
  const last = async (action) => (await w.audits(action)).slice(-1)[0];

  S("D-05: sign-in codes and password resets for someone else");
  let n = await count();
  const code = await TI("users.loginCode", { id: id["Arun Agent"] });
  let a = await last("user.code");
  ok("D-05: a sign-in code fetched for a biller is in the audit trail: who, for whom", (await count()) === n + 1 && a && a.user_name === "Tina Lead" && /^Arun Agent: sign-in code given$/.test(a.detail), a);
  const ph = await w.sha("a-temporary-password-for-the-test");
  n = await count();
  await TI("users.resetPassword", { id: id["Arun Agent"], passHash: ph });
  a = await last("user.reset");
  ok("D-05: a temporary password set for a biller is in the audit trail", (await count()) === n + 1 && a && a.user_name === "Tina Lead" && /^Arun Agent: temporary password set/.test(a.detail), a);
  n = await count();
  const r0 = await T(() => LA("users.loginCode", { id: id["Arun Agent"] })), r1 = await T(() => LA("users.resetPassword", { id: id["Arun Agent"], passHash: ph }));
  ok("D-05: a refused code or reset writes nothing", !r0.ok && !r1.ok && (await count()) === n);

  S("D-05: email changes, accounts added and deleted, extra sign-in emails");
  n = await count();
  await A("users.save", { id: id["Cyra Agent"], first_name: "Cyra", last_name: "Agent", role: "user", email: "cyra.new" + D });
  a = await last("user.email");
  ok("D-05: an email changed by the admin is in the audit trail, old and new", a && a.detail === `Cyra Agent: cyra${D} → cyra.new${D}` && (await count()) === n + 1, a);
  await NN("users.save", { id: id["Nil Nomail"], first_name: "Nil", last_name: "Nomail", role: "supervisor", email: "nil.typed" + D });
  a = await last("user.email");
  ok("D-05: so is an email a person adds where the roster had none", a && a.user_name === "Nil Nomail" && a.detail === `Nil Nomail: no email → nil.typed${D}`, a);
  n = await count();
  const made = await A("users.save", { first_name: "Hana", last_name: "Handmade", email: "hana" + D, designation: "Biller", role: "user", projects: [{ name: SUN }] });
  a = await last("user.save");
  ok("D-05: an account the admin adds by hand is in the audit trail", (await count()) === n + 1 && a && /^Hana Handmade · account added by hand \(biller, hana@/.test(a.detail), a);
  n = await count();
  await A("users.delete", { id: made.user.id });
  a = await last("user.delete");
  ok("D-05: a deleted account is in the audit trail", (await count()) === n + 1 && a && /^Hana Handmade · account deleted \(biller\)$/.test(a.detail), a);
  n = await count();
  await A("roster.saveEmails", { emails: ["someone@example.org", "other@example.org"] });
  a = await last("roster.emails");
  ok("D-05: the extra sign-in emails: what was added is in the audit trail", (await count()) === n + 1 && a && a.detail === "added someone@example.org, other@example.org", a);
  await A("roster.saveEmails", { emails: ["other@example.org", "third@example.org"] });
  a = await last("roster.emails");
  ok("D-05: and what was added and removed on a change", a && a.detail === "added third@example.org; removed someone@example.org", a);
  n = await count();
  await A("roster.saveEmails", { emails: ["other@example.org", "third@example.org"] });
  ok("D-05: saving the same list again adds no row", (await count()) === n);

  S("D-05: nothing secret in the audit trail, and it stays with the admin and the VP");
  const all = (await w.rows("SELECT action, detail, user_name FROM audit_log")).map((x) => JSON.stringify(x)).join("\n");
  const tok = (await w.row("SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC", id["Tina Lead"])).token;
  ok("D-05: no audit row carries the sign-in code, the password sent, or a session token", /^\d{6}$/.test(code.code) && !all.includes(code.code) && !all.includes(ph) && !all.includes(tok) && !/pass_hash|passHash/.test(all));
  const rows = (await A("audit.list", { action: "user" })).rows.map((x) => x.action);
  ok("D-05: the admin's Audit trail lists them under Team members", ["user.code", "user.reset", "user.email", "user.delete", "user.save"].every((k) => rows.includes(k)), rows);
  ok("D-05: the VP reads the audit trail; a team lead and a manager do not", (await T(() => VE("audit.list", {}))).ok && !(await T(() => TI("audit.list", {}))).ok && !(await T(() => MO("audit.list", {}))).ok);
}

/* ================= D-07: asking for codes, signed out, cannot cancel or block someone's codes ================= */
{
  const w = await makeWorld();
  const { A, T, id, anon } = w;
  const real = Date.now; let t = real();
  const step = (sec = 46) => { t += sec * 1000; };   // 46 s: just past the 45-second pause
  Date.now = () => t;
  try {
    S("D-07: a new request does not cancel the code already in the mailbox");
    const mine = await anon("auth.adminCode", {});           // the admin presses Access Admin (the demo shows the code; live emails it)
    step(); const other = await anon("auth.adminCode", {});  // someone else, signed out, asks again
    let r = await T(() => anon("auth.adminVerify", { user_id: mine.user_id, code: mine.demo_code }));
    ok("D-07: the admin's code still signs them in after someone else asked for another", r.ok && r.r.user.is_admin === true, r);
    r = await T(() => anon("auth.adminVerify", { user_id: mine.user_id, code: other.demo_code }));
    ok("D-07: that sign-in used up every code still valid: the other one no longer works", !r.ok && /expired or was never sent/.test(r.e), r);
    r = await T(() => anon("auth.adminVerify", { user_id: mine.user_id, code: mine.demo_code }));
    ok("D-07: and a code works once", !r.ok, r);

    S("D-07: ten requests in an hour do not lock the admin out");
    let newest = null;
    for (let i = 0; i < 8; i++) { step(); newest = await anon("auth.adminCode", {}); }   // with the two above: 10 in the hour
    step(); r = await T(() => anon("auth.adminCode", {}));
    ok("D-07: the eleventh request says a code sent a few minutes ago still works", !r.ok && r.status === 429 && /still works/.test(r.e), r);
    r = await T(() => anon("auth.adminVerify", { user_id: mine.user_id, code: newest.demo_code }));
    ok("D-07: and the newest code in the mailbox does sign the admin in", r.ok && r.r.user.is_admin === true, r);
    step(11 * 60);                                            // every code has run out; still inside the hour of the ten
    r = await T(() => anon("auth.adminCode", {}));
    ok("D-07: once none is valid any more a new code is sent, although ten were asked in the hour", r.ok && /^\d{6}$/.test(r.r.demo_code), r);
    r = await T(() => anon("auth.adminVerify", { user_id: mine.user_id, code: r.r.demo_code }));
    ok("D-07: it signs the admin in", r.ok, r);

    S("D-07: the same for a person's emailed code, and a team lead's code");
    const TI = await w.c("Tina Lead");
    const c1 = await anon("auth.sendOtp", { email: "arun" + D });
    step(); const c2 = await anon("auth.sendOtp", { email: "arun" + D });
    const c3 = await TI("users.loginCode", { id: id["Arun Agent"] });
    ok("D-07: three codes for one person, all different", new Set([c1.demo_code, c2.demo_code, c3.code]).size === 3);
    r = await T(() => anon("auth.verifyOtp", { email: "arun" + D, code: c1.demo_code }));
    ok("D-07: the first emailed code still works after a second request and a team lead's code", r.ok && r.r.user.id === id["Arun Agent"], r);
    r = await T(() => anon("auth.verifyOtp", { email: "arun" + D, code: c3.code }));
    ok("D-07: after that sign-in the team lead's code is used up too", !r.ok, r);
    r = await T(() => anon("auth.verifyOtp", { email: "bela" + D, code: c2.demo_code }));
    ok("D-07: a code never works for another email", !r.ok, r);

    S("D-07: the guess limits stay");
    const b1 = await anon("auth.sendOtp", { email: "bela" + D });
    step(); const b2 = await anon("auth.sendOtp", { email: "bela" + D });
    const wrong = (x) => String((Number(x) + 1) % 900000 + 100000) === b1.demo_code || String((Number(x) + 1) % 900000 + 100000) === b2.demo_code ? "100001" : String((Number(x) + 1) % 900000 + 100000);
    const bad5 = [];
    for (let i = 0; i < 5; i++) bad5.push(await T(() => anon("auth.verifyOtp", { email: "bela" + D, code: wrong(b1.demo_code) })));
    ok("D-07: five wrong codes are refused, the fifth says too many", bad5.every((x) => !x.ok && x.status === 401) && /doesn't match/.test(bad5[0].e) && /Too many wrong codes/.test(bad5[4].e), bad5.map((x) => x.e));
    const k1 = await T(() => anon("auth.verifyOtp", { email: "bela" + D, code: b1.demo_code })), k2 = await T(() => anon("auth.verifyOtp", { email: "bela" + D, code: b2.demo_code }));
    ok("D-07: a wrong code counts against every code still valid: two codes do not give ten guesses", !k1.ok && !k2.ok, [k1, k2]);
    for (let i = 0; i < 8; i++) { step(); await anon("auth.sendOtp", { email: "bela" + D }); }   // 10 in the hour, with wrong codes typed in it
    step(11 * 60);
    r = await T(() => anon("auth.sendOtp", { email: "bela" + D }));
    ok("D-07: after ten codes and a wrong guess in the hour no more are sent until the hour is over", !r.ok && r.status === 429 && /Too many codes requested/.test(r.e), r);
    step(50 * 60);
    r = await T(() => anon("auth.sendOtp", { email: "bela" + D }));
    ok("D-07: after the hour a code goes out again", r.ok, r);
    r = await T(() => anon("auth.sendOtp", { email: "bela" + D }));
    ok("D-07: the 45-second pause between emailed codes stays", !r.ok && r.status === 429 && /less than a minute ago/.test(r.e), r);
  } finally { Date.now = real; }
}

/* ================= D-08: Payment posting and Submission people, team leads too, get only their desk ================= */
{
  const feed = [...FEED(), P({ emp_id: "R1", name: "Ria Both", position: "Team Lead", department: "Posting", also_in_departments: "AR", project: SUN, reports_to: "Mona Manager", email: "ria" + D })];
  const w = await makeWorld({ feed });
  const { A, T, id, sun, sql, rows, row } = w;
  // Sunrise's desks: Pia is its Payment posting person, Suri its Submission person; Pooja is a posting team lead on the project but not set on the client
  await sql("UPDATE clients SET posting_mode = 'person', posting_lead = ?, submission_mode = 'person', submission_lead = ? WHERE id = ?", id["Pia Postlead"], id["Suri Sublead"], sun.id);
  const ids = (await rows("SELECT id FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT 6", sun.id)).map((x) => x.id);
  const [toPost, toSub, other, flagged] = ids, now = Date.now();
  await sql("UPDATE claims SET patient = 'Postdesk Zq', account_no = 'PDACCT1' WHERE id = ?", toPost);
  await sql("UPDATE claims SET patient = 'Subdesk Zq', account_no = 'SDACCT1' WHERE id = ?", toSub);
  await sql("UPDATE claims SET patient = 'Notadesk Zq', account_no = 'NDACCT1' WHERE id = ?", other);
  await sql("UPDATE claims SET patient = 'Flagged Zq', account_no = 'FLACCT1', escalated = 1, escalated_at = ?, assigned_to = ?, state = 'completed' WHERE id = ?", now - 10 * 86400000, id["Arun Agent"], flagged);
  const ho = (hid, claim, dept, lead, status, due) => sql("INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, due_at, biller_id, created_by, created_by_name, lead_id, reason, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    hid, claim, sun.id, dept, status, now - 9 * 86400000, due, id["Arun Agent"], id["Arun Agent"], "Arun Agent", lead, "", "made-up hand-off note");
  await ho("ho-post", toPost, "posting", id["Pia Postlead"], "pending", now - 5 * 86400000);
  await ho("ho-sub", toSub, "submission", id["Suri Sublead"], "client", now - 5 * 86400000);
  await sql("UPDATE handoffs SET paused_at = ? WHERE id = 'ho-sub'", now - 6 * 86400000);
  await sql("UPDATE claims SET state = 'in_process', handoff_status = 'posting' WHERE id = ?", toPost);
  const PO = await w.c("Pooja Postlead"), PI = await w.c("Pia Postlead"), SU = await w.c("Suri Sublead"), TI = await w.c("Tina Lead"), RB = await w.c("Ria Both");
  const has = (r, txt) => r.ok && JSON.stringify(r.r).includes(txt);
  const blocked = (r) => !r.ok && r.status === 403 && /AR's work/.test(r.e || "");

  S("D-08: a posting team lead who is not the client's posting person: the claims sent to the posting desk, nothing else");
  let r = await T(() => PO("claims.list", { client_id: sun.id, page_size: 500 }));
  ok("D-08: Claims shows the one claim sent to the posting desk, as before", r.ok && r.r.total === 1 && r.r.rows[0].id === toPost, r.ok ? r.r.total : r);
  for (const [op, p] of [["reports.arInventory", { client_id: sun.id }], ["reports.saveArInventory", { client_id: sun.id, name: "x", file_b64: "AAAA" }], ["claims.eligible", { client_id: sun.id }],
    ["claims.setState", { ids: [other], state: "excluded", reason: "made-up" }], ["claims.setPriority", { ids: [other], level: "top", category: "Other", comment: "a made-up reason here" }], ["claims.priorityLog", {}],
    ["attention.list", {}], ["attention.clientRequests", {}], ["queue.open", { id: other }], ["reports.work", { from_ms: 0, to_ms: now + 86400000 }], ["reports.desk", { from_ms: 0, to_ms: now + 86400000 }],
    ["creport.get", { client_id: sun.id, from: "2026-10-01", to: "2026-10-31" }], ["team.huddle", {}], ["denials.repeats", {}], ["supervisor.allocations", {}], ["inventory.status", {}], ["alloc.unassign", { ids: [flagged] }]]) {
    r = await T(() => PO(op, p));
    ok(`D-08: ${op} is refused (AR's work)`, blocked(r), r);
  }
  ok("D-08: nothing was excluded, reprioritised or taken off a list", (await row("SELECT state, priority_set FROM claims WHERE id = ?", other)).state === "open" && !(await row("SELECT priority_set FROM claims WHERE id = ?", other)).priority_set && (await row("SELECT assigned_to FROM claims WHERE id = ?", flagged)).assigned_to === id["Arun Agent"]);
  r = await T(() => PO("claims.get", { id: other }));
  ok("D-08: a claim not sent to the desk does not open", !r.ok && r.status === 403, r);
  r = await T(() => PO("claims.get", { id: toSub }));
  ok("D-08: nor one sent to Submission", !r.ok && r.status === 403, r);
  r = await T(() => PO("claims.timeline", { id: other }));
  ok("D-08: nor its history", !r.ok && r.status === 403, r);
  r = await T(() => PO("claims.get", { id: toPost }));
  ok("D-08: the claim on the posting desk opens", r.ok && r.r.claim.id === toPost, r);
  r = await T(() => PO("notes.add", { claim_id: other, comment: "a made-up note on another claim" }));
  ok("D-08: no note on a claim outside the desk", !r.ok && r.status === 403, r);
  r = await T(() => PO("search.global", { q: "Zq" }));
  ok("D-08: Search finds the desk's claim and none of the others", r.ok && r.r.claims.some((c) => c.id === toPost) && !has(r, "Notadesk") && !has(r, "Subdesk") && !has(r, "Flagged"), r.ok ? r.r.claims.map((c) => c.patient) : r);
  r = await T(() => PO("claims.suggest", { q: "Zq" }));
  ok("D-08: the search suggestions name no patient outside the desk", r.ok && r.r.values.includes("Postdesk Zq") && !r.r.values.some((v) => /Notadesk|Subdesk|Flagged/.test(v)), r.ok ? r.r.values : r);
  r = await T(() => PO("claims.byPatient", { id: toPost }));
  ok("D-08: All claims of this patient lists only the desk's claims", r.ok && r.r.rows.every((x) => x.id === toPost), r);
  r = await T(() => PO("claims.byPatient", { id: other }));
  ok("D-08: and not from a claim outside the desk", !r.ok, r);
  r = await T(() => PO("claims.stats", { client_id: sun.id }));
  ok("D-08: the claim figures count the desk's claims only", r.ok && r.r.states.reduce((t, x) => t + x.n, 0) === 1, r.ok ? r.r.states : r);
  r = await T(() => PO("handoffs.list", { dept: "submission", view: "all" }));
  ok("D-08: the desk list never gives Submission's hand-offs to a posting lead", r.ok && !has(r, "ho-sub") && !has(r, "Subdesk"), r);
  r = await T(() => PO("raci.missed", { client_id: sun.id, kind: "ar" }));
  const r2 = await T(() => PO("raci.missed", { client_id: sun.id, kind: "posting" }));
  ok("D-08: RACI's missed tasks: AR's refused, the posting desk's shown", !r.ok && r.status === 403 && r2.ok && r2.r.rows.some((x) => x.id === "ho-post"), [r, r2.ok ? r2.r.rows.length : r2]);
  r = await T(() => PO("client.overview", { client_id: sun.id, from_ms: 0, to_ms: now + 86400000 }));
  ok("D-08: Client 360's waiting on the client lists no other desk's claim", r.ok && !has(r, "Subdesk") && !has(r, "SDACCT1"), r.ok ? r.r.waiting : r);
  r = await T(() => PO("tat.list", {}));
  ok("D-08: the Past TAT list has the posting desk's task, not Submission's or AR's", r.ok && r.r.late.some((x) => x.ref_id === "ho-post") && r.r.late.every((x) => x.group === "desks" && x.dept === "posting"), r.ok ? r.r.late.map((x) => x.type) : r);
  const pv = await PO("tat.preview", { kind: "desks" }), pa = await PO("tat.preview", { kind: "ar" });
  const cno = async (cid) => (await row("SELECT claim_no FROM claims WHERE id = ?", cid)).claim_no;
  ok("D-08: the 09:00 reminder email has the posting desk only, and the 19:00 AR one has nothing for them", pv.mail && pv.mail.text.includes(await cno(toPost)) && !pv.mail.text.includes(await cno(toSub)) && !/· Submission ·/.test(pv.mail.text) && !pa.mail,
    [pv.mail && pv.mail.text.slice(0, 300), pa.mail && pa.mail.text.slice(0, 200)]);
  const sv = await SU("tat.preview", { kind: "desks" }), tv = await TI("tat.preview", { kind: "ar" });
  ok("D-08: the Submission lead's 09:00 email has Submission's task; an AR team lead's 19:00 email still has AR's flagged claim", sv.mail && sv.mail.text.includes(await cno(toSub)) && !sv.mail.text.includes(await cno(toPost)) && tv.mail && tv.mail.text.includes(await cno(flagged)),
    [sv.mail && sv.mail.text.slice(0, 200), tv.mail && tv.mail.text.slice(0, 200)]);
  r = await T(() => PO("tat.hold", { kind: "flag", id: flagged, reason: "Other", note: "made-up", until: w.today() }));
  ok("D-08: no Can't close yet on AR's flagged claim", !r.ok, r);
  r = await T(() => PO("reports.production", { scope: "ar", from_ms: 0, to_ms: now + 86400000 }));
  const r3 = await T(() => PO("reports.production", { scope: "pp", from_ms: 0, to_ms: now + 86400000 }));
  ok("D-08: Third Eye gets their own desk's production, never AR's entries", !r.ok && r.status === 403 && r3.ok, [r, r3.ok]);

  S("D-08: the client's own posting person keeps what README gives them, and still no AR inventory");
  r = await T(() => PI("claims.list", { client_id: sun.id, page_size: 500 }));
  ok("D-08: the client's posting person (a team lead) still lists every claim of the client (README: responsible means access)", r.ok && r.r.total > 100, r.ok ? r.r.total : r);
  r = await T(() => PI("claims.get", { id: other }));
  ok("D-08: and opens one to read", r.ok, r);
  for (const [op, p] of [["reports.arInventory", { client_id: sun.id }], ["claims.eligible", { client_id: sun.id }], ["claims.setState", { ids: [other], state: "excluded", reason: "made-up" }], ["attention.list", {}]]) {
    r = await T(() => PI(op, p));
    ok(`D-08: but ${op} is refused for them too`, blocked(r), r);
  }
  r = await T(() => SU("claims.get", { id: toSub }));
  ok("D-08: the Submission lead opens the claim on their desk", r.ok, r);
  r = await T(() => SU("handoffs.list", { dept: "posting", view: "all" }));
  ok("D-08: and never lists the posting desk", r.ok && !has(r, "ho-post"), r);

  S("D-08: AR keeps everything");
  for (const [op, p] of [["reports.arInventory", { client_id: sun.id }], ["claims.eligible", { client_id: sun.id }], ["attention.list", {}], ["claims.priorityLog", {}], ["team.huddle", {}], ["creport.get", { client_id: sun.id, from: "2026-10-01", to: "2026-10-31" }]]) {
    r = await T(() => TI(op, p));
    ok(`D-08: an AR team lead still uses ${op}`, r.ok, r);
  }
  r = await T(() => TI("claims.get", { id: other }));
  ok("D-08: and opens any claim of their client", r.ok, r);
  r = await T(() => RB("claims.eligible", { client_id: sun.id }));
  ok("D-08: someone on Posting who is also on AR keeps the AR view", r.ok, r);
  r = await T(() => A("reports.arInventory", { client_id: sun.id }));
  ok("D-08: and the admin", r.ok, r);
}

/* ================= D-11: odd input gets a plain refusal, never a server error ================= */
{
  const w = await makeWorld();
  const { A, T, id, sun, anon } = w;
  const TI = await w.c("Tina Lead"), AR = await w.c("Arun Agent");
  const bad = { toString: 1 }, bad2 = { valueOf: 1, toString: {} };
  S("D-11: an object with its own toString or valueOf, where text is expected");
  for (const [label, who, op, p] of [["signed out: auth.login", anon, "auth.login", { email: bad, passHash: "a".repeat(64) }], ["signed out: auth.lookup", anon, "auth.lookup", { q: bad }],
    ["signed out: auth.sendOtp", anon, "auth.sendOtp", { email: bad2 }], ["a biller: queue.list", AR, "queue.list", { q: bad }], ["a biller: notes.add", AR, "notes.add", { claim_id: "x", comment: bad2 }],
    ["a team lead: claims.list", TI, "claims.list", { state: bad }], ["a team lead: tasks.create", TI, "tasks.create", { client_id: sun.id, title: bad, scope: "AR follow-up", count: 1, people: [] }],
    ["deep inside: clients.save profile", A, "clients.save", { name: "Odd Clinic", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 30 }, resp: { ar: { lead: bad } } } }],
    ["inside a list: alloc.reassign", TI, "alloc.reassign", { ids: [bad], user_id: id["Arun Agent"] }]]) {
    const r = await T(() => who(op, p));
    ok(`D-11: ${label} gives a plain 400, not a server error`, !r.ok && r.status === 400 && /plain values/.test(r.e), r);
  }
  ok("D-11: nothing was made by the refused calls", !(await w.row("SELECT id FROM clients WHERE name = 'Odd Clinic'")));
  S("D-11: page numbers");
  let r = await T(() => TI("claims.list", { client_id: sun.id, page: 1e308 }));
  ok("D-11: claims.list with a huge page number answers (an empty page), no server error", r.ok && r.r.rows.length === 0 && r.r.page === 1000000 && r.r.total > 0, r.ok ? [r.r.page, r.r.total] : r);
  r = await T(() => TI("claims.list", { client_id: sun.id, page: -7, page_size: 20 }));
  const r2 = await T(() => TI("claims.list", { client_id: sun.id, page: "two", page_size: 20 }));
  ok("D-11: a page below 1 or not a number is page 1", r.ok && r.r.page === 1 && r.r.rows.length === 20 && r2.ok && r2.r.page === 1, [r.ok && r.r.page, r2.ok && r2.r.page]);
  r = await T(() => TI("claims.list", { client_id: sun.id, page: 2, page_size: 20 }));
  ok("D-11: an ordinary page 2 is still page 2", r.ok && r.r.page === 2 && r.r.rows.length === 20, r.ok ? r.r.page : r);
  S("D-11: ordinary input still goes through");
  r = await T(() => AR("auth.me", {}));
  const lk = await T(() => anon("auth.lookup", { q: "Tina" }));
  ok("D-11: plain text, numbers, lists and yes/no are untouched", r.ok && lk.ok && lk.r.matches.length === 1 && (await T(() => TI("claims.list", { client_id: sun.id, state: "open", worked_before: false, page_size: 10 }))).ok);
  r = await T(() => TI("creport.save", { client_id: sun.id, period_key: "month:2026-10", page_id: "summary", data: { note: "made-up words", toStringish: "kept", rows: [{ a: 1 }] } }));
  ok("D-11: keys that only look like toString are fine", r.ok, r);
}

/* ================= D-14: the idle sign-out counts real input in the embedded pages, not focus left there ================= */
{
  // The idle timer runs in the browser only; this reads the page's code (the browser check that clicks and waits is in the fix notes).
  const fs = await import("fs");
  const src = fs.readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  const hook = src.slice(src.indexOf("function useIdleSignOut"), src.indexOf("function useIdleSignOut") + 3500);
  S("D-14: idle sign-out and the embedded Third Eye / SLA pages");
  const tick = hook.slice(hook.indexOf("setInterval(() => {"), hook.indexOf("}, 1000);"));
  ok("D-14: focus left inside an embedded page no longer counts as activity every second", tick.length > 100 && !/IFRAME|hasFocus/.test(tick) && !/hasFocus\(\)/.test(hook), tick.slice(0, 300));
  ok("D-14: real input inside the embedded pages counts (mouse, keys, touch, wheel on the frame's own page)", /contentDocument/.test(hook) && /frameEvs\.forEach\(\(e\) => d\.addEventListener\(e, mark/.test(hook) && /"keydown"/.test(hook) && /"mousemove"/.test(hook));
  ok("D-14: the built page carries the same code", fs.readFileSync(new URL("../../app/app.js", import.meta.url), "utf8").includes("contentDocument"));
}

/* ================= N-07: Live status shows no claim of a client the viewer does not have ================= */
{
  const w = await makeWorld();
  const { A, T, id, sun, lake, rows } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead"), AR = await w.c("Arun Agent"), DV = await w.c("Dev Agent");
  const sunIds = (await rows("SELECT id, claim_no FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT 2", sun.id));
  const lakeIds = (await rows("SELECT id, claim_no FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT 2", lake.id));
  await A("alloc.reassign", { ids: sunIds.map((x) => x.id), user_id: id["Arun Agent"] });
  await A("alloc.reassign", { ids: lakeIds.map((x) => x.id), user_id: id["Dev Agent"] });
  await AR("queue.open", { id: sunIds[0].id });
  await DV("queue.open", { id: lakeIds[0].id });
  await LA("clients.accessSave", { client_id: lake.id, user_id: id["Arun Agent"], level: "view" });   // Lara shares her client with Tina's biller
  const rowOf = async (who, uid) => { const h = await who("team.huddle", { today: w.today() }); return { h, r: h.rows.find((x) => x.id === uid) }; };
  S("N-07: a claim open on another client is not shown");
  let { h, r } = await rowOf(LA, id["Arun Agent"]);
  ok("N-07: Lara (Lakeview) still sees Tina's biller on Live status once she shared Lakeview with him", !!r, h.rows.map((x) => x.name));
  ok("N-07: but nothing of the Sunrise claim he has open: no claim number, client, payer or balance", r && r.current && r.current.elsewhere === true && !r.current.id && !r.current.claim_no && !r.current.client && !r.current.payer && r.current.balance == null && !JSON.stringify(h).includes(sunIds[0].claim_no), r && r.current);
  ({ h, r } = await rowOf(TI, id["Arun Agent"]));
  ok("N-07: his own team lead sees the claim, as before", r && r.current && r.current.id === sunIds[0].id && r.current.claim_no === sunIds[0].claim_no && r.current.client === "Sunrise Eye Care", r && r.current);
  ({ h, r } = await rowOf(TI, id["Dev Agent"]));
  ok("N-07: a team lead's own biller on a client the lead does not have: shown working, the claim not shown", r && r.current && r.current.elsewhere === true && !JSON.stringify(h).includes(lakeIds[0].claim_no), r && r.current);
  ({ h, r } = await rowOf(LA, id["Dev Agent"]));
  ok("N-07: the team lead of that client sees it", r && r.current && r.current.claim_no === lakeIds[0].claim_no && r.current.client === "Lakeview Dental Group", r && r.current);
  ({ h, r } = await rowOf(A, id["Arun Agent"]));
  ok("N-07: the admin sees every claim, as before", r && r.current && r.current.claim_no === sunIds[0].claim_no, r && r.current);
}

/* ================= N-08: a client save that is refused changes nothing ================= */
{
  const w = await makeWorld();
  const { A, T, id, sun, row } = w;
  const TI = await w.c("Tina Lead");
  const snap = async () => JSON.stringify(await row("SELECT name, code, follow_up_days, active, workbook_link, scope_json, targets_json, ar_lead FROM clients WHERE id = ?", sun.id));
  const good = { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: id["Tina Lead"] } } };
  S("N-08: client edit: every check before the first write");
  let before = await snap();
  let r = await T(() => TI("clients.save", { id: sun.id, name: "Renamed Sunrise", code: "ZZ", follow_up_days: 9, active: false, workbook_link: "https://example.org/x.xlsx", profile: { scope: ["ar"], targets: {}, resp: {} } }));
  ok("N-08: a client save the profile check refuses leaves the name, code, follow-up days, active and link as they were", !r.ok && /daily target/.test(r.e) && (await snap()) === before, [r, before, await snap()]);
  r = await T(() => TI("clients.save", { id: sun.id, name: "Renamed Sunrise", code: "ZZ", follow_up_days: 9, active: true, workbook_link: "not a link", profile: good }));
  ok("N-08: so does one refused for a bad production file link", !r.ok && /https/.test(r.e) && (await snap()) === before, r);
  r = await T(() => TI("clients.save", { id: sun.id, name: "Sunrise Eye Care West", code: "SEW", follow_up_days: 21, active: true, profile: good }));
  const now1 = await row("SELECT name, code, follow_up_days, targets_json FROM clients WHERE id = ?", sun.id);
  ok("N-08: a save that passes writes the name, code, follow-up days and the profile together", r.ok && now1.name === "Sunrise Eye Care West" && now1.code === "SEW" && now1.follow_up_days === 21 && JSON.parse(now1.targets_json).ar === 40, [r, now1]);
  ok("N-08: and its change is in the audit trail", (await w.audits("client.save")).some((a) => /name Sunrise Eye Care → Sunrise Eye Care West/.test(a.detail)));
  r = await T(() => TI("clients.save", { id: sun.id, name: "Sunrise Eye Care", code: "SEC", follow_up_days: 30, active: true }));
  ok("N-08: a save without a profile still changes the name and code", r.ok && (await row("SELECT name FROM clients WHERE id = ?", sun.id)).name === "Sunrise Eye Care", r);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
