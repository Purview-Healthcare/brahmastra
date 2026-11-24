/* Suite 68: the testers' round 2 findings on allocation, urgent claims, desks, entries, uploads, Client 360 and search (2.119.0).
   The server keeps each biller to the day's limit even for an older Allocate screen; an urgent claim given twice stays outside
   target + 10 and counts as left over whatever its follow-up date; an edited entry's weekend follow-up moves to a working day;
   My day shows an urgent claim as due today; two people taking one hand-off, or Next claim in two tabs, do not both win; claim
   numbers that differ in their letters stay two claims; a blank file row is no claim; a claim AR closes and sends to Posting is
   "sent to Posting" in Client 360 whatever the milliseconds; % and _ in a search are themselves; a file with Last Name and First
   Name columns gives "Last, First". A stand-in for Purview Shastra's roster; made-up people, patients and claim numbers only. */
import { makeRig } from "./rig.mjs";
import { createRequire } from "module";
const XLSX = createRequire(import.meta.url)("xlsx");
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care";
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", project: SUN, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Lara Lead") }),
  P({ emp_id: "A1", name: "Bela Agent", project: SUN, reports_to: "Tina Lead", email: mail("Bela Agent") }),
  P({ emp_id: "A2", name: "Dev Agent", project: SUN, reports_to: "Tina Lead", email: mail("Dev Agent") }),
  P({ emp_id: "D1", name: "Pia Poster", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Pia Poster") }),
  P({ emp_id: "D2", name: "Otto Poster", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Otto Poster") }),
];
const fetchMock = async (url) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_holidays")) return J({ ok: true, today: "2026-11-08", holidays: [] });
  if (url.includes("brahmastra_live") || url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ code: "PGRST202", message: "not set up" }, 404);
  return new Response("nope", { status: 500 });
};
const _log = console.log; console.log = (...a) => { if (/^(Snapshot|Folders|Shastra|TAT|Escalation|Digest)/.test(String(a[0]))) return; _log(...a); };
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
await sql("UPDATE sessions SET expires_at = expires_at + ?", 400 * 86400000);
const TI = as(TOK["Tina Lead"]), LARA = as(TOK["Lara Lead"]), BELA = as(TOK["Bela Agent"]), DEV = as(TOK["Dev Agent"]), PIA = as(TOK["Pia Poster"]), OTTO = as(TOK["Otto Poster"]);
const sun = (await A("clients.list")).clients.find((c) => c.name === SUN);
await sql("UPDATE claims SET state = 'excluded', assigned_to = NULL WHERE client_id = ?", sun.id);
await sql("UPDATE users SET capacity = 20, assign_per_day = NULL WHERE id IN (?, ?)", U("Bela Agent"), U("Dev Agent"));
await sql("UPDATE clients SET targets_json = '{}' WHERE id = ?", sun.id);
await A("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Pia Poster"), backup: U("Otto Poster") });
// the clock: India wall time, one millisecond more at each read (as a real server's clock moves inside a call)
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const RealDate = globalThis.Date; let fake = null;
class FDate extends RealDate { constructor(...a) { if (a.length === 0 && fake != null) super(fake); else super(...a); } static now() { return fake != null ? fake++ : RealDate.now(); } }
globalThis.Date = FDate; try { app.Date = FDate; } catch (e) {}
const setNow = (ms) => { fake = ms; };
const at = (d, h, m = 0) => IST(2026, 11, d, h, m);
const T = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
let seq = 0;
const make = async (o = {}) => {
  seq++; const id = "s68-" + seq, no = o.no ?? "S68-" + String(10000 + seq), now = Date.now();
  await sql(`INSERT INTO claims (id, client_id, match_key, claim_no, patient, payer, dos, balance, priority, tier, status_class, state, assigned_to, assigned_at, follow_up_on, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, sun.id, "claim:" + String(no).toLowerCase(), no, o.patient ?? "Testpatient, Q" + seq, "Aetna", "2026-09-30", 100 + seq, o.priority ?? 50, "Medium", "denied",
    o.state ?? (o.who ? "assigned" : "open"), o.who ? U(o.who) : null, o.who ? (o.assigned_at ?? now) : null, o.follow_up_on ?? "", now - 1000, now - 1000);
  return id;
};
const FU = { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" };
const CLOSE = { status: "Claim Paid", sub_status: "Already Posted", action: "Moved To Closed/Non Workable", bucket: "Closed", effective: "Processing-Closed" };
const POST = { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Closed", effective: "AR Closed-Pending Posting" };
const NOTE = { source: "Portal", findings: "Checked the payer portal, claim on file" };
const PDF = Buffer.from("%PDF-1.4 made-up eob\n%%EOF").toString("base64");
const save = async (who, id, saag, extra = {}) => { await who("queue.open", { id }); if (saag === POST) await who("attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF }); return who("queue.complete", { id, saag, note: NOTE, desk: true, ...extra }); };
const member = async (name) => (await TI("team.today", { client_id: sun.id })).members.find((m) => m.name === name);

S("The day's limit on the server: an Allocate screen opened before another team lead's allocation cannot give a second day");
setNow(at(17, 10, 0));   // Tuesday 17 Nov 2026, 10:00
const pool = []; for (let i = 0; i < 70; i++) pool.push(await make());
const dev0 = await member("Dev Agent");
ok("Dev's limit today is his target and 10 more (20 + 10 = 30), nothing given yet", dev0.cap === 30 && dev0.given_today === 0 && dev0.room === 30, [dev0.cap, dev0.given_today, dev0.room]);
// Lara's Allocate screen was opened now (room 30), Tina allocates first
const r1 = await TI("alloc.apply", { client_id: sun.id, strategy: "manual", assignments: pool.slice(0, 30).map((id) => ({ id, user_id: U("Dev Agent") })) });
ok("Tina gives Dev his 30", r1.applied === 30 && !r1.message, [r1.applied, r1.message]);
const r2 = await LARA("alloc.apply", { client_id: sun.id, strategy: "manual", assignments: pool.slice(30, 50).map((id) => ({ id, user_id: U("Dev Agent") })) });
ok("Lara's older screen gives Dev 20 more: none are given, he is at today's limit", r2.applied === 0, r2.applied);
ok("...and the answer says so in plain words (who, the limit, how many stay in the pool)", /Dev Agent is at today's limit \(30 claims\), so 20 more claims stay in the pool/.test(r2.message || ""), r2.message);
ok("...those 20 claims are still in the pool", (await q1(`SELECT COUNT(*) AS n FROM claims WHERE id IN (${pool.slice(30, 50).map(() => "?").join(",")}) AND state = 'open' AND assigned_to IS NULL`, ...pool.slice(30, 50))).n === 20);
ok("Dev holds exactly his day's 30", (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'assigned'", U("Dev Agent"))).n === 30);
const r3 = await LARA("alloc.apply", { client_id: sun.id, strategy: "manual", assignments: [...pool.slice(50, 60).map((id) => ({ id, user_id: U("Bela Agent") })), ...pool.slice(60, 62).map((id) => ({ id, user_id: U("Dev Agent") }))] });
ok("in one plan, Bela (room 30) gets her 10 while Dev's 2 stay in the pool", r3.applied === 10 && r3.held_back.length === 1 && r3.held_back[0].n === 2 && /Dev Agent/.test(r3.message), [r3.applied, r3.held_back, r3.message]);
await sql("UPDATE users SET assign_per_day = 12 WHERE id = ?", U("Bela Agent"));
const r4 = await TI("alloc.apply", { client_id: sun.id, strategy: "manual", assignments: pool.slice(62, 66).map((id) => ({ id, user_id: U("Bela Agent") })) });
ok("a team lead's own number for Bela (12 a day) is her limit: 2 more of 4, the other 2 stay in the pool", r4.applied === 2 && /Bela Agent is at today's limit \(12 claims\), so 2 more claims stay in the pool/.test(r4.message), [r4.applied, r4.message]);
await sql("UPDATE users SET assign_per_day = NULL WHERE id = ?", U("Bela Agent"));
const urg = await TI("alloc.urgent", { client_id: sun.id, ids: pool.slice(66, 68), split: [{ user_id: U("Dev Agent"), count: 2 }] });
ok("urgent claims still go on top of the limit (Dev gets 2 urgent at 30 of 30)", urg.given === 2 && (await member("Dev Agent")).given_today === 30, [urg.given, (await member("Dev Agent")).given_today]);
const own = await TI("alloc.apply", { client_id: sun.id, strategy: "manual", assignments: pool.slice(68, 70).map((id) => ({ id, user_id: U("Dev Agent") })), summary: { own_numbers: true } });
ok("the team lead's own numbers typed in the 'inventory is less' pop-up (shown with the limit beside them) are given as typed", own.applied === 2 && !own.message, [own.applied, own.message]);

S("An urgent claim given again to the same biller stays outside target + 10");
setNow(at(18, 10, 0));   // a new day
const u4 = []; for (let i = 0; i < 4; i++) u4.push(await make());
const g0 = (await member("Bela Agent")).given_today;
await TI("alloc.urgent", { client_id: sun.id, ids: u4, split: [{ user_id: U("Bela Agent"), count: 4 }] });
const ua = await q1("SELECT urgent_at, assigned_at FROM claims WHERE id = ?", u4[0]);
ok("4 urgent claims for Bela are not counted in her day", (await member("Bela Agent")).given_today === g0, [(await member("Bela Agent")).given_today, g0]);
setNow(at(18, 10, 30));
await TI("alloc.urgent", { client_id: sun.id, ids: u4, split: [{ user_id: U("Bela Agent"), count: 4 }] });
ok("the same 4 given to her again (a double click, a second team lead): still not counted in her day", (await member("Bela Agent")).given_today === g0, [(await member("Bela Agent")).given_today, g0]);
const ub = await q1("SELECT urgent_at, assigned_at, urgent_to FROM claims WHERE id = ?", u4[0]);
ok("...each keeps the time it was first made urgent, and stays urgent for her", ub.urgent_at === ua.urgent_at && ub.assigned_at === ua.assigned_at && ub.urgent_to === U("Bela Agent"), [ua, ub]);
const s1 = await BELA("queue.summary", { day_from_ms: at(18, 0), day_to_ms: at(19, 0) - 1 });
ok("My day still shows the 4 as urgent", s1.urgent === 4, s1.urgent);

S("Left over counts urgent claims whatever their follow-up date (Team status and Live status)");
setNow(at(19, 7, 0));
await sql("DELETE FROM claims WHERE assigned_to = ? AND id NOT IN (" + u4.map(() => "?").join(",") + ")", U("Bela Agent"), ...u4);
await sql(`UPDATE claims SET follow_up_on = '2026-12-20' WHERE id IN (?, ?)`, u4[0], u4[1]);   // two urgent with a later follow-up
const ord = [await make({ who: "Bela Agent", assigned_at: at(18, 11, 0) }), await make({ who: "Bela Agent", assigned_at: at(18, 11, 0), follow_up_on: "2026-12-20" })];
setNow(at(19, 12, 0));
const ts = (await TI("team.status", { from: "2026-11-19", to: "2026-11-19", today_only: 1 })).rows.find((r) => r.name === "Bela Agent");
ok("Team status left over: Bela's 4 urgent claims (2 with a later follow-up) and her 1 ordinary claim ready to work = 5", ts.left === 5, ts.left);
const hu = (await TI("team.huddle", {})).rows.find((r) => r.name === "Bela Agent");
ok("Live status carried says the same 5", hu.carried === 5, hu.carried);
const s2 = await BELA("queue.summary", { day_from_ms: at(19, 0), day_to_ms: at(20, 0) - 1 });
ok("My day's ready to work agrees (5); the ordinary claim with a later follow-up is waiting", s2.ready.n === 5 && s2.waiting === 1, [s2.ready, s2.waiting]);
void ord;

S("Editing an entry moves a weekend follow-up date to the next working day, as saving does");
setNow(at(12, 11, 0));   // Thursday 12 Nov
const ed = await make({ who: "Dev Agent" });
await save(DEV, ed, CLOSE);
const nid = (await q1("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work'", ed)).id;
setNow(at(13, 11, 0));   // Friday 13 Nov: + 15 = Saturday 28 Nov
await DEV("notes.update", { id: nid, saag: FU, note: NOTE });
ok("a closing entry edited into a follow-up on Friday 13 Nov: due Monday 30 Nov (28 Nov is a Saturday)", (await q1("SELECT follow_up_on FROM claims WHERE id = ?", ed)).follow_up_on === "2026-11-30" && (await q1("SELECT follow_up_on FROM notes WHERE id = ?", nid)).follow_up_on === "2026-11-30", await q1("SELECT follow_up_on FROM claims WHERE id = ?", ed));
await DEV("notes.update", { id: nid, saag: FU, note: NOTE, follow_up_on: "2026-11-21" });
ok("an edit that picks Saturday 21 Nov gets Monday 23 Nov", (await q1("SELECT follow_up_on FROM claims WHERE id = ?", ed)).follow_up_on === "2026-11-23", await q1("SELECT follow_up_on FROM claims WHERE id = ?", ed));
await DEV("notes.update", { id: nid, saag: FU, note: NOTE, follow_up_on: "2026-11-25" });
ok("an edit that picks a working day keeps it (Wednesday 25 Nov)", (await q1("SELECT follow_up_on FROM claims WHERE id = ?", ed)).follow_up_on === "2026-11-25");
const far = await T(() => DEV("notes.update", { id: nid, saag: FU, note: NOTE, follow_up_on: "2028-01-05" }));
ok("an edit that picks a date over a year ahead is refused, as saving is", !far.ok && /within a year/.test(far.e), far);

S("My day's Due: an urgent claim is due today, whatever its follow-up date");
const due = app.myDayDue([{ id: "u1", state: "assigned", urgent: 1, follow_up_on: "2026-12-20" }, { id: "o1", state: "assigned", urgent: 0, follow_up_on: "" }, { id: "o2", state: "assigned", urgent: 0, follow_up_on: "" }, { id: "w1", state: "assigned", urgent: 0, follow_up_on: "2026-11-24" }], 1, "2026-11-19");
ok("the urgent claim with a follow-up 31 days away shows Today, not In 31 days", due.u1.days === 0 && due.u1.label === "Today", due.u1);
ok("it takes no day's slot: the first ordinary claim is still Today and the next Tomorrow (one a day)", due.o1.label === "Today" && due.o2.label === "Tomorrow", [due.o1, due.o2]);
ok("an ordinary claim waiting for its follow-up still shows when it is due (In 5 days)", due.w1.label === "In 5 days", due.w1);

S("Two desk people take the same hand-off: the second is told it was taken");
setNow(at(20, 10, 0));
const hs = [await make({ who: "Dev Agent" }), await make({ who: "Dev Agent" })];
for (const id of hs) await save(DEV, id, POST);
const hOf = async (id) => q1("SELECT * FROM handoffs WHERE claim_id = ? AND dept = 'posting' ORDER BY created_at DESC LIMIT 1", id);
const h1 = await hOf(hs[0]);
ok("the claim went to Posting (pending, nobody on it yet)", h1 && h1.status === "pending" && !h1.assigned_to, h1 && [h1.status, h1.assigned_to]);
const a1 = await T(() => PIA("handoffs.assign", { id: h1.id, user_id: U("Pia Poster"), was: "" }));
const a2 = await T(() => OTTO("handoffs.assign", { id: h1.id, user_id: U("Otto Poster"), was: "" }));
ok("Pia takes it from the list", a1.ok, a1);
ok("Otto, from the same list a moment later, is told Pia was just given it", !a2.ok && /Pia Poster was just given this hand-off/.test(a2.e), a2);
ok("the hand-off stays with Pia", (await hOf(hs[0])).assigned_to === U("Pia Poster"));
const a3 = await T(() => PIA("handoffs.assign", { id: h1.id, user_id: U("Otto Poster"), was: U("Pia Poster") }));
ok("Pia can still pass it to Otto on purpose (her list shows it with her)", a3.ok && (await hOf(hs[0])).assigned_to === U("Otto Poster"), a3);
const h2 = await hOf(hs[1]);
const [b1, b2] = await Promise.all([T(() => PIA("handoffs.assign", { id: h2.id, user_id: U("Pia Poster") })), T(() => OTTO("handoffs.assign", { id: h2.id, user_id: U("Otto Poster") }))]);
ok("both pressing at the same moment: exactly one of them is told yes", [b1.ok, b2.ok].filter(Boolean).length === 1, [b1.ok || b1.e, b2.ok || b2.e]);
const w2 = await hOf(hs[1]);
ok("...and the hand-off is with the one told yes", w2.assigned_to === (b1.ok ? U("Pia Poster") : U("Otto Poster")), [w2.assigned_to, b1.ok, b2.ok]);
ok("...with one 'assigned' line in the claim's history", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'handoff_assigned'", hs[1])).n === 1);

S("Next claim pressed in two tabs at once opens one claim");
setNow(at(20, 11, 0));
await sql("UPDATE claims SET state = 'open', assigned_to = NULL WHERE assigned_to = ? AND state IN ('assigned','in_progress')", U("Bela Agent"));
const nx = []; for (let i = 0; i < 3; i++) nx.push(await make({ who: "Bela Agent", priority: 90 - i }));
const [n1, n2] = await Promise.all([BELA("queue.next", {}), BELA("queue.next", {})]);
ok("both tabs get the same claim (the top one)", n1.claim && n2.claim && n1.claim.id === n2.claim.id && n1.claim.id === nx[0], [n1.claim && n1.claim.id, n2.claim && n2.claim.id]);
ok("only one claim is open on her desk", (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'in_progress'", U("Bela Agent"))).n === 1);
ok("one 'opened' line in its history", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'opened'", nx[0])).n === 1);

S("Claim numbers that differ only in their letters stay two claims; the same number written differently is one");
const row = (no, extra = {}) => ({ match_key: "claim:" + no.toLowerCase().replace(/\s+/g, ""), claim_no: no, patient: "Testpatient, " + no.replace(/[^A-Z0-9]/gi, ""), payer: "Aetna", dos: "2026-09-15", balance: 150, status_class: "denied", tier: "Medium", priority: 50, ...extra });
const up = (claims) => TI("inventory.upload", { client_id: sun.id, kind: "fresh", file_name: "s68.xlsx", rows_read: claims.length, source: "file", claims, final: true, summary: {} });
const u1 = await up([row("MAP-7300001"), row("MPB-7300001")]);
ok("MAP-7300001 and MPB-7300001 (two locations' prefixes) are two new claims", u1.inserted === 2, u1);
const byNo = Object.fromEntries((await q("SELECT id, claim_no FROM claims WHERE client_id = ? AND claim_no IN ('MAP-7300001','MPB-7300001')", sun.id)).map((r) => [r.claim_no, r.id]));
ok("both are on file under their own numbers", Object.keys(byNo).length === 2);
const bal = async (id) => (await q1("SELECT balance FROM claims WHERE id = ?", id)).balance;
const u2 = await up([row("map 7300001", { balance: 99 })]);
ok("'map 7300001' (spaces, lower case) refreshes MAP-7300001, not a new claim", u2.inserted === 0 && u2.updated === 1 && (await bal(byNo["MAP-7300001"])) === 99 && (await bal(byNo["MPB-7300001"])) === 150, [u2, await bal(byNo["MAP-7300001"]), await bal(byNo["MPB-7300001"])]);
const u3 = await up([row("MPB-007300001", { balance: 77 })]);
ok("'MPB-007300001' (leading zeros) refreshes MPB-7300001", u3.updated === 1 && (await bal(byNo["MPB-7300001"])) === 77 && (await bal(byNo["MAP-7300001"])) === 99, u3);
const u4f = await up([row("D-5550001"), row("d5550001"), row("E-5550001")]);
ok("in one file, D-5550001 and d5550001 are one claim; E-5550001 is another", u4f.inserted === 2 && u4f.skipped === 1, u4f);
const u5 = await up([row("CLM-6660001"), row("6660001", { match_key: "claim:6660001b" })]);
ok("a number with no letters still goes with the same number with letters (CLM-6660001 and 6660001)", u5.inserted === 1 && u5.skipped === 1, u5);
const dd = await TI("inventory.dedupe", { client_id: sun.id, dry_run: true });
ok("merging duplicates leaves MAP-7300001 and MPB-7300001 apart", dd.duplicates === 0, dd);

S("A file row with no claim number and no patient is not stored as a claim");
const blank = await up([{ match_key: "x", claim_no: "", patient: "", payer: "", dos: "2026-09-15", balance: 10 }, row("S68-BLANK1")]);
ok("the blank row is skipped, the real one added", blank.inserted === 1 && blank.skipped === 1, blank);
ok("no claim with neither a number nor a patient is on file", (await q1("SELECT COUNT(*) AS n FROM claims WHERE client_id = ? AND claim_no = '' AND patient = ''", sun.id)).n === 0);

S("Client 360: a claim AR closes and sends to Posting is 'sent to Posting', whatever the milliseconds inside the save");
setNow(at(23, 10, 0));
const mv = async () => (await TI("creport.get", { client_id: sun.id, from: "2026-11-23", to: "2026-11-23", prev_from: "2026-11-20", prev_to: "2026-11-20" })).data.movement;
const g = (m, k) => (m.find((x) => x.k === k) || { n: 0 }).n;
const cp = await make({ who: "Dev Agent" });
await sql("UPDATE claims SET created_at = ? WHERE id = ?", at(19, 10, 0), cp);
const m0 = await mv();
setNow(at(23, 10, 5)); await save(DEV, cp, POST);
const ho = await q1("SELECT created_at FROM handoffs WHERE claim_id = ?", cp), ev = await q1("SELECT MAX(at) AS at FROM claim_events WHERE claim_id = ? AND kind = 'worked'", cp);
ok("(the claim's event and its hand-off were written some milliseconds apart in the save)", ev.at > ho.created_at, [ev.at - ho.created_at]);
setNow(at(23, 11, 0));
const m1 = await mv();
ok("Client 360 counts it under 'AR close · sent to Posting' (+1), not under 'AR close'", g(m1, "pending_posting") === g(m0, "pending_posting") + 1 && g(m1, "ar_close") === g(m0, "ar_close"), [m0.map((x) => [x.k, x.n]), m1.map((x) => [x.k, x.n])]);
const cc = await make({ who: "Dev Agent" });
await sql("UPDATE claims SET created_at = ? WHERE id = ?", at(19, 10, 0), cc);
setNow(at(23, 11, 5)); await save(DEV, cc, CLOSE);
setNow(at(23, 11, 30));
const m2 = await mv();
ok("a claim AR closes with no desk is still 'AR close' (+1)", g(m2, "ar_close") === g(m1, "ar_close") + 1 && g(m2, "pending_posting") === g(m1, "pending_posting"), [m1.map((x) => [x.k, x.n]), m2.map((x) => [x.k, x.n])]);

S("% and _ typed in a search are those characters, not wildcards");
setNow(at(24, 10, 0));
const sa = await make({ no: "S68_W1", patient: "Testpatient, Under" }), sb = await make({ no: "S68AW1", patient: "Testpatient, Letter" }), sc = await make({ no: "S68-PCT1", patient: "Testpatient, 50%off" });
const list = async (who, p) => (await who("claims.list", { client_id: sun.id, state: "", page_size: 200, ...p })).rows.map((r) => r.id);
const pct = await list(TI, { q: "%" });
ok("a search for '%' finds only the claim with a % in it", pct.length === 1 && pct[0] === sc, pct.length);
const und = await list(TI, { q: "S68_W" });
ok("'S68_W' finds S68_W1 only, not S68AW1", und.includes(sa) && !und.includes(sb), und.length);
ok("a search made of 60 % signs is cut to fit and answers (no server error)", (await T(() => list(TI, { q: "%".repeat(60) }))).ok);
const sug = await TI("claims.suggest", { client_id: sun.id, q: "S68_W" });
ok("the search suggestions take _ as itself too", sug.values.includes("S68_W1") && !sug.values.includes("S68AW1"), sug.values);
await sql("UPDATE claims SET assigned_to = ?, state = 'assigned' WHERE id IN (?, ?)", U("Dev Agent"), sa, sb);
const ql = (await DEV("queue.list", { q: "S68_W" })).rows.map((r) => r.id);
ok("a biller's own list search takes _ as itself", ql.includes(sa) && !ql.includes(sb), ql.length);

S("A file with Last Name and First Name columns gives the patient as 'Last, First'");
const hdr = ["Claim #", "Last Name", "First Name", "DOS", "Balance"];
const objs = [{ "Claim #": "S68-NM1", "Last Name": "Testpatient", "First Name": "Alpha", DOS: "2026-09-15", Balance: "120" }, { "Claim #": "S68-NM2", "Last Name": "Testpatient", "First Name": "", DOS: "2026-09-15", Balance: "80" }];
const mp = app.autoMap(hdr);
const built = app.buildClaims({ rows: objs, mapping: mp, kind: "fresh", today: "2026-11-24" });
ok("the patient column is read with its first name: 'Testpatient, Alpha'", built.claims[0].patient === "Testpatient, Alpha", [mp.patient, built.claims[0].patient]);
ok("a row with no first name keeps the last name alone", built.claims[1].patient === "Testpatient", built.claims[1].patient);
const mp2 = app.autoMap(["Claim #", "First Name", "Last Name", "DOS", "Balance"]);
const built2 = app.buildClaims({ rows: [{ "Claim #": "S68-NM3", "First Name": "Beta", "Last Name": "Testpatient", DOS: "2026-09-15", Balance: "60" }], mapping: mp2, kind: "fresh", today: "2026-11-24" });
ok("First Name before Last Name in the file: still 'Testpatient, Beta'", built2.claims[0].patient === "Testpatient, Beta", [mp2.patient, built2.claims[0].patient]);
const one = app.buildClaims({ rows: [{ "Claim #": "S68-NM4", "Patient Name": "Testpatient, Gamma", DOS: "2026-09-15", Balance: "60" }], mapping: app.autoMap(["Claim #", "Patient Name", "DOS", "Balance"]), kind: "fresh", today: "2026-11-24" });
ok("a file with one patient name column reads it as before", one.claims[0].patient === "Testpatient, Gamma", one.claims[0].patient);
const ws = XLSX.utils.aoa_to_sheet([["Last Name", "First Name", "DOS"], ["Testpatient", "Delta", "2026-09-15"]]), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
const uf = app.urgentFileClaims(buf, "urgent.xlsx");
ok("the urgent box's file reads the two name columns the same way", uf.length === 1 && uf[0].patient === "Testpatient, Delta" && uf[0].dos === "2026-09-15", uf);

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
