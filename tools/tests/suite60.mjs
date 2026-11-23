/* Suite 60: three fixes. The Completed box at Submission gives the claim's client's recheck time (48 unless set lower, never
   more), also from the claim's own page; an upload with no location picked and a Location column in the file is split by the
   file's locations, also when the client was picked first; and the upload's result lines stop showing numbers once that
   upload is undone (Upload history says what is left). Made-up people and data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const T = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, e: e.message }; } };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care";
const FEED = [
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, email: "tina@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "D2", name: "Quin Submit", department: "Submission", project: SUN, reports_to: "Tina Lead", email: "quin@purview-healthcare.com" }),
];
const fetchMock = async (url) => url.includes("brahmastra_roster") ? J({ ok: true, rows: FEED }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, sha } = rig; const app = rig.app;
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const row = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results[0];
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const TOK = {};
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); TOK[name] = (await login(email, "pw-" + email)).token; return as(TOK[name]); };
const TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), QU = await firstIn("Quin Submit", "quin@purview-healthcare.com");
const sun = (await A("clients.list")).clients.find((c) => c.name === SUN);
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const arun = U("Arun Agent").id;
const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");

S("The Completed box at Submission: the client's recheck time");
{ await sql("UPDATE clients SET submission_mode = 'person', submission_lead = ? WHERE id = ?", U("Quin Submit").id, sun.id);
  const pool = (await A("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows.map((x) => x.id);
  await A("alloc.reassign", { ids: pool.slice(0, 3), user_id: arun });
  const nt = { findings: "Checked the payer portal and the claim history today", source: "Portal" };
  const toSubmission = async (id) => { await AR("queue.open", { id });
    await AR("queue.complete", { id, desk: true, saag: { status: "Claim Denied", sub_status: "Coding Error", action: "Need to Resubmit", bucket: "Purview", effective: "" }, note: nt, today });
    return row("SELECT id FROM handoffs WHERE claim_id = ? AND dept = 'submission' AND status IN ('pending','assigned')", id); };
  const at = async (id, hours) => { await sql("UPDATE clients SET subcheck_hours = ? WHERE id = ?", hours, sun.id);
    const g = await QU("claims.get", { id }), l = await QU("handoffs.list", { client_id: sun.id });
    return { page: (g.handoffs.find((h) => h.dept === "submission") || {}).recheck_hours, desk: (l.rows || []).filter((h) => h.claim_id === id).map((h) => h.recheck_hours)[0] }; };
  const h0 = await toSubmission(pool[0]);
  ok("a claim sent to Submission has its hand-off", !!h0, h0);
  const a24 = await at(pool[0], 24), aNull = await at(pool[0], null), a72 = await at(pool[0], 72);
  ok("the claim's page gives each hand-off the client's recheck time: 24 for a client set to 24", a24.page === 24, a24);
  ok("...48 when the client has none", aNull.page === 48, aNull);
  ok("...and never more than 48 (a stored 72 reads as 48)", a72.page === 48, a72);
  ok("the Submission desk's list gives the same number (24, then 48, then 48)", a24.desk === 24 && aNull.desk === 48 && a72.desk === 48, [a24, aNull, a72]);
  await sql("UPDATE clients SET subcheck_hours = 24 WHERE id = ?", sun.id);
  const r = await T(() => QU("handoffs.close", { id: h0.id, outcome: "complete", proof: { date: today, ref: "BATCH-S60" } }));
  const rc = await row("SELECT available_at, created_at FROM handoffs WHERE claim_id = ? AND dept = 'subcheck'", pool[0]);
  ok("marking it Completed opens the recheck after the client's 24 working hours, as the box says", r.ok && rc && rc.available_at > Date.now(), [r, rc]);
  await sql("UPDATE clients SET subcheck_hours = NULL WHERE id = ?", sun.id);
  ok("the box's words use the hand-off's recheck time, not a fixed 48", /opens " \+ \(h\.recheck_hours \|\| 48\) \+ " working hours from now/.test(src) && !/opens 48 working hours from now/.test(src));
}

S("Upload with no location picked: split by the file's Location column");
{ ok("reading a file with a Location column while no location is picked chooses the split by the file's locations", /const afterPick = \(m\) => \{ if \(m\.location && !locId\) setLocMode\("file"\);/.test(src));
  ok("a location that is picked is kept: picking one switches the split off, as before", (src.match(/setLocId=\{\(v\) => \{ setLocId\(v\); if \(v\) setLocMode\("pick"\); \}\}/g) || []).length === 2);
  // what the page then does: one upload per location of the file, each into its own location (never "(no location)")
  const locs = sun.locations.filter((l) => l.active);
  const rows = (prefix, loc, n) => Array.from({ length: n }, (_, i) => ({ match_key: "claim:" + (prefix + (i + 1)).toLowerCase(), claim_no: prefix + (i + 1), patient: "Testpatient, A" + (i + 1), payer: "Aetna", dos: "2026-09-0" + (1 + i), balance: 120 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied", location: loc.name }));
  app.setToken(TOK["Tina Lead"]);
  for (const [k, loc] of locs.slice(0, 2).entries()) await app.uploadClaims({ client_id: sun.id, location_id: loc.id, kind: "fresh", file_name: "S60 split.xlsx", claims: rows("S60L" + k + "-", loc, 3), summary: {}, rows_read: 3, hold: k === 0 });
  const per = (await DB.prepare("SELECT COALESCE(l.name, '(no location)') AS loc, COUNT(*) AS n FROM claims c LEFT JOIN locations l ON l.id = c.location_id WHERE c.claim_no LIKE 'S60L%' GROUP BY 1 ORDER BY 1").all()).results;
  ok("each location of the file gets its own rows, none in (no location)", per.length === 2 && per.every((x) => x.loc !== "(no location)" && x.n === 3), per);
}

S("After Undo: the upload's lines do not keep their numbers");
{ app.setToken(TOK["Tina Lead"]);
  const loc = sun.locations.find((l) => l.active);
  const claims = Array.from({ length: 4 }, (_, i) => ({ match_key: "claim:s60u-" + (i + 1), claim_no: "S60U-" + (i + 1), patient: "Testpatient, A" + (i + 1), payer: "Cigna", dos: "2026-09-1" + i, balance: 200 + i, status_class: "denied", tier: "Medium", priority: 50, file_status: "Denied" }));
  const up = await app.uploadClaims({ client_id: sun.id, location_id: loc.id, kind: "fresh", file_name: "S60 undo.xlsx", claims, summary: {}, rows_read: 4 });
  ok("the upload loads 4 new claims and gives its batch", up.inserted === 4 && !!up.batch_id, up);
  const before = (await TI("inventory.batches", {})).batches.find((b) => b.id === up.batch_id);
  ok("the upload's batch is listed, not undone", before && !before.undone_at, before);
  const u = await TI("inventory.undoBatch", { batch_id: up.batch_id });
  ok("Undo removes the 4 claims nobody opened", u.removed === 4, u);
  const after = (await TI("inventory.batches", {})).batches.find((b) => b.id === up.batch_id);
  ok("the list the upload screen reads marks that batch undone (by the same id the result line holds)", after && !!after.undone_at, after);
  ok("the result lines hide the numbers of an undone upload and say it was undone", /const isUndone = \(r\) => !!r\.batch_id && undoneIds\.has\(r\.batch_id\);/.test(src)
    && /result\.some\(isUndone\) && <div className="alert warn"><b>Undone\.<\/b>/.test(src) && /result\.map\(\(r, i\) => isUndone\(r\) \? null : r\.assigned/.test(src)
    && /result\.filter\(\(r\) => !isUndone\(r\)\)\.map\(\(r\) =>/.test(src));
  ok("the screen checks again when the page is back in view", /const f = \(\) => \{ if \(document\.visibilityState !== "hidden"\) mineQ\.reload\(\); \};/.test(src));
  const again = await T(() => TI("inventory.undoBatch", { batch_id: up.batch_id }));
  ok("an upload is undone once", !again.ok && /already undone/.test(again.e || ""), again);
}

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
