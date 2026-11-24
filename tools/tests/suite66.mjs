/* Suite 66: urgent allocation, the owner's change of 24 Nov 2026. The team lead often has no claim numbers, so the urgent
   allocation box finds claims three ways: a search (patient name, account, claim number or payer, and the date of service), a
   file in the inventory layout (each row found by its claim number, else its account number, else the patient name and the date
   of service), or pasted claim numbers; then the team lead types how many each biller gets (or splits them evenly) and the
   claims are given down the list, the first biller's number first. A stand-in for Purview Shastra's roster; made-up people,
   patients and claim numbers only. */
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
const LK = (await A("clients.list")).clients.find((c) => c.name === LAKE);
const tbl = (rows) => rows;
// made-up claims with a known claim number, account, patient and date of service
let seq = 0;
const make = async (o = {}) => {
  seq++; const id = "s66-" + seq, no = o.no ?? "S66-" + String(1000 + seq);
  await sql(`INSERT INTO claims (id, client_id, match_key, claim_no, account_no, patient, payer, dos, balance, priority, tier, status_class, state, assigned_to, assigned_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, o.client ?? sun.id, "claim:" + String(no).toLowerCase() + ":" + id, no, o.acct ?? "", o.patient ?? "Testpatient, Z" + seq, "Aetna",
    o.dos ?? "2026-09-30", 100 + seq, o.priority ?? 50, "Medium", "denied", o.state ?? (o.who ? "assigned" : "open"), o.who ? U(o.who) : null, o.who ? Date.now() : null, Date.now(), Date.now());
  return id;
};
const look = (who, payload) => T(() => who("alloc.lookup", { client_id: sun.id, ...payload }));

S("Ticked on the Claims page: the box gets each claim's details");
const t1 = await make({ no: "S66-T1", acct: "ACT-T1", patient: "Testpatient, T1", dos: "2026-09-11", who: "Arun Agent" });
const t2 = await make({ no: "S66-T2", patient: "Testpatient, T2", dos: "2026-09-12" });
let r = await look(TI, { ids: [t1, t2, "nope"] });
const d1 = r.ok && r.r.rows.find((x) => x.id === t1);
ok("the ticked claims come back with claim number, account, patient, date of service and who has them now", r.ok && r.r.rows.length === 2 && d1 && d1.claim_no === "S66-T1" && d1.account_no === "ACT-T1"
  && d1.patient === "Testpatient, T1" && d1.dos === "2026-09-11" && d1.assigned_name === "Arun Agent" && d1.workable, r);

S("A file in the inventory layout: each row found by claim number, account, or patient and date of service");
const c1 = await make({ no: "S66-F1", acct: "ACC-001", patient: "Testpatient, A1", dos: "2026-09-01" });
const c2 = await make({ no: "S66-F2", acct: "ACC-002", patient: "Testpatient, B2", dos: "2026-09-02" });
const c3 = await make({ no: "S66-F3", acct: "ACC-003", patient: "Fakename, John A", dos: "2026-09-03" });
const c4 = await make({ no: "S66-F4", acct: "ACC-004", patient: "Fakename, John A", dos: "2026-09-03" });
const c5 = await make({ no: "S66-F5", acct: "ACC-005", patient: "Fakename, Jane", dos: "2026-09-03" });
const c6 = await make({ no: "S66-F6", patient: "Testpatient, C6", dos: "2026-09-06", state: "closed" });
const c7 = await make({ no: "S66-F7", patient: "Testpatient, C7", dos: "2026-09-07", state: "in_process" });
await make({ no: "S66-F8", client: LK.id, patient: "Testpatient, C8", dos: "2026-09-08" });
const rows = [
  { claim_no: "s66-f1" },                                              // 0: claim number, any letter case
  { account_no: "acc-002", dos: "2026-09-02" },                        // 1: account and the same date
  { account_no: "ACC-002", dos: "2026-09-09" },                        // 2: account with another date: not this claim
  { patient: "John Fakename", dos: "2026-09-03" },                     // 3: name words in another order, no middle initial: both claims that day
  { patient: "B2 Testpatient", dos: "2026-09-02" },                    // 4: name order swapped
  { patient: "Testpatient, A1", dos: "2026-09-05" },                   // 5: the right name on another date: not found
  { claim_no: "S66-F6" },                                              // 6: closed
  { claim_no: "S66-F7" },                                              // 7: with a desk
  { claim_no: "S66-F8" },                                              // 8: another client's claim number
  { claim_no: "NOPE-1", patient: "Testpatient, A1", dos: "2026-09-01" }, // 9: the claim number is not on file: the name and date find it
  {},                                                                  // 10: nothing to find it by
  { patient: "Jane", dos: "2026-09-03" },                              // 11: one word of the name, with the date
  { account_no: "ACC-005" },                                           // 12: account alone (no date in the file)
];
r = await look(TI, { rows });
const F = r.ok ? r.r.file.found : [], has = (i, ...ids) => JSON.stringify([...(F[i] || [])].sort()) === JSON.stringify(ids.sort());
const row = (id) => (r.ok ? r.r.rows.find((x) => x.id === id) : null);
ok("a claim number is found whatever its letter case", has(0, c1), F[0]);
ok("an account number with the same date of service is found", has(1, c2), F[1]);
ok("an account number with another date of service is not taken for that claim", has(2), F[2]);
ok("the patient's name (words in any order, without the middle initial) and the date find both of that patient's claims that day, not another patient's", has(3, c3, c4), F[3]);
ok("a name written the other way round (B2 Testpatient) is the same patient", has(4, c2), F[4]);
ok("the right name on another date of service is not found", has(5), F[5]);
ok("a closed claim is found but cannot be given (closed)", has(6, c6) && row(c6) && !row(c6).workable && row(c6).why === "closed", row(c6));
ok("a claim with a desk is found but cannot be given (with a desk)", has(7, c7) && row(c7) && !row(c7).workable && row(c7).why === "with a desk", row(c7));
ok("another client's claim number is never found here", has(8), F[8]);
ok("a claim number not on file falls back to the name and date of service", has(9, c1), F[9]);
ok("an empty row finds nothing", has(10), F[10]);
ok("one word of the name with the date finds that patient's claim only", has(11, c5), F[11]);
ok("an account number alone (no date in the file) finds its claim", has(12, c5), F[12]);
ok("the rows it could not find are listed by position (2, 5, 8 and 10)", r.ok && JSON.stringify(r.r.file.missing) === "[2,5,8,10]", r.ok && r.r.file.missing);
ok("no patient data from another client comes back", r.ok && !r.r.rows.some((x) => x.patient === "Testpatient, C8"), r.ok && r.r.rows.map((x) => x.patient));
r = await look(TI, { rows: Array.from({ length: 2001 }, (_, i) => ({ claim_no: "X" + i })) });
ok("more than 2,000 rows at a time is refused with a plain message", !r.ok && /Up to 2,000 claims at a time/.test(r.e), r);
r = await look(LEO, { rows: [{ claim_no: "S66-F1" }] });
ok("a team lead of another client cannot look up this client's claims", !r.ok, r);
r = await look(ARUN, { rows: [{ claim_no: "S66-F1" }] });
ok("a biller cannot use the urgent allocation box", !r.ok, r);

S("The file is read the way an inventory file is (the page's own reading)");
const { createRequire } = await import("module"); const XLSX = createRequire(import.meta.url)("xlsx");
const enc = (s) => new TextEncoder().encode(s);
let fc = app.urgentFileClaims(enc("Report: urgent claims for Sunrise\n\nClaim #,Patient Name,Date of Service,Acct #,Balance\nS66-F1,\"Testpatient, A1\",09/01/2026,ACC-001,100\nS66-F1,\"Testpatient, A1\",09/01/2026,ACC-001,40\n,\"Testpatient, B2\",09/02/2026,,90\nGrand Total,,,,230\n"), "urgent.csv");
ok("a CSV with a title line: the column names are found, a claim on two lines is one, a total line is not a claim", fc.length === 2 && fc[0].claim_no === "S66-F1" && fc[0].account_no === "ACC-001" && fc[0].dos === "2026-09-01"
  && fc[1].claim_no === "" && fc[1].patient === "Testpatient, B2" && fc[1].dos === "2026-09-02", fc);
fc = app.urgentFileClaims(enc("Patient,DOS\n\"Testpatient, A1\",13/09/2026\n\"Testpatient, B2\",02/09/2026\n"), "u.csv");
ok("dates written day first (13/09/2026) are read day first for the whole column", fc.length === 2 && fc[0].dos === "2026-09-13" && fc[1].dos === "2026-09-02", fc);
let e1 = null; try { app.urgentFileClaims(enc("Payer,Balance\nAetna,10\n"), "u.csv"); } catch (e) { e1 = e.message; }
ok("a file with no claim number, account, or patient name with date of service says so plainly", /could not find a claim number column/.test(e1 || ""), e1);
e1 = null; try { app.urgentFileClaims(enc("Claim #,Patient\n"), "u.csv"); } catch (e) { e1 = e.message; }
ok("a file with only the column names says no claims were found", /No claims were found/.test(e1 || ""), e1);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Claim ID", "Patient Name", "DOS"], ["S66-F2", "Testpatient, B2", "2026-09-02"], ["S66-F3", "Fakename, John A", "2026-09-03"]]), "Urgent");
fc = app.urgentFileClaims(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })), "urgent.xlsx");
ok("an Excel file works the same", fc.length === 2 && fc[0].claim_no === "S66-F2" && fc[1].claim_no === "S66-F3", fc);
r = await look(TI, { rows: app.urgentFileClaims(enc("Claim #,Patient,DOS\nS66-F2,x,\n,\"John Fakename\",09/03/2026\nNOPE-2,y,\n"), "u.csv") });
ok("end to end: the file's claims are found (1 by number, 2 by name and date) and the missing one listed", r.ok && JSON.stringify(r.r.file.found.map((f) => f.length)) === "[1,2,0]" && JSON.stringify(r.r.file.missing) === "[2]", r.ok && r.r.file);

S("The search: claims of one date of service");
const all1 = (await TI("claims.list", { client_id: sun.id, dos: "2026-09-03", page_size: 500 })).rows;
ok("a date of service lists only that day's claims, with the patient's other claims that day", all1.length >= 3 && all1.every((x) => String(x.dos).slice(0, 10) === "2026-09-03") && [c3, c4, c5].every((id) => all1.some((x) => x.id === id)), all1.map((x) => x.dos));
const byName = (await TI("claims.list", { client_id: sun.id, q: "Fakename", dos: "2026-09-03", page_size: 50 })).rows.map((x) => x.id).sort();
ok("a name and a date together narrow it to that patient that day", JSON.stringify(byName) === JSON.stringify([c3, c4, c5].sort()), byName);
ok("a date that is not a real date is left out of the search (nothing breaks)", (await T(() => TI("claims.list", { client_id: sun.id, dos: "2026-13-45", page_size: 5 }))).ok);

S("Who gets how many");
const pool = []; for (let i = 0; i < 6; i++) pool.push(await make({ priority: 10 + i }));   // the last made has the highest priority
const list = [2, 5, 0, 4, 1, 3].map((i) => pool[i]);   // the box's list in the order the team lead added them: not the priority order
const owner = async (ids) => Object.fromEntries((await q(`SELECT c.id, u.name AS who, c.urgent_by_name AS by FROM claims c LEFT JOIN users u ON u.id = c.urgent_to WHERE c.id IN (${ids.map(() => "?").join(",")}) AND (c.urgent_to IS NULL OR c.assigned_to = c.urgent_to)`, ...ids)).map((x) => [x.id, x.who]));
const before = await owner(list);
const refuse = async (split, ids, why, name) => { const x = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: ids || list, split })); ok(name, !x.ok && why.test(x.e) && JSON.stringify(await owner(list)) === JSON.stringify(before), [x, await owner(list)]); };
await refuse([{ user_id: U("Arun Agent"), count: 4 }, { user_id: U("Bela Agent"), count: 1 }], null, /The numbers add up to 5, but 6 claims are picked/, "numbers that do not add up to the claims picked are refused, and nothing is given");
await refuse([{ user_id: U("Arun Agent"), count: 4.5 }, { user_id: U("Bela Agent"), count: 1.5 }], null, /whole number/, "a number with a decimal is refused");
await refuse([{ user_id: U("Arun Agent"), count: 7 }, { user_id: U("Bela Agent"), count: -1 }], null, /whole number/, "a number below zero is refused");
await refuse([{ user_id: U("Arun Agent"), count: "six" }], null, /whole number/, "a word instead of a number is refused");
await refuse([{ user_id: U("Arun Agent"), count: 3 }, { user_id: U("Arun Agent"), count: 3 }], null, /listed once/, "the same biller twice is refused");
await refuse([{ user_id: U("Arun Agent"), count: 3 }, { user_id: U("Dev Agent"), count: 3 }], null, /Dev Agent cannot be given Sunrise Eye Care's claims/, "a biller who does not work the client is refused by name");
await refuse([{ user_id: U("Arun Agent"), count: 0 }, { user_id: U("Bela Agent"), count: 0 }], null, /add up to 0/, "all numbers zero is refused");
let x = await T(() => LEO("alloc.urgent", { client_id: sun.id, ids: list, split: [{ user_id: U("Arun Agent"), count: 6 }] }));
ok("a team lead of another client cannot give this client's claims", !x.ok && JSON.stringify(await owner(list)) === JSON.stringify(before), x);
x = await T(() => ARUN("alloc.urgent", { client_id: sun.id, ids: list, split: [{ user_id: U("Arun Agent"), count: 6 }] }));
ok("a biller cannot give urgent claims", !x.ok, x);
const n0 = await q1("SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ? AND text LIKE '%urgent claim%'", U("Bela Agent"));
x = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: list, split: [{ user_id: U("Bela Agent"), count: 2 }, { user_id: U("Arun Agent"), count: 4 }] }));
const now1 = await owner(list);
ok("Bela 2 and Arun 4: the first two on the list go to Bela, the next four to Arun (the list's order, not priority)", x.ok && list.slice(0, 2).every((id) => now1[id] === "Bela Agent") && list.slice(2).every((id) => now1[id] === "Arun Agent"), [x, now1]);
ok("it says how many each got", x.ok && JSON.stringify(x.r.per.map((y) => [y.name, y.count])) === JSON.stringify([["Bela Agent", 2], ["Arun Agent", 4]]) && x.r.given === 6 && x.r.left_out === 0, x);
const bellB = await q("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE '%urgent claim%' ORDER BY rowid DESC LIMIT 1", U("Bela Agent"));
ok("each biller is told in the bell how many urgent claims they got (no patient or claim details)", bellB.length && /^2 urgent claims of Sunrise Eye Care from Tina Lead/.test(bellB[0].text) && !/Testpatient|S66-/.test(bellB[0].text) && (await q1("SELECT COUNT(*) AS n FROM user_notices WHERE user_id = ? AND text LIKE '%urgent claim%'", U("Bela Agent"))).n === n0.n + 1, bellB);
const aud = await q1("SELECT * FROM audit_log WHERE action = 'alloc.urgent' ORDER BY rowid DESC LIMIT 1");
ok("the audit trail says who got how many", aud && /Urgent: Bela Agent 2, Arun Agent 4/.test(JSON.stringify(aud)), aud);
const mine = (await ARUN("queue.list", { day_from_ms: 0 })).rows;
ok("they are at the top of Arun's list, marked urgent", mine.length >= 4 && mine.slice(0, 4).every((c) => c.urgent) , mine.slice(0, 5).map((c) => [c.id, c.urgent]));

S("A biller with 0 gets nothing");
const z2 = [await make({}), await make({})];
x = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: z2, split: [{ user_id: U("Arun Agent"), count: 0 }, { user_id: U("Bela Agent"), count: 2 }] }));
ok("Arun 0 and Bela 2: both go to Bela and Arun is not told anything", x.ok && Object.values(await owner(z2)).every((w) => w === "Bela Agent") && JSON.stringify(x.r.per.map((y) => y.name)) === JSON.stringify(["Bela Agent"]), x);

S("A claim that cannot be given any more when the team lead presses Allocate");
const r3 = []; for (let i = 0; i < 3; i++) r3.push(await make({}));
await sql("UPDATE claims SET state = 'closed' WHERE id = ?", r3[0]);
x = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: r3, split: [{ user_id: U("Arun Agent"), count: 2 }, { user_id: U("Bela Agent"), count: 1 }] }));
const now3 = await owner(r3);
ok("the closed one is left out and said so; the rest go down the list in order (Arun's 2 first, so Bela gets none)", x.ok && x.r.given === 2 && x.r.left_out === 1 && now3[r3[1]] === "Arun Agent" && now3[r3[2]] === "Arun Agent" && !now3[r3[0]]
  && JSON.stringify(x.r.per.map((y) => [y.name, y.count])) === JSON.stringify([["Arun Agent", 2]]), [x, now3]);

S("The older way (one biller, or split evenly) still works for a page not yet refreshed");
const o2 = [await make({}), await make({})];
x = await T(() => TI("alloc.urgent", { client_id: sun.id, ids: o2, user_ids: [U("Bela Agent")] }));
ok("all to one biller", x.ok && x.r.given === 2 && Object.values(await owner(o2)).every((w) => w === "Bela Agent"), x);

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
