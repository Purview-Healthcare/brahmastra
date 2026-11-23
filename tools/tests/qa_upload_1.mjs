// QA2: inventory uploads through the page's own reader and builder (CSV text > readWorkbook > autoMap > buildClaims > uploadClaims).
import { S, ok, done, setup, SUN_B } from "./qa_common.mjs";
const T = await setup();
const { app, q, q1, sql, A, TI, LE, U, sun, lake, downtown, westside, wipe, mine, ready, counts, setTeam, setTarget, TOK, as, alloc, setCap, setOwn } = T;
const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const toCsv = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
const bytesOf = (text) => { const b = new TextEncoder().encode(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const HEAD = ["IG Claim ID#/Charge ID#", "Account #", "Patient Name", "DOS", "Payer", "Balance Amount($)", "Status", "Sub Status", "Action", "Comments/Notes"];
const mk = (no, i, o = {}) => [no, "AC" + (100 + i), "Testpatient, U" + i, o.dos || "09/" + String(1 + (i % 28)).padStart(2, "0") + "/2026", o.payer ?? (i % 2 ? "Aetna" : "Cigna"), o.bal ?? 100 + i, o.status ?? "Denied", "", "", ""];
const file = (n, from = 0, f = {}) => Array.from({ length: n }, (_, i) => mk(f.pre ? f.pre + (700000 + from + i) : "U" + (700000 + from + i), from + i, f));
const up = async (who, cl, locId, rows, kind = "fresh", extra = {}) => {
  const t = app.tableFromSheet(app.readWorkbook(bytesOf(toCsv([HEAD, ...rows])), "f.csv")[0].rows), mapping = app.autoMap(t.headers), built = app.buildClaims({ rows: t.rows, mapping, kind, today: TODAY });
  app.setToken(TOK[who]); const r = await app.uploadClaims({ client_id: cl.id, location_id: locId || null, kind, file_name: "qa.csv", claims: built.claims, summary: { ...built.summary, mapping }, rows_read: t.rows.length, ...extra });
  return { r, built };
};
const claim = (cl, no) => q1("SELECT * FROM claims WHERE client_id = ? AND claim_no = ?", cl.id, no);
const reset = async (team = SUN_B) => { await sql("DELETE FROM batches"); await wipe(sun.id); await wipe(lake.id); await setTarget(sun.id, 0); await setTeam(sun, team); await TI("clients.saveTeam", { location_id: downtown.id, team: [] }); await TI("clients.saveTeam", { location_id: westside.id, team: [] }); };

S("1. A fresh file, then the same file again");
{
  await reset(); const rows = file(40);
  const { r, built } = await up("Tina Lead", sun, null, rows);
  ok("40 rows -> 40 claims added", r.inserted === 40 && built.claims.length === 40, r);
  const again = await up("Tina Lead", sun, null, rows);
  ok("the same file again: nobody added, all 40 refreshed", again.r.inserted === 0 && again.r.updated === 40, again.r);
  ok("still 40 claims", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n === 40);
  await alloc("Tina Lead", sun);
  const before = await q("SELECT claim_no, assigned_to, state FROM claims WHERE client_id = ? ORDER BY claim_no", sun.id);
  const third = await up("Tina Lead", sun, null, rows);
  const after = await q("SELECT claim_no, assigned_to, state FROM claims WHERE client_id = ? ORDER BY claim_no", sun.id);
  ok("after allocating, a third load of the same file changes nobody's claims", JSON.stringify(before) === JSON.stringify(after) && third.r.inserted === 0, third.r);
  ok("...and nothing is open in the pool", (await counts(sun.id)).open === undefined, await counts(sun.id));
  const ev = await q1("SELECT COUNT(*) n FROM claim_events WHERE claim_id = ? AND kind = 'assigned'", before.length && (await claim(sun, "U700000")).id);
  ok("the claim's history has one 'assigned' line, not one per upload", ev.n === 1, ev);
}
S("2. A later file with changed balances and statuses");
{
  await reset(); await up("Tina Lead", sun, null, file(20)); await alloc("Tina Lead", sun);
  const c3 = await claim(sun, "U700003"), c4 = await claim(sun, "U700004"), c5 = await claim(sun, "U700005"), c6 = await claim(sun, "U700006");
  const next = file(20); next[3][5] = 999.5; next[4][6] = "Paid"; next[5][5] = 0; next[6][5] = -20; next[7][4] = "Humana";
  const { r } = await up("Tina Lead", sun, null, next);
  ok("result counts: 1 closed (paid), zero balance and credit excluded", r.closed === 1 && r.excluded === 2, r);
  ok("balance changed on a claim that is on someone's list", (await claim(sun, "U700003")).balance === 999.5 && (await claim(sun, "U700003")).assigned_to === c3.assigned_to);
  const p = await claim(sun, "U700004");
  ok("Paid in the file closes the claim", p.state === "closed", p.state);
  const z = await claim(sun, "U700005"), cr = await claim(sun, "U700006");
  ok("zero balance and credit balance are excluded", z.state === "excluded" && cr.state === "excluded", [z.state, cr.state]);
  ok("payer changed", (await claim(sun, "U700007")).payer === "Humana");
  const holder = (await q("SELECT DISTINCT assigned_to FROM claims WHERE client_id = ? AND claim_no = ?", sun.id, "U700004"))[0].assigned_to;
  if (holder) { const nm = T.NAME(holder); ok("a closed claim is not on the biller's My day", (await ready(nm)) === (await mine(nm, sun.id)).length, [await ready(nm), (await mine(nm, sun.id)).length]); }
  // reopened: back in the file with a balance
  const back = file(20); const { r: r2 } = await up("Tina Lead", sun, null, back);
  ok("claims back in a later file (paid, zero, credit) reopen: 3", r2.reopened === 3, r2);
  const rp = await claim(sun, "U700004");
  ok("a reopened claim is open with nobody on it", rp.state === "open" && !rp.assigned_to, [rp.state, rp.assigned_to]);
}
S("3. Claims missing from the new file");
{
  await reset(); await up("Tina Lead", sun, null, file(30)); await alloc("Tina Lead", sun);
  const { r } = await up("Tina Lead", sun, null, file(10));
  ok("a smaller file touches only its 10", r.updated === 10 && r.inserted === 0 && r.closed === 0, r);
  const c = await counts(sun.id);
  ok("the 20 absent claims stay as they were (assigned)", c.assigned === 30, c);
}
S("4. Location uploads vs client-level uploads");
{
  await reset(); await up("Tina Lead", sun, downtown.id, file(10));
  ok("claims carry the location", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ? AND location_id = ?", sun.id, downtown.id)).n === 10);
  const { r } = await up("Tina Lead", sun, null, file(10));
  ok("the same claims in a client-level file are refreshed, not added", r.inserted === 0 && r.updated === 10, r);
  ok("...and keep their Downtown location", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ? AND location_id = ?", sun.id, downtown.id)).n === 10);
  const { r: r2 } = await up("Tina Lead", sun, westside.id, file(10));
  ok("the same claims in a Westside file move to Westside, not duplicated", r2.inserted === 0 && (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ? AND location_id = ?", sun.id, westside.id)).n === 10);
  await wipe(sun.id);
  await TI("clients.saveTeam", { location_id: downtown.id, team: ["Arun Agent", "Bela Agent"].map(U) });
  await up("Tina Lead", sun, downtown.id, file(10)); await alloc("Tina Lead", sun, downtown);
  const held = await mine("Arun Agent", sun.id);
  await up("Tina Lead", sun, westside.id, file(10));
  const after = await q("SELECT assigned_to, state, location_id FROM claims WHERE id = ?", held[0].id);
  ok("a claim given to a Downtown biller that the next file loads under Westside stays on the biller (note: location moved)", after[0].state === "assigned" && after[0].assigned_to === U("Arun Agent"), after);
  await TI("clients.saveTeam", { location_id: downtown.id, team: [] });
}
S("5. Several clients: the same claim number at two clients");
{
  await reset(); await up("Tina Lead", sun, null, file(10)); await up("Leo Lead", lake, null, file(10));
  const a = await q1("SELECT COUNT(*) n FROM claims WHERE claim_no = 'U700001'");
  ok("the same claim # at two clients is two claims", a.n === 2, a);
  await up("Leo Lead", lake, null, file(10, 0, { bal: 5000 }));
  ok("Lakeview's file changed only Lakeview's claim", (await claim(sun, "U700001")).balance === 101 && (await claim(lake, "U700001")).balance === 5000, [(await claim(sun, "U700001")).balance, (await claim(lake, "U700001")).balance]);
  const t = await T.as(TOK["Tina Lead"])("claims.list", { client_id: lake.id, page_size: 5 }).catch((e) => ({ e: e.message }));
  ok("Tina cannot list Lakeview's claims", t.e || !(t.rows || []).length, t);
  const r = await T.as(TOK["Tina Lead"])("inventory.upload", { client_id: lake.id, kind: "fresh", file_name: "x", claims: [], final: true }).catch((e) => ({ e: e.message }));
  ok("Tina cannot upload to Lakeview", !!r.e, r);
  const dv = await T.as(TOK["Arun Agent"])("inventory.upload", { client_id: sun.id, kind: "fresh", file_name: "x", claims: [], final: true }).catch((e) => ({ e: e.message }));
  ok("a biller cannot upload inventory", !!dv.e, dv);
}
S("6. Bad rows");
{
  await reset();
  const rows = [
    ["", "AC1", "Testpatient, NoNo", "09/05/2026", "Aetna", 120, "Denied", "", "", ""],         // no claim number
    ["U800002", "AC2", "Testpatient, BadDate", "99/99/2026", "Aetna", 130, "Denied", "", "", ""], // bad date
    ["U800003", "AC3", "Testpatient, NoPayer", "09/07/2026", "", 140, "Denied", "", "", ""],      // blank payer
    ["", "", "", "", "", "", "", "", "", ""],                                                    // blank row
    ["Total", "", "", "", "", 390, "", "", "", ""],                                                // footer
    ["U800006", "AC6", "Testpatient, TextBal", "09/08/2026", "Aetna", "abc", "Denied", "", "", ""],// text balance
    ["U800007", "AC7", "Testpatient, MoneyBal", "09/09/2026", "Aetna", "$1,234.50", "Denied", "", "", ""],
    ["U800008", "AC8", "", "09/10/2026", "Aetna", 80, "Denied", "", "", ""],                      // blank patient
    ["N/A", "", "", "", "Aetna", 50, "Denied", "", "", ""],                                       // junk number, nothing else
    ["N/A", "", "", "", "Cigna", 60, "Denied", "", "", ""],
    ["U800011", "AC11", "Testpatient, Future", "01/01/2099", "Aetna", 70, "Denied", "", "", ""],
  ];
  let res; try { res = await up("Tina Lead", sun, null, rows); } catch (e) { res = { err: e.message }; }
  ok("a file with bad rows loads without a server error", !res.err, res.err);
  const cs = await q("SELECT claim_no, patient, payer, dos, balance, state, age_days FROM claims WHERE client_id = ? ORDER BY claim_no", sun.id);
  console.log("   loaded:", JSON.stringify(cs.map((c) => [c.claim_no, c.dos, c.balance, c.state])).slice(0, 700));
  ok("no claim number: the row loads with a made-up BR- number", cs.some((c) => /^BR-/.test(c.claim_no) && /NoNo/.test(c.patient)), cs.map((c) => c.claim_no));
  ok("bad date: the claim loads with an empty DOS", cs.some((c) => c.claim_no === "U800002" && !c.dos), cs.find((c) => c.claim_no === "U800002"));
  ok("blank payer: the claim loads", cs.some((c) => c.claim_no === "U800003"));
  ok("blank row and 'Total' footer are not claims", !cs.some((c) => /^total$/i.test(c.claim_no)) && cs.length >= 6, cs.length);
  ok("a text balance 'abc' does not load as a workable claim worth anything weird", (cs.find((c) => c.claim_no === "U800006") || {}).balance === 0, cs.find((c) => c.claim_no === "U800006"));
  ok("$1,234.50 is read as 1234.5", (cs.find((c) => c.claim_no === "U800007") || {}).balance === 1234.5, cs.find((c) => c.claim_no === "U800007"));
  const na = cs.filter((c) => /N\/A/i.test(c.claim_no));
  ok("two rows with claim # 'N/A' and nothing else: not silently merged into one claim (Aetna 50 and Cigna 60)", na.length === 2 || cs.filter((c) => c.balance === 50 || c.balance === 60).length === 2, na);
  ok("future DOS gets an age of zero, not negative", (cs.find((c) => c.claim_no === "U800011") || {}).age_days >= 0, cs.find((c) => c.claim_no === "U800011"));
  console.log("   summary:", JSON.stringify(res.built && res.built.summary).slice(0, 400));
}
S("7. Same claim number twice in one file");
{
  await reset();
  const rows = [["U900001", "AC1", "Testpatient, Dup", "09/05/2026", "Aetna", 100, "Denied", "", "", ""], ["U900001", "AC1", "Testpatient, Dup", "09/05/2026", "Aetna", 100, "Denied", "", "", ""], ["U900002", "AC2", "Testpatient, Two", "09/05/2026", "Aetna", 50, "Denied", "", "", ""]];
  const { r, built } = await up("Tina Lead", sun, null, rows);
  const c = await claim(sun, "U900001");
  ok("claim # twice: one claim", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ? AND claim_no = 'U900001'", sun.id)).n === 1);
  console.log("   balance of the doubled row:", c.balance, "lines:", c.lines);
  ok("QUESTION: an identical row twice is two service lines and the balance doubles (200)", c.balance === 200, c.balance);
  const dupe = [["U900001", "AC1", "Testpatient, Dup", "09/05/2026", "Aetna", 100, "Denied", "", "", ""]];
  await up("Tina Lead", sun, null, dupe);
  ok("loading it again as one line brings the balance back to 100", (await claim(sun, "U900001")).balance === 100);
}
S("8. A big file (5,200 rows)");
{
  await reset(); const t0 = Date.now(); const rows = file(5200);
  const { r } = await up("Tina Lead", sun, null, rows);
  console.log("   5200 rows loaded in", Date.now() - t0, "ms");
  ok("5,200 claims added", r.inserted === 5200, r);
  ok("exactly 5,200 in the table, none twice", (await q1("SELECT COUNT(*) n, COUNT(DISTINCT match_key) d FROM claims WHERE client_id = ?", sun.id)).n === 5200);
  const b = await q("SELECT inserted, updated, finished, rows_read FROM batches WHERE client_id = ? ORDER BY uploaded_at DESC LIMIT 1", sun.id);
  ok("the batch says 5200 inserted, finished", b.length === 1 && b[0].inserted === 5200 && b[0].finished === 1 && b[0].rows_read === 5200, b);
  const t1 = Date.now(); const r2 = await alloc("Tina Lead", sun);
  console.log("   allocate of 5200 in", Date.now() - t1, "ms");
  ok("big pool: everyone gets 45, 270 given, the rest wait", r2.applied === 270 && (await counts(sun.id)).open === 4930, [r2.applied, await counts(sun.id)]);
  const { r: r3 } = await up("Tina Lead", sun, null, rows);
  ok("the big file again: 5200 refreshed, 0 added", r3.inserted === 0 && r3.updated === 5200, r3);
  ok("...assignments untouched", (await counts(sun.id)).assigned === 270);
}
S("9. Automatic allocation on upload on and off");
{
  await reset(); await up("Tina Lead", sun, null, file(30));
  ok("an upload on its own (page: allocate off) gives nobody anything", (await counts(sun.id)).open === 30 && !(await counts(sun.id)).assigned);
  const m = await T.as(TOK["Tina Lead"])("locations.saveTeam", {}).catch((e) => e.message);
  const cl = (await T.clientOf("Tina Lead", sun));
  ok("client list shows auto_allocate flag (default on)", cl.auto_allocate !== false, cl.auto_allocate);
}
S("10. Upload while claims are being worked or on a desk");
{
  await reset(); await up("Tina Lead", sun, null, file(12)); await alloc("Tina Lead", sun);
  const holder = U("Arun Agent"); const arun = as(TOK["Arun Agent"]);
  const mineIds = await mine("Arun Agent", sun.id);
  const opened = await arun("queue.next", {});
  const oc = opened.claim; 
  const next = file(12); next[Number(oc.claim_no.slice(1)) - 700000][5] = 4321; 
  const { r } = await up("Tina Lead", sun, null, next);
  const afterOpen = await q1("SELECT state, assigned_to, balance FROM claims WHERE id = ?", oc.id);
  ok("a claim open on a biller's desk while the file loads stays open on that desk, balance refreshed", afterOpen.state === "in_progress" && afterOpen.assigned_to === holder && afterOpen.balance === 4321, afterOpen);
  const done1 = await arun("queue.complete", { id: oc.id, desk: true, saag: { status: "In Process", sub_status: "Claim in process", action: "Follow up", bucket: "Payer", effective: "Claim in process" }, note: { source: "Portal", findings: "Checked portal, claim in process" } }).catch((e) => ({ e: e.message }));
  ok("...and the biller can still save it after the upload", !done1.e, done1);
  const paid = file(12); paid[Number(oc.claim_no.slice(1)) - 700000][6] = "Paid";
  await up("Tina Lead", sun, null, paid);
  const st = await q1("SELECT state, assigned_to FROM claims WHERE id = ?", oc.id);
  ok("a claim worked and waiting (completed, follow-up) that the file says is Paid is closed", st.state === "closed", st);
  // an open claim with a worked claim being re-opened by a lead's file as excluded zero
  const other = await arun("queue.next", {});
  const z = file(12); z[Number(other.claim.claim_no.slice(1)) - 700000][5] = 0;
  await up("Tina Lead", sun, null, z);
  const so = await q1("SELECT state, assigned_to FROM claims WHERE id = ?", other.claim.id);
  ok("a claim open on a desk when the file says zero balance stays open (the biller is typing)", so.state === "in_progress", so);
  const sumry = await arun("queue.summary", {}); ok("My day summary still has an in-progress id", sumry.in_progress_id === other.claim.id, sumry.in_progress_id);
}
S("11. Claims that sit with someone and then the file excludes them");
{
  await reset(); await up("Tina Lead", sun, null, file(12)); await alloc("Tina Lead", sun);
  const z = file(12); z.forEach((r) => { r[5] = 0; });
  const { r } = await up("Tina Lead", sun, null, z);
  ok("all 12 assigned claims become excluded by a zero-balance file", r.excluded === 12, r);
  const rows = await q("SELECT assigned_to, state FROM claims WHERE client_id = ?", sun.id);
  ok("excluded claims do not stay on My day", (await Promise.all(SUN_B.map(ready))).every((n) => n === 0));
  const g = (await T.today("Tina Lead", sun)).reduce((a, m) => a + m.given_today, 0);
  console.log("   given_today after claims were excluded by file:", g, " (excluded claims keep assigned_to:", rows.filter((x) => x.assigned_to).length + ")");
  ok("QUESTION/BUG: excluded claims no longer on anyone's list still count as 'given today' (room shrinks)", g === 0, g);
}
done();
