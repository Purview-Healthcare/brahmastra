/* Suite 46: the owner's decisions after the second bug test (fixer DB). E-20: Live status shows who works on what, the Escalation
   tracker's open escalations and the claims flagged by billers, and its tab counts the two lists. N-09: a view-only share opens the
   client's claims read only, and every write is refused. F-02: the Client 360 report counts claims (one per claim, its latest entry)
   on the AR production page, filters included, and on its other pages. The clock is fixed at Tue 10 Nov 2026 14:00 IST.
   Made-up data only ("Test Patient", made-up claim numbers, made-up people). */
import fs from "fs";
import vm from "vm";
import { makeRig, REPO } from "./rig.mjs";
process.setMaxListeners(50);   // one rig per world, each adds an exit listener
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 500))); };
// a world whose checks stop on an error (the old code, say) counts that as a failed check and the suite goes on to the next one
const world = async (label, fn) => { try { await fn(); } catch (e) { ok(label + ": the checks ran to the end", false, String((e && e.stack) || e).split("\n").slice(0, 2).join(" ")); } };
const D = "@purview-healthcare.com", SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const FEED = () => [
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", email: "mona" + D }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: "tina" + D }),
  P({ emp_id: "S1", name: "Sima Expert", position: "SME", project: SUN, reports_to: "Tina Lead", email: "sima" + D }),
  P({ emp_id: "T2", name: "Lara Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: "lara" + D }),
  P({ emp_id: "A1", name: "Arun Agent", project: SUN, reports_to: "Tina Lead", email: "arun" + D }),
  P({ emp_id: "A2", name: "Bela Agent", project: SUN, reports_to: "Tina Lead", email: "bela" + D }),
  P({ emp_id: "A3", name: "Cyra Agent", project: LAKE, reports_to: "Lara Lead", email: "cyra" + D }),
  // Tina's biller who also works Lara's client
  P({ emp_id: "A4", name: "Dev Agent", project: SUN, also_on_projects: LAKE, reports_to: "Tina Lead", email: "dev" + D }),
  // a team lead, a biller and a second team lead on a project with no client here: they see only what is shared with them
  P({ emp_id: "W1", name: "Vik Viewer", position: "Team Lead", project: "Delta Practice", reports_to: "Mona Manager", email: "vik" + D }),
  P({ emp_id: "W3", name: "Bo Viewer", project: "Delta Practice", reports_to: "Vik Viewer", email: "bo" + D }),
  P({ emp_id: "W2", name: "Eda Editor", position: "Team Lead", project: "Delta Practice", reports_to: "Mona Manager", email: "eda" + D }),
  // a Payment posting person on Sunrise
  P({ emp_id: "PA", name: "Pavan Poster", department: "Posting", project: SUN, reports_to: "Mona Manager", email: "pavan" + D }),
];
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const IST = 330 * 60000, ist = (d, hm) => Date.parse(d + "T" + hm + ":00+05:30");
const NOW = ist("2026-11-10", "14:00"), TODAY = "2026-11-10", realNow = Date.now;
Date.now = () => NOW;   // Tue 10 Nov 2026, 14:00 IST: working hours are counted from here
/* A fresh world: the demo data, the roster synced, and a session for anyone by name. */
async function makeWorld() {
  const feed = FEED();
  const fetchMock = async (url) => {
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: feed });
    if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "not set up" }, 404);
    return new Response("no outside network in tests", { status: 503 });
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
  const { as, tryOp, sha } = rig, T = (fn) => tryOp(fn);
  const DB = rig.backend.env.DB;
  const sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  const rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results || [];
  const row = async (q, ...a) => (await rows(q, ...a))[0];
  await rig.app.seedDemo(() => {});
  const anon = as(null);
  const A = as((await anon("auth.login", { email: "supervisor" + D, passHash: await sha("brahmastra-demo") })).token);
  await A("roster.syncShastra");
  const U = async (name) => row("SELECT * FROM users WHERE name = ? ORDER BY created_at", name);
  const id = {}, calls = {};
  for (const r of feed) { const u = await U(r.name); if (u) id[r.name] = u.id; }
  const c = async (name) => { if (calls[name]) return calls[name]; const u = await U(name); if (!u) throw new Error("no such person: " + name);
    if (!u.pass_hash) await anon("auth.firstPassword", { user_id: u.id, passHash: await sha("pw-" + name) });
    return (calls[name] = as((await anon("auth.loginById", { user_id: u.id, passHash: await sha("pw-" + name) })).token)); };
  const cl = (await A("clients.list")).clients, sun = cl.find((x) => /Sunrise/.test(x.name)), lake = cl.find((x) => /Lakeview/.test(x.name));
  return { rig, app: rig.app, as, T, sha, DB, sql, rows, row, A, U, id, c, sun, lake };
}
const refused = (r, re) => !r.ok && (r.status === 403 || r.status === 400 || r.status === 404) && (!re || re.test(r.e || ""));
const VIEW_ONLY = /shared with you view-only/;
// a work entry the server accepts (the biller's form), and a biller flagging a claim for the team lead
const NOTE = { findings: "Checked the payer portal and the claim history today", source: "Portal" };
const INFORM = { status: "Claim Denied", sub_status: "COB Issue", action: "INFORM", effective: "Pending-Collectible Insurance", bucket: "Payer" };
const work = (who, claimId, extra = {}) => who("queue.complete", { id: claimId, desk: true, saag: INFORM, note: NOTE, today: TODAY, ...extra });
const flag = async (who, claimId) => { await who("queue.open", { id: claimId }); return work(who, claimId, { escalate: true }); };
const escPayload = (w, clientId, owner, kind = "external") => ({ kind, client_id: clientId, day: TODAY, dept: "Account Receivable", raised_who: "Office manager at the client", reported_to: "Tina Lead",
  owner_id: owner, email_subject: "Follow-up on the October list", description: "Made-up escalation for the test: a follow-up was missed", comment: "Being looked at", location_id: "all", channels: ["Email"] });

/* ======================= E-20: Live status, its three parts and the tab's number ======================= */
await world("E-20", async () => {
  const w = await makeWorld();
  const { A, T, id, sun, lake, sql, rows, row } = w;
  const TI = await w.c("Tina Lead"), LA = await w.c("Lara Lead"), SI = await w.c("Sima Expert"), MO = await w.c("Mona Manager"), VK = await w.c("Vik Viewer");
  const AR = await w.c("Arun Agent"), BE = await w.c("Bela Agent"), CY = await w.c("Cyra Agent"), DV = await w.c("Dev Agent");
  await sql("UPDATE claims SET escalated = 0");
  const pool = async (clientId, n) => (await rows("SELECT id, claim_no FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT ?", clientId, n));
  const [s1, s2, s3, s4, s5] = await pool(sun.id, 5), [k1, k2] = await pool(lake.id, 2);
  await A("alloc.reassign", { ids: [s1.id, s2.id, s3.id], user_id: id["Arun Agent"] });
  await A("alloc.reassign", { ids: [s4.id], user_id: id["Bela Agent"] });
  await A("alloc.reassign", { ids: [s5.id], user_id: id["Dev Agent"] });
  await A("alloc.reassign", { ids: [k1.id], user_id: id["Cyra Agent"] });
  await A("alloc.reassign", { ids: [k2.id], user_id: id["Dev Agent"] });
  // Arun flags two claims (one long ago) and is on a third; Bela worked her claim 25 minutes ago; Dev last worked a Lakeview claim
  await flag(AR, s1.id); await flag(AR, s2.id); await flag(CY, k1.id);
  await sql("UPDATE claims SET escalated_at = ? WHERE id = ?", ist("2026-11-05", "10:00"), s1.id);   // Thu 10:00: 76 working hours ago
  await sql("UPDATE claims SET escalated_at = ? WHERE id = ?", ist("2026-11-10", "13:00"), s2.id);
  await AR("queue.open", { id: s3.id });
  await BE("queue.open", { id: s4.id }); await work(BE, s4.id);
  await sql("UPDATE notes SET created_at = ? WHERE claim_id = ? AND user_id = ? AND kind = 'work'", NOW - 25 * 60000, s4.id, id["Bela Agent"]);
  await DV("queue.open", { id: k2.id }); await work(DV, k2.id);
  // the Escalation tracker: Sima logs one on Sunrise (Mon 10:00, 28 working hours ago), Tina an internal one today; Lara one on Lakeview; one Sunrise closed
  const e1 = (await SI("escalations.save", escPayload(w, sun.id, id["Tina Lead"]))).sr, e2 = (await TI("escalations.save", escPayload(w, sun.id, id["Tina Lead"], "internal"))).sr;
  await LA("escalations.save", escPayload(w, lake.id, id["Lara Lead"]));
  const e4 = (await TI("escalations.save", escPayload(w, sun.id, id["Tina Lead"]))).sr;
  const escId = async (clientId, sr) => (await row("SELECT id FROM escalations WHERE client_id = ? AND sr = ?", clientId, sr)).id;
  await sql("UPDATE escalations SET created_at = ? WHERE id = ?", ist("2026-11-09", "10:00"), await escId(sun.id, e1));
  await sql("UPDATE escalations SET created_at = ? WHERE id = ?", ist("2026-11-10", "12:00"), await escId(sun.id, e2));
  await sql("UPDATE escalations SET created_at = ? WHERE client_id = ?", ist("2026-11-09", "09:00"), lake.id);
  await sql("UPDATE escalations SET status = 'resolved', resolved_at = ? WHERE id = ?", NOW, await escId(sun.id, e4));
  const huddle = (who, p = {}) => who("team.huddle", { today: TODAY, ...p });
  const person = (h, name) => h.rows.find((r) => r.id === id[name]);

  S("E-20: Working now: each person, their state, and the claim they are on or last worked");
  let h = await huddle(TI);
  const ar = person(h, "Arun Agent"), be = person(h, "Bela Agent"), dv = person(h, "Dev Agent");
  ok("E-20: Arun is working, on the claim he has open: its client and claim number (as before)", ar && ar.status === "working" && ar.current && ar.current.claim_no === s3.claim_no && ar.current.client === SUN, ar);
  ok("E-20: Bela has no claim open: the claim she last worked, its client, and when (25 minutes ago)", be && !be.current && be.last_claim && be.last_claim.id === s4.id && be.last_claim.claim_no === s4.claim_no && be.last_claim.client === SUN && be.last_claim.at === NOW - 25 * 60000, be);
  ok("E-20: Dev last worked a Lakeview claim, a client Tina does not have: shown as another client's, with no number or client (the N-07 rule)",
    dv && dv.last_claim && dv.last_claim.elsewhere === true && !dv.last_claim.id && !dv.last_claim.claim_no && !dv.last_claim.client && !JSON.stringify(h).includes(k2.claim_no), dv && dv.last_claim);
  const lh = await huddle(LA), ldv = person(lh, "Dev Agent");
  ok("E-20: Lara (Lakeview) sees Dev's last claim with its number, it is hers; and nothing of Sunrise's claims", ldv && ldv.last_claim && ldv.last_claim.claim_no === k2.claim_no && ldv.last_claim.client === LAKE
    && ![s3.claim_no, s4.claim_no].some((no) => JSON.stringify(lh).includes(no)), ldv && ldv.last_claim);
  const la = await huddle(A);
  const adv = person(la, "Dev Agent") || {};
  ok("E-20: the admin sees Dev's last claim with its number and client", !!adv.last_claim && adv.last_claim.claim_no === k2.claim_no && adv.last_claim.client === LAKE, adv.last_claim);

  S("E-20: Open escalations: only open ones, in the viewer's clients, red as the tracker shows them");
  const sr = (xs) => (xs || []).map((e) => e.client_name + " SR" + e.sr);
  ok("E-20: Tina sees Sunrise's two open escalations, oldest first: not Lakeview's, not the closed one", JSON.stringify(sr(h.escalations)) === JSON.stringify([SUN + " SR" + e1, SUN + " SR" + e2]), sr(h.escalations));
  const x1 = h.escalations[0], x2 = h.escalations[1];
  ok("E-20: each shows the client, the SR number, who logged it and when", x1.client_name === SUN && x1.sr === e1 && x1.by === "Sima Expert" && x1.at === ist("2026-11-09", "10:00") && x2.by === "Tina Lead" && x2.kind === "internal", [x1, x2]);
  ok("E-20: open 28 working hours with no reason given: red, reason needed (the tracker's red); 2 hours: not red", x1.red && x1.needs_reason && x1.open_hours === 28 && !x2.red && !x2.past_24 && x2.open_hours === 2, [x1, x2]);
  const trk = (await TI("escalations.list", { status: "open", today: TODAY })).rows;
  ok("E-20: the same escalations, and the same red, as the tracker shows Tina", JSON.stringify(trk.map((e) => e.sr).sort()) === JSON.stringify(h.escalations.map((e) => e.sr).sort()) && trk.find((e) => e.sr === e1).needs_reason === true, trk.map((e) => [e.sr, e.needs_reason]));
  await TI("escalations.reason", { id: x1.id, reason: "Waiting on the client's corrected list", expected_on: "2026-11-12" });
  h = await huddle(TI);
  ok("E-20: once the team lead gives the reason and a date, it is no longer red (still over 24 working hours)", !h.escalations[0].red && h.escalations[0].past_24 && !h.escalations[0].needs_reason, h.escalations[0]);
  await sql("UPDATE escalations SET expected_on = '2026-11-09' WHERE id = ?", x1.id);
  h = await huddle(TI);
  ok("E-20: red again once the expected close date has passed", h.escalations[0].red && h.escalations[0].past_expected, h.escalations[0]);
  ok("E-20: Lara sees Lakeview's only", JSON.stringify(sr((await huddle(LA)).escalations)) === JSON.stringify([LAKE + " SR1"]), sr((await huddle(LA)).escalations));
  ok("E-20: the manager over both sees all three; picking a client narrows the list to it", (await huddle(MO)).escalations.length === 3 && JSON.stringify(sr((await huddle(MO, { client_id: lake.id })).escalations)) === JSON.stringify([LAKE + " SR1"]));
  ok("E-20: picking Tina as the team lead narrows it to her clients", JSON.stringify(sr((await huddle(MO, { lead_id: id["Tina Lead"] })).escalations).sort()) === JSON.stringify([SUN + " SR" + e1, SUN + " SR" + e2].sort()), sr((await huddle(MO, { lead_id: id["Tina Lead"] })).escalations));

  S("E-20: Flagged by billers: the claims flagged for the team lead still waiting for an answer");
  const fl = (xs) => (xs || []).map((x) => x.claim_no);
  ok("E-20: Tina sees the two Sunrise claims Arun flagged, oldest first (not Cyra's Lakeview one)", JSON.stringify(fl(h.flagged)) === JSON.stringify([s1.claim_no, s2.claim_no]), fl(h.flagged));
  const f1 = h.flagged[0], f2 = h.flagged[1];
  ok("E-20: each shows the client, the claim number, who flagged it and when", f1.client_name === SUN && f1.by === "Arun Agent" && f1.at === ist("2026-11-05", "10:00") && f2.at === ist("2026-11-10", "13:00"), [f1, f2]);
  ok("E-20: red past the 48 working hours of Needs attention (76 hours), not at 1 hour", f1.red && Math.round(f1.waiting_ms / 3600000) === 76 && !f2.red && Math.round(f2.waiting_ms / 3600000) === 1, [f1.waiting_ms, f2.waiting_ms]);
  ok("E-20: the same claims as Needs attention lists for Tina", JSON.stringify((await TI("attention.list", {})).rows.map((r) => r.claim_no)) === JSON.stringify(fl(h.flagged)));
  await TI("tat.hold", { kind: "flag", id: s1.id, reason: "Waiting on the payer", until: "2026-11-13" });
  h = await huddle(TI);
  ok("E-20: one put on hold (Can't close yet) is not red, and says so", h.flagged[0].held && !h.flagged[0].red, h.flagged[0]);
  await TI("attention.answer", { id: s2.id, comment: "Call the payer again and note the reference" });
  h = await huddle(TI);
  ok("E-20: an answered one leaves the list", JSON.stringify(fl(h.flagged)) === JSON.stringify([s1.claim_no]), fl(h.flagged));
  ok("E-20: Lara sees Cyra's Lakeview one only", JSON.stringify(fl((await huddle(LA)).flagged)) === JSON.stringify([k1.claim_no]));

  S("E-20: the Live status tab's number: open escalations plus flagged claims waiting, red when one is past its time");
  let at = await TI("attention.count", {});
  h = await huddle(TI);
  ok("E-20: the count behind the tab is what the two lists show: 2 open escalations and 1 flagged claim", at.esc_open === 2 && at.escalations === 1 && h.escalations.length === at.esc_open && h.flagged.length === at.escalations, at);
  ok("E-20: red: one escalation is past its expected close date (the flagged one is on hold)", at.esc_late === 1 && at.overdue === 0, at);
  await sql("UPDATE escalations SET expected_on = '2026-11-12' WHERE id = ?", x1.id);
  at = await TI("attention.count", {});
  ok("E-20: with the date back ahead and the flag on hold, nothing is red: the number is amber", at.esc_late === 0 && at.overdue === 0 && at.esc_open + at.escalations === 3, at);
  await sql("UPDATE tat_holds SET cleared_at = ? WHERE ref_id = ?", NOW, s1.id);
  at = await TI("attention.count", {});
  ok("E-20: a flagged claim past its 48 working hours makes it red (as before)", at.overdue === 1 && at.esc_late === 0, at);
  ok("E-20: Needs attention keeps its own count: the open escalations are not in it", at.n === at.escalations + at.client_to_send + at.from_desks + at.tasks_late + at.tasks_help, at);
  const atL = await LA("attention.count", {});
  ok("E-20: Lara's tab counts Lakeview's: 1 open escalation (red, no reason after 29 working hours) and Cyra's flagged claim", atL.esc_open === 1 && atL.esc_late === 1 && atL.escalations === 1, atL);
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("E-20: the page draws the tab from those two counts, red when either is late; Needs attention keeps attention.n",
    /const liveN = attention \? \(attention\.escalations \|\| 0\) \+ \(attention\.esc_open \|\| 0\) : 0;/.test(src) && /k === "live" && liveN > 0 \? <span className=\{"badge " \+ \(attention\.overdue \|\| attention\.esc_late \? "red" : "amber"\)\}[\s\S]{0,400}?>\{liveN\}<\/span>/.test(src)
    && /k === "attention" && attention && attention\.n > 0 \?/.test(src));
  ok("E-20: the page shows the three parts: Working now, Open escalations, Flagged by billers", /cv-sec" style=\{\{ margin: 0 \}\}>Working now</.test(src) && />Open escalations\{count\(esc\)\}</.test(src) && />Flagged by billers\{count\(fl\)\}</.test(src) && /<LiveLists ctx=\{ctx\} me=\{me\} go=\{go\} q=\{live\} \/>/.test(src));

  S("E-20: the lists stay within each person's view");
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Vik Viewer"], level: "view" });
  const vk = await huddle(VK), vkT = (await VK("escalations.list", { status: "open", today: TODAY })).rows, vkN = (await VK("attention.list", {})).rows;
  ok("E-20: a view-only share of Sunrise shows its open escalations and flagged claims, exactly what the tracker and Needs attention show him", JSON.stringify(vk.escalations.map((e) => e.sr).sort()) === JSON.stringify(vkT.map((e) => e.sr).sort()) && JSON.stringify(fl(vk.flagged)) === JSON.stringify(vkN.map((r) => r.claim_no)) && vk.escalations.length === 2, [vk.escalations.length, vkT.length]);
  ok("E-20: and nothing of Lakeview's", !vk.escalations.some((e) => e.client_id === lake.id) && !vk.flagged.some((x) => x.client_id === lake.id));
  let r = await T(() => AR("team.huddle", { today: TODAY }));
  ok("E-20: a biller cannot open Live status (nor its lists)", refused(r), r);
  r = await T(() => (w.c("Pavan Poster")).then((PV) => PV("team.huddle", { today: TODAY })));
  ok("E-20: nor a Payment posting person", refused(r), r);
});

/* ======================= N-09: a view-only share opens the client's claims, read only ======================= */
await world("N-09", async () => {
  const w = await makeWorld();
  const { A, T, id, sun, lake, sql, rows, row } = w;
  const TI = await w.c("Tina Lead"), AR = await w.c("Arun Agent"), VK = await w.c("Vik Viewer"), BO = await w.c("Bo Viewer"), ED = await w.c("Eda Editor"), PV = await w.c("Pavan Poster");
  await sql("UPDATE claims SET escalated = 0");
  const pool = async (clientId, n) => (await rows("SELECT id, claim_no FROM claims WHERE client_id = ? AND state = 'open' ORDER BY id LIMIT ?", clientId, n));
  const [c1, c2, c3, c4, c5] = await pool(sun.id, 5), [k1] = await pool(lake.id, 1);
  await A("alloc.reassign", { ids: [c1.id, c2.id, c5.id], user_id: id["Arun Agent"] });
  // Arun works c1 and attaches a file to it, and flags c2 for Tina
  const pdf = Buffer.from("%PDF-1.4 made-up test file").toString("base64");
  await AR("queue.open", { id: c1.id }); await AR("attachments.add", { claim_id: c1.id, name: "eob.pdf", type: "application/pdf", data: pdf }); await work(AR, c1.id);
  await flag(AR, c2.id);
  const file1 = (await row("SELECT id FROM attachments WHERE claim_id = ?", c1.id)).id, entry1 = (await row("SELECT id FROM notes WHERE claim_id = ? AND kind = 'work'", c1.id)).id;

  S("N-09: before any share, Sunrise's claims are closed to Vik and Bo");
  let r = await T(() => VK("claims.get", { id: c1.id }));
  ok("N-09: Vik cannot open a Sunrise claim", refused(r, /not in your queue/), r);
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Vik Viewer"], level: "view" });
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Bo Viewer"], level: "view" });
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Eda Editor"], level: "edit" });
  await A("clients.accessSave", { client_id: lake.id, user_id: id["Pavan Poster"], level: "view" });

  S("N-09: with a view-only share they open the claim, its history and its notes, marked view only");
  r = await T(() => VK("claims.get", { id: c1.id }));
  const g = r.r || {};
  ok("N-09: Vik (a team lead, view-only share of Sunrise) opens the claim it lists on Claims, marked view only", r.ok && g.claim.id === c1.id && g.claim.view_only === true && g.claim.view_share === true
    && (await VK("claims.list", { client_id: sun.id, state: "", page_size: 500 })).rows.some((x) => x.id === c1.id), r.ok ? g.claim.view_only : r);
  ok("N-09: he sees its notes (Arun's entry) and its file, with nothing to edit or remove", r.ok && g.notes.some((n) => n.id === entry1) && g.notes.every((n) => !n.editable) && g.attachments.some((a) => a.id === file1) && g.attachments.every((a) => !a.deletable), r.ok && g.notes.map((n) => [n.kind, n.editable]));
  const tl = await T(() => VK("claims.timeline", { id: c1.id }));
  ok("N-09: he sees its history: the entry, the file and the assignment, no entry editable", tl.ok && tl.r.items.some((x) => x.kind === "work" && x.id === entry1) && tl.r.items.some((x) => x.kind === "file") && tl.r.items.filter((x) => x.kind === "work").every((x) => !x.editable), tl.ok ? tl.r.items.map((x) => x.kind) : tl);
  r = await T(() => VK("attachments.get", { id: file1 }));
  ok("N-09: he can open the file to read it", r.ok && r.r.name === "eob.pdf" && r.r.data === pdf, r.ok ? r.r.name : r);
  r = await T(() => BO("claims.get", { id: c1.id }));
  ok("N-09: Bo (a biller with a view-only share) opens it read only too", r.ok && r.r.claim.view_only === true && r.r.claim.view_share === true, r.ok ? r.r.claim.view_only : r);
  r = await T(() => VK("claims.get", { id: k1.id }));
  ok("N-09: a client not shared with him stays closed", refused(r, /not in your queue/), r);
  r = await T(() => PV("claims.get", { id: k1.id }));
  ok("N-09: a Payment posting person with a view-only share still sees only their desk (no claim of it opens)", refused(r, /not in your queue/), r);

  S("N-09: every write is refused for a view-only share, whatever the page sends");
  const snap = async () => JSON.stringify([await rows("SELECT * FROM claims WHERE client_id = ? ORDER BY id", sun.id), await rows("SELECT id, claim_id, kind, comment, status, created_at, edited_at FROM notes ORDER BY id"),
    await rows("SELECT id, claim_id FROM attachments ORDER BY id"), await rows("SELECT * FROM handoffs ORDER BY id"), await rows("SELECT * FROM tat_holds ORDER BY id"), await rows("SELECT * FROM payer_limits ORDER BY client_id, payer_key"),
    await rows("SELECT id FROM escalations ORDER BY id"), await rows("SELECT id, claim_id, kind FROM claim_events ORDER BY id")]);
  // anything the call returns must change nothing; an error is the usual answer
  const noChange = async (label, fn, re) => { const before = await snap(); const x = await T(fn); const same = (await snap()) === before;
    ok("N-09: " + label + ": " + (x.ok ? "nothing changes" : "refused, nothing changes"), same && (!x.ok ? refused(x, re) : (x.r.changed === 0 || x.r.applied === 0)), x); };
  const four = { why: "flagged by the biller", reviewed: "the claim history and the EOB", findings: "the payer needs a call about it", next: "call the payer and update the claim" };
  const wf = { saag: INFORM, note: NOTE, today: TODAY };
  await noChange("Vik adds a note", () => VK("notes.add", { claim_id: c1.id, note: NOTE }));
  await noChange("Vik saves a work entry", () => VK("queue.complete", { id: c1.id, rework: true, ...wf }));
  await noChange("Vik opens it for work", () => VK("queue.open", { id: c1.id }));
  await noChange("Vik skips it", () => VK("queue.skip", { id: c1.id, reason: "test" }));
  await noChange("Vik edits Arun's entry", () => VK("notes.update", { id: entry1, ...wf }));
  await noChange("Vik attaches a file", () => VK("attachments.add", { claim_id: c1.id, name: "x.pdf", type: "application/pdf", data: pdf }));
  await noChange("Vik removes the file", () => VK("attachments.delete", { id: file1 }));
  await noChange("Vik assigns it (to Arun, to himself)", async () => { await VK("alloc.reassign", { ids: [c3.id], user_id: id["Arun Agent"] }); return VK("alloc.reassign", { ids: [c3.id], user_id: id["Vik Viewer"] }); });
  await noChange("Vik unassigns it", () => VK("alloc.unassign", { ids: [c1.id] }));
  await noChange("Vik allocates the client's claims", () => VK("alloc.apply", { client_id: sun.id, assignments: [{ id: c3.id, user_id: id["Arun Agent"] }] }), VIEW_ONLY);
  await noChange("Vik closes, excludes or reopens it", async () => { let changed = 0; for (const state of ["closed", "excluded", "open"]) changed += (await VK("claims.setState", { ids: [c1.id, c3.id], state })).changed; return { changed }; });
  await noChange("Vik changes its priority", () => VK("claims.setPriority", { ids: [c1.id], level: "top", category: "Client request", comment: "the client asked for it" }));
  await noChange("Vik answers the flagged claim", () => VK("attention.answer", { id: c2.id, comment: "Call the payer again and note the reference" }), VIEW_ONLY);
  await noChange("Vik reviews the flagged claim", () => VK("attention.review", { id: c2.id, ...four, route: "biller", today: TODAY }), VIEW_ONLY);
  await noChange("Vik puts the flagged claim on hold", () => VK("tat.hold", { kind: "flag", id: c2.id, reason: "Waiting on the payer", until: "2026-11-13" }), VIEW_ONLY);
  await noChange("Vik saves the payer's TFL", () => VK("payers.saveLimit", { client_id: sun.id, payer: "Aetna", tfl_days: 90 }), VIEW_ONLY);
  await noChange("Vik logs an escalation", () => VK("escalations.save", escPayload(w, sun.id, id["Tina Lead"])), VIEW_ONLY);

  S("N-09: a view-only person who once worked a claim cannot write on it now");
  // Bo worked c4 before (it is on his list, his entry and file are minutes old) and is the biller of its recheck; now he has only the view share
  await sql("UPDATE claims SET assigned_to = ?, assigned_at = ?, state = 'assigned', last_worked_by = ? WHERE id = ?", id["Bo Viewer"], NOW - 3600000, id["Bo Viewer"], c4.id);
  await sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, bucket, comment, created_at) VALUES ('n46-bo', ?, ?, 'Bo Viewer', 'work', 'Claim Denied', 'COB Issue', 'INFORM', 'Payer', 'made-up entry', ?)", c4.id, id["Bo Viewer"], NOW - 1800000);
  await sql("INSERT INTO attachments (id, claim_id, user_id, user_name, name, type, size, created_at) VALUES ('a46-bo', ?, ?, 'Bo Viewer', 'proof.pdf', 'application/pdf', 20, ?)", c4.id, id["Bo Viewer"], NOW - 1800000);
  await sql(`INSERT INTO handoffs (id, claim_id, client_id, dept, status, created_at, created_by, created_by_name, due_at, saag_action, biller_id, available_at) VALUES ('h46-bo', ?, ?, 'subcheck', 'pending', ?, ?, 'Bo Viewer', ?, 'Recheck', ?, ?)`,
    c4.id, sun.id, NOW - 86400000 * 3, id["Bo Viewer"], NOW + 86400000, id["Bo Viewer"], NOW - 3600000);
  r = await T(() => BO("claims.get", { id: c4.id }));
  ok("N-09: on his old claim Bo is read only too (no form, nothing editable)", r.ok && r.r.claim.view_only === true && r.r.notes.every((n) => !n.editable) && r.r.attachments.every((a) => !a.deletable), r.ok ? r.r.claim.view_only : r);
  await noChange("Bo adds a note", () => BO("notes.add", { claim_id: c4.id, note: NOTE }), VIEW_ONLY);
  await noChange("Bo opens it for work", () => BO("queue.open", { id: c4.id }), VIEW_ONLY);
  await noChange("Bo saves a work entry", () => BO("queue.complete", { id: c4.id, ...wf }), VIEW_ONLY);
  await noChange("Bo edits his own entry", () => BO("notes.update", { id: "n46-bo", ...wf }), VIEW_ONLY);
  await noChange("Bo attaches a file", () => BO("attachments.add", { claim_id: c4.id, name: "x.pdf", type: "application/pdf", data: pdf }), VIEW_ONLY);
  await noChange("Bo removes his own file", () => BO("attachments.delete", { id: "a46-bo" }), VIEW_ONLY);
  await noChange("Bo marks his recheck accepted", () => BO("handoffs.close", { id: "h46-bo", outcome: "complete", proof: { ref: "ACK1", date: TODAY } }), VIEW_ONLY);
  const nx = await T(() => BO("queue.next", { today: TODAY }));
  ok("N-09: Next claim does not open it for him", nx.ok && !nx.r.claim && (await row("SELECT state FROM claims WHERE id = ?", c4.id)).state === "assigned", nx);
  await sql("UPDATE claims SET state = 'in_progress', started_at = ? WHERE id = ?", NOW - 60000, c4.id);
  await noChange("Bo skips it", () => BO("queue.skip", { id: c4.id, reason: "test" }), VIEW_ONLY);

  S("N-09: a view-only share never puts the client's claims on someone's list");
  r = await T(() => A("alloc.reassign", { ids: [c3.id], user_id: id["Bo Viewer"] }));
  ok("N-09: the admin cannot give Bo a Sunrise claim (reassign)", refused(r, /cannot be given/) && !(await row("SELECT assigned_to FROM claims WHERE id = ?", c3.id)).assigned_to, r);
  r = await T(() => A("alloc.apply", { client_id: sun.id, assignments: [{ id: c3.id, user_id: id["Bo Viewer"] }] }));
  ok("N-09: nor through Allocate", refused(r, /Pick active billers/) && !(await row("SELECT assigned_to FROM claims WHERE id = ?", c3.id)).assigned_to, r);
  const rp = await TI("attention.reviewPeople", { id: c2.id });
  ok("N-09: nor as the other biller a review sends a claim to", !(rp.people || []).some((p) => p.id === id["Bo Viewer"]) && (rp.people || []).some((p) => p.id === id["Arun Agent"]), rp.people && rp.people.map((p) => p.name));
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Bo Viewer"], level: "edit" });
  r = await T(() => A("alloc.reassign", { ids: [c3.id], user_id: id["Bo Viewer"] }));
  ok("N-09: with Can edit he can be given it (README: a shared biller can be picked)", r.ok && r.r.changed === 1, r);
  await A("clients.accessSave", { client_id: sun.id, user_id: id["Bo Viewer"], level: "view" });

  S("N-09: an edit share and the client's own people work as before");
  r = await T(() => ED("claims.get", { id: c1.id }));
  ok("N-09: Eda (Can edit) opens it to work, not view only", r.ok && r.r.claim.view_only === false && !r.r.claim.view_share, r.ok ? r.r.claim.view_only : r);
  r = await T(() => ED("notes.add", { claim_id: c1.id, note: NOTE }));
  ok("N-09: and adds a note", r.ok, r);
  r = await T(() => AR("notes.add", { claim_id: c1.id, note: NOTE }));
  ok("N-09: Arun adds a note on his claim", r.ok, r);
  r = await T(() => TI("claims.get", { id: c1.id }));
  ok("N-09: Tina opens it to work, with Arun's entry editable for her", r.ok && !r.r.claim.view_only && r.r.notes.some((n) => n.id === entry1 && n.editable), r.ok ? r.r.claim.view_only : r);

  S("N-09: the page says plainly that the claim is view only, and offers nothing to do");
  const src = fs.readFileSync(REPO + "/app/app.jsx", "utf8");
  ok("N-09: the claim shows a View only note and badge for a view-only share", /\{c\.view_share && <div className="alert warn view-only-note"><b>View only\.<\/b>/.test(src) && /is shared with you to look at: you can read this claim, its history and its notes\. Nothing can be added, changed or assigned here\./.test(src)
    && /\{c\.view_share && <span className="badge amber"[^>]*>view only<\/span>\}/.test(src));
  ok("N-09: view only hides the team lead actions, the work form, the note form and the patient's other claims", /const ro = !!\(c && c\.view_only\);/.test(src) && /\{sup && !ro && !q\.data\.handoff_role && \(/.test(src) && /\{!ro && \(c\.mine \|\| \(sup && /.test(src) && /\{!ro && q\.data\.handoff_role && !c\.mine && <NoteForm/.test(src) && /\{!ro && <button className="btn sm" onClick=\{\(\) => setPatientOf/.test(src));
});

/* ======================= F-02: the Client 360 report counts claims ======================= */
await world("F-02", async () => {
  const w = await makeWorld();
  const { A, app, sql, rows } = w;
  const X = (expr) => vm.runInContext(expr, app);
  const me = (await rows("SELECT id FROM users WHERE email = ?", "supervisor" + D))[0];
  let seq = 0;
  const mkClient = async (cid, name) => { await sql("INSERT INTO clients (id, name, created_at) VALUES (?,?,?)", cid, name, Date.parse("2026-01-01T00:00:00Z")); return cid; };
  const claim = async (cid, o) => { const cl = "c46-" + (++seq);
    await sql(`INSERT INTO claims (id, client_id, match_key, claim_no, patient, payer, dos, balance, billed, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      cl, cid, "mk-" + cl, "CLM-46" + seq, "Test Patient " + seq, o.payer, o.dos, o.bal, o.billed, "assigned", Date.parse("2026-07-01T00:00:00Z"), NOW); return cl; };
  const note = (claimId, day, st, sub, act, mv) => sql("INSERT INTO notes (id, claim_id, user_id, user_name, kind, status, sub_status, action, bucket, created_at) VALUES (?,?,?,?, 'work', ?,?,?,?,?)",
    "n46-" + (++seq), claimId, me.id, "Test Biller", st, sub, act, mv, ist(day, "11:00"));
  const october = () => { const range = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31), kind: "month" }, prev = app.crShift(range);
    const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return { range, payload: { from: iso(range.start), to: iso(range.end), prev_from: iso(prev.start), prev_to: iso(prev.end), period_key: X("crPeriodKey")(range) } }; };
  const report = async (cid) => { const per = october(); const raw = await A("creport.get", { client_id: cid, ...per.payload });
    const DS = app.crDatasets(raw), R = { range: per.range, compare: true, client: "Test Clinic", periodName: "October", cardMeasure: {} };
    const ctx = (pid, sel = {}) => app.crCtx(DS, R, pid, sel);
    return { DS, R, raw, ctx, ar: (sel) => app.crBuildAR(ctx("ar", sel)), denials: (sel) => app.crBuildDenials(ctx("denials", sel)), exec: () => app.crBuildExec(ctx("exec"), raw), ca: () => app.crBuildCA(ctx("ca")),
      rejection: () => app.crBuildRejection(ctx("rejection")) }; };
  const kpi = (m, label) => m.kpis.find((k) => k.label === label) || {};
  const card = (m, f) => m.cards.find((c) => c.id === "ar.worked." + f);
  const sum = (c, k) => c.items.reduce((t, x) => t + x[k], 0);
  const cid = await mkClient("c46-f02", "Test Clinic F02");
  // a: denied on 5 Oct, then paid on 20 Oct ($1,000); b: paid on 6 Oct ($500); c: denied on 7 Oct (53 days old) and 21 Oct (67 days old) ($300)
  const a = await claim(cid, { payer: "Medicare", dos: "2026-09-01", bal: 400, billed: 1000 }), b = await claim(cid, { payer: "Aetna", dos: "2026-09-02", bal: 300, billed: 500 }), c = await claim(cid, { payer: "Aetna", dos: "2026-08-15", bal: 300, billed: 300 });
  await note(a, "2026-10-05", "Claim Denied", "CO-16 Missing information", "Corrected claim sent", "Payer"); await note(a, "2026-10-20", "Claim Paid", "Paid in full", "Close", "Closed");
  await note(b, "2026-10-06", "Claim Paid", "Paid in full", "Close", "Closed");
  await note(c, "2026-10-07", "Claim Denied", "CO-50 Not medically necessary", "Appeal filed", "Payer"); await note(c, "2026-10-21", "Claim Denied", "CO-50 Not medically necessary", "Appeal filed", "Payer");
  const r = await report(cid);

  S("F-02: AR production counts claims: one per claim, at its latest entry, in the KPIs and every chart");
  const ar = r.ar({});
  ok("F-02: Claims worked 3 and Amount worked $1,800 (5 entries on 3 claims)", kpi(ar, "Claims worked").value === "3" && kpi(ar, "Amount worked").value === "$1,800", ar.kpis.map((k) => k.label + " " + k.value));
  ok("F-02: the small line under Claims worked gives the work entries: 5 entries", kpi(ar, "Claims worked").sub === "5 entries", kpi(ar, "Claims worked"));
  const st = card(ar, "purviewStatus"), paidBar = st.items.find((x) => /paid/i.test(x.label)), denBar = st.items.find((x) => /denied/i.test(x.label));
  ok("F-02: Status wise breakdown at each claim's latest entry: Claim Paid $1,500 (2 claims), Claim Denied $300 (1 claim)", paidBar && paidBar.amount === 1500 && paidBar.count === 2 && denBar && denBar.amount === 300 && denBar.count === 1, st.items.map((x) => [x.label, x.count, x.amount]));
  ok("F-02: all four charts add up to Claims worked and Amount worked (3 claims, $1,800)", ["bucket", "purviewStatus", "action", "payerKey"].every((f) => card(ar, f) && sum(card(ar, f), "count") === 3 && sum(card(ar, f), "amount") === 1800),
    ["bucket", "purviewStatus", "action", "payerKey"].map((f) => card(ar, f) && [f, sum(card(ar, f), "count"), sum(card(ar, f), "amount")]));
  ok("F-02: Confirmed paid and Denied count the claims with such an entry in October: 2 of 3 each", kpi(ar, "Confirmed paid").value === "67%" && kpi(ar, "Confirmed paid").sub === "2 claims" && kpi(ar, "Denied").value === "67%" && kpi(ar, "Denied").sub === "2 claims", ar.kpis);

  S("F-02: a filter picks claims by their latest entry, so a picked bar matches the KPIs");
  const pick = (f, key) => ({ [f]: new Set([key]) });
  let m = r.ar(pick("purviewStatus", denBar.key));
  const stD = card(m, "purviewStatus"), picked = stD.items.find((x) => x.key === denBar.key);
  ok("F-02: picking Claim Denied: 1 claim, $300, as its bar (claim a was denied, then paid: it is a paid claim now)", kpi(m, "Claims worked").value === "1" && kpi(m, "Amount worked").value === "$300" && picked.count === 1 && picked.amount === 300,
    { kpis: m.kpis.map((k) => k.label + " " + k.value), bar: picked && [picked.count, picked.amount] });
  ok("F-02: and the other charts show that one claim (Aetna $300), its 2 entries under Claims worked", sum(card(m, "payerKey"), "amount") === 300 && sum(card(m, "bucket"), "count") === 1 && kpi(m, "Claims worked").sub === "2 entries", m.cards.map((x) => [x.id, sum(x, "count"), sum(x, "amount")]));
  const bk = card(ar, "bucket"), b3160 = bk.items.find((x) => /31/.test(x.label) && /60/.test(x.label));
  m = r.ar(pick("bucket", b3160.key));
  const bkP = card(m, "bucket").items.find((x) => x.key === b3160.key);
  ok("F-02: picking 31-60 days: claims a and b ($1,500), as its bar (c was 53 days old on 7 Oct but 67 at its latest entry)", kpi(m, "Claims worked").value === "2" && kpi(m, "Amount worked").value === "$1,500" && bkP.count === 2 && bkP.amount === 1500,
    { kpis: m.kpis.map((k) => k.value), bar: bkP && [bkP.count, bkP.amount], bars: bk.items.map((x) => [x.label, x.count]) });
  const sl = app.crSliceSource(r.ctx("ar"), "ar");
  ok("F-02: the filter lists offer the claims at their latest entry (3 claims: paid 2, denied 1)", sl.rows.length === 3 && X("crAgg")(sl.rows, "purviewStatus", sl.ds, { measure: "count" }).map((x) => x.count).join(",") === "2,1", sl.rows.length);
  m = r.ar(pick("payerKey", card(ar, "payerKey").items.find((x) => /aetna/i.test(x.label)).key));
  ok("F-02: picking Aetna: claims b and c, $800, 3 entries; Confirmed paid 1, Denied 1", kpi(m, "Claims worked").value === "2" && kpi(m, "Amount worked").value === "$800" && kpi(m, "Claims worked").sub === "3 entries" && kpi(m, "Confirmed paid").sub === "1 claim" && kpi(m, "Denied").sub === "1 claim", m.kpis);

  S("F-02: the report's other pages count claims too");
  const dn = r.denials({});
  ok("F-02: Denials: 2 denied claims ($1,300), each once however often it was denied, 66.7% of the 3 claims worked (as AR production's Denied)", kpi(dn, "Denied claims").value === "2" && kpi(dn, "Denied amount").value === "$1,300" && kpi(dn, "Denial rate").value === "66.7%", dn.kpis.map((k) => k.label + " " + k.value));
  const ex = r.exec();
  ok("F-02: Executive summary: Claims worked 3, denial rate 66.7% (2 claims)", kpi(ex, "Claims worked").value === "3" && kpi(ex, "Denial rate").value === "66.7%" && kpi(ex, "Denial rate").sub === "2 claims", ex.kpis.map((k) => k.label + " " + k.value));
  const cid2 = await mkClient("c46-f02b", "Test Clinic F02b");
  const d = await claim(cid2, { payer: "Aetna", dos: "2026-09-10", bal: 250, billed: 250 }), e = await claim(cid2, { payer: "Cigna", dos: "2026-09-11", bal: 150, billed: 150 });
  await note(d, "2026-10-08", "Claim Denied", "Need medical records", "Requested from the client", "Client"); await note(d, "2026-10-22", "Claim Denied", "Need medical records", "Requested from the client", "Client");
  await note(e, "2026-10-09", "Claim Rejected", "Invalid member ID", "Corrected and resubmitted", "Payer"); await note(e, "2026-10-12", "Claim Rejected", "Invalid member ID", "Corrected and resubmitted", "Payer");
  const r2 = await report(cid2), ca = r2.ca(), rj = r2.rejection();
  ok("F-02: Client assistance: a claim whose entries put it with the client twice is one claim ($250)", kpi(ca, "Claims needing the client").value === "1" && kpi(ca, "Amount on hold").value === "$250", ca.kpis.map((k) => k.label + " " + k.value));
  ok("F-02: Rejections read from the AR entries: a claim rejected twice is one rejected claim, of 2 claims worked", kpi(rj, "Rejected claims").value === "1" && kpi(rj, "Rejection rate").value === "50.0%", rj.kpis.map((k) => k.label + " " + k.value));
});

const failed = results.filter((x) => !x.pass);
Date.now = realNow;
console.log(`\n==== suite46: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) console.log(failed.map((x) => "  FAIL " + x.section + " :: " + x.name).join("\n"));
process.exit(failed.length ? 1 : 0);
