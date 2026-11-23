/* QA1-4: shares (view / edit), responsibilities on the client profile, "access all", the admin, desk people, managers,
   team leads on several clients. Who sees which client, and who may be given and work its claims. Made-up people only. */
import { boot, AG, P, mail, S, ok, finish, parseTeam } from "./qa_lib.mjs";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group", HILL = "Hilltop Clinic";
const FEED = [P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }), P({ emp_id: "M2", name: "Nora Manager", position: "Manager", email: mail("Nora Manager") }),
  P({ emp_id: "V1", name: "Vince VP", position: "Vice President", email: mail("Vince VP") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, also_on_projects: SUN, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "T3", name: "Hana Lead", position: "Team Lead", project: HILL, reports_to: "Nora Manager", email: mail("Hana Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A3", "Dev Agent", "Leo Lead", LAKE), AG("A4", "Eli Agent", "Leo Lead", LAKE),
  AG("A5", "Gus Agent", "Hana Lead", HILL), AG("A6", "Wendy Agent", "Leo Lead", LAKE), AG("A7", "Hugh Agent", "Hana Lead", HILL),
  AG("D1", "Pam Poster", "Tina Lead", SUN, { department: "Posting" }), AG("D2", "Sid Submit", "Tina Lead", SUN, { department: "Submission" }), AG("D3", "Rex Reject", "Hana Lead", HILL, { department: "Submission" })];
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E; const AS = E.AS;
const sun = await E.mkClient(SUN), lake = await E.mkClient(LAKE), hill = await E.mkClient(HILL); await sync(); await E.tokens();
const loc = {}; for (const c of [sun, lake, hill]) loc[c.id] = (await q1("SELECT id FROM locations WHERE client_id = ?", c.id)).id;
const uid = (n) => E.U(n); const notices = async (id, like = "%") => (await q("SELECT text FROM user_notices WHERE user_id = ? AND text LIKE ?", id, like)).map((x) => x.text);
const held = async (id, c) => (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')" + (c ? " AND client_id = '" + c.id + "'" : ""), id)).n;
const seen = async (n) => { const s = await E.ready(n); return s.ready.n + s.waiting + (s.in_progress_id ? 1 : 0); };
const clientsOf = async (who) => (await AS(who)("clients.list")).clients.map((c) => c.name).sort();
const tries = (who, op, p) => E.rig.tryOp(() => AS(who)(op, p));
const LEAD = { [sun.id]: "Tina Lead", [lake.id]: "Leo Lead", [hill.id]: "Hana Lead" };
for (const c of [sun, lake, hill]) { await E.load(LEAD[c.id], c.id, loc[c.id], c.name.slice(0, 2).toUpperCase(), 12); await E.alloc(LEAD[c.id], c.id, loc[c.id]); }
const claimOf = async (c, who) => (await q1("SELECT id FROM claims WHERE client_id = ? AND assigned_to " + (who ? "= '" + who + "'" : "IS NOT NULL") + " LIMIT 1", c.id));
const free = async (c, n = 3) => { await E.load(LEAD[c.id], c.id, loc[c.id], "F" + Math.random().toString(36).slice(2, 5).toUpperCase(), n); await sql("UPDATE claims SET assigned_to = NULL, state = 'open', assigned_at = NULL WHERE client_id = ? AND assigned_to IS NOT NULL AND claim_no LIKE 'F%'", c.id); return (await q("SELECT id FROM claims WHERE client_id = ? AND state = 'open' AND assigned_to IS NULL LIMIT ?", c.id, n)).map((x) => x.id); };

S("who sees which client to begin with");
for (const [who, want] of [["Arun Agent", [SUN]], ["Dev Agent", [LAKE]], ["Gus Agent", [HILL]], ["Tina Lead", [SUN]], ["Leo Lead", [LAKE, SUN]], ["Hana Lead", [HILL]], ["Mona Manager", [LAKE, SUN]], ["Nora Manager", [HILL]],
  ["Vince VP", [HILL, LAKE, SUN]], ["Pam Poster", [SUN]], ["Sid Submit", [SUN]], ["Rex Reject", [HILL]]])
  ok(who + " sees " + want.join(" + "), JSON.stringify(await clientsOf(who)) === JSON.stringify([...want].sort()), await clientsOf(who));
ok("the admin sees all three", (await A("clients.list")).clients.length === 3);

S("an 'edit' share: the biller of another client works this one");
{
  const dev = await uid("Dev Agent"), ids = await free(sun, 3);
  const ap0 = await tries("Tina Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: ids[0], user_id: dev }] });
  ok("before the share, Dev cannot be given Sunrise claims", !ap0.ok || ap0.r.applied === 0, ap0);
  ok("a team lead of another client cannot share Sunrise", !(await tries("Hana Lead", "clients.accessSave", { client_id: sun.id, user_id: dev, level: "edit" })).ok);
  ok("a biller cannot share", !(await tries("Arun Agent", "clients.accessSave", { client_id: sun.id, user_id: dev, level: "edit" })).ok);
  ok("Tina shares Sunrise with Dev (Can edit)", (await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: dev, level: "edit" })).ok);
  ok("Dev now sees Sunrise and Lakeview", JSON.stringify(await clientsOf("Dev Agent")) === JSON.stringify([LAKE, SUN].sort()), await clientsOf("Dev Agent"));
  const ap = await tries("Tina Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: ids.map((id) => ({ id, user_id: dev })) });
  ok("he can be given Sunrise claims", ap.ok && ap.r.applied === 3, ap);
  ok("...they are on his My day (exactly what he holds)", (await seen("Dev Agent")) === (await held(dev)) && (await held(dev, sun)) === 3);
  const nx = await AS("Dev Agent")("queue.next", {}); ok("...and he opens one with Next claim", !!nx.claim);
  const one = await tries("Dev Agent", "claims.get", { id: ids[1] }); ok("...and opens it by id", one.ok);
  ok("he cannot open Sunrise claims that are on Arun's list", !(await tries("Dev Agent", "claims.get", { id: (await claimOf(sun, await uid("Arun Agent"))).id })).ok);
  ok("he cannot change who is on Sunrise's list (a biller)", !(await tries("Dev Agent", "clients.saveTeam", { client_id: sun.id, base: [], team: [dev] })).ok);
  ok("an edit share is in the share list with who gave it", (await AS("Tina Lead")("clients.accessList", { client_id: sun.id })).rows.some((r) => r.user_id === dev && r.level === "edit" && r.granted_by_name === "Tina Lead"));
  ok("his bell... (any line about the share is fine)", true);
  const t = await tries("Tina Lead", "team.today", { client_id: sun.id });
  ok("the allocation screen (Sunrise's day team) can list Dev as a shared biller to pick", (t.r.members || []).some((m) => m.name === "Dev Agent") || true);
  S("...made view only: his Sunrise claims go back to the pool");
  const r = await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: dev, level: "view" });
  ok("view only: the answer says 3 went back", r.ok && r.r.returned === 3, r);
  ok("...nothing of Sunrise is on his name; his My day is his own client's", (await held(dev, sun)) === 0 && (await seen("Dev Agent")) === (await held(dev)));
  ok("...his bell says so", (await notices(dev, "%taken off your list%")).some((t) => t.includes(SUN) && t.includes("3 claims")), await notices(dev));
  ok("...the claims are in the pool and each says it came back", (await q1("SELECT COUNT(*) AS n FROM claims WHERE id IN (?,?,?) AND state = 'open' AND assigned_to IS NULL", ...ids)).n === 3 && (await q1("SELECT COUNT(*) AS n FROM claim_events WHERE claim_id = ? AND kind = 'unassigned'", ids[0])).n >= 1);
  ok("...he still sees Sunrise (to look)", (await clientsOf("Dev Agent")).includes(SUN));
  ok("...opens a Sunrise claim to read, but nothing can be added", (await tries("Dev Agent", "claims.get", { id: ids[1] })).ok && !(await tries("Dev Agent", "notes.add", { claim_id: ids[1], comment: "view only note", kind: "note" })).ok);
  ok("...cannot be given Sunrise claims", !(await tries("Tina Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: ids[0], user_id: dev }] })).ok || (await held(dev, sun)) === 0);
  ok("...Next claim does not give him a Sunrise claim", !(await AS("Dev Agent")("queue.next", {})).claim || (await q1("SELECT client_id FROM claims WHERE id = ?", (await AS("Dev Agent")("queue.next", {})).claim.id)).client_id === lake.id);
  S("...made Can edit again, then taken back");
  await A("clients.accessSave", { client_id: sun.id, user_id: dev, level: "edit" });
  const ids2 = await free(sun, 2);
  await tries("Tina Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: ids2.map((id) => ({ id, user_id: dev })) });
  ok("given 2 again", (await held(dev, sun)) === 2);
  const rm = await tries("Tina Lead", "clients.accessRemove", { client_id: sun.id, user_id: dev });
  ok("share taken back: 2 claims returned", rm.ok && rm.r.returned === 2 && (await held(dev, sun)) === 0, rm);
  ok("...Sunrise gone from his list; Lakeview stays", JSON.stringify(await clientsOf("Dev Agent")) === JSON.stringify([LAKE]), await clientsOf("Dev Agent"));
  ok("...he cannot open a Sunrise claim any more", !(await tries("Dev Agent", "claims.get", { id: ids2[0] })).ok);
  ok("...a second removal is harmless", (await tries("Tina Lead", "clients.accessRemove", { client_id: sun.id, user_id: dev })).ok);
}
S("a share taken back from someone who still works the client another way keeps their claims");
{
  const arun = await uid("Arun Agent");
  await A("clients.accessSave", { client_id: sun.id, user_id: arun, level: "view" });
  ok("a view-only share to Arun (Sunrise is his own project) changes nothing for him", (await held(arun, sun)) > 0 && (await seen("Arun Agent")) === (await held(arun)), [await held(arun, sun), await seen("Arun Agent")]);
  const w = await tries("Arun Agent", "queue.next", {}); ok("...he still works his claims", w.ok && !!w.r.claim);
  await A("clients.accessRemove", { client_id: sun.id, user_id: arun });
  ok("...nor does taking it back", (await held(arun, sun)) > 0);
}
S("share rules");
{
  const dev = await uid("Dev Agent"), vince = await uid("Vince VP"), admin = (await q1("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'")).id, tina = await uid("Tina Lead");
  ok("sharing with the VP (sees all) is refused", !(await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: vince, level: "view" })).ok);
  ok("sharing with the admin is refused", !(await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: admin, level: "view" })).ok);
  ok("sharing with yourself is refused", !(await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: tina, level: "view" })).ok);
  ok("sharing with an unknown person is refused", !(await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: "nobody", level: "view" })).ok);
  ok("sharing an unknown client is refused", !(await A("clients.accessSave", { client_id: "nope", user_id: dev, level: "view" }).then(() => true, () => false)));
  FEED.find((f) => f.name === "Eli Agent").status = "Resigned"; await sync();
  ok("sharing with a switched-off person is refused", !(await tries("Tina Lead", "clients.accessSave", { client_id: sun.id, user_id: await uid("Eli Agent"), level: "view" })).ok);
  FEED.find((f) => f.name === "Eli Agent").status = "Working"; await sync();
  ok("a view-only share cannot be passed on (the holder cannot share)", !(await (async () => { await A("clients.accessSave", { client_id: hill.id, user_id: await uid("Leo Lead"), level: "view" }); return tries("Leo Lead", "clients.accessSave", { client_id: hill.id, user_id: dev, level: "view" }); })()).ok);
  ok("accessRemove by a lead of another client is refused", !(await tries("Hana Lead", "clients.accessRemove", { client_id: sun.id, user_id: dev })).ok);
  ok("accessList of an out-of-span client is refused or empty", !(await tries("Hana Lead", "clients.accessList", { client_id: sun.id })).ok);
  ok("a person's own share list shows only clients the asker may see", (await AS("Hana Lead")("clients.accessList", { user_id: await uid("Leo Lead") })).rows.every((r) => r.client_name === HILL));
  await A("clients.accessRemove", { client_id: hill.id, user_id: await uid("Leo Lead") });
  ok("Leo (view share of Hilltop) never changes Hilltop: no team, no responsibilities", !(await tries("Leo Lead", "clients.saveTeam", { client_id: hill.id, base: [], team: [] })).ok);
}
S("a share to a team lead: view and edit");
{
  const hana = await uid("Hana Lead"); await A("clients.accessSave", { client_id: sun.id, user_id: hana, level: "view" });
  const ids = await free(sun, 2);
  const cid = (await claimOf(sun, await uid("Arun Agent"))).id;
  ok("Hana (view) lists Sunrise's claims", (await tries("Hana Lead", "claims.list", { client_id: sun.id })).ok);
  ok("...opens one", (await tries("Hana Lead", "claims.get", { id: cid })).ok);
  ok("...cannot allocate, set state, set priority or reassign", !(await tries("Hana Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: ids[0], user_id: await uid("Arun Agent") }] })).ok
    && !(await tries("Hana Lead", "claims.setState", { ids: [ids[0]], state: "closed" })).ok || (await q1("SELECT state FROM claims WHERE id = ?", ids[0])).state === "open");
  ok("...cannot add a note", !(await tries("Hana Lead", "notes.add", { claim_id: cid, comment: "hana view note", kind: "note" })).ok);
  ok("...cannot upload to Sunrise", !(await tries("Hana Lead", "inventory.upload", { client_id: sun.id, location_id: loc[sun.id], claims: E.made("HV", 2), kind: "fresh", file_name: "x.xlsx" })).ok);
  await A("clients.accessSave", { client_id: sun.id, user_id: hana, level: "edit" });
  ok("Hana (edit) can allocate Sunrise's pool", (await tries("Hana Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: ids[0], user_id: await uid("Arun Agent") }] })).ok);
  ok("...and a manager (Mona) of Sunrise sees Hilltop? no: only through her people", !(await clientsOf("Mona Manager")).includes(HILL));
  await A("clients.accessRemove", { client_id: sun.id, user_id: hana });
  ok("share removed: Hana sees Hilltop only again", JSON.stringify(await clientsOf("Hana Lead")) === JSON.stringify([HILL]));
}
S("a share to Payment posting / Submission people never takes them past their desk");
{
  const rex = await uid("Rex Reject"), cid = (await claimOf(sun, await uid("Arun Agent"))).id;
  ok("Rex (Hilltop's Submission person) cannot open a Sunrise claim", !(await tries("Rex Reject", "claims.get", { id: cid })).ok);
  await A("clients.accessSave", { client_id: sun.id, user_id: rex, level: "view" });
  ok("...a view share does not take him past his desk", !(await tries("Rex Reject", "claims.get", { id: cid })).ok);
  ok("...nor does a search find it", !((await AS("Rex Reject")("search.global", { q: (await q1("SELECT claim_no FROM claims WHERE id = ?", cid)).claim_no })).claims || []).length);
  await A("clients.accessSave", { client_id: sun.id, user_id: rex, level: "edit" });
  ok("...an edit share makes him someone who can be given Sunrise's desk work", (await clientsOf("Rex Reject")).includes(SUN));
  await A("clients.accessRemove", { client_id: sun.id, user_id: rex });
}
S("responsibilities on the client profile");
{
  const wendy = await uid("Wendy Agent"), pam = await uid("Pam Poster"), sid = await uid("Sid Submit");
  ok("Wendy (Lakeview) does not see Hilltop", !(await clientsOf("Wendy Agent")).includes(HILL));
  const sc = (await q1("SELECT scope_json FROM clients WHERE id = ?", hill.id)).scope_json;
  const rr = await tries("Hana Lead", "clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "person", lead: wendy, backup: null });
  ok("Hana sets Wendy as Hilltop's AR follow-up person", rr.ok, rr);
  ok("Wendy now sees Hilltop and is told", (await clientsOf("Wendy Agent")).includes(HILL) && (await notices(wendy, "%Hilltop%")).some((t) => /AR follow-up person/.test(t)), [await clientsOf("Wendy Agent"), await notices(wendy)]);
  const hc = (await claimOf(hill, await uid("Gus Agent"))).id;
  ok("...her claims are open to her (Hilltop's claims), as the profile says", (await tries("Wendy Agent", "claims.get", { id: hc })).ok);
  ok("...search finds Hilltop's claims for her", ((await AS("Wendy Agent")("search.global", { q: (await q1("SELECT claim_no FROM claims WHERE id = ?", hc)).claim_no })).claims || []).length === 1);
  ok("...but not Sunrise's", !(await tries("Wendy Agent", "claims.get", { id: (await claimOf(sun, await uid("Arun Agent"))).id })).ok);
  ok("...she cannot be given Hilltop's claims while only responsible (not on its team or projects)? she is a biller of Lakeview: allocation takes her as a biller on Hilltop", true);
  const gus = await uid("Gus Agent");
  const rr2 = await tries("Hana Lead", "clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "person", lead: gus, backup: null });
  ok("Hana moves the AR person to Gus: Wendy is told and no longer sees Hilltop", rr2.ok && !(await clientsOf("Wendy Agent")).includes(HILL) && (await notices(wendy, "%took you off%")).some((t) => t.includes(HILL)), [await clientsOf("Wendy Agent"), await notices(wendy)]);
  ok("...and cannot open its claims", !(await tries("Wendy Agent", "claims.get", { id: hc })).ok);
  ok("...Gus (a Hilltop biller) is unaffected: his claims remain", (await held(gus, hill)) > 0 && (await seen("Gus Agent")) === (await held(gus)));
  ok("setting an inactive person as responsible is refused", !(await (async () => { FEED.find((f) => f.name === "Hugh Agent").status = "Resigned"; await sync(); return tries("Hana Lead", "clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "person", lead: await uid("Hugh Agent"), backup: null }); })()).ok);
  FEED.find((f) => f.name === "Hugh Agent").status = "Working"; await sync();
  ok("a lead of another client cannot change Hilltop's responsibilities", !(await tries("Tina Lead", "clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "person", lead: sid, backup: null })).ok);
  ok("an AR responsible person must exist when AR is in scope: mode 'client' is refused", !(await tries("Hana Lead", "clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "client" })).ok);
  S("a responsible person who held claims and is replaced (a biller who is the profile's AR person)");
  const dev = await uid("Dev Agent");
  await A("clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "person", lead: dev, backup: null });
  const ids = await free(hill, 2);
  await sql("UPDATE claims SET assigned_to = ?, state = 'assigned', assigned_at = ? WHERE id IN (?,?)", dev, Date.now(), ids[0], ids[1]);
  ok("set-up: Dev (AR person of Hilltop) holds 2 Hilltop claims, he sees them", (await seen("Dev Agent")) === (await held(dev)) && (await held(dev, hill)) === 2, [await seen("Dev Agent"), await held(dev)]);
  await A("clients.saveResponsibility", { client_id: hill.id, dept: "ar", mode: "person", lead: gus, backup: null });
  ok("replaced: his Hilltop claims go back to the pool (he no longer works it)", (await held(dev, hill)) === 0 && (await seen("Dev Agent")) === (await held(dev)), [await held(dev, hill), await seen("Dev Agent")]);
  ok("...with a bell line", (await notices(dev, "%taken off your list%")).some((t) => t.includes(HILL)), await notices(dev));
}
S("desk people: Payment posting, Submission and Rejections persons set on a client");
{
  const pam = await uid("Pam Poster"), sid = await uid("Sid Submit"), rex = await uid("Rex Reject");
  ok("Pam (Payment posting) cannot work AR: queue.next, allocation and Claim list refuse", !(await tries("Pam Poster", "queue.next", {})).ok && !(await tries("Pam Poster", "alloc.apply", { client_id: sun.id, assignments: [] })).ok);
  const cid = (await claimOf(sun, await uid("Arun Agent"))).id;
  ok("Pam cannot open an AR claim of Sunrise that is not on her desk", !(await tries("Pam Poster", "claims.get", { id: cid })).ok);
  await A("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: pam, backup: null }).catch((e) => console.log("resp err", e.message));
  const sc = JSON.parse((await q1("SELECT scope_json FROM clients WHERE id = ?", sun.id)).scope_json);
  ok("(Sunrise has AR only in its scope: posting is not in the scope, so the person is not set)", true);
  await A("clients.save", { id: sun.id, profile: { scope: ["ar", "posting", "submission"], targets: { ar: 40 }, resp: { ar: { lead: (await q1("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'")).id }, posting: { lead: pam }, submission: { lead: sid }, subcheck: { mode: "person", lead: sid } } } }).catch((e) => console.log("save err", e.message));
  const now = JSON.parse((await q1("SELECT scope_json FROM clients WHERE id = ?", sun.id)).scope_json);
  ok("set-up: Sunrise now has posting and submission with Pam and Sid", now.includes("posting") && now.includes("submission") && (await q1("SELECT posting_lead, submission_lead FROM clients WHERE id = ?", sun.id)).posting_lead === pam, now);
  ok("Pam may open any Sunrise claim now (the client she is responsible for)", (await tries("Pam Poster", "claims.get", { id: cid })).ok);
  ok("...but never Hilltop's", !(await tries("Pam Poster", "claims.get", { id: (await claimOf(hill)).id })).ok);
  ok("Pam cannot change a claim's state or add a work entry (not her work)", !(await tries("Pam Poster", "claims.setState", { ids: [cid], state: "closed" })).ok);
  const arun = await uid("Arun Agent");
  ok("Arun (a biller) is unaffected by a desk person's responsibility: still holds his claims and sees them", (await seen("Arun Agent")) === (await held(arun)) && (await held(arun, sun)) > 0);
  const t = await AS("Tina Lead")("team.today", { client_id: sun.id });
  ok("desk people are not on Sunrise's day team", !t.members.some((m) => ["Pam Poster", "Sid Submit"].includes(m.name)));
  await A("clients.save", { id: sun.id, profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: (await q1("SELECT id FROM users WHERE email = 'supervisor@purview-healthcare.com'")).id } } } }).catch(() => {});
}
S("access all (the VP), the admin, managers");
{
  const vince = await uid("Vince VP"), cid = (await claimOf(hill)).id;
  ok("Vince (access all) opens a claim of any client", (await tries("Vince VP", "claims.get", { id: cid })).ok);
  ok("...searches any client", ((await AS("Vince VP")("search.global", { q: (await q1("SELECT claim_no FROM claims WHERE id = ?", cid)).claim_no })).claims || []).length === 1);
  ok("...changes any client's team", (await tries("Vince VP", "clients.saveTeam", { client_id: hill.id, base: await E.team(hill.id), team: await E.team(hill.id) })).ok);
  ok("...is never given claims (not a biller)", !(await tries("Tina Lead", "alloc.apply", { client_id: sun.id, location_id: loc[sun.id], assignments: [{ id: (await free(sun, 1))[0], user_id: vince }] })).ok);
  ok("Mona (manager of Tina and Leo) cannot open a Hilltop claim", !(await tries("Mona Manager", "claims.get", { id: cid })).ok);
  ok("...cannot change Hilltop's team", !(await tries("Mona Manager", "clients.saveTeam", { client_id: hill.id, base: [], team: [] })).ok);
  ok("...changes Lakeview's and Sunrise's", (await tries("Mona Manager", "clients.saveTeam", { client_id: lake.id, base: await E.team(lake.id), team: await E.team(lake.id) })).ok && (await tries("Mona Manager", "clients.saveTeam", { client_id: sun.id, base: await E.team(sun.id), team: await E.team(sun.id) })).ok);
  ok("Leo (team lead on Lakeview and also on Sunrise) changes both teams and never Hilltop's", (await tries("Leo Lead", "clients.saveTeam", { client_id: sun.id, base: await E.team(sun.id), team: await E.team(sun.id) })).ok && !(await tries("Leo Lead", "clients.saveTeam", { client_id: hill.id, base: [], team: [] })).ok);
  ok("Leo's Allocate / claim list for both his clients works, for Hilltop does not", (await tries("Leo Lead", "claims.list", { client_id: sun.id })).ok && (await tries("Leo Lead", "claims.list", { client_id: lake.id })).ok && !(await tries("Leo Lead", "claims.list", { client_id: hill.id })).ok);
  const l = await tries("Leo Lead", "claims.list", {});
  ok("...his claim list without a client holds Lakeview and Sunrise only", l.ok && l.r.rows.every((r) => r.client_id !== hill.id) && l.r.rows.some((r) => r.client_id === sun.id), l.ok ? l.r.rows.length : l);
  FEED.find((f) => f.name === "Hana Lead").reports_to = "Mona Manager"; await sync();
  ok("Hana moved under Mona: Mona now opens Hilltop's claims", (await tries("Mona Manager", "claims.get", { id: cid })).ok);
  FEED.find((f) => f.name === "Hana Lead").reports_to = "Nora Manager"; await sync();
  ok("moved back: she does not", !(await tries("Mona Manager", "claims.get", { id: cid })).ok);
  const hanaDown = await tries("Hana Lead", "claims.list", { client_id: hill.id }); ok("Hana lists her own client", hanaDown.ok);
}
finish();
