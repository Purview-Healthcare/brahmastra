/* Suite 50: the Stack report and Extra production, the fixes of the third bug test (tester U) and the extra production
   builder's EP-1. Each check names the finding it guards:
   U-10: a team lead's averages (and every band of the report) judged without the computer's float error: three members typed
         at 99% are 99%, Quality 10. U-04 and U-05 are the same family: a typed percentage is kept at two decimals, cut, never
         rounded up over a line, and the Excel writes its percentages cut too. The one rounding rule: two decimals of a percent,
         cut, the same in the score, on the page and in the Excel.
   U-07: a row's Emp ID is never ignored in favour of a person of the same name.
   U-02: a month can be locked only once its last working day is over (05:00 India time on the 1st, later for a night shift).
   U-01: someone who changes team lead between two locks of one month has exactly one row in it.
   U-11: a leaver keeps counting in the attrition (and keeps their typed values) when the roster sync switches them off.
   U-03: typed values in the audit trail, with the old and the new value.   U-14: the month list is "locked" for a viewer
   only when everyone they see is locked.   U-08: the check names rows a file gained for people the uploader does not see.
   U-09: Team status suggestions name the extra production.   U-06: the audit trail names the Stack report's changes.
   U-12 and U-13 are the page's (the reason box, the check before saving): see the browser walk-through.
   EP-1: the inventory upload's date order: a date that is no date either way (31/31/2026) says nothing about the column.
   A stand-in for Purview Shastra's roster, holiday and floor feeds; made-up people only. */
import vm from "vm";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };

const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const D = (m, d, y = 2026) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".") + "@purview-healthcare.com";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group", HARBOR = "Harbor Clinic";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const AS = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
const dayList = (a, b) => { const out = []; for (let t = Date.parse(a + "T12:00:00Z"); t <= Date.parse(b + "T12:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const isWeekday = (iso) => { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const FD = (emp, date, status, tof = 480, brk = 45) => ({ emp_id: emp, email: "", date, status, open: false, tof_min: tof, logged_min: tof + brk, break_min: brk, guard: false, idle_min: 0, locked_min: 0 });
const serial = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000);
const rep = (n, row) => Array.from({ length: n }, () => row);
const OCT = dayList(D(10, 1), D(10, 31)).filter((d) => isWeekday(d) && d !== D(10, 2));   // 21 working days (Oct 2 a holiday)
// Vida Vice (VP) over Mona Manager (Tina Lead on Sunrise, Leo Lead on Lakeview) and Mark Manager (Lila Lead on Harbor)
const stdFeed = () => [
  P({ emp_id: "V1", name: "Vida Vice", position: "Vice President", email: mail("Vida Vice") }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vida Vice", project: SUN, also_on_projects: LAKE, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "M2", name: "Mark Manager", position: "Manager", reports_to: "Vida Vice", project: HARBOR, email: mail("Mark Manager") }),
  P({ emp_id: "T3", name: "Lila Lead", position: "Team Lead", project: HARBOR, reports_to: "Mark Manager", email: mail("Lila Lead") }),
];

/* One made-up floor on a fresh rig, the clock at `now` (India time), Shastra's feeds standing in. */
async function floor({ now = IST(2026, 11, 16, 15), feed, floorRows = [], holidays = [{ date: D(10, 2), name: "Gandhi Jayanti" }], capacity = 10 } = {}) {
  const st = { feed, floorRows, holidays };
  const fetchMock = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: st.feed });
    if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: st.holidays });
    if (url.includes("brahmastra_floor")) return J({ ok: true, rows: st.floorRows.filter((x) => x.date >= body.p_from && x.date <= body.p_to) });
    if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "no such function" }, 404);
    return J({ error: "no outside calls in tests" }, 500);
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
  const VDate = vm.runInContext("Date", rig.app);
  const F = { rig, app: rig.app, st, T: (fn) => rig.tryOp(fn) };
  F.clock = (ms) => { Date.now = () => ms; VDate.now = () => ms; };
  F.clock(now);
  const DB = rig.backend.env.DB;
  F.sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  F.rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
  await rig.app.seedDemo(() => {});
  const login = async (email, pw) => rig.as(null)("auth.login", { email, passHash: await rig.sha(pw) });
  F.AD = rig.as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  await F.sql("UPDATE sessions SET expires_at = ?", IST(2030, 1, 1));
  F.sync = async () => { const r = await F.AD("roster.syncShastra"); F.users = (await F.AD("users.list")).users; return r; };
  await F.sync();
  F.U = (n) => F.users.find((u) => u.name === n);
  F.id = (n) => F.U(n).id;
  const seen = new Map();
  F.who = async (name, email = mail(name)) => {
    if (seen.has(email)) return seen.get(email);
    const u = F.users.find((x) => x.name === name && (x.email || "") === email) || F.U(name);
    await rig.as(null)("auth.firstPassword", { user_id: u.id, passHash: await rig.sha("pw-" + email) }).catch(() => {});
    const X = rig.as((await login(email, "pw-" + email)).token); await F.sql("UPDATE sessions SET expires_at = ?", IST(2030, 1, 1)); seen.set(email, X); return X;
  };
  if (capacity) await F.sql("UPDATE users SET capacity = ? WHERE source = 'roster'", capacity);
  const claimIds = (await F.rows("SELECT id FROM claims ORDER BY id LIMIT 50")).map((r) => r.id);
  let nn = 0;
  // n work entries by a person on a day, from 11:00 India time (or from atMs), a second apart
  F.work = async (name, day, n, atMs) => { const u = typeof name === "string" ? F.U(name) : name; const [y, m, d] = day.split("-").map(Number), t0 = atMs || IST(y, m, d, 11);
    await F.sql("WITH RECURSIVE c(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM c WHERE i < ?) INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) SELECT ? || i, ?, ?, ?, 'work', ? + i * 1000 FROM c",
      n - 1, "s50-" + (++nn) + "-", claimIds[nn % claimIds.length], u.id, u.name, t0); };
  F.month = (X, month) => X("stack.month", { month });
  F.save = (X, month, name, field, value, note) => F.T(() => X("stack.save", { month, user_id: typeof name === "string" ? F.id(name) : name.id, field, value, note }));
  F.row = (d, n) => d.rows.find((r) => r.name === n);
  F.tl = (d, n) => d.tls.find((t) => t.name === n);
  F.ts = (X, from, to) => X("team.status", { from, to, today: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), tz_offset_min: 330 });
  F.xlsx = (sheets) => { const XLSX = rig.app.XLSX, wb = XLSX.utils.book_new(); for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })); };
  F.read = (bytes, name) => rig.app.extraRead(bytes, name);
  F.body = (draft, o = {}) => ({ month: o.month || "2026-11", drive_id: "b!madeUpDrive", item_id: o.item || "item-1", file_name: draft.file,
    web_url: "https://purviewhealthcare-my.sharepoint.com/personal/tina_lead/Documents/" + encodeURIComponent(draft.file), groups: draft.groups, skipped: draft.skipped, sheets: draft.sheets, ...(o.edits ? { edits: o.edits } : {}) });
  return F;
}
const presentAll = (emps, days = OCT) => emps.flatMap((e) => days.map((d) => FD(e, d, "present")));

// ---------------------------------------------------------------------------------------------------------------------------
S("U-10, U-04, U-05: one rounding rule, two decimals of a percent, cut: in the score, on the page and in the Excel");
{
  // Tina's team: Arun, Cara and Mina, each 20 days in (one day of approved leave) at 500 a day: 10,000 expected
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-A2", "Cara Agent", "Tina Lead", SUN), AS("PHC-A3", "Mina Agent", "Tina Lead", SUN),
    AS("PHC-B1", "Bela Agent", "Leo Lead", LAKE), AS("PHC-B2", "Omar Agent", "Leo Lead", LAKE), AS("PHC-B3", "Nia Agent", "Leo Lead", LAKE)];
  const rows = ["PHC-A1", "PHC-A2", "PHC-A3", "PHC-B1", "PHC-B2", "PHC-B3"].flatMap((e) => OCT.map((d, i) => FD(e, d, i === 0 ? "approved_leave" : "present", i === 0 ? 0 : 480, i === 0 ? 0 : 45)));
  const F = await floor({ feed, floorRows: rows, capacity: 500 });
  const TI = await F.who("Tina Lead"), LE = await F.who("Leo Lead"), MO = await F.who("Mona Manager");
  // Tina's three: 89.51% productivity each, quality typed 99 each
  for (const n of ["Arun Agent", "Cara Agent", "Mina Agent"]) { await F.work(n, D(10, 5), 8951); await F.save(TI, "2026-10", n, "quality", "99"); }
  // Leo's three: 99.51%, 94.51% and 99.51%: productivity average 97.843...%; quality typed 96.51 each (an average of 96.51)
  for (const [n, k] of [["Bela Agent", 9951], ["Omar Agent", 9451], ["Nia Agent", 9951]]) { await F.work(n, D(10, 6), k); await F.save(LE, "2026-10", n, "quality", "96.51"); }
  const m = await F.month(MO, "2026-10"), ti = F.tl(m, "Tina Lead"), le = F.tl(m, "Leo Lead");
  ok("U-10: three members typed at 99% quality: the team lead's average is judged as 99% (Quality 10, '99% and above')", ti.s.qual === 10 && /^99% and above → 10$/.test(ti.why.qual), { quality: ti.quality, s: ti.s.qual, why: ti.why.qual });
  ok("U-10: three members at exactly 89.51% productivity: the team lead's productivity is 89.51% (6), not under the line (0)", ti.s.prod === 6 && /^89\.51% to 94\.5% → 6$/.test(ti.why.prod), { prod: ti.prod, s: ti.s.prod, why: ti.why.prod });
  ok("U-10: the page shows the same 99% and 89.51% it scores (stkPct)", vm.runInContext("stkPct", F.app)(ti.quality) === "99%" && vm.runInContext("stkPct", F.app)(ti.prod) === "89.51%");
  ok("U-10: three members typed at 96.51% quality average 96.51%: Quality 8 (96.51% to 98.99%)", le.s.qual === 8 && /^96\.51% to 98\.99% → 8$/.test(le.why.qual), { q: le.quality, s: le.s.qual, why: le.why.qual });
  const arun = F.row(m, "Arun Agent");
  ok("U-10: an associate at exactly 89.51% (8951 of 10,000) scores productivity 2 (84.51% to 90.5%), shown as 89.51%", arun.s.prod === 2 && vm.runInContext("stkPct", F.app)(arun.pct) === "89.51%", { pct: arun.pct, s: arun.s.prod });
  // U-04: the typed values, with more than two decimals
  let r = await F.save(TI, "2026-10", "Arun Agent", "quality", "98.9999");
  ok("U-04: a typed quality of 98.9999 is kept as 98.99%, not rounded up to 99%", r.ok && r.r.value === "0.9899", r);
  r = await F.save(TI, "2026-10", "Arun Agent", "pkt", "99.506");
  ok("U-04: a typed PKT of 99.506 is kept as 99.5%, not rounded up to 99.51%", r.ok && r.r.value === "0.995", r);
  r = await F.save(TI, "2026-10", "Cara Agent", "pkt", "94.51 %");
  ok("U-04: a typed PKT of 94.51 (with a % sign) is kept as 94.51% exactly", r.ok && r.r.value === "0.9451", r);
  let a = F.row(await F.month(TI, "2026-10"), "Arun Agent"), c = F.row(await F.month(TI, "2026-10"), "Cara Agent");
  ok("U-04: the owner's rule on the value typed: 98.9999% is Quality 8, 99.506% is PKT 1; 94.51% is PKT 1", a.s.qual === 8 && a.s.pkt === 1 && c.s.pkt === 1 && /^94\.51% to 98\.99% → 8$/.test(a.why.qual), { q: a.quality, s: a.s.qual, pkt: a.pkt, sp: a.s.pkt, cpkt: c.s.pkt });
  r = await F.save(TI, "2026-10", "Arun Agent", "quality", "100"); ok("U-04: 100 is kept as 100%", r.ok && r.r.value === "1", r);
  r = await F.save(TI, "2026-10", "Arun Agent", "quality", "0.01"); ok("U-04: 0.01 is kept as 0.01%", r.ok && r.r.value === "0.0001", r);
  r = await F.save(TI, "2026-10", "Arun Agent", "quality", "99"); ok("U-04: 99 is kept as 99%", r.ok && r.r.value === "0.99", r);
}
{
  // U-05: Arun has 21 working days, 3 of them approved leave: 18 days in at 45 a day is 810 expected; he did 806 (99.506%)
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-A2", "Cara Agent", "Tina Lead", SUN)];
  const rows = [...OCT.map((d, i) => FD("PHC-A1", d, i < 3 ? "approved_leave" : "present", i < 3 ? 0 : 480, i < 3 ? 0 : 45)), ...presentAll(["PHC-A2"])];
  const F = await floor({ feed, floorRows: rows, capacity: 45 });
  const MO = await F.who("Mona Manager"), TI = await F.who("Tina Lead"), XLSX = F.app.XLSX, pct = vm.runInContext("stkPct", F.app);
  await F.work("Arun Agent", D(10, 12), 806); await F.work("Cara Agent", D(10, 12), 900);
  await F.save(TI, "2026-10", "Arun Agent", "quality", "98.9999"); await F.save(TI, "2026-10", "Arun Agent", "pkt", "99.5099");
  const m = await F.month(MO, "2026-10"), arun = F.row(m, "Arun Agent");
  const cellsOf = (d) => { const ws = d.Sheets["Stack Sheet"], at = (n) => Object.keys(ws).filter((k) => /^C\d+$/.test(k)).find((k) => ws[k].v === n).slice(1);
    return { ws, cell: (n, col) => XLSX.utils.format_cell(ws[col + at(n)]), raw: (n, col) => ws[col + at(n)] }; };
  const X = cellsOf(F.app.stackWorkbook(m, m.rows, m.tls));
  ok("U-05: 806 of 810 (99.506%): the page shows 99.5% with score 6; the Excel cell reads 99.50% beside the same 6, never 99.51%", arun.achieved === 806 && arun.expected === 810 && pct(arun.pct) === "99.5%" && arun.s.prod === 6
    && X.cell("Arun Agent", "H") === "99.50%" && X.raw("Arun Agent", "K").v === 6 && X.raw("Arun Agent", "H").t === "n" && /%/.test(X.raw("Arun Agent", "H").z), { page: pct(arun.pct), excel: X.cell("Arun Agent", "H") });
  ok("U-05: the typed quality and PKT read as the page shows them: 98.99% and 99.5%", X.cell("Arun Agent", "L") === "98.99%" && X.cell("Arun Agent", "AC") === "99.50%" && pct(arun.quality) === "98.99%" && pct(arun.pkt) === "99.5%", [X.cell("Arun Agent", "L"), X.cell("Arun Agent", "AC")]);
  // values a hair under a line, as the page has them: each written cut, never shown on the line it did not reach
  const fake = { ...m, rows: m.rows.map((x) => (x.name === "Arun Agent" ? { ...x, pct: 1.1050999, shrink: 0.134899, s: { ...x.s, pct: 0.919999 } } : x)), tls: m.tls.map((t) => (t.name === "Tina Lead" ? { ...t, s: { ...t.s, pct: 0.959999 } } : t)) };
  const Y = cellsOf(F.app.stackWorkbook(fake, fake.rows, fake.tls));
  ok("U-05: 110.50999% reads 110.50%, shrinkage 13.4899% reads 13.48%, a total of 91.9999% reads 91.99%", Y.cell("Arun Agent", "H") === "110.50%" && Y.cell("Arun Agent", "T") === "13.48%" && Y.cell("Arun Agent", "AI") === "91.99%",
    [Y.cell("Arun Agent", "H"), Y.cell("Arun Agent", "T"), Y.cell("Arun Agent", "AI")]);
  ok("U-05: a team lead's 95.9999% reads 95.99% in the TL STACK (column AH)", Y.cell("Tina Lead", "AH") === "95.99%" && Y.raw("Tina Lead", "AI").v === F.tl(m, "Tina Lead").s.stack, Y.cell("Tina Lead", "AH"));
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-07: extra production: a row's Emp ID is never ignored in favour of a person of the same name");
{
  // three people called Arun Agent: Tina's (PHC-A1), Leo's (PHC-B9), and one who left Tina's team (PHC-A8, switched off)
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-B9", "Arun Agent", "Leo Lead", LAKE, { email: "arun.agent2@purview-healthcare.com" }),
    AS("PHC-A8", "Arun Agent", "Tina Lead", SUN, { email: "arun.agent3@purview-healthcare.com" })];
  const NOV = dayList(D(11, 2), D(11, 13)).filter(isWeekday);
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-B9", "PHC-A8"], NOV), holidays: [] });
  await F.work(F.users.find((u) => u.emp_id === "PHC-A8"), D(10, 20), 30);   // worked in October, then left
  F.st.feed = feed.map((f) => (f.emp_id === "PHC-A8" ? { ...f, status: "Resigned", exit_date: D(10, 30) } : f)); await F.sync();
  const TI = await F.who("Tina Lead"), LE = await F.who("Leo Lead");
  const tina = F.users.find((u) => u.emp_id === "PHC-A1"), leo = F.users.find((u) => u.emp_id === "PHC-B9");
  // the manager's file for both teams: 5 rows of Leo's Arun, 2 of Tina's, 3 of the one who left, 4 with an Emp ID nobody has
  // (a typo) and 1 with no Emp ID
  const file = F.read(F.xlsx([["Both", [["DOW", "Emp ID", "User Name"], ...rep(5, [serial(D(11, 10)), "PHC-B9", "Arun Agent"]), ...rep(2, [serial(D(11, 10)), "PHC-A1", "Arun Agent"]),
    ...rep(3, [serial(D(11, 10)), "phc-a8 ", "arun  agent"]), ...rep(4, [serial(D(11, 11)), "PHC-ZZ9", "Arun Agent"]), [serial(D(11, 12)), "", "Arun Agent"]]]]), "Both teams.xlsx");
  const pv = await TI("stack.extraPreview", F.body(file, { item: "both" }));
  const line = (emp) => pv.lines.find((l) => l.emp_id === emp), out = (emp) => pv.left_out.not_found.find((n) => n.emp_id === emp);
  ok("U-07: Tina's check: Leo's Arun (PHC-B9) is left out as not found among her people, with its Emp ID, never counted for her Arun", !line("PHC-B9") && out("PHC-B9") && out("PHC-B9").rows === 5, { lines: pv.lines.map((l) => [l.emp_id, l.person_emp, l.rows]), out: pv.left_out.not_found });
  ok("U-07: the Emp ID of someone switched off (PHC-A8, any case and spacing) is not matched by the name either", !line("phc-a8") && out("phc-a8") && out("phc-a8").rows === 3, pv.left_out.not_found);
  ok("U-07: her own Arun's rows (PHC-A1) count for him", line("PHC-A1") && line("PHC-A1").id === tina.id && line("PHC-A1").rows === 2, line("PHC-A1"));
  ok("U-07: an Emp ID nobody has (a typo) falls back to the name: it counts for her Arun, and the line keeps the file's Emp ID beside his", line("PHC-ZZ9") && line("PHC-ZZ9").id === tina.id && line("PHC-ZZ9").person_emp === "PHC-A1" && line("PHC-ZZ9").rows === 4, line("PHC-ZZ9"));
  ok("U-07: a row with no Emp ID is matched by the name, as before", line("") && line("").id === tina.id && line("").rows === 1, line(""));
  ok("U-07: To count 7 for Tina (2 + 4 + 1), 8 left out (5 + 3)", pv.counted === 7 && pv.left_out.rows === 8, { counted: pv.counted, left: pv.left_out.rows });
  await TI("stack.extraSave", F.body(file, { item: "both" }));
  const lv = await LE("stack.extraPreview", F.body(file, { item: "both" }));
  ok("U-07: Leo then loads the same file: his Arun's 5 rows (PHC-B9) count for him", lv.counted === 5 && lv.lines.length === 1 && lv.lines[0].id === leo.id && lv.lines[0].emp_id === "PHC-B9", { counted: lv.counted, lines: lv.lines.map((l) => [l.emp_id, l.person, l.rows]) });
  await LE("stack.extraSave", F.body(file, { item: "both" }));
  const ts = await F.ts(F.AD, D(11, 1), D(11, 16)), ex = (u) => (ts.rows.find((r) => r.id === u.id) || {}).extra;
  ok("U-07: Team status: Tina's Arun 7 extra, Leo's Arun 5: nothing counted for the wrong person, nothing twice", ex(tina) === 7 && ex(leo) === 5, { tina: ex(tina), leo: ex(leo) });
}

// ---------------------------------------------------------------------------------------------------------------------------
const passed = results.filter((x) => x.pass).length, failed = results.length - passed;
console.log(`\n==== ${passed} passed, ${failed} failed of ${results.length}`);
process.exit(failed ? 1 : 0);
