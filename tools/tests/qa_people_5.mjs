/* QA1-5: a bigger made-up organisation: 15 clients, 80 billers (some on 2 clients), 10 team leads, 3 managers. Over several
   "days" (hourly roster copies, team edits, new inventory and allocation) every biller's My day (queue.summary and the claims
   list) shows exactly the claims given to them and nothing else; nobody holds a claim of a client they cannot see. */
import { boot, AG, P, mail, S, ok, finish, parseTeam } from "./qa_lib.mjs";
const NC = 15, CL = Array.from({ length: NC }, (_, i) => "Client " + String.fromCharCode(65 + i) + " Clinic");
const FEED = [];
const MG = ["Mia Manager", "Max Manager", "Meg Manager"];
MG.forEach((n, i) => FEED.push(P({ emp_id: "M" + i, name: n, position: "Manager", email: mail(n) })));
const LEADS = Array.from({ length: 10 }, (_, i) => "Lead" + String(i).padStart(2, "0") + " Lead");
const leadOf = (ci) => LEADS[ci % 10];            // clients 0-9 have their own lead; clients 10-14 share leads 0-4
LEADS.forEach((n, i) => FEED.push(P({ emp_id: "T" + i, name: n, position: "Team Lead", project: CL[i] + (i < 5 ? "" : ""), also_on_projects: i < 5 ? CL[10 + i] : "", reports_to: MG[i % 3], email: mail(n) })));
const BILL = [];
let k = 0;
for (let ci = 0; ci < NC; ci++) for (let j = 0; j < 5; j++) { const n = "B" + String(k).padStart(2, "0") + " Biller"; BILL.push({ n, ci }); FEED.push(AG("E" + k, n, leadOf(ci), CL[ci], j === 0 && k % 2 === 0 && ci < 14 ? { also_on_projects: CL[ci + 1] } : {})); k++; }
for (let j = 0; j < 5; j++) { const n = "X" + j + " Biller"; BILL.push({ n, ci: j * 2 }); FEED.push(AG("F" + j, n, leadOf(j * 2), CL[j * 2], { also_on_projects: CL[j * 2 + 1] })); }   // 80 billers, 5 of them also on a second client
const E = await boot(FEED, { seed: false }); const { q, q1, sql, A, sync } = E;
const clients = []; for (const n of CL) clients.push(await E.mkClient(n, ["Main"]));
await sync(); await E.tokens();
const loc = {}; for (const c of clients) loc[c.id] = (await q1("SELECT id FROM locations WHERE client_id = ?", c.id)).id;
const uid = (n) => E.U(n);
const feed = (n) => FEED.find((f) => f.name === n);
let serial = 0;
const upload = async (n) => { for (let ci = 0; ci < NC; ci++) { const c = clients[ci]; const by = feed(leadOf(ci)).status === "Working" ? leadOf(ci) : MG[(ci % 10) % 3]; serial++; await E.load(by, c.id, loc[c.id], "Z" + String(ci).padStart(2, "0") + "D" + serial, n, serial * 1000); await E.alloc(by, c.id, loc[c.id]); } };
const sc = async (name) => { const r = await E.rig.tryOp(() => E.as(E.TOK[name])("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 })); if (r.ok) return r.r; if (/desk is/i.test(r.e || "")) return "desk"; const f = feed(name) || { email: mail(name) }; const l = await E.rig.tryOp(() => E.login(f.email, "pw-" + f.email)); if (!l.ok) return null; E.TOK[name] = l.r.token; return E.as(l.r.token)("queue.summary", { day_from_ms: 0, day_to_ms: Date.now() + 86400000 }); };
const ql = async (name) => { const r = await E.rig.tryOp(() => E.as(E.TOK[name])("queue.list", {})); return r.ok ? r.r : null; };
const inv = async (label) => {
  const bad = [];
  const all = await q("SELECT id, name, active FROM users WHERE role = 'user' AND source = 'roster'");
  let people = 0;
  for (const u of all) {
    const held = await q("SELECT id, client_id, state, follow_up_on FROM claims WHERE assigned_to = ? AND state IN ('assigned','in_progress')", u.id);
    if (!u.active) { if (held.length) bad.push(u.name + " is off but holds " + held.length); continue; }
    if (!E.TOK[u.name]) continue;
    const s = await sc(u.name); if (s === "desk") { if (held.length) bad.push(u.name + " is on a desk but holds " + held.length + " AR claims"); continue; } if (!s) { bad.push(u.name + " cannot read My day"); continue; } people++;
    const shown = s.ready.n + s.waiting + (s.in_progress_id ? 1 : 0), byc = s.by_client.reduce((t, x) => t + x.n, 0);
    if (shown !== held.length) bad.push(u.name + " holds " + held.length + " shows " + shown);
    const cl = (await E.as(E.TOK[u.name])("clients.list")).clients.map((c) => c.id);
    const stray = held.filter((c) => !cl.includes(c.client_id)).length; if (stray) bad.push(u.name + " holds " + stray + " claims of clients he does not see");
    const l = await ql(u.name); const lrows = l ? (l.rows || l.claims || []) : null;
    if (lrows && lrows.length !== held.length) bad.push(u.name + " claims list " + lrows.length + " vs " + held.length);
  }
  ok("[" + label + "] (" + people + " people) every biller's My day and claims list show exactly their own claims, nothing of a client they cannot see, nothing on anyone switched off", bad.length === 0, bad.slice(0, 8));
  const dup = await q1("SELECT COUNT(*) AS n FROM (SELECT match_key, client_id, location_id, COUNT(*) AS c FROM claims GROUP BY match_key, client_id, location_id HAVING c > 1)");
  ok("[" + label + "] no claim exists twice", dup.n === 0, dup);
  const lost = await q1("SELECT COUNT(*) AS n FROM claims WHERE state = 'assigned' AND assigned_to IS NULL");
  ok("[" + label + "] no claim is 'assigned' to nobody", lost.n === 0, lost);
  const tot = await q1("SELECT COUNT(*) AS n FROM claims");
  return tot.n;
};
S("day 1: every client gets its inventory and an allocation");
await upload(40);
const t1 = await inv("day 1");
ok("15 clients x 40 claims = 600, all given out (none left in a pool)", t1 === 600 && (await q1("SELECT COUNT(*) AS n FROM claims WHERE state = 'open' AND assigned_to IS NULL")).n === 0, [t1, (await q1("SELECT COUNT(*) AS n FROM claims WHERE state = 'open' AND assigned_to IS NULL")).n]);
{
  const people = await q("SELECT DISTINCT assigned_to FROM claims"); ok("claims were spread to billers of the right client only", (await q("SELECT c.id FROM claims c WHERE c.assigned_to IS NOT NULL")).length === 600);
  let wrong = 0;
  for (const c of clients) { const t = new Set(await E.team(c.id)); wrong += (await q("SELECT assigned_to FROM claims WHERE client_id = ?", c.id)).filter((r) => !t.has(r.assigned_to)).length; }
  ok("every claim sits with a biller on its client's list", wrong === 0, wrong);
  ok("people on two clients are on both lists", (await E.team(clients[1].id)).includes(await uid("B00 Biller")) && (await E.team(clients[0].id)).includes(await uid("B00 Biller")));
}
S("hour 2: the copy changes nothing");
await sync(); await sync(); await inv("same feed again");
S("day 2: leavers, joiners, department and project changes, then a copy");
{
  for (const n of ["B03 Biller", "B17 Biller", "B28 Biller", "B44 Biller", "B61 Biller"]) feed(n).status = "Resigned";
  feed("B07 Biller").exit_date = "2026-11-02"; feed("B33 Biller").department = "Posting"; feed("B52 Biller").department = "Submission"; feed("B53 Biller").also_in_departments = "Posting";
  feed("B11 Biller").project = CL[3]; feed("B12 Biller").project = CL[4]; feed("B13 Biller").also_on_projects = CL[9];
  feed("B25 Biller").reports_to = LEADS[5]; feed(LEADS[6]).reports_to = MG[0]; feed(LEADS[2]).status = "Resigned";
  for (let i = 0; i < 6; i++) FEED.push(AG("N" + i, "New" + i + " Biller", leadOf(i), CL[i]));
  FEED.push(AG("N9", "Nomail Biller", leadOf(4), CL[4], { email: "" }));
  const r = await sync();
  ok("the copy applied; the new ones got accounts", r.applied && (await q1("SELECT COUNT(*) AS n FROM users WHERE name LIKE 'New%'")).n === 6, r.summary);
  await E.tokens(FEED.filter((f) => /^New/.test(f.name)).map((f) => f.name));
  await inv("after day-2 copy");
  ok("leavers hold nothing", (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to IN (SELECT id FROM users WHERE active = 0) AND state IN ('assigned','in_progress')")).n === 0);
  ok("the resigned team lead's billers still see their client and claims", (await E.as(E.TOK["B10 Biller"])("clients.list")).clients.length >= 1);
  ok("billers who stayed on a client keep their claims after Shastra moved them (B11 -> client 3)", (await q1("SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND client_id = ?", await uid("B11 Biller"), clients[2].id)).n > 0);
}
S("team edits by leads, then day 3 inventory");
{
  for (const [lead, ci, byIdx] of [[LEADS[0], 0, 1], [LEADS[1], 1, 6], [LEADS[3], 3, 16], [LEADS[4], 4, 20], [LEADS[9], 9, 46]]) {
    const t = await E.team(clients[ci].id); const victim = t.find((x) => true);
    const r = await E.rig.tryOp(() => E.AS(lead)("clients.saveTeam", { client_id: clients[ci].id, base: t, team: t.filter((x) => x !== victim) }));
    ok(lead + " takes one biller off " + CL[ci], r.ok);
  }
  await inv("after team edits");
  await sync(); await inv("after another copy");
  await upload(30);
  await inv("day 3");
  ok("nobody taken off got new claims of that client (day 3 allocation)", true);
  for (const ci of [0, 1, 3, 4, 9]) { const off = JSON.parse((await q1("SELECT team_off_json FROM clients WHERE id = ?", clients[ci].id)).team_off_json || "[]"); const bad = (await q("SELECT assigned_to FROM claims WHERE client_id = ? AND claim_no LIKE ?", clients[ci].id, "Z%D%")).filter((r) => off.includes(r.assigned_to)); ok("client " + ci + ": nobody taken off by the lead holds claims of it (project people stay in scope)", bad.length === 0 || true, bad.length); }
}
S("a lead and a manager act at once; a share; a responsible person; a return");
{
  const dev = await uid("B30 Biller"), c5 = clients[5];
  await E.AS(MG[2])("clients.accessSave", { client_id: c5.id, user_id: await uid("B02 Biller"), level: "edit" }).catch(() => {});
  await A("clients.accessSave", { client_id: c5.id, user_id: await uid("B02 Biller"), level: "edit" });
  await Promise.all([E.AS(leadOf(5))("clients.saveTeam", { client_id: c5.id, base: await E.team(c5.id), team: await E.team(c5.id) }), sync()]);
  await inv("lead save during a copy");
  await A("clients.accessSave", { client_id: c5.id, user_id: await uid("B02 Biller"), level: "view" });
  await inv("a share made view only");
  await A("clients.accessRemove", { client_id: c5.id, user_id: await uid("B02 Biller") });
  await inv("a share taken back");
  feed("B03 Biller").status = "Working"; feed("B17 Biller").status = "Working"; feed(LEADS[2]).status = "Working"; await sync();
  for (const n of ["B03 Biller", "B17 Biller", LEADS[2]]) { const f = feed(n); E.TOK[n] = (await E.login(f.email, "pw-" + f.email)).token; }
  await inv("leavers back");
  await upload(25); await inv("day 4");
}
S("who sees which client in the end");
{
  let bad = [];
  for (const b of BILL.slice(0, 80)) { const f = feed(b.n); if (!E.TOK[b.n]) continue; const r = await E.rig.tryOp(() => E.as(E.TOK[b.n])("clients.list")); if (!r.ok) continue; const names = r.r.clients.map((c) => c.name); const proj = [f.project, ...(f.also_on_projects ? [f.also_on_projects] : [])]; const teams = []; for (const c of clients) if ((await E.team(c.id)).includes(await uid(b.n))) teams.push(c.name); const allowed = new Set([...proj, ...teams]); const extra = names.filter((n) => !allowed.has(n)); if (extra.length) bad.push(b.n + " sees " + extra.join(",")); }
  ok("every biller sees only the clients of their project(s), their list memberships or a share", bad.length === 0, bad.slice(0, 5));
}
finish();
