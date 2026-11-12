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

await part("C-09: a claim at a desk that the team lead's review gives to another biller reaches that biller", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const REVIEW = { why: "Biller flagged it", reviewed: "Claim history and the portal", findings: "Bela knows this payer better", next: "Bela takes it after the desk" };
  const [a, b, d, e] = await give("Arun Agent", 4);
  // flagged in the same save that sends it to Submission; the team lead gives it to Bela
  await save(AR, a, SAAG.resub, { escalate: true });
  await sql("DELETE FROM user_notices");
  let r = await T(() => call(TI, "attention.review", { id: a, ...REVIEW, route: "other", user_id: U("Bela Agent").id }));
  let h = await openH(a, "submission");
  ok("C-09: the review is saved; the claim stays with Submission and the hand-off's AR biller is now the new biller", r.ok && r.r.waits === "Submission" && (await claim(a)).state === "in_process" && h.biller_id === U("Bela Agent").id, [r, h && h.biller_id]);
  ok("C-09: the notice says it comes to her list when the desk finishes", (await rows("SELECT text FROM user_notices WHERE user_id = ?", U("Bela Agent").id)).some((n) => /It is with Submission now and comes to your list when they finish/.test(n.text)), await rows("SELECT text FROM user_notices"));
  setNow(IST(2026, 11, 10, 12, 0));
  await sql("DELETE FROM user_notices");
  r = await T(() => submitIt(QU, a));
  let c = await claim(a);
  ok("C-09: when Submission finishes, the claim is on the new biller's list, first, for today", r.ok && r.r.listed === true && c.state === "assigned" && c.assigned_to === U("Bela Agent").id && c.first_up === 1 && c.follow_up_on === "2026-11-10" && c.handoff_status === "submitted", [r, await brief(a)]);
  const nx = await call(BE, "queue.next");
  ok("C-09: ...Work the next claim opens it for her", nx.claim && nx.claim.id === a, nx.claim && nx.claim.claim_no);
  const told = await rows("SELECT user_id, text FROM user_notices WHERE text LIKE '%submitted claim%'");
  ok("C-09: ...the desk's notice goes to her (not the first biller) and says so", told.length === 1 && told[0].user_id === U("Bela Agent").id && /first on your list now/.test(told[0].text), told);
  const rc = (await hos(a)).find((x) => x.dept === "subcheck");
  ok("C-09: ...and the recheck is hers on My day", rc && rc.biller_id === U("Bela Agent").id && (await call(BE, "handoffs.myRechecks")).rows.some((x) => x.id === rc.id) && !(await call(AR, "handoffs.myRechecks")).rows.some((x) => x.id === rc.id), rc && rc.biller_id);
  // not reviewed: Submission finishing keeps the usual 15-day follow-up with the first biller
  await save(AR, b, SAAG.resub);
  r = await T(() => submitIt(QU, b)); c = await claim(b);
  ok("C-09: a claim nobody reviewed still comes back as before (worked, 15-day follow-up)", r.ok && !r.r.listed && c.state === "completed" && c.follow_up_on === "2026-11-25" && c.assigned_to === U("Arun Agent").id, await brief(b));
  // at Payment posting: Posting closes it, and the notice says that instead of promising the list
  await call(AR, "attachments.add", { claim_id: d, name: "eob.pdf", type: "application/pdf", data: PDF });
  await save(AR, d, SAAG.post, { escalate: true });
  await sql("DELETE FROM user_notices");
  r = await T(() => call(TI, "attention.review", { id: d, ...REVIEW, route: "other", user_id: U("Bela Agent").id }));
  ok("C-09: at Payment posting the notice says Posting closes it (no promise of the list)", r.ok && (await rows("SELECT text FROM user_notices WHERE user_id = ?", U("Bela Agent").id)).some((n) => /It is with Payment Posting now, which closes it once the payment is posted/.test(n.text) && !/comes to your list/.test(n.text)), await rows("SELECT text FROM user_notices"));
  await postIt(d);
  ok("C-09: ...and Posting completing it closes the claim as always", (await claim(d)).state === "closed" && (await claim(d)).handoff_status === "posted", await brief(d));
  // sent back by the desk instead: first on the new biller's list, and she is the one told
  await save(AR, e, SAAG.resub, { escalate: true });
  await call(TI, "attention.review", { id: e, ...REVIEW, route: "other", user_id: U("Bela Agent").id });
  await sql("DELETE FROM user_notices");
  await call(QU, "handoffs.close", { id: (await openH(e, "submission")).id, outcome: "back", reason: "Missing claim data", note: "Need the NPI on line two" });
  c = await claim(e);
  ok("C-09: if the desk sends it back instead, it is first on the new biller's list and she is told", c.state === "assigned" && c.assigned_to === U("Bela Agent").id && c.first_up === 1 && (await rows("SELECT user_id FROM user_notices WHERE text LIKE '%back to you%'")).every((n) => n.user_id === U("Bela Agent").id), [await brief(e), await rows("SELECT user_id, text FROM user_notices")]);
});

await part("C-19: the files of a Posting Closed claim cannot be removed", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [a, b] = await give("Arun Agent", 2);
  const file = (await call(AR, "attachments.add", { claim_id: a, name: "eob.pdf", type: "application/pdf", data: PDF })).attachment;
  const other = (await call(AR, "attachments.add", { claim_id: b, name: "eob.pdf", type: "application/pdf", data: PDF })).attachment;
  await save(AR, a, SAAG.post);
  await call(PI, "handoffs.close", { id: (await openH(a, "posting")).id, outcome: "complete", proof: { date: nowIso(), ref: "CHK-1", allowed: "100", paid: "80", adjustment: "20", files: ["eob.pdf"] }, note: "Posted" });
  setNow(IST(2026, 11, 10, 15, 0));
  const r1 = await T(() => call(AR, "attachments.delete", { id: file.id })), r2 = await T(() => call(TI, "attachments.delete", { id: file.id }));
  ok("C-19: the biller who attached the EOB cannot remove it from a Posting Closed claim (same day)", !r1.ok && /its files can no longer be removed/.test(r1.e), r1);
  ok("C-19: nor can the team lead", !r2.ok && /its files can no longer be removed/.test(r2.e), r2);
  ok("C-19: the file is still there, and the claim page offers no Remove for it", (await rows("SELECT id FROM attachments WHERE id = ?", file.id)).length === 1 && (await call(TI, "claims.get", { id: a })).attachments.every((x) => x.deletable === false) && (await call(AR, "claims.get", { id: a })).attachments.every((x) => x.deletable === false));
  const added = await T(() => call(AR, "attachments.add", { claim_id: a, name: "eob-page-2.pdf", type: "application/pdf", data: PDF }));
  ok("C-19: a file can still be added to it, and that one cannot be removed either", added.ok && added.r.attachment.deletable === false && !(await T(() => call(AR, "attachments.delete", { id: added.r.attachment.id }))).ok, added);
  ok("C-19: on a claim that is not Posting Closed a file is removed as before", (await call(AR, "claims.get", { id: b })).attachments.some((x) => x.id === other.id && x.deletable) && (await T(() => call(AR, "attachments.delete", { id: other.id }))).ok);
});

await part("C-15 / E-10 / D-06: text written to the OneDrive Excel files is never read as a formula", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const EVIL = '=HYPERLINK("https://example.invalid/x","Open the client file")';
  const [a, b, d] = await give("Arun Agent", 3);
  await sql("UPDATE claims SET patient = ?, balance = -25.5 WHERE id = ?", EVIL, a);   // a patient cell from a client's file, and a credit balance
  const SI = await firstIn("Sima Expert");
  rig.liveEnv.DEMO = false;   // OneDrive copies on, into the fake Graph
  try {
    OD.writes.length = 0;
    // the AR Production row of a saved entry (appendRowTo)
    await save(AR, a, SAAG.resub); await sleep(400);
    const arRow = (OD.writes.find((w) => /^AR Production/.test(w.file)) || { values: [] }).values.slice(-1)[0] || [];
    const iPat = AR_TEMPLATE.indexOf("Patient Name"), iBal = AR_TEMPLATE.indexOf("Balance Amount($)"), iUni = AR_TEMPLATE.indexOf("Uni");
    ok("D-06: AR Production row: a patient cell that starts with = is written as text (a leading ')", arRow[iPat] === "'" + EVIL && String(arRow[iUni]).startsWith("'="), [arRow[iPat], arRow[iUni]]);
    ok("D-06: ...and the balance stays a number, a negative one too", arRow[iBal] === -25.5, arRow[iBal]);
    // the Submission desk's rows (appendDeskRow): a comment, and the free-text fields of the Completed form
    const h = await openH(a, "submission");
    await call(QU, "handoffs.close", { id: h.id, outcome: "pending", note: "-ve balance on the account, refund asked" }); await sleep(300);
    await call(QU, "handoffs.close", { id: h.id, outcome: "complete", note: '=HYPERLINK("https://example.invalid","see batch")', proof: { date: nowIso(), ref: "B-1", mode: "Portal", inv_status: "+Resubmitted", bucket: "@Payer", type: "-3" } }); await sleep(400);
    const SUBH = ["Client", "UID", "Date", "Patient", "Invoice", "NAEC Order No", "VEC S/W Insurance Name", "Insurance", "Balance", "VEC Patient Balance", "Location", "Type", "VEC Claims Sourse", "VEC Submission Type", "Old status", "Old Comment", "old bucket", " Old Onhold/Pending ", "Allocation Date", "Allocation", "DOW", "EMPID", "Worked by", "Inventory Status", "Comment", "Bucket", "Claim Type"];
    const subRows = OD.writes.filter((w) => /^Submission Production/.test(w.file)).map((w) => w.values[0]).filter((r) => r[0] !== "Client");
    const S_ = (r, k) => (r || [])[SUBH.indexOf(k)];
    ok("C-15: Submission row: a comment that starts with - is written as text", S_(subRows[0], "Comment") === "'-ve balance on the account, refund asked", S_(subRows[0], "Comment"));
    ok("C-15: ...a comment that starts with =, an Inventory Status with + and a Bucket with @ too", S_(subRows[1], "Comment") === "'=HYPERLINK(\"https://example.invalid\",\"see batch\")" && S_(subRows[1], "Inventory Status") === "'+Resubmitted" && S_(subRows[1], "Bucket") === "'@Payer", [S_(subRows[1], "Comment"), S_(subRows[1], "Inventory Status"), S_(subRows[1], "Bucket")]);
    ok("C-15: ...numbers stay numbers (the negative balance), and text that is only a number stays as typed", S_(subRows[1], "Balance") === -25.5 && S_(subRows[1], "Type") === "-3" && typeof S_(subRows[1], "DOW") === "number", [S_(subRows[1], "Balance"), S_(subRows[1], "Type"), S_(subRows[1], "DOW")]);
    ok("C-15: ...ordinary text is written as it is", S_(subRows[1], "Patient") === "'" + EVIL && S_(subRows[1], "Worked by") === "Quin Submit" && S_(subRows[0], "Inventory Status") === "Pending", [S_(subRows[1], "Worked by"), S_(subRows[0], "Inventory Status")]);
    // Payment posting row: the check reference and the comment
    await call(AR, "attachments.add", { claim_id: b, name: "eob.pdf", type: "application/pdf", data: PDF });
    await save(AR, b, SAAG.post); await sleep(300);
    await call(PI, "handoffs.close", { id: (await openH(b, "posting")).id, outcome: "complete", proof: { date: nowIso(), ref: "+EFT 7781", allowed: "100", paid: "80", adjustment: "20", adj_reason: "-CO45" }, note: "@team posted per the ERA" }); await sleep(400);
    const postRow = (OD.writes.filter((w) => /^Payment posting Production/.test(w.file)).map((w) => w.values[0]).filter((r) => r[0] !== "Client").slice(-1)[0]) || [];
    ok("C-15: Payment posting row: the reference, the adjustment reason and the comment are text; the amounts are numbers", postRow.includes("'+EFT 7781") && postRow.includes("'-CO45") && postRow.includes("'@team posted per the ERA") && postRow.includes(80) && postRow.includes(20), postRow);
    // Rejections row (the desk header layout)
    await save(AR, d, SAAG.rej); await sleep(300);
    await call(RX, "handoffs.close", { id: (await openH(d, "rejection")).id, outcome: "other", reason: "=not sure", note: "-waiting for the payer portal to come back" }); await sleep(400);
    const rejRow = (OD.writes.filter((w) => /^Rejections Production/.test(w.file)).map((w) => w.values[0]).filter((r) => r[0] !== "Sr. No").slice(-1)[0]) || [];
    ok("C-15: Rejections row: the reason and the comment are text", rejRow.includes("'=not sure") && rejRow.includes("'-waiting for the payer portal to come back"), rejRow);
    // the escalation register and the month's SLA copy
    OD.writes.length = 0;
    const e = await T(() => call(SI, "escalations.save", { client_id: sun.id, kind: "external", day: nowIso(), dept: "Account Receivable", raised_who: EVIL, reported_to: "Tina Lead", owner_id: U("Tina Lead").id, location_id: "all",
      channels: ["Email"], email_subject: "=1+2", description: "Made-up description of the problem.", comment: "-ve balance shown after posting" }));
    await sleep(900);
    const escFiles = OD.writes.filter((w) => /^Escalation Tracker/.test(w.file));
    const bad = escFiles.flatMap((w) => w.values.flat()).filter((v) => typeof v === "string" && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v));
    ok("E-10: the escalation is saved and written to the register and to the month's SLA copy", e.ok && escFiles.some((w) => w.file === "Escalation Tracker - Sunrise Eye Care.xlsx") && escFiles.some((w) => /Nov 2026\.xlsx$/.test(w.file)), [e, escFiles.map((w) => w.file)]);
    ok("E-10: no cell in either file starts with = + - or @ (Raised by, Email subject, Comment are text)", !bad.length && escFiles.every((w) => w.values.some((r) => r.includes("'" + EVIL) && r.includes("'=1+2") && r.includes("'-ve balance shown after posting"))), bad.slice(0, 4));
    ok("E-10: ...the dates stay Excel date numbers and the SR No, the department and the headers are as they were", escFiles.every((w) => w.values[0][0] === "SR No" && w.values.slice(1).every((r) => /^SR\d+$/.test(r[0]) && r[1] === "Account Receivable" && typeof r[3] === "number")), escFiles.map((w) => w.values.slice(0, 2).map((r) => r.slice(0, 4))));
  } finally { rig.liveEnv.DEMO = true; }
  // the one rule, in one place: every Graph write of cell values goes through writeRange
  const src = (await import("fs")).readFileSync(new URL("../../worker.js", import.meta.url), "utf8");
  ok("C-15: worker.js sends cell values to Graph only through writeRange", (src.match(/"PATCH",[^\n]*\{ values/g) || []).length === 1 && /const writeRange = [^\n]*row\.map\(xlText\)/.test(src), (src.match(/"PATCH",[^\n]*\{ values/g) || []).length);
});

await part("C-07: the 48-hour recheck is not a second claim received and submitted on the desk dashboard", async () => {
  // a week of its own (Mon 16 Nov), so the dates of the dashboard hold only this section's work
  setNow(IST(2026, 11, 16, 10, 0));
  const dash = () => call(TI, "handoffs.dashboard", { dept: "submission", client_id: sun.id, from_ms: IST(2026, 11, 16, 0, 0), to_ms: Date.now() });
  const open0 = (await dash()).totals.open_now || 0;
  const [a, b] = await give("Arun Agent", 2);
  await save(AR, a, SAAG.resub); await save(AR, b, SAAG.resub);
  setNow(IST(2026, 11, 16, 14, 0));   // submitted after 4 working hours
  await submitIt(QU, a); await submitIt(QU, b);
  setNow(IST(2026, 11, 18, 15, 0));   // the rechecks opened at 14:00; the biller accepts one, the other is rejected again
  await call(AR, "handoffs.close", { id: (await openH(a, "subcheck")).id, outcome: "complete", proof: { date: nowIso() }, note: "" });
  let d = await dash(), t = d.totals;
  ok("C-07: two claims sent and submitted, one recheck accepted: Received 2 and Submitted 2 (not 4 and 3)", t.received === 2 && t.completed === 2 && t.done === 2 && t.met === 2, { received: t.received, completed: t.completed, done: t.done, met: t.met });
  ok("C-07: ...the average time to complete is the submissions' own (4 working hours)", t.avg_hours === 4, t.avg_hours);
  ok("C-07: ...By person lists the Submission person, not the AR biller who accepted the recheck", !d.by_person.some((p) => p.name === "Arun Agent") && d.by_person.some((p) => p.name === "Quin Submit" && p.completed === 2 && p.done === 2 && p.avg_hours === 4), d.by_person);
  const bc = d.by_client.find((x) => x.client_name === sun.name) || {};
  ok("C-07: ...By client and By day count the same two", bc.received === 2 && bc.completed === 2 && bc.done === 2 && d.by_day.reduce((n, x) => n + x.received, 0) === 2 && d.by_day.reduce((n, x) => n + x.done, 0) === 2, [bc, d.by_day]);
  ok("C-07: the recheck still open is still counted under Open now", t.open_now === open0 + 1, [open0, t.open_now]);
  await call(AR, "handoffs.close", { id: (await openH(b, "subcheck")).id, outcome: "rejected", reason: "Taxonomy missing", note: "Payer rejected it for the taxonomy again" });
  d = await dash(); t = d.totals;
  ok("C-07: a recheck rejected again still shows as 'rejected on recheck' and in the rejections by code", t.rejected === 1 && d.rejections.total === 1 && d.rejections.by_code[0].name === "Taxonomy missing", [t.rejected, d.rejections]);
  ok("C-07: ...and the Rejections task it opens is a claim received (the desk's own work)", t.received === 3 && t.completed === 2, { received: t.received, completed: t.completed });
});

await part("C-08: 'needed assistance' on the desk dashboard counts Need assistance from AR", async () => {
  setNow(IST(2026, 11, 19, 10, 0));
  const dash = () => call(TI, "handoffs.dashboard", { dept: "submission", client_id: sun.id, from_ms: IST(2026, 11, 19, 0, 0), to_ms: Date.now() });
  const [a] = await give("Arun Agent", 1);
  await save(AR, a, SAAG.resub);
  ok("C-08: nothing sent back yet: 0 needed assistance", ((await dash()).totals.assist || 0) === 0, (await dash()).totals.assist);
  setNow(IST(2026, 11, 19, 12, 0));
  await call(QU, "handoffs.close", { id: (await openH(a, "submission")).id, outcome: "back", reason: "Missing claim data", note: "Need the NPI on line two" });
  const t = (await dash()).totals;
  ok("C-08: after Need assistance from AR the Open now card says 1 needed assistance (the same 1 as 'back to AR')", t.assist === 1 && t.back === 1, { assist: t.assist, back: t.back });
});

await part("C-20 / C-21: the desk dashboard counts open and past TAT by the desk list's rule", async () => {
  setNow(IST(2026, 11, 23, 10, 0));
  const dash = () => call(TI, "handoffs.dashboard", { dept: "submission", client_id: sun.id, from_ms: IST(2026, 11, 23, 0, 0), to_ms: Date.now() });
  const list = () => call(TI, "handoffs.list", { dept: "submission", client_id: sun.id });
  const row = (d) => d.by_client.find((x) => x.client_name === sun.name) || {};
  // everything left open by the sections before is put on hold or closed out of the way by date: compare changes, not totals
  const d0 = await dash(), l0 = await list();
  const [a, b] = await give("Arun Agent", 2);
  await save(AR, a, SAAG.resub); await save(AR, b, SAAG.resub);
  const ha = await openH(a, "submission"), hb = await openH(b, "submission");
  await call(QU, "handoffs.close", { id: hb.id, outcome: "client", reason: "Need signature or documents", note: "Need the signed form from the office" });
  setNow(IST(2026, 11, 25, 12, 0));   // both past the 24 working hours now
  let d = await dash(), l = await list();
  ok("C-21: a claim waiting on the client counts as open and past TAT on the card and in By client alike", d.totals.open_now === d0.totals.open_now + 2 && row(d).open_now === d.totals.open_now && row(d).overdue_now === d.totals.overdue_now, { card: [d.totals.open_now, d.totals.overdue_now], by_client: [row(d).open_now, row(d).overdue_now] });
  ok("C-21: ...and By person counts it for the person who has it", d.by_person.some((p) => p.name === "Quin Submit" && p.open_now >= 2), d.by_person);
  ok("C-20: (before the hold) the dashboard's past TAT is the list's Past TAT card", d.totals.overdue_now === l.stats.overdue && d.attention.some((x) => x.id === ha.id && x.why === "past"), [d.totals.overdue_now, l.stats.overdue]);
  // the team lead puts one on hold (Can't close yet)
  await call(TI, "tat.hold", { kind: "handoff", id: ha.id, reason: "Waiting on the payer", note: "Payer system down", until: "2026-11-27" });
  const d2 = await dash(), l2 = await list();
  ok("C-20: one on hold leaves the dashboard's past TAT, as it leaves the list's card", d2.totals.overdue_now === d.totals.overdue_now - 1 && l2.stats.overdue === l.stats.overdue - 1 && d2.totals.overdue_now === l2.stats.overdue, { dash: [d.totals.overdue_now, d2.totals.overdue_now], list: [l.stats.overdue, l2.stats.overdue] });
  ok("C-20: ...By client drops it too, and it is still open", row(d2).overdue_now === d2.totals.overdue_now && d2.totals.open_now === d.totals.open_now, [row(d2), d2.totals.open_now]);
  ok("C-20: ...and Needs you now no longer lists it as past the TAT", !d2.attention.some((x) => x.id === ha.id && (x.why === "past" || x.why === "soon")), d2.attention.filter((x) => x.id === ha.id));
  setNow(IST(2026, 11, 28, 10, 0));   // the expected date has passed
  ok("C-20: after the expected date it is past the TAT again", (await dash()).attention.some((x) => x.id === ha.id && x.why === "past") && (await dash()).totals.overdue_now === (await list()).stats.overdue);
});

await part("C-10: a sent-back claim is reviewed once", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const REVIEW = { why: "Submission sent it back", reviewed: "The claim and the desk note", findings: "The NPI is missing on line two", next: "Add the NPI and send it again" };
  const [a] = await give("Arun Agent", 1);
  await save(AR, a, SAAG.resub);
  await call(QU, "handoffs.close", { id: (await openH(a, "submission")).id, outcome: "back", reason: "Missing claim data", note: "Need the NPI on line two" });
  const rowOf = async () => (await call(TI, "attention.fromDesks")).rows.find((x) => x.claim_id === a);
  ok("C-10: the sent-back claim waits for a review (not reviewed yet)", (await rowOf()) && (await rowOf()).reviewed === false, await rowOf());
  let r = await T(() => call(TI, "attention.review", { id: a, ...REVIEW, route: "biller", sent_by: U("Arun Agent").id }));
  ok("C-10: the team lead reviews it; the row stays (until a biller saves an entry) marked reviewed, which is what takes the Review button off the page", r.ok && (await rowOf()) && (await rowOf()).reviewed === true && (await rowOf()).reviewed_by_name === "Tina Lead", [r, await rowOf()]);
  r = await T(() => call(TI, "attention.review", { id: a, ...REVIEW, route: "biller", sent_by: U("Arun Agent").id }));
  ok("C-10: a second review is refused with the true reason (already reviewed, and why the row is still there)", !r.ok && /already reviewed by Tina Lead/.test(r.e) && /until a biller saves an entry/.test(r.e) && !/was not escalated or sent back/.test(r.e), r);
  await call(AR, "queue.complete", { id: a, saag: SAAG.fu, note: NOTE("Added the NPI, following up"), rework: true });
  ok("C-10: once the biller saves an entry the row leaves the list", !(await rowOf()), await rowOf());
});

await part("C-13: the claim history says who edited an entry, and shows each edit", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [a] = await give("Arun Agent", 1);
  await save(AR, a, SAAG.fu, { findings: "Arun's own words on the portal check" });
  const nid = (await rows("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work'", a))[0].id;
  setNow(IST(2026, 11, 10, 11, 0)); await call(TI, "notes.update", { id: nid, saag: SAAG.fu, note: NOTE("Team lead rewrote this entry") });
  setNow(IST(2026, 11, 10, 12, 0)); await call(AR, "notes.update", { id: nid, saag: SAAG.fu, note: NOTE("Arun changed it again himself") });
  setNow(IST(2026, 11, 10, 13, 0)); await call(TI, "notes.update", { id: nid, saag: SAAG.fu, note: NOTE("Team lead rewrote it a second time") });
  const tl = await call(AR, "claims.timeline", { id: a });
  const w = tl.items.find((i) => i.kind === "work"), ed = tl.items.filter((i) => i.kind === "edited");
  ok("C-13: the entry still shows as worked by its author, with its latest text", w && w.who === "Arun Agent" && w.fields.findings === "Team lead rewrote it a second time", w && [w.who, w.fields.findings]);
  ok("C-13: ...and names who last edited it, and when", w && w.edited_by === "Tina Lead" && Math.abs(w.edited_at - IST(2026, 11, 10, 13, 0)) < 1000, w && [w.edited_by, w.edited_at]);
  ok("C-13: each of the three edits is a line of its own, with who made it (newest first)", ed.length === 3 && ed.map((e) => e.who).join() === "Tina Lead,Arun Agent,Tina Lead", ed.map((e) => [e.who, e.at]));
  ok("C-13: ...and each says which entry it was (the author's, with its time)", ed.every((e) => e.data.note_id === nid && e.data.entry_by === "Arun Agent" && Math.abs(e.data.entry_at - IST(2026, 11, 10, 10, 0)) < 1000), ed.map((e) => e.data));
  const g = await call(AR, "claims.get", { id: a });
  ok("C-13: the notes list on the claim page names the editor too", g.notes.some((n) => n.id === nid && n.edited_by_name === "Tina Lead"), g.notes.map((n) => [n.kind, n.edited_by_name]));
});

await part("C-14: the Rejections file's TAT column is named for what it answers (the client's own TAT)", async () => {
  await sql("UPDATE clients SET submission_tat_hours = 8 WHERE id = ?", sun.id);
  rig.liveEnv.DEMO = false;
  try {
    setNow(IST(2026, 11, 10, 9, 0));
    const [a, b] = await give("Arun Agent", 2);
    const no = async (id) => (await claim(id)).claim_no;
    await save(AR, a, SAAG.rej); await save(AR, b, SAAG.rej); await sleep(300);
    OD.writes.length = 0;
    setNow(IST(2026, 11, 10, 11, 0));   // 2 working hours: within the client's 8
    await call(RX, "handoffs.close", { id: (await openH(a, "rejection")).id, outcome: "complete", proof: { date: nowIso(), ref: "B-2", code: "Taxonomy missing" }, note: "Fixed the taxonomy" }); await sleep(300);
    setNow(IST(2026, 11, 10, 19, 0));   // 10 working hours: past the client's 8, though within 24
    await call(RX, "handoffs.close", { id: (await openH(b, "rejection")).id, outcome: "complete", proof: { date: nowIso(), ref: "B-3", code: "Taxonomy missing" }, note: "Fixed the taxonomy" }); await sleep(400);
    const file = [...OD.items.values()].find((x) => x.kind === "file" && /^Rejections Production - Sunrise Eye Care - Nov 2026\.xlsx$/.test(x.name));
    const tab = file && OD.books.get(file.id).sheets.find((x) => x.name === "Rejections"), head = tab ? tab.rows[0] : [], k = head.findIndex((h) => /TAT/.test(String(h)));
    const rowOf = async (id) => (tab ? tab.rows : []).find((r) => r.includes(await0[id])) || [];
    const await0 = { [a]: await no(a), [b]: await no(b) };
    ok("C-14: the column is 'Within TAT', with no '24h' in it", head[k] === "Within TAT" && !head.some((h) => /24h/.test(String(h))), head.slice(-3));
    ok("C-14: ...and it answers by the client's TAT of 8 working hours: Yes after 2 hours, No after 10", (await rowOf(a))[k] === "Yes" && (await rowOf(b))[k] === "No", [(await rowOf(a))[k], (await rowOf(b))[k]]);
  } finally { rig.liveEnv.DEMO = true; await sql("UPDATE clients SET submission_tat_hours = 24 WHERE id = ?", sun.id); }
});

await part("C-16: an open rejection is at the top of the desk's Open list", async () => {
  // the Submission person is also the Rejections person here; a resubmission came an hour before the rejection
  await A("clients.saveResponsibility", { client_id: sun.id, dept: "rejection", mode: "person", lead: U("Quin Submit").id });
  setNow(IST(2026, 12, 1, 10, 0));
  const [a, b, d, e] = await give("Arun Agent", 4);
  await save(AR, a, SAAG.resub);
  setNow(IST(2026, 12, 1, 11, 0));
  await save(AR, b, SAAG.rej); await save(AR, d, SAAG.rej); await save(AR, e, SAAG.resub);
  await call(QU, "handoffs.close", { id: (await openH(d, "rejection")).id, outcome: "client", reason: "Need signature or documents", note: "Need the signed form from the office" });
  setNow(IST(2026, 12, 3, 12, 0));
  await call(TI, "tat.hold", { kind: "handoff", id: (await openH(e, "submission")).id, reason: "Waiting on the payer", note: "Payer system down", until: "2026-12-04" });
  const mine = new Set([a, b, d, e]);
  const server = (await call(QU, "handoffs.list", { from_ms: IST(2026, 12, 1, 0, 0) })).rows.filter((h) => mine.has(h.claim_id));
  // the page's own default order of that list (HandoffsView: the TAT column, earliest first)
  const shown = rig.app.useTableSort("due_at", "asc").sortRows(server, { due_at: rig.app.handoffDueKey }).map((h) => h.claim_id);
  ok("C-16: the server sends the open rejection first", server[0].claim_id === b && server[0].dept === "rejection", server.map((h) => h.dept + ":" + h.status));
  ok("C-16: the page keeps it first, above the resubmission that is due earlier", shown[0] === b && shown[1] === a, shown.map((id) => [a, b, d, e].indexOf(id)));
  ok("C-16: ...the one on hold is after the rest", shown.length === 3 && shown[2] === e, shown.map((id) => [a, b, d, e].indexOf(id)));
  const K = rig.app.handoffDueKey;
  ok("C-16: ...a rejection waiting on the client is not pulled to the top, and a finished one sorts by when it was done", K({ status: "client", dept: "rejection", due_at: 500 }) === 500 && K({ status: "pending", dept: "rejection", due_at: 500 }) < 0 && K({ status: "complete", dept: "rejection", due_at: 500, done_at: 700 }) === 700);
  await A("clients.saveResponsibility", { client_id: sun.id, dept: "rejection", mode: "person", lead: U("Rex Reject").id });
});

await part("C-17: a recheck cannot be marked before it opens", async () => {
  setNow(IST(2026, 11, 10, 10, 0));
  const [a] = await give("Arun Agent", 1);
  await save(AR, a, SAAG.resub); await submitIt(QU, a);
  const rc = await openH(a, "subcheck");
  setNow(IST(2026, 11, 10, 10, 30));
  let r = await T(() => call(AR, "handoffs.close", { id: rc.id, outcome: "complete", proof: { date: nowIso() }, note: "" }));
  ok("C-17: Accepted 30 minutes after submitting is refused, with when it opens", !r.ok && /This recheck opens Nov 12, 10:00 IST/.test(r.e), r);
  r = await T(() => call(AR, "handoffs.close", { id: rc.id, outcome: "rejected", reason: "Taxonomy missing", note: "Payer rejected it for the taxonomy" }));
  const r2 = await T(() => call(QU, "handoffs.close", { id: rc.id, outcome: "back", reason: "Payer has no record yet", note: "Payer portal shows no claim on file yet" }));
  ok("C-17: ...so are Rejected again and Need assistance", !r.ok && /opens Nov 12/.test(r.e) && !r2.ok && /opens Nov 12/.test(r2.e), [r, r2]);
  ok("C-17: ...the recheck is still open, and My day says it opens later (no buttons until then)", (await row1("SELECT status FROM handoffs WHERE id = ?", rc.id)).status === "assigned" && (await call(AR, "handoffs.myRechecks")).rows.some((x) => x.id === rc.id && x.open === false));
  const strangers = await T(() => call(CY, "handoffs.close", { id: rc.id, outcome: "complete", proof: { date: nowIso() } }));
  ok("C-17: someone who may not mark it is still told so first", !strangers.ok && strangers.status === 403, strangers);
  setNow(IST(2026, 11, 12, 10, 5));   // it opened at 10:00 (48 working hours)
  ok("C-17: once it opens My day offers it", (await call(AR, "handoffs.myRechecks")).rows.some((x) => x.id === rc.id && x.open === true));
  r = await T(() => call(AR, "handoffs.close", { id: rc.id, outcome: "complete", proof: { date: nowIso() }, note: "" }));
  ok("C-17: ...and Accepted is saved", r.ok && (await row1("SELECT status FROM handoffs WHERE id = ?", rc.id)).status === "complete", r);
});

await part("C-18: the red past-TAT bar names the person's own tab", async () => {
  // the page's bars (their text is in the page code; the browser check repro-C-18.js drives the real page)
  const app = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  const red = (app.match(/<div className="tat-bar" onClick=\{\(\) => setView\("handoffs"\)\}>⚠[^\n]*/) || [""])[0];
  ok("C-18: the red bar says 'Open <their tab>' (Submission, Payment posting), as the amber bar does, not always 'Posting & submission'", /Open \{\(DESK\[deskOf\(me, handoffs\)\] \|\| \{ tab: "Posting & submission" \}\)\.tab\}/.test(red) && !/Open Posting &amp; submission/.test(red), red.slice(0, 200));
  ok("C-18: the tab names it can say are the menu's own", /const DESK = \{ posting: \{ tab: "Payment posting"[^\n]*submission: \{ tab: "Submission"[^\n]*both: \{ tab: "Posting & submission"/.test(app));
  ok("C-18: a Submission person's desk is Submission", rig.app.deskOf({ department: "Submission", departments_also: "" }, { depts: ["submission"] }) === "submission");
});

await part("A-10: the posting form never shows -$0.00", async () => {
  // the page's own Payment posting amounts block, drawn with a createElement that keeps the tree (as the page would show it)
  const R = rig.app.React, real = R.createElement;
  const text = (n) => (n == null || n === false ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(text).join("") : n.children ? text(n.children) : "");
  const afterOf = (balance, paid, adjustment) => { R.createElement = (type, props, ...children) => ({ type, props, children });
    try { const t = text(rig.app.PostingAmounts({ h: { balance, billed: balance }, p: { allowed: String(Math.round((+paid + +adjustment) * 100) / 100), paid, adjustment, adj_reason: "", writeoff: "", deductible: "", coinsurance: "", copay: "" }, setP() {} }));
      return (t.match(/Balance after posting\s*([^\s✓]*)/) || [])[1]; } finally { R.createElement = real; } };
  const zeros = [[250.45, "200.15", "50.30"], [0.3, "0.10", "0.20"], [0.7, "0.40", "0.30"]].map(([b, p, a]) => afterOf(b, p, a));
  ok("A-10: a claim paid off exactly shows Balance after posting $0.00 (not -$0.00)", zeros.every((x) => x === "$0.00"), zeros);
  ok("A-10: a real balance left, or a real overpayment, still shows as it is", afterOf(250.45, "200.15", "40.30") === "$10.00" && afterOf(100, "90", "20") === "-$10.00", [afterOf(250.45, "200.15", "40.30"), afterOf(100, "90", "20")]);
});

await part("B-04: the 09:00 email and the bell state the TAT each task was given, not the client's TAT now", async () => {
  // Lakeview has its own desk here, so its reminders hold only this section's tasks
  await A("clients.saveResponsibility", { client_id: lake.id, dept: "posting", mode: "person", lead: U("Lex Lakepost").id });
  await sql("UPDATE clients SET posting_tat_hours = 24 WHERE id = ?", lake.id);
  const LL = await firstIn("Lara Lead");
  setNow(IST(2026, 11, 16, 9, 0));
  const [a, b] = await give("Cyra Agent", 2, lake);
  for (const id of [a, b]) { await call(CY, "attachments.add", { claim_id: id, name: "eob.pdf", type: "application/pdf", data: PDF }); await save(CY, id, SAAG.post); }
  await sql("UPDATE clients SET posting_tat_hours = 48 WHERE id = ?", lake.id);   // the client's TAT is changed afterwards
  setNow(IST(2026, 11, 18, 9, 0));
  const groupLine = (m) => (m.text.split("\n").find((l) => l.startsWith(lake.name + " · Payment posting")) || "");
  let m = (await call(LL, "tat.preview", { kind: "desks" })).mail || { text: "" };
  ok("B-04: the email's heading for the group says TAT 24 (the TAT the two tasks were given), not the client's 48 now", /· TAT 24 working hours$/.test(groupLine(m)), groupLine(m));
  const bell = ((await call(LL, "notify.list")).items || []).find((i) => i.key === `tat:${lake.id}:posting`);
  ok("B-04: the bell says the oldest one's own TAT (24)", bell && /\(TAT 24 h\)$/.test(bell.sub), bell && bell.sub);
  // a third task sent after the change has the 48: the heading then gives each row its own TAT
  setNow(IST(2026, 11, 18, 10, 0));
  const [d] = await give("Cyra Agent", 1, lake);
  await call(CY, "attachments.add", { claim_id: d, name: "eob.pdf", type: "application/pdf", data: PDF }); await save(CY, d, SAAG.post);
  setNow(IST(2026, 11, 23, 12, 0));
  m = (await call(LL, "tat.preview", { kind: "desks" })).mail || { text: "" };
  const lines = m.text.split("\n"), i = lines.findIndex((l) => l.startsWith(lake.name + " · Payment posting")), rowsOf = lines.slice(i + 1, i + 4);
  ok("B-04: tasks given different TATs: the heading says each claim's own TAT, and each row has its own (24, 24, 48)", /each claim's own TAT$/.test(lines[i] || "") && rowsOf.filter((l) => /TAT 24 h\)/.test(l)).length === 2 && rowsOf.filter((l) => /TAT 48 h\)/.test(l)).length === 1, [lines[i], rowsOf]);
  ok("B-04: the email carries claim numbers only (no patient names)", !(await rows("SELECT patient FROM claims WHERE id IN (?, ?, ?)", a, b, d)).some((c) => c.patient && m.text.includes(c.patient)));
  await sql("UPDATE clients SET posting_tat_hours = 24 WHERE id = ?", lake.id);
});

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
