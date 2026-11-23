/* Suite 65: the owner's three asks of 24 Nov 2026.
   1. Follow-up: due 15 days after the date worked (DOW + 15), for every client and every SAAG status (it was 30, 14 or 7 by
      status, or the client's own default), moved to the next working day; a biller may still pick another date.
   2. Urgent allocation: a team lead gives claims of one client (ticked, or claim numbers pasted and found) to one biller or
      splits them evenly; they go to the top of each list with an Urgent tag and a bell notice, whatever their follow-up date,
      and come on top of the day's target + 10. Worked, they are no longer urgent.
   3. (Page only) the Claims page's State filter starts empty: checked by the browser crawl.
   A stand-in for Purview Shastra's roster; made-up people and data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AG = (emp_id, name, lead, project) => P({ emp_id, name, project, reports_to: lead, email: mail(name) });
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE),
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
const TI = as(TOK["Tina Lead"]), LEO = as(TOK["Leo Lead"]), ARUN = as(TOK["Arun Agent"]), BELA = as(TOK["Bela Agent"]);
const sun = (await A("clients.list")).clients.find((c) => c.name === SUN);
const T = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOnOrAfter = (iso) => { let d = iso; for (let i = 0; i < 7; i++) { const w = new Date(d + "T00:00:00Z").getUTCDay(); if (w !== 0 && w !== 6) return d; d = addDays(d, 1); } return d; };
// fresh claims of Sunrise, each given straight to a person (or left in the pool), with a known claim number
let seq = 0;
const make = async (n, who, extra = {}) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    seq++; const id = "s65-" + seq, no = "S65-" + String(4000 + seq);
    await sql(`INSERT INTO claims (id, client_id, match_key, claim_no, patient, payer, dos, balance, priority, tier, status_class, state, assigned_to, assigned_at, created_at, updated_at, follow_up_on)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, sun.id, "claim:" + no.toLowerCase(), no, "Testpatient, U" + seq, "Aetna", "2026-09-01", 100 + seq, extra.priority ?? 50, "Medium", "denied",
      who ? "assigned" : "open", who ? U(who) : null, who ? (extra.at ?? Date.now()) : null, Date.now(), Date.now(), extra.follow_up_on ?? "");
    out.push({ id, no });
  }
  return out;
};
await sql("UPDATE claims SET state = 'excluded', assigned_to = NULL, assigned_at = NULL WHERE client_id = ?", sun.id);   // start with an empty desk

S("1. Follow-up: due 15 days after the date worked, for every status (the owner's rule)");
{
  const inProcess = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } };
  const review = { saag: { status: "Claim Paid", sub_status: "Already Posted", action: "Added in Auth invalid Carelon Spreadsheet", bucket: "Purview", effective: "Pending-Purview internal review" }, note: { source: "Portal", findings: "Already posted, sent for internal review", action: "review" } };
  const [c1, c2, c3] = await make(3, "Arun Agent");
  const due = weekdayOnOrAfter(addDays(istToday, 15));
  const r1 = await T(() => ARUN("queue.complete", { id: c1.id, ...inProcess, today: istToday }));
  const f1 = await q1("SELECT follow_up_on FROM claims WHERE id = ?", c1.id);
  ok("in process (was 30 days): follow-up due on the date worked + 15 days (" + due + ")", r1.ok && f1.follow_up_on === due, [r1.e, f1]);
  const r2 = await T(() => ARUN("queue.complete", { id: c2.id, ...review, today: istToday }));
  const f2 = await q1("SELECT follow_up_on FROM claims WHERE id = ?", c2.id);
  ok("internal review (was 7 days): also the date worked + 15 days", r2.ok && f2.follow_up_on === due, [r2.e, f2]);
  const picked = weekdayOnOrAfter(addDays(istToday, 9));
  const r3 = await T(() => ARUN("queue.complete", { id: c3.id, ...inProcess, follow_up_on: picked, today: istToday }));
  const f3 = await q1("SELECT follow_up_on FROM claims WHERE id = ?", c3.id);
  ok("a date the biller picks (the payer gave one) is kept", r3.ok && f3.follow_up_on === picked, [r3.e, f3]);
  await sql("UPDATE clients SET follow_up_days = 45 WHERE id = ?", sun.id);
  const [c4] = await make(1, "Arun Agent");
  await ARUN("queue.complete", { id: c4.id, ...inProcess, today: istToday });
  ok("a client's old 'default follow-up' (45) no longer changes it: still + 15", (await q1("SELECT follow_up_on FROM claims WHERE id = ?", c4.id)).follow_up_on === due);
  // a worked file: a claim with a date worked and no follow-up date of its own
  app.setToken(TOK["Tina Lead"]);
  await app.uploadClaims({ client_id: sun.id, location_id: null, kind: "worked", file_name: "S65 worked.xlsx", rows_read: 1, summary: {},
    claims: [{ match_key: "claim:s65-w1", claim_no: "S65-W1", patient: "Testpatient, W1", payer: "Cigna", dos: "2026-09-02", balance: 210, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", last_worked_on: "2026-11-02" }] });
  const w = await q1("SELECT follow_up_on FROM claims WHERE claim_no = 'S65-W1'");
  ok("a worked file's claim worked on 2026-11-02 with no follow-up date: due 2026-11-17 (+ 15)", w && w.follow_up_on === "2026-11-17", w);
}

S("2. Urgent allocation: to one biller, at the top of the list, with a bell notice");
{
  await sql("UPDATE claims SET state = 'excluded', assigned_to = NULL, assigned_at = NULL WHERE client_id = ?", sun.id);
  const normal = await make(4, "Arun Agent", { priority: 95 });   // given earlier today, high priority
  const pool = await make(3, null, { priority: 10 });
  const before = (await TI("team.today", { client_id: sun.id })).members.find((m) => m.name === "Arun Agent");
  const r = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: pool.map((x) => x.id), user_ids: [U("Arun Agent")] }));
  ok("Tina gives 3 claims from the pool to Arun as urgent", r.ok && r.r.given === 3 && r.r.per[0].count === 3, r);
  const after = (await TI("team.today", { client_id: sun.id })).members.find((m) => m.name === "Arun Agent");
  ok("they come on top of his day: his given today and room are unchanged (" + before.given_today + ", " + before.room + ")", after.given_today === before.given_today && after.room === before.room, [before, after]);
  const list = (await ARUN("queue.list", { day_from_ms: 0 })).rows;
  ok("My day lists the 3 urgent claims first, tagged, though the others have a higher priority", list.slice(0, 3).every((x) => x.urgent === 1) && list.slice(3).every((x) => !x.urgent), list.map((x) => [x.claim_no, x.urgent, x.priority]));
  const sum = await ARUN("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 });
  ok("the Ready to work card counts 3 urgent", sum.urgent === 3, sum);
  const bell = await q1("SELECT text FROM user_notices WHERE user_id = ? ORDER BY at DESC LIMIT 1", U("Arun Agent"));
  ok("his bell: 3 urgent claims of Sunrise from Tina, at the top of his list", bell && /^3 urgent claims of Sunrise Eye Care from Tina Lead: they are at the top of your list/.test(bell.text), bell);
  const nx = await ARUN("queue.next", { today: istToday });
  ok("Work the next claim opens an urgent one first", nx.claim && pool.some((x) => x.id === nx.claim.id), nx.claim && nx.claim.claim_no);
  const hist = await q1("SELECT text, data_json FROM claim_events WHERE claim_id = ? AND kind = 'assigned' ORDER BY at DESC LIMIT 1", pool[0].id);
  ok("the claim's history says it was given as urgent", hist && /\(urgent\)/.test(hist.text) && /"via":"urgent"/.test(hist.data_json), hist);
  const inProcess = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } };
  await ARUN("queue.complete", { id: nx.claim.id, ...inProcess, today: istToday });
  const list2 = (await ARUN("queue.list", { day_from_ms: 0 })).rows;
  ok("worked, it is no longer urgent; the other 2 still are", list2.filter((x) => x.urgent).length === 2 && !list2.find((x) => x.id === nx.claim.id).urgent, list2.map((x) => [x.claim_no, x.urgent, x.state]));
  const after2 = (await TI("team.today", { client_id: sun.id })).members.find((m) => m.name === "Arun Agent");
  ok("...and still not counted in his day once worked", after2.given_today === before.given_today, [before.given_today, after2.given_today]);
  // a claim parked until a later follow-up date, given as urgent, is ready now
  const [later] = await make(1, null, { follow_up_on: addDays(istToday, 20) });
  await TI("alloc.urgent", { client_id: sun.id, ids: [later.id], user_ids: [U("Bela Agent")] });
  const bs = await BELA("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 });
  const bn = await BELA("queue.next", { today: istToday });
  ok("an urgent claim with a follow-up date 20 days away is ready now and opens with Next", bs.ready.n >= 1 && bs.urgent === 1 && bn.claim && bn.claim.id === later.id, [bs, bn.claim && bn.claim.claim_no]);
  // a claim already on Arun's list made urgent: stays his, counted as before (not twice), now tagged
  const n0 = (await TI("team.today", { client_id: sun.id })).members.find((m) => m.name === "Arun Agent").given_today;
  await TI("alloc.urgent", { client_id: sun.id, ids: [normal[0].id], user_ids: [U("Arun Agent")] });
  const n1 = (await TI("team.today", { client_id: sun.id })).members.find((m) => m.name === "Arun Agent").given_today;
  const row = (await ARUN("queue.list", { day_from_ms: 0 })).rows.find((x) => x.id === normal[0].id);
  ok("one already on his list, made urgent: tagged and first, his day's count unchanged", row && row.urgent === 1 && n1 === n0, [row && row.urgent, n0, n1]);
}

S("3. Urgent allocation split evenly, and by pasted claim numbers");
{
  await sql("UPDATE claims SET state = 'excluded', assigned_to = NULL, assigned_at = NULL WHERE client_id = ?", sun.id);
  const five = await make(5, null);
  const r = await TI("alloc.urgent", { client_id: sun.id, ids: five.map((x) => x.id), user_ids: [U("Arun Agent"), U("Bela Agent")] });
  ok("5 claims split evenly across Arun and Bela: 3 and 2", r.given === 5 && JSON.stringify(r.per.map((x) => [x.name, x.count])) === JSON.stringify([["Arun Agent", 3], ["Bela Agent", 2]]), r.per);
  const held = await q("SELECT assigned_to, COUNT(*) AS n FROM claims WHERE id IN (SELECT value FROM json_each(?)) GROUP BY assigned_to", JSON.stringify(five.map((x) => x.id)));
  ok("...and that is what they hold", held.length === 2 && held.every((h) => (h.assigned_to === U("Arun Agent") && h.n === 3) || (h.assigned_to === U("Bela Agent") && h.n === 2)), held);
  const more = await make(3, null);
  await sql("UPDATE claims SET state = 'closed' WHERE id = ?", more[2].id);
  const look = await TI("alloc.lookup", { client_id: sun.id, claim_nos: [more[0].no.toLowerCase(), " " + more[1].no + " ", more[2].no, "S65-NOPE", more[0].no] });
  ok("pasted numbers (any case, spaces, repeated) are found once each", look.rows.filter((x) => x.workable).map((x) => x.id).sort().join() === [more[0].id, more[1].id].sort().join(), look.rows);
  ok("...a closed one is found but cannot be given now", look.rows.some((x) => x.id === more[2].id && !x.workable && x.why === "closed"), look.rows);
  ok("...and an unknown number is listed as not found", JSON.stringify(look.not_found) === JSON.stringify(["S65-NOPE"]), look.not_found);
  const r2 = await TI("alloc.urgent", { client_id: sun.id, ids: more.map((x) => x.id), user_ids: [U("Bela Agent")] });
  ok("given with the closed one among them: 2 given, 1 left out", r2.given === 2 && r2.left_out === 1 && (await q1("SELECT state FROM claims WHERE id = ?", more[2].id)).state === "closed", r2);
}

S("4. Who may do it");
{
  const [c] = await make(1, null);
  const b = await T(() => ARUN("alloc.urgent", { client_id: sun.id, ids: [c.id], user_ids: [U("Arun Agent")] }));
  ok("a biller cannot give urgent claims", !b.ok, b);
  const l = await T(() => LEO("alloc.urgent", { client_id: sun.id, ids: [c.id], user_ids: [U("Arun Agent")] }));
  ok("Leo (Lakeview's lead) cannot give Sunrise's claims", !l.ok, l);
  const lk = await T(() => LEO("alloc.lookup", { client_id: sun.id, claim_nos: [c.no] }));
  ok("...nor look up Sunrise's claim numbers", !lk.ok, lk);
  const d = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: [c.id], user_ids: [U("Dev Agent")] }));
  ok("Tina cannot give Sunrise's claims to Dev, who does not work Sunrise", !d.ok && /cannot be given/.test(d.e), d);
  ok("...and the claim stayed in the pool", (await q1("SELECT state, assigned_to FROM claims WHERE id = ?", c.id)).state === "open");
  const none = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: [c.id], user_ids: [] }));
  ok("nobody picked: refused with a plain reason", !none.ok && /who gets/.test(none.e), none);
}

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
