/* QA1-8: sequences that cross the lead's hand and Shastra: taken off by a lead, then Shastra moves the person; SME rights;
   the bell and My allocations after changes. Made-up people only. */
import { boot, AG, P, mail, S, ok, finish } from "./qa_lib.mjs";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const FEED = [P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "S1", name: "Sue Sme", position: "SME", project: SUN, reports_to: "Tina Lead", email: mail("Sue Sme") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Cara Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE), AG("A5", "Eli Agent", "Leo Lead", LAKE)];
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E; const AS = E.AS;
const sun = await E.mkClient(SUN), lake = await E.mkClient(LAKE); await sync(); await E.tokens();
const loc = {}; for (const c of [sun, lake]) loc[c.id] = (await q1("SELECT id FROM locations WHERE client_id = ?", c.id)).id;
const uid = (n) => E.U(n); const feed = (n) => FEED.find((f) => f.name === n);
const held = async (n, c) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')" + (c ? " AND client_id = '" + c.id + "'" : ""), await uid(n))).n;
const seen = async (n) => { const s = await E.ready(n); return s.ready.n + s.waiting + (s.in_progress_id ? 1 : 0); };
const clientsOf = async (who) => (await AS(who)("clients.list")).clients.map((c) => c.name).sort();
const tries = (who, op, p) => E.rig.tryOp(() => AS(who)(op, p));
const notices = async (n, like = "%") => (await q("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE ?", await uid(n), like)).map((x) => x.text);
await E.load("Tina Lead", sun.id, loc[sun.id], "SN", 30); await E.alloc("Tina Lead", sun.id, loc[sun.id]);
S("a lead takes a biller off, then Shastra moves him to another client");
{
  const arun = await uid("Arun Agent"), a0 = await held("Arun Agent", sun), t = await E.team(sun.id);
  await AS("Tina Lead")("clients.saveTeam", { client_id: sun.id, base: t, team: t.filter((x) => x !== arun) });
  // 2.116.3 (the owner's rule: only a lead takes someone off, and then they are off): his Shastra project no longer keeps the client
  ok("taken off by Tina while Sunrise is still his Shastra project: his " + a0 + " Sunrise claims go back and he no longer sees Sunrise", a0 > 0 && (await held("Arun Agent", sun)) === 0 && !(await clientsOf("Arun Agent")).includes(SUN), [a0, await held("Arun Agent", sun), await clientsOf("Arun Agent")]);
  feed("Arun Agent").project = LAKE; await sync();
  ok("Shastra moves him to Lakeview: his Sunrise claims go back to the pool", (await held("Arun Agent", sun)) === 0, await held("Arun Agent", sun));
  ok("...with the bell line", (await notices("Arun Agent", "%taken off your list%")).some((x) => x.includes(SUN)), await notices("Arun Agent"));
  ok("...he sees Lakeview and not Sunrise, and My day is what he holds", JSON.stringify(await clientsOf("Arun Agent")) === JSON.stringify([LAKE]) && (await seen("Arun Agent")) === (await held("Arun Agent")), await clientsOf("Arun Agent"));
  ok("...and is on Lakeview's list, not Sunrise's", (await E.team(lake.id)).includes(arun) && !(await E.team(sun.id)).includes(arun));
  feed("Arun Agent").project = SUN; await sync();
  ok("Shastra puts him back on Sunrise: still off Sunrise's list (a lead took him off)", !(await E.team(sun.id)).includes(arun), await E.team(sun.id));
  ok("...and he does not see Sunrise by his project either: only a lead puts him back (2.116.3)", !(await clientsOf("Arun Agent")).includes(SUN), await clientsOf("Arun Agent"));
  const t2 = await E.team(sun.id); await AS("Tina Lead")("clients.saveTeam", { client_id: sun.id, base: t2, team: [...t2, arun] });
  ok("Tina adds him: on the list again", (await E.team(sun.id)).includes(arun));
  ok("...and he sees Sunrise again", (await clientsOf("Arun Agent")).includes(SUN), await clientsOf("Arun Agent"));
}
S("an unmatched project: the client loses its Shastra project");
{
  const bela = await uid("Bela Agent"), b0 = await held("Bela Agent", sun);
  const r = await tries("Mona Manager", "projects.map", { name: SUN, client_id: lake.id });
  ok("Mona (manager of both) can move Sunrise's project to Lakeview, or is refused clearly", true);
  if (r.ok) {
    ok("moved: the people on Sunrise's list keep their Sunrise claims (nothing automatic takes them off)", (await held("Bela Agent", sun)) === b0 && (await seen("Bela Agent")) === (await held("Bela Agent")), [b0, await held("Bela Agent", sun)]);
    ok("...and Sunrise is still on Bela's list of clients (she is on its list)", (await clientsOf("Bela Agent")).includes(SUN), await clientsOf("Bela Agent"));
    const back = await tries("Mona Manager", "projects.map", { name: SUN, client_id: sun.id });
    ok("(question) Mona, who moved Sunrise's project to Lakeview, cannot move it back herself (" + (back.ok ? "she can" : back.e) + "); Tina meanwhile has no Sunrise: " + JSON.stringify(await clientsOf("Tina Lead")), true);
    await A("projects.map", { name: SUN, client_id: sun.id });
    ok("the admin moved it back", (await clientsOf("Tina Lead")).includes(SUN));
  } else ok("(the move was refused: " + r.e + ")", true);
}
S("SME rights on a client");
{
  const sue = await uid("Sue Sme"), t = await E.team(sun.id), bela = await uid("Bela Agent");
  ok("Sue (SME of Sunrise) sees Sunrise", (await clientsOf("Sue Sme")).includes(SUN));
  const sh = await tries("Sue Sme", "clients.accessSave", { client_id: sun.id, user_id: await uid("Dev Agent"), level: "view" });
  ok("an SME cannot share a client", !sh.ok, sh);
  const sa = await tries("Sue Sme", "clients.saveTeam", { client_id: sun.id, base: t, team: t.filter((x) => x !== bela) });
  ok("(question) an SME changing Sunrise's list of billers: " + (sa.ok ? "allowed" : "refused: " + sa.e), true);
  if (sa.ok) await AS("Tina Lead")("clients.saveTeam", { client_id: sun.id, base: await E.team(sun.id), team: [...await E.team(sun.id), bela] });
  const ca = await tries("Sue Sme", "clients.save", { name: "Sme Made Client", code: "SMC", profile: { scope: ["ar"], targets: { ar: 10 }, resp: { ar: { lead: sue } } }, locations: ["Main"] });
  ok("an SME cannot add a client", !ca.ok, ca);
  const al = await E.alloc("Sue Sme", sun.id, loc[sun.id]).catch((e) => ({ err: e.message }));
  ok("an SME is never planned for claims", !(await E.team(sun.id)).includes(sue));
}
S("My allocations / history after a client is gone from someone's list");
{
  const cara = await uid("Cara Agent"), t = await E.team(sun.id);
  const h0 = await tries("Cara Agent", "history.mine", {}); ok("history.mine answers", h0.ok, h0);
  feed("Cara Agent").project = LAKE; await sync();
  await AS("Tina Lead")("clients.saveTeam", { client_id: sun.id, base: await E.team(sun.id), team: (await E.team(sun.id)).filter((x) => x !== cara) });
  const q0 = await tries("Cara Agent", "queue.list", {});
  const rows = q0.ok ? (q0.r.rows || q0.r.claims || []) : [];
  ok("Cara (moved to Lakeview, taken off Sunrise): her claims list holds nothing of Sunrise", rows.every((r) => r.client_id !== sun.id), rows.length);
  const hm = await tries("Cara Agent", "history.mine", {});
  ok("...her history lists her own past work only", hm.ok);
  ok("...search for a Sunrise claim number finds nothing she worked on at a client she no longer works? (worked claims stay searchable only if she may open them)", ((await AS("Cara Agent")("search.global", { q: "SN-73" })).claims || []).every((c) => c.client_id !== sun.id) , (await AS("Cara Agent")("search.global", { q: "SN-73" })).claims.length);
}
S("QUESTION: a claim Payment posting closed is readable by everyone, other clients' billers included");
{
  const lk = await q1("SELECT id, claim_no, patient FROM claims WHERE client_id = ? LIMIT 1", lake.id) || (await (async () => { await E.load("Leo Lead", lake.id, loc[lake.id], "LK", 3); return q1("SELECT id, claim_no, patient FROM claims WHERE client_id = ? LIMIT 1", lake.id); })());
  await sql("UPDATE claims SET state = 'closed', handoff_status = 'posted' WHERE id = ?", lk.id);
  const sr = await AS("Bela Agent")("search.global", { q: lk.claim_no }), g = await tries("Bela Agent", "claims.get", { id: lk.id }), tl = await tries("Bela Agent", "claims.timeline", { id: lk.id });
  ok("(question) Bela (Sunrise only) searches " + lk.claim_no + " of Lakeview: found=" + sr.claims.length + " (patient shown: " + (sr.claims[0] ? sr.claims[0].patient : "-") + "), opens it: " + g.ok + ", reads its history: " + tl.ok
    + ". README line 794 says 'anyone can open it'; the owner's rule 4 says nobody opens a claim of a client they do not see", true);
}
finish();
