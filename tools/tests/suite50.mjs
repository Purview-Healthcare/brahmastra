/* Suite 50 (core release): the sign-in fixes of the third bug test, taken on their own ahead of the Stack report fixes:
   X-01: nobody can keep someone (or the admin) from getting a sign-in code: codes are paced, never stopped.
   X-02: a joiner with no email is never shown a made-up address, and the team lead's code works the way the pop-up says.
   A stand-in for Purview Shastra's roster; made-up people only. The Stack report's checks (U-xx) join this file with those fixes. */
import vm from "vm";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600))); };

const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const D = (m, d, y = 2026) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json" } });
const mail = (n) => n.toLowerCase().replace(/[^a-z ]/g, "").replace(/ /g, ".") + "@purview-healthcare.com";
const SUN = "Sunrise Eye Care", LAKE = "Lakeview Dental Group", HARBOR = "Harbor Clinic";
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const AS = (emp_id, name, lead, project, o = {}) => P({ emp_id, name, project, reports_to: lead, email: mail(name), ...o });
const dayList = (a, b) => { const out = []; for (let t = Date.parse(a + "T12:00:00Z"); t <= Date.parse(b + "T12:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const isWeekday = (iso) => { const w = new Date(iso + "T12:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
const FD = (emp, date, status, tof = 480, brk = 45) => ({ emp_id: emp, email: "", date, status, open: false, tof_min: tof, logged_min: tof + brk, break_min: brk, guard: false, idle_min: 0, locked_min: 0 });
const serial = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86400000);
const rep = (n, row) => Array.from({ length: n }, () => row);
const OCT = dayList(D(10, 1), D(10, 31)).filter((d) => isWeekday(d) && d !== D(10, 2));   // 21 working days (Oct 2 a holiday)
// Vida Vice (VP) over Mona Manager (Tina Lead on Sunrise, Leo Lead on Lakeview) and Mark Manager (Lila Lead on Harbor)
const stdFeed = () => [
  P({ emp_id: "V1", name: "Vida Vice", position: "Vice President", email: mail("Vida Vice") }),
  P({ emp_id: "M1", name: "Mona Manager", position: "Manager", reports_to: "Vida Vice", project: SUN, also_on_projects: LAKE, email: mail("Mona Manager") }),
  P({ emp_id: "T1", name: "Tina Lead", position: "Team Lead", project: SUN, reports_to: "Mona Manager", email: mail("Tina Lead") }),
  P({ emp_id: "T2", name: "Leo Lead", position: "Team Lead", project: LAKE, reports_to: "Mona Manager", email: mail("Leo Lead") }),
  P({ emp_id: "M2", name: "Mark Manager", position: "Manager", reports_to: "Vida Vice", project: HARBOR, email: mail("Mark Manager") }),
  P({ emp_id: "T3", name: "Lila Lead", position: "Team Lead", project: HARBOR, reports_to: "Mark Manager", email: mail("Lila Lead") }),
];

/* One made-up floor on a fresh rig, the clock at `now` (India time), Shastra's feeds standing in. */
async function floor({ now = IST(2026, 11, 16, 15), feed, floorRows = [], holidays = [{ date: D(10, 2), name: "Gandhi Jayanti" }], capacity = 10 } = {}) {
  const st = { feed, floorRows, holidays };
  const fetchMock = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url.includes("brahmastra_roster")) return J({ ok: true, rows: st.feed });
    if (url.includes("brahmastra_holidays")) return J({ ok: true, holidays: st.holidays });
    if (url.includes("brahmastra_floor")) return J({ ok: true, rows: st.floorRows.filter((x) => x.date >= body.p_from && x.date <= body.p_to) });
    if (url.includes("supabase.co")) return J({ code: "PGRST202", message: "no such function" }, 404);
    return J({ error: "no outside calls in tests" }, 500);
  };
  const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48) }, fetchMock });
  const VDate = vm.runInContext("Date", rig.app);
  const F = { rig, app: rig.app, st, T: (fn) => rig.tryOp(fn) };
  F.clock = (ms) => { Date.now = () => ms; VDate.now = () => ms; };
  F.clock(now);
  const DB = rig.backend.env.DB;
  F.sql = (q, ...a) => DB.prepare(q).bind(...a).run();
  F.rows = async (q, ...a) => (await DB.prepare(q).bind(...a).all()).results;
  await rig.app.seedDemo(() => {});
  const login = async (email, pw) => rig.as(null)("auth.login", { email, passHash: await rig.sha(pw) });
  F.AD = rig.as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
  await F.sql("UPDATE sessions SET expires_at = ?", IST(2030, 1, 1));
  F.sync = async () => { const r = await F.AD("roster.syncShastra"); F.users = (await F.AD("users.list")).users; return r; };
  await F.sync();
  F.U = (n) => F.users.find((u) => u.name === n);
  F.id = (n) => F.U(n).id;
  const seen = new Map();
  F.who = async (name, email = mail(name)) => {
    if (seen.has(email)) return seen.get(email);
    const u = F.users.find((x) => x.name === name && (x.email || "") === email) || F.U(name);
    await rig.as(null)("auth.firstPassword", { user_id: u.id, passHash: await rig.sha("pw-" + email) }).catch(() => {});
    const X = rig.as((await login(email, "pw-" + email)).token); await F.sql("UPDATE sessions SET expires_at = ?", IST(2030, 1, 1)); seen.set(email, X); return X;
  };
  if (capacity) await F.sql("UPDATE users SET capacity = ? WHERE source = 'roster'", capacity);
  const claimIds = (await F.rows("SELECT id FROM claims ORDER BY id LIMIT 50")).map((r) => r.id);
  let nn = 0;
  // n work entries by a person on a day, from 11:00 India time (or from atMs), a second apart
  F.work = async (name, day, n, atMs) => { const u = typeof name === "string" ? F.U(name) : name; const [y, m, d] = day.split("-").map(Number), t0 = atMs || IST(y, m, d, 11);
    await F.sql("WITH RECURSIVE c(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM c WHERE i < ?) INSERT INTO notes (id, claim_id, user_id, user_name, kind, created_at) SELECT ? || i, ?, ?, ?, 'work', ? + i * 1000 FROM c",
      n - 1, "s50-" + (++nn) + "-", claimIds[nn % claimIds.length], u.id, u.name, t0); };
  F.month = (X, month) => X("stack.month", { month });
  F.save = (X, month, name, field, value, note) => F.T(() => X("stack.save", { month, user_id: typeof name === "string" ? F.id(name) : name.id, field, value, note }));
  F.row = (d, n) => d.rows.find((r) => r.name === n);
  F.tl = (d, n) => d.tls.find((t) => t.name === n);
  F.ts = (X, from, to) => X("team.status", { from, to, today: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), tz_offset_min: 330 });
  F.xlsx = (sheets) => { const XLSX = rig.app.XLSX, wb = XLSX.utils.book_new(); for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })); };
  F.read = (bytes, name) => rig.app.extraRead(bytes, name);
  F.body = (draft, o = {}) => ({ month: o.month || "2026-11", drive_id: "b!madeUpDrive", item_id: o.item || "item-1", file_name: draft.file,
    web_url: "https://purviewhealthcare-my.sharepoint.com/personal/tina_lead/Documents/" + encodeURIComponent(draft.file), groups: draft.groups, skipped: draft.skipped, sheets: draft.sheets, ...(o.edits ? { edits: o.edits } : {}) });
  return F;
}
const presentAll = (emps, days = OCT) => emps.flatMap((e) => days.map((d) => FD(e, d, "present")));

// ---------------------------------------------------------------------------------------------------------------------------
S("X-01: nobody can keep someone (or the admin) from getting a sign-in code: codes are paced, never stopped");
{
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN)];
  const T0 = IST(2026, 11, 16, 10, 0);
  const F = await floor({ feed, now: T0 });
  // a call as Cloudflare passes it: the caller's network address in CF-Connecting-IP
  const from = async (ip, op, payload = {}) => { const res = await F.rig.backend.fetch("https://demo.brahmastra.local/api", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ op, payload }) });
    let data = null; try { data = await res.json(); } catch (e) { /* none */ } return res.ok ? { ok: true, r: data } : { ok: false, e: (data && data.error) || "", status: res.status }; };
  const STRANGER = "203.0.113.9", HOME = "198.51.100.7", at = (min, sec = 0) => F.clock(T0 + min * 60000 + sec * 1000);
  const admin = (await F.rows("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at LIMIT 1"))[0];
  // the stranger asks for the admin's code ten times, 46 seconds apart, then types one wrong code
  let codes = [];
  for (let i = 0; i < 10; i++) { at(0, i * 46); codes.push((await from(STRANGER, "auth.adminCode", {})).r); }
  at(7, 40); let r = await from(STRANGER, "auth.adminVerify", { user_id: admin.id, code: "000000" });
  ok("X-01: ten codes went out at the stranger's asking (to the admin's mailbox), and the stranger's wrong code is refused", codes.every((c) => c && /^\d{6}$/.test(c.demo_code)) && !r.ok && r.status === 401, r);
  at(9, 0); r = await from(HOME, "auth.adminCode", {});
  ok("X-01: within five minutes of the tenth an eleventh is paced: it says when, and that the newest code still works", !r.ok && r.status === 429 && /at most every five minutes: try again in 3 minutes\. A code sent in the last ten minutes still works/.test(r.e), r);
  r = await from(HOME, "auth.adminVerify", { user_id: admin.id, code: codes[9].demo_code });
  ok("X-01: and the newest code in the mailbox signs the admin in from their own network", r.ok && r.r.user.is_admin === true, r);
  // all over again: the stranger asks ten more times (with ten already in the hour the pace lets one through) and types a wrong
  // code; 25 minutes later every code has run out
  codes = [];
  for (let i = 0; i < 10; i++) { at(30, i * 46); codes.push((await from(STRANGER, "auth.adminCode", {})).r); }
  at(37, 40); await from(STRANGER, "auth.adminVerify", { user_id: admin.id, code: "000000" });
  at(55); r = await from(HOME, "auth.adminCode", {});
  ok("X-01: 25 minutes later, every code run out, the admin's own request is sent (it was refused for the rest of the hour)", r.ok && /^\d{6}$/.test(r.r.demo_code), r);
  const fresh = r.r.demo_code; r = await from(HOME, "auth.adminVerify", { user_id: admin.id, code: fresh });
  ok("X-01: and it signs the admin in", r.ok && r.r.user.is_admin === true, r);
  // the same for a person's Email code: a stranger asking every 46 seconds for an hour gets at most about twenty codes sent
  // (the pace never runs out: every fifth minute one more goes to the person's mailbox, where it works for them)
  const ARUN = mail("Arun Agent"); let sent = 0, last = null;
  for (let s = 0; s < 3600; s += 46) { F.clock(IST(2026, 11, 16, 12, 0) + s * 1000); const x = await from(STRANGER, "auth.sendOtp", { email: ARUN }); if (x.ok) { sent++; last = x.r.demo_code; } }
  ok("X-01: a stranger asking every 46 seconds for an hour gets about twenty codes sent: ten, then one every five minutes (guessing stays bounded)", sent >= 18 && sent <= 21, sent);
  F.clock(IST(2026, 11, 16, 13, 0)); r = await from(HOME, "auth.verifyOtp", { email: ARUN, code: last });
  ok("X-01: and the last of them signs Arun in from his own network", r.ok && r.r.user.name === "Arun Agent", r);
  // DA's caps on wrong codes stay: five wrong codes from one network stop that network, not the person
  F.clock(IST(2026, 11, 16, 14, 0)); const mine = (await from(HOME, "auth.sendOtp", { email: ARUN })).r.demo_code;
  const wrong = mine === "123456" ? "654321" : "123456";
  const five = []; for (let i = 0; i < 5; i++) five.push(await from(STRANGER, "auth.verifyOtp", { email: ARUN, code: wrong }));
  const sixth = await from(STRANGER, "auth.verifyOtp", { email: ARUN, code: mine });
  r = await from(HOME, "auth.verifyOtp", { email: ARUN, code: mine });
  ok("X-01: the caps on wrong codes stay: five from one network stop that network (even with the right code), the person signs in from theirs", five.every((x) => !x.ok) && !sixth.ok && sixth.status === 429 && r.ok, [five.map((x) => x.status), sixth, r.ok]);
}

// ---------------------------------------------------------------------------------------------------------------------------
S("X-02: a joiner with no email: never shown a made-up address, and the team lead's code works the way the pop-up says");
{
  const feed = [...stdFeed(), AS("PHC-A1", "Arun Agent", "Tina Lead", SUN), P({ emp_id: "PHC-NM", name: "Nil Nomail", project: SUN, reports_to: "Tina Lead", email: "" }),
    P({ emp_id: "PHC-OX", name: "Oxa Outside", project: SUN, reports_to: "Tina Lead", email: "oxa.outside@example.org" })];
  const F = await floor({ feed });
  const TI = await F.who("Tina Lead"), anon = F.rig.as(null), sha = F.rig.sha;
  const nil = F.U("Nil Nomail"), arun = F.U("Arun Agent");
  let r = await F.T(() => TI("users.loginCode", { id: nil.id }));
  ok("X-02: the team lead's code for Nil (no email in Shastra) says so: no address, never the made-up one", r.ok && r.r.email === "" && r.r.no_email === true && r.r.has_password === false && /^\d{6}$/.test(r.r.code) && !/no-email\.invalid/.test(JSON.stringify(r.r)), r);
  const code1 = r.r.code;
  // the pop-up's steps: Sign in, type the name, pick yourself, enter the code, choose a password
  let s = await anon("auth.setupCode", { user_id: nil.id });
  ok("X-02: picking his name asks for the team lead's code (no email to send one to)", s.via === "lead", s);
  const ph1 = await sha("nil-first-password"), ph2 = await sha("nil-new-password");
  r = await F.T(() => anon("auth.completeSetup", { user_id: nil.id, code: code1, passHash: ph1 }));
  ok("X-02: the code and a new password sign Nil in", r.ok && r.r.user.id === nil.id && r.r.user.email_missing === true, r);
  // later, with a password: Forgot it? Reset with a one-time code takes the team lead's code the same way
  F.clock(IST(2026, 11, 16, 15, 30));
  r = await F.T(() => TI("users.loginCode", { id: nil.id }));
  ok("X-02: a second code for Nil says he has a password now (the pop-up then names Forgot it?)", r.ok && r.r.has_password === true && r.r.no_email === true, r);
  s = await anon("auth.setupCode", { user_id: nil.id });
  const code2 = r.r.code, again = await F.T(() => anon("auth.completeSetup", { user_id: nil.id, code: code2, passHash: ph2 }));
  ok("X-02: Forgot it? (a code, then a new password) signs him in with it", s.via === "lead" && again.ok && again.r.user.id === nil.id, again);
  // a person with an email: right after the team lead's code, Send me a code goes out at once, and the team lead's code works
  F.clock(IST(2026, 11, 16, 16, 0));
  const tl = await TI("users.loginCode", { id: arun.id });
  r = await F.T(() => anon("auth.sendOtp", { email: mail("Arun Agent") }));
  ok("X-02: Arun presses Send me a code right after his team lead made a code: it is sent (no 45-second wait for a code that was never emailed)", tl.no_email === false && tl.email === mail("Arun Agent") && r.ok, r);
  r = await F.T(() => anon("auth.verifyOtp", { email: mail("Arun Agent"), code: tl.code }));
  ok("X-02: and on the Email code screen the team lead's code signs him in", r.ok && r.r.user.id === arun.id, r);
  r = await F.T(() => anon("auth.sendOtp", { email: mail("Arun Agent") }));
  ok("X-02: (the 45-second pause between emailed codes stays)", !r.ok && r.status === 429 && /less than a minute ago/.test(r.e), r);
  // an email that is not a Purview address: no sign-in screen takes a code for it, so none is handed out, and the lead is told why
  r = await F.T(() => TI("users.loginCode", { id: F.U("Oxa Outside").id }));
  ok("X-02: a code for someone whose email is not a Purview address is refused with the reason (it could sign them in nowhere)", !r.ok && r.status === 400 && /Oxa Outside's email is not a Purview address, so a sign-in code cannot sign them in/.test(r.e), r);
  // the page: the account menu, Settings › My profile, the Set your password screen and the two pop-ups use emailOf / NO_EMAIL
  const emailOf = vm.runInContext("emailOf", F.app), NO = vm.runInContext("NO_EMAIL", F.app);
  ok("X-02: the page writes 'no email in Purview Shastra' for such a person, and the real address otherwise", emailOf({ email: "nil.nomail@no-email.invalid", email_missing: true }) === "no email in Purview Shastra" && NO === "no email in Purview Shastra" && emailOf({ email: "arun@x.com" }) === "arun@x.com");
  const page = (await import("fs")).readFileSync(new URL("../../app/app.jsx", import.meta.url), "utf8");
  ok("X-02: no page shows me.email, a pop-up's email or the code's email without the no-email check; the pop-up names the real tab (Email code) or the name way",
    !/<dd>\{me\.email\}<\/dd>/.test(page) && /\{emailOf\(me\)\}<br \/>/.test(page) && /\(\{emailOf\(tempPw\.user\)\}\)/.test(page) && /\(\{codeFor\.no_email \? NO_EMAIL : codeFor\.email\}\)/.test(page)
    && !/"Sign in with a code", enter their email/.test(page) && /they choose <b>Email code<\/b>/.test(page) && /they type their name, pick themselves/.test(page) && /Signed in as \{me\.email_missing \? me\.name : me\.email\}/.test(page));
}

// ---------------------------------------------------------------------------------------------------------------------------
const passed = results.filter((x) => x.pass).length, failed = results.length - passed;
console.log(`\n==== ${passed} passed, ${failed} failed of ${results.length}`);
process.exit(failed ? 1 : 0);
