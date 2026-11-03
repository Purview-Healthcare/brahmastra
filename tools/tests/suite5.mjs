/* Suite 5: feedback with screenshots and snippets, emailed to Shreya and Sweety. */
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 300))); };
const P = (o) => Object.assign({ emp_id: "", name: "", position: "Agent", function: "Operations", department: "AR", also_in_departments: "", status: "Working", project: "Sunrise Eye Care", also_on_projects: "", reports_to: "", shift: "", location: "Pune", doj: "2026-01-05", exit_date: null, email: "" }, o);
const feed = [
  P({ emp_id: "M3", name: "Sweety Tirpude", position: "Manager", project: "", email: "sweety@purview-healthcare.com" }),
  P({ emp_id: "T9", name: "Shreya Kashikar", position: "Team Lead", reports_to: "Sweety Tirpude", email: "shreya@purview-healthcare.com" }),
  P({ emp_id: "A9", name: "Shreya Agentson", reports_to: "Shreya Kashikar", email: "shreya.agent@purview-healthcare.com" }),
  P({ emp_id: "A1", name: "Arun Agent", reports_to: "Shreya Kashikar", email: "arun@purview-healthcare.com" })];
const mails = [];
const fetchMock = async (url, init) => {
  if (url.includes("brahmastra_roster")) return new Response(JSON.stringify({ ok: true, rows: feed }), { headers: { "Content-Type": "application/json" } });
  if (url.includes("mail.example")) { mails.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
  return new Response("nope", { status: 500 });
};
const rig = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail.example/hook" }, fetchMock });
const { as, tryOp, sha } = rig; const T = (fn) => tryOp(fn);
await rig.app.seedDemo(() => {});
const login = async (email, pw) => as(null)("auth.login", { email, passHash: await sha(pw) });
const A = as((await login("supervisor@purview-healthcare.com", "brahmastra-demo")).token);
await A("roster.syncShastra");
const users = (await A("users.list")).users; const U = (n) => users.find((u) => u.name === n);
const firstIn = async (name, email) => { await as(null)("auth.firstPassword", { user_id: U(name).id, passHash: await sha("pw-" + email) }); return as((await login(email, "pw-" + email)).token); };
const AR = await firstIn("Arun Agent", "arun@purview-healthcare.com"), SH = await firstIn("Shreya Kashikar", "shreya@purview-healthcare.com"), SW = await firstIn("Sweety Tirpude", "sweety@purview-healthcare.com");
// a tiny real PNG (1x1)
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

S("Who gets it");
const rec = await AR("feedback.recipients");
ok("Shreya (the team lead, not the biller Shreya) and Sweety", rec.people.map((p) => p.name).sort().join(",") === "Shreya Kashikar,Sweety Tirpude", rec.people);

S("A biller sends feedback with a screenshot and a snippet");
let r = await T(async () => AR("feedback.send", { kind: "bug", message: "short" }));
ok("too short is refused", !r.ok, r);
r = await T(async () => AR("feedback.send", { kind: "bug", message: "The claim list does not load", files: [{ name: "x.exe", type: "application/x-msdownload", b64: png }] }));
ok("a program file is refused", !r.ok && /pictures|PDF/i.test(r.e), r);
r = await T(async () => AR("feedback.send", { kind: "bug", message: "The claim list does not load", files: [{ name: "big.png", type: "image/png", b64: "A".repeat(1600000) }] }));
ok("a file over the size limit is refused", !r.ok && /too large/i.test(r.e), r);
r = await T(async () => AR("feedback.send", { kind: "bug", message: "The claim list does not load after I pick Westside", page: "Claims (#/claims)", version: "2.49.0", screen: "1440x900",
  files: [{ name: "Screenshot 2026-11-02 10.15.jpg", type: "image/png", b64: png }, { name: "Snippet 1.png", type: "image/png", b64: "data:image/png;base64," + png }] }));
ok("sent", r.ok && r.r.saved, r);
ok("emailed to both", r.ok && r.r.emailed.sort().join(",") === "Shreya Kashikar,Sweety Tirpude", r.r);
ok("two emails went out, to their account emails", mails.length === 2 && mails.map((m) => m.to).sort().join(",") === "shreya@purview-healthcare.com,sweety@purview-healthcare.com", mails.map((m) => m.to));
const m0 = mails[0] || {};
ok("subject names the kind and the sender", /Something is wrong/.test(m0.subject) && /Arun Agent/.test(m0.subject), m0.subject);
ok("both files attached, data URL prefix stripped", (m0.attachments || []).length === 2 && m0.attachments.every((a) => a.b64 === png), (m0.attachments || []).map((a) => a.name));
ok("email body has the message and page, escaped", /does not load after I pick Westside/.test(m0.html) && /#\/claims/.test(m0.html), "");
r = await T(async () => AR("feedback.send", { kind: "idea", message: "<script>alert(1)</script> please add a filter" }));
ok("HTML in a message is escaped in the email", r.ok && !/<script>/.test(mails[mails.length - 1].html) && /&lt;script&gt;/.test(mails[mails.length - 1].html), "");

S("The inbox");
r = await T(async () => AR("feedback.list"));
ok("a biller cannot open the inbox", !r.ok, r);
ok("the biller's count says not a reader", (await AR("feedback.count")).reader === false);
const c = await SH("feedback.count"); ok("Shreya sees 2 new", c.reader && c.n === 2, c);
const lst = await SW("feedback.list", { show: "new" });
const bug = lst.rows.find((x) => x.kind === "bug");
ok("Sweety lists both, with who, page and files", lst.rows.length === 2 && bug.user_name === "Arun Agent" && bug.files.length === 2 && /claims/.test(bug.page) && /Shreya/.test(bug.emailed_to), bug);
const file = await SW("feedback.file", { id: bug.files[0].id }); ok("the screenshot opens", file.b64 === png && file.type === "image/png");
r = await T(async () => AR("feedback.file", { id: bug.files[0].id })); ok("a biller cannot open the files", !r.ok);
await SH("feedback.setStatus", { id: bug.id, status: "done" });
ok("marked done by Shreya", (await SW("feedback.list", { show: "done" })).rows.some((x) => x.id === bug.id && x.done_by_name === "Shreya Kashikar"));
ok("new count drops", (await SW("feedback.count")).n === 1);

S("Who gets it can be changed by the admin only");
r = await T(async () => SH("feedback.setRecipients", { ids: [U("Arun Agent").id] })); ok("a team lead cannot change it", !r.ok, r);
r = await T(async () => SH("settings.save", { settings: { feedback_to: [U("Arun Agent").id] } }));
ok("nor through the settings save", r.ok && (await AR("feedback.recipients")).people.length === 2, (await AR("feedback.recipients")).people);
r = await T(async () => A("feedback.setRecipients", { ids: [U("Sweety Tirpude").id] })); ok("the admin narrows it to Sweety", r.ok && r.r.people.map((p) => p.name).join() === "Sweety Tirpude", r);
const before = mails.length;
await AR("feedback.send", { kind: "praise", message: "The new desk options are much clearer" });
ok("next feedback goes to Sweety only", mails.length === before + 1 && mails[before].to === "sweety@purview-healthcare.com", mails.slice(before).map((m) => m.to));
ok("Shreya no longer sees the inbox", (await SH("feedback.count")).reader === false);

S("Email trouble never loses feedback");
mails.length = 0;
{ // Live server: the reply comes back at once and the emails go out after it (waitUntil), all at the same time.
  const tok = (await login("arun@purview-healthcare.com", "pw-arun@purview-healthcare.com")).token, before = mails.length, bg = [];
  const res = await rig.worker.default.fetch(new Request("https://api.example/api", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({ op: "feedback.send", payload: { kind: "bug", message: "The send button waits a long time" } }) }), { ...rig.backend.env, ...rig.liveEnv, DEMO: false, DB: rig.backend.env.DB }, { waitUntil: (p) => bg.push(p) });
  const j = await res.json();
  ok("live: replies before the emails go out", j.saved && (j.sending || []).length >= 1 && bg.length === 1, j);
  await Promise.all(bg);
  ok("live: then every email goes out", mails.length === before + j.sending.length, mails.length - before);
  const row = (await SW("feedback.list")).rows.find((x) => /waits a long time/.test(x.message));
  ok("live: the inbox records who it was emailed to", row && j.sending.every((n) => row.emailed_to.includes(n)), row && row.emailed_to);
}
const rig2 = await makeRig({ envExtra: { SHASTRA_FEED_KEY: "k".repeat(48), EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://down.example/hook" }, fetchMock });
await rig2.app.seedDemo(() => {});
const A2 = rig2.as((await rig2.as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await rig2.sha("brahmastra-demo") })).token);
await A2("roster.syncShastra");
const r2 = await rig2.tryOp(async () => A2("feedback.send", { kind: "bug", message: "Saving a note shows an error" }));
ok("still saved, with the email error reported", r2.ok && r2.r.saved && r2.r.emailed.length === 0 && /did not accept/i.test(r2.r.email_error), r2);
ok("and in the inbox, marked not emailed", (await A2("feedback.list")).rows.some((x) => /Saving a note/.test(x.message) && !x.emailed_to && x.email_error));

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
