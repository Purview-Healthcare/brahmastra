/* Suite 9: Ctrl+K search (scoped to what each person may open) and the bell. */
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
const CA = await firstIn("Cara Agent", "cara@purview-healthcare.com"), LE = await firstIn("Leo Lead", "leo@purview-healthcare.com");
const BE = await firstIn("Bela Agent", "bela@purview-healthcare.com");
const arun = U("Arun Agent"), cara = U("Cara Agent");
const team = (await A("clients.list")).clients.find((c) => c.id === sun.id).team || [];
if (!team.includes(arun.id) || !team.includes(cara.id)) await A("clients.saveTeam", { id: sun.id, team: [...new Set([...team, arun.id, cara.id])] });
const done = { saag: { status: "Claim In Process", sub_status: "Need to allow some time", action: "Correction, Resubmission & Reprocessing", bucket: "Payer", effective: "Pending-Collectible Insurance" }, note: { source: "Portal", findings: "Claim is in process per the portal", action: "follow up later" } };
const pool = (await TI("claims.list", { client_id: sun.id, state: "open", page_size: 12 })).rows;
await TI("alloc.reassign", { ids: pool.slice(0, 8).map((c) => c.id), user_id: arun.id });
await TI("alloc.reassign", { ids: pool.slice(8, 12).map((c) => c.id), user_id: cara.id });
const lakeClaim = (await LE("claims.list", { client_id: lake.id, page_size: 1 })).rows[0];
const mineC = pool[0], caraC = pool[8];

S("Search");
let r = await T(async () => TI("search.global", { q: mineC.claim_no }));
ok("a team lead finds a claim by its number, exact match first", r.ok && r.r.claims[0] && r.r.claims[0].id === mineC.id, r.r || r);
ok("results carry what the palette shows", r.ok && ["claim_no", "patient", "client_name", "payer", "balance", "state"].every((k) => k in r.r.claims[0]) && !("assigned_to" in r.r.claims[0]), r.ok && Object.keys(r.r.claims[0]));
r = await TI("search.global", { q: mineC.patient.split(",")[0] });
ok("and by patient name", r.claims.some((c) => c.id === mineC.id), r.claims.map((c) => c.patient));
r = await TI("search.global", { q: lakeClaim.claim_no });
ok("but not another team's client", !r.claims.some((c) => c.id === lakeClaim.id), r.claims.map((c) => c.client_name));
r = await AR("search.global", { q: mineC.claim_no });
ok("a biller finds a claim on their list", r.claims.some((c) => c.id === mineC.id), r.claims.length);
r = await AR("search.global", { q: caraC.claim_no });
ok("not a teammate's claim", !r.claims.some((c) => c.id === caraC.id), r.claims.map((c) => c.claim_no));
r = await BE("search.global", { q: mineC.claim_no });
ok("nor another client's", !r.claims.length, r.claims.length);
r = await TI("search.global", { q: "7" });
ok("one character searches nothing", r.claims.length === 0);
r = await TI("search.global", { q: "%" });
ok("wildcards are not a way to list everything", r.claims.length === 0, r.claims.length);
ok("at most 8 results", (await TI("search.global", { q: "77" })).claims.length <= 8);

S("Bell: team lead");
let n = await TI("notify.list", {});
const key = (x, k) => x.items.find((i) => i.key === k);
ok("lists what needs them, each with a page", Array.isArray(n.items) && n.items.every((i) => i.view && i.text && i.n > 0), n.items);
const m0 = key(n, "missed") ? key(n, "missed").n : 0;
await sql("UPDATE claims SET assigned_at = ? WHERE assigned_to = ?", Date.now() - 2 * 86400000, cara.id);
n = await TI("notify.list", {});
ok("claims allocated before today and not worked count as missed tasks", key(n, "missed") && key(n, "missed").n === m0 + 4 && key(n, "missed").view === "raci", [m0, n.items.map((i) => i.key + " " + i.n)]);
const nl0 = await LE("notify.list", {});
ok("not on another team's bell", !key(nl0, "missed") || key(nl0, "missed").n < m0 + 4, nl0.items.map((i) => i.key + " " + i.n));
await AR("queue.complete", { id: mineC.id, ...done, escalate: true });
n = await TI("notify.list", {});
ok("an escalation shows up", key(n, "escalations") && key(n, "escalations").n === 1 && key(n, "escalations").view === "attention", n.items.map((i) => i.key + " " + i.n));
await TI("team.setOut", { user_id: cara.id, out: true });
n = await TI("notify.list", {});
ok("claims on desks of people out today", key(n, "absent") && key(n, "absent").n === 4 && key(n, "absent").view === "teamtoday", key(n, "absent"));
const nl = await LE("notify.list", {});
ok("another team's lead is not told about it", !key(nl, "escalations") && !key(nl, "absent"), nl.items.map((i) => i.key));
await sql("UPDATE claims SET escalated_at = ? WHERE id = ?", Date.now() - 30 * 3600000, mineC.id);
n = await TI("notify.list", {});
ok("an escalation over 24 hours turns red", key(n, "escalations").tone === "red" && /over 24 hours/.test(key(n, "escalations").text), key(n, "escalations"));

S("Bell: biller");
let b = await AR("notify.list", {});
const due = (await AR("queue.summary", {})).ready;
ok("their list for today, the same count as My day", key(b, "queue") && key(b, "queue").view === "queue" && key(b, "queue").n === (due && due.n), [b.items, due]);
await TI("attention.answer", { id: mineC.id, comment: "Call the payer again and ask for the reprocessing ref.", send_back: true });
b = await AR("notify.list", {});
ok("an answered escalation", key(b, "answers") && key(b, "answers").n === 1, b.items.map((i) => i.key + " " + i.n));
ok("no team lead items for billers", !key(b, "missed") && !key(b, "escalations") && !key(b, "absent"), b.items.map((i) => i.key));
const bc = await CA("notify.list", {});
ok("someone else's answer is not theirs", !key(bc, "answers"), bc.items.map((i) => i.key));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
