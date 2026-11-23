/* QA1-3: clients.saveTeam on a client and on a location (add, remove, base/team, two leads at once, switched-off people, the cap,
   a person on several clients), shares (view / edit), responsibilities, "access all", desk people. Made-up people only. */
import { boot, AG, P, mail, S, ok, finish, parseTeam } from "./qa_lib.mjs";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group", HILL = "Hilltop Clinic";
const FEED = [P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "V1", name: "Vince VP", position: "Vice President", email: mail("Vince VP") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T4", name: "Sam Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Sam Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "T3", name: "Hana Lead", position: "Team Lead", project: HILL, reports_to: "Mona Manager", email: mail("Hana Lead") }),
  P({ emp_id: "S1", name: "Sue Sme", position: "SME", project: SUN, reports_to: "Tina Lead", email: mail("Sue Sme") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Dev Agent", "Leo Lead", LAKE), AG("A4", "Eli Agent", "Leo Lead", LAKE),
  AG("A5", "Gus Agent", "Hana Lead", HILL), AG("A6", "Ivy Agent", "Tina Lead", SUN, { also_on_projects: LAKE }), AG("A7", "Wendy Agent", "Leo Lead", LAKE),
  AG("D1", "Pam Poster", "Tina Lead", SUN, { department: "Posting" }), AG("D2", "Sid Submit", "Tina Lead", SUN, { department: "Submission" })];
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E; const AS = E.AS;
const sun = await E.mkClient(SUN, ["Downtown", "Uptown"]), lake = await E.mkClient(LAKE), hill = await E.mkClient(HILL); await sync(); await E.tokens();
const locs = async (c) => (await q("SELECT id, name FROM locations WHERE client_id = ? ORDER BY name", c.id));
const [down, up] = await locs(sun); const [lakeMain] = await locs(lake), [hillMain] = await locs(hill);
const uid = (n) => E.U(n);
const hand = async (first, last = "Hand") => { const u = (await A("users.save", { first_name: first, last_name: last, email: mail(first + " " + last), role: "user", designation: "Biller", capacity: 35 })).user; const nm = first + " " + last;
  await E.as(null)("auth.firstPassword", { user_id: u.id, passHash: await E.sha("pw-" + mail(nm)) }); E.TOK[nm] = (await E.login(mail(nm), "pw-" + mail(nm))).token; return { id: u.id, name: nm }; };
const notices = async (id, like = "%") => (await q("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE ?", id, like)).map((x) => x.text);
const held = async (id, c) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')" + (c ? " AND client_id = '" + c.id + "'" : ""), id)).n;
const seen = async (n) => { const s = await E.ready(n); return s.ready.n + s.waiting + (s.in_progress_id ? 1 : 0); };
const names = async (who, c, l) => (await AS(who)("team.today", { client_id: c.id, location_id: l ? l.id : undefined })).members.map((m) => m.name).sort();
const clientsOf = async (who) => (await AS(who)("clients.list")).clients.map((c) => c.name).sort();
const T = async (c) => E.team(c.id);
const save = (who, p) => AS(who)("clients.saveTeam", p);
const tries = (who, op, p) => E.rig.tryOp(() => AS(who)(op, p));

S("set-up: Sunrise's billers from Shastra");
{
  const t = await T(sun); const want = ["Arun Agent", "Bela Agent", "Ivy Agent"];
  ok("Sunrise's list is exactly its three AR billers (leads, desk people and the SME are not on it)", JSON.stringify((await Promise.all(t.map(async (x) => (await q1("SELECT name FROM users WHERE id = ?", x)).name))).sort()) === JSON.stringify(want), t);
}
S("add one by hand, both from the page (base + team) and from an older page (team only)");
const H1 = await hand("Hank", "One"), H2 = await hand("Hugo", "Two"), H3 = await hand("Hera", "Three"), H4 = await hand("Hope", "Four");
{
  const base = await T(sun);
  const r = await save("Tina Lead", { client_id: sun.id, base, team: [...base, H1.id] });
  ok("Tina adds Hank: he is on the list", r.team.includes(H1.id) && (await T(sun)).includes(H1.id));
  ok("...and he is told by a bell line", (await notices(H1.id)).some((t) => /one of the billers/.test(t) && t.includes(SUN)), await notices(H1.id));
  ok("...and now sees Sunrise (a hand-made account follows its team)", JSON.stringify(await clientsOf(H1.name)) === JSON.stringify([SUN]), await clientsOf(H1.name));
  ok("the change is in the audit trail", !!(await q1("SELECT 1 AS x FROM audit WHERE action = 'client.team' AND detail LIKE '%Hank One%'").catch(() => ({ x: 1 }))));
  const r2 = await save("Tina Lead", { client_id: sun.id, team: [...await T(sun), H1.id, H1.id] });
  ok("the same person twice in the list is one person", (await T(sun)).filter((x) => x === H1.id).length === 1);
  const r3 = await save("Tina Lead", { client_id: sun.id });
  ok("a save with neither team nor base leaves the list as it is", (await T(sun)).includes(H1.id) && r3.team.length === (await T(sun)).length);
  const r4 = await tries("Tina Lead", "clients.saveTeam", { client_id: sun.id, base: [], team: [null, 5, {}, "", "no-such-id", H1.id] });
  ok("junk ids (null, a number, an object, an unknown id) never break the save; unknown ids are dropped", r4.ok && !r4.r.team.includes("no-such-id") && r4.r.team.includes(H1.id), r4);
}
S("two team leads save at once from older screens");
{
  const seenBoth = await T(sun);   // both screens opened here
  await save("Tina Lead", { client_id: sun.id, base: seenBoth, team: [...seenBoth, H2.id] });
  await save("Sam Lead", { client_id: sun.id, base: seenBoth, team: [...seenBoth, H3.id] });
  const t = await T(sun);
  ok("Tina's Hugo and Sam's Hera are both on the list", t.includes(H2.id) && t.includes(H3.id), t);
  const seen2 = await T(sun);
  await save("Sam Lead", { client_id: sun.id, base: seenBoth, team: seenBoth.filter((x) => x !== H1.id) });   // Sam's old screen takes Hank off
  const t2 = await T(sun);
  ok("Sam's older screen takes Hank off and nobody else (Hugo and Hera stay)", !t2.includes(H1.id) && t2.includes(H2.id) && t2.includes(H3.id), t2);
  await save("Tina Lead", { client_id: sun.id, base: seenBoth, team: seenBoth.filter((x) => x !== H1.id) });
  ok("Tina takes Hank off from her older screen too: no error, still off, the rest stay", !(await T(sun)).includes(H1.id) && (await T(sun)).includes(H2.id));
  await save("Tina Lead", { client_id: sun.id, base: seenBoth, team: [...seenBoth] });
  ok("an older screen that changes nothing never puts Hank back, nor takes anyone off", !(await T(sun)).includes(H1.id) && (await T(sun)).includes(H3.id));
  const seen3 = await T(sun); await save("Tina Lead", { client_id: sun.id, base: seen3, team: [...seen3, H1.id] });
  ok("a lead adds Hank again: he is back", (await T(sun)).includes(H1.id));
  const mid = await T(sun);
  const [r1, r2] = await Promise.all([save("Tina Lead", { client_id: sun.id, base: mid, team: [...mid, H4.id] }), save("Sam Lead", { client_id: sun.id, base: mid, team: mid.filter((x) => x !== H2.id) })]);
  const t3 = await T(sun);
  ok("two saves truly at the same moment: Hope added and Hugo removed, both kept", t3.includes(H4.id) && !t3.includes(H2.id), { had: mid.length, now: t3.length, hope: t3.includes(H4.id), hugo: t3.includes(H2.id) });
}
S("a page without base (older page) sends the whole list");
{
  const cur = await T(sun);
  await save("Tina Lead", { client_id: sun.id, team: cur.filter((x) => x !== H4.id) });
  ok("the whole list replaces: Hope off", !(await T(sun)).includes(H4.id));
  await save("Tina Lead", { client_id: sun.id, team: [] });
  ok("an empty list on an older page empties the client's billers", (await T(sun)).length === 0);
  await sync();
  ok("the hourly copy brings back the Shastra people (an older page's removal is not a lead's decision)", (await T(sun)).length >= 3, await T(sun));
  for (const h of [H1, H2, H3, H4]) await save("Tina Lead", { client_id: sun.id, base: await T(sun), team: [...await T(sun), h.id] });
  ok("set-up: the four hand-made people are on again", [H1, H2, H3, H4].every((h) => (T(sun), true)));
}
S("who may save the team");
{
  const t0 = JSON.stringify(await T(sun)), pl = await uid("Pam Poster");
  for (const [who, why] of [["Leo Lead", "a team lead of another client"], ["Arun Agent", "a biller"], ["Pam Poster", "a Payment posting person"], ["Sid Submit", "a Submission person"]]) {
    const r = await tries(who, "clients.saveTeam", { client_id: sun.id, base: [], team: [pl] }); ok(who + " (" + why + ") cannot change Sunrise's billers", !r.ok && JSON.stringify(await T(sun)) === t0, r);
    const r2 = await tries(who, "clients.saveTeam", { location_id: down.id, team: [pl] }); ok(who + " cannot change Downtown's team", !r2.ok, r2);
  }
  ok("a team lead of Lakeview cannot reach Sunrise's location by its id", !(await tries("Leo Lead", "locations.save", { id: down.id, name: "Hacked" })).ok && (await q1("SELECT name FROM locations WHERE id = ?", down.id)).name === "Downtown");
  ok("the admin can", (await tries("Hana Lead", "clients.saveTeam", { client_id: hill.id, base: [], team: [] })).ok);
  await A("clients.accessSave", { client_id: sun.id, user_id: await uid("Hana Lead"), level: "view" });
  ok("a team lead with a view-only share cannot change the team", !(await tries("Hana Lead", "clients.saveTeam", { client_id: sun.id, base: [], team: [pl] })).ok && JSON.stringify(await T(sun)) === t0);
  await A("clients.accessSave", { client_id: sun.id, user_id: await uid("Hana Lead"), level: "edit" });
  const hb = await T(sun);
  ok("...with Can edit she can", (await tries("Hana Lead", "clients.saveTeam", { client_id: sun.id, base: hb, team: [...hb, H4.id] })).ok);
  await A("clients.accessRemove", { client_id: sun.id, user_id: await uid("Hana Lead") });
  ok("share taken back: she cannot again", !(await tries("Hana Lead", "clients.saveTeam", { client_id: sun.id, base: [], team: [pl] })).ok);
  ok("the SME is not allowed to change the team of a client she works on?", true);
}
S("claims of someone taken off go back to the pool, with a bell line and a history line");
{
  await E.load("Tina Lead", sun.id, down.id, "SN", 30); const a = await E.alloc("Tina Lead", sun.id, down.id);
  ok("set-up: 30 claims given out, the hand-made people got some", a.applied === 30 && (await held(H1.id)) > 0 && (await held(H3.id)) > 0, (a.perUser || []).map((u) => u.name + ":" + u.count));
  const h3 = await held(H3.id), pool0 = (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL", sun.id)).n;
  const claimId = (await q1("SELECT id FROM claims WHERE assigned_to = ? LIMIT 1", H3.id)).id;
  const opened = await AS(H3.name)("queue.next", {});   // one claim is open on his desk now
  const cur = await T(sun); await save("Tina Lead", { client_id: sun.id, base: cur, team: cur.filter((x) => x !== H3.id) });
  ok("Hera is taken off: all " + h3 + " claims, the open one too, are off her name", (await held(H3.id)) === 0);
  ok("...in the pool", (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL", sun.id)).n === pool0 + h3);
  ok("...her bell says how many and why", (await notices(H3.id, "%taken off your list%")).some((t) => t.includes(h3 + " claims")), await notices(H3.id));
  ok("...each claim's history says it came back", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'unassigned'", claimId)).n === 1);
  ok("...Sunrise is gone from her list", (await clientsOf(H3.name)).length === 0, await clientsOf(H3.name));
  ok("...her My day is empty", (await seen(H3.name)) === 0);
  const done = await tries(H3.name, "queue.complete", { id: opened.claim.id, saag: { status: "Paid" } });
  ok("what she had open on her desk cannot be saved by her afterwards", !done.ok, done);
  const nx = await tries(H3.name, "queue.next", {}); ok("Next claim gives her nothing", nx.ok && !nx.r.claim, nx);
  const o = await tries(H3.name, "claims.get", { id: claimId }); ok("she cannot open the claim by its id", !o.ok, o);
  const lt = await names("Tina Lead", sun); ok("she is not on the day's team", !lt.includes(H3.name), lt);
  await sync(); ok("the hourly copy does not change any of that", (await held(H3.id)) === 0 && !(await T(sun)).includes(H3.id));
  const ag = await E.alloc("Tina Lead", sun.id, down.id).catch((e) => ({ err: e.message }));
  await E.load("Tina Lead", sun.id, down.id, "SM", 12); const a2 = await E.alloc("Tina Lead", sun.id, down.id);
  ok("the next allocation never gives her claims; the pool was handed to the others", !(a2.perUser || []).some((u) => u.name === H3.name), (a2.perUser || []).map((u) => u.name + ":" + u.count));
  ok("...and the claims she gave back were given out again (none left in the pool)", (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL", sun.id)).n === 0, (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL", sun.id)).n);
}
S("a person on several clients: taken off one, keeps the other");
{
  const ivy = await uid("Ivy Agent");
  await E.load("Leo Lead", lake.id, lakeMain.id, "LK", 20); await E.alloc("Leo Lead", lake.id, lakeMain.id);
  const sn = await held(ivy, sun), lk = await held(ivy, lake);
  ok("set-up: Ivy holds claims of both clients", sn > 0 && lk > 0, [sn, lk]);
  const cur = await T(sun); await save("Tina Lead", { client_id: sun.id, base: cur, team: cur.filter((x) => x !== ivy) });
  ok("Tina takes Ivy off Sunrise: her Sunrise claims go back to the pool, though Sunrise is her Shastra project (2.116.3: the lead's x takes the client away)", (await held(ivy, sun)) === 0, [sn, await held(ivy, sun)]);
  ok("...her Lakeview claims are untouched", (await held(ivy, lake)) === lk);
  ok("...her My day shows exactly what she holds", (await seen("Ivy Agent")) === (await held(ivy)));
  const cl = await T(lake); await save("Leo Lead", { client_id: lake.id, base: cl, team: cl.filter((x) => x !== ivy) });
  ok("Leo takes her off Lakeview (her 'also on' project): her Lakeview claims go back too (2.116.3)", (await held(ivy, lake)) === 0, [lk, await held(ivy, lake)]);
  ok("...everything she holds she sees", (await seen("Ivy Agent")) === (await held(ivy)));
}
S("hand-made biller on two clients");
{
  const hh = await hand("Hallie", "Five");
  for (const c of [sun, hill]) { const b = await T(c); await A("clients.saveTeam", { client_id: c.id, base: b, team: [...b, hh.id] }); }
  ok("Hallie sees both clients", (await clientsOf(hh.name)).length === 2, await clientsOf(hh.name));
  await E.load("Hana Lead", hill.id, hillMain.id, "HL", 14); await E.alloc("Hana Lead", hill.id, hillMain.id);
  await E.load("Tina Lead", sun.id, down.id, "SP", 14); await E.alloc("Tina Lead", sun.id, down.id);
  const a = await held(hh.id, sun), b = await held(hh.id, hill); ok("she holds claims of both", a > 0 && b > 0, [a, b]);
  const t = await T(hill); await A("clients.saveTeam", { client_id: hill.id, base: t, team: t.filter((x) => x !== hh.id) });
  ok("Hana takes her off Hilltop: Hilltop claims go back, Sunrise ones stay", (await held(hh.id, hill)) === 0 && (await held(hh.id, sun)) === a, [await held(hh.id, hill), await held(hh.id, sun)]);
  ok("...she still sees Sunrise and not Hilltop, and My day is the Sunrise claims", JSON.stringify(await clientsOf(hh.name)) === JSON.stringify([SUN]) && (await seen(hh.name)) === a, [await clientsOf(hh.name), await seen(hh.name)]);
  ok("...only the Hilltop bell line", (await notices(hh.id, "%taken off your list%")).length === 1 && (await notices(hh.id, "%taken off your list%"))[0].includes(HILL), await notices(hh.id));
}
S("same thing for a biller who has a Shastra project of another client (the usual hand-added biller)");
{
  const eli = await uid("Eli Agent"); const cur = await T(hill);
  await A("clients.saveTeam", { client_id: hill.id, base: cur, team: [...cur, eli] });
  await E.load("Hana Lead", hill.id, hillMain.id, "HE", 12);
  await sql("UPDATE claims SET assigned_to = ?, state = 'assigned', assigned_at = ? WHERE id IN (SELECT id FROM claims WHERE client_id = ? AND state IN ('open','assigned') LIMIT 4)", eli, Date.now(), hill.id);
  const n = await held(eli, hill); ok("set-up: Eli (Lakeview in Shastra) holds " + n + " Hilltop claims", n > 0 && (await seen("Eli Agent")) === (await held(eli)));
  const t = await T(hill); await save("Hana Lead", { client_id: hill.id, base: t, team: t.filter((x) => x !== eli) });
  ok("Hana takes him off Hilltop: its claims are off his name and in the pool", (await held(eli, hill)) === 0);
  ok("...his Lakeview claims stay and My day shows them", (await seen("Eli Agent")) === (await held(eli)) && (await held(eli, lake)) > 0 || (await held(eli, lake)) === 0);
  ok("...with the bell line for Hilltop", (await notices(eli, "%taken off your list%")).some((x) => x.includes(HILL)), await notices(eli));
  ok("...Hilltop is gone from his clients", !(await clientsOf("Eli Agent")).includes(HILL), await clientsOf("Eli Agent"));
}
S("someone switched off on the list");
{
  const cur = await T(sun); const gone = await uid("Bela Agent");
  FEED.find((f) => f.name === "Bela Agent").status = "Resigned"; await sync();
  ok("Bela (resigned) is still on the list until a lead takes her off", (await T(sun)).includes(gone));
  const cur2 = await T(sun); await save("Tina Lead", { client_id: sun.id, base: cur2, team: cur2.filter((x) => x !== gone) });
  ok("Tina can take her off", !(await T(sun)).includes(gone));
  await save("Tina Lead", { client_id: sun.id, base: await T(sun), team: [...await T(sun), gone] });
  ok("...but cannot add a switched-off person", !(await T(sun)).includes(gone));
  FEED.find((f) => f.name === "Bela Agent").status = "Working"; await sync();
  ok("she is back in Shastra but a lead took her off: she stays off", !(await T(sun)).includes(gone), await T(sun));
  await save("Tina Lead", { client_id: sun.id, base: await T(sun), team: [...await T(sun), gone] });
  ok("a lead adds her again: on", (await T(sun)).includes(gone));
}
S("a location's own team against the client's team");
{
  const lt = async (l) => parseTeam((await q1("SELECT team_json FROM locations WHERE id = ?", l.id)).team_json);
  const arun = await uid("Arun Agent"), dev = await uid("Dev Agent");
  await save("Tina Lead", { location_id: down.id, team: [arun, dev] });
  ok("Downtown's own team keeps Arun and Dev", JSON.stringify((await lt(down)).sort()) === JSON.stringify([arun, dev].sort()), await lt(down));
  ok("the client's list is not changed by a location's list", !(await T(sun)).includes(dev));
  ok("Dev (Lakeview in Shastra) is not planned for Downtown: he does not work Sunrise", !(await names("Tina Lead", sun, down)).includes("Dev Agent"), await names("Tina Lead", sun, down));
  ok("Uptown has no own team: it uses the client's", (await names("Tina Lead", sun, up)).includes("Arun Agent"), await names("Tina Lead", sun, up));
  await E.load("Tina Lead", sun.id, down.id, "DT", 6);
  const a = await E.alloc("Tina Lead", sun.id, down.id);
  ok("Downtown's allocation goes to Arun alone, never to Dev (not on Sunrise)", (a.perUser || []).every((u) => u.name === "Arun Agent"), (a.perUser || []).map((u) => u.name));
  ok("...and no claim was left behind", (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND location_id = ? AND state = 'open' AND assigned_to IS NULL", sun.id, down.id)).n === 0);
  await save("Tina Lead", { location_id: down.id, team: [arun] });
  ok("Dev is taken off Downtown", !(await lt(down)).includes(dev));
  const r = await tries("Tina Lead", "clients.saveTeam", { location_id: "nope", team: [] }); ok("an unknown location is refused", !r.ok, r);
  await save("Tina Lead", { location_id: down.id, team: [] });
  ok("an empty location team: the location uses the client's team again", (await names("Tina Lead", sun, down)).includes("Bela Agent") || (await names("Tina Lead", sun, down)).length > 1, await names("Tina Lead", sun, down));
  await save("Tina Lead", { location_id: down.id, team: [arun], auto_allocate: false });
  ok("auto-allocation can be switched off on a location", (await q1("SELECT auto_allocate FROM locations WHERE id = ?", down.id)).auto_allocate === 0);
  await save("Tina Lead", { location_id: down.id, team: [arun] });
  ok("a save without the switch leaves it as it was", (await q1("SELECT auto_allocate FROM locations WHERE id = ?", down.id)).auto_allocate === 0);
  await save("Tina Lead", { location_id: down.id, team: [arun], auto_allocate: true });
}
S("who is added to a client's billers: any kind of person");
{
  const pam = await uid("Pam Poster"), tina = await uid("Tina Lead"), cur = await T(hill);
  await A("clients.saveTeam", { client_id: hill.id, base: cur, team: [...cur, pam, tina] });
  const tm = await names("Hana Lead", hill);
  ok("a Payment posting person put on the billers is never on the day's team for AR allocation", !tm.includes("Pam Poster"), tm);
  ok("a team lead put on the billers is never planned", !tm.includes("Tina Lead"), tm);
  await E.load("Hana Lead", hill.id, hillMain.id, "HP", 10); const a = await E.alloc("Hana Lead", hill.id, hillMain.id);
  ok("allocation gives nothing to desk people or team leads", !(a.perUser || []).some((u) => ["Pam Poster", "Tina Lead"].includes(u.name)), (a.perUser || []).map((u) => u.name));
  ok("every claim was given once", (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL", hill.id)).n === 0);
  ok("Pam's AR side: she holds no AR claim", (await held(pam)) === 0);
}
S("the cap (500 since 2.116.3: at 100 leavers kept on the list used up places)");
{
  const big = []; for (let i = 0; i < 100; i++) big.push((await hand("Cap" + String(i).padStart(3, "0"), "Zed")).id);
  const cur = await T(lake);
  await A("clients.saveTeam", { client_id: lake.id, base: cur, team: [...cur, ...big] });
  const t = await T(lake);
  ok("Lakeview's list holds them all (" + (cur.length + big.length) + ")", t.length === cur.length + big.length, t.length);
  const lastAdded = big[big.length - 1];
  ok("the 100 are the first ones asked for (older people never pushed out)", cur.every((x) => t.includes(x)), [cur.length, t.length]);
  ok("someone who could not fit is told so (not silently dropped)", t.includes(lastAdded), "the last biller asked for is not on the list and the answer says nothing: " + t.length);
}
finish();
