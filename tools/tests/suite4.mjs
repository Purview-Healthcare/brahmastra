/* Suite 4: hierarchy spans, crossover shares (view / edit) and the RACI tracker. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)))); };
const P = (o) => ({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o));
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "M2", name: "Sandesh Manager", position: "Manager", reports_to: "Sasha Vice", email: "sandesh@purview-healthcare.com" }),
  P({ emp_id: "M3", name: "Sweety Manager", position: "Manager", reports_to: "Sasha Vice", email: "sweety@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Sandesh Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sam Sme", position: "SME", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "sam@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" })];
const fetchMock = async (url) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  SD = await firstIn("Sandesh Manager", "sandesh@purview-healthcare.com"), SW = await firstIn("Sweety Manager", "sweety@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com"),
  SM = await firstIn("Sam Sme", "sam@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const allClients = (await A("clients.list")).clients;
const sun = allClients.find((c) => /Sunrise/.test(c.name)), lake = allClients.find((c) => /Lakeview/.test(c.name));
const namesOf = async (X) => (await X("clients.list")).clients.map((c) => c.name).sort();

S("Spans follow the Shastra hierarchy");
ok("the VP sees every client", (await namesOf(SA)).length === allClients.length);
ok("Joseph (manager) sees his span's client only: Sunrise", String(await namesOf(JO)) === sun.name, await namesOf(JO));
ok("Sandesh sees Lakeview only", String(await namesOf(SD)) === lake.name, await namesOf(SD));
ok("Sweety (no span yet) sees no clients", (await namesOf(SW)).length === 0, await namesOf(SW));
ok("Tina (TL) sees her own client only", String(await namesOf(TI)) === sun.name, await namesOf(TI));
ok("Sam (SME) sees his project's client", String(await namesOf(SM)) === sun.name, await namesOf(SM));
let r = await T(async () => TI("claims.list", { client_id: lake.id }));
ok("Tina cannot open the other span's claims", !r.ok && /not one of yours/i.test(r.e), r);
const tiClaims = await TI("claims.list", { page_size: 5 });
ok("Tina's claim list is Sunrise only", tiClaims.rows.length > 0 && tiClaims.rows.every((c) => c.client_id === sun.id), tiClaims.rows.length);
const dir = await TI("users.directory");
ok("the directory reaches outside her span (for sharing)", dir.people.some((p) => p.name === "Leo Lead") && dir.people.some((p) => p.name === "Bela Agent"), dir.people.length);

S("Crossover share, view only");
r = await T(async () => TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "view" }));
ok("Tina shares Sunrise with Leo, view only", r.ok, r);
ok("Leo now sees both clients", (await namesOf(LE)).length === 2, await namesOf(LE));
const leoSun = (await LE("clients.list")).clients.find((c) => c.id === sun.id);
ok("marked view only for him (can_edit false), share listed", leoSun && leoSun.can_edit === false && leoSun.access.some((a) => a.user_id === U("Leo Lead").id && a.level === "view"), leoSun && [leoSun.can_edit, leoSun.access]);
const leoClaims = await LE("claims.list", { client_id: sun.id, page_size: 3 });
ok("he can read its claims", leoClaims.rows.length > 0);
r = await T(async () => LE("clients.save", { id: sun.id, name: sun.name, code: sun.code, follow_up_days: 30 }));
ok("but cannot edit the client", !r.ok && /view-only/i.test(r.e), r);
r = await T(async () => LE("inventory.upload", { client_id: sun.id, kind: "fresh", claims: [] }));
ok("cannot upload inventory to it", !r.ok && /view-only/i.test(r.e), r);
const sunOpen = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 5 })).rows;
r = await T(async () => LE("alloc.reassign", { ids: [sunOpen[0].id], user_id: U("Bela Agent").id }));
ok("allocation of its claims changes nothing for him", r.ok && r.r.changed === 0, r);
r = await T(async () => LE("clients.accessSave", { client_id: sun.id, user_id: U("Bela Agent").id, level: "view" }));
ok("a view-only share cannot be passed on", !r.ok && /view-only/i.test(r.e), r);
r = await T(async () => LE("raci.save", { client_id: sun.id, r: [] }));
ok("and cannot edit its RACI", !r.ok && /view-only/i.test(r.e), r);

S("Crossover share, can edit");
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "edit" });
r = await T(async () => LE("clients.save", { id: sun.id, name: sun.name, code: sun.code, follow_up_days: 30 }));
ok("upgraded to edit: he can change the client", r.ok, r);
r = await T(async () => LE("raci.save", { client_id: sun.id, r: [U("Arun Agent").id], a: [U("Tina Lead").id], c: [U("Joseph Manager").id], i: [] }));
ok("and can keep its RACI", r.ok, r);
r = await T(async () => TI("clients.accessRemove", { client_id: sun.id, user_id: U("Leo Lead").id }));
ok("Tina takes the share back", r.ok, r);
ok("Leo is back to his own span", (await namesOf(LE)).length === 1, await namesOf(LE));
r = await T(async () => SM("clients.accessSave", { client_id: sun.id, user_id: U("Leo Lead").id, level: "view" }));
ok("an SME cannot share a client", !r.ok && /team leads and up/i.test(r.e), r);

S("Crossover biller can be allocated");
await TI("clients.accessSave", { client_id: sun.id, user_id: U("Bela Agent").id, level: "edit" });
const tiPeople = (await TI("users.list")).users;
ok("the shared biller shows up for Tina's allocation", tiPeople.some((u) => u.name === "Bela Agent"), tiPeople.length);
r = await T(async () => TI("alloc.reassign", { ids: [sunOpen[1].id], user_id: U("Bela Agent").id }));
ok("Tina allocates a Sunrise claim to Bela", r.ok && r.r.changed === 1, r);
const bq = await BE("queue.list", {});
ok("Bela sees it on her desk", bq.rows.some((c) => c.id === sunOpen[1].id));

S("RACI tracker");
r = await T(async () => AR("raci.list"));
ok("billers have no RACI tracker", !r.ok, r);
const smr = await SM("raci.list");
ok("the SME reads it: his client, view only", smr.rows.length === 1 && smr.rows[0].client_id === sun.id && smr.rows[0].can_edit === false, smr.rows.map((x) => [x.client, x.can_edit]));
r = await T(async () => SM("raci.save", { client_id: sun.id, r: [] }));
ok("but cannot edit it", !r.ok && /team leads and up/i.test(r.e), r);
const sar = await SA("raci.list");
ok("the VP sees every client's row and can edit", sar.rows.length === allClients.length && sar.rows.every((x) => x.can_edit), sar.rows.length);
ok("the VP is named as always informed", sar.vp && sar.vp.name === "Sasha Vice", sar.vp);
const lakeRow = sar.rows.find((x) => x.client_id === lake.id);
ok("defaults from the roster: Bela responsible, Leo accountable, Sandesh consulted, Sasha informed",
  lakeRow.r.some((p) => p.name === "Bela Agent") && lakeRow.a.some((p) => p.name === "Leo Lead") && !lakeRow.a.some((p) => p.name === "Sam Sme") &&
  lakeRow.c.some((p) => p.name === "Sandesh Manager") && lakeRow.i.length === 1 && lakeRow.i[0].name === "Sasha Vice", lakeRow);
const sunRowT = (await TI("raci.list")).rows.find((x) => x.client_id === sun.id);
ok("Tina saw the row Leo saved earlier (Arun / Tina / Joseph)", sunRowT.saved && sunRowT.r.some((p) => p.name === "Arun Agent") && sunRowT.a.some((p) => p.name === "Tina Lead"), sunRowT);
r = await T(async () => TI("raci.save", { client_id: sun.id, r: [U("Arun Agent").id], a: [U("Tina Lead").id], c: [U("Joseph Manager").id], i: [U("Leo Lead").id, U("Bela Agent").id, U("Sweety Manager").id] }));
ok("Tina saves with three informed people", r.ok, r);
const sunRow2 = (await TI("raci.list")).rows.find((x) => x.client_id === sun.id);
ok("informed is capped at two, the VP always first", sunRow2.i.length === 2 && sunRow2.i[0].name === "Sasha Vice" && sunRow2.i[1].name === "Leo Lead", sunRow2.i);
ok("updated-by recorded", sunRow2.updated_by_name === "Tina Lead", sunRow2.updated_by_name);
r = await T(async () => TI("raci.save", { client_id: sun.id, r: [U("Arun Agent").id], a: [U("Tina Lead").id], c: [], i: [] }));
ok("clearing informed still keeps the VP", r.ok && (await TI("raci.list")).rows.find((x) => x.client_id === sun.id).i[0].name === "Sasha Vice", r);
r = await T(async () => TI("raci.save", { client_id: lake.id, r: [] }));
ok("Tina cannot save the other span's RACI", !r.ok, r);

S("Billers and hand-added accounts follow the hierarchy too");
ok("a biller's client list is their own project only", String(await namesOf(AR)) === sun.name, await namesOf(AR));
ok("the crossover biller sees her own client plus the shared one", (await namesOf(BE)).length === 2, await namesOf(BE));
r = await T(async () => A("users.save", { name: "Manu Lead", first_name: "Manu", last_name: "Lead", email: "manu@purview-healthcare.com", role: "supervisor", designation: "TL", projects: [{ name: "Lakeview Dental Group", share: null }], capacity: 35 }));
ok("admin adds a team lead by hand with a project", r.ok, r);
const fresh = async (name, email) => { const u = ((await A("users.list")).users).find((x) => x.name === name); await as(null)("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const MA = await fresh("Manu Lead", "manu@purview-healthcare.com");
ok("the hand-added lead sees only that project's client", String(await namesOf(MA)) === lake.name, await namesOf(MA));
r = await T(async () => MA("claims.list", { client_id: sun.id }));
ok("and cannot open the other span", !r.ok, r);
r = await T(async () => A("users.save", { name: "Boss Hand", first_name: "Boss", last_name: "Hand", email: "boss@purview-healthcare.com", role: "supervisor", capacity: 35 }));
ok("admin adds a supervisor by hand with no projects", r.ok, r);
const BO = await fresh("Boss Hand", "boss@purview-healthcare.com");
ok("with no projects they still see everything (bootstrap accounts keep working)", (await namesOf(BO)).length === allClients.length, await namesOf(BO));
r = await T(async () => TI("clients.accessRemove", { client_id: sun.id, user_id: U("Bela Agent").id }));
ok("Tina takes Bela's share back", r.ok, r);
ok("Bela is back to her own client", String(await namesOf(BE)) === lake.name, await namesOf(BE));
ok("but keeps working the claim already allocated to her", (await BE("queue.list", {})).rows.some((c) => c.id === sunOpen[1].id));

S("Missed tasks in the RACI tracker");
const sql = (q, ...a) => rig.backend.env.DB.prepare(q).bind(...a).run();
await TI("alloc.reassign", { ids: [sunOpen[2].id, sunOpen[3].id], user_id: U("Arun Agent").id });
await sql("UPDATE claims SET assigned_at = ? WHERE id IN (?, ?)", Date.now() - 2 * 86400000, sunOpen[2].id, sunOpen[3].id);
let rr = (await TI("raci.list")).rows.find((x) => x.client_id === sun.id);
ok("AR missed counts claims allocated before today and still not worked", rr.missed.ar === 2 && rr.missed.posting === 0 && rr.missed.submission === 0, rr.missed);
let md = await TI("raci.missed", { client_id: sun.id, kind: "ar" });
ok("the drop-down lists them with patient and biller", md.rows.length === 2 && md.rows.every((x) => x.patient && x.who === "Arun Agent"), md.rows.map((x) => [x.patient, x.who]));
await TI("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Tina Lead").id });
const pc = sunOpen[4];
await TI("alloc.reassign", { ids: [pc.id], user_id: U("Arun Agent").id });
const pdf = Buffer.from("%PDF-1.4 x").toString("base64");
await AR("attachments.add", { claim_id: pc.id, name: "eob.pdf", type: "application/pdf", data: pdf });
await AR("queue.complete", { id: pc.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Paid" }, note: { source: "Portal", findings: "Paid per the portal, EOB attached", action: "eob requested" } });
await sql("UPDATE handoffs SET due_at = ? WHERE claim_id = ?", Date.now() - 3600000, pc.id);
rr = (await TI("raci.list")).rows.find((x) => x.client_id === sun.id);
ok("an open posting hand-off past its 24h TAT counts as missed", rr.missed.posting === 1, rr.missed);
md = await TI("raci.missed", { client_id: sun.id, kind: "posting" });
ok("listed still open, with the patient", md.rows.length === 1 && md.rows[0].patient === pc.patient && !md.rows[0].done_at, md.rows.map((x) => [x.patient, x.status]));
const ph = (await TI("handoffs.list", { dept: "posting" })).rows.find((h) => h.claim_id === pc.id);
let rc = await T(async () => TI("handoffs.close", { id: ph.id, outcome: "complete", proof: { date: new Date().toISOString().slice(0, 10), ref: "CHK-9" } }));
ok("the lead closes it late", rc.ok, rc);
rr = (await TI("raci.list")).rows.find((x) => x.client_id === sun.id);
ok("finished late still counts as missed (30 days)", rr.missed.posting === 1, rr.missed);
md = await TI("raci.missed", { client_id: sun.id, kind: "posting" });
ok("now listed as finished, late by hours", md.rows.length === 1 && md.rows[0].done_at > 0, md.rows.map((x) => [x.status, x.done_at]));
rc = await T(async () => AR("raci.missed", { client_id: sun.id, kind: "ar" }));
ok("billers cannot open the missed list", !rc.ok, rc);

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
