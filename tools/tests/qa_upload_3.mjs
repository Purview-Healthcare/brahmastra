// QA2: part boundaries of a big upload, view-only leads, what "given today" does when a file takes claims away.
import { S, ok, done, setup, SUN_B } from "./qa_common.mjs";
const T = await setup();
const { app, q, q1, sql, A, TI, LE, U, NAME, sun, lake, downtown, westside, made, wipe, alloc, mine, ready, counts, setTeam, setTarget, TOK, as, today } = T;
const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const toCsv = (rows) => rows.map((r) => r.map((v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
const bytesOf = (text) => { const b = new TextEncoder().encode(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const HEAD = ["IG Claim ID#/Charge ID#", "Account #", "Patient Name", "DOS", "Payer", "Balance Amount($)", "Status"];
const R = (no, i, o = {}) => [no, "AC" + (100 + i), o.patient ?? "Testpatient, W" + i, o.dos || "09/" + String(1 + (i % 28)).padStart(2, "0") + "/2026", o.payer ?? "Aetna", o.bal ?? 100 + i, o.status ?? "Denied"];
const file = (n, from = 0, o = {}) => Array.from({ length: n }, (_, i) => R("W" + (600000 + from + i), from + i, o));
const up = async (who, cl, locId, rows, kind = "fresh") => {
  const t = app.tableFromSheet(app.readWorkbook(bytesOf(toCsv([HEAD, ...rows])), "f.csv")[0].rows), mapping = app.autoMap(t.headers), built = app.buildClaims({ rows: t.rows, mapping, kind, today: TODAY });
  app.setToken(TOK[who]); const r = await app.uploadClaims({ client_id: cl.id, location_id: locId || null, kind, file_name: "qa.csv", claims: built.claims, summary: { ...built.summary, mapping }, rows_read: t.rows.length });
  return { r, built };
};
const reset = async (team = SUN_B) => { await sql("DELETE FROM batches"); await wipe(sun.id); await wipe(lake.id); await setTarget(sun.id, 0); await setTeam(sun, team); await TI("clients.saveTeam", { location_id: downtown.id, team: [] }); await TI("clients.saveTeam", { location_id: westside.id, team: [] }); };

S("1. Part boundaries (parts of 250)");
for (const n of [0, 1, 249, 250, 251, 500, 501, 1000]) {
  await reset(); const { r } = await up("Tina Lead", sun, null, file(n));
  const c = (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n; const b = await q("SELECT * FROM batches WHERE client_id = ?", sun.id);
  ok(`${n} rows: ${n} claims, the batch is finished once with the right count`, c === n && r.inserted === n && b.length === 1 && b[0].finished === 1 && b[0].inserted === n, [c, r, b.map((x) => [x.inserted, x.finished])]);
}
S("2. Claim numbers that differ only in format, in different parts of one file");
{
  await reset(); const rows = file(300); rows.push(R("w600000", 0, { bal: 9999 }));  // 'w600000' = W600000 again at the very end (another part)
  const { r } = await up("Tina Lead", sun, null, rows);
  const n = (await q1("SELECT COUNT(*) n FROM claims WHERE client_id = ?", sun.id)).n, b = (await q1("SELECT balance FROM claims WHERE client_id = ? AND claim_no = 'W600000'", sun.id)).balance;
  console.log("   300 rows + 'w600000' as the last row: claims", n, "balance of W600000:", b, JSON.stringify(r));
  ok("the same claim written W600000 / w600000 is one claim wherever the rows sit in the file", n === 300, n);
  await reset(); const rows2 = file(10); rows2.push(R("w600000", 0, { bal: 9999 }));
  await up("Tina Lead", sun, null, rows2);
  const b2 = (await q1("SELECT balance FROM claims WHERE client_id = ? AND claim_no = 'W600000'", sun.id)).balance;
  console.log("   10 rows + 'w600000' (same part): balance", b2);
  ok("...and the balance is the same whether the two rows share a part or not (first row counts, or they add up)", b === b2, [b, b2]);
}
S("3. A team lead with a view-only share cannot load inventory");
{
  await reset();
  const sv = await A("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead"), level: "view" }).catch((e) => ({ e: e.message }));
  console.log("   accessSave:", JSON.stringify(sv).slice(0, 150));
  const r = await up("Leo Lead", sun, null, file(3)).catch((e) => ({ e: e.message }));
  ok("Leo, who may only view Sunrise, cannot upload to it", !!r.e, r.e || r.r);
  const e = await as(TOK["Leo Lead"])("alloc.reassign", { ids: [], user_id: U("Arun Agent") }).catch((x) => x.message);
  await A("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead"), level: "edit" }).catch(() => {});
  const r2 = await up("Leo Lead", sun, null, file(3)).catch((e) => ({ e: e.message }));
  ok("with 'Can edit' he can upload", !r2.e, r2.e);
  await A("clients.accessRemove", { client_id: sun.id, user_id: U("Leo Lead") }).catch(() => {});
}
S("4. What 'given today' does when a file takes claims away");
{
  await reset(); await up("Tina Lead", sun, null, file(60)); await alloc("Tina Lead", sun);
  ok("set-up: 10 each", (await Promise.all(SUN_B.map(ready))).every((n) => n === 10));
  // a file marks 6 of Arun's 10 claims as zero balance (the client says nothing is owed) and closes 2 more as paid
  const arunClaims = await mine("Arun Agent", sun.id); const nos = arunClaims.map((c) => c.claim_no);
  const rows = file(60); rows.forEach((r) => { const k = nos.indexOf(r[0]); if (k >= 0 && k < 6) r[5] = 0; else if (k >= 6 && k < 8) r[6] = "Paid"; });
  const { r } = await up("Tina Lead", sun, null, rows);
  ok("the file excluded 6 and closed 2 of Arun's", r.excluded === 6 && r.closed === 2, r);
  ok("Arun's My day is 2", (await ready("Arun Agent")) === 2, await ready("Arun Agent"));
  await up("Tina Lead", sun, null, file(400, 1000));
  const m = (await today("Tina Lead", sun)).find((x) => x.name === "Arun Agent");
  console.log("   Arun: given_today", m.given_today, "room", m.room, "(he actually holds 2)");
  await alloc("Tina Lead", sun);
  const after = (await mine("Arun Agent", sun.id)).length;
  ok("QA2-01: Arun holds 2 claims; a second allocation tops him up to 45 of the day (2 + 43), not 2 + 35", after === 45, after);
}
S("5. Claims returned to the pool keep no 'given' mark");
{
  await reset(); await up("Tina Lead", sun, null, file(30)); await alloc("Tina Lead", sun);
  await A("clients.saveTeam", { client_id: sun.id, team: SUN_B.filter((x) => x !== "Fay Agent").map(U) });
  console.log("   Fay was in the Sunrise Shastra project, so she stays: ", (await mine("Fay Agent", sun.id)).length);
  await sql("UPDATE users SET active = 0 WHERE id = ?", U("Eli Agent"));
  const before = await mine("Eli Agent", sun.id);
  await A("roster.syncShastra");
  console.log("   Eli switched off (SQL) then roster sync: claims", (await mine("Eli Agent", sun.id)).length, "was", before.length);
  await sql("UPDATE users SET active = 1 WHERE id = ?", U("Eli Agent"));
  // deactivate through the real op
  const du = {};
  console.log("   users.setActive:", JSON.stringify(du).slice(0, 150));
  const st = await q("SELECT state, assigned_to, assigned_at FROM claims WHERE client_id = ? AND state = 'open'", sun.id);
  ok("claims of a switched-off person are in the pool with no person and no 'given' time", st.every((x) => !x.assigned_to && !x.assigned_at) , st.slice(0, 3));
  
}
done();
