/* Suite 39: regression checks for the bug-test fixes on access, sign-in and data safety (tester D's findings and E-06 / E-07).
   Each check carries the finding it guards. A made-up Shastra roster with every kind of person, a stand-in for Drishti that checks
   the token the way Drishti does, and a mail hook that only counts. Made-up data only. */
import crypto from "crypto";
import { makeRig } from "./rig.mjs";
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
  const calls = [];
  const verify = (t) => { const [p, s] = String(t || "").split("."); if (!p || !s) return null; const payload = Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    const sig = crypto.createHmac("sha256", DR_SECRET).update(payload).digest("base64").replace(/\+/g, "-").replace(/\//g, "_"); return sig === s ? payload.split("|") : null; };
  const handle = async (url, init) => {
    if (!url.includes("script.google.com")) return null;
    const b = JSON.parse(init.body); calls.push(b.a);
    if (b.a === "signup") { const u = { id: "du-" + users.length, email: b.email, name: b.name, role: b.role }; users.push(u); return J({ ok: true, user: u }); }
    const me = verify(b.t); if (!me) return J({ ok: false, code: "auth", error: "Please sign in again." });
    if (b.a === "me") return J({ ok: true, user: me[0] === "admin" ? { id: "admin", email: DR_ADMIN_EMAIL, role: "admin" } : users.find((u) => u.id === me[0]) });
    if (b.a === "users.list") return J({ ok: true, users });
    if (b.a === "managers.list") return J({ ok: true, managers });
    return J({ ok: false, error: "not in the stand-in" });
  };
  return { handle, users, calls, verify };
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

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
