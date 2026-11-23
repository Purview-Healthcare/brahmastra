/* Suite 61: three fixes. (1) The Payment posting / Submission / Rejections desk list comes in pages of 500 (page, page_size,
   total, as claims.list), so a desk with more than 500 claims reaches every row, and the counts on top stay true totals.
   (2) A desk team lead (Payment posting or Submission) sees only their own desk's people on the Stack report, never the AR
   billers of the same project; AR team leads, managers and the admin see what they saw before. (3) The Monday digest is dated
   by the India date: a run between 00:00 and 05:30 IST is the same week as one at 09:00. A stand-in for Purview Shastra's
   roster; made-up people and data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care";
/* Mona manages; Tina leads AR on Sunrise (Arun); Pia leads Payment posting on Sunrise (Pat); Sam is on Submission, Sunrise. */
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Pia Poster", position: "Team Lead", department: "Posting", project: SUN, reports_to: "Mona Manager", email: mail("Pia Poster") }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", email: mail("Arun Agent") }),
  P({ emp_id: "A2", name: "Pat Poster", department: "Posting", project: SUN, reports_to: "Pia Poster", email: mail("Pat Poster") }),
  P({ emp_id: "A3", name: "Sam Submitter", department: "Submission", project: SUN, reports_to: "Mona Manager", email: mail("Sam Submitter") }),
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
// the digest checks move the clock: the sessions stay good either side of it
await sql("UPDATE sessions SET expires_at = expires_at + ?", 60 * 86400000);
const TI = as(TOK["Tina Lead"]), PIA = as(TOK["Pia Poster"]), MO = as(TOK["Mona Manager"]);
const sun = (await A("clients.list")).clients.find((c) => c.name === SUN);

S("1. The desk list over 500: every row in pages, true totals");
{
  // 1,234 claims sent to Payment posting with Pia as the lead: 600 of them past the TAT
  const N = 1234, LATE = 600, now = Date.now(), H = 3600000;
  await sql(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO claims (id, client_id, match_key, claim_no, patient, payer, dos, balance, state, created_at, updated_at) SELECT 's61c' || i, ?, 'claim:s61-' || i, 'S61-' || (100000 + i), 'Testpatient, P' || i, 'Aetna', '2026-09-01', 100 + i, 'in_process', ?, ? FROM n`, N, sun.id, now, now);
  await sql(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
    INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by_name, due_at, lead_id) SELECT 's61h' || i, 's61c' || i, ?, 'posting', 'pending', ?, 'Arun Agent',
      CASE WHEN i <= ? THEN ? - i * 60000 ELSE ? + i * 60000 END, ? FROM n`, N, sun.id, now - 48 * H, LATE, now - H, now + 400 * H, U("Pia Poster"));
  const p1 = await PIA("handoffs.list", { dept: "posting", view: "open" });
  ok("page 1 holds 500 rows and says the true total (1,234), its page and page size", p1.rows.length === 500 && p1.total === N && p1.page === 1 && p1.page_size === 500, { n: p1.rows.length, total: p1.total, page: p1.page, size: p1.page_size });
  ok("the Open count on top is the true total, not the 500 shown", p1.stats.open_n === N && p1.stats.overdue === LATE, p1.stats);
  const p2 = await PIA("handoffs.list", { dept: "posting", view: "open", page: 2 }), p3 = await PIA("handoffs.list", { dept: "posting", view: "open", page: 3 });
  const ids = [...p1.rows, ...p2.rows, ...p3.rows].map((h) => h.id);
  ok("pages 2 and 3 hold the rest (500 and 234): every row once, none twice", p2.rows.length === 500 && p3.rows.length === 234 && new Set(ids).size === N && ids.every((id) => /^s61h/.test(id)), { p2: p2.rows.length, p3: p3.rows.length, distinct: new Set(ids).size });
  ok("the pages keep the desk's order: earliest due first, across the pages", p1.rows[499].due_at <= p2.rows[0].due_at && p2.rows[499].due_at <= p3.rows[0].due_at && p1.rows[0].overdue && !p3.rows[0].overdue, [p1.rows[499].due_at, p2.rows[0].due_at]);
  const p4 = await PIA("handoffs.list", { dept: "posting", view: "open", page: 4 });
  ok("a page past the end is empty and still says the total", p4.rows.length === 0 && p4.total === N, { n: p4.rows.length, total: p4.total });
  const big = await PIA("handoffs.list", { dept: "posting", view: "open", page_size: 5000 });
  ok("a page is never more than 500, whatever is asked", big.rows.length === 500 && big.page_size === 500, big.rows.length);
  const l1 = await PIA("handoffs.list", { dept: "posting", view: "late" }), l2 = await PIA("handoffs.list", { dept: "posting", view: "late", page: 2 });
  ok("Past TAT pages too: 600 = 500 + 100, the same as its card", l1.total === LATE && l1.rows.length === 500 && l2.rows.length === 100 && [...l1.rows, ...l2.rows].every((h) => h.overdue) && l1.stats.overdue === LATE, { total: l1.total, a: l1.rows.length, b: l2.rows.length });
  const ad = await A("handoffs.list", { dept: "posting", view: "open", client_id: sun.id });
  ok("the admin's list of the same desk counts them all too", ad.total >= N && ad.rows.length === 500 && ad.stats.open_n === ad.total, { total: ad.total, open: ad.stats.open_n });
  const src = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("the page asks for its page and shows Prev and Next under the desk list when there are more than 500", /hide_client: hideClient \|\| undefined, page, page_size: DESK_PAGE/.test(src) && /<Pager page=\{q\.data\.page\} pageSize=\{q\.data\.page_size\} total=\{q\.data\.total\} onPage=\{\(n\) => setPg\(\{ k: fkey, n \}\)\} \/>/.test(src));
  await sql("DELETE FROM handoffs WHERE id LIKE 's61h%'"); await sql("DELETE FROM claims WHERE id LIKE 's61c%'");
}

S("2. Stack report: a desk team lead sees only their own desk's people");
{
  const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
  const names = (v) => v.rows.map((r) => r.name).sort();
  const pia = await PIA("stack.month", { month });
  ok("Pia (Payment posting team lead) sees Pat (her desk), never Arun (an AR biller of the same project) or Sam (Submission)", names(pia).includes("Pat Poster") && !names(pia).includes("Arun Agent") && !names(pia).includes("Sam Submitter"), names(pia));
  const tina = await TI("stack.month", { month });
  ok("Tina (AR team lead) still sees her span as before: Arun, and the desk people on her project", ["Arun Agent", "Pat Poster", "Sam Submitter"].every((n) => names(tina).includes(n)), names(tina));
  const mona = await MO("stack.month", { month }), adm = await A("stack.month", { month });
  ok("Mona (manager) and the admin still see everyone", ["Arun Agent", "Pat Poster", "Sam Submitter"].every((n) => names(mona).includes(n) && names(adm).includes(n)), { mona: names(mona), admin: names(adm).length });
  let r; try { r = await PIA("stack.save", { month, field: "pkt", user_id: U("Arun Agent"), value: "80" }); } catch (e) { r = e; }
  ok("Pia cannot type a value for Arun: he is not in her span", !!r && /not in your span/i.test(r.message || ""), r && r.message);
}

S("3. The Monday digest is dated by the India date");
{
  const RealDate = globalThis.Date;
  const IST = (y, mo, d, h, mi = 0) => RealDate.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
  const at = async (ms, fn) => { globalThis.Date = class extends RealDate { constructor(...a) { if (!a.length) super(ms); else super(...a); } static now() { return ms; } };
    try { return await fn(); } finally { globalThis.Date = RealDate; } };
  const read = (ms) => at(ms, async () => { const d = await A("digest.dashboard", {}); const sp = await A("digest.spans", {}); const pv = await A("digest.preview", { span: d.span.key }); return { week: d.week, sweek: sp.week, subject: pv.subject, rollup: JSON.stringify(d.rollup) }; });
  // Monday 23 Nov 2026: 01:00 IST is still Sunday 22 Nov in UTC
  const early = await read(IST(2026, 11, 23, 1)), late = await read(IST(2026, 11, 23, 9)), sun22 = await read(IST(2026, 11, 22, 23));
  ok("a digest made Monday 01:00 IST is the week of Monday 23 Nov (16 to 22 Nov), not a week early", early.week.week === "2026-11-23" && early.week.first === "2026-11-16" && early.week.last === "2026-11-22" && early.sweek.week === "2026-11-23", early.week);
  ok("the same digest as at 09:00 IST: week, subject line and figures", early.week.week === late.week.week && early.subject === late.subject && early.rollup === late.rollup, [early.subject, late.subject]);
  ok("Sunday 23:00 IST is still the week before", sun22.week.week === "2026-11-16" && sun22.week.last === "2026-11-15", sun22.week);
  ok("the subject names the week by its India dates (week of Nov 16)", /week of Nov 16/.test(early.subject), early.subject);
}

const failed = results.filter((x) => !x.pass);
console.log(`\n==== ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
for (const f of failed) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(failed.length ? 1 : 0);
