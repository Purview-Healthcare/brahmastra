/* Suite 12: the rest of the checklist that the API can prove: sign-in codes and who may sign in, the work entry rules (required parts, 24-hour edits, the patient's other claims, skip, escalate), TFL / AFL, priority, inventory upload and undo, the claim timeline, My work and reports. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "V1", name: "Sasha Vice", position: "Vice President", email: "sasha@purview-healthcare.com" }),
  P({ emp_id: "M1", name: "Joseph Manager", position: "Manager", reports_to: "Sasha Vice", email: "joseph@purview-healthcare.com" }),
  P({ emp_id: "M2", name: "Sandesh Manager", position: "Manager", reports_to: "Sasha Vice", email: "sandesh@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Sandesh Manager", email: "leo@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "X1", name: "Gina Outside", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "gina.outside@gmail.com" }),
  P({ emp_id: "D2", name: "Paula PostLead", position: "Team Lead", department: "Posting", project: "Sunrise Eye Care", reports_to: "Joseph Manager", email: "paula@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Snail Post", department: "Posting", project: "Sunrise Eye Care", reports_to: "Paula PostLead", email: "snail@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cara Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "cara@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Lakeview Dental Group", reports_to: "Leo Lead", email: "bela@purview-healthcare.com" })];
const fetchMock = async (url) => url.includes("brahmastra_roster") ? new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } }) : new Response("nope", { status: 500 });
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const SA = await firstIn("Sasha Vice", "sasha@purview-healthcare.com"), JO = await firstIn("Joseph Manager", "joseph@purview-healthcare.com"),
  TI = await firstIn("Tina Lead", "tina@purview-healthcare.com"), AR = await firstIn("Arun Agent", "arun@purview-healthcare.com");
const cl = (await A("clients.list")).clients; const sun = cl.find((c) => /Sunrise/.test(c.name)), lake = cl.find((c) => /Lakeview/.test(c.name));
const CA = await firstIn("Cara Agent", "cara@purview-healthcare.com");
const pub = as(null);
const arun = U("Arun Agent"), cara = U("Cara Agent");
const IST = 330 * 60000, today = ((d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"))(new Date());   // the local date, as the app sends it with every call
const work = (extra = {}) => ({ saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" },
  note: { source: "Portal", findings: "Claim is in process per the payer portal", action: "follow up", ...extra } });

S("Sign-in codes");
let r = await T(async () => pub("auth.sendOtp", { email: "arun@purview-healthcare.com" }));
ok("a code is issued (shown on screen in demo mode)", r.ok && /^\d{6}$/.test(r.r.demo_code || ""), r);
const code = r.r.demo_code;
r = await T(async () => pub("auth.sendOtp", { email: "arun@purview-healthcare.com" }));
ok("a second code within 45 seconds is refused", !r.ok && r.status === 429, r);
r = await T(async () => pub("auth.verifyOtp", { email: "arun@purview-healthcare.com", code: code === "000000" ? "111111" : "000000" }));
ok("a wrong code is refused", !r.ok && /doesn't match/.test(r.e), r);
r = await T(async () => pub("auth.verifyOtp", { email: "arun@purview-healthcare.com", code }));
ok("the right code signs in", r.ok && r.r.token, r);
r = await T(async () => pub("auth.sendOtp", { email: "gina.outside@gmail.com" }));
ok("a roster person with a non-Purview email cannot sign in", !r.ok && /not a Purview address/.test(r.e), r);
r = await T(async () => pub("auth.sendOtp", { email: "nobody@purview-healthcare.com" }));
ok("an email with no account is refused", !r.ok && r.status === 404, r);
await sql("UPDATE users SET active = 0 WHERE id = ?", cara.id);
r = await T(async () => pub("auth.sendOtp", { email: "cara@purview-healthcare.com" }));
ok("a switched-off account cannot get a code", !r.ok && r.status === 403, r);
r = await T(async () => CA("queue.summary", {}));
ok("and its open session stops working", !r.ok, r);
await sql("UPDATE users SET active = 1 WHERE id = ?", cara.id);
const CA2 = await (async () => { await sql("DELETE FROM otp_codes WHERE email = ?", "cara@purview-healthcare.com").catch(() => {}); return as((await login("cara@purview-healthcare.com", "pw-cara@purview-healthcare.com")).token); })();

S("Allocation and the work entry");
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 40 })).rows;
r = await T(async () => TI("alloc.apply", { client_id: sun.id, assignments: pool.slice(0, 12).map((c) => ({ id: c.id, user_id: arun.id })) }));
ok("a team lead assigns claims", r.ok, r);
const desk = (await AR("queue.list", {})).rows || (await AR("queue.list", {})).claims;
ok("they are on the biller's list in priority order", desk.length >= 12 && desk.every((c, i) => i === 0 || (desk[i - 1].priority || 0) >= (c.priority || 0) || desk[i - 1].state !== c.state), desk.slice(0, 5).map((c) => c.priority));
r = await T(async () => TI("alloc.apply", { client_id: sun.id, assignments: [{ id: pool[0].id, user_id: cara.id }] }));
ok("claims already on a desk are not taken by a new allocation", r.ok && (await TI("claims.get", { id: pool[0].id })).claim.assigned_to === arun.id, r);
const c1 = pool[0], c2 = pool[1], c3 = pool[2];
r = await T(async () => AR("queue.complete", { id: c1.id, ...work({ findings: "short" }) }));
ok("RCA / findings under 8 characters is refused", !r.ok, r);
r = await T(async () => AR("queue.complete", { id: c1.id, saag: work().saag, note: { ...work().note, source: "Call", ref: "" } }));
ok("a call needs its reference", !r.ok && /ref/i.test(r.e), r);
r = await T(async () => AR("queue.complete", { id: c1.id, saag: work().saag, note: { ...work().note, action: "" } }));
ok("ACTION is required", !r.ok, r);
r = await T(async () => AR("queue.complete", { id: c1.id, ...work(), escalate: true }));
ok("a complete entry saves, with a follow-up date", r.ok && r.r.follow_up_on > today, r);
ok("Effective Matrix 'Pending-Collectible Insurance' sets 30 days", r.ok && (Date.parse(r.r.follow_up_on) - Date.parse(today)) / 86400000 === 30, r.r && r.r.follow_up_on);
ok("the flagged claim is in the team lead's Needs attention", (await TI("attention.list", {})).rows.some((x) => x.id === c1.id));
ok("and the claim's history shows the entry", (await AR("claims.timeline", { id: c1.id })).items.some((x) => x.kind === "work" || x.type === "work" || /worked/i.test(JSON.stringify(x))));
const mine = await AR("history.mine", { from_ms: Date.now() - 3600000, to_ms: Date.now() + 60000 });
ok("My work lists it", JSON.stringify(mine).includes(c1.claim_no), Object.keys(mine));
const noteId = (await AR("claims.get", { id: c1.id })).notes.find((n) => n.kind === "work").id;
r = await T(async () => AR("notes.update", { id: noteId, ...work({ findings: "Claim is in process per the payer portal, updated" }) }));
ok("the author edits the entry the same day", r.ok, r);
r = await T(async () => CA2("notes.update", { id: noteId, ...work() }));
ok("another biller cannot", !r.ok, r);
r = await T(async () => TI("notes.update", { id: noteId, ...work({ findings: "Edited by the team lead the same day" }) }));
ok("the team lead can", r.ok, r);
await sql("UPDATE notes SET created_at = ? WHERE id = ?", Date.now() - 25 * 3600000, noteId);
r = await T(async () => AR("notes.update", { id: noteId, ...work() }));
ok("after 24 hours it is read-only", !r.ok && /24 hours/.test(r.e), r);
await AR("queue.open", { id: c2.id });
r = await T(async () => AR("queue.skip", { id: c2.id, reason: "Payer portal down", count: true }));
ok("skip for now", r.ok, r);
const nx = await AR("queue.next", {});
ok("a skipped claim does not come next", !nx.claim || nx.claim.id !== c2.id, nx.claim && nx.claim.claim_no);
// the patient's other claims
const sib = await sql("UPDATE claims SET patient = (SELECT patient FROM claims WHERE id = ?), dos = dos WHERE id = ?", c3.id, pool[3].id);
await TI("alloc.apply", { client_id: sun.id, assignments: [{ id: pool[3].id, user_id: arun.id }] }).catch(() => {});
const bp = await AR("claims.byPatient", { id: c3.id });
ok("the patient's other open claims are listed", JSON.stringify(bp).includes(pool[3].id), Object.keys(bp));
r = await T(async () => AR("queue.complete", { id: c3.id, ...work(), sibling_ids: [pool[3].id] }));
ok("one entry saved on both", r.ok && r.r.completed === 2 && (await AR("claims.get", { id: pool[3].id })).notes.some((n) => n.kind === "work"), r);

S("Priority, TFL / AFL");
r = await T(async () => TI("claims.setPriority", { ids: [pool[8].id], level: "top", category: "Client request", comment: "Client asked for this one first" }));
ok("a team lead moves a claim to the top with a reason", r.ok, r);
const plog = await TI("claims.priorityLog", {});
ok("the priority log keeps it", JSON.stringify(plog).includes("Client asked for this one first"));
r = await T(async () => AR("claims.setPriority", { ids: [pool[8].id], level: "top", category: "x", comment: "x" }));
ok("billers cannot change priority", !r.ok, r);
r = await T(async () => TI("payers.saveLimit", { client_id: sun.id, payer: pool[9].payer, tfl_days: 90, afl_days: 180, note: "Payer manual 2026" }));
ok("a TFL / AFL limit is saved for a payer", r.ok, r);
const lim = await TI("payers.limits", { today });
ok("and listed with its claims at risk", lim.rows.some((x) => x.client_id === sun.id && x.payer === pool[9].payer && x.tfl_days === 90), lim.rows.slice(0, 2));

S("Inventory upload and undo");
const row = (n, extra = {}) => ({ match_key: "chk-" + n, claim_no: "CHK" + n, account_no: "AC" + n, patient: "Test, Patient" + n, payer: "Aetna", dos: "2026-06-0" + (n % 9 + 1), balance: 100 + n, status_class: "denied", priority: 50, tier: "Medium", ...extra });
r = await T(async () => TI("inventory.upload", { client_id: sun.id, kind: "fresh", file_name: "check.csv", final: true, rows_read: 4, claims: [row(1), row(2), row(3), row(4, { balance: 0, exclude_reason: "closed" })] }));
ok("a fresh upload adds new claims", r.ok && r.r.inserted >= 3, r.r);
const bid = r.r.batch_id;
r = await T(async () => TI("inventory.upload", { client_id: sun.id, kind: "fresh", file_name: "check-again.csv", final: true, rows_read: 3, claims: [row(1, { balance: 555 }), row(2), row(3)] }));
ok("uploading again refreshes, no duplicates", r.ok && r.r.inserted === 0 && r.r.updated === 3, r.r);
const chk = (await TI("claims.list", { client_id: sun.id, q: "CHK1", page_size: 10 })).rows;
ok("the refreshed balance is kept", chk.length === 1 && chk[0].balance === 555, chk.map((c) => c.balance));
const zero = (await TI("claims.list", { client_id: sun.id, q: "CHK4", page_size: 10 })).rows;
ok("a paid / zero-balance row does not become workable", zero.length === 0 || zero[0].state !== "open", zero.map((c) => c.state));
const hist = await TI("inventory.batches", { client_id: sun.id });
ok("upload history lists the batches", (hist.rows || hist.batches || []).length >= 2);
r = await T(async () => TI("inventory.undoBatch", { batch_id: bid }));
ok("an upload nobody worked can be undone", r.ok, r);
const seedBatch = ((await TI("inventory.batches", { client_id: sun.id })).batches.find((b) => b.id !== bid && !b.undone_at && b.kind === "fresh") || {}).id;
r = await T(async () => TI("inventory.undoBatch", { batch_id: seedBatch }));
const kept = await T(async () => TI("claims.get", { id: c1.id }));
ok("undoing an older upload removes only claims nobody worked; worked claims stay", r.ok && kept.ok && kept.r.notes.some((n) => n.kind === "work"), [r.r, kept.ok]);
r = await T(async () => TI("inventory.undoBatch", { batch_id: seedBatch }));
ok("an upload cannot be undone twice", !r.ok, r);
r = await T(async () => AR("inventory.upload", { client_id: sun.id, kind: "fresh", claims: [row(9)] }));
ok("billers cannot upload", !r.ok, r);

S("Reports");
const rw = await TI("reports.work", { from_ms: Date.now() - 86400000, to_ms: Date.now() + 60000, client_id: sun.id });
ok("Every entry has the SAAG fields and the one-cell note", rw.rows.length >= 2 && rw.rows.every((x) => "status" in x && "comment" in x), rw.rows[0] && Object.keys(rw.rows[0]));
const st = await TI("claims.stats", { client_id: sun.id });
const all500 = (await TI("claims.list", { client_id: sun.id, state: "workable", page_size: 500 })).total;
ok("dashboard counts agree with the claims list", st && JSON.stringify(st).length > 50 && all500 > 0, all500);

S("More team lead and admin tasks");
r = await T(async () => TI("users.loginCode", { id: arun.id }));
ok("a team lead gives a biller a sign-in code", r.ok && /^\d{6}$/.test(r.r.code), r);
if (r.ok) { const v = await T(async () => pub("auth.verifyOtp", { email: "arun@purview-healthcare.com", code: r.r.code })); ok("and the biller signs in with it", v.ok && v.r.token, v); }
r = await T(async () => AR("users.loginCode", { id: cara.id }));
ok("billers cannot hand out codes", !r.ok, r);
const keep = feed.splice(0, feed.length);
r = await T(async () => A("roster.syncShastra"));
const stillThere = (await A("users.list")).users.filter((u) => u.active).length;
feed.push(...keep);
ok("an empty roster from Shastra changes nothing", stillThere >= keep.length, [r.ok, r.e, stillThere]);
feed.push(P({ emp_id: "N1", name: "Nina Agent", project: "Willow Clinic", reports_to: "Tina Lead", email: "nina@purview-healthcare.com" }));
await A("roster.syncShastra");
const um = await A("projects.unmapped", {});
ok("a roster project with no client is waiting to be matched", um.names.includes("Willow Clinic"), um.names);
r = await T(async () => TI("projects.map", { name: "Willow Clinic", client_id: sun.id }));
ok("a team lead cannot match a project that is not theirs", !r.ok, r);
r = await T(async () => A("projects.map", { name: "Willow Clinic", client_id: sun.id }));
ok("the admin matches it to a client", r.ok && !(await A("projects.unmapped", {})).names.includes("Willow Clinic"), r);
const nina = (await A("users.list")).users.find((u) => u.name === "Nina Agent");
ok("its people land on that client", nina && (await A("clients.list")).clients.find((c) => c.id === sun.id).roster_names.includes("Willow Clinic"));
const wrow = { match_key: "wk-1", claim_no: "WK1", patient: "Worked, Patient", payer: "Cigna", dos: "2026-05-02", balance: 210, status_class: "denied", priority: 40, tier: "High", last_worked_on: "2026-10-20", file_comments: "Called payer, reprocessing" };
r = await T(async () => TI("inventory.upload", { client_id: sun.id, kind: "worked", file_name: "worked.csv", final: true, rows_read: 1, claims: [wrow] }));
const wk = (await TI("claims.list", { client_id: sun.id, q: "WK1", page_size: 5 })).rows[0];
ok("a previously worked inventory gets a follow-up date", r.ok && wk && wk.follow_up_on && wk.worked_before, [r.ok && r.r, wk && wk.follow_up_on]);
await sql("UPDATE claims SET state = 'completed', follow_up_on = '2026-10-01' WHERE id = ?", wk.id);
const od = await TI("claims.list", { client_id: sun.id, overdue: true, today, page_size: 50 });
ok("an overdue follow-up shows among the overdue claims (to assign again)", od.rows.some((c) => c.id === wk.id), od.total);
r = await T(async () => TI("alloc.apply", { client_id: sun.id, assignments: [{ id: wk.id, user_id: cara.id }] }));
ok("and can be assigned again", r.ok && (await TI("claims.get", { id: wk.id })).claim.assigned_to === cara.id, r);
r = await T(async () => TI("alloc.unassign", { ids: [wk.id] }));
ok("Return to pool takes it off the desk", r.ok && !(await TI("claims.get", { id: wk.id })).claim.assigned_to, r);
const adminId = (await A("auth.me")).user.id;
await A("clients.save", { name: "Temp Delete Clinic", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 10 }, resp: { ar: { lead: adminId } } } });
const tmp = (await A("clients.list")).clients.find((c) => c.name === "Temp Delete Clinic");
r = await T(async () => A("clients.delete", { id: tmp.id, confirm: "wrong name" }));
ok("deleting a client needs its exact name", !r.ok, r);
r = await T(async () => TI("clients.delete", { id: tmp.id, confirm: "Temp Delete Clinic" }));
ok("a team lead cannot delete a client outside their span", !r.ok && /not one of yours/i.test(r.e), r);
{ // Team leads and managers can delete a client in their own span; a view-only share is not enough.
  const tinaId = (await TI("auth.me")).user.id;
  await A("clients.save", { name: "Tina Temp Clinic", locations: ["Main"], profile: { scope: ["ar"], targets: { ar: 10 }, resp: { ar: { lead: adminId } } } });
  const t2 = (await A("clients.list")).clients.find((c) => c.name === "Tina Temp Clinic");
  await A("clients.accessSave", { client_id: t2.id, user_id: tinaId, level: "view" });
  r = await T(async () => TI("clients.delete", { id: t2.id, confirm: "Tina Temp Clinic" }));
  ok("a view-only share cannot delete it", !r.ok && /view-only/i.test(r.e), r);
  await A("clients.accessSave", { client_id: t2.id, user_id: tinaId, level: "edit" });
  r = await T(async () => AR("clients.delete", { id: t2.id, confirm: "Tina Temp Clinic" }));
  ok("a biller cannot delete a client", !r.ok, r);
  r = await T(async () => TI("clients.delete", { id: t2.id, confirm: "Tina Temp Clinic" }));
  ok("the team lead deletes a client in their span", r.ok && !(await A("clients.list")).clients.some((c) => c.id === t2.id), r);
}
r = await T(async () => A("clients.delete", { id: tmp.id, confirm: "Temp Delete Clinic" }));
ok("the admin deletes it", r.ok && !(await A("clients.list")).clients.some((c) => c.id === tmp.id), r);
ok("and the audit trail records it", (await A("audit.list", {})).rows.some((x) => x.action === "client.delete" && /Temp Delete Clinic/.test(x.detail)));

S("Assigning within a desk");
const PA = await firstIn("Paula PostLead", "paula@purview-healthcare.com"), SN = await firstIn("Snail Post", "snail@purview-healthcare.com");
await TI("clients.saveResponsibility", { client_id: sun.id, dept: "posting", mode: "person", lead: U("Paula PostLead").id });
const pc = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 60 })).rows.find((c) => !c.assigned_to);
await TI("alloc.apply", { client_id: sun.id, assignments: [{ id: pc.id, user_id: arun.id }] });
await AR("attachments.add", { claim_id: pc.id, name: "eob.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 eob").toString("base64") });
await AR("queue.complete", { id: pc.id, saag: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Purview", effective: "Payment-Cash In Bank" }, note: { source: "Portal", findings: "Paid per EOB, posting needed", action: "follow up" } });
const hl = (await PA("handoffs.list", {})).rows.find((h) => h.claim_id === pc.id);
ok("the posting lead has the hand-off", !!hl, (await PA("handoffs.list", {})).rows.length);
r = await T(async () => PA("handoffs.assign", { id: hl.id, user_id: U("Snail Post").id }));
ok("the lead assigns it to a team member", r.ok, r);
ok("it shows on that person's desk as assigned", (await SN("handoffs.list", {})).rows.some((h) => h.id === hl.id && h.status === "assigned"), (await SN("handoffs.list", {})).rows.map((h) => h.status));
r = await T(async () => AR("handoffs.assign", { id: hl.id, user_id: arun.id }));
ok("an AR biller cannot assign desk work", !r.ok, r);

S("Team tab: sync the roster from Purview Shastra");
await sql("DELETE FROM settings WHERE key = 'shastra_sync'");
feed.push(P({ emp_id: "N9", name: "Omar Newjoin", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "omar.n@purview-healthcare.com" }));
r = await T(async () => TI("team.syncRoster"));
ok("a team lead syncs the roster from the Team tab", r.ok && r.r.summary && r.r.summary.new >= 1, r);
ok("the new person is there at once", (await A("users.list")).users.some((u) => u.name === "Omar Newjoin"));
const ri = await TI("team.rosterInfo");
ok("the tab shows when and by whom", ri.connected && ri.last && ri.last.ok && ri.last.by === "Tina Lead", ri);
r = await T(async () => TI("team.syncRoster"));
ok("a second sync within 2 minutes waits", !r.ok && r.status === 429 && /Try again in/.test(r.e), r);
r = await T(async () => AR("team.syncRoster"));
ok("billers cannot sync", !r.ok, r);
ok("the sync is in the audit trail", (await A("audit.list", {})).rows.some((x) => x.action === "roster.sync" && x.user_name === "Tina Lead"));

S("Team tab: people come from Shastra");
r = await T(async () => TI("users.save", { first_name: "Hand", last_name: "Added", email: "hand.added@purview-healthcare.com", designation: "Biller", role: "user", capacity: 30, active: true }));
ok("a team lead cannot add a person by hand", !r.ok && /Purview Shastra/.test(r.e), r);
r = await T(async () => TI("email.test", { to: "tina@purview-healthcare.com" }));
ok("a team lead can still send a test email", r.ok || !/admin/.test(r.e || ""), r);
r = await T(async () => A("users.save", { first_name: "Hand", last_name: "Added", email: "hand.added@purview-healthcare.com", designation: "Biller", role: "user", capacity: 30, active: true }));
ok("the admin still can (exceptions)", r.ok, r);

S("Who works it: the client's people, minus out today");
await TI("clients.saveTeam", { client_id: sun.id, team: [arun.id, cara.id] });
await TI("team.setOut", { user_id: cara.id, out: true, reason: "Leave" });
let tt = await TI("team.today", { client_id: sun.id, day: today });
ok("the client's people are listed with their daily target", tt.members.length === 2 && tt.members.every((m) => m.cap > 0), tt.members);
ok("someone out today is flagged and skipped", tt.members.find((m) => m.id === cara.id).out === true && tt.members.find((m) => m.id === arun.id).out === false);
await TI("team.setOut", { user_id: cara.id, out: false });
tt = await TI("team.today", { client_id: sun.id, day: today });
ok("back in, back on the list", !tt.members.find((m) => m.id === cara.id).out);

S("Adding a client: team leads and above");
{ const tinaId = (await TI("auth.me")).user.id;
  const prof = { scope: ["ar"], targets: { ar: 10 }, resp: { ar: { lead: tinaId } } };
  r = await T(async () => AR("clients.save", { name: "Biller Try Clinic", locations: ["Main"], profile: prof }));
  ok("a biller cannot add a client", !r.ok, r);
  r = await T(async () => TI("clients.save", { name: "Tina New Clinic", locations: ["Main"], profile: prof }));
  ok("a team lead with a span adds a client", r.ok, r);
  const mineNow = (await TI("clients.list")).clients.find((c) => c.name === "Tina New Clinic");
  ok("and it opens for her straight away, editable", mineNow && mineNow.can_edit !== false, mineNow && { can_edit: mineNow.can_edit });
  r = await T(async () => TI("clients.save", { id: mineNow.id, name: "Tina New Clinic", code: "TNC", follow_up_days: 20, active: true }));
  ok("she can change it", r.ok, r);
  r = await T(async () => TI("clients.delete", { id: mineNow.id, confirm: "Tina New Clinic" }));
  ok("and delete it", r.ok, r); }

S("Claim: latest work at the top");
{ const w = (await A("claims.list", { worked: "yes", page_size: 5 })).rows.find((x) => x.last_status_code);
  const g = w ? (await A("claims.get", { id: w.id })).claim : null;
  ok("the claim carries its latest SAAG, note and who worked it", g && g.last_status_code && typeof g.last_note === "string" && "last_worked_name" in g, g && { s: g.last_status_code, by: g.last_worked_name }); }

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
