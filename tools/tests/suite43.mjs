// Second bug test round: the fixes for what only showed on Cloudflare's own runtime and the gaps the first round left.
// I-06: the schedules in wrangler.toml name their weekdays, because Cloudflare counts weekday 1 as Sunday (its cron
// trigger docs), so the Monday digest really runs on Monday and the TAT reminders Monday to Friday.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { makeRig } from "./rig.mjs";
const results = []; let section = "";
const S = (n) => { section = n; console.log("\n## " + n); };
const ok = (name, cond, info) => { results.push({ section, name, pass: !!cond, info }); console.log((cond ? "  PASS " : "  FAIL ") + name + (cond || info === undefined ? "" : "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 400))); };
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IST = 330 * 60000;

S("I-06: the schedules run on the weekdays README gives, the way Cloudflare reads them");
const toml = fs.readFileSync(path.join(REPO, "wrangler.toml"), "utf8"), src = fs.readFileSync(path.join(REPO, "worker.js"), "utf8");
const crons = JSON.parse((toml.match(/^\s*crons\s*=\s*(\[[^\]]*\])/m) || [])[1] || "[]");
const DIGEST_CRON = (src.match(/const DIGEST_CRON = "([^"]+)"/) || [])[1];
ok("I-06: wrangler.toml has the hourly, the Monday digest and the TAT reminder schedules", crons.length === 3, crons);
ok("I-06: no schedule gives its weekday as a number (Cloudflare counts 1 as Sunday)", crons.every((c) => !/\d/.test(c.trim().split(/\s+/)[4] || "")), crons);
ok("I-06: the digest schedule in wrangler.toml is the one worker.js waits for (DIGEST_CRON)", !!DIGEST_CRON && crons.includes(DIGEST_CRON), { DIGEST_CRON, crons });
// Cloudflare's documented fields: minute, hour, day of month, month (1-12 or JAN..DEC), weekday (1-7 = SUN..SAT, or SUN..SAT)
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const field = (spec, lo, hi, names) => {
  const set = new Set(), val = (x) => { const i = names ? names.indexOf(String(x).toUpperCase()) : -1; return i >= 0 ? i + 1 : Number(x); };
  for (const part of spec.split(",")) {
    const [r, st] = part.split("/"), step = st ? Number(st) : 1;
    const [a, b] = r === "*" ? [lo, hi] : r.includes("-") ? r.split("-").map(val) : [val(r), st ? hi : val(r)];
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set;
};
const cfRuns = (cron, ms) => { const [mi, h, dom, mo, dw] = cron.trim().split(/\s+/), d = new Date(ms);
  return field(mi, 0, 59).has(d.getUTCMinutes()) && field(h, 0, 23).has(d.getUTCHours()) && field(dom, 1, 31).has(d.getUTCDate())
    && field(mo, 1, 12, MONTHS).has(d.getUTCMonth() + 1) && field(dw, 1, 7, DOW).has(d.getUTCDay() + 1); };
const weekStart = Date.UTC(2026, 10, 15) - IST;   // Sunday 15 Nov 2026, 00:00 IST
const runsOf = (cron) => { const out = []; for (let t = weekStart; t < weekStart + 7 * 86400000; t += 60000) if (cfRuns(cron, t)) out.push(t); return out; };
const istDay = (t) => DOW[new Date(t + IST).getUTCDay()], istHM = (t) => new Date(t + IST).toISOString().slice(11, 16);
const digestRuns = DIGEST_CRON ? runsOf(DIGEST_CRON) : [];
ok("I-06: the digest schedule runs only on Monday (IST), 08:30 to 13:20, every 10 minutes", digestRuns.length === 30 && digestRuns.every((t) => istDay(t) === "MON") && istHM(digestRuns[0]) === "08:30" && istHM(digestRuns[29]) === "13:20",
  { n: digestRuns.length, days: [...new Set(digestRuns.map(istDay))], first: digestRuns[0] && istHM(digestRuns[0]) });
const tatCron = crons.find((c) => c !== DIGEST_CRON && !/^\S+ \* \* \* \*$/.test(c.trim())) || "";
const tatRuns = tatCron ? runsOf(tatCron) : [];
ok("I-06: the TAT reminder schedule runs Monday to Friday at 09:00 and 19:00 IST", tatRuns.length === 10 && [...new Set(tatRuns.map(istDay))].join() === "MON,TUE,WED,THU,FRI" && tatRuns.every((t) => ["09:00", "19:00"].includes(istHM(t))),
  { tatCron, days: [...new Set(tatRuns.map(istDay))], times: [...new Set(tatRuns.map(istHM))] });

// the Worker's own scheduled job at the times Cloudflare would fire it, with a stand-in mail webhook (made-up demo data)
const mails = [];
const fetchMock = async (url, init) => { if (url.includes("mail-hook.test")) { mails.push(JSON.parse(init.body)); return new Response("ok"); } return new Response("{}", { status: 404 }); };
const rig = await makeRig({ envExtra: { EMAIL_PROVIDER: "webhook", EMAIL_WEBHOOK_URL: "https://mail-hook.test/send", EMAIL_API_KEY: "x".repeat(40) }, fetchMock });
await rig.app.seedDemo(() => {});
const fire = async (cron, at) => { const real = Date.now; Date.now = () => at; try { const ps = []; await rig.worker.default.scheduled({ cron, scheduledTime: at }, rig.backend.env, { waitUntil: (p) => ps.push(p) }); await Promise.all(ps); } finally { Date.now = real; } };
const digestMails = () => mails.filter((m) => !/TAT/i.test(m.subject || "")).length;
for (const t of digestRuns) await fire(DIGEST_CRON, t);
ok("I-06: the Monday runs send the week's digest", digestMails() > 0, { mails: mails.length });
mails.length = 0;
await fire(DIGEST_CRON.toLowerCase(), Date.UTC(2026, 10, 23, 3, 10));   // the next Monday, 08:40 IST, written in small letters
ok("I-06: the job knows its schedule however the weekday name is written (mon or MON)", digestMails() > 0, { mails: mails.length });
mails.length = 0;
await fire("17 * * * *", Date.UTC(2026, 10, 30, 3, 17));   // the hourly job, inside a Monday's digest hours
ok("I-06: the hourly job never sends the digest (only the Monday schedule does)", digestMails() === 0, { mails: mails.length });

const fails = results.filter((x) => !x.pass);
console.log("\n==== " + (results.length - fails.length) + " passed, " + fails.length + " failed of " + results.length);
for (const f of fails) console.log("FAILED: [" + f.section + "] " + f.name);
process.exit(fails.length ? 1 : 0);
