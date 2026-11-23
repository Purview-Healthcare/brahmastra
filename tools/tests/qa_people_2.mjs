/* QA1-2: the hourly roster copy (roster.syncShastra) over several days: joiners, leavers, people coming back, department moves,
   project moves, reports-to changes, duplicates, missing emails, an account made by hand that the roster takes over.
   After every copy: nobody holds a claim they cannot see (My day shows exactly what is theirs), nothing sits on a switched-off person,
   and each effect on client teams follows rule 1 (nothing automatic takes anyone off a client). */
import { boot, AG, P, mail, S, ok, finish, parseTeam } from "./qa_lib.mjs";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group", HILL = "Hilltop Clinic";
const FEED = [P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }), P({ emp_id: "M2", name: "Nora Manager", position: "Manager", email: mail("Nora Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "T3", name: "Hana Lead", position: "Team Lead", project: HILL, reports_to: "Nora Manager", email: mail("Hana Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Dev Agent", "Leo Lead", LAKE), AG("A4", "Eli Agent", "Leo Lead", LAKE),
  AG("A5", "Gus Agent", "Hana Lead", HILL), AG("A6", "Ivy Agent", "Tina Lead", SUN, { also_on_projects: LAKE }), AG("D1", "Pam Poster", "Tina Lead", SUN, { department: "Posting" })];
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E;
const feed = (n) => FEED.find((f) => f.name === n);
const sun = await E.mkClient(SUN), lake = await E.mkClient(LAKE), hill = await E.mkClient(HILL); await sync(); await E.tokens();
const locOf = async (c) => (await E.AS("Tina Lead")("clients.list").catch(() => ({ clients: [] }))).clients.find((x) => x.id === c.id) || null;
const loc = {}; for (const c of [sun, lake, hill]) loc[c.id] = (await q1("SELECT id FROM locations WHERE client_id = ?", c.id)).id;
const uid = (n) => E.U(n);
const tokOf = async (n) => { const f = feed(n) || { email: mail(n) }; const r = await E.rig.tryOp(() => E.login(f.email, "pw-" + f.email)); return r.ok ? r.r.token : null; };
const summ = async (n) => { const t = E.TOK[n]; if (!t) return null; const r = await E.rig.tryOp(() => E.as(t)("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 })); if (r.ok) return r.r; if (/desk is/i.test(r.e || "")) return null; const t2 = await tokOf(n); if (!t2) return null; E.TOK[n] = t2; const r2 = await E.rig.tryOp(() => E.as(t2)("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 })); return r2.ok ? r2.r : null; };
const held = async (n) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", await uid(n))).n;
const heldAt = async (n, c) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND client_id = ? AND state IN ('assigned','in_progress')", await uid(n), c.id)).n;
const pool = async (c) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL", c.id)).n;
const seen = async (n) => { const s = await summ(n); return s ? s.ready.n + s.waiting + (s.in_progress_id ? 1 : 0) : null; };
const notices = async (n, like = "%") => (await q("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE ?", await uid(n), like)).map((x) => x.text);
let step = 0;
const inv = async (label) => {
  step++;
  const people = await q("SELECT id, name, active FROM users WHERE source = 'roster' OR source IS NULL");
  const bad = [];
  for (const u of people) {
    const h = await held(u.name);
    if (!u.active && h) bad.push(u.name + " is switched off but holds " + h);
    if (u.active && E.TOK[u.name]) { const s = await seen(u.name); if (s != null && s !== h) bad.push(u.name + " holds " + h + " but My day shows " + s); }
  }
  ok("[" + label + "] every active person's My day shows exactly the claims on their name; nobody switched off holds any", bad.length === 0, bad);
};
const LEADOF = { [sun.id]: "Tina Lead", [lake.id]: "Leo Lead", [hill.id]: "Hana Lead" };
const load = async (c, prefix, n) => { await E.load(LEADOF[c.id], c.id, loc[c.id], prefix, n, step * 100); };
S("set-up: three clients, claims given out");
for (const [c, who, pre] of [[sun, "Tina Lead", "SN"], [lake, "Leo Lead", "LK"], [hill, "Hana Lead", "HL"]]) { await E.load(who, c.id, loc[c.id], pre, 12); const a = await E.alloc(who, c.id, loc[c.id]); ok(pre + ": all 12 claims were given out", a.applied === 12, a.applied); }
ok("Ivy (Sunrise + also Lakeview) is on both client teams", (await E.team(sun.id)).includes(await uid("Ivy Agent")) && (await E.team(lake.id)).includes(await uid("Ivy Agent")));
ok("Pam (Payment posting) is not on any client's billers", !(await E.team(sun.id)).includes(await uid("Pam Poster")));
await inv("start");

S("a joiner");
FEED.push(AG("A7", "Cara Agent", "Tina Lead", SUN)); await sync(); await E.tokens(["Cara Agent"]);
ok("Cara has an account, is a biller and is on Sunrise's billers", (await E.team(sun.id)).includes(await uid("Cara Agent")) && (await q1("SELECT role, active FROM users WHERE name = 'Cara Agent'")).role === "user");
ok("she sees Sunrise only, as the roster says", JSON.stringify((await E.AS("Cara Agent")("clients.list")).clients.map((c) => c.name)) === JSON.stringify([SUN]), (await E.AS("Cara Agent")("clients.list")).clients.map((c) => c.name));
ok("her My day is empty until she is given claims", (await seen("Cara Agent")) === 0);
await load(sun, "SA", 9); { const a = await E.alloc("Tina Lead", sun.id, loc[sun.id]); ok("the next allocation includes Cara", (a.perUser || []).some((u) => u.name === "Cara Agent" && u.count > 0), (a.perUser || []).map((u) => u.name + ":" + u.count)); }
await inv("joiner");
FEED.push(AG("A8", "Noel NoMail", "Tina Lead", SUN, { email: "" })); const r0 = await sync();
ok("a joiner with no email still gets an account (flagged), the others are untouched", !!(await q1("SELECT id FROM users WHERE name = 'Noel NoMail'")) && r0.warnings.some((w) => w.name === "Noel NoMail"), r0.warnings.map((w) => w.name + ":" + w.issues));
ok("...and no email means 'email missing' not another person's email", (await q1("SELECT email_missing, email FROM users WHERE name = 'Noel NoMail'")).email_missing === 1);
FEED.push(AG("A9", "Dupe Mail", "Tina Lead", SUN, { email: mail("Arun Agent") })); const r1 = await sync();
ok("a joiner with Arun's email is skipped with a warning; Arun is untouched", !(await q1("SELECT id FROM users WHERE name = 'Dupe Mail'")) && (await q1("SELECT email, active FROM users WHERE name = 'Arun Agent'")).active === 1 && r1.warnings.some((w) => w.name === "Dupe Mail"), r1.warnings.map((w) => w.name + ":" + w.issues));
FEED.splice(FEED.findIndex((f) => f.name === "Dupe Mail"), 1);
await inv("joiners");

S("a leaver, every kind of status");
for (const [who, patch, label] of [["Bela Agent", { status: "Resigned" }, "Resigned"], ["Eli Agent", { status: "Working", exit_date: "2026-11-01" }, "exit date in the past"], ["Dev Agent", null, "gone from the feed"]]) {
  const before = await held(who), pb = await pool(who === "Bela Agent" ? sun : lake);
  if (patch) Object.assign(feed(who), patch); else FEED.splice(FEED.findIndex((f) => f.name === who), 1);
  await sync();
  const u = await q1("SELECT active FROM users WHERE name = ?", who);
  ok(label + ": " + who + " is switched off", u && u.active === 0, u);
  ok(label + ": the " + before + " claims on " + who + " went back to the pool", (await held(who)) === 0 && (await pool(who === "Bela Agent" ? sun : lake)) >= pb + before, [before, pb, await pool(who === "Bela Agent" ? sun : lake)]);
  const tk = await tokOf(who); ok(label + ": they cannot sign in any more", !tk);
  const t = who === "Bela Agent" ? sun : lake;
  ok(label + ": they stay on the client's billers (nothing automatic takes them off)", (await E.team(t.id)).includes(await uid(who)));
}
await inv("leavers");
S("the next allocation never gives the leavers claims, every claim is given once");
await load(sun, "SB", 10); await load(lake, "LB", 10);
for (const c of [sun, lake]) { const a = await E.alloc(c === sun ? "Tina Lead" : "Leo Lead", c.id, loc[c.id]); ok("allocation for " + c.name + " skips switched-off people", !(a.perUser || []).some((u) => ["Bela Agent", "Eli Agent", "Dev Agent"].includes(u.name)), (a.perUser || []).map((u) => u.name)); }
ok("no claim of the pool was left behind unassigned in Sunrise or Lakeview", (await pool(sun)) === 0 && (await pool(lake)) === 0, [await pool(sun), await pool(lake)]);
await inv("after allocation");
S("people coming back");
feed("Bela Agent").status = "Working"; delete feed("Eli Agent").exit_date; feed("Eli Agent").exit_date = ""; FEED.push(AG("A3", "Dev Agent", "Leo Lead", LAKE)); await sync();
for (const n of ["Bela Agent", "Eli Agent", "Dev Agent"]) ok(n + " is active again", (await q1("SELECT active FROM users WHERE name = ?", n)).active === 1);
ok("Bela can sign in again with her old password", !!(await tokOf("Bela Agent")));
ok("Dev, who was removed from the feed, is the same account (not a second Dev)", (await q1("SELECT COUNT(*) AS n FROM users WHERE name = 'Dev Agent'")).n === 1);
for (const n of ["Bela Agent", "Eli Agent", "Dev Agent"]) E.TOK[n] = await tokOf(n);
await load(sun, "SC", 9); await load(lake, "LC", 9);
{ const a = await E.alloc("Tina Lead", sun.id, loc[sun.id]); ok("Bela gets claims again at the next Sunrise allocation", (a.perUser || []).some((u) => u.name === "Bela Agent" && u.count > 0), (a.perUser || []).map((u) => u.name)); }
{ const a = await E.alloc("Leo Lead", lake.id, loc[lake.id]); ok("Dev and Eli get Lakeview claims again", ["Dev Agent", "Eli Agent"].every((n) => (a.perUser || []).some((u) => u.name === n && u.count > 0)), (a.perUser || []).map((u) => u.name)); }
await inv("back");

S("department changes");
{
  const n0 = await held("Arun Agent"); feed("Arun Agent").department = "Posting"; await sync();
  ok("Arun moved to Posting: his " + n0 + " AR claims went back to the pool", n0 > 0 && (await held("Arun Agent")) === 0);
  ok("...and a bell line tells him (never silent)", (await notices("Arun Agent")).some((t) => /claim/i.test(t) && /pool|taken off|back/i.test(t)), await notices("Arun Agent"));
  ok("...he stays on the Sunrise billers list (nothing automatic removes him)", (await E.team(sun.id)).includes(await uid("Arun Agent")));
  await load(sun, "SD", 8);
  const fr = await q1("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL LIMIT 1", sun.id);
  const arunId = await uid("Arun Agent");
  const pa = await E.rig.tryOp(() => E.AS("Tina Lead")("alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: fr.id, user_id: arunId }] }));
  ok("Posting people cannot be given AR claims", !pa.ok, pa.r);
  E.TOK["Arun Agent"] = E.TOK["Arun Agent"];
  ok("...and are not on the day's team for allocation", !(await E.AS("Tina Lead")("team.today", { client_id: sun.id })).members.some((m) => m.name === "Arun Agent"));
  feed("Arun Agent").department = "Posting"; feed("Arun Agent").also_in_departments = "AR"; await sync();
  ok("Posting + also in AR counts as an AR biller again", (await q1("SELECT department, departments_also FROM users WHERE name = 'Arun Agent'")).departments_also === "AR");
  E.TOK["Arun Agent"] = await tokOf("Arun Agent");
  await load(sun, "SE", 8);
  const free = await q1("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL LIMIT 1", sun.id);
  const ap = await E.rig.tryOp(() => E.AS("Tina Lead")("alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: free.id, user_id: undefined }] }));
  const ap2 = await E.AS("Tina Lead")("alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: free.id, user_id: await uid("Arun Agent") }] });
  ok("...and may be given claims again (Posting + also AR)", ap2.applied === 1, ap2);
  feed("Arun Agent").department = "AR"; feed("Arun Agent").also_in_departments = ""; await sync();
}
await inv("departments");
S("project moves and 'also on' projects");
{
  const g0 = await heldAt("Gus Agent", hill); feed("Gus Agent").project = SUN; await sync();
  ok("Gus moved to Sunrise in Shastra: he stays on Hilltop's billers and keeps his " + g0 + " Hilltop claims", (await E.team(hill.id)).includes(await uid("Gus Agent")) && (await heldAt("Gus Agent", hill)) === g0 && g0 > 0);
  ok("...and is added to Sunrise", (await E.team(sun.id)).includes(await uid("Gus Agent")));
  ok("...his My day still shows the Hilltop claims", (await seen("Gus Agent")) === (await held("Gus Agent")));
  const hl = (await E.AS("Hana Lead")("team.today", { client_id: hill.id })).members.map((m) => m.name);
  ok("Hana's team for today still lists Gus", hl.includes("Gus Agent"), hl);
  await E.AS("Hana Lead")("clients.saveTeam", { client_id: hill.id, base: await E.team(hill.id), team: (await E.team(hill.id)).filter((x) => x !== (null)) });
  const hteam = await E.team(hill.id);
  await E.AS("Hana Lead")("clients.saveTeam", { client_id: hill.id, base: hteam, team: hteam.filter((x) => x !== undefined && x !== hteam[hteam.indexOf(hteam.find(() => false))]) });
  const gid = await uid("Gus Agent");
  await E.AS("Hana Lead")("clients.saveTeam", { client_id: hill.id, base: hteam, team: hteam.filter((x) => x !== gid) });
  ok("Hana takes Gus off Hilltop: his Hilltop claims go to the pool", (await heldAt("Gus Agent", hill)) === 0 && (await pool(hill)) >= g0);
  ok("...with a bell line to Gus", (await notices("Gus Agent")).some((t) => /taken off your list/.test(t)), await notices("Gus Agent"));
  await sync(); await sync();
  ok("...and the copy does not put him back on Hilltop (though...he is on Sunrise in Shastra now)", !(await E.team(hill.id)).includes(gid));
  const iv = await uid("Ivy Agent");
  feed("Ivy Agent").also_on_projects = ""; await sync();
  ok("Ivy loses 'also on Lakeview' in Shastra: stays on Lakeview's billers with her Lakeview claims", (await E.team(lake.id)).includes(iv) && (await heldAt("Ivy Agent", lake)) > 0, [await heldAt("Ivy Agent", lake)]);
}
await inv("projects");
S("reports-to changes and managers' spans");
{
  const mc = async (n) => (await E.AS(n)("clients.list")).clients.map((c) => c.name).sort();
  ok("Mona (over Tina and Leo) sees Sunrise and Lakeview, not Hilltop", JSON.stringify(await mc("Mona Manager")) === JSON.stringify([LAKE, SUN].sort()), await mc("Mona Manager"));
  ok("Nora (over Hana, whose Gus now also works Sunrise) sees Hilltop and Sunrise", JSON.stringify(await mc("Nora Manager")) === JSON.stringify([HILL, SUN].sort()), await mc("Nora Manager"));
  feed("Hana Lead").reports_to = "Mona Manager"; await sync();
  E.TOK["Nora Manager"] = (await tokOf("Nora Manager")) || E.TOK["Nora Manager"];
  ok("Hana now reports to Mona: Mona sees Hilltop too", (await mc("Mona Manager")).includes(HILL), await mc("Mona Manager"));
  ok("...and Nora no longer does", !(await mc("Nora Manager")).includes(HILL), await mc("Nora Manager"));
  const hid = (await q1("SELECT id FROM claims WHERE client_id = ? LIMIT 1", hill.id)).id;
  const r = await E.rig.tryOp(() => E.AS("Nora Manager")("claims.get", { id: hid })); ok("Nora cannot open a Hilltop claim any more", !r.ok, r);
  const s = await E.AS("Nora Manager")("search.global", { q: "HL-73" }); ok("...nor find it", s.claims.length === 0, s.claims.length);
  ok("Mona can open it", (await E.rig.tryOp(() => E.AS("Mona Manager")("claims.get", { id: hid }))).ok);
  feed("Hana Lead").reports_to = "Nora Manager"; await sync();
  ok("moved back: Nora sees Hilltop again, Mona does not", (await mc("Nora Manager")).includes(HILL) && !(await mc("Mona Manager")).includes(HILL));
  feed("Eli Agent").reports_to = "Tina Lead"; await sync();
  ok("a biller changing team lead keeps their claims and their client", (await heldAt("Eli Agent", lake)) > 0 && (await seen("Eli Agent")) === (await held("Eli Agent")));
  feed("Leo Lead").status = "Resigned"; await sync();
  ok("Leo (Lakeview lead) resigns: Lakeview billers keep their claims", (await heldAt("Dev Agent", lake)) > 0 && (await seen("Dev Agent")) === (await held("Dev Agent")));
  ok("...and Mona still sees Lakeview (Eli, Ivy, Dev work it)", (await mc("Mona Manager")).includes(LAKE), await mc("Mona Manager"));
  feed("Leo Lead").status = "Working"; await sync();
}
await inv("reports-to");
S("duplicate Emp IDs");
{
  const before = JSON.stringify(await q("SELECT name, active, emp_id FROM users ORDER BY name"));
  FEED.push(AG("A1", "Twin One", "Tina Lead", SUN, { email: mail("Twin One") })); await sync();
  const r = await sync();
  ok("a joiner using Arun's Emp ID: both rows skipped with a warning", r.warnings.filter((w) => w.skipped).length >= 2, r.warnings.map((w) => w.name));
  ok("...nobody is switched off or renamed because of it", JSON.stringify(await q("SELECT name, active, emp_id FROM users WHERE name NOT IN ('Twin One') ORDER BY name")) === before.replace(/,{"name":"Twin One"[^}]*}/, ""), "");
  ok("...Arun's account still holds his claims and sees them", (await seen("Arun Agent")) === (await held("Arun Agent")));
  FEED.splice(FEED.findIndex((f) => f.name === "Twin One"), 1); await sync();
  ok("once fixed, Arun is normal again", (await q1("SELECT active FROM users WHERE name = 'Arun Agent'")).active === 1);
}
await inv("duplicates");
S("an account made by hand that the roster later takes over");
{
  const faye = (await A("users.save", { first_name: "Faye", last_name: "Hand", email: mail("Faye Hand"), role: "user", designation: "Biller", capacity: 35 })).user;
  await E.as(null)("auth.firstPassword", { user_id: faye.id, passHash: await E.sha("pw-x") });
  E.TOK["Faye Hand"] = (await E.login(mail("Faye Hand"), "pw-x")).token;
  await A("clients.saveTeam", { client_id: hill.id, base: await E.team(hill.id), team: [...(await E.team(hill.id)), faye.id] });
  await load(hill, "HM", 6); const a = await E.alloc("Hana Lead", hill.id, loc[hill.id]);
  const fn = await heldAt("Faye Hand", hill);
  ok("set-up: Faye (by hand) is on Hilltop's billers and holds " + fn + " claims", fn > 0 && (await seen("Faye Hand")) === (await held("Faye Hand")), fn);
  FEED.push(AG("A20", "Faye Hand", "Tina Lead", SUN)); await sync();
  ok("the roster took over Faye's account (same id, now from the roster)", (await q1("SELECT source FROM users WHERE id = ?", faye.id)).source === "roster");
  ok("...she stays on Hilltop's billers and keeps her claims, on her My day", (await E.team(hill.id)).includes(faye.id) && (await heldAt("Faye Hand", hill)) === fn && (await seen("Faye Hand")) === (await held("Faye Hand")), [await heldAt("Faye Hand", hill), await seen("Faye Hand")]);
  ok("...and is on Sunrise (her Shastra project)", (await E.team(sun.id)).includes(faye.id));
  const f2 = (await A("users.save", { first_name: "Gail", last_name: "Hand", email: mail("Gail Hand"), role: "user", designation: "Biller", capacity: 35 })).user;
  await E.as(null)("auth.firstPassword", { user_id: f2.id, passHash: await E.sha("pw-y") }); E.TOK["Gail Hand"] = (await E.login(mail("Gail Hand"), "pw-y")).token;
  await q("SELECT 1");
  await sql("UPDATE claims SET assigned_to = ?, state = 'assigned' WHERE id IN (SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL LIMIT 3)", f2.id, hill.id);
  const open = await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ?", f2.id);
  FEED.push(AG("A21", "Gail Hand", "Tina Lead", SUN)); await sync();
  ok("Gail (by hand, given Hilltop claims, never put on its team) is taken over and moves to Sunrise: her Hilltop claims are seen or returned, never hidden", (await seen("Gail Hand")) === (await held("Gail Hand")), [await seen("Gail Hand"), await held("Gail Hand"), open.n]);
}
await inv("hand-made");
S("promotion: a biller becomes a team lead");
{
  const a0 = await held("Ivy Agent"); feed("Ivy Agent").position = "Team Lead"; await sync();
  E.TOK["Ivy Agent"] = (await tokOf("Ivy Agent")) || E.TOK["Ivy Agent"];
  const a1 = await held("Ivy Agent");
  ok("Ivy promoted to Team Lead: the claims on her name are on her list or went to the pool, not hidden", (await seen("Ivy Agent")) === a1, [a0, a1, await seen("Ivy Agent")]);
  await load(sun, "SF", 6); const al = await E.alloc("Tina Lead", sun.id, loc[sun.id]);
  ok("team leads are never planned", !(al.perUser || []).some((u) => u.name === "Ivy Agent"));
}
await inv("promotion");
finish();
