/* Suite 49: Extra production (Dashboard › Stack report › Extra production). Work a team does outside Brahmastra, kept by the
   team lead in a production file in OneDrive: the page reads the file (DOW and User Name, an Emp ID first when there is one),
   the server matches the people of the uploader's span, shows what would be counted before anything is saved, keeps each upload
   (the OneDrive file id, name and link, who and when, the counts per person per day), replaces a file's earlier counts when the
   same file comes again, leaves a locked month as it was, and counts the work as work done on its DOW: on Team status, and so in
   the Stack report's Productivity, with the target unchanged. Each person's line can be edited by hand ("EP edit: ...", "EP reload:
   ..."): a day's count, who a name counts for, a person for a name left out; kept or dropped when the same file is loaded again.
   Checks named "EP: ...". Made-up people and files only: a stand-in
   for Purview Shastra's roster and floor feeds, and files built here. */
import vm from "vm";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };

/* The floor: Vida (VP) over Mona (manager), over Tess (team lead, Sunrise) and Lara (team lead, Lakeview); Sid is Tess's SME and
   Paula a Posting team lead on Sunrise. Tess's team: Arun, Cara, Dev, Mina, two people called Ravi Twin, and Dora on Posting.
   Lara's: Lena and Omar. Everyone's daily target is 10. Oct 2 and Nov 9 are Shastra holidays. */
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const AS = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
let FEED = [
  P({ emp_id: "V1", name: "Vida Vice", position: "Vice President", email: mail("Vida Vice") }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vida Vice", project: SUN, also_on_projects: LAKE, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tess Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tess Lead") }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Lara Lead") }),
  P({ emp_id: "T3", name: "Paula PostLead", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Paula PostLead") }),
  P({ emp_id: "S1", name: "Sid Expert", position: "SME", project: SUN, reports_to: "Tess Lead", email: mail("Sid Expert") }),
  AS("PHC-A1", "Arun Agent", "Tess Lead", SUN), AS("PHC-A2", "Cara Agent", "Tess Lead", SUN), AS("PHC-A3", "Dev Agent", "Tess Lead", SUN), AS("PHC-A4", "Mina Agent", "Tess Lead", SUN),
  AS("PHC-A5", "Ravi Twin", "Tess Lead", SUN, { email: "ravi.twin1@purview-healthcare.com" }), AS("PHC-A6", "Ravi Twin", "Tess Lead", SUN, { email: "ravi.twin2@purview-healthcare.com" }),
  AS("PHC-A7", "Dora Desk", "Tess Lead", SUN, { department: "Posting" }),
  AS("PHC-B1", "Lena Lake", "Lara Lead", LAKE), AS("PHC-B2", "Omar Oak", "Lara Lead", LAKE),
];
const D = (m, d) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const HOL = [D(10, 2), D(11, 9)];
const wkd = (iso) => { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6 && !HOL.includes(iso); };
const span = (a, b) => { const out = []; for (let t = Date.parse(a + "T12:00:00Z"); t <= Date.parse(b + "T12:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const FLOOR = [];
const floorFor = (emps) => { for (const e of emps) for (const d of span(D(10, 1), D(11, 11)).filter(wkd)) FLOOR.push({ emp_id: e, email: "", date: d, status: "present", open: false, tof_min: 480, logged_min: 525, break_min: 45, guard: false, idle_min: 0, locked_min: 0 }); };
floorFor(["PHC-A1", "PHC-A2", "PHC-A3", "PHC-A4", "PHC-A5", "PHC-A6", "PHC-A7", "PHC-B1", "PHC-B2"]);
const fetchMock = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : {};
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: [{ date: D(10, 2), name: "Gandhi Jayanti" }, { date: D(11, 9), name: "Diwali" }] });
  if (url.includes("brahmastra_floor")) return J({ ok: true, rows: FLOOR.filter((x) => x.date >= body.p_from && x.date <= body.p_to) });
  if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "no such function" }, 404);
  return J({ error: "no outside calls in tests" }, 500);
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
// the clock: Thursday Nov 12 2026, 15:00 in India, for the server and the page alike
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const VDate = vm.runInContext("Date", rig.app);
const clock = (ms) => { Date.now = () => ms; VDate.now = () => ms; };
clock(IST(2026, 11, 12, 15));
const { as, tryOp, sha, app } = rig; const T = (fn) => tryOp(fn);
const XLSX = app.XLSX;
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run(); const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const AD = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await AD("roster.syncShastra");
let users = (await AD("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email = mail(name)) => { const u = users.find((x) => x.name === name && (x.email || "") === email) || U(name);
  await as(null)("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const VI = await firstIn("Vida Vice"), MO = await firstIn("Mona Manager"), TE = await firstIn("Tess Lead"), LA = await firstIn("Lara Lead"), SI = await firstIn("Sid Expert"), PA = await firstIn("Paula PostLead");
const AR = await firstIn("Arun Agent"), CA = await firstIn("Cara Agent"), DO = await firstIn("Dora Desk");
await sql("UPDATE users SET capacity = 10 WHERE emp_id LIKE 'PHC-%'");
users = (await AD("users.list")).users;
const ravi = users.filter((u) => u.name === "Ravi Twin").sort((a, b) => a.emp_id.localeCompare(b.emp_id));
const id = (n) => U(n).id;
// claims worked (as Team status counts them): Arun 50 on Nov 3 and 5 today; Cara 60 on Nov 4; Dev 70 on Nov 5; Cara 100 on Oct 15
const claimIds = (await rows("SELECT id FROM claims ORDER BY id LIMIT 50")).map((r) => r.id);
let nn = 0;
const work = async (name, m, day, n) => { const u = U(name); for (let i = 0; i < n; i++) { nn++; await sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) VALUES (?,?,?,?,'work',?)", "s49n" + nn, claimIds[nn % claimIds.length], u.id, u.name, IST(2026, m, day, 11) + i * 1000); } };
await work("Arun Agent", 11, 3, 50); await work("Arun Agent", 11, 12, 5); await work("Cara Agent", 11, 4, 60); await work("Dev Agent", 11, 5, 70); await work("Cara Agent", 10, 15, 100);

/* ---- files, as a team lead keeps them ---- */
const serial = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000);
const xlsx = (sheets, hidden = []) => { const wb = XLSX.utils.book_new(); for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  if (hidden.length) wb.Workbook = { Sheets: wb.SheetNames.map((n) => ({ name: n, Hidden: hidden.includes(n) ? 1 : 0 })) };
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })); };
const csv = (text) => new TextEncoder().encode(text);
const rep = (n, row) => Array.from({ length: n }, () => row);
const read = (bytes, name) => { try { return { ok: true, r: app.extraRead(bytes, name) }; } catch (e) { return { ok: false, e: e.message }; } };
const LINK = (n) => "https://purviewhealthcare-my.sharepoint.com/personal/tess_lead/Documents/" + encodeURIComponent(n);
const body = (draft, o = {}) => ({ month: o.month || "2026-11", drive_id: o.drive === undefined ? "b!madeUpDrive" : o.drive, item_id: o.item === undefined ? "item-nov" : o.item, file_name: o.name || draft.file,
  web_url: o.url === undefined ? LINK(o.name || draft.file) : o.url, groups: draft.groups, skipped: draft.skipped, sheets: draft.sheets });
const g = (draft, name, day) => draft.groups.filter((x) => x.u === name && (!day || x.d === day)).reduce((t, x) => t + x.n, 0);

// Tess's November file: a summary sheet first, a hidden copy, then the work under a title row, headers in any case and spacing
const NOV_ROWS = [
  ...rep(4, [serial(D(11, 3)), "PHC-A1", "Arun Agent", "Eligibility check"]),
  ...rep(3, ["11/04/2026", "", "  arun   AGENT ", "Form"]),                   // text date, month first; the name in another case, extra spaces
  ...rep(2, ["2026-11-12", "PHC-A1", "Arun Agent", "Eligibility check"]),    // today
  ...rep(5, [serial(D(11, 5)), "PHC-A2", "Cara Agent", "Portal follow-up"]),
  ...rep(2, [serial(D(11, 6)), "PHC-A4", "M. Agent (typo)", "Form"]),         // the Emp ID says Mina, whatever the name
  ...rep(3, [serial(D(11, 5)), "", "Ravi Twin", "Eligibility check"]),       // two people have this name: never guessed
  ...rep(1, [serial(D(11, 5)), "PHC-A6", "Ravi Twin", "Eligibility check"]), // the Emp ID tells them apart
  ...rep(2, [serial(D(11, 5)), "", "Sona Sample", "Eligibility check"]),     // nobody of that name
  ...rep(2, [serial(D(11, 5)), "PHC-B1", "Lena Lake", "Eligibility check"]), // Lara's team: not Tess's to count
  ...rep(1, [serial(D(11, 5)), "PHC-A7", "Dora Desk", "Refund letter"]),     // Posting: not on Team status
  ...rep(1, [serial(D(11, 5)), "", "Sid Expert", "Training"]),              // the SME: not on Team status
  ...rep(1, [serial(D(11, 20)), "PHC-A2", "Cara Agent", "Eligibility check"]),// after today
  ["31/31/2026", "PHC-A2", "Cara Agent", "Eligibility check"], ["soon", "PHC-A2", "Cara Agent", "Eligibility check"],
  ["", "PHC-A2", "Cara Agent", "Eligibility check"], [serial(D(11, 5)), "PHC-A2", "", "Eligibility check"], ["", "", "", ""],
  ...rep(2, [serial(D(10, 20)), "PHC-A2", "Cara Agent", "Eligibility check"]),// October
];
const NOV = xlsx([["Summary", [["Team", "Rows"], ["Tess", 33]]], ["Old copy", [["DOW", "User Name"], ...rep(50, [serial(D(11, 5)), "Arun Agent"])]],
  ["Extra work", [["Extra production, November 2026"], [], ["  Date of  WORK", "EMP ID", "worked_by", "Task"], ...NOV_ROWS]]], ["Old copy"]);

S("EP: reading the file (the page's own code)");
let x = read(NOV, "Extra production Nov.xlsx");
ok("EP: the columns are found on any sheet, under a title row, in any case and spacing; the summary and the hidden sheet are not read", x.ok && x.r.sheets.length === 1 && x.r.sheets[0].name === "Extra work"
  && x.r.sheets[0].dow === "Date of WORK" && x.r.sheets[0].user === "worked_by" && x.r.sheets[0].emp === "EMP ID", x.ok ? x.r.sheets : x.e);
const nov = x.r;
ok("EP: each row is one piece of work: 33 rows (the blank one is no row); 30 have a date and a name", nov.rows === 33 && nov.groups.reduce((t, y) => t + y.n, 0) === 29 && nov.skipped.no_date === 1 && nov.skipped.bad_date === 2 && nov.skipped.no_name === 1,
  { rows: nov.rows, sk: nov.skipped, n: nov.groups.reduce((t, y) => t + y.n, 0) });
ok("EP: an Excel date, an 11/04/2026 text date (month first) and a 2026-11-12 text date are read; 31/31/2026 and 'soon' are no date", g(nov, "Arun Agent", D(11, 3)) === 4 && g(nov, "arun AGENT", D(11, 4)) === 3 && g(nov, "Arun Agent", D(11, 12)) === 2
  && nov.skipped.bad_examples.join("|") === "31/31/2026|soon" && nov.sheets[0].order === "mdy", nov.groups.filter((y) => /arun/i.test(y.u)));
ok("EP: rows are sent grouped by Emp ID, name and day (the name as written, spaces tidied)", nov.groups.find((y) => y.u === "arun AGENT" && y.e === "" && y.d === D(11, 4) && y.n === 3) && nov.groups.find((y) => y.e === "PHC-A6" && y.n === 1), nov.groups.slice(0, 4));
x = read(csv("DOW,User Name\n13/11/2026,Arun Agent\n05/11/2026,Arun Agent\n2026-11-03,Arun Agent\n"), "day first.csv");
ok("EP: a column written day first (13/11/2026 shows it) is read day first for the whole column: 05/11/2026 is Nov 5", x.ok && x.r.sheets[0].order === "dmy" && g(x.r, "Arun Agent", D(11, 5)) === 1 && g(x.r, "Arun Agent", D(11, 13)) === 1 && g(x.r, "Arun Agent", D(11, 3)) === 1, x.ok ? x.r.groups : x.e);
x = read(csv("Date of Work,Username\n11/13/2026,Cara Agent\n05/11/2026,Cara Agent\n"), "month first.csv");
ok("EP: a column written month first (11/13/2026) is read month first: 05/11/2026 is May 11", x.ok && x.r.sheets[0].order === "mdy" && g(x.r, "Cara Agent", D(5, 11)) === 1 && g(x.r, "Cara Agent", D(11, 13)) === 1, x.ok ? x.r.groups : x.e);
x = read(csv("Work Date,Worked By\n13/11/2026,Dev Agent\n14/11/2026,Dev Agent\n11/13/2026,Dev Agent\n05/11/2026,Dev Agent\n"), "mixed.csv");
ok("EP: a column with both is decided once, the way most of its dates go (2 day first, 1 month first): the odd one is left out, 05/11 is Nov 5", x.ok && x.r.sheets[0].order === "dmy" && x.r.skipped.bad_date === 1 && g(x.r, "Dev Agent", D(11, 5)) === 1, x.ok ? [x.r.groups, x.r.skipped] : x.e);
x = read(csv("DOW,Employee Name\n31/31/2026,Mina Agent\n05/11/2026,Mina Agent\n"), "no sign.csv");
ok("EP: 31/31/2026 is no date either way, so it does not make the column day first: 05/11/2026 is May 11", x.ok && x.r.sheets[0].order === "mdy" && g(x.r, "Mina Agent", D(5, 11)) === 1 && x.r.skipped.bad_date === 1, x.ok ? [x.r.groups, x.r.skipped] : x.e);
x = read(csv("﻿Emp. ID,User,dow\n007,Arun Agent,2026-11-03\n"), "bom.csv");
ok("EP: a CSV is read as text: Emp ID 007 keeps its zeros; User and dow are found (a BOM ahead of them)", x.ok && x.r.groups[0].e === "007" && x.r.groups[0].u === "Arun Agent" && x.r.sheets[0].emp === "Emp. ID", x.ok ? x.r.groups : x.e);
x = read(csv("Date,Name,Claim\n11/03/2026,Arun Agent,C1\n"), "no columns.csv");
ok("EP: a file with no DOW or no User Name column says what Brahmastra looks for", !x.ok && /No sheet of no columns\.csv has a DOW column and a User Name column/.test(x.e) && /Date of Work, Work Date/.test(x.e), x);
x = read(csv("DOW,User Name\n2026-11-03,A\n"), "old.xls");
ok("EP: only .xlsx and .csv are read", !x.ok && /Pick an Excel \(\.xlsx\) or CSV file/.test(x.e), x);
x = read(new Uint8Array(10 * 1048576 + 1), "big.xlsx");
ok("EP: a file over 10 MB is refused, with what Brahmastra reads", !x.ok && /big\.xlsx is 10 MB: Brahmastra reads files up to 10 MB/.test(x.e), x);
x = read(csv("DOW,User Name\n" + "2026-11-03,Arun Agent\n".repeat(50001)), "rows.csv");
ok("EP: a file over 50,000 rows is refused, with what to do", !x.ok && /rows\.csv has 50,001 rows: Brahmastra reads up to 50,000 rows a file\. Split it/.test(x.e), x);
x = read(csv("DOW,User Name\n" + "2026-11-03,Arun Agent\n".repeat(50000)), "rows ok.csv");
ok("EP: 50,000 rows are read", x.ok && x.r.rows === 50000 && x.r.groups.length === 1 && x.r.groups[0].n === 50000, x.ok ? x.r.rows : x.e);

S("EP: what the file would count, before anything is saved (matching the people)");
const ts0 = await TE("team.status", { from: D(11, 1), to: D(11, 12) }), arun0 = ts0.rows.find((r) => r.name === "Arun Agent");
let r = await T(() => TE("stack.extraPreview", body(nov, { name: "Extra production Nov.xlsx" })));
const pv = r.ok ? r.r : null;
ok("EP: the preview: 33 rows read, 19 to count for 4 people, 14 left out", pv && pv.rows === 33 && pv.counted === 19 && pv.people.length === 4 && pv.left_out.rows === 14, r.ok ? { rows: pv.rows, counted: pv.counted, left: pv.left_out.rows, people: pv.people.map((p) => p.name) } : r);
const pp = (n) => pv.people.find((p) => p.name === n) || {};
ok("EP: rows per person, with Emp ID, team lead, days and dates: Arun 9 (Nov 3 to 12), Cara 7 (Oct 20 to Nov 5), Mina 2, one Ravi Twin 1", pp("Arun Agent").rows === 9 && pp("Arun Agent").days === 3 && pp("Arun Agent").from === D(11, 3) && pp("Arun Agent").to === D(11, 12)
  && pp("Cara Agent").rows === 7 && pp("Cara Agent").from === D(10, 20) && pp("Mina Agent").rows === 2 && pp("Mina Agent").emp_id === "PHC-A4" && pp("Ravi Twin").rows === 1 && pp("Ravi Twin").emp_id === "PHC-A6" && pp("Arun Agent").lead_name === "Tess Lead", pv && pv.people);
ok("EP: the name in another case and with extra spaces is the same person; the Emp ID is matched first (M. Agent (typo) is Mina)", pp("Arun Agent").rows === 9 && pp("Mina Agent").rows === 2, pv && pv.people);
ok("EP: the dates from and to, and the months", pv && pv.from === D(10, 20) && pv.to === D(11, 12) && pv.months.map((m) => m.label + " " + m.rows + "/" + m.locked_rows).join() === "October 2026 2/0,November 2026 17/0", pv && pv.months);
const L0 = pv ? pv.left_out : {};
ok("EP: left out and why: 1 with no DOW, 2 whose DOW is no date (shown), 1 with no user name, 1 after today", L0.no_date === 1 && L0.bad_date === 2 && L0.bad_examples.join() === "31/31/2026,soon" && L0.no_name === 1 && L0.future === 1, L0);
ok("EP: names not matched are named with their rows: Sona Sample 2, Lena Lake 2 (Lara's team: not among the people Tess sees)", L0.not_found && L0.not_found.map((n) => n.name + " " + n.rows).sort().join() === "Lena Lake 2,Sona Sample 2", L0.not_found);
ok("EP: two people called Ravi Twin: never guessed between, the 3 rows left out and why", L0.same_name && L0.same_name.length === 1 && L0.same_name[0].name === "Ravi Twin" && L0.same_name[0].rows === 3 && L0.same_name[0].people === 2, L0.same_name);
ok("EP: someone Team status does not count is not counted, and says why (Dora on Posting, Sid an SME)", L0.not_counted && L0.not_counted.map((n) => n.name + ": " + n.why).sort().join(" | ") === "Dora Desk: Posting, not AR | Sid Expert: a team lead, SME or manager", L0.not_counted);
ok("EP: nothing is saved by the preview", (await rows("SELECT COUNT(*) AS n FROM extra_uploads"))[0].n === 0 && (await rows("SELECT COUNT(*) AS n FROM extra_lines"))[0].n === 0 && !pv.earlier);

S("EP: counting it: the upload kept, the counts per person per day");
r = await T(() => TE("stack.extraSave", body(nov, { name: "Extra production Nov.xlsx" })));
ok("EP: Tess counts the file: 19 rows for 4 people, Oct 20 to Nov 12", r.ok && r.r.counted === 19 && r.r.people === 4 && r.r.from === D(10, 20) && r.r.to === D(11, 12) && r.r.left_out === 14, r);
const up1 = (await rows("SELECT * FROM extra_uploads"))[0];
ok("EP: the upload keeps the OneDrive file (its drive and item id), its name and link, who and when", up1 && up1.file_key === "b!madeUpDrive!item-nov" && up1.item_id === "item-nov" && up1.file_name === "Extra production Nov.xlsx"
  && up1.web_url === LINK("Extra production Nov.xlsx") && up1.by_name === "Tess Lead" && up1.by_id === id("Tess Lead") && up1.at === IST(2026, 11, 12, 15) && up1.rows_read === 33 && up1.rows_counted === 19 && up1.state === "counted", up1);
const perDay = async (upId) => (await rows("SELECT u.name, w.day, SUM(w.n) AS n FROM extra_lines w JOIN users u ON u.id = w.user_id WHERE w.upload_id = ? GROUP BY u.name, w.day ORDER BY u.name, w.day", upId)).map((y) => y.name + " " + y.day.slice(5) + " " + y.n).join(", ");
ok("EP: and the counts per person per day", (await perDay(up1.id)) === "Arun Agent 11-03 4, Arun Agent 11-04 3, Arun Agent 11-12 2, Cara Agent 10-20 2, Cara Agent 11-05 5, Mina Agent 11-06 2, Ravi Twin 11-05 1", await perDay(up1.id));
ok("EP: the one Ravi Twin is the one the Emp ID named (PHC-A6)", (await rows("SELECT user_id FROM extra_lines WHERE upload_id = ? AND user_id IN (?, ?)", up1.id, ravi[0].id, ravi[1].id)).map((y) => y.user_id).join() === ravi[1].id);
const aud1 = (await rows("SELECT * FROM audit_log WHERE action = 'stack.extra' ORDER BY at"))[0];
ok("EP: the upload is in the audit trail", aud1 && aud1.user_name === "Tess Lead" && /Extra production counted from OneDrive, Extra production Nov\.xlsx: 19 rows for 4 people, Oct 20 to Nov 12, 2026; 14 rows left out/.test(aud1.detail), aud1);

S("EP: the counts reach Team status (the target does not change)");
let ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) }), arun = ts.rows.find((y) => y.name === "Arun Agent");
ok("EP: Arun on Team status: 50 claims and 7 extra on the finished days, 5 claims and 2 extra today", arun.worked_done === 50 && arun.extra_done === 7 && arun.count_done === 57 && arun.worked_today === 5 && arun.extra_today === 2 && arun.count_today === 7 && arun.extra === 9 && arun.count === 64,
  { count_done: arun.count_done, extra_done: arun.extra_done, count_today: arun.count_today });
ok("EP: his target is what it was before the file (70 on the 7 finished days); the attainment moves from 71.4% to 81.4%", arun.target_done === arun0.target_done && arun.target === arun0.target && arun.target_done === 70 && arun0.attain === 71.4 && arun.attain === 81.4, [arun0.attain, arun.attain, arun.target_done]);
ok("EP: the files are named for the team lead (the file, its rows, its rows on the finished days)", arun.extra_files.length === 1 && arun.extra_files[0].name === "Extra production Nov.xlsx" && arun.extra_files[0].n === 9 && arun.extra_files[0].n_done === 7, arun.extra_files);
ok("EP: the totals carry it too (Performance by status, the KPI)", ts.totals.extra === 19 - 2 && ts.totals.extra_done === 15 && ts.by_status.find((y) => y.status === "Production").extra === 17, { t: ts.totals.extra, d: ts.totals.extra_done });
let tsOct = await TE("team.status", { from: D(10, 1), to: D(10, 31) });
ok("EP: Cara's October: 100 claims and 2 extra (on Oct 20)", tsOct.rows.find((y) => y.name === "Cara Agent").count_done === 102 && tsOct.rows.find((y) => y.name === "Cara Agent").extra === 2, tsOct.rows.find((y) => y.name === "Cara Agent").count_done);
const tsSid = await SI("team.status", { from: D(11, 1), to: D(11, 12) });
ok("EP: an SME sees the same numbers on Team status, but not the team lead's files", tsSid.rows.find((y) => y.name === "Arun Agent").count_done === 57 && tsSid.rows.find((y) => y.name === "Arun Agent").extra_files.length === 0);
const tr = await TE("team.range", { from: D(11, 1), to: D(11, 12) }), tra = tr.rows.find((y) => y.name === "Arun Agent");
ok("EP: team.range (the same done figure for any dates): 55 entries + 9 extra = 64 done", tra.worked === 55 && tra.extra === 9 && tra.done === 64 && tra.pct === Math.round(64 / tra.target * 100) && tr.totals.extra === 17, tra);

S("EP: the counts reach the Stack report, and it agrees with Team status");
let mo = await TE("stack.month", { month: "2026-11" });
const sArun = mo.rows.find((y) => y.name === "Arun Agent"), sCara = mo.rows.find((y) => y.name === "Cara Agent");
const tsMonth = await TE("team.status", { from: D(11, 1), to: D(11, 30) });
ok("EP: Productivity is Team status's own figure: Arun 57 of 70 (7 of it extra production)", sArun.achieved === 57 && sArun.expected === 70 && sArun.extra === 7 && sArun.achieved === tsMonth.rows.find((y) => y.name === "Arun Agent").count_done, { a: sArun.achieved, e: sArun.expected, x: sArun.extra });
ok("EP: every associate's Achieved is Team status's count, for the same dates", mo.rows.filter((y) => y.tracked).every((y) => y.achieved === tsMonth.rows.find((z) => z.id === y.id).count_done && y.extra === tsMonth.rows.find((z) => z.id === y.id).extra_done), mo.rows.map((y) => [y.name, y.achieved]));
ok("EP: the person's how-it-was-worked-out names the file and its rows", sArun.extra_files.length === 1 && sArun.extra_files[0].name === "Extra production Nov.xlsx" && sArun.extra_files[0].n === 7 && sCara.extra === 5, sArun.extra_files);
ok("EP: the files counted for the month, for the people Tess sees: rows in November, people, dates, and its rows in other months", mo.extra && mo.extra.can_upload && mo.extra.files.length === 1 && mo.extra.files[0].name === "Extra production Nov.xlsx" && mo.extra.files[0].rows === 17
  && mo.extra.files[0].people === 4 && mo.extra.files[0].from === D(11, 3) && mo.extra.files[0].to === D(11, 12) && mo.extra.files[0].other_rows === 2 && mo.extra.files[0].can_remove && mo.extra.files[0].web_url === LINK("Extra production Nov.xlsx") && mo.extra.files[0].by === "Tess Lead", mo.extra);
ok("EP: How it is worked out says Productivity counts extra production", /extra production counted from the team leads' files in OneDrive/.test(mo.criteria.assoc[0].how), mo.criteria.assoc[0].how);
const wbk = app.stackWorkbook(mo, mo.rows, mo.tls), xs = wbk.Sheets["Extra production"], cell = (a) => (xs && xs[a] ? xs[a].v : undefined);
const xRow = xs ? [2, 3, 4, 5, 6].find((i) => cell("C" + i) === "Arun Agent") : null;
ok("EP: the Stack report's Excel keeps the owner's sheets and adds Extra production: Achieved and the extra part, with the files", wbk.SheetNames.join() === "Stack Sheet,Associate Stack,TL Stack,Extra production" && xRow && cell("D" + xRow) === 57 && cell("E" + xRow) === 7 && /Extra production Nov\.xlsx \(7\)/.test(cell("F" + xRow)), wbk.SheetNames);

S("EP: the same OneDrive file again replaces its counts; another file adds");
const NOV2 = xlsx([["Extra work", [["DOW", "Emp ID", "User Name"], [serial(D(11, 3)), "PHC-A1", "Arun Agent"], ...rep(5, [serial(D(11, 5)), "PHC-A2", "Cara Agent"]), ...rep(2, [serial(D(10, 20)), "PHC-A2", "Cara Agent"])]]]);
const nov2 = read(NOV2, "Extra production Nov.xlsx").r;
r = await T(() => TE("stack.extraPreview", body(nov2, { name: "Extra production Nov.xlsx" })));
ok("EP: the preview says the file was counted before, by whom, and that it replaces those counts", r.ok && r.r.earlier && r.r.earlier.uploads.length === 1 && r.r.earlier.uploads[0].by === "Tess Lead" && r.r.earlier.uploads[0].rows === 19 && r.r.earlier.replaces === 19 && r.r.earlier.keeps === 0, r.ok ? r.r.earlier : r);
r = await T(() => TE("stack.extraSave", body(nov2, { name: "Extra production Nov.xlsx" })));
ok("EP: counted again: 8 rows, in place of the 19", r.ok && r.r.counted === 8 && r.r.replaced === 19, r);
ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) }); arun = ts.rows.find((y) => y.name === "Arun Agent");
ok("EP: Arun's extra is 1 now, never 9 + 1", arun.extra === 1 && arun.count_done === 51 && ts.rows.find((y) => y.name === "Cara Agent").extra === 5 && !ts.rows.find((y) => y.name === "Mina Agent").extra, { arun: arun.extra, done: arun.count_done });
const ups = await rows("SELECT id, state, replaced_by FROM extra_uploads ORDER BY at, rowid");
ok("EP: the first upload is kept, marked replaced by the second (it counts nothing now)", ups.length === 2 && ups[0].state === "replaced" && ups[0].replaced_by === ups[1].id && ups[1].state === "counted" && (await rows("SELECT COUNT(*) AS n FROM extra_lines WHERE upload_id = ?", ups[0].id))[0].n === 0, ups);
ok("EP: the replacement is in the audit trail", (await rows("SELECT detail FROM audit_log WHERE action = 'stack.extra' ORDER BY at, rowid"))[1].detail.includes("in place of what the same file counted before (uploaded Nov 12, 2026 by Tess Lead)"));
const B = read(xlsx([["Sheet1", [["DOW", "User Name"], ...rep(3, [serial(D(11, 6)), "Arun Agent"])]]]), "Extra production Nov week 2.xlsx").r;
r = await T(() => TE("stack.extraSave", body(B, { item: "item-nov-b" })));
ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) }); arun = ts.rows.find((y) => y.name === "Arun Agent");
ok("EP: another OneDrive file adds to it: Arun 1 + 3 extra, from two files", r.ok && arun.extra === 4 && arun.extra_files.length === 2, arun.extra_files);
const sameName = read(xlsx([["S", [["DOW", "User Name"], [serial(D(11, 6)), "Arun Agent"]]]]), "Extra production Nov week 2.xlsx").r;
r = await T(() => TE("stack.extraPreview", body(sameName, { item: "item-other" })));
ok("EP: a file with the same name but another OneDrive id is another file (it does not replace)", r.ok && !r.r.earlier, r.ok ? r.r.earlier : r);

S("EP: a file for two teams: a team lead replaces only what is hers");
const MGR = xlsx([["Both teams", [["DOW", "User Name"], ...rep(4, [serial(D(11, 5)), "Lena Lake"]), ...rep(2, [serial(D(11, 10)), "Arun Agent"])]]]);
r = await T(() => MO("stack.extraSave", body(read(MGR, "Extra production both teams.xlsx").r, { item: "item-mgr" })));
ok("EP: the manager counts a file with both teams' work (her span)", r.ok && r.r.counted === 6 && r.r.people === 2, r);
const MGR2 = read(xlsx([["Both teams", [["DOW", "User Name"], [serial(D(11, 10)), "Arun Agent"], ...rep(4, [serial(D(11, 5)), "Lena Lake"])]]]), "Extra production both teams.xlsx").r;
r = await T(() => TE("stack.extraPreview", body(MGR2, { item: "item-mgr" })));
ok("EP: Tess sees the same file again: Lena's rows are already counted from the manager's upload (left out for Tess, said so), and her 4 counted rows stay", r.ok && r.r.counted === 1 && !r.r.left_out.not_found.length
  && r.r.left_out.elsewhere.length === 1 && r.r.left_out.elsewhere[0].name === "Lena Lake" && r.r.left_out.elsewhere[0].rows === 4 && r.r.earlier.replaces === 2 && r.r.earlier.keeps === 4, r.ok ? [r.r.counted, r.r.left_out.elsewhere, r.r.earlier] : r);
r = await T(() => TE("stack.extraSave", body(MGR2, { item: "item-mgr" })));
ts = await MO("team.status", { from: D(11, 1), to: D(11, 12) });
ok("EP: after Tess's upload: Arun 1 from it (was 2), Lena still 4 (from the manager's upload, not Tess's to change)", r.ok && ts.rows.find((y) => y.name === "Arun Agent").extra === 1 + 3 + 1 && ts.rows.find((y) => y.name === "Lena Lake").extra === 4,
  ts.rows.filter((y) => y.extra).map((y) => [y.name, y.extra]));
mo = await LA("stack.month", { month: "2026-11" });
ok("EP: Lara's list shows only the file with her people's counts, as the manager uploaded it", mo.extra.files.length === 1 && mo.extra.files[0].name === "Extra production both teams.xlsx" && mo.extra.files[0].rows === 4 && mo.extra.files[0].by === "Mona Manager", mo.extra.files);

S("EP: locked months");
// a file with work in October and November, counted while October is still open
const ON = read(xlsx([["S", [["DOW", "User Name"], ...rep(3, [serial(D(10, 19)), "Dev Agent"]), ...rep(2, [serial(D(11, 4)), "Dev Agent"])]]]), "Extra production Oct-Nov.xlsx").r;
r = await T(() => TE("stack.extraSave", body(ON, { item: "item-on" })));
ok("EP: a file with October and November rows is counted while October is open", r.ok && r.r.counted === 5, r);
r = await T(() => MO("stack.lock", { month: "2026-10" }));
ok("EP: the manager locks October", r.ok, r);
let oct = await MO("stack.month", { month: "2026-10" });
const oCara = oct.rows.find((y) => y.name === "Cara Agent"), oDev = oct.rows.find((y) => y.name === "Dev Agent");
ok("EP: the locked October keeps the extra part in Achieved: Cara 102 (2 extra), Dev 3 (3 extra)", oCara.achieved === 102 && oCara.extra === 2 && oCara.locked && oDev.achieved === 3 && oDev.extra === 3, [oCara.achieved, oDev.achieved]);
const NOV3 = read(xlsx([["Extra work", [["DOW", "Emp ID", "User Name"], ...rep(5, [serial(D(10, 21)), "PHC-A2", "Cara Agent"]), ...rep(6, [serial(D(11, 5)), "PHC-A2", "Cara Agent"])]]]), "Extra production Nov.xlsx").r;
r = await T(() => TE("stack.extraPreview", body(NOV3)));
ok("EP: the preview: October's 5 rows are in a locked month, not counted; what October counted from this file stays (2 kept)", r.ok && r.r.counted === 6 && r.r.left_out.locked.length === 1 && r.r.left_out.locked[0].label === "October 2026" && r.r.left_out.locked[0].rows === 5
  && r.r.months.find((m) => m.month === "2026-10").locked_rows === 5 && r.r.earlier.keeps === 2 && r.r.earlier.replaces === 6, r.ok ? [r.r.left_out.locked, r.r.earlier] : r);
r = await T(() => TE("stack.extraSave", body(NOV3)));
tsOct = await TE("team.status", { from: D(10, 1), to: D(10, 31) });
ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) });
ok("EP: counted: Cara's November is 6, her October stays 2 (not 5, not 0), so Team status still agrees with the locked October", r.ok && ts.rows.find((y) => y.name === "Cara Agent").extra === 6 && tsOct.rows.find((y) => y.name === "Cara Agent").extra === 2
  && tsOct.rows.find((y) => y.name === "Cara Agent").count_done === oCara.achieved, [ts.rows.find((y) => y.name === "Cara Agent").extra, tsOct.rows.find((y) => y.name === "Cara Agent").extra]);
const lockedOnly = read(xlsx([["S", [["DOW", "User Name"], [serial(D(10, 22)), "Cara Agent"]]]]), "October only.xlsx").r;
r = await T(() => TE("stack.extraSave", body(lockedOnly, { item: "item-oct" })));
ok("EP: a file with rows only in a locked month counts nothing, and says so", !r.ok && r.status === 400 && /Nothing in October only\.xlsx can be counted: October 2026 locked/.test(r.e), r);
let files = (await TE("stack.month", { month: "2026-10" })).extra.files;
const fOct = (n) => files.find((f) => f.name === n) || {};
ok("EP: October's list shows each file's rows there, all locked, and no Remove", files.length === 2 && fOct("Extra production Nov.xlsx").rows === 2 && fOct("Extra production Oct-Nov.xlsx").rows === 3 && files.every((f) => f.locked_rows === f.rows && !f.can_remove), files);

S("EP: Remove");
const novList = (await TE("stack.month", { month: "2026-11" })).extra.files;
const up3 = novList.find((f) => f.name === "Extra production Nov.xlsx"), onF = novList.find((f) => f.name === "Extra production Oct-Nov.xlsx");
ok("EP: November's list: the file's new upload (6 rows), and the October-November file (2 here, 3 in other months)", up3 && up3.rows === 6 && up3.can_remove && onF && onF.rows === 2 && onF.other_rows === 3 && onF.can_remove, novList);
r = await T(() => LA("stack.extraRemove", { upload_id: up3.id }));
ok("EP: another team lead cannot remove a file that counts only for Tess's people", !r.ok && r.status === 403, r);
r = await T(() => TE("stack.extraRemove", { upload_id: onF.id }));
ok("EP: Tess removes the October-November file: November's 2 come off, October's 3 stay (locked)", r.ok && r.r.removed === 2 && r.r.kept === 3, r);
ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) }); tsOct = await TE("team.status", { from: D(10, 1), to: D(10, 31) });
ok("EP: Team status follows: Dev's November extra 0, his October still 3", !ts.rows.find((y) => y.name === "Dev Agent").extra && tsOct.rows.find((y) => y.name === "Dev Agent").extra === 3);
const aud2 = (await rows("SELECT * FROM audit_log WHERE action = 'stack.extraRemove'"))[0];
ok("EP: the removal is in the audit trail", aud2 && aud2.user_name === "Tess Lead" && /Extra production removed, Extra production Oct-Nov\.xlsx \(uploaded Nov 12, 2026 by Tess Lead\): 2 rows for 1 person taken off; 3 rows stay in October 2026 \(locked\)/.test(aud2.detail), aud2);
r = await T(() => TE("stack.extraRemove", { upload_id: onF.id }));
ok("EP: removing it again while only the locked month is left is refused, and says why", !r.ok && /October 2026 is locked: what Extra production Oct-Nov\.xlsx counts there stays until the admin unlocks it/.test(r.e), r);
r = await T(() => TE("stack.extraRemove", { upload_id: up3.id }));
ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) });
ok("EP: Tess removes the November file: Cara's 6 come off", r.ok && r.r.removed === 6 && r.r.kept === 0 && !ts.rows.find((y) => y.name === "Cara Agent").extra, r);
r = await T(() => AD("stack.unlock", { month: "2026-10" }));
r = await T(() => TE("stack.extraRemove", { upload_id: onF.id }));
tsOct = await TE("team.status", { from: D(10, 1), to: D(10, 31) });
ok("EP: once the admin unlocks October, the rest comes off too, and the upload is marked removed", r.ok && r.r.removed === 3 && !tsOct.rows.find((y) => y.name === "Dev Agent").extra && (await rows("SELECT state FROM extra_uploads WHERE id = ?", onF.id))[0].state === "removed", r);
r = await T(() => TE("stack.extraRemove", { upload_id: up3.id }));
ok("EP: a file that counts nothing now cannot be removed again", !r.ok && r.status === 400 && /does not count anything now/.test(r.e), r);

S("EP: who may do what");
const nb = body(nov, { item: "item-x" });
for (const [who, X, st] of [["a biller (Arun)", AR, 403], ["a desk person (Dora)", DO, 403], ["an SME (Sid)", SI, 403], ["a Posting team lead (Paula)", PA, 403], ["anyone signed out", as(null), 401]]) {
  for (const op of ["stack.extraPreview", "stack.extraSave", "stack.extraRemove"]) {
    r = await T(() => X(op, op === "stack.extraRemove" ? { upload_id: up3.id } : nb));
    ok(`EP: ${who} cannot use ${op}`, !r.ok && r.status === st, r);
  }
}
const paulaM = await PA("stack.month", { month: "2026-11" });
ok("EP: a desk team lead's Stack report has no Extra production button or list, and no file names", paulaM.extra === null && paulaM.rows.length > 0 && paulaM.rows.every((y) => !(y.extra_files || []).length), paulaM.extra);
r = await T(() => VI("stack.extraPreview", nb)); ok("EP: the VP may (her span)", r.ok && r.r.counted === 21, r.ok ? r.r.counted : r);
r = await T(() => AD("stack.extraPreview", nb)); ok("EP: the admin may (every span: Lena counts too)", r.ok && r.r.counted === 21 && r.r.people.some((p) => p.name === "Lena Lake"), r.ok ? r.r.counted : r);
const lav = await T(() => LA("stack.extraPreview", nb));
ok("EP: Lara previews Tess's file: only Lena is hers; Tess's people are not found for her", lav.ok && lav.r.counted === 2 && lav.r.people.map((p) => p.name).join() === "Lena Lake" && lav.r.left_out.not_found.some((n) => n.name === "Arun Agent"), lav.ok ? [lav.r.counted, lav.r.people] : lav);
r = await T(() => MO("stack.lock", { month: "2026-10" }));
const cm = await CA("stack.mine", {}), mineOct = cm.months.find((m) => m.month === "2026-10");
ok("EP: an associate's own stack shows the extra part of her Achieved, but no team lead's files", r.ok && mineOct && mineOct.row.achieved === 102 && mineOct.row.extra === 2 && mineOct.row.extra_files.length === 0, mineOct && mineOct.row);
oct = await MO("stack.month", { month: "2026-10" });
ok("EP: the manager's locked October names the file", oct.rows.find((y) => y.name === "Cara Agent").extra_files.map((f) => f.name + " " + f.n).join() === "Extra production Nov.xlsx 2", oct.rows.find((y) => y.name === "Cara Agent").extra_files);

S("EP: what the server refuses");
for (const [what, p, re] of [["no OneDrive file id (a file from the computer)", { ...nb, item_id: "" }, /Open the file from OneDrive/], ["a file that is not .xlsx or .csv", { ...nb, file_name: "work.xls" }, /Pick an Excel \(\.xlsx\) or CSV file from OneDrive/],
  ["a link that is not OneDrive's", { ...nb, web_url: "javascript:alert(1)" }, /not a OneDrive link/], ["a link to another site", { ...nb, web_url: "https://example.com/a.xlsx" }, /not a OneDrive link/],
  ["rows that are not a list", { ...nb, groups: "rows" }, /no rows came from it/], ["a day that is no day", { ...nb, groups: [{ d: "2026-02-30", u: "Arun Agent", n: 1 }] }, /could not read its rows/],
  ["a count that is no count", { ...nb, groups: [{ d: D(11, 3), u: "Arun Agent", n: 1.5 }] }, /could not read its rows/], ["a row with no name", { ...nb, groups: [{ d: D(11, 3), u: " ", n: 1 }] }, /could not read its rows/],
  ["more than 50,000 rows", { ...nb, groups: [{ d: D(11, 3), u: "Arun Agent", n: 50000 }], skipped: { no_date: 1 } }, /50,001 rows: Brahmastra reads up to 50,000 rows a file/],
  ["more than 20,000 people and days", { ...nb, groups: Array.from({ length: 20001 }, (_, i) => ({ d: D(11, 3), u: "Name " + i, n: 1 })) }, /more than 20,000 different people and days/],
  ["an empty file", { ...nb, groups: [], skipped: {} }, /no rows to read/]]) {
  r = await T(() => TE("stack.extraPreview", p));
  ok("EP: the server refuses " + what, !r.ok && r.status === 400 && re.test(r.e), r);
}
r = await T(() => TE("stack.extraPreview", { ...nb, groups: [{ d: D(11, 3), u: "<img src=x onerror=alert(1)>", n: 1 }] }));
ok("EP: a name from the file comes back as it was written, as text (the page shows it as text)", r.ok && r.r.left_out.not_found[0].name === "<img src=x onerror=alert(1)>", r.ok ? r.r.left_out.not_found : r);

/* ---- the edit option: each person's line of extra production can be edited by hand ---- */
// a file for the edits: Dev and Mina (matched), Sona Sample (nobody), Ravi Twin (two people), Dora Desk (Posting) and Lena Lake (Lara's)
const edAoa = (o = {}) => [["DOW", "Emp ID", "User Name"], ...rep(4, [serial(D(11, 3)), "PHC-A3", "Dev Agent"]), ...(o.noNov4 ? [] : rep(3, [serial(D(11, 4)), "PHC-A3", "Dev Agent"])),
  ...rep(o.mina || 2, [serial(D(11, 3)), "PHC-A4", "Mina Agent"]), ...rep(2, [serial(D(11, 5)), "", "Sona Sample"]), ...rep(3, [serial(D(11, 5)), "", "Ravi Twin"]),
  [serial(D(11, 5)), "PHC-A7", "Dora Desk"], ...rep(2, [serial(D(11, 5)), "PHC-B1", "Lena Lake"]), ...(o.more || [])];
const ED = read(xlsx([["Extra work", edAoa()]]), "Extra production edits.xlsx").r;
const eb = (draft, edits, o = {}) => ({ ...body(draft, { item: "item-ed", ...o }), ...(edits ? { edits } : {}) });
const LN = { dev: "phc-a3|dev agent", mina: "phc-a4|mina agent", sona: "|sona sample", ravi: "|ravi twin", dora: "phc-a7|dora desk", lena: "phc-b1|lena lake" };
const lineOf = (v, k) => (v.lines || []).find((l) => l.line === k) || {}, dayOf = (l, d) => (l.days || []).find((x) => x.day === d) || {};
const extraOf = async (X, n) => (await X("team.status", { from: D(11, 1), to: D(11, 12) })).rows.find((y) => y.id === (typeof n === "string" ? id(n) : n.id)).extra || 0;
const audits = async () => (await rows("SELECT user_name, detail FROM audit_log WHERE action = 'stack.extraEdit' ORDER BY at, rowid")).map((y) => y.user_name + " | " + y.detail);

S("EP edit: the check before saving shows each name of the file as a line that can be edited");
r = await T(() => TE("stack.extraPreview", eb(ED)));
let ev = r.ok ? r.r : {};
ok("EP edit: one line a name of the file, with who it counts for, the file's own number for each day and the number counted", r.ok && ev.lines.length === 2 && lineOf(ev, LN.dev).person === "Dev Agent" && lineOf(ev, LN.dev).rows === 7 && lineOf(ev, LN.dev).file_rows === 7
  && JSON.stringify(lineOf(ev, LN.dev).days) === JSON.stringify([{ day: D(11, 3), file_n: 4, n: 4, edited: null, locked: false }, { day: D(11, 4), file_n: 3, n: 3, edited: null, locked: false }]) && lineOf(ev, LN.mina).rows === 2 && !lineOf(ev, LN.dev).picked, r.ok ? ev.lines : r);
ok("EP edit: the names left out as not found or shared by two people come with their line, so a person can be picked", ev.left_out.not_found.map((n) => n.line).sort().join() === [LN.sona, LN.lena].sort().join() && ev.left_out.same_name[0].line === LN.ravi && ev.left_out.same_name[0].rows === 3, ev.left_out);
ok("EP edit: the people who can be picked are the editor's own, counted on Team status (not Dora on Posting, not the SME, not Lara's team)", ev.pickable.map((p) => p.name + " " + p.emp_id).join() === "Arun Agent PHC-A1,Cara Agent PHC-A2,Dev Agent PHC-A3,Mina Agent PHC-A4,Ravi Twin PHC-A5,Ravi Twin PHC-A6", ev.pickable);
ok("EP edit: the screen's one plain line on what cannot be done here", ev.add_note === "To add work, add it to the file in OneDrive and load it again.", ev.add_note);

S("EP edit: a day's count (before saving)");
r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: LN.dev, day: D(11, 3), n: 6 }] })));
ev = r.ok ? r.r : {};
ok("EP edit: Dev's Nov 3 edited from 4 to 6: 6 is counted, the file's own 4 stays beside it, marked as edited by the editor", r.ok && dayOf(lineOf(ev, LN.dev), D(11, 3)).n === 6 && dayOf(lineOf(ev, LN.dev), D(11, 3)).file_n === 4 && dayOf(lineOf(ev, LN.dev), D(11, 3)).edited.by === "Tess Lead"
  && dayOf(lineOf(ev, LN.dev), D(11, 3)).edited.now === true && lineOf(ev, LN.dev).rows === 9 && lineOf(ev, LN.dev).file_rows === 7 && lineOf(ev, LN.dev).edits === 1 && ev.counted === 11 && ev.file_counted === 9 && ev.edits.counts === 1, r.ok ? lineOf(ev, LN.dev) : r);
r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: LN.dev, day: D(11, 4), n: 0 }] })));
ok("EP edit: 0 means the day is not counted: Dev 4 rows on 1 day (the file's 3 still shown)", r.ok && lineOf(r.r, LN.dev).rows === 4 && lineOf(r.r, LN.dev).n_days === 1 && lineOf(r.r, LN.dev).to === D(11, 3) && dayOf(lineOf(r.r, LN.dev), D(11, 4)).file_n === 3 && r.r.people.find((p) => p.name === "Dev Agent").days === 1, r.ok ? lineOf(r.r, LN.dev) : r);
r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: LN.dev, day: D(11, 3), n: 4 }] })));
ok("EP edit: typing the file's own number is no edit", r.ok && dayOf(lineOf(r.r, LN.dev), D(11, 3)).edited === null && r.r.edits.counts === 0, r.ok ? lineOf(r.r, LN.dev) : r);
for (const [what, n] of [["a negative count", -1], ["a fraction", 1.5], ["text", "many"], ["an empty count", ""], ["a count over 50,000", 50001]]) {
  r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: LN.dev, day: D(11, 3), n }] })));
  ok("EP edit: " + what + " is refused: a whole number, 0 or more", !r.ok && r.status === 400 && /A day's count is a whole number from 0 to 50,000/.test(r.e), r);
}
r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: LN.dev, day: D(11, 6), n: 2 }] })));
ok("EP edit: a day the file does not have cannot be added, and the answer says what to do", !r.ok && r.status === 400 && /a person or a day the file does not have cannot be added here\. To add work, add it to the file in OneDrive and load it again\./.test(r.e), r);
r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: "phc-a1|arun agent", day: D(11, 3), n: 2 }] })));
ok("EP edit: nor a person the file does not have", !r.ok && r.status === 400 && /cannot be added here/.test(r.e), r);
r = await T(() => TE("stack.extraPreview", eb(ED, { counts: [{ line: LN.sona, day: D(11, 5), n: 1 }] })));
ok("EP edit: a name that is left out has no count to edit until a person is picked", !r.ok && r.status === 400 && /Pick the person for Sona Sample first/.test(r.e), r);

S("EP edit: who it counts for, and a person for a left-out name (before saving)");
r = await T(() => TE("stack.extraPreview", eb(ED, { picks: [{ line: LN.mina, user_id: id("Arun Agent") }] })));
ev = r.ok ? r.r : {};
ok("EP edit: Mina's line picked for Arun: it counts for Arun, the name written in the file stays, marked as picked", r.ok && lineOf(ev, LN.mina).person === "Arun Agent" && lineOf(ev, LN.mina).name === "Mina Agent" && lineOf(ev, LN.mina).auto_name === "Mina Agent"
  && lineOf(ev, LN.mina).picked.by === "Tess Lead" && lineOf(ev, LN.mina).picked.now === true && ev.people.find((p) => p.name === "Arun Agent").rows === 2 && !ev.people.some((p) => p.name === "Mina Agent") && ev.edits.picks === 1, r.ok ? lineOf(ev, LN.mina) : r);
r = await T(() => TE("stack.extraPreview", eb(ED, { picks: [{ line: LN.sona, user_id: id("Cara Agent") }, { line: LN.ravi, user_id: ravi[0].id }] })));
ev = r.ok ? r.r : {};
ok("EP edit: a person picked for Sona Sample (not found) and for Ravi Twin (two people): their rows count for them now", r.ok && lineOf(ev, LN.sona).person === "Cara Agent" && lineOf(ev, LN.sona).rows === 2 && lineOf(ev, LN.sona).why === "none" && lineOf(ev, LN.ravi).id === ravi[0].id
  && lineOf(ev, LN.ravi).person_emp === "PHC-A5" && lineOf(ev, LN.ravi).why === "same" && ev.counted === 14 && ev.left_out.not_found.map((n) => n.name).join() === "Lena Lake" && !ev.left_out.same_name.length && ev.left_out.rows === 3, r.ok ? [lineOf(ev, LN.sona), ev.left_out] : r);
for (const [what, who, re] of [["someone outside the editor's span (Lena)", "Lena Lake", /Pick one of the people you see who is counted on Team status/], ["someone Team status does not count (Dora on Posting)", "Dora Desk", /Pick one of the people you see who is counted on Team status/],
  ["an SME", "Sid Expert", /Pick one of the people you see/], ["the team lead herself", "Tess Lead", /Pick one of the people you see/]]) {
  r = await T(() => TE("stack.extraPreview", eb(ED, { picks: [{ line: LN.sona, user_id: id(who) }] })));
  ok("EP edit: picking " + what + " is refused", !r.ok && r.status === 400 && re.test(r.e), r);
}
r = await T(() => TE("stack.extraPreview", eb(ED, { picks: [{ line: LN.sona, user_id: "nobody-with-this-id" }] })));
ok("EP edit: picking an id that is nobody is refused", !r.ok && r.status === 400, r);
r = await T(() => TE("stack.extraPreview", eb(ED, { picks: [{ line: LN.dora, user_id: id("Arun Agent") }] })));
ok("EP edit: a name left out for another reason (Dora is not on Team status) cannot be given a person: the fix is in the file", !r.ok && r.status === 400 && /Dora Desk is not counted on Team status, so these rows are not counted: the fix is in the file/.test(r.e), r);
r = await T(() => TE("stack.extraPreview", eb(ED, { picks: [{ line: "|nobody here", user_id: id("Arun Agent") }] })));
ok("EP edit: a name the file does not have cannot be picked for", !r.ok && r.status === 400 && /cannot be added here/.test(r.e), r);

S("EP edit: saved with the edits: what counts, what is kept, the audit trail");
const before = { dev: await extraOf(TE, "Dev Agent"), mina: await extraOf(TE, "Mina Agent"), cara: await extraOf(TE, "Cara Agent"), arun: await extraOf(TE, "Arun Agent"), r0: await extraOf(TE, ravi[0]), lena: await extraOf(MO, "Lena Lake") };
const nAud0 = (await audits()).length;
clock(IST(2026, 11, 12, 15, 10));
const E1 = { counts: [{ line: LN.dev, day: D(11, 3), n: 6 }, { line: LN.dev, day: D(11, 4), n: 0 }], picks: [{ line: LN.sona, user_id: id("Cara Agent") }, { line: LN.ravi, user_id: ravi[0].id }] };
r = await T(() => TE("stack.extraSave", eb(ED, E1)));
ok("EP edit: saved: 13 rows counted (the file has 14 for them), 2 counts edited and 2 names given a person", r.ok && r.r.counted === 13 && r.r.people === 4 && r.r.edits.counts === 2 && r.r.edits.picks === 2, r);
const edUp = r.ok ? r.r.id : "";
const T1 = IST(2026, 11, 12, 15, 10);
let el = await rows("SELECT line, day, user_id, auto_id, why, file_n, n, n_by, n_at, pick_by, pick_at FROM extra_lines WHERE upload_id = ? ORDER BY line, day", edUp);
const elr = (k, d) => el.find((y) => y.line === k && (!d || y.day === d)) || {};
ok("EP edit: kept for each name and day: the file's own number, the number counted, who edited it and when", elr(LN.dev, D(11, 3)).file_n === 4 && elr(LN.dev, D(11, 3)).n === 6 && elr(LN.dev, D(11, 3)).n_by === "Tess Lead" && elr(LN.dev, D(11, 3)).n_at === T1
  && elr(LN.dev, D(11, 4)).file_n === 3 && elr(LN.dev, D(11, 4)).n === 0 && elr(LN.mina).n === 2 && elr(LN.mina).n_at === null && elr(LN.mina).n_by === "", el.filter((y) => y.line === LN.dev));
ok("EP edit: and who each name counts for: the file's own match, or the person picked (by whom, when)", elr(LN.dev).user_id === id("Dev Agent") && elr(LN.dev).auto_id === id("Dev Agent") && elr(LN.dev).pick_at === null && elr(LN.sona).user_id === id("Cara Agent")
  && elr(LN.sona).auto_id === "" && elr(LN.sona).why === "none" && elr(LN.sona).pick_by === "Tess Lead" && elr(LN.sona).pick_at === T1 && elr(LN.ravi).user_id === ravi[0].id && elr(LN.ravi).why === "same", [elr(LN.sona), elr(LN.ravi)]);
ok("EP edit: a name still left out (Lena Lake, not Tess's) is kept with the file, counting for nobody; Dora's rows are not kept", elr(LN.lena).user_id === "" && elr(LN.lena).why === "none" && elr(LN.lena).file_n === 2 && !el.some((y) => y.line === LN.dora), elr(LN.lena));
let au = (await audits()).slice(nAud0);
ok("EP edit: every hand edit is in the audit trail with the old and the new value", au.length === 4 && au.includes("Tess Lead | Extra production edited by hand, Extra production edits.xlsx: Dev Agent, Nov 3, 2026: 4 → 6")
  && au.includes("Tess Lead | Extra production edited by hand, Extra production edits.xlsx: Dev Agent, Nov 4, 2026: 3 → 0") && au.includes('Tess Lead | Extra production edited by hand, Extra production edits.xlsx: "Sona Sample" in the file counts for Cara Agent (was left out: not found)')
  && au.includes('Tess Lead | Extra production edited by hand, Extra production edits.xlsx: "Ravi Twin" in the file counts for Ravi Twin (was left out: two people share the name)'), au);
ok("EP edit: the upload's own audit line says it was edited by hand", /edited by hand: 2 counts, 2 names given a person/.test((await rows("SELECT detail FROM audit_log WHERE action = 'stack.extra' ORDER BY at DESC, rowid DESC LIMIT 1"))[0].detail));
ok("EP edit: the edited figures are what Team status counts: Dev 6 (not the file's 7), Mina 2, Cara 2 more (Sona's rows), one Ravi Twin 3", (await extraOf(TE, "Dev Agent")) === before.dev + 6 && (await extraOf(TE, "Mina Agent")) === before.mina + 2
  && (await extraOf(TE, "Cara Agent")) === before.cara + 2 && (await extraOf(TE, ravi[0])) === before.r0 + 3 && (await extraOf(TE, ravi[1])) === 0, [await extraOf(TE, "Dev Agent"), before.dev]);
ts = await TE("team.status", { from: D(11, 1), to: D(11, 12) });
let tsDev = ts.rows.find((y) => y.name === "Dev Agent"), fDev = tsDev.extra_files.find((f) => f.name === "Extra production edits.xlsx");
ok("EP edit: Team status names the file as edited by hand: 6 counted, the file has 7, by whom and when", fDev && fDev.n === 6 && fDev.file_n === 7 && fDev.edited === true && fDev.edit_by === "Tess Lead" && fDev.edit_at === T1 && tsDev.count_done === tsDev.worked_done + tsDev.extra_done, fDev);
mo = await TE("stack.month", { month: "2026-11" });
let sDev = mo.rows.find((y) => y.name === "Dev Agent"), sfDev = sDev.extra_files.find((f) => f.name === "Extra production edits.xlsx");
ok("EP edit: and the Stack report's Productivity and its how-it-was-worked-out: Achieved is Team status's, the file marked as edited by hand", sDev.achieved === tsDev.count_done && sDev.extra === tsDev.extra_done && sfDev && sfDev.n === 6 && sfDev.file_n === 7 && sfDev.edited === true && sfDev.edit_by === "Tess Lead" && sfDev.edit_at === T1, sfDev);
let fl = mo.extra.files.find((f) => f.id === edUp) || {};
ok("EP edit: the month's list marks the file: 13 rows (the file has 14), 2 counts edited, 2 names picked, 1 name still left out", fl.rows === 13 && fl.file_rows === 14 && fl.edits === 2 && fl.picks === 2 && fl.edited_at === T1 && fl.left_names === 1 && fl.left_rows === 2 && fl.can_edit === true, fl);
const wbE = app.stackWorkbook(mo, mo.rows, mo.tls), xsE = wbE.Sheets["Extra production"], rowE = [2, 3, 4, 5, 6, 7, 8, 9].find((i) => xsE["C" + i] && xsE["C" + i].v === "Dev Agent");
ok("EP edit: the Excel download carries the edited figure and says the file was edited by hand", rowE && xsE["E" + rowE].v === sDev.extra && /Extra production edits\.xlsx \(6, edited by hand: the file has 7\)/.test(xsE["F" + rowE].v), rowE && xsE["F" + rowE].v);

S("EP edit: a file already counted opens to its people, each with the same edit");
r = await T(() => TE("stack.extraFile", { upload_id: edUp }));
let fv = r.ok ? r.r : {};
ok("EP edit: the file opens: its names for the editor's people, each day with the file's number, the number counted and the edit's mark", r.ok && fv.file.name === "Extra production edits.xlsx" && fv.lines.map((l) => l.person + "<" + l.name).join() === "Cara Agent<Sona Sample,Dev Agent<Dev Agent,Mina Agent<Mina Agent,Ravi Twin<Ravi Twin"
  && dayOf(lineOf(fv, LN.dev), D(11, 3)).n === 6 && dayOf(lineOf(fv, LN.dev), D(11, 3)).edited.by === "Tess Lead" && dayOf(lineOf(fv, LN.dev), D(11, 3)).edited.at === T1 && lineOf(fv, LN.sona).picked.by === "Tess Lead" && lineOf(fv, LN.sona).picked.at === T1 && fv.counted === 13 && fv.file_counted === 14, r.ok ? fv.lines.map((l) => [l.person, l.name, l.rows]) : r);
ok("EP edit: with the name still left out (to pick a person), the people who can be picked, and the plain line", fv.left_out.not_found.length === 1 && fv.left_out.not_found[0].line === LN.lena && fv.left_out.not_found[0].rows === 2 && fv.pickable.length === 6 && /add it to the file in OneDrive and load it again/.test(fv.add_note), fv.left_out);
clock(IST(2026, 11, 12, 15, 20));
const T2 = IST(2026, 11, 12, 15, 20);
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.mina, counts: [{ day: D(11, 3), n: 5 }] }));
ok("EP edit: Mina's Nov 3 edited on the saved file, 2 to 5: counted at once, marked with who and when", r.ok && r.r.changed === 1 && dayOf(lineOf(r.r.view, LN.mina), D(11, 3)).n === 5 && dayOf(lineOf(r.r.view, LN.mina), D(11, 3)).file_n === 2
  && dayOf(lineOf(r.r.view, LN.mina), D(11, 3)).edited.by === "Tess Lead" && dayOf(lineOf(r.r.view, LN.mina), D(11, 3)).edited.at === T2 && (await extraOf(TE, "Mina Agent")) === before.mina + 5, r.ok ? lineOf(r.r.view, LN.mina) : r);
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.dev, counts: [{ day: D(11, 4), n: 3 }] }));
ok("EP edit: Dev's Nov 4 typed back to the file's own 3: no longer marked as edited", r.ok && dayOf(lineOf(r.r.view, LN.dev), D(11, 4)).n === 3 && dayOf(lineOf(r.r.view, LN.dev), D(11, 4)).edited === null && (await extraOf(TE, "Dev Agent")) === before.dev + 9, r.ok ? lineOf(r.r.view, LN.dev) : r);
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.dev, counts: [{ day: D(11, 4), n: 1 }] }));
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.mina, user_id: id("Arun Agent") }));
ok("EP edit: Mina's line moved to Arun: Arun has its 5, Mina none; the name in the file stays", r.ok && lineOf(r.r.view, LN.mina).person === "Arun Agent" && lineOf(r.r.view, LN.mina).name === "Mina Agent" && lineOf(r.r.view, LN.mina).picked.by === "Tess Lead" && lineOf(r.r.view, LN.mina).picked.at === T2
  && (await extraOf(TE, "Arun Agent")) === before.arun + 5 && (await extraOf(TE, "Mina Agent")) === before.mina, r.ok ? lineOf(r.r.view, LN.mina) : r);
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.mina, user_id: "" }));
ok("EP edit: and back to what the file says (Mina): the pick's mark is gone, the edited count stays", r.ok && lineOf(r.r.view, LN.mina).person === "Mina Agent" && lineOf(r.r.view, LN.mina).picked === null && lineOf(r.r.view, LN.mina).rows === 5 && (await extraOf(TE, "Mina Agent")) === before.mina + 5 && (await extraOf(TE, "Arun Agent")) === before.arun, r.ok ? lineOf(r.r.view, LN.mina) : r);
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.sona, user_id: "" }));
ok("EP edit: Sona Sample left out again: its rows count for nobody, and it is back among the names to pick for", r.ok && !lineOf(r.r.view, LN.sona).line && r.r.view.left_out.not_found.map((n) => n.name).sort().join() === "Lena Lake,Sona Sample" && (await extraOf(TE, "Cara Agent")) === before.cara, r.ok ? r.r.view.left_out : r);
r = await T(() => TE("stack.extraEdit", { upload_id: edUp, line: LN.sona, user_id: id("Cara Agent") }));
ok("EP edit: and picked again on the saved file (Pick the person): Cara has its 2 rows", r.ok && lineOf(r.r.view, LN.sona).person === "Cara Agent" && (await extraOf(TE, "Cara Agent")) === before.cara + 2, r.ok ? lineOf(r.r.view, LN.sona) : r);
au = (await audits()).slice(nAud0 + 4);
ok("EP edit: each of these edits is in the audit trail, old and new value", au.join("\n") === ["Tess Lead | Extra production edited by hand, Extra production edits.xlsx: Mina Agent, Nov 3, 2026: 2 → 5",
  "Tess Lead | Extra production edited by hand, Extra production edits.xlsx: Dev Agent, Nov 4, 2026: 0 → 3 (the file's own number again)", "Tess Lead | Extra production edited by hand, Extra production edits.xlsx: Dev Agent, Nov 4, 2026: 3 → 1",
  'Tess Lead | Extra production edited by hand, Extra production edits.xlsx: "Mina Agent" in the file counts for Arun Agent (was Mina Agent)', 'Tess Lead | Extra production edited by hand, Extra production edits.xlsx: "Mina Agent" in the file counts for Mina Agent again (was Arun Agent)',
  'Tess Lead | Extra production edited by hand, Extra production edits.xlsx: "Sona Sample" in the file counts for nobody again (left out: not found) (was Cara Agent)',
  'Tess Lead | Extra production edited by hand, Extra production edits.xlsx: "Sona Sample" in the file counts for Cara Agent (was left out: not found)'].join("\n"), au);
for (const [what, p, re] of [["a day the file does not have", { line: LN.dev, counts: [{ day: D(11, 6), n: 2 }] }, /a day the file does not have cannot be added here\. To add work, add it to the file in OneDrive and load it again/],
  ["a name the file does not have", { line: "phc-a1|arun agent", counts: [{ day: D(11, 3), n: 2 }] }, /a person the file does not have cannot be added here\. To add work/], ["a count that is no whole number", { line: LN.dev, counts: [{ day: D(11, 3), n: 2.5 }] }, /whole number from 0 to 50,000/],
  ["a negative count", { line: LN.dev, counts: [{ day: D(11, 3), n: -2 }] }, /whole number from 0 to 50,000/], ["a count for a name still left out", { line: LN.lena, counts: [{ day: D(11, 5), n: 1 }] }, /Pick the person for Lena Lake first/],
  ["a person outside the editor's span", { line: LN.lena, user_id: id("Lena Lake") }, /Pick one of the people you see who is counted on Team status/], ["a person Team status does not count", { line: LN.dev, user_id: id("Dora Desk") }, /Pick one of the people you see who is counted on Team status/]]) {
  r = await T(() => TE("stack.extraEdit", { upload_id: edUp, ...p }));
  ok("EP edit: on a saved file, " + what + " is refused", !r.ok && r.status === 400 && re.test(r.e), r);
}
ok("EP edit: a refused edit changes nothing", (await extraOf(TE, "Dev Agent")) === before.dev + 7 && (await audits()).length === nAud0 + 11, [await extraOf(TE, "Dev Agent"), (await audits()).length - nAud0]);

S("EP edit: who may edit (the same people who may upload, for the same people)");
for (const [who, X, st] of [["a biller (Arun)", AR, 403], ["a desk person (Dora)", DO, 403], ["an SME (Sid)", SI, 403], ["a Posting team lead (Paula)", PA, 403], ["anyone signed out", as(null), 401]]) {
  r = await T(() => X("stack.extraFile", { upload_id: edUp })); const r2 = await T(() => X("stack.extraEdit", { upload_id: edUp, line: LN.dev, counts: [{ day: D(11, 3), n: 1 }] }));
  ok(`EP edit: ${who} cannot open a counted file or edit it`, !r.ok && r.status === st && !r2.ok && r2.status === st, [r, r2]);
}
r = await T(() => LA("stack.extraFile", { upload_id: edUp }));
ok("EP edit: another team lead cannot open a file that counts only for Tess's people", !r.ok && r.status === 403, r);
r = await T(() => LA("stack.extraEdit", { upload_id: edUp, line: LN.dev, counts: [{ day: D(11, 3), n: 1 }] }));
ok("EP edit: nor edit Dev's count in it", !r.ok && r.status === 403, r);
r = await T(() => LA("stack.extraEdit", { upload_id: edUp, line: LN.lena, user_id: id("Lena Lake") }));
ok("EP edit: nor pick for a left-out name of a file she does not see", !r.ok && r.status === 403, r);
r = await T(() => MO("stack.extraEdit", { upload_id: edUp, line: LN.lena, user_id: id("Lena Lake") }));
ok("EP edit: the manager (her span has both teams) picks Lena for the left-out Lena Lake: Lena has its 2 rows", r.ok && lineOf(r.r.view, LN.lena).person === "Lena Lake" && lineOf(r.r.view, LN.lena).picked.by === "Mona Manager" && r.r.view.lines.length === 5 && (await extraOf(MO, "Lena Lake")) === before.lena + 2, r.ok ? r.r.view.lines.map((l) => l.person) : r);
r = await T(() => LA("stack.extraFile", { upload_id: edUp }));
ok("EP edit: now the file counts for Lara's Lena, so Lara opens it: only Lena's line, none of Tess's people", r.ok && r.r.lines.map((l) => l.person).join() === "Lena Lake" && r.r.pickable.map((p) => p.name).join() === "Lena Lake,Omar Oak", r.ok ? r.r.lines.map((l) => l.person) : r);
r = await T(() => LA("stack.extraEdit", { upload_id: edUp, line: LN.dev, counts: [{ day: D(11, 3), n: 1 }] }));
ok("EP edit: Lara still cannot edit Dev's count there (not her person)", !r.ok && r.status === 403, r);
r = await T(() => LA("stack.extraEdit", { upload_id: edUp, line: LN.lena, counts: [{ day: D(11, 5), n: 3 }] }));
ok("EP edit: she edits her own Lena's count", r.ok && dayOf(lineOf(r.r.view, LN.lena), D(11, 5)).n === 3 && dayOf(lineOf(r.r.view, LN.lena), D(11, 5)).edited.by === "Lara Lead" && (await extraOf(MO, "Lena Lake")) === before.lena + 3, r);
r = await T(() => TE("stack.extraFile", { upload_id: edUp }));
ok("EP edit: Tess does not see Lena's line in her view of the file", r.ok && !r.r.lines.some((l) => l.person === "Lena Lake") && r.r.lines.length === 4, r.ok ? r.r.lines.map((l) => l.person) : r);

S("EP edit: a locked month takes no edits, and says why");
// October is locked (the manager locked it above); the file counted in October keeps Cara's 2 rows of Oct 20 there
r = await T(() => TE("stack.extraFile", { upload_id: ups[1].id }));
const octLine = r.ok ? r.r.lines.find((l) => l.person === "Cara Agent") : null;
ok("EP edit: the file opens with the locked days marked, and the month named", r.ok && octLine && octLine.days.length === 1 && octLine.days[0].day === D(10, 20) && octLine.days[0].locked === true && r.r.locked_months.join() === "October 2026", r.ok ? [octLine, r.r.locked_months] : r);
r = await T(() => TE("stack.extraEdit", { upload_id: ups[1].id, line: octLine.line, counts: [{ day: D(10, 20), n: 5 }] }));
ok("EP edit: a count in the locked month is refused: October 2026 is locked for Cara Agent", !r.ok && r.status === 400 && /October 2026 is locked for Cara Agent: its counts cannot be edited\. The admin can unlock the month/.test(r.e), r);
r = await T(() => TE("stack.extraEdit", { upload_id: ups[1].id, line: octLine.line, user_id: id("Arun Agent") }));
ok("EP edit: nor can the name move to another person there", !r.ok && r.status === 400 && /October 2026 is locked for Cara Agent: what this name counts there cannot move/.test(r.e), r);
ok("EP edit: the locked month is as it was (Cara's October still 2)", (await TE("team.status", { from: D(10, 1), to: D(10, 31) })).rows.find((y) => y.name === "Cara Agent").extra === 2);
const OCTF = read(xlsx([["S", [["DOW", "User Name"], ...rep(2, [serial(D(10, 22)), "Dev Agent"]), [serial(D(11, 4)), "Dev Agent"]]]]), "Extra production Oct late.xlsx").r;
r = await T(() => TE("stack.extraPreview", eb(OCTF, { counts: [{ line: "|dev agent", day: D(10, 22), n: 1 }] }, { item: "item-octlate" })));
ok("EP edit: before saving, a count in a locked month cannot be edited either", !r.ok && r.status === 400 && /October 2026 is locked for Dev Agent: its counts cannot be edited/.test(r.e), r);
r = await T(() => TE("stack.extraPreview", eb(OCTF, null, { item: "item-octlate" })));
ok("EP edit: the locked days are not on the line to edit (they are left out, with the month named)", r.ok && lineOf(r.r, "|dev agent").days.length === 1 && lineOf(r.r, "|dev agent").days[0].day === D(11, 4) && r.r.left_out.locked[0].label === "October 2026" && r.r.left_out.locked[0].rows === 2, r.ok ? [lineOf(r.r, "|dev agent"), r.r.left_out.locked] : r);

S("EP edit: loading the same file again");
/* What the file's counts are now: Dev's Nov 3 edited to 6 (the file has 4) and Nov 4 edited to 1 (the file has 3); Mina's Nov 3 edited
   to 5 (the file has 2); Sona Sample picked for Cara; Ravi Twin picked for the first Ravi; Lena Lake picked for Lena by the manager,
   her Nov 5 edited to 3 by Lara. The file comes again changed: Dev's Nov 3 the same (4), no Nov 4 any more, a new Nov 5; Mina's
   Nov 3 now 4. */
clock(IST(2026, 11, 12, 15, 40));
const ED2 = read(xlsx([["Extra work", edAoa({ noNov4: true, mina: 4, more: [[serial(D(11, 5)), "PHC-A3", "Dev Agent"]] })]]), "Extra production edits.xlsx").r;
r = await T(() => TE("stack.extraPreview", eb(ED2)));
ev = r.ok ? r.r : {};
ok("EP reload: a hand-edited count is kept while the file's own number is the same: Dev's Nov 3 stays 6 (file 4), with who edited it and when", r.ok && dayOf(lineOf(ev, LN.dev), D(11, 3)).n === 6 && dayOf(lineOf(ev, LN.dev), D(11, 3)).file_n === 4
  && dayOf(lineOf(ev, LN.dev), D(11, 3)).edited.by === "Tess Lead" && dayOf(lineOf(ev, LN.dev), D(11, 3)).edited.at === T1 && !dayOf(lineOf(ev, LN.dev), D(11, 3)).edited.now && dayOf(lineOf(ev, LN.dev), D(11, 5)).n === 1, r.ok ? lineOf(ev, LN.dev) : r);
ok("EP reload: when the file's own number changed, the file's new number is used: Mina's Nov 3 is 4 (not the edit's 5), unmarked", dayOf(lineOf(ev, LN.mina), D(11, 3)).n === 4 && dayOf(lineOf(ev, LN.mina), D(11, 3)).edited === null && lineOf(ev, LN.mina).rows === 4, lineOf(ev, LN.mina));
const dr = (n, d) => (ev.dropped || []).find((y) => y.name === n && y.day === d) || {};
ok("EP reload: the check before saving lists each hand edit that was dropped: the file's old number, the edit, the file's new number", (ev.dropped || []).length === 2 && dr("Mina Agent", D(11, 3)).old_file === 2 && dr("Mina Agent", D(11, 3)).edit === 5 && dr("Mina Agent", D(11, 3)).new_file === 4
  && dr("Mina Agent", D(11, 3)).why === "changed" && dr("Mina Agent", D(11, 3)).by === "Tess Lead" && dr("Mina Agent", D(11, 3)).at === T2 && dr("Mina Agent", D(11, 3)).person === "Mina Agent", ev.dropped);
ok("EP reload: an edit on a day the file no longer has is dropped too, and listed (Dev's Nov 4: the file had 3, edited to 1, now not in the file)", dr("Dev Agent", D(11, 4)).old_file === 3 && dr("Dev Agent", D(11, 4)).edit === 1 && dr("Dev Agent", D(11, 4)).new_file === 0 && dr("Dev Agent", D(11, 4)).why === "gone", dr("Dev Agent", D(11, 4)));
ok("EP reload: a picked person is remembered for that name in that file, and applied again: Sona Sample for Cara, Ravi Twin for the first Ravi, each with who picked and when", lineOf(ev, LN.sona).person === "Cara Agent" && lineOf(ev, LN.sona).picked.by === "Tess Lead"
  && !lineOf(ev, LN.sona).picked.now && lineOf(ev, LN.ravi).id === ravi[0].id && lineOf(ev, LN.ravi).picked.at === T1 && !ev.left_out.not_found.length && !ev.left_out.same_name.length, [lineOf(ev, LN.sona).picked, lineOf(ev, LN.ravi).picked]);
ok("EP reload: Lena Lake counts from the earlier upload for a person Tess does not see: it stays there, is not counted twice, and the check says so", ev.left_out.elsewhere.length === 1 && ev.left_out.elsewhere[0].name === "Lena Lake" && ev.left_out.elsewhere[0].rows === 2 && ev.earlier.keeps === 3, [ev.left_out.elsewhere, ev.earlier]);
r = await T(() => TE("stack.extraPreview", eb(ED2, { picks: [{ line: LN.lena, user_id: id("Arun Agent") }] })));
ok("EP reload: so Tess cannot pick a person for it (it would count twice)", !r.ok && r.status === 400 && /Lena Lake is already counted from an earlier upload of this file, for people you do not see: it cannot be counted twice/.test(r.e), r);
r = await T(() => TE("stack.extraPreview", eb(ED2, { counts: [{ line: LN.dev, day: D(11, 3), n: 4 }], picks: [{ line: LN.sona, user_id: "" }] })));
ok("EP reload: an edit made now wins over a remembered one: Dev's Nov 3 back to the file's 4, Sona Sample left out again", r.ok && dayOf(lineOf(r.r, LN.dev), D(11, 3)).n === 4 && dayOf(lineOf(r.r, LN.dev), D(11, 3)).edited === null && !lineOf(r.r, LN.sona).line && r.r.left_out.not_found[0].name === "Sona Sample", r.ok ? [lineOf(r.r, LN.dev), r.r.left_out.not_found] : r);
const nAud1 = (await audits()).length;
r = await T(() => TE("stack.extraSave", eb(ED2)));
ok("EP reload: saved: 16 rows for 4 people, 2 hand edits dropped, in place of what Tess's people had from it", r.ok && r.r.counted === 6 + 1 + 4 + 2 + 3 && r.r.people === 4 && r.r.dropped === 2 && r.r.kept === 3 && r.r.edits.counts === 1 && r.r.edits.picks === 2, r);
const edUp2 = r.ok ? r.r.id : "";
el = await rows("SELECT line, day, user_id, file_n, n, n_by, n_at, pick_by, pick_at FROM extra_lines WHERE upload_id = ? ORDER BY line, day", edUp2);
ok("EP reload: the kept edit keeps who made it and when (not who loaded the file again)", elr(LN.dev, D(11, 3)).n === 6 && elr(LN.dev, D(11, 3)).n_by === "Tess Lead" && elr(LN.dev, D(11, 3)).n_at === T1 && elr(LN.mina, D(11, 3)).n === 4 && elr(LN.mina, D(11, 3)).n_at === null
  && elr(LN.sona).pick_by === "Tess Lead" && elr(LN.sona).pick_at === IST(2026, 11, 12, 15, 20) && !el.some((y) => y.line === LN.lena), [elr(LN.dev, D(11, 3)), elr(LN.sona)]);
ok("EP reload: no new audit line for an edit that was only carried over; the upload's line counts the dropped edits", (await audits()).length === nAud1 && /2 earlier hand edits dropped \(the file changed\)/.test((await rows("SELECT detail FROM audit_log WHERE action = 'stack.extra' ORDER BY at DESC, rowid DESC LIMIT 1"))[0].detail),
  (await rows("SELECT detail FROM audit_log WHERE action = 'stack.extra' ORDER BY at DESC, rowid DESC LIMIT 1"))[0].detail);
ok("EP reload: Team status: Dev 6 + 1, Mina the file's 4, Cara 2, the first Ravi 3; Lena still her 3 from the earlier upload", (await extraOf(TE, "Dev Agent")) === before.dev + 7 && (await extraOf(TE, "Mina Agent")) === before.mina + 4 && (await extraOf(TE, "Cara Agent")) === before.cara + 2
  && (await extraOf(TE, ravi[0])) === before.r0 + 3 && (await extraOf(MO, "Lena Lake")) === before.lena + 3, [await extraOf(TE, "Dev Agent"), await extraOf(TE, "Mina Agent"), await extraOf(MO, "Lena Lake")]);
ok("EP reload: the earlier upload keeps only Lena's line (still counted), so it is not marked replaced", (await rows("SELECT line FROM extra_lines WHERE upload_id = ?", edUp)).map((y) => y.line).join() === LN.lena && (await rows("SELECT state FROM extra_uploads WHERE id = ?", edUp))[0].state === "counted");
r = await T(() => MO("stack.extraPreview", eb(ED2)));
ok("EP reload: the manager loads it again: for her, Lena Lake matches by itself (no pick needed), and Lara's edit on it carries over (the file's number is the same); nothing is dropped", r.ok && lineOf(r.r, LN.lena).person === "Lena Lake" && lineOf(r.r, LN.lena).picked === null && dayOf(lineOf(r.r, LN.lena), D(11, 5)).n === 3
  && dayOf(lineOf(r.r, LN.lena), D(11, 5)).edited.by === "Lara Lead" && !r.r.dropped.length && !r.r.left_out.elsewhere.length && r.r.earlier.keeps === 0, r.ok ? [lineOf(r.r, LN.lena), r.r.dropped] : r);
r = await T(() => MO("stack.extraSave", eb(ED2)));
ok("EP reload: saved by the manager: one upload holds it all now, the two before are marked replaced", r.ok && r.r.counted === 19 && (await rows("SELECT state FROM extra_uploads WHERE id IN (?, ?) ORDER BY state", edUp, edUp2)).map((y) => y.state).join() === "replaced,replaced"
  && (await extraOf(MO, "Lena Lake")) === before.lena + 3 && (await extraOf(TE, "Dev Agent")) === before.dev + 7, r);
const edUp3 = r.ok ? r.r.id : "";
await sql("UPDATE users SET active = 0 WHERE id = ?", ravi[0].id);
r = await T(() => TE("stack.extraPreview", eb(ED2)));
ok("EP reload: when the person picked before can no longer be counted (switched off), the pick is not applied and the check says so; the name is matched afresh (one Ravi Twin is left)", r.ok && r.r.dropped_picks.length === 1
  && r.r.dropped_picks[0].name === "Ravi Twin" && r.r.dropped_picks[0].person === "Ravi Twin" && r.r.dropped_picks[0].by === "Tess Lead" && lineOf(r.r, LN.ravi).id === ravi[1].id && lineOf(r.r, LN.ravi).picked === null, r.ok ? [r.r.dropped_picks, lineOf(r.r, LN.ravi)] : r);
await sql("UPDATE users SET active = 1 WHERE id = ?", ravi[0].id);
r = await T(() => TE("stack.extraRemove", { upload_id: edUp3 }));
ok("EP edit: Remove takes an edited file's counts off like any other (Tess's people's 16; Lena's stay for Lara and the manager)", r.ok && r.r.removed === 16 && (await extraOf(TE, "Dev Agent")) === before.dev && (await extraOf(MO, "Lena Lake")) === before.lena + 3, r);
r = await T(() => MO("stack.extraRemove", { upload_id: edUp3 }));
ok("EP edit: and once the manager removes the rest, nothing of the file is left, its left-out names included", r.ok && r.r.removed === 3 && (await rows("SELECT COUNT(*) AS n FROM extra_lines WHERE upload_id IN (?, ?, ?)", edUp, edUp2, edUp3))[0].n === 0 && (await rows("SELECT state FROM extra_uploads WHERE id = ?", edUp3))[0].state === "removed", r);
clock(IST(2026, 11, 12, 15));

S("EP: the rig's D1 rules: a team lead with over 120 people (every list bound as one value), 875 people-days in one file");
FEED = [...FEED, ...Array.from({ length: 120 }, (_, i) => AS("PHC-T" + String(i + 1).padStart(3, "0"), "Test Biller " + String(i + 1).padStart(3, "0"), "Tess Lead", SUN))];
await AD("roster.syncShastra");
users = (await AD("users.list")).users;
await sql("UPDATE users SET capacity = 10 WHERE emp_id LIKE 'PHC-%'");
const BIGD = span(D(11, 2), D(11, 11)).filter(wkd).slice(0, 7);
const bigRows = []; for (let i = 1; i <= 120; i++) for (const d of BIGD) bigRows.push([serial(d), "PHC-T" + String(i).padStart(3, "0"), "Test Biller " + String(i).padStart(3, "0")]);
for (const d of BIGD) bigRows.push([serial(d), "PHC-A3", "Dev Agent"], [serial(d), "PHC-A2", "Cara Agent"], [serial(d), "PHC-A1", "Arun Agent"], [serial(d), "PHC-A4", "Mina Agent"], [serial(d), "PHC-A6", "Ravi Twin"]);
const big = read(xlsx([["Big", [["DOW", "Emp ID", "User Name"], ...bigRows]]]), "Extra production big team.xlsx").r;
ok("EP: the big file is read: 875 rows, 875 people-days", big.rows === 875 && big.groups.length === 875, big.rows);
r = await T(() => TE("stack.extraPreview", body(big, { item: "item-big" })));
ok("EP: the preview works for 125 people (no statement over D1's 100 values)", r.ok && r.r.counted === 875 && r.r.people.length === 125, r.ok ? r.r.counted : r);
r = await T(() => TE("stack.extraSave", body(big, { item: "item-big" })));
ok("EP: and the save (the counts go in as one value a statement)", r.ok && r.r.counted === 875 && (await rows("SELECT COUNT(*) AS n FROM extra_lines WHERE upload_id = ?", r.r.id))[0].n === 875, r.ok ? r.r : r);
r = await T(() => TE("stack.extraSave", body(big, { item: "item-big" })));
ok("EP: and again, in place of it (the replace binds the whole span as one value)", r.ok && r.r.replaced === 875 && (await rows("SELECT COUNT(*) AS n FROM extra_lines w JOIN extra_uploads x ON x.id = w.upload_id WHERE x.file_key = ?", "b!madeUpDrive!item-big"))[0].n === 875, r.ok ? r.r : r);
r = await T(() => TE("team.status", { from: D(11, 1), to: D(11, 12) }));
ok("EP: Team status for the big team answers, the extra counted for each", r.ok && r.r.rows.filter((y) => /^Test Biller/.test(y.name)).every((y) => y.extra === 7), r.ok ? r.r.rows.length : r);
r = await T(() => TE("stack.month", { month: "2026-11" }));
ok("EP: the Stack report and its list of files answer for the big team", r.ok && r.r.extra.files.some((f) => f.name === "Extra production big team.xlsx" && f.people === 125 && f.rows === 875) && r.r.rows.find((y) => y.name === "Test Biller 001").extra === 7, r.ok ? r.r.extra.files.map((f) => [f.name, f.rows]) : r);
r = await T(() => TE("team.range", { from: D(11, 1), to: D(11, 12) }));
ok("EP: team.range answers for them too", r.ok && r.r.rows.find((y) => y.name === "Test Biller 120").extra === 7, r.ok ? r.r.totals : r);
const bigUp = (await rows("SELECT id FROM extra_uploads WHERE file_key = ? AND state = 'counted'", "b!madeUpDrive!item-big"))[0];
r = await T(() => TE("stack.extraRemove", { upload_id: bigUp.id }));
ok("EP: and Remove (875 people-days, one value)", r.ok && r.r.removed === 875 && r.r.people === 125, r.ok ? r.r : r);

const fails = results.filter((y) => !y.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
