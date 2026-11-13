/* Suite 46: the owner's decisions after the second bug test (fixer DB). E-20: Live status shows who works on what, the Escalation
   tracker's open escalations and the claims flagged by billers, and its tab counts the two lists. The clock is fixed at
   Tue 10 Nov 2026 14:00 IST. Made-up data only ("Test Patient", made-up claim numbers, made-up people). */
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

const failed = results.filter((x) => !x.pass);
Date.now = realNow;
console.log(`\n==== suite46: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) console.log(failed.map((x) => "  FAIL " + x.section + " :: " + x.name).join("\n"));
process.exit(failed.length ? 1 : 0);
