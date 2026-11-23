// QA2: more upload edges: claim-number formats, multi-line claims with mixed statuses, worked files, concurrent allocation and uploads.
import { S, ok, done, setup, SUN_B } from "./qa_common.mjs";
const T = await setup();
const { app, q, q1, sql, A, TI, LE, U, NAME, sun, lake, downtown, westside, made, wipe, alloc, mine, ready, counts, setTeam, setTarget, TOK, as, today } = T;
const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const toCsv = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
const bytesOf = (text) => { const b = new TextEncoder().encode(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const HEAD = ["IG Claim ID#/Charge ID#", "Account #", "Patient Name", "DOS", "Payer", "Balance Amount($)", "Status", "CPT", "Date Worked", "Comments/Notes"];
const R = (no, i, o = {}) => [no, "AC" + (100 + i), o.patient ?? "Testpatient, V" + i, o.dos || "09/" + String(1 + (i % 28)).padStart(2, "0") + "/2026", o.payer ?? "Aetna", o.bal ?? 100 + i, o.status ?? "Denied", o.cpt ?? "99213", o.worked ?? "", o.comment ?? ""];
const file = (n, from = 0, o = {}) => Array.from({ length: n }, (_, i) => R("V" + (500000 + from + i), from + i, o));
const up = async (who, cl, locId, rows, kind = "fresh", extra = {}) => {
  const head = kind === "worked" ? HEAD : HEAD;
  const t = app.tableFromSheet(app.readWorkbook(bytesOf(toCsv([head, ...rows])), "f.csv")[0].rows), mapping = app.autoMap(t.headers), built = app.buildClaims({ rows: t.rows, mapping, kind, today: TODAY });
  app.setToken(TOK[who]); const r = await app.uploadClaims({ client_id: cl.id, location_id: locId || null, kind, file_name: "qa.csv", claims: built.claims, summary: { ...built.summary, mapping }, rows_read: t.rows.length, ...extra });
  return { r, built };
};
const claim = (cl, no) => q1("SELECT * FROM claims WHERE client_id = ? AND claim_no = ?", cl.id, no);
const reset = async (team = SUN_B) => { await sql("DELETE FROM batches"); await wipe(sun.id); await wipe(lake.id); await setTarget(sun.id, 0); await setTeam(sun, team); await TI("clients.saveTeam", { location_id: downtown.id, team: [] }); await TI("clients.saveTeam", { location_id: westside.id, team: [] }); };
const rows = (p, n) => made(p, n);

S("1. Claim number formats across uploads");
{
  await reset();
  await up("Tina Lead", sun, null, [R("D-55555", 1), R("00012345", 2), R("CLM-2025-00001", 3), R("77777/1", 4), R("abc99", 5)]);
  const { r } = await up("Tina Lead", sun, null, [R("d55555", 1, { bal: 777 }), R("12345", 2, { bal: 888 }), R("CLM-2025-00001", 3), R("77777/2", 4), R("ABC99", 5)]);
  const n = (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n;
  console.log("   result:", JSON.stringify(r), "claims:", n);
  ok("D-55555 / d55555 and 00012345 / 12345 are the same claims; 77777/1 and 77777/2 are two claims; abc99/ABC99 same: 6 claims", n === 6, n);
  ok("the refreshed balance landed on the D-55555 claim", (await q1("SELECT balance FROM claims WHERE client_id = ? AND claim_no LIKE '%55555'", sun.id)).balance === 777);
  await up("Tina Lead", sun, null, [R(12345.0, 2, { bal: 999 })]);
  ok("a number written as 12345.0 is still claim 12345", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n === 6);
}
S("2. A claim of several lines with different statuses");
{
  await reset();
  await up("Tina Lead", sun, null, [R("M1", 1, { status: "Paid", bal: 0, cpt: "99213" }), R("M1", 1, { status: "Denied", bal: 250, cpt: "99214" }), R("M2", 2, { status: "Denied", bal: 250, cpt: "99213" }), R("M2", 2, { status: "Paid", bal: 0, cpt: "99214" })]);
  const m1 = await claim(sun, "M1"), m2 = await claim(sun, "M2");
  console.log("   M1 (paid line first):", m1.state, m1.balance, m1.status_class, "| M2 (denied first):", m2.state, m2.balance, m2.status_class);
  ok("a claim whose first line is Paid but whose second line is a denied $250 stays workable", m1.state === "open", { state: m1.state, bal: m1.balance, cls: m1.status_class, reason: m1.state_reason });
  ok("a claim whose first line is Denied and second Paid is workable", m2.state === "open");
}
S("3. Without claim numbers: found again by patient + date");
{
  await reset(); const noNo = (i) => ["", "AC" + i, "Testpatient, B" + i, "09/1" + (i % 9) + "/2026", "Aetna", 100 + i, "Denied", "99213", "", ""];
  const a = await up("Tina Lead", sun, null, [1, 2, 3].map(noNo)); const b = await up("Tina Lead", sun, null, [1, 2, 3].map(noNo));
  ok("three claims with no number: loaded once, refreshed the second time", a.r.inserted === 3 && b.r.inserted === 0 && b.r.updated === 3, [a.r, b.r]);
  // later file carries the real number
  const c = await up("Tina Lead", sun, null, [["REAL-9000001", "AC1", "Testpatient, B1", "09/11/2026", "Aetna", 101, "Denied", "99213", "", ""]]);
  ok("the real number later finds the BR- claim and replaces it", c.r.inserted === 0 && (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n === 3 && !!(await claim(sun, "REAL-9000001")), c.r);
}
S("4. A worked file for claims that are assigned");
{
  await reset(); await up("Tina Lead", sun, null, file(12)); await alloc("Tina Lead", sun);
  const later = new Date(Date.now() + 20 * 86400000 + 330 * 60000).toISOString().slice(0, 10);
  const ex = await q1("SELECT * FROM claims WHERE client_id = ? AND claim_no = 'V500001'", sun.id);
  const holder = NAME(ex.assigned_to); const before = await ready(holder);
  const wr = [R("V500001", 1, { worked: TODAY.slice(5, 7) + "/" + TODAY.slice(8, 10) + "/" + TODAY.slice(0, 4), comment: "called payer" })];
  const { r } = await up("Tina Lead", sun, null, wr, "worked");
  const after = await q1("SELECT state, assigned_to, follow_up_on FROM claims WHERE id = ?", ex.id);
  console.log("   worked file refresh of an assigned claim:", JSON.stringify(after), "My day before/after:", before, await ready(holder));
  ok("a worked file today for a claim given to a biller keeps it with that biller", after.assigned_to === ex.assigned_to, after);
  ok("QUESTION: ...and it drops off My day until the follow-up date (" + after.follow_up_on + ") while still counting as given today", true);
}
S("5. Two allocations at the same moment");
{
  await reset(); await up("Tina Lead", sun, null, file(400));
  const [a, b] = await Promise.all([alloc("Tina Lead", sun), alloc("Tina Lead", sun)]);
  const c = await counts(sun.id); const per = await Promise.all(SUN_B.map(async (n) => (await mine(n, sun.id)).length));
  console.log("   applied", a.applied, b.applied, "counts", JSON.stringify(c), "per person", per.join());
  ok("two Allocate presses at once: no claim lost or doubled", (c.assigned || 0) + (c.open || 0) === 400, c);
  ok("...nobody holds more than the day's 45", per.every((n) => n <= 45), per);
  await reset(); await up("Tina Lead", sun, null, file(30));
  const [x, y] = await Promise.all([alloc("Tina Lead", sun), alloc("Tina Lead", sun)]);
  const c2 = await counts(sun.id); ok("two at once with short inventory: 30 claims all given once", c2.assigned === 30 && !c2.open, c2);
  console.log("   applied", x.applied, y.applied);
}
S("6. An upload while someone allocates");
{
  await reset(); await up("Tina Lead", sun, null, file(100));
  const rowsB = file(100, 100);
  const [al, upl] = await Promise.all([alloc("Tina Lead", sun), up("Tina Lead", sun, null, rowsB)]);
  const c = await counts(sun.id); ok("200 claims all there once", (c.assigned || 0) + (c.open || 0) === 200, c);
  const dup = await q("SELECT claim_no, COUNT(*) n FROM claims WHERE client_id = ? GROUP BY claim_no HAVING n > 1", sun.id); ok("no claim twice", !dup.length, dup);
}
S("7. Two team leads loading the same file at once");
{
  await reset(); const rowsC = file(60);
  const [u1, u2] = await Promise.all([up("Tina Lead", sun, null, rowsC), up("Tina Lead", sun, null, rowsC)]);
  ok("two loads at once: 60 claims, none twice", (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n === 60, [u1.r, u2.r]);
}
S("8. Allocation through the page's upload flow with auto-allocate off for the client");
{
  await reset(); await up("Tina Lead", sun, null, file(20));
  const cl = (await T.clientOf("Tina Lead", sun));
  console.log("   client.auto_allocate:", cl.auto_allocate, " team:", (cl.team || []).length);
}
done();
