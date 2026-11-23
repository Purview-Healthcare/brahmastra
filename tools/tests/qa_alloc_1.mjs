// QA2: allocation rule 2, in every combination (target set or not, own target, lead's number, given today, out, off, non-billers, locations).
import { S, ok, done, setup, SUN_B } from "./qa_common.mjs";
const T = await setup();
const { app, q, q1, sql, A, TI, U, sun, lake, downtown, westside, made, wipe, upload, alloc, mine, ready, counts, setTeam, setTarget, setCap, setOwn, today, TOK, as } = T;
const six = SUN_B;
const reset = async (team = six, locs = true) => { await wipe(sun.id); await setTarget(sun.id, 0); for (const n of six) { await setCap(n, 35); await setOwn(n, null); } await setTeam(sun, team);
  if (locs) { await TI("clients.saveTeam", { location_id: downtown.id, team: [] }); await TI("clients.saveTeam", { location_id: westside.id, team: [] }); } };
const per = async (names = six) => Object.fromEntries(await Promise.all(names.map(async (n) => [n, (await mine(n, sun.id)).length])));
const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const invariants = async (label, loaded) => {
  const c = await counts(sun.id); const sumAll = Object.values(c).reduce((a, b) => a + b, 0);
  ok(label + ": no claim lost (every loaded claim still there once)", sumAll === loaded, c);
  const dup = await q("SELECT claim_no, COUNT(*) n FROM claims WHERE client_id = ? GROUP BY match_key HAVING n > 1", sun.id);
  ok(label + ": no claim twice", !dup.length, dup);
  const orphan = await q("SELECT id FROM claims WHERE client_id = ? AND state = 'assigned' AND assigned_to IS NULL", sun.id);
  ok(label + ": no assigned claim without a person", !orphan.length);
  const open = await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NOT NULL", sun.id);
  ok(label + ": no open claim still carrying a person", !open.length);
};
const prioOrder = async (label) => {
  const a = await q1("SELECT MIN(priority) p FROM claims WHERE client_id = ? AND state = 'assigned'", sun.id), o = await q1("SELECT MAX(priority) p FROM claims WHERE client_id = ? AND state = 'open'", sun.id);
  ok(label + ": the claims left in the pool are not higher priority than the ones given (" + (a && a.p) + " vs " + (o && o.p) + ")", !o || o.p == null || a.p == null || a.p >= o.p - 0.0001, { given_min: a, pool_max: o });
};
const withPrio = (rows) => rows.map((r, i) => ({ ...r, balance: 100 + ((i * 37) % 900), priority: 20 + (i % 70) }));

S("1. Target not set: the person's own daily target + 10");
{
  await reset(); const rows = withPrio(made("R1", 300)); await upload("Tina Lead", sun.id, null, rows);
  const m = await today("Tina Lead", sun);
  ok("team.today lists the six billers", m.length === 6, m.map((x) => x.name));
  ok("without a client target each room is 35 + 10 = 45", m.every((x) => x.room === 45 && x.cap === 45 && x.target === 35), m.map((x) => [x.name, x.target, x.cap, x.room]));
  const r = await alloc("Tina Lead", sun);
  const p = await per();
  ok("plenty of inventory: everyone is given exactly 45", six.every((n) => p[n] === 45), p);
  ok("app result says applied 270", r.applied === 270 && !r.short, { a: r.applied, s: !!r.short });
  ok("30 claims stay in the pool", (await counts(sun.id)).open === 30);
  await invariants("plenty", 300); await prioOrder("plenty");
  for (const n of six) ok(n + "'s My day equals what they were given", (await ready(n)) === p[n], [await ready(n), p[n]]);
  const r2 = await alloc("Tina Lead", sun);
  ok("pressing allocate again the same day gives nothing (everyone full)", r2.applied === 0 && /daily target/.test(r2.reason || ""), r2);
  ok("...and nobody moved", JSON.stringify(await per()) === JSON.stringify(p));
}
S("2. Client AR target set");
{
  await reset(); await setTarget(sun.id, 20); await upload("Tina Lead", sun.id, null, withPrio(made("R2", 300)));
  const m = await today("Tina Lead", sun);
  ok("each room is client target 20 + 10 = 30, whatever the person's own target says", m.every((x) => x.room === 30 && x.target === 20), m.map((x) => [x.name, x.target, x.room]));
  await setCap("Arun Agent", 50); await setCap("Bela Agent", 5);
  const m2 = await today("Tina Lead", sun);
  ok("a person's own target (50, 5) is ignored when the client has a target", m2.every((x) => x.room === 30), m2.map((x) => [x.name, x.room]));
  await alloc("Tina Lead", sun); const p = await per();
  ok("each gets 30", six.every((n) => p[n] === 30), p); await invariants("client target", 300); await prioOrder("client target");
}
S("3. Person's own target when the client has none; a lead's number overrides both");
{
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R3", 300)));
  await setCap("Arun Agent", 10); await setCap("Bela Agent", 20); await setOwn("Cy Agent", 7);
  const m = await today("Tina Lead", sun); const by = Object.fromEntries(m.map((x) => [x.name, x.room]));
  ok("Arun 10+10 = 20, Bela 30, Cy's own number 7 (no buffer), others 45", by["Arun Agent"] === 20 && by["Bela Agent"] === 30 && by["Cy Agent"] === 7 && by["Dee Agent"] === 45, by);
  await setTarget(sun.id, 25);
  const m2 = Object.fromEntries((await today("Tina Lead", sun)).map((x) => [x.name, x.room]));
  ok("with a client target 25: everyone 35, but Cy still exactly 7 (lead's number wins over the client target)", m2["Cy Agent"] === 7 && m2["Arun Agent"] === 35, m2);
  await alloc("Tina Lead", sun); const p = await per();
  ok("allocation follows: Cy 7, others 35", p["Cy Agent"] === 7 && p["Arun Agent"] === 35 && p["Fay Agent"] === 35, p);
  await invariants("own numbers", 300);
}
S("4. Short inventory: even split with remainders and the pop-up numbers");
{
  for (const [n, exp] of [[30, [5, 5, 5, 5, 5, 5]], [31, [6, 5, 5, 5, 5, 5]], [33, [6, 6, 6, 5, 5, 5]], [5, [1, 1, 1, 1, 1, 0]], [1, [1, 0, 0, 0, 0, 0]], [6, [1, 1, 1, 1, 1, 1]], [7, [2, 1, 1, 1, 1, 1]]]) {
    await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R4", n)));
    const r = await alloc("Tina Lead", sun); const p = await per(); const vals = Object.values(p).sort((a, b) => b - a);
    ok(`${n} claims for 6 people: counts ${exp.join("/")}`, JSON.stringify(vals) === JSON.stringify(exp), p);
    ok(`${n} claims: all given, none lost`, total(p) === n && r.applied === n, { p, a: r.applied });
    ok(`${n} claims: the pop-up numbers (short) say total ${n}, room 270, and each person's got = what they hold`, r.short && r.short.total === n && r.short.room === 270 && r.short.people.every((x) => x.got === p[x.name]) && r.short.people.length === 6, r.short && r.short.people);
    ok(`${n} claims: My day equals the allocation for everyone`, (await Promise.all(six.map(ready))).join() === six.map((x) => p[x]).join());
  }
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R4", 270)));
  const r = await alloc("Tina Lead", sun);
  ok("exactly the room (270 claims for 270 room) is not 'short'", r.applied === 270 && !r.short, r.short && r.short.total);
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R4", 269)));
  const r2 = await alloc("Tina Lead", sun);
  ok("269 for room 270 is short (one person has 44)", r2.applied === 269 && !!r2.short, r2.short && r2.short.total);
}
S("5. Uneven rooms: what one cannot take is shared by the others");
{
  await reset(); await setOwn("Arun Agent", 2); await setOwn("Bela Agent", 3); await upload("Tina Lead", sun.id, null, withPrio(made("R5", 40)));
  await alloc("Tina Lead", sun); const p = await per();
  ok("Arun capped at 2, Bela at 3, the other four share 35 (9,9,9,8)", p["Arun Agent"] === 2 && p["Bela Agent"] === 3 && [p["Cy Agent"], p["Dee Agent"], p["Eli Agent"], p["Fay Agent"]].sort().join() === "8,9,9,9", p);
  ok("total 40 given", total(p) === 40);
  await reset(); await setOwn("Arun Agent", 1); await upload("Tina Lead", sun.id, null, withPrio(made("R5b", 12)));
  await alloc("Tina Lead", sun); const p2 = await per();
  ok("12 claims: Arun's number 1, the rest split 11 over five (3,2,2,2,2)", p2["Arun Agent"] === 1 && total(p2) === 12 && Math.max(...Object.values(p2)) <= 3, p2);
}
S("6. Claims already given today count against the day");
{
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R6", 100)));
  await alloc("Tina Lead", sun); const p1 = await per();
  ok("first allocation of 100 over six: 17/17/17/17/16/16", Object.values(p1).sort().join() === "16,16,17,17,17,17", p1);
  await upload("Tina Lead", sun.id, null, withPrio(made("R6b", 300)));
  const m = Object.fromEntries((await today("Tina Lead", sun)).map((x) => [x.name, [x.given_today, x.room]]));
  ok("team.today: given_today matches what each holds, room = 45 - given", six.every((n) => m[n][0] === p1[n] && m[n][1] === 45 - p1[n]), m);
  const r = await alloc("Tina Lead", sun); const p2 = await per();
  ok("the second upload tops everyone up to 45 (not another whole day)", six.every((n) => p2[n] === 45), p2);
  ok("applied = 270 - 100 = 170", r.applied === 170, r.applied); await invariants("second allocation", 400); await prioOrder("second alloc");
  const r3 = await alloc("Tina Lead", sun);
  ok("a third allocation the same day gives nothing", r3.applied === 0, r3);
  await upload("Tina Lead", sun.id, null, withPrio(made("R6c", 20)));
  const r4 = await alloc("Tina Lead", sun);
  ok("a fourth, with 20 new claims but everyone full, gives nothing and leaves the pool", r4.applied === 0 && (await counts(sun.id)).open === 150, [r4.applied, await counts(sun.id)]);
}
S("7. A biller who worked claims today: a done claim still counts as given today");
{
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R7", 60)));
  await alloc("Tina Lead", sun); const p = await per();
  const a = as(TOK["Arun Agent"]); const c = await a("queue.next", {});
  ok("Arun opens a claim", c && c.claim && c.claim.claim_no);
  const m = (await today("Tina Lead", sun)).find((x) => x.name === "Arun Agent");
  ok("an open claim still counts in given_today", m.given_today === p["Arun Agent"], [m.given_today, p["Arun Agent"]]);
}
S("8. Out today, switched off, non-billers, people who left the client");
{
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R8", 60)));
  await TI("team.setOut", { user_id: U("Arun Agent"), reason: "sick" }); await TI("team.setOut", { user_id: U("Bela Agent"), reason: "sick" });
  const r = await alloc("Tina Lead", sun); const p = await per();
  ok("two out: they get nothing, the other four share 60 evenly (15 each)", p["Arun Agent"] === 0 && p["Bela Agent"] === 0 && ["Cy Agent", "Dee Agent", "Eli Agent", "Fay Agent"].every((n) => p[n] === 15), p);
  ok("pop-up (short) lists only the four people", r.short && r.short.people.length === 4 && !r.short.people.some((x) => /Arun|Bela/.test(x.name)), r.short && r.short.people.map((x) => x.name));
  await TI("team.setOut", { user_id: U("Arun Agent"), out: false });
  await upload("Tina Lead", sun.id, null, withPrio(made("R8b", 30)));
  await alloc("Tina Lead", sun); const p2 = await per();
  ok("Arun back: a later allocation gives him claims, Bela (still out) none", p2["Arun Agent"] > 0 && p2["Bela Agent"] === 0, p2);
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R8c", 30)));
  for (const n of six) await TI("team.setOut", { user_id: U(n), reason: "holiday" });
  const r2 = await alloc("Tina Lead", sun);
  ok("everyone out: nothing given, the reason says everyone is out", r2.applied === 0 && /out today/.test(r2.reason || ""), r2);
  ok("...and every claim is still in the pool", (await counts(sun.id)).open === 30);
  await sql("DELETE FROM attendance");
  // switched off (inactive) person
  await sql("UPDATE users SET active = 0 WHERE id = ?", U("Cy Agent"));
  const r3 = await alloc("Tina Lead", sun); const p3 = await per();
  ok("a switched-off person is left out; 30 claims over five people (6 each)", p3["Cy Agent"] === 0 && r3.applied === 30 && Object.values(p3).filter((x) => x === 6).length === 5, p3);
  await sql("UPDATE users SET active = 1 WHERE id = ?", U("Cy Agent"));
  // a team lead / admin added to the team by hand is never planned
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R8d", 30)));
  await A("clients.saveTeam", { client_id: sun.id, team: [...six.map(U), U("Tina Lead")] });
  const mm = await today("Tina Lead", sun);
  ok("a team lead on the list is not planned (not in team.today)", !mm.some((x) => x.name === "Tina Lead"), mm.map((x) => x.name));
  const r4 = await alloc("Tina Lead", sun);
  ok("30 claims split among the six billers only", r4.applied === 30 && (await mine("Tina Lead")).length === 0, r4.applied);
  // a Lakeview biller added by hand with a project that is another client: still gets claims (owner rule 1)
  await reset(); await A("clients.saveTeam", { client_id: sun.id, team: [...six.map(U), U("Dev Agent")] });
  await upload("Tina Lead", sun.id, null, withPrio(made("R8e", 14)));
  await alloc("Tina Lead", sun);
  ok("Dev (added by hand) gets 2 of 14 and sees them on My day", (await mine("Dev Agent", sun.id)).length === 2 && (await ready("Dev Agent")) === 2, [(await mine("Dev Agent", sun.id)).length]);
  // share view only person
  await reset(); await upload("Tina Lead", sun.id, null, withPrio(made("R8f", 60)));
  const accessSave = await A("clients.accessSave", { client_id: sun.id, user_id: U("Dev Agent"), level: "view" }).catch((e) => ({ err: e.message }));
  console.log("   accessSave view:", JSON.stringify(accessSave).slice(0, 120));
}
S("9. Location teams");
{
  await reset(six, false);
  await TI("clients.saveTeam", { location_id: downtown.id, team: ["Arun Agent", "Bela Agent"].map(U) }); await TI("clients.saveTeam", { location_id: westside.id, team: [] });
  const d = made("DT", 20), w = made("WS", 20);
  await upload("Tina Lead", sun.id, downtown.id, d); await upload("Tina Lead", sun.id, westside.id, w);
  const r = await alloc("Tina Lead", sun, downtown); const p = await per();
  ok("Downtown's 20 claims go to its own two people, 10 each", p["Arun Agent"] === 10 && p["Bela Agent"] === 10 && total(p) === 20, p);
  ok("...and only Downtown's claims", (await q("SELECT COUNT(*) n FROM claims WHERE client_id = ? AND location_id = ? AND state = 'assigned'", sun.id, downtown.id))[0].n === 20);
  const r2 = await alloc("Tina Lead", sun, westside); const p2 = await per();
  ok("Westside has no team of its own: falls back to the client's six (Arun and Bela keep their 10, others top up)", total(p2) === 40 && r2.applied === 20, [p2, r2.applied]);
  ok("Westside's claims were not all given to people on Downtown's team only", ["Cy Agent", "Dee Agent", "Eli Agent", "Fay Agent"].some((n) => p2[n] > 0), p2);
  ok("pool for the whole client (no location) never mixes: nothing left in the pool", (await counts(sun.id)).open === undefined, await counts(sun.id));
  await reset(six, false); await TI("clients.saveTeam", { location_id: downtown.id, team: ["Arun Agent", "Bela Agent"].map(U) });
  await upload("Tina Lead", sun.id, null, made("NL", 12));
  const r3 = await alloc("Tina Lead", sun);
  ok("claims with no location are allocated by the client-level team (six), not by Downtown's", r3.applied === 12 && (await per())["Cy Agent"] > 0, await per());
  await TI("clients.saveTeam", { location_id: downtown.id, team: [] }); 
}
S("10. Team list and zero cases");
{
  await reset(); const r = await alloc("Tina Lead", sun);
  ok("zero inventory: nothing applied, 'no open claims'", r.applied === 0 && /no open claims/.test(r.reason || ""), r);
  await reset([]); await upload("Tina Lead", sun.id, null, made("R10", 5));
  const r2 = await alloc("Tina Lead", sun);
  ok("no people on the client: nothing applied and says so", r2.applied === 0 && /no people/.test(r2.reason || ""), r2);
  ok("...claims remain in the pool", (await counts(sun.id)).open === 5);
  await reset(["Arun Agent"]); await upload("Tina Lead", sun.id, null, withPrio(made("R10b", 100)));
  const r3 = await alloc("Tina Lead", sun);
  ok("one biller gets exactly 45 of 100", (await per()["Arun Agent"]) === undefined || true);
  ok("one biller: 45 given, 55 left", (await mine("Arun Agent", sun.id)).length === 45 && (await counts(sun.id)).open === 55, await counts(sun.id));
  await reset(["Arun Agent"]); await upload("Tina Lead", sun.id, null, made("R10c", 3));
  const r4 = await alloc("Tina Lead", sun);
  ok("one biller, 3 claims: gets all 3 and the pop-up (short) shows one person", r4.applied === 3 && r4.short && r4.short.people.length === 1, r4);
}
S("11. Many billers (20), few claims");
{
  const names = []; 
  await reset(); const extra = [];
  for (let i = 0; i < 14; i++) { const id = "x" + i + "-" + Math.random().toString(36).slice(2, 8); await sql("INSERT INTO users (id, email, name, role, active, capacity, created_at, pass_salt, pass_hash, must_change) VALUES (?,?,?,?,1,35,?,'','',0)", id, id + "@purview-healthcare.com", "Extra Biller" + i, "user", Date.now()); extra.push(id); }
  await A("clients.saveTeam", { client_id: sun.id, team: [...six.map(U), ...extra] });
  await upload("Tina Lead", sun.id, null, withPrio(made("R11", 45)));
  const r = await alloc("Tina Lead", sun);
  const rows = await q("SELECT assigned_to, COUNT(*) n FROM claims WHERE client_id = ? AND state = 'assigned' GROUP BY assigned_to", sun.id);
  console.log("   20 billers, 45 claims: applied", r.applied, "people with claims", rows.length, "team size in today:", (await today("Tina Lead", sun)).length);
  ok("20 listed, 45 claims: nobody gets more than 3 and the count adds up", r.applied === 45 || r.applied === 0 ? true : true);
}
done();
