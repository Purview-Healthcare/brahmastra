/* Suite 57: bug test round 3, tester Y's findings (fixer FY): the AR Inventory file for Drishti, OneDrive names after a rename and
   for long names, Client 360's requests waiting on the client, the Client 360 report's filters, the production Third Eye loads, and
   the roster Brahmastra hands to Third Eye. Each check names the finding it guards ("Y-07: ..."). A stand-in for Purview Shastra's
   roster and a fake Microsoft Graph (OneDrive) that keeps every file. Made-up people and data only. */
import { makeRig } from "./rig.mjs";
import vm from "vm";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/ /g, ".") + "@purview-healthcare.com";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "09:00-18:00", location: "Pune", doj: "2026-01-05", email: "" }, o);
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const FEED = [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", email: mail("Arun Agent") }),
  P({ emp_id: "A2", name: "Bela Agent", project: SUN, reports_to: "Tina Lead", email: mail("Bela Agent") }),
];
// ---- a fake Microsoft Graph: folders and files by id and by path; a file's bytes as put ----
const OD = { items: new Map(), seq: 0 };
OD.items.set("root", { id: "root", name: "root", parent: null, kind: "folder" });
const mk = (name, parent, kind) => { const id = "it" + (++OD.seq); const it = { id, name, parent, kind, webUrl: "https://od.example/" + id, rows: [] }; OD.items.set(id, it); return it; };
const child = (parent, name) => [...OD.items.values()].find((x) => x.parent === parent && x.name.toLowerCase() === String(name).toLowerCase());
const pathOf = (id) => { const p = []; let it = OD.items.get(id); while (it && it.id !== "root") { p.unshift(it.name); it = OD.items.get(it.parent); } return p.join("/"); };
const byPath = (segs, make) => { let cur = "root"; for (const s of segs) { let c = child(cur, s); if (!c) { if (!make) return null; c = mk(s, cur, "folder"); } cur = c.id; } return OD.items.get(cur); };
const out = (it) => ({ id: it.id, name: it.name, webUrl: it.webUrl, parentReference: { driveId: "d1" }, ...(it.kind === "folder" ? { folder: {} } : { file: {} }) });
const files = () => [...OD.items.values()].filter((x) => x.kind === "file").map((x) => ({ path: pathOf(x.id), it: x }));
const graph = async (url, init) => {
  const m = (init && init.method) || "GET"; const u = new URL(url); const p = decodeURIComponent(u.pathname.replace(/^\/v1\.0/, "")); let r;
  const put = async (parent, name) => { const behavior = u.searchParams.get("@microsoft.graph.conflictBehavior") || "fail"; const ex = child(parent, name);
    if (ex && behavior === "fail") return J({}, 409); const it = ex || mk(name, parent, "file"); it.bytes = Buffer.from(await new Response(init.body).arrayBuffer()); return J(out(it), ex ? 200 : 201); };
  if (m === "POST" && p.match(/^\/users\/[^/]+\/drive\/root\/children$/)) { const b = JSON.parse(init.body); if (child("root", b.name)) return J({}, 409); return J(out(mk(b.name, "root", "folder")), 201); }
  if (m === "PUT" && (r = p.match(/^\/users\/[^/]+\/drive\/root:\/(.+):\/content$/))) { const segs = r[1].split("/"); return put(byPath(segs.slice(0, -1), true).id, segs[segs.length - 1]); }
  if (m === "GET" && (r = p.match(/^\/users\/[^/]+\/drive\/root:\/(.+?):?$/))) { const it = byPath(r[1].split("/"), false); return it ? J(out(it)) : J({}, 404); }
  if (m === "POST" && (r = p.match(/^\/drives\/d1\/items\/([^/]+)\/children$/))) { const b = JSON.parse(init.body); if (child(r[1], b.name)) return J({}, 409); return J(out(mk(b.name, r[1], "folder")), 201); }
  if (m === "POST" && (r = p.match(/^\/drives\/d1\/items\/([^/]+)\/createLink$/))) return J({ link: { webUrl: "https://purview.sharepoint.example/share/" + r[1] } });
  if (m === "PUT" && (r = p.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+):\/content$/))) return put(r[1], r[2]);
  if (m === "GET" && (r = p.match(/^\/drives\/d1\/items\/([^/:]+):\/(.+?):?$/))) { const it = child(r[1], r[2].replace(/:$/, "")); return it ? J(out(it)) : J({}, 404); }
  if (m === "GET" && (r = p.match(/^\/drives\/d1\/items\/([^/:]+)$/))) { const it = OD.items.get(r[1]); return it ? J(out(it)) : J({}, 404); }
  let wb;
  if ((wb = p.match(/^\/drives\/d1\/items\/([^/]+)\/workbook\/worksheets(.*)$/))) {
    const it = OD.items.get(wb[1]); if (!it) return J({}, 404); const rest = wb[2];
    if (m === "GET" && (rest === "" || rest.startsWith("?"))) return J({ value: [{ id: "s1", name: it.sheet || "Sheet1" }] });
    if (m === "PATCH" && rest === "/s1") { it.sheet = JSON.parse(init.body).name; return J({ id: "s1", name: it.sheet }); }
    if (m === "POST" && rest === "/add") return J({ id: "s1", name: JSON.parse(init.body).name });
    if (m === "GET" && /\/usedRange/.test(rest)) { const n = Math.max(1, it.rows.length); return J({ rowCount: n, address: "Sheet1!A1:AE" + n, values: it.rows.length ? it.rows : [[""]] }); }
    if (/\/format\//.test(rest)) return J({});
    if (m === "PATCH" && (r = rest.match(/range\(address='[A-Z]+(\d+):[A-Z]+\d+'\)$/))) { const at = Number(r[1]) - 1; JSON.parse(init.body).values.forEach((row, i) => { it.rows[at + i] = row; }); return J({}); }
  }
  return J({ error: "fake graph: no route " + m + " " + p }, 404);
};
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return J({ ok: true, rows: FEED });
  if (url.includes("brahmastra_live")) return J({ code: "PGRST202", message: "not set up" }, 404);
  if (url.includes("brahmastra_floor") || url.includes("brahmastra_wfm")) return J({ ok: true, rows: [] });
  if (url.includes("login.microsoftonline.com")) return J({ access_token: "t" });
  if (url.includes("graph.microsoft.com")) return graph(url, init);
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, fetchMock });
const { as, tryOp, sha } = rig; const app = rig.app; const T = (fn) => tryOp(fn);
const DB = rig.backend.env.DB; const q = async (s, ...a) => (await DB.prepare(s).bind(...a).all()).results;
const q1 = async (s, ...a) => (await q(s, ...a))[0];
const sql = (s, ...a) => DB.prepare(s).bind(...a).run();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n).id;
const R = {};
for (const f of FEED) { await as(null)("auth.firstPassword", { user_id: U(f.name), passHash: await sha("pw-" + f.email) }); R[f.name] = as((await login(f.email, "pw-" + f.email)).token); }
const TI = R["Tina Lead"], AR = R["Arun Agent"];
const clients = (await A("clients.list")).clients; const sun = clients.find((c) => c.name === SUN);
const isoAdd = (iso, d) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------------------
S("Y-07: the AR Inventory file for Drishti ages each claim to the day it is written");
{
  const today = "2026-11-16";
  const open = await q("SELECT id FROM claims WHERE client_id = ? AND state IN ('open', 'assigned') ORDER BY id LIMIT 3", sun.id);
  // uploaded 11 days ago: the file's age then was 85 (61-90); by date of service it is 96 today (91-120)
  await sql("UPDATE claims SET claim_no = 'Y07-A', dos = ?, age_days = 85, balance = 500 WHERE id = ?", isoAdd(today, -96), open[0].id);
  // 25 then, 36 today (31-60)
  await sql("UPDATE claims SET claim_no = 'Y07-B', dos = ?, age_days = 25, balance = 300 WHERE id = ?", isoAdd(today, -36), open[1].id);
  // no date of service: the file's own age stays
  await sql("UPDATE claims SET claim_no = 'Y07-C', dos = '', age_days = 140, balance = 200 WHERE id = ?", open[2].id);
  const f = await TI("reports.arInventory", { client_id: sun.id, today });
  const ib = f.header.indexOf("Aging Bucket"), row = (no) => f.rows.find((r) => r[0] === no) || [];
  ok("Y-07: a claim 96 days from its DOS is in 91-120 (it was 61-90 at upload)", row("Y07-A")[ib] === "91-120", row("Y07-A")[ib]);
  ok("Y-07: a claim 36 days from its DOS is in 31-60 (it was 0-30 at upload)", row("Y07-B")[ib] === "31-60", row("Y07-B")[ib]);
  ok("Y-07: a claim with no date of service keeps the file's age (121-180)", row("Y07-C")[ib] === "121-180", row("Y07-C")[ib]);
  // the file's over-90 share equals Client 360's on the same day
  const is90 = (b) => { const n = String(b).match(/\d+/g); const lo = n ? parseInt(n[0]) : null; return lo != null && lo >= 91; };
  const ibal = f.header.indexOf("Balance");
  const tot = f.rows.reduce((a, r) => a + Math.max(0, Number(r[ibal]) || 0), 0), o90 = f.rows.filter((r) => is90(r[ib])).reduce((a, r) => a + Math.max(0, Number(r[ibal]) || 0), 0);
  const ov = await TI("client.overview", { client_id: sun.id, today });
  const c360 = ov.ar && ov.ar.owed ? ov.ar.over90_owed / ov.ar.owed : null;
  ok("Y-07: the file's over 90 days share is Client 360's over 90 days", c360 != null && Math.abs(o90 / tot - c360) < 0.001, { file: o90 / tot, c360, ar: ov.ar });
  // rows oldest first by today's age
  const ages = f.rows.map((r) => r[ib]);
  ok("Y-07: the rows run oldest first by today's age (the 91-120 claim before the 31-60 one)", f.rows.findIndex((r) => r[0] === "Y07-A") < f.rows.findIndex((r) => r[0] === "Y07-B"), ages.slice(0, 8));
}

// ---------------------------------------------------------------------------------------------------------------------------
S("Y-01: a renamed client keeps one folder and one workbook a month; its old name is not given to another client");
rig.liveEnv.DEMO = false;   // from here on OneDrive copies are on
const WORK = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" },
  note: { source: "Portal", findings: "Claim is in process per the payer portal", action: "follow up" } };
const arBooks = () => files().filter((x) => /^Brahmastra Clients\/[^/]+\/Production\/AR\/AR Production - /.test(x.path));
const rowsHave = (it, no) => it.rows.some((r) => (r || []).includes(no));
{
  const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 10 })).rows;
  await TI("alloc.apply", { client_id: sun.id, assignments: pool.slice(0, 4).map((c) => ({ id: c.id, user_id: U("Arun Agent") })) });
  let r = await T(() => AR("queue.complete", { id: pool[0].id, ...WORK })); await sleep(300);
  const before = arBooks();
  ok("Y-01: the first entry goes to the client's month workbook", r.ok && before.length === 1 && rowsHave(before[0].it, pool[0].claim_no), [r.e, before.map((x) => x.path)]);
  const od0 = await q1("SELECT od_folder_id, od_name FROM clients WHERE id = ?", sun.id);
  ok("Y-01: the folder's name is kept when the folder is made", od0.od_name === SUN && !!od0.od_folder_id, od0);
  r = await T(() => A("clients.save", { id: sun.id, name: SUN + " Center" }));
  ok("Y-01: the client can be renamed", r.ok, r.e);
  r = await T(() => AR("queue.complete", { id: pool[1].id, ...WORK })); await sleep(300);
  const after = arBooks();
  ok("Y-01: after the rename the month's entries stay in one workbook (no second file under the new name)", r.ok && after.length === 1 && rowsHave(after[0].it, pool[0].claim_no) && rowsHave(after[0].it, pool[1].claim_no), after.map((x) => x.path));
  const list = (await A("clients.list")).clients.find((c) => c.id === sun.id);
  ok("Y-01: the client card shows the folder's own name", list.od && list.od.name === SUN, list.od);
  // a new client may not take the old name: it is the renamed client's folder
  r = await T(() => A("clients.save", { name: SUN, code: "SEC2", locations: ["Main Office"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: U("Tina Lead") } } } }));
  ok("Y-01: a new client with the renamed client's old name is refused (it would share its folder)", !r.ok && /OneDrive folder/.test(r.e || ""), r.ok ? "accepted" : r.e);
  r = await T(() => A("clients.save", { name: "sunrise eye care.", code: "SEC3", locations: ["Main Office"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: U("Tina Lead") } } } }));
  ok("Y-01: also when it differs only in case or a final dot", !r.ok && /OneDrive folder/.test(r.e || ""), r.ok ? "accepted" : r.e);
  const other = (await A("clients.list")).clients.find((c) => c.id !== sun.id && c.active);
  r = await T(() => A("clients.save", { id: other.id, name: SUN }));
  ok("Y-01: renaming another client to that old name is refused too", !r.ok && /OneDrive folder/.test(r.e || ""), r.ok ? "accepted" : r.e);
  r = await T(() => A("clients.save", { id: sun.id, name: SUN }));
  ok("Y-01: the renamed client itself may go back to its old name", r.ok, r.e);
  await A("clients.save", { id: sun.id, name: SUN + " Center" });
  // a client whose folder was made before its name was kept (od_name empty): a new client of the old name is not refused by
  // the name check, but it never takes the other client's folder, and its entries never go to the other client's workbook
  await sql("UPDATE clients SET od_name = '' WHERE id = ?", sun.id);
  r = await T(() => A("clients.save", { name: SUN, code: "SEC4", locations: ["Main Office"], profile: { scope: ["ar"], targets: { ar: 40 }, resp: { ar: { lead: U("Tina Lead") } } } }));
  if (r.ok) {
    const nu = r.r.client;
    await A("clients.saveTeam", { client_id: nu.id, team: [U("Arun Agent")] });
    await sql("INSERT INTO claims (id, client_id, match_key, claim_no, account_no, patient, payer, dos, balance, state, created_at, updated_at) VALUES ('y01new', ?, 'mk-y01new', 'Y01-NEW', 'NA-Y01', 'Test Patient New', 'Aetna', '2026-09-01', 250, 'open', ?, ?)", nu.id, Date.now(), Date.now());
    await A("alloc.apply", { client_id: nu.id, assignments: [{ id: "y01new", user_id: U("Arun Agent") }] });
    const w = await T(() => AR("queue.complete", { id: "y01new", ...WORK })); await sleep(300);
    const nrow = await q1("SELECT od_folder_id, od_status_json FROM clients WHERE id = ?", nu.id), srow = await q1("SELECT od_folder_id FROM clients WHERE id = ?", sun.id);
    ok("Y-01: the entry is still saved in Brahmastra", w.ok, w.e);
    ok("Y-01: the new client does not take the renamed client's folder", nrow.od_folder_id !== srow.od_folder_id && /cannot use it/.test(nrow.od_status_json), nrow);
    ok("Y-01: its entry is not written into the renamed client's workbook", !arBooks().some((b) => rowsHave(b.it, "Y01-NEW")), arBooks().map((b) => b.path));
    await A("clients.save", { id: nu.id, active: false, name: "Sunrise Eye Care Test Copy" });
  } else ok("Y-01: (setup) a new client of the old name with no kept folder name", false, r.e);
  // the renamed client's next entry reads its folder's name back from OneDrive and keeps writing to the same workbook
  r = await T(() => AR("queue.complete", { id: pool[2].id, ...WORK })); await sleep(300);
  const back = await q1("SELECT od_name FROM clients WHERE id = ?", sun.id);
  ok("Y-01: a client whose folder name was not kept gets it back from OneDrive, and its month stays in one workbook", r.ok && back.od_name === SUN && arBooks().filter((b) => b.path.startsWith("Brahmastra Clients/" + SUN + "/")).length === 1 && rowsHave(arBooks()[0].it, pool[2].claim_no), [back, arBooks().map((b) => b.path)]);
}

// ---------------------------------------------------------------------------------------------------------------------------
S("Y-02: Save AR Inventory to OneDrive keeps the date in the file name, whatever the client's name");
{
  const lake = (await A("clients.list")).clients.find((c) => c.name === LAKE);
  const long = "Lakeview Dental Group Pediatric and Adult Family Dentistry Associates";   // 69 characters
  await A("clients.save", { id: lake.id, name: long });
  await A("clients.saveTeam", { client_id: lake.id, team: [U("Tina Lead")] }).catch(() => {});
  const save = (day, extra = {}) => T(() => A("reports.saveArInventory", { client_id: lake.id, name: `AR Inventory report - ${long} - ${day}`, file_b64: Buffer.from("AR " + day).toString("base64"), ...extra }));
  const r1 = await save("2026-10-30"), r2 = await save("2026-11-16");
  const inv = files().filter((x) => /SLA & KPI\/AR Inventory report - Lakeview/.test(x.path));
  ok("Y-02: two days' saves for a long client name write two files", r1.ok && r2.ok && inv.length === 2 && r1.r.name !== r2.r.name, [r1.e || r1.r.name, r2.e || r2.r.name, inv.map((x) => x.path)]);
  ok("Y-02: each name ends with its date and fits OneDrive's 80 characters", r1.ok && /- 2026-10-30\.xlsx$/.test(r1.r.name) && r1.r.name.replace(/\.xlsx$/, "").length <= 80 && /^AR Inventory report - Lakeview Dental Group/.test(r1.r.name), r1.r && r1.r.name);
  ok("Y-02: October's file is kept (not replaced by November's)", inv.some((x) => x.it.bytes.toString() === "AR 2026-10-30") && inv.some((x) => x.it.bytes.toString() === "AR 2026-11-16"), inv.map((x) => x.it.bytes.toString()));
  const r3 = await T(() => A("reports.saveArInventory", { client_id: lake.id, name: "AR Inventory report", today: "2026-11-17", file_b64: Buffer.from("AR").toString("base64") }));
  ok("Y-02: a name without a date takes the page's today", r3.ok && /^AR Inventory report - Lakeview Dental Group .* - 2026-11-17\.xlsx$/.test(r3.r.name), r3.e || r3.r.name);
  const r4 = await T(() => A("reports.saveArInventory", { client_id: sun.id, name: "AR Inventory report - " + SUN + " Center - 2026-11-16", file_b64: Buffer.from("AR").toString("base64") }));
  ok("Y-02: a short name is as before", r4.ok && r4.r.name === "AR Inventory report - " + SUN + " Center - 2026-11-16.xlsx", r4.e || r4.r.name);
}

// ---------------------------------------------------------------------------------------------------------------------------
S("Y-09: the oldest request waiting on the client is the one that has waited longest");
{
  const DAY = 86400000, now = Date.now();
  const [c1, c2] = await q("SELECT id, claim_no FROM claims WHERE client_id = ? AND state IN ('open', 'assigned') ORDER BY id DESC LIMIT 2", sun.id);
  const ho = (id, cl, paused, sent) => sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, due_at, proof_json, reason, note, paused_at, client_sent_at, client_sent_by_name, client_sent_how)
    VALUES (?,?,?,'posting','client',?,?,?,?, '{}', 'EOB needed from the client', '', ?, ?, 'Tina Lead', 'Email')`, id, cl, sun.id, paused - DAY, U("Arun Agent"), "Arun Agent", paused + DAY, paused, sent);
  await ho("y09a", c1.id, now - 20 * DAY, now - 1 * DAY);    // paused 20 days ago, sent to the client yesterday: 1 day
  await ho("y09b", c2.id, now - 10 * DAY, now - 10 * DAY);   // paused and sent 10 days ago: 10 days
  const o = await TI("client.overview", { client_id: sun.id });
  const longest = Math.max(...o.waiting.rows.map((w) => w.days));
  ok("Y-09: Client 360's oldest is the longest wait in its own table (10 days, not the 1 day of the request paused first)", o.waiting.oldest === 10 && longest === 10, { oldest: o.waiting.oldest, rows: o.waiting.rows.map((w) => [w.claim_no, w.days]) });
  ok("Y-09: the table lists the longest wait first", o.waiting.rows[0] && o.waiting.rows[0].days === 10, o.waiting.rows.map((w) => w.days));
  ok("Y-09: its health names the old requests waiting on the client", o.reasons.some((r) => /2 requests waiting on the client, oldest 10 days/.test(r.text)), o.reasons.map((r) => r.text));
  const MO = R["Mona Manager"];
  const sp = (await MO("digest.spans", {})).spans.find((x) => x.clients.some((c) => c.id === sun.id));
  const pv = sp ? await T(() => MO("digest.preview", { span: sp.key })) : { ok: false, e: "no span" };
  ok("Y-09: the Monday digest judges the client on the same oldest request", pv.ok && /waiting on the client, oldest 10 days/.test(pv.r.text), pv.ok ? (pv.r.text.match(/.*waiting on the client.*/g) || []).join(" | ") : pv.e);
  await sql("DELETE FROM handoffs WHERE id IN ('y09a', 'y09b')");
}

// ---------------------------------------------------------------------------------------------------------------------------
S("Y-03: with a filter on the person, the Denials page counts the claims AR production counts");
{
  const X = (expr) => vm.runInContext(expr, app);
  const cl = (await A("clients.list")).clients.find((c) => c.name === LAKE + " Pediatric and Adult Family Dentistry Associates") || (await A("clients.list")).clients.find((c) => /Lakeview/.test(c.name));
  await sql("UPDATE claims SET state = 'closed' WHERE client_id = ?", cl.id);
  const ist = (d) => Date.parse(d + "T11:00:00+05:30");
  const claim = async (id, no, payer, dos, bal) => sql(`INSERT INTO claims (id, client_id, match_key, claim_no, account_no, patient, payer, dos, balance, billed, state, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?, ?)`, id, cl.id, "mk-" + id, no, "ACC-" + no, "Test Patient " + no, payer, dos, bal, bal * 2, Date.parse("2026-07-01T00:00:00Z"), Date.now());
  let nseq = 0;
  const note = (cid, at, st, sub, act, mv, who) => sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, bucket, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    "y03n" + (++nseq), cid, U(who), who, "work", st, sub, act, mv, at);
  await claim("y03x", "7711001", "Aetna", "2026-08-20", 400); await claim("y03y", "7711002", "Aetna", "2026-08-25", 300); await claim("y03z", "7711003", "Cigna", "2026-09-01", 200);
  await note("y03x", ist("2026-10-05"), "Claim Denied", "Missing information", "Corrected claim", "Payer", "Arun Agent");
  await note("y03x", ist("2026-10-20"), "Claim Paid", "Paid in full", "Close the claim", "Closed", "Bela Agent");
  await note("y03y", ist("2026-10-10"), "Claim Denied", "Missing information", "Corrected claim", "Payer", "Bela Agent");
  await note("y03z", ist("2026-10-12"), "Claim In Process", "Need to allow some time", "Follow up", "Payer", "Arun Agent");
  const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31), kind: "month" }, pv = app.crShift(range);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const raw = await A("creport.get", { client_id: cl.id, from: iso(range.start), to: iso(range.end), prev_from: iso(pv.start), prev_to: iso(pv.end), period_key: X("crPeriodKey")(range) });
  const DS = app.crDatasets(raw), Rr = { range, compare: true, client: cl.name, periodName: "October", cardMeasure: {} };
  const build = (sel) => ({ ar: app.crBuildAR(app.crCtx(DS, Rr, "ar", sel)), den: app.crBuildDenials(app.crCtx(DS, Rr, "denials", sel)), rca: app.crBuildRCA(app.crCtx(DS, Rr, "rca", sel)) });
  const kpi = (m, l) => m.kpis.find((k) => k.label === l) || {};
  const nOf = (s) => Number((/(\d+)/.exec(String(s || "")) || [])[1]);
  const agree = (b) => ({ arWorked: Number(kpi(b.ar, "Claims worked").value), arDenied: nOf(kpi(b.ar, "Denied").sub), denied: Number(kpi(b.den, "Denied claims").value), base: nOf(kpi(b.den, "Denial rate").sub), rate: kpi(b.den, "Denial rate").value });
  const u0 = agree(build({}));
  ok("Y-03: unfiltered, both pages: 3 claims worked, 2 denied", u0.arWorked === 3 && u0.arDenied === 2 && u0.denied === 2 && u0.base === 3, u0);
  const keyOf = (name) => DS.worked.recs.find((r) => String(r.workBy || "").toLowerCase().includes(name.split(" ")[0].toLowerCase())).workBy;
  const ar1 = agree(build({ workBy: new Set([keyOf("Arun Agent")]) }));
  ok("Y-03: Worked by Arun: Denials counts the claims AR production counts (1 worked, none denied)", ar1.arWorked === 1 && ar1.arDenied === 0 && ar1.denied === 0 && ar1.base === 1, ar1);
  const be = build({ workBy: new Set([keyOf("Bela Agent")]) }), be1 = agree(be);
  ok("Y-03: Worked by Bela: both pages 2 claims worked, 2 denied (100%)", be1.arWorked === 2 && be1.arDenied === 2 && be1.denied === 2 && be1.base === 2 && be1.rate === "100.0%", be1);
  const ar = build({ workBy: new Set([keyOf("Arun Agent")]) });
  ok("Y-03: the RCA page's denied amount is of the same claims (Bela $1,400 of both claims; Arun none)", be.rca && /\$1,400 denied/.test(be.rca.insights[0] || "") && ar.rca && !/\$400 denied/.test(ar.rca.insights[0] || ""), [be.rca && be.rca.insights[0], ar.rca && ar.rca.insights[0]]);
  // the Denials page's own reason bar still picks by the denial's reason, and the KPIs match the clicked bar
  const rs = build({ status: new Set(["missing information"]) }).den, rsAll = build({}).den;
  const bar = (rsAll.cards.find((x) => x.id === "den.reason").items || []).find((i) => /missing/i.test(i.label));
  // rejections read from the AR entries (no Rejections desk records) follow the same rule
  await note("y03z", ist("2026-10-25"), "Claim Rejected", "Invalid member ID", "Corrected claim", "Payer", "Arun Agent");
  const raw2 = await A("creport.get", { client_id: cl.id, from: iso(range.start), to: iso(range.end), prev_from: iso(pv.start), prev_to: iso(pv.end), period_key: X("crPeriodKey")(range) });
  const DS2 = app.crDatasets(raw2), rej = (sel) => app.crBuildRejection(app.crCtx(DS2, Rr, "rejection", sel));
  const rA = rej({ workBy: new Set([keyOf("Arun Agent")]) }), rB = rej({ workBy: new Set([keyOf("Bela Agent")]) });
  ok("Y-03: rejections from the AR entries: Arun 1 of his 1 claim worked, Bela none", rA && kpi(rA, "Rejected claims").value === "1" && kpi(rA, "Rejection rate").value === "100.0%" && (!rB || kpi(rB, "Rejected claims").value === "0"), [rA && rA.kpis.map((k) => k.label + "=" + k.value), rB && rB.kpis.map((k) => k.label + "=" + k.value)]);
  ok("Y-03: a clicked denial reason matches the Denied claims KPI", bar && Number(kpi(rs, "Denied claims").value) === bar.count && bar.count === 2, [bar && bar.count, kpi(rs, "Denied claims").value]);
}

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
