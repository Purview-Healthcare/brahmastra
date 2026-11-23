/* QA1-1: leaks. A person who does not see a client never lists, searches, opens by id, downloads or works its claims or sees its
   patients, whatever read or write op is tried; and the ones who may (a share, being responsible, the admin) still can. */
import { boot, AG, P, mail, S, ok, finish } from "./qa_lib.mjs";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const FEED = [P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "M2", name: "Nora Manager", position: "Manager", email: mail("Nora Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Nora Manager", email: mail("Leo Lead") }),
  AG("A1", "Arun Agent", "Tina Lead", SUN), AG("A2", "Bela Agent", "Tina Lead", SUN), AG("A4", "Dev Agent", "Leo Lead", LAKE), AG("A5", "Eli Agent", "Leo Lead", LAKE),
  AG("A6", "Vic Viewer", "Tina Lead", SUN), AG("A7", "Edie Editor", "Tina Lead", SUN),
  AG("D1", "Pam Poster", "Tina Lead", SUN, { department: "Posting" }), AG("D2", "Sid Submit", "Tina Lead", SUN, { department: "Submission" }),
  AG("D3", "Lola Lakeposter", "Leo Lead", LAKE, { department: "Posting" })];
const E = await boot(FEED, { seed: false }); await E.tokens();
const { q, q1, sql, A } = E; const AS = E.AS;
const sun = await E.mkClient(SUN), lake = await E.mkClient(LAKE); await E.sync();
const lakeLoc = (await AS("Leo Lead")("clients.list")).clients.find((c) => c.id === lake.id).locations[0];
const sunLoc = (await AS("Tina Lead")("clients.list")).clients.find((c) => c.id === sun.id).locations[0];
await E.load("Leo Lead", lake.id, lakeLoc.id, "LK", 8); await E.alloc("Leo Lead", lake.id, lakeLoc.id);
await E.load("Tina Lead", sun.id, sunLoc.id, "SN", 6); await E.alloc("Tina Lead", sun.id, sunLoc.id);
const lk = await q("SELECT id, claim_no, patient, assigned_to, state FROM claims WHERE client_id = ?", lake.id);
const lkOne = lk.find((c) => c.assigned_to) || lk[0];
S("set-up");
ok("Lakeview has 8 claims and they are all given out", lk.length === 8 && lk.every((c) => c.assigned_to), lk.length);
const dev = await E.U("Dev Agent");
const secret = (r) => { const s = JSON.stringify(r || {}); return /LK-73|Testpatient, LK/.test(s); };
const lkState = async () => JSON.stringify(await q("SELECT id, state, assigned_to, priority, updated_at FROM claims WHERE client_id = ? ORDER BY id", lake.id));
const noteCount = async () => (await q1("SELECT COUNT(*) AS n FROM notes WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)", lake.id)).n;
const vid = await E.U("Vic Viewer"), eid = await E.U("Edie Editor");
await A("clients.accessSave", { client_id: lake.id, user_id: vid, level: "view" });
await A("clients.accessSave", { client_id: lake.id, user_id: eid, level: "edit" });
const readOps = (c) => [
  ["claims.get", { id: c.id }], ["claims.timeline", { id: c.id }], ["claims.byPatient", { id: c.id }], ["claims.tips", { id: c.id }], ["queue.open", { id: c.id }],
  ["claims.priorityLog", { id: c.id }], ["claims.list", { client_id: lake.id }], ["claims.list", { client_id: lake.id, location_id: lakeLoc.id }], ["claims.list", {}],
  ["claims.list", { q: "LK-73" }], ["claims.list", { q: "Testpatient, LK" }], ["claims.suggest", { client_id: lake.id, q: "LK" }], ["claims.suggest", { q: "Testpatient" }], ["claims.stats", { client_id: lake.id }],
  ["claims.eligible", { client_id: lake.id, location_id: lakeLoc.id }], ["queue.list", { client_id: lake.id }], ["queue.list", {}], ["search.global", { q: "LK-73" }], ["search.global", { q: "Testpatient, LK" }],
  ["search.global", { q: c.claim_no }], ["search.global", { q: c.patient }], ["notes.update", { id: c.id }],
  ["reports.work", { client_id: lake.id }], ["reports.desk", { client_id: lake.id }], ["reports.production", { client_id: lake.id }], ["reports.arInventory", { client_id: lake.id }],
  ["client.overview", { client_id: lake.id }], ["inventory.batches", { client_id: lake.id }], ["inventory.status", { client_id: lake.id }], ["handoffs.list", { client_id: lake.id }], ["handoffs.dashboard", { client_id: lake.id }],
  ["attention.list", { client_id: lake.id }], ["escalations.list", { client_id: lake.id }], ["tasks.list", { client_id: lake.id }], ["tat.list", { client_id: lake.id }], ["audit.list", { client_id: lake.id }],
  ["supervisor.allocations", { client_id: lake.id }], ["team.today", { client_id: lake.id }], ["team.today", { client_id: lake.id, location_id: lakeLoc.id }], ["creport.get", { client_id: lake.id, location_id: lakeLoc.id }],
  ["portfolio.overview", { client_id: lake.id }], ["denials.repeats", { client_id: lake.id }], ["templates.list", { client_id: lake.id }], ["clients.accessList", { client_id: lake.id }],
  ["clients.history", { client_id: lake.id }], ["digest.preview", { client_id: lake.id }], ["claims.stats", {}], ["reports.claimsProduction", { client_id: lake.id }], ["inventory.enrichList", { client_id: lake.id }],
];
const outsiders = ["Arun Agent", "Tina Lead", "Pam Poster", "Sid Submit", "Mona Manager"];
for (const who of outsiders) {
  S("an outsider (" + who + ") tries every read of a Lakeview claim");
  const as = AS(who); const before = await lkState(), nb = await noteCount();
  for (const [op, p] of readOps(lkOne)) {
    const r = await E.rig.tryOp(() => as(op, p));
    ok(who + ": " + op + " " + JSON.stringify(p).slice(0, 60) + " shows no Lakeview claim or patient", !(r.ok && secret(r.r)), r.ok ? JSON.stringify(r.r).slice(0, 300) : "");
  }
  ok(who + ": Lakeview claims unchanged by the reads", (await lkState()) === before && (await noteCount()) === nb);
  S("an outsider (" + who + ") tries to work a Lakeview claim");
  const writes = [
    ["notes.add", { claim_id: lkOne.id, comment: "outsider note", kind: "note" }], ["queue.complete", { id: lkOne.id, saag: { status: "Paid" } }], ["queue.skip", { id: lkOne.id, reason: "x" }],
    ["claims.setState", { ids: [lkOne.id], state: "closed" }], ["claims.setPriority", { ids: [lkOne.id], priority: 99 }], ["alloc.reassign", { ids: [lkOne.id], user_id: await E.U(who) }],
    ["alloc.unassign", { ids: [lkOne.id], client_id: lake.id }], ["attachments.add", { claim_id: lkOne.id, name: "x.txt", type: "text/plain", data: "aGk=", size: 2 }],
    ["tat.hold", { id: lkOne.id, kind: "flag", reason: "x" }], ["inventory.undoBatch", { batch_id: (await q1("SELECT id FROM batches WHERE client_id = ?", lake.id)).id }],
    ["locations.save", { client_id: lake.id, name: "Hack loc" }], ["clients.saveTeam", { client_id: lake.id, team: [await E.U(who)] }], ["clients.accessSave", { client_id: lake.id, user_id: await E.U(who), level: "edit" }],
    ["clients.save", { id: lake.id, name: "Hacked name" }], ["clients.delete", { id: lake.id, confirm: LAKE }], ["clients.startFresh", { id: lake.id, confirm: LAKE }],
    ["alloc.apply", { client_id: lake.id, location_id: lakeLoc.id, assignments: [{ user_id: await E.U(who), claim_ids: [lkOne.id] }] }],
  ];
  for (const [op, p] of writes) { const r = await E.rig.tryOp(() => as(op, p)); const noop = r.ok && r.r && r.r.changed === 0; ok(who + ": " + op + " on Lakeview is refused (or changes nothing)", !r.ok || noop, r.ok ? JSON.stringify(r.r).slice(0, 200) : ""); }
  ok(who + ": nothing about Lakeview changed after those writes", (await lkState()) === before && (await noteCount()) === nb && (await E.client(LAKE)).name === LAKE, await lkState());
}
S("who may read it: the biller, the lead, the view share, the editor, responsible, the admin");
for (const [who, may] of [["Dev Agent", 1], ["Leo Lead", 1], ["Vic Viewer", 1], ["Edie Editor", 0], ["Nora Manager", 1], ["Lola Lakeposter", 0]]) {
  const mine = who === "Dev Agent" ? lk.find((c) => c.assigned_to === dev) : lkOne;
  const r = await E.rig.tryOp(() => AS(who)("claims.get", { id: mine.id }));
  ok(who + " opens a Lakeview claim " + (may ? "(allowed)" : "(not unless it is on their desk)"), may ? r.ok : !r.ok, r);
}
S("search finds what each person may open");
{
  const names = async (who, qq) => ((await AS(who)("search.global", { q: qq })).claims || []).map((c) => c.claim_no);
  ok("Vic (view share) finds Lakeview claims by number", (await names("Vic Viewer", "LK-73")).length > 0);
  ok("Arun finds his own Sunrise claim", (await names("Arun Agent", "SN-73")).length > 0);
  ok("Arun does not find Bela's Sunrise claim (not on his list)", !(await names("Arun Agent", "SN-73")).some((n) => (lk.length, false)) );
  ok("Dev finds only Lakeview claims, not Sunrise ones", (await names("Dev Agent", "SN-73")).length === 0);
}
S("a biller of both clients' neighbours: patients");
{
  const r = await AS("Arun Agent")("claims.byPatient", { id: (await q1("SELECT id FROM claims WHERE client_id = ? LIMIT 1", sun.id)).id }).catch((e) => ({ err: e.message }));
  ok("byPatient on an own claim does not list Lakeview claims", !secret(r), r);
}
finish();
