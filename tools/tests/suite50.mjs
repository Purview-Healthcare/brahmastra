/* Suite 50: the Stack report and Extra production, the fixes of the third bug test (tester U). Each check names the finding it
   guards:
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
S("U-02: a month is over (and can be locked) once its last working day is: 05:00 India time on the 1st, later for a night shift");
{
  // Mona's teams: Arun (day shift) and Nia (18:30 to 03:30) on Tina's, Nora (22:30 to 07:30) on Leo's; Mark's: Zed (day shift)
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-A2", "Nia Night", "Tina Lead", SUN, { shift: "18:30-03:30" }),
    AS("PHC-B1", "Nora Late", "Leo Lead", LAKE, { shift: "22:30-07:30" }), AS("PHC-C1", "Zed Agent", "Lila Lead", HARBOR)];
  const NOV = dayList(D(11, 1), D(11, 30)).filter(isWeekday);   // 21 working days; Nov 30 is a Monday
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-A2", "PHC-B1", "PHC-C1"], NOV), holidays: [], now: IST(2026, 12, 1, 0, 30) });
  const MO = await F.who("Mona Manager"), MK = await F.who("Mark Manager");
  for (const d of NOV) { const [y, m, dd] = d.split("-").map(Number); await F.work("Arun Agent", d, 10); await F.work("Zed Agent", d, 10); await F.work("Nia Night", d, 10, IST(y, m, dd, 20)); await F.work("Nora Late", d, 10, IST(y, m, dd, 23)); }
  await F.work("Nia Night", D(11, 30), 5, IST(2026, 12, 1, 0, 10));   // her Nov 30 shift, after midnight
  let mo = await F.month(MO, "2026-11"), r = await F.T(() => MO("stack.lock", { month: "2026-11" }));
  ok("U-02: at 00:30 on Dec 1 November is still under way for Mona (night shifts at work): no Lock, and a lock is refused", mo.current && !mo.over && !mo.can_lock && !r.ok && r.status === 400, { current: mo.current, can_lock: mo.can_lock, r });
  ok("U-02: the refusal says when: from Dec 1, 9:00 AM India time (the 22:30 to 07:30 shift's day ends then)", !r.ok && /November 2026 can be locked once it is over, from Dec 1, 9:00 AM India time/.test(r.e), r.e);
  await F.work("Nia Night", D(11, 30), 3, IST(2026, 12, 1, 2, 0));   // she works on until 03:30
  await F.work("Nora Late", D(11, 30), 4, IST(2026, 12, 1, 6, 0));    // and Nora until 07:30
  F.clock(IST(2026, 12, 1, 4, 59));
  r = await F.T(() => MK("stack.lock", { month: "2026-11" }));
  ok("U-02: at 04:59 a day-shift team (Mark's) still waits for Shastra's day: from Dec 1, 5:00 AM", !r.ok && /from Dec 1, 5:00 AM India time/.test(r.e) && !(await F.month(MK, "2026-11")).can_lock, r);
  F.clock(IST(2026, 12, 1, 5, 0));
  const mk = await F.month(MK, "2026-11"); r = await F.T(() => MK("stack.lock", { month: "2026-11" }));
  ok("U-02: at 05:00 Mark's November is over and locks", mk.over && !mk.current && mk.can_lock && r.ok && r.r.people === 1, r);
  mo = await F.month(MO, "2026-11"); r = await F.T(() => MO("stack.lock", { month: "2026-11" }));
  ok("U-02: at 05:00 Mona's still waits for the 22:30 to 07:30 shift: no Lock until 9:00 AM", !mo.can_lock && !r.ok && /from Dec 1, 9:00 AM/.test(r.e), r);
  F.clock(IST(2026, 12, 1, 9, 0));
  mo = await F.month(MO, "2026-11"); r = await F.T(() => MO("stack.lock", { month: "2026-11" }));
  ok("U-02: at 09:00 Mona's November is over and locks: 2 teams, 3 people", mo.can_lock && r.ok && r.r.locked === 2 && r.r.people === 3, r);
  F.clock(IST(2026, 12, 1, 15, 0));
  const locked = await F.month(MO, "2026-11"), ts = await F.ts(MO, D(11, 1), D(11, 30));
  for (const n of ["Nia Night", "Nora Late", "Arun Agent"]) {
    const a = F.row(locked, n), t = ts.rows.find((x) => x.name === n);
    ok(`U-02: the locked November has ${n}'s whole last day: ${a.achieved} done of ${a.expected}, as Team status (${t.count_done} of ${t.target_done})`, a.locked && a.achieved === t.count_done && a.expected === t.target_done && a.working === 21, { stack: [a.achieved, a.expected], ts: [t.count_done, t.target_done] });
  }
  ok("U-02: Nia's night shift counts to the day it began: 218 of 210 (10 a day, and 8 after midnight on Nov 30)", F.row(locked, "Nia Night").achieved === 218 && F.row(locked, "Nia Night").expected === 210, F.row(locked, "Nia Night").achieved);
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-01: someone who changes team lead between two locks of one month has exactly one row in it");
{
  const base = (moLead, moProject) => [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-B1", "Bela Agent", "Leo Lead", LAKE), AS("PHC-C1", "Zed Agent", "Lila Lead", HARBOR),
    AS("PHC-C2", "Mo Mover", moLead, moProject)];
  const rowsOf = presentAll(["PHC-A1", "PHC-B1", "PHC-C1", "PHC-C2"]);
  const setUp = async (from, to) => {
    const F = await floor({ feed: base(...from), floorRows: rowsOf });
    const X = { F, MO: await F.who("Mona Manager"), MK: await F.who("Mark Manager"), TI: await F.who("Tina Lead"), LI: await F.who("Lila Lead"), MOVER: await F.who("Mo Mover") };
    for (const n of ["Arun Agent", "Bela Agent", "Zed Agent", "Mo Mover"]) await F.work(n, D(10, 5), 200);
    X.first = await X.MO("stack.lock", { month: "2026-10" });            // Mona locks her two teams
    F.st.feed = F.st.feed.map((f) => (f.name === "Mo Mover" ? { ...f, reports_to: to[0], project: to[1] } : f)); await F.sync();   // then the roster moves Mo
    return X;
  };
  // (a) Mo was on Lila's team (Mark's) and moves to Tina's, after Mona locked Tina's
  let X = await setUp(["Lila Lead", HARBOR], ["Tina Lead", SUN]), F = X.F;
  let r = await F.T(() => X.MK("stack.lock", { month: "2026-10" }));
  ok("U-01: moved into a locked team: Mark's lock saves his own team only (Mo is not in his span any more)", r.ok && r.r.locked === 1 && r.r.people === 1, r);
  let mo = await F.month(X.MO, "2026-10"), moRow = F.row(mo, "Mo Mover");
  ok("U-01: Mona sees Mo as a draft row under Tina's team, in no snapshot: open to type, and Lock is offered again", moRow && !moRow.locked && moRow.can_edit && moRow.lead_name === "Tina Lead" && mo.can_lock && mo.lockable === 1, { row: moRow && [moRow.locked, moRow.can_edit, moRow.lead_name], can_lock: mo.can_lock, lockable: mo.lockable });
  ok("U-01: her chip is a draft: 2 of 3 locked (Tina's and Leo's teams, and Mo on his own still to lock)", mo.lock.locked === 2 && mo.lock.teams === 3, mo.lock);
  ok("U-01: with Mo still a draft, her page opens on October, not November", (await X.MO("stack.month", {})).month === "2026-10");
  r = await F.save(X.TI, "2026-10", "Mo Mover", "pkt", "97");
  ok("U-01: Tina can type Mo's PKT (it is no longer refused as locked)", r.ok, r);
  ok("U-01: Tina's locked team lead row is as it was locked (Arun only), Mo is not counted in it", F.tl(mo, "Tina Lead").locked && F.tl(mo, "Tina Lead").team_n === 1, F.tl(mo, "Tina Lead"));
  r = await F.T(() => X.MO("stack.lock", { month: "2026-10" }));
  ok("U-01: Mona locks again: Mo on his own, 1 person", r.ok && r.r.locked === 1 && r.r.people === 1, r);
  let ad = await F.month(F.AD, "2026-10");
  const ours = (d) => d.rows.filter((x) => /^PHC-/.test(x.emp_id));
  ok("U-01: the admin sees our 4 people's rows for October, Mo once and locked, with the PKT typed", ours(ad).length === 4 && ours(ad).every((x) => x.locked) && ad.rows.filter((x) => x.name === "Mo Mover").length === 1 && F.row(ad, "Mo Mover").pkt === 0.97, ours(ad).map((x) => [x.name, x.locked]));
  let mine = await X.MOVER("stack.mine", {});
  ok("U-01: Mo's My stack has October", mine.months.length === 1 && mine.months[0].month === "2026-10" && mine.months[0].row.id === F.U("Mo Mover").id, mine.months.map((m) => m.month));
  r = await F.T(() => X.MO("stack.lock", { month: "2026-10" })); ok("U-01: nothing is left to lock", !r.ok && /already locked/.test(r.e), r);
  ok("U-01: and her page now opens on November", (await X.MO("stack.month", {})).month === "2026-11");
  // (b) Mo was on Tina's team (locked with it) and moves to Lila's (Mark's)
  X = await setUp(["Tina Lead", SUN], ["Lila Lead", HARBOR]); F = X.F;
  let mk = await F.month(X.MK, "2026-10");
  ok("U-01: moved out of a locked team: Mark sees Mo's row as locked with Tina's team, and Lila's draft team without him", F.row(mk, "Mo Mover").locked && F.row(mk, "Mo Mover").lead_name === "Tina Lead" && F.tl(mk, "Lila Lead").team_n === 1 && !F.tl(mk, "Lila Lead").locked, { mo: F.row(mk, "Mo Mover").lead_name, lila: F.tl(mk, "Lila Lead").team_n });
  r = await F.save(X.LI, "2026-10", "Mo Mover", "pkt", "90");
  ok("U-01: Mo's October stays locked for his new team lead too", !r.ok && /October 2026 is locked for Mo Mover/.test(r.e), r);
  r = await F.T(() => X.MK("stack.lock", { month: "2026-10" }));
  ok("U-01: Mark's lock saves Lila's team with Zed only: Mo is not locked twice", r.ok && r.r.locked === 1 && r.r.people === 1, r);
  ad = await F.month(F.AD, "2026-10");
  ok("U-01: the admin sees our 4 people's rows, Mo once; the teams are Tina 2 (as locked), Leo 1, Lila 1", ad.rows.filter((x) => /^PHC-/.test(x.emp_id)).length === 4 && ad.rows.filter((x) => x.name === "Mo Mover").length === 1
    && ad.tls.map((t) => t.name.split(" ")[0] + " " + t.team_n).sort().join(", ") === "Leo 1, Lila 1, Tina 2", ad.tls.map((t) => [t.name, t.team_n]));
  mine = await X.MOVER("stack.mine", {}); ok("U-01: Mo's My stack has October once", mine.months.length === 1, mine.months.length);
  // extra production follows the same rule: a month is locked for a person once their row is in a snapshot of it
  const xfile = (rowsIn) => F.read(F.xlsx([["S", [["DOW", "Emp ID", "User Name"], ...rowsIn]]]), "Extra October.xlsx");
  const pv = await X.LI("stack.extraPreview", F.body(xfile(rep(3, [serial(D(10, 20)), "PHC-C2", "Mo Mover"])), { month: "2026-10" }));
  ok("U-01: extra production for October is not counted for Mo (locked with Tina's team)", pv.counted === 0 && pv.left_out.locked.length === 1, { counted: pv.counted, locked: pv.left_out.locked });
}
{
  // (a) again, for extra production: Mo moved into Tina's locked team, in no snapshot: his October is still a draft
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-C2", "Mo Mover", "Lila Lead", HARBOR)];
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-C2"]) });
  const MO = await F.who("Mona Manager"), TI = await F.who("Tina Lead");
  await F.work("Arun Agent", D(10, 5), 200); await F.work("Mo Mover", D(10, 5), 200);
  await MO("stack.lock", { month: "2026-10" });
  F.st.feed = feed.map((f) => (f.name === "Mo Mover" ? { ...f, reports_to: "Tina Lead", project: SUN } : f)); await F.sync();
  const file = F.read(F.xlsx([["S", [["DOW", "Emp ID", "User Name"], ...rep(3, [serial(D(10, 20)), "PHC-C2", "Mo Mover"]), ...rep(2, [serial(D(10, 20)), "PHC-A1", "Arun Agent"])]]]), "Extra October.xlsx");
  const pv = await TI("stack.extraPreview", F.body(file, { month: "2026-10" }));
  ok("U-01: extra production: Mo's 3 October rows count (his October is a draft), Arun's 2 do not (locked)", pv.counted === 3 && pv.lines.length === 1 && pv.lines[0].person === "Mo Mover" && pv.left_out.locked[0].rows === 2, { counted: pv.counted, locked: pv.left_out.locked });
  await TI("stack.extraSave", F.body(file, { month: "2026-10" }));
  const moRow = F.row(await F.month(MO, "2026-10"), "Mo Mover");
  ok("U-01: and they show in Mo's draft October row: 203 done, incl. 3 extra", moRow && !moRow.locked && moRow.achieved === 203 && moRow.extra === 3, moRow && [moRow.achieved, moRow.extra]);
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-14: the month list says locked for a viewer only when everyone they see on the month is locked");
{
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-B1", "Bela Agent", "Leo Lead", LAKE), AS("PHC-C1", "Zed Agent", "Lila Lead", HARBOR),
    AS("PHC-A9", "Jo Joiner", "Tina Lead", SUN, { doj: D(11, 3) })];
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-B1", "PHC-C1"]) });
  const MO = await F.who("Mona Manager"), MK = await F.who("Mark Manager"), LI = await F.who("Lila Lead"), TI = await F.who("Tina Lead");
  for (const n of ["Arun Agent", "Bela Agent", "Zed Agent"]) await F.work(n, D(10, 5), 200);
  const oct = (d) => d.months.find((m) => m.month === "2026-10");
  await MO("stack.lock", { month: "2026-10" });   // Mona locks her teams; Mark's is still a draft
  let mk = await F.month(MK, "2026-10"), li = await F.month(LI, "2026-10"), mo = await F.month(MO, "2026-10"), ti = await F.month(TI, "2026-10"), ad = await F.month(F.AD, "2026-10");
  ok("U-14: Mark's month list does not say October is locked: none of his team is (his page offers Lock October)", !oct(mk).locked && !oct(mk).partly && mk.can_lock, oct(mk));
  ok("U-14: nor Lila's (his team lead)", !oct(li).locked && !oct(li).partly, oct(li));
  ok("U-14: Mona's and Tina's say locked (a joiner of November is not on October)", oct(mo).locked && oct(ti).locked, [oct(mo), oct(ti)]);
  ok("U-14: the admin's says partly locked", !oct(ad).locked && oct(ad).partly, oct(ad));
  ok("U-14: November is not locked for anyone", [mk, mo, ad].every((d) => { const n = d.months.find((m) => m.month === "2026-11"); return !n.locked && !n.partly; }));
  await MK("stack.lock", { month: "2026-10" });
  mk = await F.month(MK, "2026-10");
  ok("U-14: once Mark locks, his list says locked too", oct(mk).locked, oct(mk));
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-11: a leaver who never signed in stays for the Stack report: counted in the attrition, typed values kept");
{
  // on Tina's team: Paula (Posting: her numbers are typed), Jay (AR, joined in October, no work in Brahmastra), Xena (AR, only
  // extra production), Old Ola (left long ago), and Gil, who an old roster file brought in (not in Shastra any more)
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-A10", "Paula Poster", "Tina Lead", SUN, { department: "Posting" }),
    AS("PHC-A11", "Jay Joiner", "Tina Lead", SUN, { doj: D(10, 6) }), AS("PHC-A12", "Xena Extra", "Tina Lead", SUN), AS("PHC-A13", "Old Ola", "Tina Lead", SUN), AS("PHC-A14", "Gil Ghost", "Tina Lead", SUN)];
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-A10", "PHC-A11", "PHC-A12"]), now: IST(2026, 10, 15, 15) });
  const TI = await F.who("Tina Lead"), MO = await F.who("Mona Manager");
  await F.work("Arun Agent", D(10, 5), 200);
  for (const [f, v] of [["achieved", "180"], ["expected", "200"], ["pkt", "95"], ["quality", "97"]]) await F.save(TI, "2026-10", "Paula Poster", f, v);
  const xr = F.read(F.xlsx([["S", [["DOW", "User Name"], ...rep(4, [serial(D(10, 8)), "Xena Extra"])]]]), "Extra production Oct.xlsx");
  await TI("stack.extraSave", F.body(xr, { month: "2026-10" }));
  const ids = Object.fromEntries(["Paula Poster", "Jay Joiner", "Xena Extra", "Old Ola", "Gil Ghost"].map((n) => [n, F.id(n)]));
  // the next roster syncs: Paula, Jay and Xena resign in October; Old Ola's exit date is typed in Shastra late (Sep 2025); Gil is gone from Shastra
  F.clock(IST(2026, 10, 28, 9));
  F.st.feed = feed.filter((f) => f.name !== "Gil Ghost").map((f) => (f.name === "Paula Poster" ? { ...f, status: "Resigned", exit_date: D(10, 20) } : f.name === "Jay Joiner" ? { ...f, status: "Resigned", exit_date: D(10, 24) }
    : f.name === "Xena Extra" ? { ...f, status: "Resigned", exit_date: null } : f.name === "Old Ola" ? { ...f, status: "Resigned", exit_date: "2025-09-30" } : f));
  await F.sync();
  F.clock(IST(2026, 11, 16, 15));
  const kept = async (n) => (await F.rows("SELECT id, active FROM users WHERE id = ?", ids[n]))[0];
  ok("U-11: Paula (Posting, never signed in, typed values) is kept, switched off, with her 4 typed values", (await kept("Paula Poster")) && !(await kept("Paula Poster")).active
    && (await F.rows("SELECT field FROM stack_typed WHERE subject_id = ?", ids["Paula Poster"])).length === 4);
  ok("U-11: Jay (an AR joiner with no work in Brahmastra, exit date Oct 24) is kept for the attrition", !!(await kept("Jay Joiner")));
  ok("U-11: Xena (only extra production, Resigned with no exit date) is kept, her extra production with her", !!(await kept("Xena Extra")) && (await F.rows("SELECT 1 FROM extra_lines WHERE user_id = ?", ids["Xena Extra"])).length > 0);
  ok("U-11: Old Ola (left in Sep 2025, beyond the report's 13 months, nothing of hers kept) is removed, as before", !(await kept("Old Ola")));
  ok("U-11: Gil (gone from Shastra, never a leaver there, no work) is removed, as before", !(await kept("Gil Ghost")));
  const tina = F.tl(await F.month(MO, "2026-10"), "Tina Lead");
  ok("U-11: October's team lead stack counts Tina's 3 leavers (attrition 3: score 0)", tina.attrition === 3 && tina.s.attr === 0 && tina.left.map((x) => x.name).sort().join() === "Jay Joiner,Paula Poster,Xena Extra", { n: tina.attrition, who: tina.left, s: tina.s.attr });
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-03: typed Stack values are in the audit trail: typed, typed over and cleared, with the old and the new value");
{
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-A10", "Paula Poster", "Tina Lead", SUN, { department: "Posting" })];
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-A10"]) });
  const MO = await F.who("Mona Manager"), TI = await F.who("Tina Lead");
  await F.work("Arun Agent", D(10, 5), 200);
  const steps = [[TI, "Arun Agent", "pkt", "100"], [TI, "Arun Agent", "tp", "no", "Did not help the team"], [TI, "Arun Agent", "tp", "no", "Did not help with the backlog"], [MO, "Tina Lead", "th1", "yes"],
    [MO, "Arun Agent", "pkt", "50"], [MO, "Arun Agent", "pkt", "50"], [MO, "Arun Agent", "pkt", ""], [TI, "Arun Agent", "tp", ""], [TI, "Paula Poster", "achieved", "180"], [TI, "Arun Agent", "quality", "98.999"]];
  for (const [X, n, f, v, note] of steps) { const r = await F.save(X, "2026-10", n, f, v, note); if (!r.ok) console.log("  save refused", n, f, v, r.e); }
  const aud = (await F.rows("SELECT user_name, detail FROM audit_log WHERE action = 'stack.save' ORDER BY at, rowid")).map((x) => x.user_name + ": " + x.detail);
  const want = [
    "Tina Lead: October 2026, Arun Agent: PKT score empty → 100%",
    'Tina Lead: October 2026, Arun Agent: Team player Yes (as it starts) → No: "Did not help the team"',
    'Tina Lead: October 2026, Arun Agent: Team player No → No: "Did not help with the backlog"',
    'Mona Manager: October 2026, Tina Lead: tick "4 Quality sessions, with email" not ticked → Yes',
    "Mona Manager: October 2026, Arun Agent: PKT score 100% → 50% (100% was typed by Tina Lead)",
    "Mona Manager: October 2026, Arun Agent: PKT score 50% → cleared",
    "Tina Lead: October 2026, Arun Agent: Team player No → Yes",
    "Tina Lead: October 2026, Paula Poster: Achieved empty → 180",
    "Tina Lead: October 2026, Arun Agent: Quality % empty → 98.99%",
  ];
  ok("U-03: each typed value is one audit line with who, the old and the new value (the same value typed again adds none)", JSON.stringify(aud) === JSON.stringify(want), aud);
  const list = (await F.AD("audit.list", { action: "stack" })).rows;
  ok("U-03: the audit trail's Stack report choice lists them (with the admin's filter)", list.filter((x) => x.action === "stack.save").length === want.length, list.length);
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-12: the Team player reason is never cut: over 200 characters it is refused with a message naming the box");
{
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN)];
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1"]) });
  const TI = await F.who("Tina Lead");
  await F.work("Arun Agent", D(10, 5), 200);
  const long = "Helped the team clear the backlog every day this month. ".repeat(5).trim();   // 279 characters
  let r = await F.save(TI, "2026-10", "Arun Agent", "tp", "no", long);
  ok("U-12: a 279-character reason is refused, nothing saved: \"The reason is too long: 279 characters, and it takes up to 200. Shorten it.\"", !r.ok && r.e === "The reason is too long: 279 characters, and it takes up to 200. Shorten it."
    && !(await F.rows("SELECT 1 FROM stack_typed WHERE field = 'tp'")).length, r);
  r = await F.save(TI, "2026-10", "Arun Agent", "tp", "no", long.slice(0, 200));
  ok("U-12: 200 characters are taken whole", r.ok && (await F.rows("SELECT note FROM stack_typed WHERE field = 'tp'"))[0].note === long.slice(0, 200), r);
  const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("U-12: the page's reason box has no maxLength (it counts the characters with TextLimit instead), nor the team task's name", /<Field label="Reason \(optional\)"><input className="input" type="text" value=\{v2\}[^\n]*<TextLimit v=\{v2\} max=\{STACK_NOTE_MAX\} \/>/.test(src)
    && /placeholder="What is to be done, in a few words" \/><TextLimit v=\{f\.title\} max=\{160\} \/>/.test(src));
}

// ---------------------------------------------------------------------------------------------------------------------------
S("U-08: a file counted before by a manager: the check says what stays counted for people the uploader does not see");
{
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), AS("PHC-B1", "Bela Agent", "Leo Lead", LAKE)];
  const NOV = dayList(D(11, 2), D(11, 13)).filter(isWeekday);
  const F = await floor({ feed, floorRows: presentAll(["PHC-A1", "PHC-B1"], NOV), holidays: [] });
  const TI = await F.who("Tina Lead"), MO = await F.who("Mona Manager"), LE = await F.who("Leo Lead");
  const bela = F.U("Bela Agent"), arun = F.U("Arun Agent");
  const fileOf = (nov5, nov12) => F.read(F.xlsx([["Both", [["DOW", "Emp ID", "User Name"], ...rep(2, [serial(D(11, 10)), "PHC-A1", "Arun Agent"]), ...rep(nov5, [serial(D(11, 5)), "PHC-B1", "Bela Agent"]),
    ...rep(nov12, [serial(D(11, 12)), "PHC-B1", "Bela Agent"])]]]), "Both teams.xlsx");
  await MO("stack.extraSave", F.body(fileOf(4, 0), { item: "both" }));   // the manager counts it: Bela 4 on Nov 5
  // the file in OneDrive gains 3 rows for Bela on Nov 12 and 1 more on Nov 5; Tina loads it for her team
  const pv = await TI("stack.extraPreview", F.body(fileOf(5, 3), { item: "both" }));
  const there = pv.left_out.elsewhere.find((x) => x.name === "Bela Agent"), fresh = (pv.left_out.elsewhere_new || []).find((x) => x.name === "Bela Agent");
  ok("U-08: Tina's check says Bela's 4 rows stay counted there (what the manager's upload counts), not the file's 8", there && there.rows === 4, pv.left_out.elsewhere);
  ok("U-08: and names the 4 rows the file gained since (Nov 12's 3 and one more on Nov 5) apart: counted for nobody until Bela's team lead or a manager loads it", fresh && fresh.rows === 4, pv.left_out.elsewhere_new);
  ok("U-08: Left out is still all 8 of Bela's rows of the file; To count Arun's 2", pv.left_out.rows === 8 && pv.counted === 2, { left: pv.left_out.rows, counted: pv.counted });
  await TI("stack.extraSave", F.body(fileOf(5, 3), { item: "both" }));
  let ts = await F.ts(MO, D(11, 1), D(11, 16)), ex = (u) => (ts.rows.find((r) => r.id === u.id) || {}).extra;
  ok("U-08: what the check said is what Team status counts: Bela 4, Arun 2", ex(bela) === 4 && ex(arun) === 2, { bela: ex(bela), arun: ex(arun) });
  const lv = await LE("stack.extraPreview", F.body(fileOf(5, 3), { item: "both" }));
  ok("U-08: Leo loads it: Bela's 8 count for him; Arun's 2 stay counted for Tina's Arun (2 rows there), nothing new", lv.counted === 8 && lv.left_out.elsewhere.length === 1 && lv.left_out.elsewhere[0].name === "Arun Agent"
    && lv.left_out.elsewhere[0].rows === 2 && !lv.left_out.elsewhere_new.length, { counted: lv.counted, left: lv.left_out });
  await LE("stack.extraSave", F.body(fileOf(5, 3), { item: "both" }));
  ts = await F.ts(MO, D(11, 1), D(11, 16));
  ok("U-08: Team status: Bela 8, Arun 2, nothing twice", ex(bela) === 8 && ex(arun) === 2, { bela: ex(bela), arun: ex(arun) });
}

// ---------------------------------------------------------------------------------------------------------------------------
const passed = results.filter((x) => x.pass).length, failed = results.length - passed;
console.log(`\n==== ${passed} passed, ${failed} failed of ${results.length}`);
process.exit(failed ? 1 : 0);
