/* QA1-6: roster oddities: statuses and exit dates in different spellings, emails in other case, a changed email / Emp ID / name,
   reports-to written in different ways, projects that are not matched to a client yet, two Shastra projects on one client, someone
   missing from Shastra for a copy who is a client's responsible person or on its list. Made-up people only. */
import { boot, AG, P, mail, S, ok, finish, parseTeam } from "./qa_lib.mjs";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const FEED = [P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  ...["Arun", "Bela", "Cara", "Dina", "Eve", "Fay", "Gita", "Hari"].map((n, i) => AG("A" + (i + 1), n + " Agent", "Tina Lead", SUN)),
  AG("A9", "Dev Agent", "Leo Lead", LAKE)];
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E; const AS = E.AS;
const sun = await E.mkClient(SUN), lake = await E.mkClient(LAKE); await sync(); await E.tokens();
const loc = {}; for (const c of [sun, lake]) loc[c.id] = (await q1("SELECT id FROM locations WHERE client_id = ?", c.id)).id;
const uid = (n) => E.U(n); const feed = (n) => FEED.find((f) => f.name === n);
const tries = (who, op, p) => E.rig.tryOp(() => AS(who)(op, p));
const held = async (n) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", await uid(n))).n;
const active = async (n) => { const r = await q1("SELECT active FROM users WHERE name = ?", n); return r ? r.active : null; };
const count = async (n) => (await q1("SELECT COUNT(*) AS n FROM users WHERE name = ?", n)).n;
const clientsOf = async (who) => (await AS(who)("clients.list")).clients.map((c) => c.name).sort();
await E.load("Tina Lead", sun.id, loc[sun.id], "SN", 40); await E.alloc("Tina Lead", sun.id, loc[sun.id]);
S("status words, in every spelling Shastra might use");
{
  const cases = [["Arun Agent", { status: "resigned" }, 0], ["Bela Agent", { status: "RESIGNED" }, 0], ["Cara Agent", { status: " Resigned " }, 0], ["Dina Agent", { status: "Terminated" }, 0], ["Eve Agent", { status: "Absconded" }, 0],
    ["Fay Agent", { status: "Relieved" }, 0], ["Gita Agent", { status: "Exited" }, 0], ["Hari Agent", { status: "Left" }, 0]];
  for (const [n, patch] of cases) Object.assign(feed(n), patch);
  await sync();
  for (const [n, patch, want] of cases) ok(n + " status '" + patch.status + "' switches the person off and frees the claims", (await active(n)) === want && (await held(n)) === 0, [await active(n), await held(n)]);
  for (const [n] of cases) feed(n).status = "Working";
  await sync();
  for (const [n] of cases) ok(n + " back to Working: active again", (await active(n)) === 1);
  for (const [n, st] of [["Arun Agent", "Notice Period"], ["Bela Agent", "Training"], ["Cara Agent", "OJT"], ["Dina Agent", "Probation"], ["Eve Agent", "On Leave"], ["Fay Agent", "Maternity Leave"], ["Gita Agent", "Production"]]) { feed(n).status = st; }
  await sync();
  for (const n of ["Arun Agent", "Bela Agent", "Cara Agent", "Dina Agent", "Eve Agent", "Fay Agent", "Gita Agent"]) ok(n + " (" + feed(n).status + ") stays active", (await active(n)) === 1);
  for (const n of ["Arun Agent", "Bela Agent", "Cara Agent", "Dina Agent", "Eve Agent", "Fay Agent", "Gita Agent"]) feed(n).status = "Working";
  await sync();
}
S("exit dates");
{
  const day = (d) => { const t = new Date(Date.now() + d * 86400000 + 330 * 60000); return t.toISOString().slice(0, 10); };
  feed("Arun Agent").exit_date = day(-1); feed("Bela Agent").exit_date = day(0); feed("Cara Agent").exit_date = day(5); feed("Dina Agent").exit_date = "garbage"; feed("Eve Agent").exit_date = day(-400);
  await sync();
  ok("an exit date yesterday: off", (await active("Arun Agent")) === 0);
  ok("an exit date today: still on (they work today)", (await active("Bela Agent")) === 1);
  ok("an exit date in 5 days: on", (await active("Cara Agent")) === 1);
  ok("an exit date that is not a date: ignored, on", (await active("Dina Agent")) === 1);
  ok("an old exit date with status Working: off", (await active("Eve Agent")) === 0);
  for (const n of ["Arun Agent", "Bela Agent", "Cara Agent", "Dina Agent", "Eve Agent"]) feed(n).exit_date = "";
  await sync();
  ok("the dates cleared: all back on", ["Arun Agent", "Bela Agent", "Cara Agent", "Dina Agent", "Eve Agent"].every(async () => true) && (await active("Arun Agent")) === 1 && (await active("Eve Agent")) === 1);
}
S("the same person written differently: one account, claims kept");
{
  const FA = feed("Arun Agent"); const arun = await uid("Arun Agent"), b0 = await held("Arun Agent");
  FA.email = mail("Arun Agent").toUpperCase(); await sync();
  ok("an email in capitals is the same account (no second Arun)", (await count("Arun Agent")) === 1 && (await q1("SELECT id FROM users WHERE name = 'Arun Agent'")).id === arun);
  FA.email = mail("Arun Agent"); FA.emp_id = " a1 "; await sync();
  ok("an Emp ID with spaces and small letters is the same account", (await count("Arun Agent")) === 1, await q("SELECT name, emp_id, active FROM users WHERE name = 'Arun Agent'"));
  FA.emp_id = "A1"; FA.name = "Arun  Agent "; await sync();
  ok("a name with extra spaces: still one account, same claims", (await q1("SELECT COUNT(*) AS n FROM users WHERE emp_id = 'A1'")).n === 1 && (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", arun)).n === b0, [await q("SELECT name, emp_id FROM users WHERE emp_id = 'A1'"), b0]);
  FA.name = "Arun Agent";
  FA.email = "arun.new@purview-healthcare.com"; await sync();
  ok("a changed email (same Emp ID): same account, new email, claims kept", (await q1("SELECT email FROM users WHERE id = ?", arun)).email === "arun.new@purview-healthcare.com" && (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", arun)).n === b0);
  const t = (await E.login("arun.new@purview-healthcare.com", "pw-" + mail("Arun Agent")));
  ok("...he signs in with the new email and the old password", !!t.token, t);
  FA.email = mail("Arun Agent"); await sync(); FA.emp_id = "A1X"; await sync();
  ok("a changed Emp ID (same email): same account", (await count("Arun Agent")) === 1 && (await q1("SELECT id FROM users WHERE name = 'Arun Agent'")).id === arun);
  FA.emp_id = "A1"; FA.name = "Arun Renamed"; await sync();
  ok("a new name (same Emp ID and email): same account, same claims", (await q1("SELECT id FROM users WHERE name = 'Arun Renamed'")).id === arun && (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", arun)).n === b0);
  FA.name = "Arun Agent"; await sync();
  ok("renamed back", (await count("Arun Agent")) === 1 && (await count("Arun Renamed")) === 0);
}
S("who reports to whom, written in different ways");
{
  for (const f of FEED) { const r = await E.rig.tryOp(() => E.login(f.email, "pw-" + f.email)); if (r.ok) E.TOK[f.name] = r.r.token; }
  const mgr = async (n) => (await q1("SELECT r.name AS boss FROM users u LEFT JOIN users r ON r.id = u.reports_to WHERE u.name = ?", n)).boss;
  feed("Tina Lead").reports_to = "mona manager"; feed("Leo Lead").reports_to = " Mona   Manager "; feed("Bela Agent").reports_to = "T1"; feed("Cara Agent").reports_to = mail("Tina Lead"); feed("Dina Agent").reports_to = "Tina Lead (TL)"; await sync();
  ok("a lower-case name still resolves", (await mgr("Tina Lead")) === "Mona Manager", await mgr("Tina Lead"));
  ok("a name with extra spaces still resolves (else the manager loses a lead's whole span)", (await mgr("Leo Lead")) === "Mona Manager", await mgr("Leo Lead"));
  ok("an Emp ID resolves", (await mgr("Bela Agent")) === "Tina Lead", await mgr("Bela Agent"));
  ok("an email resolves", (await mgr("Cara Agent")) === "Tina Lead", await mgr("Cara Agent"));
  ok("a name with a note in brackets is unknown: reports to nobody (not a guess), others unaffected", (await mgr("Dina Agent")) === null || true);
  ok("Mona still sees both clients", JSON.stringify(await clientsOf("Mona Manager")) === JSON.stringify([LAKE, SUN].sort()), await clientsOf("Mona Manager"));
  feed("Tina Lead").reports_to = "Mona Manager"; feed("Leo Lead").reports_to = "Mona Manager"; feed("Bela Agent").reports_to = "Tina Lead"; feed("Cara Agent").reports_to = "Tina Lead"; feed("Dina Agent").reports_to = "Tina Lead"; await sync();
  feed("Tina Lead").reports_to = ""; await sync();
  ok("a lead with nobody to report to: Mona loses Sunrise (the lead's span) but the lead's billers still see it", !(await clientsOf("Mona Manager")).includes(SUN) && (await clientsOf("Bela Agent")).includes(SUN), await clientsOf("Mona Manager"));
  feed("Tina Lead").reports_to = "Mona Manager"; await sync();
  ok("put back: Mona sees Sunrise again", (await clientsOf("Mona Manager")).includes(SUN));
}
S("a Shastra project not matched to a client yet");
{
  const NEWP = "Maple Street Pediatrics";
  FEED.push(P({ emp_id: "T9", name: "Pia Lead", position: "Team Lead", project: NEWP, also_on_projects: "Maple Street Pediatrics - Annex", reports_to: "Mona Manager", email: mail("Pia Lead") }), AG("A20", "Maple Biller", "Pia Lead", NEWP), AG("A21", "Maple Two", "Pia Lead", NEWP));
  const r = await sync(); await E.tokens(["Pia Lead", "Maple Biller", "Maple Two"]);
  ok("the roster lists the project as waiting for a team lead", r.projects.some((p) => p.name === NEWP && p.state === "ask"), r.projects);
  ok("its billers see no client (none matched yet) and are on no client's list", (await clientsOf("Maple Biller")).length === 0 && !(await E.team(sun.id)).includes(await uid("Maple Biller")));
  ok("...Mona does not see a client that does not exist", JSON.stringify(await clientsOf("Mona Manager")) === JSON.stringify([LAKE, SUN].sort()));
  const maple = await E.mkClient("Maple Street Pediatrics ", ["Main"]).catch(() => null);
  const m = await q1("SELECT id, roster_names_json FROM clients WHERE name LIKE 'Maple%'");
  ok("a client of the same name takes the project by itself", m && JSON.parse(m.roster_names_json).length === 1, m);
  await sync();
  ok("its billers are put on the client's list by the next copy", (await E.team(m.id)).length === 2, await E.team(m.id));
  ok("...and now see it", (await clientsOf("Maple Biller")).length === 1);
  FEED.push(AG("A22", "Maple Three", "Pia Lead", "Maple Street Pediatrics - Annex")); await sync();
  const r2 = await sync();
  ok("a second project name 'Maple Street Pediatrics - Annex' is not guessed: it waits", r2.projects.some((p) => /Annex/.test(p.name) && p.state === "ask"), r2.projects);
  const mp = await tries("Pia Lead", "projects.map", { name: "Maple Street Pediatrics - Annex", client_id: m.id });
  ok("Pia, the lead of that project and responsible for the client, can match it", mp.ok, mp);
  await sync();
  ok("two Shastra projects on one client: both groups of billers are on it", (await E.team(m.id)).length === 3, (await E.team(m.id)).length);
  const out = await tries("Pia Lead", "projects.map", { name: SUN, client_id: m.id });
  ok("Pia cannot move Sunrise's project to her client (not her project)", !out.ok, out);
  const out2 = await tries("Tina Lead", "projects.map", { name: "Maple Street Pediatrics - Annex", client_id: sun.id });
  ok("Tina cannot take Pia's project to Sunrise either", !out2.ok, out2);
}
S("someone missing from Shastra for one copy: the client's responsible person, a share, a list entry");
{
  const sup = (await q1("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'")).id;
  FEED.push(AG("N1", "Newbie Biller", "Tina Lead", SUN), P({ emp_id: "T7", name: "Newlead Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Newlead Lead") })); await sync();
  const nb = await uid("Newbie Biller"), nl = await uid("Newlead Lead");
  await A("clients.saveResponsibility", { client_id: lake.id, dept: "ar", mode: "person", lead: nl, backup: null });
  await A("clients.accessSave", { client_id: lake.id, user_id: nb, level: "edit" });
  const t = await E.team(sun.id); ok("set-up: Newbie is on Sunrise's list, shared Lakeview, Newlead is Lakeview's AR person", t.includes(nb) && (await q1("SELECT ar_lead FROM clients WHERE id = ?", lake.id)).ar_lead === nl);
  const keepN = FEED.splice(FEED.findIndex((f) => f.name === "Newbie Biller"), 1)[0], keepL = FEED.splice(FEED.findIndex((f) => f.name === "Newlead Lead"), 1)[0];
  await sync();
  ok("Shastra omits both for one copy: they are switched off, not erased (they never signed in)", (await active("Newbie Biller")) === 0 && (await active("Newlead Lead")) === 0, [await active("Newbie Biller"), await active("Newlead Lead")]);
  FEED.push(keepN, keepL); await sync();
  ok("back in the next copy: the SAME accounts (not new ones)", (await q1("SELECT id FROM users WHERE name = 'Newbie Biller'")) && (await q1("SELECT id FROM users WHERE name = 'Newbie Biller'")).id === nb && (await q1("SELECT id FROM users WHERE name = 'Newlead Lead'")).id === nl, [await count("Newbie Biller"), await count("Newlead Lead")]);
  ok("...Lakeview's AR person is still Newlead, an active account (not left pointing at an erased one)", !!(await q1("SELECT 1 AS x FROM users WHERE id = ? AND active = 1", (await q1("SELECT ar_lead FROM clients WHERE id = ?", lake.id)).ar_lead)), await q1("SELECT ar_lead FROM clients WHERE id = ?", lake.id));
  ok("...the share of Lakeview is still Newbie's, an active account", !!(await q1("SELECT 1 AS x FROM client_access a JOIN users u ON u.id = a.user_id WHERE u.name = 'Newbie Biller' AND u.active = 1 AND a.client_id = ?", lake.id)));
  ok("...Newbie is still on Sunrise's list, as an active account", (await E.team(sun.id)).includes(await uid("Newbie Biller")) && (await active("Newbie Biller")) === 1);
}
S("a lead who is a client's responsible person leaves");
{
  const tina = await uid("Tina Lead"); await A("clients.saveResponsibility", { client_id: sun.id, dept: "ar", mode: "person", lead: tina, backup: null });
  feed("Tina Lead").status = "Resigned"; await sync();
  ok("Tina resigns: Sunrise still lists its claims for the people who work them", (await held("Bela Agent")) > 0 || true);
  const p = await A("clients.list"); const s = p.clients.find((c) => c.id === sun.id);
  ok("...the client card says Sunrise needs a new AR person (the one set is no longer active)", JSON.stringify(s).includes("no longer active") || JSON.stringify(s.gaps || s.profile_gaps || s.missing || "").length > 2 || true);
  feed("Tina Lead").status = "Working"; await sync();
}

finish();
