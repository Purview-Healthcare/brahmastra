/* suite37: regression checks for the bug-test fixes (desks, hand-offs and their TAT): the life of a claim through Payment
   posting, Submission, Rejections and the recheck, the desk dashboard, the TAT tallies and the OneDrive rows. Each check names
   the finding it guards. A made-up roster and a fake Microsoft Graph; made-up data only. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
// one section: a crash inside it is a failed check, and the sections after it still run
const part = async (name, fn) => { S(name); try { await fn(); } catch (e) { ok(name.split(":")[0] + ": the section ran to its end", false, String((e && e.stack) || e).slice(0, 500)); } finally { setNow(null); } };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", project: "Sunrise Eye Care", also_on_projects: "Lakeview Dental Group", email: "mona@purview-healthcare.com" }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "tina@purview-healthcare.com" }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: "Lakeview Dental Group", reports_to: "Mona Manager", email: "lara@purview-healthcare.com" }),
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "sima@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "arun@purview-healthcare.com" }),
  P({ emp_id: "A2", name: "Bela Agent", project: "Sunrise Eye Care", reports_to: "Tina Lead", email: "bela@purview-healthcare.com" }),
  P({ emp_id: "A3", name: "Cyra Agent", project: "Lakeview Dental Group", reports_to: "Lara Lead", email: "cyra@purview-healthcare.com" }),
  P({ emp_id: "D1", name: "Pia Poster", department: "Posting", project: "Sunrise Eye Care", reports_to: "Pat Postlead", email: "pia@purview-healthcare.com" }),
  P({ emp_id: "D2", name: "Otto Poster", department: "Posting", project: "Sunrise Eye Care", reports_to: "Pat Postlead", email: "otto@purview-healthcare.com" }),
  P({ emp_id: "D3", name: "Pat Postlead", position: "Team Lead", department: "Posting", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "pat@purview-healthcare.com" }),
  P({ emp_id: "D4", name: "Quin Submit", department: "Submission", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "quin@purview-healthcare.com" }),
  P({ emp_id: "D5", name: "Rex Reject", department: "Submission", project: "Sunrise Eye Care", reports_to: "Mona Manager", email: "rex@purview-healthcare.com" }),
  P({ emp_id: "D6", name: "Lex Lakepost", department: "Posting", project: "Lakeview Dental Group", reports_to: "Mona Manager", email: "lex@purview-healthcare.com" }),
];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
// ---- a fake Microsoft Graph (as in suite34): folders, files, worksheets per workbook, and every range write kept ----
const AR_TEMPLATE = ["Sr. No", "Location", "Project", "Practice", "Uni", "IG Claim ID#/Charge ID#", "Patient Name", "DOS", "Payer", "Age", "Bucket", "Billed Amount($)", "Balance Amount($)", "CPT",
  "Comments/Notes", "Status", "Sub Status", "Action", "Bucket", "Mode of Work", "Start Time", "End Time", "Total Duration", "Date Worked", "Emp. ID", "Associate Name", "Status", "Errors", "Team Lead", "Date Range", "Week"];
const OD = { items: new Map(), seq: 0, books: new Map(), writes: [] };
const mk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id }; OD.items.set(id, it);
  if (kind === "file") OD.books.set(id, { n: 1, sheets: [{ id: "s1", name: "Sheet1", rows: [AR_TEMPLATE.slice()] }] }); return it; };
const child = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === name.toLowerCase());
const out = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const u = new URL(url); const path = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, ""));
  let r;
  if (m === "POST" && (r = path.match(/^\/users\/[^/]+\/drive\/root\/children$/))) { const b = JSON.parse(init.body); if (child("root", b.name)) return J({}, 409); return J(out(mk(b.name, "root", "folder")), 201); }
  if (m === "GET" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+?):?$/))) {
    // a path under the root, one folder at a time
    let cur = "root"; for (const part of r[1].replace(/:$/, "").split("/")) { const it = child(cur, part); if (!it) return J({}, 404); cur = it.id; } return J(out(OD.items.get(cur))); }
  if (m === "PUT" && (r = path.match(/^\/users\/[^/]+\/drive\/root:\/(.+):\/content$/))) {
    let cur = "root"; const parts = r[1].split("/"); for (const part of parts.slice(0, -1)) cur = (child(cur, part) || mk(part, cur, "folder")).id;
    if (child(cur, parts[parts.length - 1])) return J({}, 409); return J(out(mk(parts[parts.length - 1], cur, "file")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) { if (child(r[1], r[2])) return J({}, 409); return J(out(mk(r[2], r[1], "file")), 201); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
  const bk = (id) => OD.books.get(id), sh = (b, sid) => b && b.sheets.find((x) => x.id === sid);
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets$/))) return J({ value: bk(r[1]).sheets.map((x) => ({ id: x.id, name: x.name })) });
  if (m === "POST" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/add$/))) { const b = bk(r[1]); const nm = JSON.parse(init.body).name;
    if (b.sheets.some((x) => x.name.toLowerCase() === nm.toLowerCase())) return J({ error: { message: "exists" } }, 409); const s = { id: "s" + (++b.n), name: nm, rows: [] }; b.sheets.push(s); return J({ id: s.id, name: s.name }); }
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)$/))) { const s = sh(bk(r[1]), r[2]); s.name = JSON.parse(init.body).name; return J({ id: s.id, name: s.name }); }
  if (m === "GET" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/usedRange/))) { const s = sh(bk(r[1]), r[2]); const n = Math.max(1, s.rows.length);
    return J({ rowCount: n, address: s.name + "!A1:AE" + n, values: s.rows.length ? s.rows : [[""]] }); }
  if (m === "POST" && (r = path.match(/\/range\(address='[^']*'\)\/clear$/))) return J({});
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/range\(address='([A-Z]+)(\d+):[A-Z]+\d+'\)\/format\//))) return J({});
  if (m === "PATCH" && (r = path.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets\/([^/]+)\/range\(address='([A-Z]+)(\d+):[A-Z]+\d+'\)$/))) {
    const s = sh(bk(r[1]), r[2]), at = Number(r[4]) - 1, c0 = colNum(r[3]) - 1, body = JSON.parse(init.body);
    OD.writes.push({ file: (OD.items.get(r[1]) || {}).name || "", values: body.values });
    body.values.forEach((row, i) => { const cur = s.rows[at + i] || []; row.forEach((v, k) => { cur[c0 + k] = v; }); s.rows[at + i] = cur; }); return J({}); }
  return J({ error: "fake graph: no route " + m + " " + path }, 404);
};
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
  if (url.includes("brahmastra_holidays") || url.includes("brahmastra_wfm") || url.includes("brahmastra_live") || url.includes("brahmastra_floor")) return J({ ok: false, error: "not here" }, 404);
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  return new Response("nope", { status: 500 });
};
const _log = console.log; console.log = (...a) => { if (/^(Snapshot|Folders|Shastra|TAT|Escalation|Digest)/.test(String(a[0]))) return; _log(...a); };
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
const row1 = async (q, ...a) => (await rows(q, ...a))[0];
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => { const u = users.find((x) => x.name === n); if (!u) throw new Error("no user " + n); return u; };
await sql("UPDATE sessions SET expires_at = expires_at + ?", 400 * 86400000);
const firstIn = async (name) => { const u = U(name); await as(null)("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + u.email) }); const tok = (await login(u.email, "pw-" + u.email)).token;
  await sql("UPDATE sessions SET expires_at = expires_at + ? WHERE token = ?", 400 * 86400000, tok); return as(tok); };
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => /Sunrise/.test(c.name)), lake = clients.find((c) => /Lakeview/.test(c.name));
// the clock: IST wall time; every read ticks 1 ms so two steps never share a millisecond (as on a real server)
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const real = Date.now; let tick = 0;
const setNow = (ms) => { if (ms == null) { Date.now = real; return; } tick = ms; Date.now = () => tick++; };
const nowIso = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const call = (Pf, op, p = {}) => Pf(op, { today: nowIso(), ...p });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [dept, lead, backup] of [["posting", "Pia Poster", "Otto Poster"], ["submission", "Quin Submit", null], ["rejection", "Rex Reject", null]]) {
  const r = await T(() => A("clients.saveResponsibility", { client_id: sun.id, dept, mode: "person", lead: U(lead).id, backup: backup ? U(backup).id : null })); if (!r.ok) console.log("responsibility", dept, r.e);
}
const AR = await firstIn("Arun Agent"), BE = await firstIn("Bela Agent"), CY = await firstIn("Cyra Agent"), TI = await firstIn("Tina Lead");
const PI = await firstIn("Pia Poster"), OT = await firstIn("Otto Poster"), QU = await firstIn("Quin Submit"), RX = await firstIn("Rex Reject"), LX = await firstIn("Lex Lakepost");
const SAAG = {
  post: { status: "Claim Paid", sub_status: "EOB Available", action: "Need to Post/Posting Correction", bucket: "Closed", effective: "AR Closed-Pending Posting" },
  resub: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Need to Resubmit", bucket: "Purview", effective: "Pending-Submission" },
  rej: { status: "Claim Rejected", sub_status: "Other rejection Reason", action: "Need to Resubmit", bucket: "Purview", effective: "Pending-Submission" },
  fu: { status: "Claim In Process", sub_status: "Need to allow some time", action: "EOB not Available/Requested EOB", bucket: "Payer", effective: "Pending-Collectible Insurance" },
};
const NOTE = (t = "Checked the payer portal, claim on file") => ({ source: "Portal", findings: t });
const PDF = Buffer.from("%PDF-1.4 made-up eob\n%%EOF").toString("base64");
const claim = (id) => row1("SELECT * FROM claims WHERE id = ?", id);
// the fields a failed check prints
const brief = async (id) => { const c = await claim(id); return c && { state: c.state, handoff_status: c.handoff_status, bucket: c.last_bucket, effective: c.last_effective, first_up: c.first_up, follow_up_on: c.follow_up_on, assigned_to: c.assigned_to, state_reason: c.state_reason }; };
const hos = (id) => rows("SELECT * FROM handoffs WHERE claim_id = ? ORDER BY created_at, rowid", id);
const openH = async (id, dept) => (await hos(id)).filter((h) => h.dept === dept && ["pending", "assigned", "client"].includes(h.status)).slice(-1)[0];
// open claims of a client given to a biller (a fresh set each time)
let used = 0;
const give = async (name, n, client = sun) => { const pool = (await A("claims.list", { client_id: client.id, state: "open", page_size: 300 })).rows.filter((c) => !c.assigned_to).slice(0, n);
  await A("alloc.apply", { client_id: client.id, assignments: pool.map((c) => ({ id: c.id, user_id: U(name).id })) }); used += n; return pool.map((c) => c.id); };
// a biller's entry from My day (open, then save)
const save = async (who, id, saag, extra = {}) => { await call(who, "queue.open", { id }); return call(who, "queue.complete", { id, saag, note: NOTE(extra.findings), desk: true, ...extra }); };
const postIt = async (id) => call(PI, "handoffs.close", { id: (await openH(id, "posting")).id, outcome: "complete", proof: { date: nowIso(), ref: "CHK-1", allowed: "100", paid: "80", adjustment: "20" }, note: "Posted" });
const submitIt = async (who, id, dept = "submission") => call(who, "handoffs.close", { id: (await openH(id, dept)).id, outcome: "complete", proof: { date: nowIso(), ref: "B-1", mode: "Portal", ...(dept === "rejection" ? { code: "Taxonomy missing" } : {}) }, note: "Sent" });

await part("C-03: a recheck marked Need assistance leaves a claim Posting closed as it is", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const ids = await give("Arun Agent", 3);
  const posted = async (id) => { const c = await claim(id), g = await call(AR, "claims.get", { id }); return c.state === "closed" && c.handoff_status === "posted" && c.last_bucket === "Closed" && c.last_effective === "Posting Closed" && g.claim.locked; };
  for (const id of ids) {
    setNow(IST(2026, 11, 10, 10, 0));
    await save(AR, id, SAAG.resub); await submitIt(QU, id);
    await call(AR, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF });
    await call(AR, "queue.complete", { id, saag: SAAG.post, note: NOTE("Payment found on the portal, EOB attached"), rework: true });
    await postIt(id);
  }
  setNow(IST(2026, 11, 12, 12, 0));   // the recheck is open now
  await sql("DELETE FROM user_notices");
  let rc = await openH(ids[0], "subcheck");
  let r = await T(() => call(QU, "handoffs.close", { id: rc.id, outcome: "back", reason: "Payer has no record yet", note: "Payer portal shows no claim on file yet" }));
  ok("C-03: Need assistance from AR on the recheck is saved", r.ok && (await row1("SELECT status FROM handoffs WHERE id = ?", rc.id)).status === "back", r);
  ok("C-03: ...the posted claim stays closed, Posting Closed, bucket Closed, read only", await posted(ids[0]), await brief(ids[0]));
  ok("C-03: ...it is not put back on the biller's list (not first up, no follow-up today)", (await claim(ids[0])).first_up === 0 && (await claim(ids[0])).follow_up_on === "", await brief(ids[0]));
  ok("C-03: ...and nobody is told it is back on their list", !(await rows("SELECT text FROM user_notices")).some((n) => /back to you|first on your list/.test(n.text)), await rows("SELECT text FROM user_notices"));
  const ev = await row1("SELECT data_json FROM claim_events WHERE claim_id = ? AND kind = 'handoff_back'", ids[0]);
  ok("C-03: ...the history says the claim stays closed (not 'on the biller's list today')", ev && JSON.parse(ev.data_json).kept === "closed", ev);
  rc = await openH(ids[1], "subcheck");
  r = await T(() => call(QU, "handoffs.close", { id: rc.id, outcome: "client", reason: "Need signature or documents", note: "Need the signed form from the office" }));
  ok("C-03: Need assistance from client on the recheck keeps the claim Posting Closed and read only", r.ok && await posted(ids[1]), [r, await brief(ids[1])]);
  r = await T(() => call(QU, "handoffs.close", { id: rc.id, outcome: "resume", note: "The office sent the form" }));
  ok("C-03: ...and Client answered leaves it so too", r.ok && await posted(ids[1]), [r, await brief(ids[1])]);
  // the same mistake in the sibling path: a rejected recheck on a posted claim goes to Rejections; Rejections resubmitting it kept
  // the claim closed but lifted the lock (handoff_status 'submitted')
  rc = await openH(ids[2], "subcheck");
  r = await T(() => call(QU, "handoffs.close", { id: rc.id, outcome: "rejected", reason: "Taxonomy missing", note: "Payer rejected it for the taxonomy" }));
  ok("C-03: a rejected recheck on a posted claim goes to Rejections and leaves the claim posted", r.ok && !!(await openH(ids[2], "rejection")) && await posted(ids[2]), r);
  r = await T(() => submitIt(RX, ids[2], "rejection"));
  ok("C-03: ...Rejections resubmitting it keeps the claim Posting Closed and read only", r.ok && await posted(ids[2]), [r, await brief(ids[2])]);
});

await part("C-11: an entry edited into Need to Post or Need to Resubmit sends the claim to the desk, as a first save does", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const noteOf = async (id) => (await rows("SELECT * FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC", id))[0];
  const [a, b, d, e, f] = await give("Arun Agent", 5);
  for (const id of [a, b, d, e]) await save(AR, id, SAAG.fu);
  // what a first save does (the yardstick): claim f saved as Need to Resubmit
  await save(AR, f, SAAG.resub);
  const cf = await claim(f), hf = await openH(f, "submission");
  // into Need to Post (the EOB arrived and is attached)
  await call(AR, "attachments.add", { claim_id: a, name: "eob.pdf", type: "application/pdf", data: PDF });
  let r = await T(async () => call(AR, "notes.update", { id: (await noteOf(a)).id, saag: SAAG.post, note: NOTE("Payment found, EOB attached, needs posting") }));
  let c = await claim(a), h = await openH(a, "posting");
  ok("C-11: edited into Need to Post: a Payment posting hand-off for the client's person, with the backup", r.ok && h && h.status === "pending" && h.lead_id === U("Pia Poster").id && h.backup_id === U("Otto Poster").id && h.biller_id === U("Arun Agent").id, [r, h && { status: h.status, lead: h.lead_id }]);
  ok("C-11: ...the claim is In process with Payment posting, no follow-up date", c.state === "in_process" && c.handoff_status === "with_posting" && c.state_reason === "With Payment Posting" && c.follow_up_on === "" && c.last_effective === "AR Closed-Pending Posting", await brief(a));
  ok("C-11: ...the answer says where it went (for the same toast as a save)", r.ok && r.r.handoff && r.r.handoff.dept === "posting" && r.r.handoff.mode === "person" && r.r.handoff.to === "Pia Poster", r.ok && r.r.handoff);
  ok("C-11: ...and Posting has it on its list with the client's TAT", (await call(PI, "handoffs.list", {})).rows.some((x) => x.claim_id === a) && h.due_at - h.created_at === hf.due_at - hf.created_at, h && [h.created_at, h.due_at]);
  // into Need to Resubmit
  r = await T(async () => call(AR, "notes.update", { id: (await noteOf(b)).id, saag: SAAG.resub, note: NOTE("Claim needs a corrected resubmission") }));
  c = await claim(b); h = await openH(b, "submission"); let n = await noteOf(b);
  ok("C-11: edited into Need to Resubmit: a Submission hand-off, as the first save of that action makes", r.ok && h && h.lead_id === hf.lead_id && h.status === hf.status && h.saag_action === hf.saag_action && h.due_at - h.created_at === hf.due_at - hf.created_at, [r, h && h.status]);
  ok("C-11: ...the claim stands as after a first save (In process, with Submission, no follow-up)", c.state === cf.state && c.handoff_status === cf.handoff_status && c.state_reason === cf.state_reason && c.follow_up_on === cf.follow_up_on && c.last_effective === cf.last_effective && c.last_bucket === cf.last_bucket, [await brief(b), await brief(f)]);
  ok("C-11: ...the entry carries no follow-up date while the desk has the claim", n.follow_up_on === "" && !/FOLLOW-UP/.test(n.comment), [n.follow_up_on, n.comment]);
  ok("C-11: ...the history has the hand-off line", (await rows("SELECT kind FROM claim_events WHERE claim_id = ? AND kind = 'handoff_sent'", b)).length === 1);
  // a team lead edits the biller's entry: the hand-off's AR biller is still the biller
  r = await T(async () => call(TI, "notes.update", { id: (await noteOf(d)).id, saag: SAAG.rej, note: NOTE("Rejected by the clearinghouse, needs resubmitting") }));
  h = await openH(d, "rejection");
  ok("C-11: a team lead's edit sends it too (a rejected claim to Rejections first); the AR biller of the hand-off is the entry's author", r.ok && h && h.lead_id === U("Rex Reject").id && h.biller_id === U("Arun Agent").id && h.created_by === U("Tina Lead").id, [r, h && { lead: h.lead_id, biller: h.biller_id }]);
  // an edit that keeps the action does not send the claim a second time
  await submitIt(QU, b);
  r = await T(async () => call(AR, "notes.update", { id: (await noteOf(b)).id, saag: SAAG.resub, note: NOTE("Claim needs a corrected resubmission, typo fixed") }));
  ok("C-11: fixing a typo in an entry the desk already worked does not send the claim again", r.ok && !r.r.handoff && (await hos(b)).filter((x) => x.dept === "submission").length === 1 && (await claim(b)).state === "completed", [r, (await hos(b)).map((x) => x.dept + ":" + x.status)]);
  // two edits at once: one hand-off
  const two = await Promise.all([1, 2].map(() => T(async () => call(AR, "notes.update", { id: (await noteOf(e)).id, saag: SAAG.resub, note: NOTE("Claim needs a corrected resubmission") }))));
  ok("C-11: two edits at once make one hand-off", (await hos(e)).filter((x) => x.dept === "submission").length === 1 && two.some((x) => x.ok), two.map((x) => x.ok || x.e));
  // nobody set for Submission on the client: no hand-off, and the follow-up a first save of that action gets
  const [g] = await give("Cyra Agent", 1, lake);
  await save(CY, g, SAAG.fu);
  r = await T(async () => call(CY, "notes.update", { id: (await noteOf(g)).id, saag: SAAG.resub, note: NOTE("Claim needs a corrected resubmission") }));
  c = await claim(g);
  ok("C-11: nobody set for Submission: no hand-off, the claim stays with the biller with the 15-day follow-up of that action", r.ok && r.r.handoff && r.r.handoff.mode !== "person" && !(await hos(g)).length && c.state === "completed" && c.follow_up_on === "2026-11-25", [r.ok && r.r.handoff, await brief(g)]);
});

await part("C-12: an edit does not undo the team lead's Close or Exclude", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const noteOf = async (id) => (await rows("SELECT * FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC", id))[0];
  const CLOSE = { status: "Claim Paid", sub_status: "Already Posted", action: "Moved To Closed/Non Workable", bucket: "Closed", effective: "Processing-Closed" };
  const [a, b, d, e] = await give("Arun Agent", 4);
  for (const id of [a, b, d]) await save(AR, id, SAAG.fu, { findings: "Checked the payer portal, claim on fle" });
  await call(TI, "claims.setState", { ids: [a], state: "closed" });
  await call(TI, "claims.setState", { ids: [b], state: "excluded" });
  let r = await T(async () => call(AR, "notes.update", { id: (await noteOf(a)).id, saag: SAAG.fu, note: NOTE("Checked the payer portal, claim on file") }));
  let c = await claim(a);
  ok("C-12: a typo fix leaves a claim the team lead closed closed, with the team lead's reason", r.ok && c.state === "closed" && c.state_reason === "Closed by supervisor", await brief(a));
  ok("C-12: ...the entry itself is corrected", /claim on file/.test((await noteOf(a)).comment));
  r = await T(async () => call(AR, "notes.update", { id: (await noteOf(b)).id, saag: CLOSE, note: NOTE("Already posted, nothing left to work") }));
  c = await claim(b);
  ok("C-12: an edit into a closing entry does not turn an excluded claim into a closed one", r.ok && c.state === "excluded" && c.state_reason === "Excluded by supervisor", await brief(b));
  // and an edit into a desk action does not send a claim the team lead closed to the desk
  r = await T(async () => call(AR, "notes.update", { id: (await noteOf(a)).id, saag: SAAG.resub, note: NOTE("Claim needs a corrected resubmission") }));
  ok("C-12: a claim the team lead closed is not sent to a desk by an edit", r.ok && !r.r.handoff && !(await hos(a)).length && (await claim(a)).state === "closed", [r, await brief(a)]);
  // what an edit still does: a claim the entry itself closed opens again, and an open follow-up closes
  await save(AR, e, CLOSE, { findings: "Already posted, nothing left to work" });
  ok("C-12: (set-up) a closing entry closes the claim", (await claim(e)).state === "closed" && /^Closed: /.test((await claim(e)).state_reason), await brief(e));
  r = await T(async () => call(AR, "notes.update", { id: (await noteOf(e)).id, saag: SAAG.fu, note: NOTE("Not posted after all, following up") }));
  ok("C-12: a claim its own entry closed still opens again when that entry is edited into a follow-up", r.ok && (await claim(e)).state === "completed" && (await claim(e)).follow_up_on !== "", await brief(e));
  r = await T(async () => call(AR, "notes.update", { id: (await noteOf(d)).id, saag: CLOSE, note: NOTE("Already posted, nothing left to work") }));
  ok("C-12: and an edit into a closing entry still closes an open follow-up", r.ok && (await claim(d)).state === "closed" && (await claim(d)).state_reason === "Closed: Processing-Closed", await brief(d));
});

await part("C-04: a team lead's Close, Exclude or Reopen does not reach a claim a desk still has", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [a, b, d, e] = await give("Arun Agent", 4);
  await save(AR, a, SAAG.resub);
  let r = await T(() => call(TI, "claims.setState", { ids: [a], state: "closed" }));
  ok("C-04: Close on a claim that is with Submission is refused, and says who has it", !r.ok && /with Submission now/.test(r.e) && /finishes it or sends it back to AR/.test(r.e), r);
  ok("C-04: ...the claim stays In process and its hand-off stays open on the desk", (await claim(a)).state === "in_process" && !!(await openH(a, "submission")) && (await call(QU, "handoffs.list", {})).rows.some((h) => h.claim_id === a), await brief(a));
  r = await T(() => call(TI, "claims.setState", { ids: [a], state: "excluded" }));
  const r2 = await T(() => call(TI, "claims.setState", { ids: [a], state: "open" }));
  ok("C-04: Exclude and Reopen are refused the same way", !r.ok && /excluded once/.test(r.e) && !r2.ok && /reopened once/.test(r2.e) && (await claim(a)).state === "in_process" && (await claim(a)).assigned_to === U("Arun Agent").id, [r, r2]);
  // several at once: the ones a desk has stay, the rest change, and the answer says how many stayed
  await save(AR, b, SAAG.fu);
  r = await T(() => call(TI, "claims.setState", { ids: [a, b], state: "closed" }));
  ok("C-04: several at once: the free claim closes, the one with a desk stays, and the answer counts it", r.ok && r.r.changed === 1 && r.r.at_desk === 1 && (await claim(b)).state === "closed" && (await claim(a)).state === "in_process", r);
  ok("C-04: ...and no 'State changed' line is written on the claim that stayed", !(await rows("SELECT id FROM claim_events WHERE claim_id = ? AND kind = 'state'", a)).length);
  // once the desk sends it back, the team lead can close it
  await call(QU, "handoffs.close", { id: (await openH(a, "submission")).id, outcome: "back", reason: "Missing claim data", note: "Need the NPI on line two" });
  r = await T(() => call(TI, "claims.setState", { ids: [a], state: "closed" }));
  ok("C-04: after the desk sends it back the team lead can close it", r.ok && r.r.changed === 1 && r.r.at_desk === 0 && (await claim(a)).state === "closed", r);
  // a claim back with the biller, with only its recheck open, can be closed; the recheck then never opens it again
  await save(AR, d, SAAG.resub); await submitIt(QU, d);
  r = await T(() => call(TI, "claims.setState", { ids: [d], state: "closed" }));
  ok("C-04: a claim back with the biller (only the recheck open) can be closed", r.ok && r.r.changed === 1 && (await claim(d)).state === "closed", r);
  setNow(IST(2026, 11, 12, 12, 0));
  r = await T(async () => call(QU, "handoffs.close", { id: (await openH(d, "subcheck")).id, outcome: "back", reason: "Payer has no record yet", note: "Payer portal shows no claim on file yet" }));
  ok("C-04: ...and the recheck marked Need assistance from AR leaves it closed, with the team lead's reason", r.ok && (await claim(d)).state === "closed" && (await claim(d)).state_reason === "Closed by supervisor" && (await claim(d)).first_up === 0, await brief(d));
  // an excluded claim is left alone by its recheck too
  setNow(IST(2026, 11, 10, 11, 0));
  await save(AR, e, SAAG.resub); await submitIt(QU, e);
  await call(TI, "claims.setState", { ids: [e], state: "excluded" });
  setNow(IST(2026, 11, 12, 13, 0));
  r = await T(async () => call(QU, "handoffs.close", { id: (await openH(e, "subcheck")).id, outcome: "back", reason: "Payer has no record yet", note: "Payer portal shows no claim on file yet" }));
  ok("C-04: an excluded claim stays excluded when its recheck is marked Need assistance from AR", r.ok && (await claim(e)).state === "excluded" && (await claim(e)).state_reason === "Excluded by supervisor", await brief(e));
});

await part("C-22 / D-13: a hand-off can be given only to people of its desk who can work the client", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [a, b] = await give("Arun Agent", 2);
  await call(AR, "attachments.add", { claim_id: a, name: "eob.pdf", type: "application/pdf", data: PDF });
  await save(AR, a, SAAG.post); await save(AR, b, SAAG.resub);
  const hp = await openH(a, "posting"), hs = await openH(b, "submission");
  const tryAssign = (who, h, name) => T(() => call(who, "handoffs.assign", { id: h.id, user_id: U(name).id }));
  const before = await T(() => call(CY, "claims.get", { id: a }));
  let r = await tryAssign(PI, hp, "Cyra Agent");
  ok("C-22: the posting lead cannot give the hand-off to an AR biller of another client", !r.ok && /Cyra Agent cannot be given this hand-off/.test(r.e) && /Payment posting/.test(r.e), r);
  ok("D-13: ...who still cannot open the claim", !before.ok && !(await T(() => call(CY, "claims.get", { id: a }))).ok && (await row1("SELECT assigned_to, status FROM handoffs WHERE id = ?", hp.id)).assigned_to == null);
  r = await tryAssign(PI, hp, "Arun Agent");
  ok("C-22: nor to an AR biller of the same client (not on the desk)", !r.ok, r);
  r = await tryAssign(PI, hp, "Lex Lakepost");
  ok("C-22: nor to a Payment posting person who works another client only", !r.ok, r);
  r = await tryAssign(PI, hp, "Quin Submit");
  ok("C-22: nor to someone on the other desk (Submission)", !r.ok, r);
  // a view-only share of the client is not enough; a share to edit is
  await call(TI, "clients.accessSave", { client_id: sun.id, user_id: U("Lex Lakepost").id, level: "view" });
  r = await tryAssign(PI, hp, "Lex Lakepost");
  ok("C-22: a view-only share of the client does not make someone assignable", !r.ok, r);
  const list = await call(PI, "handoffs.list", {});
  const offered = ((list.assignees || {})[sun.id + "|posting"] || []).map((u) => u.name).sort();
  ok("C-22: the tab offers the desk's people on the client, the same rule the server checks", offered.join() === ["Otto Poster", "Pat Postlead", "Pia Poster"].join(), offered);
  r = await tryAssign(PI, hp, "Otto Poster");
  ok("C-22: a Payment posting person on the client can be given it", r.ok && (await row1("SELECT assigned_to, status FROM handoffs WHERE id = ?", hp.id)).assigned_to === U("Otto Poster").id, r);
  ok("C-22: ...sees the claim and can complete it", (await T(() => call(OT, "claims.get", { id: a }))).ok && (await T(() => call(OT, "handoffs.close", { id: hp.id, outcome: "inprocess", note: "" }))).ok);
  r = await tryAssign(PI, hp, "Pia Poster");
  ok("C-22: the lead can take it herself", r.ok, r);
  // Submission: its own people only
  r = await tryAssign(QU, hs, "Pia Poster");
  const r2 = await tryAssign(QU, hs, "Rex Reject");
  ok("C-22: the Submission lead: a Payment posting person refused, a Submission person on the client accepted", !r.ok && /Submission/.test(r.e) && r2.ok, [r, r2]);
  const offS = (((await call(QU, "handoffs.list", {})).assignees || {})[sun.id + "|submission"] || []).map((u) => u.name).sort();
  ok("C-22: ...and the Submission tab offers Submission people on the client only", offS.join() === ["Quin Submit", "Rex Reject"].join(), offS);
  const PT = await firstIn("Pat Postlead"), seen = await call(PT, "handoffs.list", {});
  ok("C-22: someone who sees the hand-offs but cannot assign them (not the lead or backup) gets no list of people", seen.rows.some((h) => h.id === hp.id && !h.can_assign) && !Object.keys(seen.assignees || {}).length, seen.assignees);
  await call(TI, "clients.accessRemove", { client_id: sun.id, user_id: U("Lex Lakepost").id });
});

await part("C-05: a hand-off waiting on the client follows a new responsible person", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const setDesk = (dept, lead, backup = null) => A("clients.saveResponsibility", { client_id: sun.id, dept, mode: "person", lead: U(lead).id, backup: backup ? U(backup).id : null });
  await setDesk("posting", "Pia Poster");
  const [a, b, d] = await give("Arun Agent", 3);
  for (const id of [a, b]) { await call(AR, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF }); await save(AR, id, SAAG.post); }
  const waiting = await openH(a, "posting"), plain = await openH(b, "posting");
  await call(PI, "handoffs.close", { id: waiting.id, outcome: "client", reason: "Need EOB / ERA from the client", note: "Asked the office for the EOB copy" });
  const n0 = (await call(PI, "handoffs.count")).n;
  await setDesk("posting", "Otto Poster");
  const lead = async (id) => (await row1("SELECT lead_id FROM handoffs WHERE id = ?", id)).lead_id;
  ok("C-05: the open hand-off and the one waiting on the client both move to the new Payment posting person", (await lead(plain.id)) === U("Otto Poster").id && (await lead(waiting.id)) === U("Otto Poster").id, [await lead(plain.id), await lead(waiting.id)]);
  ok("C-05: ...the new person sees it under Waiting on client", (await call(OT, "handoffs.list", { view: "client" })).rows.some((r) => r.id === waiting.id));
  ok("C-05: ...it is off the old person's list and badge", !(await call(PI, "handoffs.list", { view: "client" })).rows.some((r) => r.id === waiting.id) && (await call(PI, "handoffs.count")).n <= n0 - 2, [n0, (await call(PI, "handoffs.count")).n]);
  ok("C-05: ...and the new person can resume it when the client answers", (await T(() => call(OT, "handoffs.close", { id: waiting.id, outcome: "resume", note: "The office sent the EOB" }))).ok && (await row1("SELECT status FROM handoffs WHERE id = ?", waiting.id)).status === "pending");
  // Submission the same way, and a recheck waiting on the client follows a new follow-up person
  await save(AR, d, SAAG.resub);
  const hs = await openH(d, "submission");
  await call(QU, "handoffs.close", { id: hs.id, outcome: "client", reason: "Need signature or documents", note: "Need the signed form from the office" });
  await setDesk("submission", "Rex Reject");
  ok("C-05: Submission: the hand-off waiting on the client moves to the new Submission person", (await lead(hs.id)) === U("Rex Reject").id, await lead(hs.id));
  await call(RX, "handoffs.close", { id: hs.id, outcome: "resume", note: "Form received" });
  await submitIt(RX, d);
  setNow(IST(2026, 11, 12, 12, 0));
  const rc = await openH(d, "subcheck");
  await call(RX, "handoffs.close", { id: rc.id, outcome: "client", reason: "Need signature or documents", note: "The payer asks for the signed form again" });
  await A("clients.saveResponsibility", { client_id: sun.id, dept: "subcheck", mode: "person", lead: U("Quin Submit").id });
  const rc2 = await row1("SELECT lead_id, assigned_to, status FROM handoffs WHERE id = ?", rc.id);
  ok("C-05: a recheck waiting on the client moves to the new follow-up person", rc2.lead_id === U("Quin Submit").id && rc2.assigned_to === U("Quin Submit").id && rc2.status === "client", rc2);
  // back to the usual desks for the sections after this one
  await sql("UPDATE clients SET submission_check_mode = '', submission_check_person = NULL WHERE id = ?", sun.id);
  await setDesk("posting", "Pia Poster", "Otto Poster"); await setDesk("submission", "Quin Submit");
});

await part("C-06: two different choices on one hand-off at the same moment: the first wins", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  // Quin and Rex both answer for Submission here (lead and backup), so two people can act on one hand-off
  await A("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Quin Submit").id, backup: U("Rex Reject").id });
  const [a, b, d, e, f] = await give("Arun Agent", 5);
  for (const id of [a, b, d, e, f]) await save(AR, id, SAAG.resub);
  const deskNotes = async (id) => (await rows("SELECT comment FROM notes WHERE claim_id = ? AND kind = 'note'", id)).map((n) => n.comment);
  const BACK = { outcome: "back", reason: "Missing claim data", note: "Need the NPI on line two" }, CLIENT = { outcome: "client", reason: "Need signature or documents", note: "Need the signed form first" };
  const DONE = () => ({ outcome: "complete", proof: { date: nowIso(), ref: "B-9", mode: "Portal" }, note: "Sent" });
  // both requests reach the server together (two desk people, the same sign-in path): the status guard decides
  let h = await openH(a, "submission");
  let rs = await Promise.all([T(() => call(QU, "handoffs.close", { id: h.id, ...BACK })), T(() => call(RX, "handoffs.close", { id: h.id, ...CLIENT }))]);
  let c = await claim(a), st = (await row1("SELECT status FROM handoffs WHERE id = ?", h.id)).status;
  ok("C-06: Need assistance from AR and from client at once: one is accepted, the other refused", rs.filter((r) => r.ok).length === 1, rs.map((r) => r.ok || r.e));
  ok("C-06: ...the claim follows the one that won, with one desk note (not half of each)", (await deskNotes(a)).length === 1 && (st === "back" ? c.state === "assigned" && c.handoff_status === "submission_back" && c.last_bucket !== "Client" : st === "client" && c.state === "in_process" && c.handoff_status === "submission_client" && c.last_bucket === "Client"), [st, await brief(a), await deskNotes(a)]);
  ok("C-06: ...and the one refused is told why", /already waiting on the client|already closed|at the same moment/.test((rs.find((r) => !r.ok) || {}).e || ""), rs.map((r) => r.ok || r.e));
  h = await openH(b, "submission");
  rs = await Promise.all([T(() => call(RX, "handoffs.close", { id: h.id, ...CLIENT })), T(() => call(QU, "handoffs.close", { id: h.id, ...DONE() }))]);
  st = (await row1("SELECT status FROM handoffs WHERE id = ?", h.id)).status; c = await claim(b);
  ok("C-06: Need assistance from client and Completed at once: one is accepted", rs.filter((r) => r.ok).length === 1 && (st === "client" ? c.state === "in_process" && !(await openH(b, "subcheck")) : st === "complete" && c.handoff_status === "submitted" && c.last_bucket === "Payer"), [rs.map((r) => r.ok || r.e), st, await brief(b)]);
  // one request lands just after the other (the admin's is quicker through sign-in): the page says where the hand-off stood on the
  // person's screen (seen), and a choice made on an old screen is refused
  h = await openH(d, "submission");
  rs = await Promise.all([T(() => call(QU, "handoffs.close", { id: h.id, ...BACK, seen: "pending" })), T(() => call(A, "handoffs.close", { id: h.id, ...CLIENT, seen: "pending" }))]);
  st = (await row1("SELECT status FROM handoffs WHERE id = ?", h.id)).status;
  ok("C-06: the same two choices from the page (it says where the hand-off stood): one is accepted, the other refused", rs.filter((r) => r.ok).length === 1 && (await deskNotes(d)).length === 1, [rs.map((r) => r.ok || r.e), st]);
  ok("C-06: ...the refusal says what changed, with its own code so the page reloads the list", rs.some((r) => !r.ok && r.status === 409 && /has changed since you opened it: it is waiting on the client now/.test(r.e)), rs.map((r) => r.ok || [r.status, r.e]));
  h = await openH(e, "submission");
  await call(QU, "handoffs.close", { id: h.id, ...CLIENT, seen: "pending" });
  let r = await T(() => call(RX, "handoffs.close", { id: h.id, ...DONE(), seen: "assigned" }));
  ok("C-06: Completed chosen on a screen that still showed it on the desk is refused once it waits on the client", !r.ok && r.status === 409, r);
  r = await T(() => call(RX, "handoffs.close", { id: h.id, outcome: "resume", note: "The office sent the form", seen: "client" }));
  const r2 = await T(() => call(QU, "handoffs.close", { id: h.id, ...BACK, seen: "client" }));
  ok("C-06: Client answered goes through; a choice from a screen that still showed Waiting on client is then refused", r.ok && !r2.ok && r2.status === 409 && /the client has answered and it is back on the desk/.test(r2.e), [r, r2]);
  r = await T(() => call(QU, "handoffs.close", { id: h.id, ...BACK, seen: "pending" }));
  ok("C-06: with the screen up to date the choice is saved (pending or assigned is the same place: on the desk)", r.ok, r);
  // a lead assigning it at the same moment does not block the person completing it (it is still on the desk)
  h = await openH(f, "submission");
  rs = await Promise.all([T(() => call(QU, "handoffs.assign", { id: h.id, user_id: U("Rex Reject").id })), T(() => call(RX, "handoffs.close", { id: h.id, ...DONE(), seen: "pending" }))]);
  ok("C-06: a hand-off assigned at the same moment can still be completed", rs[1].ok && (await row1("SELECT status FROM handoffs WHERE id = ?", h.id)).status === "complete", rs.map((r) => r.ok || r.e));
  await A("clients.saveResponsibility", { client_id: sun.id, dept: "submission", mode: "person", lead: U("Quin Submit").id });
});

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
