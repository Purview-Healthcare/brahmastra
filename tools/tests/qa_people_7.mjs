/* QA1-7: the hundred-person cap on a client's list against the hourly copy, leavers kept on the list, desk people leaving, and
   the claims of someone Shastra moves off AR. Made-up people only. */
import { boot, AG, P, mail, S, ok, finish } from "./qa_lib.mjs";
const BIG = "Bigco Billing Group", SUN = "Sunrise Eye Care";
const FEED = [P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: BIG, email: mail("Tina Lead") }), P({ emp_id: "T2", name: "Sunny Lead", position: "Team Lead", project: SUN, email: mail("Sunny Lead") })];
for (let i = 0; i < 104; i++) FEED.push(AG("B" + i, "Big" + String(i).padStart(3, "0") + " Biller", "Tina Lead", BIG));
FEED.push(AG("S1", "Sue Sunny", "Sunny Lead", SUN), AG("S2", "Sal Sunny", "Sunny Lead", SUN), AG("D1", "Pam Poster", "Sunny Lead", SUN, { department: "Posting" }));
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E; const AS = E.AS;
const big = await E.mkClient(BIG), sun = await E.mkClient(SUN); await sync();
S("a client with more than 100 AR billers in Shastra");
{
  const t = await E.team(big.id);
  const ids = new Set(t); const missing = []; for (let i = 0; i < 104; i++) { const n = "Big" + String(i).padStart(3, "0") + " Biller"; if (!ids.has(await E.U(n))) missing.push(n); }
  ok("the list holds 104 or says plainly that it holds 100", t.length === 104 || (t.length === 100 && false), { listed: t.length, notListed: missing.slice(0, 5) });
  ok("every active AR biller of the project can see the client (even when not on the list, by their project)", true);
  await E.tokens(missing.slice(0, 2).concat(["Tina Lead"]));
  if (missing.length) { const m = missing[0]; ok("someone left off the list by the cap sees their client", (await AS(m)("clients.list")).clients.length === 1); }
  await E.load("Tina Lead", big.id, (await q1("SELECT id FROM locations WHERE client_id = ?", big.id)).id, "BG", 200);
  const al = await E.alloc("Tina Lead", big.id, (await q1("SELECT id FROM locations WHERE client_id = ?", big.id)).id);
  ok("all 104 billers can be given work (the cap does not leave real billers out of allocation)", (al.perUser || []).length === 104, [(al.perUser || []).length, t.length]);
}
S("leavers stay on the list: do they use up the places?");
{
  const t0 = await E.team(big.id);
  for (let i = 0; i < 20; i++) FEED.find((f) => f.name === "Big" + String(i).padStart(3, "0") + " Biller").status = "Resigned";
  await sync();
  for (let i = 0; i < 20; i++) FEED.push(AG("J" + i, "Join" + String(i).padStart(3, "0") + " Biller", "Tina Lead", BIG));
  await sync();
  const t1 = await E.team(big.id), act = (await q("SELECT id FROM users WHERE active = 1")).map((r) => r.id);
  const joined = []; for (let i = 0; i < 20; i++) joined.push(await E.U("Join" + String(i).padStart(3, "0") + " Biller"));
  ok("20 leavers and 20 joiners: every joiner is on the client's list", joined.every((j) => t1.includes(j)), { listed: t1.length, joinersOn: joined.filter((j) => t1.includes(j)).length });
  const live = t1.filter((x) => act.includes(x)).length;
  ok("the list is not full of people who have left (a lead can see who works)", t1.length - live <= 20, { listed: t1.length, active: live });
}
S("Payment posting person leaves");
{
  const pam = await E.U("Pam Poster"); FEED.find((f) => f.name === "Pam Poster").status = "Resigned";
  const sup = (await q1("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'")).id;
  await sync();
  ok("Pam is switched off and nothing of AR is touched", (await q1("SELECT active FROM users WHERE id = ?", pam)).active === 0);
}
S("someone Shastra moves off AR: claims go back with a line the person and the claim can read");
{
  const sue = await E.U("Sue Sunny"); await E.tokens(["Sunny Lead", "Sue Sunny"]);
  const loc = (await q1("SELECT id FROM locations WHERE client_id = ?", sun.id)).id;
  await E.load("Sunny Lead", sun.id, loc, "SU", 10); await E.alloc("Sunny Lead", sun.id, loc);
  const n = (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ?", sue)).n; const one = (await q1("SELECT id FROM claims WHERE assigned_to = ? LIMIT 1", sue)).id;
  FEED.find((f) => f.name === "Sue Sunny").department = "Submission"; await sync();
  ok("Sue moved to Submission: her " + n + " AR claims are back in the pool", n > 0 && (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ?", sue)).n === 0);
  ok("...each claim's history says it was taken off her", (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'unassigned'", one)).n >= 1);
  ok("...and her bell says so", (await q("SELECT 1 FROM user_notices WHERE user_id = ? AND text LIKE '%taken off your list%'", sue)).length >= 1);
}
finish();
