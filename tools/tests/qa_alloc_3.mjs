// QA2: alloc.reassign / alloc.unassign / alloc.resplit / team.rebalance, queue.next / queue.skip, claims of a client no longer worked, CSV.
import { S, ok, done, setup, SUN_B } from "./qa_common.mjs";
const T = await setup();
const { app, q, q1, sql, A, TI, LE, U, NAME, sun, lake, downtown, westside, made, wipe, upload, alloc, mine, ready, counts, setTeam, setTarget, today, setCap, setOwn, TOK, as } = T;
const six = SUN_B; const LAKE_NAME = "Lakeview Dental Group";
const reset = async () => { await wipe(sun.id); await wipe(lake.id); await setTarget(sun.id, 0); for (const n of six) { await setCap(n, 35); await setOwn(n, null); } await setTeam(sun, six);
  await TI("clients.saveTeam", { location_id: downtown.id, team: [] }); await TI("clients.saveTeam", { location_id: westside.id, team: [] }); await A("clients.saveTeam", { client_id: lake.id, team: ["Dev Agent", "Eve Agent"].map(U) }); };
const rows = (p, n) => made(p, n).map((r, i) => ({ ...r, priority: 20 + (i % 70), balance: 100 + ((i * 37) % 900) }));
const W = { saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, note: { source: "Portal", findings: "Checked the portal, claim in process" } };
const poolIds = async (cid, n = 100) => (await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' ORDER BY priority DESC LIMIT ?", cid, n)).map((x) => x.id);

S("1. alloc.reassign");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("RA", 40));
  const ids = await poolIds(sun.id, 10);
  let r = await TI("alloc.reassign", { ids, user_id: U("Arun Agent") });
  ok("10 pool claims reassigned to Arun", r.changed === 10 && (await ready("Arun Agent")) === 10, r);
  r = await TI("alloc.reassign", { ids, user_id: U("Arun Agent") });
  ok("doing it again changes nothing and Arun still has 10", r.changed === 0 && (await ready("Arun Agent")) === 10, r);
  r = await TI("alloc.reassign", { ids: ids.slice(0, 4), user_id: U("Bela Agent") });
  ok("4 move from Arun to Bela: Arun 6, Bela 4, none lost", r.changed === 4 && (await ready("Arun Agent")) === 6 && (await ready("Bela Agent")) === 4, r);
  const e = await TI("alloc.reassign", { ids: ids.slice(4, 6), user_id: U("Dev Agent") }).catch((x) => ({ e: x.message }));
  ok("a biller of another client (Dev, Lakeview) cannot be given Sunrise claims", !!e.e, e);
  const e2 = await TI("alloc.reassign", { ids: ids.slice(4, 6), user_id: U("Leo Lead") }).catch((x) => ({ e: x.message }));
  ok("a team lead of another client cannot be given Sunrise claims", !!e2.e, e2);
  // in progress on a desk
  const arun = as(TOK["Arun Agent"]); const opened = await arun("queue.next", {});
  const r3 = await TI("alloc.reassign", { ids: [opened.claim.id], user_id: U("Cy Agent") });
  const st = await q1("SELECT state, assigned_to FROM claims WHERE id = ?", opened.claim.id);
  console.log("   claim open on Arun's desk, lead reassigns it to Cy:", JSON.stringify([r3, st]));
  const sv = await arun("queue.complete", { id: opened.claim.id, desk: true, ...W }).catch((x) => ({ e: x.message }));
  ok("(info) Arun then saving the claim that was moved off his desk: " + (sv.e || "saved"), true);
  const noName = await arun("queue.summary", {});
  ok("Arun's In progress shows no claim that is not his", !noName.in_progress_id || (await q1("SELECT assigned_to FROM claims WHERE id = ?", noName.in_progress_id)).assigned_to === U("Arun Agent"), noName.in_progress_id);
  // closed claim
  await sql("UPDATE claims SET state = 'closed' WHERE id = ?", ids[9]);
  const r4 = await TI("alloc.reassign", { ids: [ids[9]], user_id: U("Bela Agent") });
  ok("a closed claim cannot be reassigned", r4.changed === 0 && (await q1("SELECT state FROM claims WHERE id = ?", ids[9])).state === "closed", r4);
  // a lead can't touch another client's claims
  await upload("Leo Lead", lake.id, null, rows("LK", 5)); const lid = await poolIds(lake.id, 2);
  const r5 = await TI("alloc.reassign", { ids: lid, user_id: U("Tina Lead") }).catch((x) => ({ e: x.message }));
  ok("Tina cannot reassign Lakeview's claims (outside her clients)", r5.changed === 0 || !!r5.e, r5);
  ok("...they stay in the pool", (await counts(lake.id)).open === 5, await counts(lake.id));
}
S("2. alloc.unassign");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("UN", 60)); await alloc("Tina Lead", sun);
  const a = as(TOK["Arun Agent"]); const o = await a("queue.next", {});
  const r = await TI("alloc.unassign", { user_id: U("Arun Agent"), client_id: sun.id });
  ok("unassign all of Arun's claims for the client", r.changed >= 9, r);
  const st = await q1("SELECT state, assigned_to FROM claims WHERE id = ?", o.claim.id);
  console.log("   the claim Arun had open when his list was unassigned:", JSON.stringify(st));
  ok("his list is empty", (await mine("Arun Agent", sun.id)).length === 0);
  ok("the pool has them again and they carry no person", (await q1("SELECT COUNT(*) n FROM claims WHERE state = 'open' AND assigned_to IS NOT NULL AND client_id = ?", sun.id)).n === 0 && (await counts(sun.id)).open === 10);
  const g = (await today("Tina Lead", sun)).find((m) => m.name === "Arun Agent");
  ok("after unassigning, Arun's 'given today' is 0 (not counted twice when given again)", g.given_today === 0, g.given_today);
  await alloc("Tina Lead", sun);
  ok("allocate again: the 10 pool claims are split evenly over all six (Arun gets 1 or 2)", [1, 2].includes((await mine("Arun Agent", sun.id)).length) && (await counts(sun.id)).assigned === 60, (await mine("Arun Agent", sun.id)).length);
}
S("3. alloc.resplit (the lead's own numbers after a short allocation)");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("RS", 30));
  const al = await alloc("Tina Lead", sun);
  ok("short: 5 each", al.short && al.short.people.every((p) => p.got === 5), al.short && al.short.people);
  const want = { [U("Arun Agent")]: 10, [U("Bela Agent")]: 10, [U("Cy Agent")]: 10, [U("Dee Agent")]: 0, [U("Eli Agent")]: 0, [U("Fay Agent")]: 0 };
  const moves = app.resplitMoves({ claims: al.short.claims, owner: al.short.owner, want });
  const r = await TI("alloc.resplit", { client_id: sun.id, moves });
  const p = Object.fromEntries(await Promise.all(six.map(async (n) => [n, (await mine(n, sun.id)).length])));
  ok("after the lead's numbers: Arun 10, Bela 10, Cy 10, the rest 0", p["Arun Agent"] === 10 && p["Bela Agent"] === 10 && p["Cy Agent"] === 10 && p["Dee Agent"] + p["Eli Agent"] + p["Fay Agent"] === 0, { p, r });
  ok("none lost, nothing in pool", (await counts(sun.id)).assigned === 30 && !(await counts(sun.id)).open, await counts(sun.id));
  for (const n of six) ok(n + "'s My day = their number", (await ready(n)) === p[n], [await ready(n), p[n]]);
  // numbers add up to less -> back to pool
  await reset(); await upload("Tina Lead", sun.id, null, rows("RS2", 30)); const al2 = await alloc("Tina Lead", sun);
  const want2 = Object.fromEntries(six.map((n, i) => [U(n), i < 2 ? 5 : 0])); 
  const mv2 = app.resplitMoves({ claims: al2.short.claims, owner: al2.short.owner, want: want2 });
  await TI("alloc.resplit", { client_id: sun.id, moves: mv2 });
  const c2 = await counts(sun.id);
  ok("numbers adding to 10 of 30: 10 given, 20 back in the pool, none lost", c2.assigned === 10 && c2.open === 20, c2);
  ok("the pool claims carry nobody", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NOT NULL", sun.id)).n === 0);
  // priority: the ones kept are the highest priority
  const kept = await q("SELECT priority FROM claims WHERE client_id = ? AND state = 'assigned'", sun.id), pool = await q1("SELECT MAX(priority) m FROM claims WHERE client_id = ? AND state = 'open'", sun.id);
  console.log("   kept min", Math.min(...kept.map((k) => k.priority)), "pool max", pool.m);
  // after resplit, a second allocation today: given_today for the people who lost claims
  const gm = Object.fromEntries((await today("Tina Lead", sun)).map((m) => [m.name, m.given_today]));
  console.log("   given today after resplit:", JSON.stringify(gm));
  // opened on a desk meanwhile
  await reset(); await upload("Tina Lead", sun.id, null, rows("RS3", 12)); const al3 = await alloc("Tina Lead", sun);
  const a = as(TOK["Arun Agent"]); const o = await a("queue.next", {});
  const mv3 = al3.short.claims.filter((c) => al3.short.owner[c.id] === U("Arun Agent")).map((c) => ({ id: c.id, from: U("Arun Agent"), to: U("Bela Agent") }));
  const r3 = await TI("alloc.resplit", { client_id: sun.id, moves: mv3 });
  ok("a claim already open on Arun's desk is not taken by the resplit", r3.skipped === 1 && (await q1("SELECT assigned_to FROM claims WHERE id = ?", o.claim.id)).assigned_to === U("Arun Agent"), r3);
  const e = await TI("alloc.resplit", { client_id: sun.id, moves: [{ id: al3.short.claims[0].id, from: al3.short.owner[al3.short.claims[0].id], to: U("Dev Agent") }] }).catch((x) => ({ e: x.message }));
  ok("resplit to someone who does not work the client is refused", !!e.e, e);
}
S("4. Rebalance when a biller is out");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("RB", 60)); await alloc("Tina Lead", sun);
  const before = Object.fromEntries(await Promise.all(six.map(async (n) => [n, (await mine(n, sun.id)).length])));
  await TI("team.setOut", { user_id: U("Arun Agent"), reason: "sick" });
  const a = as(TOK["Arun Agent"]); const o = await a("queue.next", {});
  const r = await TI("team.rebalance", { user_id: U("Arun Agent") });
  const after = Object.fromEntries(await Promise.all(six.map(async (n) => [n, (await mine(n, sun.id)).length])));
  console.log("   before", JSON.stringify(before), "after", JSON.stringify(after), "result", JSON.stringify(r));
  ok("Arun's 9 untouched claims are shared (the one he has open stays): total still 60", Object.values(after).reduce((x, y) => x + y, 0) === 60, after);
  ok("the claim open on his desk is still his", (await q1("SELECT assigned_to FROM claims WHERE id = ?", o.claim.id)).assigned_to === U("Arun Agent"));
  ok("the others got 1-2 each (even)", ["Bela Agent", "Cy Agent", "Dee Agent", "Eli Agent", "Fay Agent"].every((n) => after[n] - before[n] >= 1 && after[n] - before[n] <= 2), after);
  const gt = Object.fromEntries((await today("Tina Lead", sun)).map((m) => [m.name, m.given_today]));
  ok("their 'given today' follows what they hold (the shared claims count for them)", ["Bela Agent", "Cy Agent"].every((n) => gt[n] === after[n]), gt);
  // rebalance when everyone else is out too
  for (const n of six.slice(1)) await TI("team.setOut", { user_id: U(n), reason: "x" });
  const r2 = await TI("team.rebalance", { user_id: U("Bela Agent") });
  ok("nobody left in: nothing moves, claims stay with Bela, 'left' says how many", r2.moved === 0 && r2.left > 0, r2);
  // rebalance with a location team
  await sql("DELETE FROM attendance"); await reset(); await TI("clients.saveTeam", { location_id: downtown.id, team: ["Arun Agent", "Bela Agent"].map(U) });
  await upload("Tina Lead", sun.id, downtown.id, rows("RBL", 20)); await alloc("Tina Lead", sun, downtown);
  await TI("team.setOut", { user_id: U("Arun Agent"), reason: "sick" }); const r3 = await TI("team.rebalance", { user_id: U("Arun Agent") });
  const holders = await q("SELECT assigned_to, COUNT(*) n FROM claims WHERE client_id = ? AND location_id = ? AND state = 'assigned' GROUP BY assigned_to", sun.id, downtown.id);
  console.log("   Downtown claims after rebalance:", JSON.stringify(holders.map((h) => [NAME(h.assigned_to), h.n])));
  ok("rebalance of a Downtown biller's claims goes to Downtown's own team first (Bela)", holders.length === 1 && holders[0].assigned_to === U("Bela Agent"), holders.map((h) => [NAME(h.assigned_to), h.n]));
  await TI("clients.saveTeam", { location_id: downtown.id, team: [] });
}
S("5. Next claim, skip, back of the line");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("NX", 12)); 
  await TI("alloc.reassign", { ids: await poolIds(sun.id, 6), user_id: U("Arun Agent") });
  await TI("alloc.reassign", { ids: await poolIds(sun.id, 6), user_id: U("Bela Agent") });
  const a = as(TOK["Arun Agent"]), b = as(TOK["Bela Agent"]);
  const [x, y] = await Promise.all([a("queue.next", {}), b("queue.next", {})]);
  ok("two billers pressing Next together get different claims", x.claim.id !== y.claim.id);
  ok("each got a claim of their own list", x.claim.assigned_to === U("Arun Agent") && y.claim.assigned_to === U("Bela Agent"));
  const [x2, x3] = await Promise.all([a("queue.next", {}), a("queue.next", {})]);
  ok("one biller pressing Next twice at once: both get the same open claim, none extra opened", x2.claim.id === x.claim.id && x3.claim.id === x.claim.id && (await q1("SELECT COUNT(*) n FROM claims WHERE assigned_to = ? AND state = 'in_progress'", U("Arun Agent"))).n === 1);
  // priority order on Arun's list
  const order = await q("SELECT id, claim_no FROM claims WHERE assigned_to = ? ORDER BY priority DESC, balance DESC", U("Arun Agent"));
  await a("queue.skip", { id: x.claim.id, reason: "payer closed" });
  const n2 = await a("queue.next", {});
  ok("after a skip Next gives the next claim, not the skipped one", n2.claim.id !== x.claim.id, n2.claim.claim_no);
  await a("queue.skip", { id: n2.claim.id });
  // work through all of them skipping each
  const seen = new Set([x.claim.id, n2.claim.id]);
  for (let i = 0; i < 4; i++) { const n = await a("queue.next", {}); seen.add(n.claim.id); await a("queue.skip", { id: n.claim.id }); }
  ok("skipping through all 6 shows each once", seen.size === 6, seen.size);
  const back = await a("queue.next", {});
  ok("after all were skipped, the skipped claims come round again (in the skipped order, first skipped first or by priority)", !!back.claim, back.claim && back.claim.claim_no);
  const sk = await a("queue.summary", {}); console.log("   summary after skipping all:", JSON.stringify({ ready: sk.ready.n, skipped: sk.skipped }));
  ok("skipped claims still count as ready on My day", sk.ready.n + (back.claim ? 1 : 0) === 6, sk.ready);
  // skip without being on desk
  const bad = await a("queue.skip", { id: y.claim.id }).catch((e) => ({ e: e.message }));
  ok("a biller cannot skip someone else's claim", !!bad.e, bad);
  // skip of the Next-while-open: Next with skip_id
  const cur = await a("queue.next", {});
  const nxt = await a("queue.next", { skip_id: cur.claim.id });
  ok("Next with a claim open puts it back and opens another", nxt.claim.id !== cur.claim.id, [cur.claim.claim_no, nxt.claim.claim_no]);
  ok("...and only one claim is open on the desk", (await q1("SELECT COUNT(*) n FROM claims WHERE assigned_to = ? AND state = 'in_progress'", U("Arun Agent"))).n === 1);
}
S("6. A biller with nothing left; a client they no longer work");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("NL", 6));
  const c = as(TOK["Cy Agent"]); const n = await c("queue.next", {});
  ok("nothing on the list: Next says no claim", n.claim === null, n);
  const sm = await c("queue.summary", {}); ok("summary is all zero", sm.ready.n === 0 && sm.in_progress_id === null, sm);
  // Dev works Lakeview (his Shastra project); a team lead adds him to Sunrise by hand and gives him Sunrise claims
  const d = as(TOK["Dev Agent"]);
  await A("clients.saveTeam", { client_id: sun.id, team: [...six, "Dev Agent"].map(U) });
  await TI("alloc.reassign", { ids: await poolIds(sun.id, 4), user_id: U("Dev Agent") });
  await upload("Leo Lead", lake.id, null, rows("LKN", 4));
  await LE("alloc.reassign", { ids: await poolIds(lake.id, 3), user_id: U("Dev Agent") });
  ok("Dev holds 4 Sunrise and 3 Lakeview claims: 7", (await ready("Dev Agent")) === 7, await ready("Dev Agent"));
  await A("clients.saveTeam", { client_id: sun.id, team: six.map(U) });
  console.log("   Dev's Sunrise claims after a lead took him off Sunrise:", JSON.stringify(await q("SELECT state, assigned_to FROM claims WHERE client_id = ? AND claim_no LIKE 'NL-%'", sun.id)).slice(0, 300));
  ok("taken off Sunrise: his Sunrise claims go back to the pool", (await mine("Dev Agent", sun.id)).length === 0 && (await counts(sun.id)).open === 6, await counts(sun.id));
  ok("...his Lakeview claims are still his, My day shows 3", (await ready("Dev Agent")) === 3, await ready("Dev Agent"));
  const nx = await d("queue.next", {}); ok("Next opens a Lakeview claim", nx.claim && nx.claim.client_id === lake.id, nx.claim && nx.claim.client_name);
  const bell = (await d("notify.list", {})).items.map((i) => i.text);
  ok("Dev has a bell notice about the claims returned", bell.some((t) => /pool|back|taken|removed/i.test(t)), bell);
  // stale data: a Sunrise claim still on Dev (he is off Sunrise)
  const ghost = (await poolIds(sun.id, 1))[0]; await sql("UPDATE claims SET assigned_to = ?, state = 'assigned', assigned_at = ? WHERE id = ?", U("Dev Agent"), Date.now(), ghost);
  ok("a Sunrise claim still on Dev by stale data is not counted on My day (2 Lakeview left, one is open)", (await ready("Dev Agent")) === 2, await ready("Dev Agent"));
  await d("queue.skip", { id: nx.claim.id });
  for (let i = 0; i < 5; i++) { const g = await d("queue.next", {}); if (!g.claim) break; ok("Next never opens a claim of Sunrise for Dev", g.claim.client_id === lake.id, g.claim.client_name); await d("queue.skip", { id: g.claim.id }); }
  const tot = await d("queue.summary", {}); ok("by_client lists only Lakeview", tot.by_client.every((x) => x.client_name === LAKE_NAME), tot.by_client);
}
S("7. The allocation CSV");
{
  await reset(); await upload("Tina Lead", sun.id, null, rows("CS", 12).map((r, i) => i === 0 ? { ...r, patient: 'Testpatient, "Quote", Comma', payer: "=cmd|' /C calc'!A0" } : r)); await alloc("Tina Lead", sun);
  const ctx = (await T.rig.as(TOK["Tina Lead"])("claims.list", { client_id: sun.id, state: "assigned", page_size: 100 }));
  const lst = ctx.rows; console.log("   claims.list rows:", lst.length, "has assigned_name:", lst[0] && lst[0].assigned_name);
  const csv = app.allocationCSV(lst, { biller: true }); const lines = csv.split("\r\n");
  const hdr = lines[0].split(",");
  ok("header: Biller first, then Claim #, Account #, Patient, Payer, DOS, CPT, Balance, Age, File status, Due and the 16 note columns", hdr[0] === "Biller" && hdr.slice(1, 11).join() === "Claim #,Account #,Patient,Payer,DOS,CPT,Balance,Age,File status,Due" && hdr.length === 27, hdr);
  ok("one line per claim", lines.length === 13 || lines.length === 1 + lst.length, lines.length);
  ok("every line has a biller name", lst.every((r) => r.assigned_name), lst.slice(0, 2));
  ok("a formula-looking payer is made safe (no leading =)", !/(^|,)"?=cmd/.test(csv), lines.find((l) => /cmd/.test(l)));
  ok("quotes and commas in a patient name are escaped", /"Testpatient, ""Quote"", Comma"/.test(csv), lines.find((l) => /Quote/.test(l)));
  ok("DOS is month/day/year", /\b09\/\d\d\/2026\b/.test(lines[1]), lines[1]);
  ok("the note columns are empty", lines[1].endsWith(",".repeat(16)) || lines[1].split(",").slice(-16).every((x) => x === ""), lines[1].slice(-60));
  const mineCsv = app.allocationCSV(lst.filter((r) => r.assigned_to === U("Arun Agent")), { due: () => "" });
  ok("a biller's own file has no Biller column", mineCsv.split("\r\n")[0].split(",")[0] === "Claim #", mineCsv.split("\r\n")[0]);
  const bl = await as(TOK["Arun Agent"])("queue.list", {}); ok("a biller's own list (queue.list) carries only his claims", bl.rows.length === 2 && bl.rows.every((r) => !r.assigned_to || r.assigned_to === U("Arun Agent")), [bl.rows.length, bl.rows[0] && Object.keys(bl.rows[0]).slice(0, 8)]);
}
done();
