/* Suite 59: the day's limit for allocation (the owner's rule). Each person can be given their daily target (Team › Claims per
   day) and 10 more in a day, less what they were given that day already: a target of 25 gets 35. When today's inventory is less
   than that for the whole team it is split evenly (30 claims for 3 people: 10 each), and the team lead may set each person's
   number by hand (alloc.resplit), so someone given fewer claims, or none, can be given other tasks. A stand-in for Purview
   Shastra's roster; made-up people and data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const T = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project) => P({ emp_id, name, project, reports_to: lead, email: mail(name) });
/* Tina leads Sunrise (Arun, Bela, Cara), Leo leads Lakeview (Dev). */
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Cara Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE),
];
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, sha } = rig; const app = rig.app;
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const q1 = async (s, ...a) => (await q(s, ...a))[0];
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const TOK = {};
for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); TOK[f.name] = (await login(f.email, "pw-" + f.email)).token; }
const TI = as(TOK["Tina Lead"]), LEO = as(TOK["Leo Lead"]), BELA = as(TOK["Bela Agent"]);
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN);
const downtown = sun.locations.find((l) => l.name === "Downtown");
const THREE = ["Arun Agent", "Bela Agent", "Cara Agent"];
let batchNo = 0, base = 7400000;
// every file has its own claim numbers (the server matches a claim by its number, so a repeated number would refresh a claim)
const made = (prefix, n, patientOf = (i) => "Testpatient, " + prefix + (i + 1)) => { const b = (base += 1000); return Array.from({ length: n }, (_, i) => { const no = prefix + "-" + String(b + i + 1); return { match_key: "claim:" + no.toLowerCase(), claim_no: no, patient: patientOf(i),
  payer: i % 2 ? "Aetna" : "Cigna", dos: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), balance: 100 + i, status_class: "denied", tier: "Medium", priority: 50 + (i % 7), file_status: "Denied", cpt: "99213" }; }); };
const load = async (rows) => { app.setToken(TOK["Tina Lead"]); await app.uploadClaims({ client_id: sun.id, location_id: downtown.id, kind: "fresh", file_name: "S59 file " + (++batchNo) + ".xlsx", claims: rows, summary: {}, rows_read: rows.length });
  app.setToken(TOK["Tina Lead"]); return app.autoAllocate({ client: (await TI("clients.list")).clients.find((c) => c.id === sun.id), loc: downtown }); };
const per = async (prefix) => { const m = Object.fromEntries((await q("SELECT u.name, COUNT(*) AS n FROM claims c JOIN users u ON u.id = c.assigned_to WHERE c.claim_no LIKE ? GROUP BY u.name", prefix + "-%")).map((r) => [r.name, r.n]));
  return THREE.map((n) => m[n] || 0); };
const day = async () => Object.fromEntries((await TI("team.today", { client_id: sun.id, location_id: downtown.id })).members.map((m) => [m.name, m]));
// a new working day: what was given before counts for an earlier day
const newDay = () => sql("UPDATE claims SET assigned_at = assigned_at - 2 * 86400000 WHERE assigned_at IS NOT NULL");

// Downtown's own team is the three billers, each with a daily target of 25; nothing else open there
await TI("clients.saveTeam", { location_id: downtown.id, team: THREE.map(U) });
await sql(`UPDATE users SET capacity = 25 WHERE id IN (${THREE.map(() => "?").join(",")})`, ...THREE.map(U));
await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND state = 'open'", sun.id);
await newDay();

S("The day's limit: the daily target and 10 more");
{
  const d = await day();
  ok("each biller's daily target is 25, the day's limit 35 (25 and 10 more), nothing given yet, so 35 to give", THREE.every((n) => d[n].target === 25 && d[n].buffer === 10 && d[n].cap === 35 && d[n].given_today === 0 && d[n].room === 35), THREE.map((n) => d[n]));
  // an old number kept per client (no longer set anywhere on the page) never wins over the daily target the team lead sees
  await sql("UPDATE clients SET caps_json = ? WHERE id = ?", JSON.stringify({ [U("Arun Agent")]: 5 }), sun.id);
  ok("the limit follows the daily target on Team, not an old number kept per client", (await day())["Arun Agent"].cap === 35);
  await sql("UPDATE clients SET caps_json = '{}' WHERE id = ?", sun.id);
}

S("Today's inventory is less: split evenly, and the team lead is asked");
let al = null;
{
  al = await load(made("SH", 30));
  ok("30 claims for 3 billers with a daily target of 25: 10 each", al.applied === 30 && JSON.stringify(await per("SH")) === "[10,10,10]", [al.applied, await per("SH")]);
  const s = al.short;
  ok("the allocation says the inventory was short: 30 claims, the team could take 105", !!s && s.total === 30 && s.room === 105, s && { total: s.total, room: s.room });
  ok("with each person's daily target, limit and what they got (10 each)", !!s && s.people.length === 3 && s.people.every((p) => p.target === 25 && p.cap === 35 && p.got === 10 && p.given === 0 && p.room === 35), s && s.people);
  ok("it has the claims it gave and who has each, for the team lead's own numbers", !!s && s.claims.length === 30 && Object.keys(s.owner).length === 30);
  const d = await day();
  ok("the day's team now counts 10 given today to each, 25 more to give", THREE.every((n) => d[n].given_today === 10 && d[n].room === 25), THREE.map((n) => [d[n].given_today, d[n].room]));
}

S("The team lead's own numbers: 15, 15 and none (Cara gets other tasks)");
{
  const cara0 = (await q1("SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ?", U("Cara Agent"))).n;
  const want = { [U("Arun Agent")]: 15, [U("Bela Agent")]: 15, [U("Cara Agent")]: 0 };
  const moves = app.resplitMoves({ claims: al.short.claims, owner: al.short.owner, want });
  ok("only Cara's 10 claims move: 5 to Arun, 5 to Bela", moves.length === 10 && moves.every((m) => m.from === U("Cara Agent")) && moves.filter((m) => m.to === U("Arun Agent")).length === 5 && moves.filter((m) => m.to === U("Bela Agent")).length === 5, moves.map((m) => [m.from, m.to]));
  const r = await TI("alloc.resplit", { client_id: sun.id, moves });
  ok("the server moves all 10 (none back to the pool, none left behind)", r.moved === 10 && r.back === 0 && r.skipped === 0 && r.done.length === 10, r);
  ok("Arun has 15, Bela 15, Cara none", JSON.stringify(await per("SH")) === "[15,15,0]", await per("SH"));
  const ev = await q("SELECT claim_id, data_json FROM claim_events WHERE kind = 'assigned' AND data_json LIKE '%\"via\":\"own\"%' AND claim_id IN (SELECT value FROM json_each(?))", JSON.stringify(moves.map((m) => m.id)));
  ok("each moved claim's history says it went from Cara by the team lead's own numbers", ev.length === 10 && new Set(ev.map((e) => e.claim_id)).size === 10 && ev.every((e) => JSON.parse(e.data_json).from === "Cara Agent"), ev.slice(0, 2));
  const n = async (who) => (await q("SELECT text, kind FROM user_notices WHERE user_id = ? ORDER BY at DESC LIMIT 1", U(who)))[0] || {};
  ok("Arun and Bela are told in the bell: 5 new claims each", (await n("Arun Agent")).text === "5 new claims were allocated to you by Tina Lead (Sunrise Eye Care)." && (await n("Bela Agent")).kind === "alloc", [await n("Arun Agent"), await n("Bela Agent")]);
  ok("Cara is told 10 were taken off her list, and why (no claim or patient details)", (await q1("SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ?", U("Cara Agent"))).n === cara0 + 1
    && (await n("Cara Agent")).text === "10 claims were taken off your list: today's inventory is less, so Tina Lead set how many each person gets (Sunrise Eye Care).", await n("Cara Agent"));
  const au = await q1("SELECT user_name, client_id, detail FROM audit_log WHERE action = 'alloc.resplit' ORDER BY at DESC LIMIT 1");
  ok("the audit trail has it, with the counts", !!au && au.user_name === "Tina Lead" && au.client_id === sun.id && /10 claims moved to another biller, 0 back to the pool/.test(au.detail), au);
  const d = await day();
  ok("given today follows: Arun 15, Bela 15, Cara 0 (her limit is free again)", d["Arun Agent"].given_today === 15 && d["Bela Agent"].given_today === 15 && d["Cara Agent"].given_today === 0 && d["Cara Agent"].room === 35, THREE.map((x) => d[x].given_today));
}

S("A patient's claims stay together when the numbers change");
{
  const cl = [...Array.from({ length: 4 }, (_, i) => ({ id: "x" + i, account_no: "AC-X", patient: "Testpatient, X", payer: "Aetna", priority: 10, balance: 50 })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: "s" + i, patient: "Testpatient, S" + i, payer: "Cigna", priority: 40 + i, balance: 100 }))];
  const owner = Object.fromEntries(cl.map((c) => [c.id, "cara"]));
  const m1 = app.resplitMoves({ claims: cl, owner, want: { cara: 7, arun: 3 } });
  ok("Cara keeps 7 of 10: she gives back 3 single claims, the lowest priority ones; the patient's 4 stay with her (they do not fit in 3)", m1.length === 3 && m1.every((m) => m.id.startsWith("s") && m.to === "arun") && JSON.stringify(m1.map((m) => m.id).sort()) === JSON.stringify(["s0", "s1", "s2"]), m1);
  const m2 = app.resplitMoves({ claims: cl, owner, want: { cara: 4, bela: 2, arun: 4 } });
  const xTo = [...new Set(m2.filter((m) => m.id.startsWith("x")).map((m) => m.to))];
  ok("Cara keeps 4 of 10: the patient's 4 claims (her lowest priority) go together to Arun, who has room for 4; Bela gets 2 others", m2.length === 6 && m2.filter((m) => m.id.startsWith("x")).length === 4 && xTo.length === 1 && xTo[0] === "arun"
    && m2.filter((m) => m.to === "bela").length === 2, m2);
  const m4 = app.resplitMoves({ claims: cl, owner, want: { cara: 4, bela: 3, arun: 3 } });
  ok("nobody has room for all 4: they are shared out, every claim still placed", m4.length === 6 && m4.every((m) => m.to) && m4.filter((m) => m.to === "arun").length === 3, m4);
  const m3 = app.resplitMoves({ claims: cl, owner, want: { cara: 5 } });
  ok("numbers that add up to less: what nobody takes goes back to the pool (lowest priority first)", m3.length === 5 && m3.every((m) => m.to === null), m3);
  ok("the same numbers as now: nothing moves", app.resplitMoves({ claims: cl, owner, want: { cara: 10 } }).length === 0);
}

S("Fewer in total: the rest goes back to the pool");
{
  const al2 = await load(made("SB", 12));
  // Arun and Bela can take 20 more today, Cara 35: 12 claims, 4 each
  ok("12 more claims the same day: 4 each (Arun and Bela have 20 left, Cara 35)", al2.applied === 12 && JSON.stringify(await per("SB")) === "[4,4,4]" && !!al2.short, await per("SB"));
  const moves = app.resplitMoves({ claims: al2.short.claims, owner: al2.short.owner, want: { [U("Arun Agent")]: 4, [U("Bela Agent")]: 4, [U("Cara Agent")]: 0 } });
  const r = await TI("alloc.resplit", { client_id: sun.id, moves });
  const st = await q("SELECT state, assigned_to FROM claims WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(moves.map((m) => m.id)));
  ok("Cara's 4 go back to the pool: open and on nobody's list", r.back === 4 && r.moved === 0 && st.length === 4 && st.every((c) => c.state === "open" && !c.assigned_to), [r, st]);
  ok("their history says they were taken off Cara's list", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE kind = 'unassigned' AND text = 'Cara Agent' AND claim_id IN (SELECT value FROM json_each(?))", JSON.stringify(moves.map((m) => m.id)))).n === 4);
}

S("A claim opened, or moved by someone else since, stays where it is");
{
  const mine = async (who) => (await q("SELECT id FROM claims WHERE claim_no LIKE 'SB-%' AND assigned_to = ? AND state = 'assigned' ORDER BY claim_no", U(who))).map((r) => r.id);
  const arun = await mine("Arun Agent"), bela = await mine("Bela Agent");
  await BELA("queue.open", { id: bela[0] });                                   // open on Bela's desk right now
  await TI("alloc.reassign", { ids: [arun[0]], user_id: U("Bela Agent") });   // moved by the team lead a moment before
  const moves = [...arun.map((id) => ({ id, from: U("Arun Agent"), to: U("Cara Agent") })), ...bela.map((id) => ({ id, from: U("Bela Agent"), to: U("Cara Agent") }))];
  const r = await TI("alloc.resplit", { client_id: sun.id, moves });
  ok("6 move to Cara; the one Bela has open and the one moved since stay where they are", r.moved === 6 && r.skipped === 2 && !r.done.includes(bela[0]) && !r.done.includes(arun[0]), r);
  const at = await q("SELECT id, assigned_to, state FROM claims WHERE id IN (?, ?)", bela[0], arun[0]);
  ok("both are still Bela's (one open on her desk)", at.every((c) => c.assigned_to === U("Bela Agent")) && at.some((c) => c.state === "in_progress"), at);
}

S("Who may");
{
  const some = (await q("SELECT id FROM claims WHERE claim_no LIKE 'SB-%' AND assigned_to = ? AND state = 'assigned' LIMIT 1", U("Cara Agent")))[0].id;
  const mv = (to) => [{ id: some, from: U("Cara Agent"), to }];
  let r = await T(() => BELA("alloc.resplit", { client_id: sun.id, moves: mv(U("Bela Agent")) }));
  ok("a biller cannot move claims between billers", !r.ok && /Supervisor access/.test(r.e), r);
  r = await T(() => TI("alloc.resplit", { client_id: sun.id, moves: mv(U("Dev Agent")) }));
  ok("claims never go to someone who does not work the client", !r.ok && r.e === "Claims can only go to active billers on this client.", r);
  r = await T(() => LEO("alloc.resplit", { client_id: sun.id, moves: mv(U("Arun Agent")) }));
  ok("another client's team lead cannot move this client's claims", !r.ok && r.e === "That project is not one of yours.", r);
  r = await T(() => TI("alloc.resplit", { client_id: sun.id, moves: [] }));
  ok("nothing to move is refused in plain words", !r.ok && r.e === "Nothing to move.", r);
  ok("the claim is still Cara's after the refusals", (await q1("SELECT assigned_to FROM claims WHERE id = ?", some)).assigned_to === U("Cara Agent"));
}

S("A second upload the same day tops people up; it never gives a whole day's claims again");
{
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND state = 'open'", sun.id);
  await newDay();
  const a = await load(made("TU", 120));
  ok("120 claims, three billers with a limit of 35: 35 each, 15 stay in the pool; enough inventory, so no question", a.applied === 105 && JSON.stringify(await per("TU")) === "[35,35,35]" && !a.short, [a.applied, await per("TU"), !!a.short]);
  const b = await load(made("TV", 30));
  ok("another 30 the same day: nobody has room left, nothing is given, and the line says why", b.applied === 0 && b.reason === "everyone has been given their daily target and 10 more today" && JSON.stringify(await per("TV")) === "[0,0,0]", b);
  // one of Arun's is returned to the pool: he can be given one more today
  const one1 = (await q("SELECT id FROM claims WHERE claim_no LIKE 'TU-%' AND assigned_to = ? LIMIT 1", U("Arun Agent")))[0].id;
  await TI("alloc.unassign", { ids: [one1] });
  const c = await load(made("TW", 1));
  ok("a claim returned to the pool frees his limit: the next allocation gives him one", c.applied === 1 && (await day())["Arun Agent"].room === 0, [c.applied, (await day())["Arun Agent"]]);
  await newDay();
  const d = await day();
  ok("the next working day everyone has their whole limit again", THREE.every((n) => d[n].given_today === 0 && d[n].room === 35), THREE.map((n) => d[n].room));
}

S("A different daily target, and someone out today");
{
  await sql("UPDATE users SET capacity = 10 WHERE id = ?", U("Arun Agent"));
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND state = 'open'", sun.id);
  await newDay();
  const a = await load(made("DT", 80));
  ok("Arun's daily target is 10, so 20 today; 80 claims: Arun 20, Bela and Cara 30 each", JSON.stringify(await per("DT")) === "[20,30,30]" && !!a.short && a.short.room === 90, [await per("DT"), a.short && a.short.room]);
  await sql("UPDATE users SET capacity = 25 WHERE id = ?", U("Arun Agent"));
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND state = 'open'", sun.id);
  await newDay();
  await TI("team.setOut", { user_id: U("Cara Agent"), out: true, reason: "Leave" });
  const b = await load(made("DO", 30));
  ok("Cara out today: the 30 go to Arun and Bela, 15 each", JSON.stringify(await per("DO")) === "[15,15,0]" && !!b.short && b.short.people.length === 2, await per("DO"));
  await TI("team.setOut", { user_id: U("Cara Agent"), out: false });
}

S("Every planned claim reaches a biller's own list (a team lead added to the team by hand is never planned)");
{
  await sql("UPDATE claims SET state = 'excluded' WHERE client_id = ? AND state = 'open'", sun.id);
  await newDay();
  // the client's own team (Locations, the client-level row) with the team lead added by hand; Downtown has no team of its own
  await TI("clients.saveTeam", { client_id: sun.id, team: [...THREE.map(U), U("Tina Lead")] });
  await TI("clients.saveTeam", { location_id: downtown.id, team: [] });
  const names = Object.keys(await day());
  ok("the day's team lists only the three billers, not the team lead added by hand", JSON.stringify(names.sort()) === JSON.stringify(THREE), names);
  const a = await load(made("EV", 24));
  const said = Object.fromEntries(a.perUser.filter((u) => u.count).map((u) => [u.name, u.count]));
  const db = Object.fromEntries((await q("SELECT u.name, COUNT(*) AS n FROM claims c JOIN users u ON u.id = c.assigned_to WHERE c.claim_no LIKE 'EV-%' AND c.state = 'assigned' GROUP BY u.name")).map((r) => [r.name, r.n]));
  ok("what the allocation says each got is exactly what the database has: 8 each, none left in the pool", a.applied === 24 && JSON.stringify(said) === JSON.stringify(db) && THREE.every((n) => db[n] === 8), [a.applied, said, db]);
  const seen = {};
  for (const n of THREE) seen[n] = (await as(TOK[n])("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 })).ready;
  ok("each biller's own My queue, read fresh (as after a refresh), counts their claims", THREE.every((n) => seen[n] && seen[n].n >= db[n]), seen);
  await TI("clients.saveTeam", { client_id: sun.id, team: THREE.map(U) });
  await TI("clients.saveTeam", { location_id: downtown.id, team: THREE.map(U) });
}

S("On the page");
{
  ok("what someone can take today: the day's team's number (room), 0 when they have had their limit", app.roomOf({ room: 0, cap: 35 }) === 0 && app.roomOf({ room: 12, cap: 35 }) === 12);
  ok("a server older than the page (no room): the daily target alone, 35 when there is none", app.roomOf({ cap: 25 }) === 25 && app.roomOf({}) === 35);
  ok("the even split in words: 10 each · 10 or 11 each · 15 each for 2 of them", app.evenWords([10, 10, 10]) === "10 each" && app.evenWords([10, 11, 11]) === "10 or 11 each" && app.evenWords([15, 15, 0]) === "15 each for 2 of them", [app.evenWords([10, 10, 10]), app.evenWords([10, 11, 11]), app.evenWords([15, 15, 0])]);
  const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("the Allocate screen splits by what each can take today and asks before its preview when the inventory is short", /evenShares\(teamIn, roomOf, filtered\.length\)/.test(src) && /isShort && !manual && !shortAnswered\.current/.test(src));
  ok("the upload offers the pop-up after its own allocation, and so does Allocate now", /<ShortInventoryModal key=\{k \+/.test(src) && /setShort\(\{ short: res\.short/.test(src));
}

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
