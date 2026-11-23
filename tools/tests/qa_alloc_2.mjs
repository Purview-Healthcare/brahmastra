// QA2: the working-day edges of "given today" and "out today", night shifts, the next day, second and third allocations.
import vm from "vm";
import { S, ok, done, setup, SUN_B } from "./qa_common.mjs";
const T = await setup();
const { app, q, q1, sql, A, TI, U, sun, made, wipe, upload, alloc, mine, ready, counts, setTeam, setTarget, today, setCap, setOwn, TOK, as } = T;
const ev = (code) => vm.runInContext(code, app);
const RealDate = globalThis.Date;
const freeze = async (iso) => { await sql("UPDATE sessions SET expires_at = 9000000000000"); const ms = RealDate.parse(iso);
  globalThis.Date = class extends RealDate { constructor(...a) { if (!a.length) super(ms); else super(...a); } static now() { return ms; } };
  ev(`(() => { const R = globalThis.__RD || Date; globalThis.__RD = R; globalThis.Date = class extends R { constructor(...a) { if (!a.length) super(${ms}); else super(...a); } static now() { return ${ms}; } }; })()`); return ms; };
const six = SUN_B;
const reset = async () => { await wipe(sun.id); await setTarget(sun.id, 0); for (const n of six) { await setCap(n, 35); await setOwn(n, null); await sql("UPDATE users SET shift = '09:00-18:00' WHERE id = ?", U(n)); } await setTeam(sun, six);
  await TI("clients.saveTeam", { location_id: T.downtown.id, team: [] }); await TI("clients.saveTeam", { location_id: T.westside.id, team: [] }); };
const rows = (p, n) => made(p, n).map((r, i) => ({ ...r, priority: 20 + (i % 70), balance: 100 + ((i * 37) % 900) }));
const IST = 330 * 60000;
const istMidnight = (ms) => Math.floor((ms + IST) / 86400000) * 86400000 - IST;

S("1. Day shift: the working day starts at IST midnight");
{
  const now = await freeze("2026-11-25T06:00:00Z");  // Wed 11:30 IST
  await reset(); await T.upload("Tina Lead", sun.id, null, rows("D1", 60)); await alloc("Tina Lead", sun);
  const from = istMidnight(now);
  const arun = U("Arun Agent");
  const given = async () => (await today("Tina Lead", sun)).find((m) => m.name === "Arun Agent").given_today;
  const n0 = await given(); ok("Arun was given 10 today", n0 === 10, n0);
  await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", from - 1, arun);
  ok("claims given 1 ms before IST midnight (yesterday) do not count today", (await given()) === 0, await given());
  await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", from, arun);
  ok("claims given exactly at IST midnight count", (await given()) === 10, await given());
  await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", from + 86400000 - 1, arun);
  ok("claims given at 23:59:59.999 IST count", (await given()) === 10, await given());
  // yesterday's claims that were still not worked do not stop today's allocation
  await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", from - 3600000, arun);
  await T.upload("Tina Lead", sun.id, null, rows("D1b", 400));
  await alloc("Tina Lead", sun);
  const p = await mine("Arun Agent", sun.id);
  ok("next day: Arun's carried-over 10 do not count; he gets a full 45 more (55 on the list)", p.length === 55, p.length);
  ok("...others were topped up to 45 only", (await mine("Bela Agent", sun.id)).length === 45, (await mine("Bela Agent", sun.id)).length);
}
S("2. Night shift 22:30-07:30: the day rolls at 09:00 IST");
{
  for (const [iso, label, expectDay] of [["2026-11-25T21:30:00Z", "03:00 IST Thu 26 Nov", "2026-11-25"], ["2026-11-26T03:29:00Z", "08:59 IST", "2026-11-25"], ["2026-11-26T03:31:00Z", "09:01 IST", "2026-11-26"], ["2026-11-25T18:29:00Z", "23:59 IST", "2026-11-25"]]) {
    const now = await freeze(iso);
    await reset(); await sql("UPDATE users SET shift = '22:30-07:30' WHERE id = ?", U("Arun Agent"));
    await T.upload("Tina Lead", sun.id, null, rows("N" + iso.slice(8, 10), 60)); await alloc("Tina Lead", sun);
    const startOfDay = RealDate.parse(expectDay + "T00:00:00Z") - IST + 540 * 60000 * (expectDay === new RealDate(now + IST).toISOString().slice(0, 10) && iso.slice(11, 13) !== "18" ? 1 : 1);
    const arun = U("Arun Agent");
    const given = async () => (await today("Tina Lead", sun)).find((m) => m.name === "Arun Agent").given_today;
    ok(`night shift at ${label}: given today counts the claims just given (10)`, (await given()) === 10, await given());
    const wdFrom = RealDate.parse(expectDay + "T00:00:00Z") - IST + 540 * 60000;
    await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", wdFrom - 1, arun);
    ok(`night shift at ${label}: a claim given 1 ms before the shift day began (${expectDay} 09:00 IST) is yesterday's`, (await given()) === 0, await given());
    await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", wdFrom, arun);
    ok(`night shift at ${label}: given exactly when the day began counts`, (await given()) === 10, await given());
  }
}
S("3. Out today for a night-shift biller after midnight");
{
  await freeze("2026-11-25T21:30:00Z");   // 03:00 IST Thursday 26 Nov: the night shift's day is still Wednesday 25 Nov
  await reset(); await sql("UPDATE users SET shift = '22:30-07:30' WHERE id = ?", U("Arun Agent"));
  await T.upload("Tina Lead", sun.id, null, rows("NO", 60));
  const r = await TI("team.setOut", { user_id: U("Arun Agent"), reason: "sick" });
  console.log("   setOut recorded day:", r.day, " (page's today is 2026-11-26)");
  const m = (await as(TOK["Tina Lead"])("team.today", { client_id: sun.id, day: "2026-11-26" })).members.find((x) => x.name === "Arun Agent");
  ok("a night-shift biller marked Out at 03:00 is shown out by team.today when asked for the page's day (2026-11-26, as autoAllocate asks)", m.out === true, { out: m.out, recorded: r.day });
  const res = await alloc("Tina Lead", sun);
  ok("...and the allocation gives him nothing", (await mine("Arun Agent", sun.id)).length === 0, (await mine("Arun Agent", sun.id)).length);
  const att = await q("SELECT day FROM attendance WHERE user_id = ?", U("Arun Agent"));
  console.log("   attendance rows:", JSON.stringify(att));
}
S("4. Second and third allocation the same day, then the next day");
{
  await freeze("2026-11-25T06:00:00Z");
  await reset(); await T.upload("Tina Lead", sun.id, null, rows("S1", 100)); const a1 = await alloc("Tina Lead", sun);
  await T.upload("Tina Lead", sun.id, null, rows("S2", 100)); const a2 = await alloc("Tina Lead", sun);
  await T.upload("Tina Lead", sun.id, null, rows("S3", 100)); const a3 = await alloc("Tina Lead", sun);
  const tot = (await counts(sun.id));
  ok("3 uploads of 100: 300 claims, all given or in pool, none lost", (tot.assigned || 0) + (tot.open || 0) === 300, tot);
  ok("the cap of 45 each holds over the three allocations: 270 given, 30 open", tot.assigned === 270 && tot.open === 30, tot);
  ok("applied adds up: " + [a1.applied, a2.applied, a3.applied], a1.applied + a2.applied + a3.applied === 270);
  for (const n of six) ok(n + ": My day = 45", (await ready(n)) === 45, await ready(n));
  // next day: move everything's assigned_at 24h back and the clock forward
  await freeze("2026-11-26T06:00:00Z");
  ok("next day: everyone's room is 45 again (yesterday's claims are not today's)", (await today("Tina Lead", sun)).every((m) => m.given_today === 0 && m.room === 45), (await today("Tina Lead", sun)).map((m) => [m.given_today, m.room]));
  const a4 = await alloc("Tina Lead", sun);
  ok("next day: the 30 left in the pool are given out", a4.applied === 30, a4);
  for (const n of six) ok(n + " holds yesterday's 45 plus a share of the 30 (50)", (await ready(n)) === 50, await ready(n));
}
S("5. Priority order is respected");
{
  await freeze("2026-11-25T06:00:00Z");
  await reset(); await setCap("Arun Agent", 1); 
  for (const n of six.slice(1)) await TI("team.setOut", { user_id: U(n), reason: "x" });
  const rr = made("P", 30).map((r, i) => ({ ...r, status_class: i === 7 ? "rejected" : "denied", balance: i === 7 ? 9000 : 100 + i, dos: i === 7 ? "2026-09-01" : "2026-11-20" }));
  await T.upload("Tina Lead", sun.id, null, rr); await alloc("Tina Lead", sun);
  const got = await mine("Arun Agent", sun.id);
  ok("Arun's room is 11 (1 + 10); he gets the 11 highest-priority claims", got.length === 11, got.length);
  const top = await q("SELECT claim_no FROM claims WHERE client_id = ? ORDER BY priority DESC LIMIT 11", sun.id);
  ok("the claims he holds are the top 11 by priority of all 30", new Set(top.map((x) => x.claim_no)).size === 11 && top.every((x) => got.some((g) => g.claim_no === x.claim_no)), { top: top.map((x) => x.claim_no), got: got.map((g) => g.claim_no) });
  const a = as(TOK["Arun Agent"]); const nx = await a("queue.next", {});
  const hi = await q1("SELECT claim_no FROM claims WHERE assigned_to = ? ORDER BY priority DESC, balance DESC LIMIT 1", U("Arun Agent"));
  ok("Next claim opens the highest priority one on his list", nx.claim.claim_no === hi.claim_no, [nx.claim.claim_no, hi.claim_no]);
}
done();
