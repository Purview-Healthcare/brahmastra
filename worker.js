/* =====================================================================
   Purview Brahmastra API  —  Cloudflare Worker on D1 (SQLite)
   ---------------------------------------------------------------------
   One file, no imports. Deploy it as a Worker named brahmastra-api with:
     • a D1 database bound as   DB
     • (optional) secrets       PEPPER               extra salt for password hashes
                                BOOTSTRAP_EMAIL      first team lead login
                                BOOTSTRAP_PASSWORD   first team lead password
                                ALLOWED_DOMAINS      comma list of domains or patterns, default *purview*
     • email for sign-in codes  EMAIL_PROVIDER       graph | resend | brevo | sendgrid | webhook
                                EMAIL_FROM           "Brahmastra <sender@purview-healthcare.com>"
                                EMAIL_API_KEY        provider key (resend/brevo/sendgrid) or webhook secret
                                MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER   for graph (Microsoft 365, Mail.Send application permission)
                                EMAIL_WEBHOOK_URL    for webhook
   The Worker creates its own tables on the first request, seeds the
   default status/action codes, and creates the first supervisor account
   (supervisor@purview-healthcare.com / brahmastra-setup, forced to change
   the password on first sign-in) when no BOOTSTRAP_* secrets are set.

   The same file runs INSIDE the browser in demo mode (index.html loads it
   with a SQLite-in-the-browser stand-in for D1), so the app can be tried
   with no server at all.

   Protocol: POST /api  {"op": "...", "payload": {...}}  with
             Authorization: Bearer <token> after auth.login.
   ===================================================================== */

const VERSION = "2.9.0";
const SESSION_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PEPPER = "brahmastra-change-this-pepper";
const DEFAULT_BOOTSTRAP_EMAIL = "supervisor@purview-healthcare.com";
const DEFAULT_BOOTSTRAP_PASSWORD = "brahmastra-setup";
const WORKABLE = "('open','assigned','in_progress','completed')";

/* ---------------------------------------------------------------- schema */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user',
     pass_salt TEXT NOT NULL DEFAULT '', pass_hash TEXT NOT NULL DEFAULT '', must_change INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1, capacity INTEGER NOT NULL DEFAULT 35, created_at INTEGER NOT NULL, last_login INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
     follow_up_days INTEGER NOT NULL DEFAULT 30, created_by TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_locations_client ON locations (client_id)`,
  `CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT, kind TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '',
     uploaded_by TEXT NOT NULL, uploaded_at INTEGER NOT NULL, rows_read INTEGER NOT NULL DEFAULT 0, inserted INTEGER NOT NULL DEFAULT 0,
     updated INTEGER NOT NULL DEFAULT 0, reopened INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0,
     skipped INTEGER NOT NULL DEFAULT 0, undone_at INTEGER, summary_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS idx_batches_client ON batches (client_id, uploaded_at)`,
  `CREATE TABLE IF NOT EXISTS claims (
     id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT, batch_id TEXT, first_batch_id TEXT, match_key TEXT NOT NULL,
     claim_no TEXT NOT NULL DEFAULT '', account_no TEXT NOT NULL DEFAULT '', patient TEXT NOT NULL DEFAULT '', payer TEXT NOT NULL DEFAULT '',
     dos TEXT NOT NULL DEFAULT '', cpt TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', billed REAL, balance REAL NOT NULL DEFAULT 0,
     lines INTEGER NOT NULL DEFAULT 1, lines_json TEXT NOT NULL DEFAULT '[]', age_days INTEGER, bucket TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT '',
     status_class TEXT NOT NULL DEFAULT 'unknown', file_status TEXT NOT NULL DEFAULT '', file_sub_status TEXT NOT NULL DEFAULT '', file_action TEXT NOT NULL DEFAULT '',
     file_comments TEXT NOT NULL DEFAULT '', file_bucket TEXT NOT NULL DEFAULT '', inventory_kind TEXT NOT NULL DEFAULT 'fresh', worked_before INTEGER NOT NULL DEFAULT 0,
     last_worked_on TEXT NOT NULL DEFAULT '', follow_up_on TEXT NOT NULL DEFAULT '', priority REAL NOT NULL DEFAULT 0, priority_reason TEXT NOT NULL DEFAULT '',
     state TEXT NOT NULL DEFAULT 'open', state_reason TEXT NOT NULL DEFAULT '', assigned_to TEXT, assigned_at INTEGER, started_at INTEGER, completed_at INTEGER,
     skips INTEGER NOT NULL DEFAULT 0, skipped_at INTEGER, escalated INTEGER NOT NULL DEFAULT 0, touches INTEGER NOT NULL DEFAULT 0,
     last_status_code TEXT NOT NULL DEFAULT '', last_action_code TEXT NOT NULL DEFAULT '', last_note TEXT NOT NULL DEFAULT '', last_worked_by TEXT,
     last_sub_status TEXT NOT NULL DEFAULT '', last_bucket TEXT NOT NULL DEFAULT '', last_effective TEXT NOT NULL DEFAULT '', last_note_action TEXT NOT NULL DEFAULT '',
     raw_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     UNIQUE (client_id, match_key))`,
  `CREATE INDEX IF NOT EXISTS idx_claims_queue ON claims (assigned_to, state, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_client_state ON claims (client_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_first_batch ON claims (first_batch_id)`,
  `CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT 'work', status_code TEXT NOT NULL DEFAULT '', action_code TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
     follow_up_on TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT '', sub_status TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', bucket TEXT NOT NULL DEFAULT '', effective TEXT NOT NULL DEFAULT '',
     note_action TEXT NOT NULL DEFAULT '', fields_json TEXT NOT NULL DEFAULT '{}', edited_at INTEGER, edited_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_claim ON notes (claim_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '',
     name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, parts INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_claim ON attachments (claim_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS attachment_parts (attachment_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (attachment_id, seq))`,
  `CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
     resolves INTEGER NOT NULL DEFAULT 0, follow_up_days INTEGER, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, UNIQUE (kind, code))`,
  `CREATE TABLE IF NOT EXISTS allocations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT, by_user TEXT NOT NULL, at INTEGER NOT NULL,
     strategy TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0, summary_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS otps (id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'login', data_json TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_otps_email ON otps (email, created_at)`,
  `CREATE TABLE IF NOT EXISTS claim_events (id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, at INTEGER NOT NULL, user_id TEXT, user_name TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE INDEX IF NOT EXISTS idx_claim_events_claim ON claim_events (claim_id, at)`,
  `CREATE TABLE IF NOT EXISTS availability (client_id TEXT NOT NULL, day TEXT NOT NULL, on_json TEXT NOT NULL DEFAULT '[]', by_user TEXT, at INTEGER NOT NULL, PRIMARY KEY (client_id, day))`,
];

/* Columns added after the first release. ensureReady() adds any that an
   existing database is missing, so upgrades need no manual migration. */
const EXTRA_COLUMNS = {
  notes: [["status", "TEXT NOT NULL DEFAULT ''"], ["sub_status", "TEXT NOT NULL DEFAULT ''"], ["action", "TEXT NOT NULL DEFAULT ''"], ["bucket", "TEXT NOT NULL DEFAULT ''"],
    ["effective", "TEXT NOT NULL DEFAULT ''"], ["note_action", "TEXT NOT NULL DEFAULT ''"], ["fields_json", "TEXT NOT NULL DEFAULT '{}'"], ["edited_at", "INTEGER"], ["edited_by", "TEXT"]],
  claims: [["last_sub_status", "TEXT NOT NULL DEFAULT ''"], ["last_bucket", "TEXT NOT NULL DEFAULT ''"], ["last_effective", "TEXT NOT NULL DEFAULT ''"], ["last_note_action", "TEXT NOT NULL DEFAULT ''"],
    ["alt_key", "TEXT NOT NULL DEFAULT ''"], ["fp_key", "TEXT NOT NULL DEFAULT ''"],
    // Escalations: when the biller flagged it, and when / by whom a team lead answered.
    ["escalated_at", "INTEGER"], ["escalated_by", "TEXT"], ["escalation_answered_at", "INTEGER"], ["escalation_answered_by", "TEXT"]],
  locations: [["team_json", "TEXT NOT NULL DEFAULT '[]'"], ["auto_allocate", "INTEGER NOT NULL DEFAULT 1"], ["workbook_link", "TEXT NOT NULL DEFAULT ''"]],
  clients: [["team_json", "TEXT NOT NULL DEFAULT '[]'"], ["auto_allocate", "INTEGER NOT NULL DEFAULT 1"], ["workbook_link", "TEXT NOT NULL DEFAULT ''"],
    ["roster_names_json", "TEXT NOT NULL DEFAULT '[]'"], ["caps_json", "TEXT NOT NULL DEFAULT '{}'"]],
  batches: [["source", "TEXT NOT NULL DEFAULT 'file'"], ["web_url", "TEXT NOT NULL DEFAULT ''"]],
  users: [["first_name", "TEXT NOT NULL DEFAULT ''"], ["last_name", "TEXT NOT NULL DEFAULT ''"], ["designation", "TEXT NOT NULL DEFAULT ''"],
    // From the Purview Shastra roster (source = 'roster'); people added by hand keep source = 'manual'.
    ["source", "TEXT NOT NULL DEFAULT 'manual'"], ["emp_id", "TEXT NOT NULL DEFAULT ''"], ["position", "TEXT NOT NULL DEFAULT ''"], ["roster_kind", "TEXT NOT NULL DEFAULT ''"],
    ["department", "TEXT NOT NULL DEFAULT ''"], ["departments_also", "TEXT NOT NULL DEFAULT ''"], ["roster_status", "TEXT NOT NULL DEFAULT ''"], ["exit_date", "TEXT NOT NULL DEFAULT ''"],
    ["reports_to", "TEXT"], ["reports_to_name", "TEXT NOT NULL DEFAULT ''"], ["projects_json", "TEXT NOT NULL DEFAULT '[]'"], ["scope_projects_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["access_all", "INTEGER NOT NULL DEFAULT 0"], ["email_missing", "INTEGER NOT NULL DEFAULT 0"], ["shift", "TEXT NOT NULL DEFAULT ''"], ["city", "TEXT NOT NULL DEFAULT ''"]],
  sessions: [["via", "TEXT NOT NULL DEFAULT 'password'"]],
  settings: [["updated_at", "INTEGER"]],
};
const DESIGNATIONS = ["Biller", "Sr Biller", "SME", "TL", "Sr TL", "Assistant Manager", "Manager", "Sr Manager"];
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_TRIES = 5;
/* Files attached to a claim are kept in D1 as base64, split into parts that stay well under D1's row size limit. */
const ATTACH_MAX_BYTES = 8 * 1024 * 1024;
const ATTACH_PART_CHARS = 512 * 1024;

/* ---- email: one-time codes go out through whichever provider the Worker is configured with ----
   EMAIL_PROVIDER = resend | brevo | sendgrid | graph | webhook, with EMAIL_API_KEY and EMAIL_FROM ("Brahmastra <no-reply@purview-healthcare.com>").
   graph   = Microsoft 365 via the app registration: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET (Mail.Send application permission), MS_SENDER (mailbox to send from).
   webhook = POST {secret, to, subject, text, html} to EMAIL_WEBHOOK_URL (for a Google Apps Script web app like Gurukul's).
   In demo mode (no provider) the code is shown on screen instead. */
function splitFrom(from) { const m = String(from || "").match(/^\s*(.*?)\s*<([^>]+)>\s*$/); return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { name: "Brahmastra", email: String(from || "").trim() }; }
async function sendEmail(env, { to, subject, text, html }) {
  const provider = String(env.EMAIL_PROVIDER || "").toLowerCase().trim();
  if (!provider) throw new ApiError(503, "Email is not set up on the server yet (EMAIL_PROVIDER). A team lead can give you a sign-in code from the Team screen instead.");
  const from = splitFrom(env.EMAIL_FROM || "Brahmastra <no-reply@purview-healthcare.com>");
  const fail = async (r, who) => { let t = ""; try { t = (await r.text()).slice(0, 300); } catch {} throw new ApiError(502, `${who} did not accept the email (${r.status}${t ? ": " + t : ""}).`); };
  if (provider === "resend") {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.EMAIL_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, text, html }) });
    if (!r.ok) await fail(r, "Resend");
  } else if (provider === "brevo") {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.EMAIL_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ sender: { name: from.name, email: from.email }, to: [{ email: to }], subject, textContent: text, htmlContent: html }) });
    if (!r.ok) await fail(r, "Brevo");
  } else if (provider === "sendgrid") {
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", { method: "POST", headers: { Authorization: "Bearer " + env.EMAIL_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from.email, name: from.name }, subject, content: [{ type: "text/plain", value: text }, { type: "text/html", value: html }] }) });
    if (!r.ok) await fail(r, "SendGrid");
  } else if (provider === "graph") {
    const tr = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID || "")}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.MS_CLIENT_ID || "", client_secret: env.MS_CLIENT_SECRET || "", scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
    if (!tr.ok) await fail(tr, "Microsoft sign-in (token)");
    const tok = (await tr.json()).access_token;
    const sender = env.MS_SENDER || from.email;
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: false }) });
    if (!r.ok) await fail(r, "Microsoft Graph");
  } else if (provider === "webhook") {
    const r = await fetch(env.EMAIL_WEBHOOK_URL || "", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: env.EMAIL_API_KEY || "", to, subject, text, html }) });
    if (!r.ok) await fail(r, "The email webhook");
  } else throw new ApiError(503, "Unknown EMAIL_PROVIDER '" + provider + "'. Use resend, brevo, sendgrid, graph or webhook.");
}
/* ---- billers' work written into an Excel workbook in OneDrive ----
   A team lead pastes the workbook's sharing link on the client or location. The Worker (not the biller, who has
   no OneDrive access) appends one row per saved entry using the same Microsoft 365 app registration that sends
   the sign-in codes, which therefore also needs the Files.ReadWrite.All application permission. */
/* The Production Conso format: one row per entry, same columns as the team's consolidation workbook. */
const WORKBOOK_HEADER = ["Sr. No", "Location", "Project", "Practice", "Uni", "IG Claim ID#/Charge ID#", "Patient Name", "DOS", "Payer", "Age", "Bucket", "Billed Amount($)", "Balance Amount($)", "CPT",
  "Comments/Notes", "Status", "Sub Status", "Action", "Bucket", "Mode of Work", "Start Time", "End Time", "Total Duration", "Date Worked", "Emp. ID", "Associate Name", "Status", "Errors", "Team Lead", "Date Range", "Week"];
const SR_NO = "__SR_NO__";
const excelSerial = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return ""; const [y, m, d] = iso.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const AGE_LETTER = [[30, "A: 0-30 Days"], [60, "B: 31-60 Days"], [90, "C: 61-90 Days"], [120, "D: 91-120 Days"], [180, "E: 121-180 Days"], [360, "F: 181-360 Days"]];
const ageBucketLetter = (age) => { if (age == null || age === "") return ""; for (const [max, label] of AGE_LETTER) if (age <= max) return label; return "G: 360 plus"; };
const IST_MIN = 330;
const istDate = (ms) => new Date(ms + IST_MIN * 60000);
const istISO = (ms) => istDate(ms).toISOString().slice(0, 10);
const istHM = (ms) => (ms ? istDate(ms).toISOString().slice(11, 16) : "");
const mdy = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
/* Week ending Saturday; the range starts on the Sunday before, clamped to the 1st when the week crosses a month. */
function weekOf(ms) {
  const d = istDate(ms);
  const we = new Date(d); we.setUTCDate(we.getUTCDate() + ((6 - we.getUTCDay()) % 7));
  const start = new Date(we); start.setUTCDate(start.getUTCDate() - 6);
  const first = new Date(Date.UTC(we.getUTCFullYear(), we.getUTCMonth(), 1));
  const from = start < first ? first : start;
  const iso = (x) => x.toISOString().slice(0, 10);
  return { range: mdy(iso(from)) + " - " + mdy(iso(we)), week: "WE-" + mdy(iso(we)) };
}
function productionRow(c, by, extra) {
  const now = (extra && extra.ended_at) || Date.now();
  const started = extra && extra.started_at;
  const mins = started && now > started ? Math.round((now - started) / 60000) : null;
  const wk = weekOf(now);
  const dosSerial = excelSerial(c.dos);
  return [SR_NO, (by && by.city) || "", c.client_name || "", c.location_name || "",
    [c.patient, dosSerial, c.payer, c.cpt].map((x) => (x == null ? "" : x)).join(""), c.claim_no || "", c.patient || "", dosSerial === "" ? (c.dos || "") : dosSerial, c.payer || "",
    c.age_days == null ? "" : c.age_days, ageBucketLetter(c.age_days), c.billed == null ? "" : Number(c.billed), Number(c.balance) || 0, c.cpt || "",
    c.last_note || "", c.last_status_code || "", c.last_sub_status || "", c.last_action_code || "", c.last_bucket || "", "",
    istHM(started), started ? istHM(now) : "", mins == null ? "" : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`, excelSerial(istISO(now)),
    (by && by.emp_id) || "", (by && by.name) || "", "Production", "", (by && by.reports_to_name) || "", wk.range, wk.week];
}
function workbookLinkOf(v) { if (v == null) return null; const s = str(v, 1000).trim(); if (!s) return ""; if (!/^https:\/\//i.test(s)) throw bad("Paste the whole OneDrive link, starting with https://"); return s; }
const shareIdOf = (link) => "u!" + btoa(unescape(encodeURIComponent(link))).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
async function graphAppToken(env) {
  if (!env.MS_TENANT_ID || !env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) throw new ApiError(503, "Microsoft 365 is not set up on the server (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).");
  const tr = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MS_TENANT_ID)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }) });
  if (!tr.ok) throw new ApiError(502, "Microsoft sign-in (token) did not accept (" + tr.status + ").");
  return (await tr.json()).access_token;
}
async function graphCall(tok, method, path, body) {
  const r = await fetch("https://graph.microsoft.com/v1.0" + path, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body == null ? undefined : JSON.stringify(body) });
  if (!r.ok) { let t = ""; try { t = (await r.text()).slice(0, 240); } catch {} throw new ApiError(502, `Microsoft Graph ${method} ${path.split("?")[0].slice(0, 80)} failed (${r.status}${t ? ": " + t : ""})`); }
  if (r.status === 204) return null;
  return r.json();
}
const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
/* Append one row to the first worksheet of the workbook behind a sharing link. Writes the header into an empty sheet first. */
async function appendWorkbookRow(env, link, values) {
  const tok = await graphAppToken(env);
  const key = "wb:" + (await sha256Hex(link)).slice(0, 24);
  let loc = null; const cached = await one(env, "SELECT value_json FROM settings WHERE key = ?", key);
  if (cached) { try { loc = JSON.parse(cached.value_json); } catch {} }
  if (!loc || !loc.driveId) {
    const it = await graphCall(tok, "GET", "/shares/" + shareIdOf(link) + "/driveItem?$select=id,name,parentReference,file");
    if (!it.file || !/\.xlsx$/i.test(it.name || "")) throw new ApiError(400, "The link must point to an Excel workbook (.xlsx), not a folder or another file type.");
    loc = { driveId: it.parentReference.driveId, itemId: it.id, name: it.name };
    await run(env, "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?,?,?)", key, JSON.stringify(loc), Date.now());
  }
  const base = `/drives/${encodeURIComponent(loc.driveId)}/items/${encodeURIComponent(loc.itemId)}/workbook`;
  const sheets = await graphCall(tok, "GET", base + "/worksheets?$top=1&$select=id,name");
  const sheet = sheets.value && sheets.value[0]; if (!sheet) throw new ApiError(400, "The workbook has no worksheet.");
  const ws = base + "/worksheets/" + encodeURIComponent(sheet.id);
  const used = await graphCall(tok, "GET", ws + "/usedRange(valuesOnly=true)?$select=rowCount,address,values");
  const empty = !used || used.rowCount <= 1 && (!used.values || !used.values[0] || used.values[0].every((v) => v === "" || v == null));
  let rows = empty ? [WORKBOOK_HEADER, values] : [values];
  const startRow = empty ? 1 : (parseInt(String(used.address).replace(/^.*![A-Z]+\d+:?[A-Z]*/, "").replace(/\D/g, ""), 10) || used.rowCount) + 1;
  // Sr. No = the row's own number in the sheet (header is row 1).
  const srOf = (sheetRow) => sheetRow - 1;
  rows = rows.map((r, i) => r.map((v) => (v === SR_NO ? srOf(startRow + i) : v)));
  const last = colLetter(WORKBOOK_HEADER.length);
  await graphCall(tok, "PATCH", ws + `/range(address='A${startRow}:${last}${startRow + rows.length - 1}')`, { values: rows });
  return loc.name;
}
async function recordWorkbookStatus(env, targetId, status) {
  await run(env, "INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?,?,?)", "workbook_status:" + targetId, JSON.stringify(status), Date.now());
}
/* Fire-and-forget after a save: find the workbook (location first, then client) and append the entry. */
async function syncEntryToWorkbook(env, claimId, by, extra) {
  const c = await one(env, `SELECT c.*, cl.name AS client_name, cl.workbook_link AS client_link, l.name AS location_name, l.workbook_link AS location_link
      FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE c.id = ?`, claimId);
  if (!c) return;
  const link = c.location_link || c.client_link; if (!link) return;
  const targetId = c.location_link ? c.location_id : c.client_id;
  const row = productionRow(c, by, extra);
  try { const name = await appendWorkbookRow(env, link, row); await recordWorkbookStatus(env, targetId, { ok: true, at: Date.now(), file: name, claim_no: c.claim_no }); }
  catch (e) { await recordWorkbookStatus(env, targetId, { ok: false, at: Date.now(), error: String(e && e.message || e).slice(0, 300), claim_no: c.claim_no }); }
}
const otpCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };
const otpHash = (env, email, code) => sha256Hex(`otp:${email}:${code}:${env.PEPPER || DEFAULT_PEPPER}`);
async function issueOtp(env, email, purpose, data, { byTeamLead = false } = {}) {
  const now = Date.now();
  const recent = await one(env, "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM otps WHERE email = ? AND created_at > ?", email, now - 3600000);
  // The 45-second pause protects the mailbox; a team lead reading the code off the screen does not need it.
  if (!byTeamLead && recent && recent.last && now - recent.last < 45000) throw new ApiError(429, "A code was sent less than a minute ago. Check your inbox (and spam), then try again.");
  if (recent && recent.n >= 10) throw new ApiError(429, "Too many codes requested for this email in the last hour. Try again later.");
  const code = otpCode();
  await env.DB.batch([
    env.DB.prepare("UPDATE otps SET consumed = 1 WHERE email = ? AND consumed = 0").bind(email),
    env.DB.prepare("INSERT INTO otps (id, email, code_hash, purpose, data_json, created_at, expires_at) VALUES (?,?,?,?,?,?,?)").bind(uuid(), email, await otpHash(env, email, code), purpose, JSON.stringify(data || {}), now, now + OTP_TTL_MS),
    env.DB.prepare("DELETE FROM otps WHERE expires_at < ?").bind(now - 86400000),
  ]);
  return code;
}
async function deliverOtp(env, email, code, purpose) {
  const what = purpose === "signup" ? "finish creating your Brahmastra account" : "sign in to Brahmastra";
  const text = `Your Brahmastra code is ${code}. Use it within 10 minutes to ${what}. If you did not ask for it, ignore this email.`;
  const html = `<div style="font-family:Inter,Segoe UI,sans-serif;font-size:15px;color:#0A0E24"><p>Your Brahmastra code is</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">${code}</p><p>Use it within 10 minutes to ${what}. If you did not ask for it, ignore this email.</p><p style="color:#5A6178;font-size:12px">Purview Brahmastra</p></div>`;
  if (env.DEMO && !env.EMAIL_PROVIDER) return { sent: false, demo_code: code };
  await sendEmail(env, { to: email, subject: `Your Brahmastra code: ${code}`, text, html });
  return { sent: true };
}
async function checkOtp(env, email, code) {
  const now = Date.now();
  const row = await one(env, "SELECT * FROM otps WHERE email = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1", email);
  if (!row || row.expires_at < now) throw new ApiError(401, "That code has expired or was never sent. Request a new one.");
  const ok = sameHash(await otpHash(env, email, String(code || "").replace(/\s/g, "")), row.code_hash);
  if (!ok) {
    const tries = row.tries + 1;
    await run(env, "UPDATE otps SET tries = ?, consumed = CASE WHEN ? >= ? THEN 1 ELSE consumed END WHERE id = ?", tries, tries, OTP_MAX_TRIES, row.id);
    throw new ApiError(401, tries >= OTP_MAX_TRIES ? "Too many wrong codes. Request a new one." : "That code doesn't match. Check the latest email and try again.");
  }
  await run(env, "UPDATE otps SET consumed = 1 WHERE id = ?", row.id);
  let data = {}; try { data = JSON.parse(row.data_json || "{}"); } catch {}
  return { purpose: row.purpose, data };
}
async function openSession(env, u, via) {
  const now = Date.now();
  const token = randomHex(24);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at, via) VALUES (?,?,?,?,?)").bind(token, u.id, now, now + SESSION_MS, via),
    env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(now, u.id),
  ]);
  return { token, user: publicUser({ ...u, last_login: now, via }) };
}
const fullName = (first, last, fallback) => [first, last].map((s) => String(s || "").trim()).filter(Boolean).join(" ") || fallback || "";
const parseTeam = (s) => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.map((x) => String(x)).slice(0, 100) : []; } catch { return []; } };

/* ---- the SAAG entry and the standard note ----
   A worked claim carries a SAAG selection (Status > Sub-status > Action, with
   the Effective Matrix the workbook maps it to) plus a bucket, and a note in
   the team's fixed format. The note is stored as ONE cell (comment) in that
   format, with the individual fields kept in fields_json for the screens. */
const NOTE_ACTIONS = ["corrected & resubmitted", "appeal filed", "pending with client", "pending with patient", "pending with payer", "follow up", "closed"];
const NOTE_SOURCES = ["Call", "Portal", "IVR", "EOB/ERA", "Email", "Clearinghouse", "Client", "Other"];
const BUCKETS4 = ["Payer", "Client", "Closed", "Purview"];
const CLOSED_EFFECTIVE = /^(processing-closed|payment-cash in bank)$/i;
const EFFECTIVE_DAYS = { "Pending-Collectible Insurance": 30, "Pending-Client Assistance": 14, "Pending-Collectible Patient": 30, "Pending-Purview internal review": 7 };
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const mmdd = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : (iso || ""));
function cleanNoteFields(f, claim) {
  f = f || {};
  const t = (v, n = 400) => str(v, n).replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
  const pre = Array.isArray(f.precheck) ? f.precheck.map((x) => t(x, 80)).filter(Boolean).slice(0, 12) : [];
  const action = String(f.action || "").toLowerCase().trim();
  return {
    dos: mmdd(isoDate(f.dos) || claim.dos) || t(f.dos, 20), clm: t(f.clm || claim.claim_no, 80), denial: t(f.denial, 200),
    source: NOTE_SOURCES.includes(f.source) ? f.source : t(f.source, 40), ref: t(f.ref, 80),
    precheck: pre, precheck_text: t(f.precheck_text, 300), findings: t(f.findings, 2000), action: NOTE_ACTIONS.includes(action) ? action : t(f.action, 120),
  };
}
function composeNote(fields, saag, followUp) {
  const parts = [
    `DOS: ${fields.dos || "-"}`, `CLM#: ${fields.clm || "-"}`, `DENIAL: ${fields.denial || "-"}`,
    `SOURCE: ${fields.source || "-"}${fields.ref ? ", REF: " + fields.ref : (fields.source === "Call" ? ", REF: none" : "")}`,
    `PRE CALL CHECK: ${[...(fields.precheck || []), fields.precheck_text].filter(Boolean).join("; ") || "-"}`,
    `RCA/FINDINGS: ${fields.findings || "-"}`, `ACTION: ${fields.action || "-"}`,
    ...(saag ? [`SAAG: ${saag.status} > ${saag.sub_status} > ${saag.action}`, `BUCKET: ${saag.bucket}`, `EFFECTIVE: ${saag.effective || "-"}`] : []),
  ];
  if (followUp) parts.push(`FOLLOW-UP: ${mmdd(followUp)}`);
  return parts.join(" | ");
}
function validateWork(payload) {
  const s = payload.saag || {};
  const saag = { status: str(s.status, 60).trim(), sub_status: str(s.sub_status, 160).trim(), action: str(s.action, 160).trim(), bucket: str(s.bucket, 20).trim(), effective: str(s.effective, 80).trim() };
  if (!saag.status || !saag.sub_status || !saag.action) throw bad("Pick the SAAG status, sub-status and action.");
  if (!BUCKETS4.includes(saag.bucket)) throw bad("Pick a bucket: Payer, Client, Closed or Purview.");
  const f = payload.note || {};
  if (!commentOk(f.findings)) throw bad("Write what you found (RCA / findings), a few words at least.");
  if (!String(f.action || "").trim()) throw bad("Pick the note ACTION from the list, or type it under Other.");
  if (f.source === "Call" && !String(f.ref || "").trim()) throw bad("A call needs its reference number (REF).");
  return saag;
}
/* Entries that say an EOB is in hand, ask for posting, or file an appeal / reconsideration must carry the document:
   a file attached to the claim since its last work entry. Keep in step with ATTACH_RULE in index.html. */
const ATTACH_SUBS = /^(EOB Available|Claim Applied Towards Offset\(EOB Available\)|POTF available)$/i;
const ATTACH_ACTIONS = /^(Need to Post\/Posting Correction|Need to Appeal|Need to Appeal Mail|Appeal Sent|Paper Appeal|PLSAPPEAL|Recon\/Appeal In Process)$/i;
function attachNeeded(saag, fields) {
  if (ATTACH_SUBS.test(saag.sub_status)) return saag.sub_status;
  if (ATTACH_ACTIONS.test(saag.action)) return saag.action;
  if (fields && fields.action === "appeal filed") return "appeal filed";
  return "";
}
async function requireAttachment(env, claimId, saag, fields, since) {
  const why = attachNeeded(saag, fields);
  if (!why) return;
  const a = await one(env, "SELECT id FROM attachments WHERE claim_id = ? AND created_at > ? LIMIT 1", claimId, since || 0);
  if (!a) throw bad(`"${why}" needs the document attached (EOB, appeal or reconsideration letter). Attach it under RCA / findings, then save.`);
}
/* One line in a claim's timeline (assigned, opened, skipped, refreshed from a file, state changed, worked with what changed). */
const claimEvent = (env, claimId, user, kind, text, data) =>
  env.DB.prepare("INSERT INTO claim_events (id, claim_id, at, user_id, user_name, kind, text, data_json) VALUES (?,?,?,?,?,?,?,?)")
    .bind(uuid(), claimId, Date.now(), user ? user.id : null, user ? user.name || "" : "", kind, str(text, 500), JSON.stringify(data || {}));
const isClosedWork = (saag, fields) => saag.bucket === "Closed" || CLOSED_EFFECTIVE.test(saag.effective) || fields.action === "closed";
const followUpDays = (effective, clientDays) => EFFECTIVE_DAYS[effective] || clientDays || 30;
const noteFields = (n) => { let f = {}; try { f = JSON.parse(n.fields_json || "{}"); } catch {} return f; };

/* ------------------------------------------------------------- helpers */
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new ApiError(400, m);
const denied = (m) => new ApiError(403, m || "Not allowed.");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : randomHex(16));
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const isHash = (h) => /^[0-9a-f]{64}$/i.test(String(h || ""));
const hashWith = (salt, passHash, pepper) => sha256Hex(`${salt}:${String(passHash).toLowerCase()}:${pepper}`);
async function makeHash(env, salt, passHash) { return hashWith(salt, passHash, env.PEPPER || DEFAULT_PEPPER); }
/* True when the password matches. Accounts created before the PEPPER secret
   was set (hashed with the built-in default) still work: their hash is
   upgraded to the current PEPPER on the spot, so adding PEPPER later never
   locks anyone out. */
async function passwordOk(env, u, passHash) {
  if (!u || !u.pass_hash || !isHash(passHash)) return false;
  if (sameHash(await makeHash(env, u.pass_salt, passHash), u.pass_hash)) return true;
  if (!env.PEPPER || env.PEPPER === DEFAULT_PEPPER) return false;
  if (!sameHash(await hashWith(u.pass_salt, passHash, DEFAULT_PEPPER), u.pass_hash)) return false;
  await run(env, "UPDATE users SET pass_hash = ? WHERE id = ?", await makeHash(env, u.pass_salt, passHash), u.id);
  return true;
}
function sameHash(a, b) { // constant time
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const mailClean = (e) => String(e || "").trim().toLowerCase();
const mailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const str = (v, max = 4000) => (v == null ? "" : String(v)).slice(0, max);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
function isoToday() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return t.toISOString().slice(0, 10);
}
function commentOk(t) {
  const s = String(t || "").trim();
  if (s.length < 8) return false;
  const words = s.split(/\s+/).filter((w) => w.length >= 2);
  return words.length >= 2 && /[a-zA-Z]/.test(s);
}
const jsonList = (s) => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };
const jsonObj = (s) => { try { const o = JSON.parse(s || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; } };
/* An admin is a team lead with every right, so the screens treat role "admin" as "supervisor" plus is_admin. */
const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, first_name: u.first_name || "", last_name: u.last_name || "", designation: u.designation || "", role: u.role === "admin" ? "supervisor" : u.role, is_admin: u.role === "admin", active: !!u.active, capacity: u.capacity,
  must_change: !!u.must_change, has_password: !!u.pass_hash, via: u.via || undefined, created_at: u.created_at, last_login: u.last_login,
  source: u.source || "manual", emp_id: u.emp_id || "", position: u.position || "", roster_kind: u.roster_kind || "", department: u.department || "", departments_also: u.departments_also || "",
  roster_status: u.roster_status || "", exit_date: u.exit_date || "", reports_to: u.reports_to || null, reports_to_name: u.reports_to_name || "", projects: jsonList(u.projects_json),
  scope_projects: jsonList(u.scope_projects_json), access_all: !!u.access_all, email_missing: !!u.email_missing, shift: u.shift || "", city: u.city || "" });

const one = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).first();
const all = async (env, sql, ...p) => (await env.DB.prepare(sql).bind(...p).all()).results || [];
const run = (env, sql, ...p) => env.DB.prepare(sql).bind(...p).run();
const changesOf = (r) => (r && r.meta && Number(r.meta.changes)) || 0;
async function batchAll(env, stmts, size = 50) {
  const out = [];
  for (const c of chunks(stmts, size)) out.push(...(await env.DB.batch(c)));
  return out;
}

/* --------------------------------------------------------- first run */
let READY = null, READY_DB = null;
function ensureReady(env) {
  // Demo mode swaps the database on "Reset demo data": a new DB object means the tables must be made again.
  if (READY && (!env.DEMO || READY_DB === env.DB)) return READY;
  READY_DB = env.DB;
  READY = (async () => {
    await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
    // Add the columns introduced after the first release BEFORE anything is
    // inserted: the bootstrap row below already uses them.
    for (const table of Object.keys(EXTRA_COLUMNS)) {
      const have = new Set((await all(env, `PRAGMA table_info(${table})`)).map((r) => r.name));
      for (const [name, def] of EXTRA_COLUMNS[table]) if (!have.has(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
    }
    await env.DB.batch([
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_claims_alt ON claims (client_id, alt_key)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_claims_fp ON claims (client_id, fp_key)"),
    ]);
    await backfillKeys(env);
    await run(env, "UPDATE claims SET escalated_at = COALESCE(completed_at, updated_at), escalated_by = last_worked_by WHERE escalated = 1 AND escalated_at IS NULL");
    const users = await one(env, "SELECT COUNT(*) AS n FROM users");
    if (!users || !users.n) {
      const email = mailClean(env.BOOTSTRAP_EMAIL || DEFAULT_BOOTSTRAP_EMAIL);
      const password = env.BOOTSTRAP_PASSWORD || DEFAULT_BOOTSTRAP_PASSWORD;
      const salt = randomHex(16);
      const hash = await makeHash(env, salt, await sha256Hex(password));
      await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        uuid(), email, "Supervisor", "Supervisor", "", "TL", "supervisor", salt, hash, env.BOOTSTRAP_PASSWORD ? 0 : 1, 1, 35, Date.now());
    }
    // Admin accounts named in ADMIN_EMAILS (wrangler.toml): created on first run, kept as admin. They sign in with a code.
    for (const email of adminEmails(env)) {
      const ex = await one(env, "SELECT id, role FROM users WHERE email = ?", email);
      if (!ex) await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,'admin','','',0,1,35,?)", uuid(), email, "Admin", "Admin", "", "Admin", Date.now());
      else if (ex.role !== "admin") await run(env, "UPDATE users SET role = 'admin', active = 1 WHERE id = ?", ex.id);
    }
  })().catch((e) => { READY = null; throw e; });
  return READY;
}

/* ------------------------------------------------------------- auth */
async function userFromToken(env, token) {
  if (!token) return null;
  const row = await one(env, "SELECT s.expires_at AS s_exp, s.via AS s_via, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", token);
  if (!row) return null;
  const now = Date.now();
  if (row.s_exp < now || !row.active) { await run(env, "DELETE FROM sessions WHERE token = ?", token); return null; }
  if (row.s_exp - now < SESSION_MS / 2) await run(env, "UPDATE sessions SET expires_at = ? WHERE token = ?", now + SESSION_MS, token);
  return publicUser({ ...row, via: row.s_via || "password" });
}
/* Allowed email domains. Entries can be exact (purview-healthcare.com), a suffix (*.purview-healthcare.com)
   or a contains-pattern (*purview*). The default lets in any domain with "purview" in it. */
function allowedDomains(env) {
  const list = String(env.ALLOWED_DOMAINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : ["*purview*"];
}
function domainMatches(pattern, domain) {
  if (pattern === "*") return true;
  if (pattern.startsWith("*") && pattern.endsWith("*") && pattern.length > 2) return domain.includes(pattern.slice(1, -1));
  if (pattern.startsWith("*.")) return domain === pattern.slice(2) || domain.endsWith(pattern.slice(1));
  if (pattern.startsWith("*")) return domain.endsWith(pattern.slice(1));
  return domain === pattern;
}
function domainOk(env, email) {
  const domain = String(email || "").toLowerCase().slice(String(email || "").lastIndexOf("@") + 1);
  return allowedDomains(env).some((p) => domainMatches(p, domain));
}

const maskEmail = (e) => { const at = String(e || "").lastIndexOf("@"); return at > 0 ? e[0] + "•••@" + e.slice(at + 1) : ""; };
const adminEmails = (env) => String(env.ADMIN_EMAILS || "").split(",").map(mailClean).filter(mailOk);
async function getSetting(env, key, fallback) { const r = await one(env, "SELECT value_json FROM settings WHERE key = ?", key); if (!r) return fallback; try { return JSON.parse(r.value_json); } catch { return fallback; } }
const setSetting = (env, key, value) => run(env, "INSERT INTO settings (key, value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json", key, JSON.stringify(value));
/* People who came from the roster sign in only with a Purview address, or one the admin has allowed by name (Extra sign-in emails). */
async function signInBlock(env, u) {
  if (u.role === "admin" || u.source !== "roster") return "";
  if (u.email_missing) return "This account has no email address yet. Ask your team lead to add it in Purview Shastra.";
  if (domainOk(env, u.email)) return "";
  const extra = (await getSetting(env, "extra_emails", [])) || [];
  return extra.map(mailClean).includes(mailClean(u.email)) ? "" : "This email is not a Purview address. Ask your admin to allow it, or to set your Purview email in Shastra.";
}

/* ---- who sees which projects ----
   Admins, the VP (access_all) and people added by hand see every client. Everyone else from the roster sees the clients
   their roster projects are matched to: team leads and SMEs their own projects, managers also every project of the people
   under them. user.scope is null (everything) or the list of client ids. */
async function scopeOf(env, user) {
  if (user.role !== "supervisor" || user.is_admin || user.access_all || user.source !== "roster") return null;
  const names = new Set(user.scope_projects.map(projKey));
  const clients = await all(env, "SELECT id, roster_names_json FROM clients");
  return clients.filter((c) => jsonList(c.roster_names_json).some((n) => names.has(projKey(n)))).map((c) => c.id);
}
const projKey = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const inScope = (user, clientId) => !user.scope || user.scope.includes(clientId);
const leadFor = (user, clientId) => user.role === "supervisor" && inScope(user, clientId);
// " AND col IN (...)" for a scoped team lead, "" otherwise; scopeArgs gives the matching parameters.
const scopeSql = (user, col) => (!user || !user.scope ? "" : ` AND ${col} IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`);
const scopeArgs = (user) => (user && user.scope) || [];
const outOfScope = () => denied("That project is not one of yours.");
/* The people a scoped team lead may see and edit: themselves, everyone below them, and everyone on their projects. */
async function visibleUsers(env, user) {
  const users = await all(env, "SELECT * FROM users ORDER BY role DESC, name, email");
  if (!user.scope) return users;
  const names = new Set(user.scope_projects.map(projKey));
  const below = new Set([user.id]);
  for (let grew = true; grew;) { grew = false; for (const u of users) if (u.reports_to && below.has(u.reports_to) && !below.has(u.id)) { below.add(u.id); grew = true; } }
  const teams = new Set();
  for (const c of await all(env, "SELECT team_json FROM clients WHERE id IN (" + (user.scope.length ? user.scope.map(() => "?").join(",") : "NULL") + ")", ...user.scope)) parseTeam(c.team_json).forEach((id) => teams.add(id));
  return users.filter((u) => below.has(u.id) || teams.has(u.id) || jsonList(u.projects_json).some((p) => names.has(projKey(p.name))));
}


/* ---- Purview Shastra roster ----
   Who gets in: Agents (billers), SMEs, Team Leads and Sr Team Leads (team leads for their own projects), Assistant Managers,
   Managers and Sr Managers (team leads for their projects and their people's projects) and the Vice President (every project).
   No access: CEO, Director, HR, IT, Administration, Quality Analysts, MIS, Tech Support, and anyone without a project. */
const ROSTER_KIND = { "agent": "agent", "subject matter expert": "lead", "sme": "lead", "team lead": "lead", "tl": "lead", "senior team lead": "lead", "sr team lead": "lead", "sr tl": "lead",
  "assistant manager": "manager", "manager": "manager", "senior manager": "manager", "sr manager": "manager", "vice president": "all", "vp": "all" };
const ROSTER_DESIGNATION = { "agent": "Biller", "subject matter expert": "SME", "sme": "SME", "team lead": "TL", "tl": "TL", "senior team lead": "Sr TL", "sr team lead": "Sr TL", "sr tl": "Sr TL",
  "assistant manager": "Assistant Manager", "manager": "Manager", "senior manager": "Sr Manager", "sr manager": "Sr Manager", "vice president": "Vice President", "vp": "Vice President" };
const ROSTER_GONE = /^(resigned|exited|left|terminated|absconded|inactive|relieved)$/i;
function rosterDate(v) {
  const t = String(v || "").trim(); if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
function rosterProjects(primary, also) {
  const out = [];
  const add = (name, share) => { name = String(name || "").trim(); if (!name || /^(none|all|n\/a|-)$/i.test(name) || out.some((p) => projKey(p.name) === projKey(name))) return; out.push({ name, share }); };
  add(primary, null);
  String(also || "").split(/[;,]/).forEach((x) => { const m = x.trim().match(/^(.*?)\s*([\d.]+)\s*%$/); if (m) add(m[1], num(m[2], 0)); else add(x, null); });
  return out;
}
// Header names are matched loosely ("Emp ID", "emp_id", "EmpID" all work).
function rosterRow(r) {
  const get = {}; for (const k of Object.keys(r || {})) get[String(k).toLowerCase().replace(/[^a-z]/g, "")] = String(r[k] == null ? "" : r[k]).trim();
  const g = (...keys) => { for (const k of keys) if (get[k]) return get[k]; return ""; };
  return { emp_id: g("empid", "employeeid", "id"), name: g("name", "employeename", "fullname"), hierarchy: g("hierarchy", "level"), position: g("position", "designation", "role"),
    func: g("function"), department: g("department"), departments_also: g("alsoindepartments"), status: g("status"), project: g("project"), also_projects: g("alsoonprojects"),
    reports_to: g("reportsto", "manager"), shift: g("shift"), exit_date: rosterDate(g("exitdate")), email: mailClean(g("email", "emailid", "workemail")),
    city: ((v) => (/pune/i.test(v) ? "Pune" : /hyd/i.test(v) ? "Hyderabad" : v))(g("location", "worklocation", "city", "site", "baselocation")) };
}
function rosterClassify(row) {
  const pos = row.position.toLowerCase().trim();
  const kind = ROSTER_KIND[pos];
  const projects = rosterProjects(row.project, row.also_projects);
  let reason = "";
  if (!row.name) reason = "no name";
  else if (/^administration$/i.test(row.func) || /^(hr|it)$/i.test(row.department)) reason = (row.department || row.func) + " (no access)";
  else if (!kind) reason = (row.position || "no position") + " (no access)";
  else if (kind !== "all" && !projects.length) reason = "no project";
  return { kind, projects, reason, designation: ROSTER_DESIGNATION[pos] || row.position };
}
/* Team leads and SMEs see their own projects; managers also every project of the people below them. */
async function recomputeScopes(env) {
  const users = await all(env, "SELECT id, reports_to, roster_kind, projects_json, scope_projects_json, source, active FROM users");
  const kids = new Map(); for (const u of users) if (u.reports_to) { if (!kids.has(u.reports_to)) kids.set(u.reports_to, []); kids.get(u.reports_to).push(u); }
  const stmts = [];
  for (const u of users) {
    if (u.source !== "roster") continue;
    const set = new Map(); const add = (p) => { const k = projKey(p.name); if (k && !set.has(k)) set.set(k, p.name); };
    jsonList(u.projects_json).forEach(add);
    if (u.roster_kind === "manager") { const seen = new Set([u.id]); const walk = (id) => (kids.get(id) || []).forEach((k) => { if (seen.has(k.id)) return; seen.add(k.id); if (k.active) jsonList(k.projects_json).forEach(add); walk(k.id); }); walk(u.id); }
    const next = JSON.stringify([...set.values()]);
    if (next !== (u.scope_projects_json || "[]")) stmts.push(env.DB.prepare("UPDATE users SET scope_projects_json = ? WHERE id = ?").bind(next, u.id));
  }
  if (stmts.length) await batchAll(env, stmts);
}
/* Brahmastra works AR claims: the roster's AR department (main or "also in"). Posting, Submission, PCC and Eligibility come in later. */
const isAR = (u) => /^ar$/i.test(String(u.department || "").trim()) || String(u.departments_also || "").split(/[;,]/).some((d) => /^ar$/i.test(d.trim()));
/* A client's billers = the people added by hand + every active roster AR Agent on one of its roster projects. */
async function syncTeams(env) {
  const users = await all(env, "SELECT id, source, role, active, projects_json, department, departments_also FROM users");
  const roster = new Set(users.filter((u) => u.source === "roster").map((u) => u.id));
  for (const c of await all(env, "SELECT id, team_json, roster_names_json FROM clients")) {
    const names = new Set(jsonList(c.roster_names_json).map(projKey));
    if (!names.size) continue;
    const keep = parseTeam(c.team_json).filter((id) => !roster.has(id));
    const add = users.filter((u) => u.source === "roster" && u.role === "user" && u.active && isAR(u) && jsonList(u.projects_json).some((p) => names.has(projKey(p.name)))).map((u) => u.id);
    const team = [...new Set([...keep, ...add])].slice(0, 100);
    if (JSON.stringify(team) !== JSON.stringify(parseTeam(c.team_json))) await run(env, "UPDATE clients SET team_json = ? WHERE id = ?", JSON.stringify(team), c.id);
  }
}
async function rosterProjectNames(env) {
  const m = new Map();
  for (const u of await all(env, "SELECT projects_json FROM users WHERE source = 'roster' AND active = 1")) for (const p of jsonList(u.projects_json)) if (!m.has(projKey(p.name))) m.set(projKey(p.name), p.name);
  return [...m.values()].sort((a, b) => a.localeCompare(b));
}
/* A roster project whose name or code matches exactly one client (ignoring case, spaces and punctuation) is matched silently. The rest wait for a team lead. */
async function autoMapProjects(env) {
  const clients = await all(env, "SELECT id, name, code, roster_names_json FROM clients");
  const mapped = new Set(clients.flatMap((c) => jsonList(c.roster_names_json).map(projKey)));
  for (const name of await rosterProjectNames(env)) {
    const k = projKey(name); if (mapped.has(k)) continue;
    const hits = clients.filter((c) => projKey(c.name) === k || (c.code && projKey(c.code) === k));
    if (hits.length !== 1) continue;
    const c = hits[0]; const list = [...jsonList(c.roster_names_json), name];
    c.roster_names_json = JSON.stringify(list); mapped.add(k);
    await run(env, "UPDATE clients SET roster_names_json = ? WHERE id = ?", c.roster_names_json, c.id);
  }
}
async function unassignOpen(env, userId) {
  await run(env, "UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', updated_at = ? WHERE assigned_to = ? AND state IN ('assigned','in_progress')", Date.now(), userId);
}
const placeholderEmail = (row) => (row.emp_id || row.name).toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "") + "@no-email.invalid";

/* --------------------------------------------------------- the ops */
/* ---- how a claim is recognised across uploads ----
   alt_key: the claim number with everything but letters and digits removed, lower case, no leading
            zeros, no Excel ".0" tail. "CLM 0012345", "12345.0" and "clm-12345" all become "clm12345" / "12345".
   fp_key:  patient + date of service, for files that carry no claim number at all. A claim with no number
            is given a generated id "BR-xxxxxxxx" from that fingerprint, so the same patient/DOS maps to
            the same id in every later file. */
function altKeyOf(claimNo) {
  const raw = String(claimNo || "").trim().toLowerCase().replace(/\.0+$/, "");
  // The longest run of digits is the claim number itself ("CLM 0012345", "12345/1" and "12345" agree); shorter ids keep their letters.
  const longest = (raw.match(/\d+/g) || []).sort((a, b) => b.length - a.length)[0] || "";
  let s = longest.length >= 5 ? longest : raw.replace(/[^a-z0-9]/g, "");
  s = s.replace(/^0+(?=\d)/, "");
  return /\d/.test(s) ? s.slice(0, 80) : "";
}
const normText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function fpKeyOf(patient, dos) { const p = normText(patient), d = isoDate(dos); return p && d ? p + "|" + d : ""; }
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
const generatedClaimNo = (fp) => "BR-" + fnv1a(fp).toUpperCase();
/* Fill alt_key / fp_key on claims loaded before these columns existed. */
async function backfillKeys(env) {
  for (let round = 0; round < 50; round++) {
    const rows = await all(env, "SELECT id, claim_no, patient, dos FROM claims WHERE alt_key = '' AND fp_key = '' AND (claim_no <> '' OR (patient <> '' AND dos <> '')) LIMIT 200");
    if (!rows.length) break;
    await batchAll(env, rows.map((r) => env.DB.prepare("UPDATE claims SET alt_key = ?, fp_key = ? WHERE id = ?").bind(altKeyOf(r.claim_no), fpKeyOf(r.patient, r.dos), r.id)), 50);
    if (rows.length < 200) break;
  }
}

/* Delete a person's sign-in. Their open claims go back to the pool (state open,
   no biller), their sessions end, and their notes stay in the claim history
   under the name they wrote with. */
async function removeUser(env, id) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = CASE WHEN state IN ('assigned','in_progress') THEN 'open' ELSE state END, updated_at = ? WHERE assigned_to = ?").bind(now, id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
}

const PUBLIC_OPS = new Set(["auth.login", "auth.sendOtp", "auth.verifyOtp", "auth.signup", "meta.info", "auth.lookup", "auth.setupCode", "auth.completeSetup", "auth.loginById"]);
const SUPERVISOR_OPS = /^(users\.|clients\.save|clients\.saveTeam|clients\.delete|locations\.|settings\.save|inventory\.|claims\.(list|stats|eligible|setState)|attention\.|alloc\.|reports\.|supervisor\.|email\.|demo\.|projects\.|team\.|roster\.)/;
const ADMIN_OPS = /^roster\./;
const ESCALATION_TAT_MS = 24 * 60 * 60 * 1000;

const OPS = {
  "meta.info": async ({ env }) => ({ app: "brahmastra-api", version: VERSION, demo: !!env.DEMO, domains: allowedDomains(env), email: !!env.EMAIL_PROVIDER, email_provider: String(env.EMAIL_PROVIDER || "").toLowerCase(),
    email_from: env.EMAIL_PROVIDER ? String(env.EMAIL_FROM || "") : "", email_sender: env.EMAIL_PROVIDER === "graph" ? String(env.MS_SENDER || "") : "", designations: DESIGNATIONS,
    roster: !!(await getSetting(env, "roster_meta", null)) }),
  /* Team lead: send a test message through the configured provider to prove the email setup works. */
  "email.test": async ({ env, user, payload }) => {
    const to = mailClean(payload.to || user.email);
    if (!mailOk(to)) throw bad("Enter a valid email address.");
    const provider = String(env.EMAIL_PROVIDER || "").toLowerCase();
    const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    await sendEmail(env, { to, subject: "Brahmastra test email", text: `This is a test from Brahmastra sent at ${when} through ${provider}. If you received it, sign-in codes will arrive the same way.`,
      html: `<div style="font-family:Inter,Segoe UI,sans-serif;font-size:15px;color:#0A0E24"><p>This is a test from <b>Brahmastra</b>, sent at ${when} through <b>${provider}</b>.</p><p>If you received it, sign-in codes will arrive the same way.</p></div>` });
    return { ok: true, to, provider };
  },

  /* ---- auth: password, or a one-time code sent by email ---- */
  "auth.login": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email) || !isHash(payload.passHash)) throw bad("Enter your email and password.");
    const u = await one(env, "SELECT * FROM users WHERE email = ?", email);
    const fail = () => new ApiError(401, "That email or password doesn't match.");
    if (!u || !u.active) throw fail();
    const block = await signInBlock(env, u); if (block) throw new ApiError(403, block);
    if (!u.pass_hash) throw new ApiError(401, "This account has no password yet. Sign in with a code sent to your email, then set a password from the menu if you want one.");
    if (!(await passwordOk(env, u, payload.passHash))) throw fail();
    return openSession(env, u, "password");
  },
  "auth.sendOtp": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email)) throw bad("Enter your email address.");
    const u = await one(env, "SELECT id, active, role, source, email, email_missing FROM users WHERE email = ?", email);
    if (!u) throw new ApiError(404, "No Brahmastra account uses that email. Ask your team lead to add you, or create a team lead account.");
    if (!u.active) throw new ApiError(403, "This account is switched off. Ask your team lead.");
    const block = await signInBlock(env, u); if (block) throw new ApiError(403, block);
    const code = await issueOtp(env, email, "login", {});
    return { email, ...(await deliverOtp(env, email, code, "login")) };
  },
  "auth.signup": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email)) throw bad("Enter a valid email address.");
    if (await getSetting(env, "roster_meta", null)) throw bad("Accounts now come from the Purview Shastra roster. Ask your team lead or admin to add you.");
    if (!domainOk(env, email)) throw bad("Accounts are limited to Purview email addresses (" + allowedDomains(env).join(", ") + ").");
    const first = str(payload.first_name, 60).trim(), last = str(payload.last_name, 60).trim();
    if (!first || !last) throw bad("Enter your first and last name.");
    const designation = DESIGNATIONS.includes(payload.designation) ? payload.designation : "";
    if (!designation) throw bad("Pick your designation.");
    if (!isHash(payload.passHash)) throw bad("Set a password.");
    const dup = await one(env, "SELECT id FROM users WHERE email = ?", email);
    if (dup) throw bad("That email already has an account. Sign in instead (with a code if you forgot the password).");
    const code = await issueOtp(env, email, "signup", { first_name: first, last_name: last, designation, passHash: payload.passHash, capacity: 35 });
    return { email, ...(await deliverOtp(env, email, code, "signup")) };
  },
  "auth.verifyOtp": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email) || !String(payload.code || "").trim()) throw bad("Enter the email and the code.");
    const { purpose, data } = await checkOtp(env, email, payload.code);
    let u = await one(env, "SELECT * FROM users WHERE email = ?", email);
    if (purpose === "signup") {
      if (u) throw bad("That email already has an account. Sign in instead.");
      const id = uuid(), salt = randomHex(16), now = Date.now();
      const hash = isHash(data.passHash) ? await makeHash(env, salt, data.passHash) : "";
      await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,'supervisor',?,?,0,1,?,?)",
        id, email, fullName(data.first_name, data.last_name, email), data.first_name || "", data.last_name || "", data.designation || "", salt, hash, Math.round(num(data.capacity, 35)), now);
      u = await one(env, "SELECT * FROM users WHERE id = ?", id);
    }
    if (!u || !u.active) throw new ApiError(403, "This account is not active. Ask your team lead.");
    const block = await signInBlock(env, u); if (block) throw new ApiError(403, block);
    if (u.must_change && !u.pass_hash) await run(env, "UPDATE users SET must_change = 0 WHERE id = ?", u.id);
    return openSession(env, u, "otp");
  },

  /* ---- sign in by name ----
     Everyone is already in the roster, so the screen looks the person up by name, shows the matches with
     their employee ID, and the first time they prove it is them with a one-time code (emailed, or handed
     over by their team lead when they have no usable email) and set their password. After that: name + password. */
  "auth.lookup": async ({ env, payload }) => {
    const q = str(payload.q, 80).trim().toLowerCase().replace(/[%_]/g, " ");
    if (q.length < 2) return { matches: [] };
    const like = "%" + q + "%";
    const rows = await all(env, `SELECT id, name, emp_id, designation, department, email, email_missing, pass_hash FROM users
      WHERE active = 1 AND role <> 'admin' AND (lower(name) LIKE ? OR lower(emp_id) LIKE ?) ORDER BY name LIMIT 8`, like, like);
    return { matches: rows.map((u) => ({ id: u.id, name: u.name, emp_id: u.emp_id || "", designation: u.designation || "", department: u.department || "",
      has_password: !!u.pass_hash, email_hint: u.email_missing ? "" : maskEmail(u.email) })) };
  },
  "auth.setupCode": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ? AND active = 1", str(payload.user_id, 60));
    if (!u || u.role === "admin") throw bad("Pick your name from the list first.");
    const extra = ((await getSetting(env, "extra_emails", [])) || []).map(mailClean);
    const mailable = !u.email_missing && mailOk(u.email) && (domainOk(env, u.email) || extra.includes(mailClean(u.email)));
    if (!mailable) return { via: "lead" };
    const code = await issueOtp(env, u.email, "setup", {});
    const d = await deliverOtp(env, u.email, code, "setup");
    return { via: "email", email_hint: maskEmail(u.email), ...d };
  },
  /* The code proves it is really them (a lead-issued sign-in code counts too); then the password is saved and they are in. */
  "auth.completeSetup": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ? AND active = 1", str(payload.user_id, 60));
    if (!u || u.role === "admin") throw bad("Pick your name from the list first.");
    if (!isHash(payload.passHash)) throw bad("Set a password.");
    const { purpose } = await checkOtp(env, u.email, payload.code);
    if (purpose !== "setup" && purpose !== "login") throw bad("That code is not valid here. Ask for a new one.");
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.passHash);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 0 WHERE id = ?").bind(salt, hash, u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
    ]);
    return openSession(env, { ...u, pass_hash: hash, must_change: 0 }, "password");
  },
  "auth.loginById": async ({ env, payload }) => {
    const u = await one(env, "SELECT * FROM users WHERE id = ?", str(payload.user_id, 60));
    const fail = () => new ApiError(401, "That password doesn't match.");
    if (!u || !u.active || u.role === "admin") throw fail();
    if (!isHash(payload.passHash)) throw bad("Enter your password.");
    if (!u.pass_hash) throw new ApiError(401, "No password set here yet. Use First time here to create one.");
    if (!(await passwordOk(env, u, payload.passHash))) throw fail();
    return openSession(env, u, "password");
  },
  "auth.logout": async ({ env, token }) => { if (token) await run(env, "DELETE FROM sessions WHERE token = ?", token); return { ok: true }; },
  "auth.me": async ({ user }) => ({ user }),
  "auth.deleteMyAccount": async ({ env, user, payload }) => {
    if (str(payload.confirm, 200).trim().toLowerCase() !== String(user.email || "").toLowerCase()) throw bad("Type your email address exactly to confirm.");
    if (user.role === "supervisor") {
      const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role IN ('supervisor','admin') AND active = 1 AND id <> ?", user.id);
      if (!n.n) throw bad("You are the only active team lead. Add another team lead before deleting this account.");
    }
    await removeUser(env, user.id);
    return { ok: true };
  },
  "auth.changePassword": async ({ env, user, token, payload }) => {
    if (!isHash(payload.newHash)) throw bad("Enter the new password.");
    const u = await one(env, "SELECT * FROM users WHERE id = ?", user.id);
    const needOld = !!u.pass_hash && user.via !== "otp";
    if (needOld) {
      if (!isHash(payload.oldHash)) throw bad("Enter your current password.");
      if (String(payload.oldHash).toLowerCase() === String(payload.newHash).toLowerCase()) throw bad("Choose a different password.");
      if (!(await passwordOk(env, u, payload.oldHash))) throw bad("Your current password doesn't match.");
    }
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.newHash);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 0 WHERE id = ?").bind(salt, hash, user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").bind(user.id, token || ""),
    ]);
    return { ok: true };
  },

  /* ---- users (supervisor) ---- */
  "users.list": async ({ env, user }) => {
    const users = await visibleUsers(env, user);
    return { users: users.map(publicUser) };
  },
  "users.save": async ({ env, user, payload }) => {
    const now = Date.now();
    let role = payload.role === "supervisor" ? "supervisor" : "user";
    const projects = Array.isArray(payload.projects) ? payload.projects.map((x) => ({ name: str(x && x.name != null ? x.name : x, 80).trim(), share: x && x.share != null ? num(x.share, 0) : null })).filter((x) => x.name && !/^(none|all)$/i.test(x.name)).slice(0, 30) : null;
    let reportsTo = payload.reports_to === undefined ? undefined : (str(payload.reports_to, 60) || null);
    if (reportsTo) { const r = await one(env, "SELECT id, name FROM users WHERE id = ?", reportsTo); if (!r) throw bad("Pick who they report to."); }
    const first = str(payload.first_name, 60).trim(), last = str(payload.last_name, 60).trim();
    const name = fullName(first, last, str(payload.name, 120).trim());
    const designation = DESIGNATIONS.includes(payload.designation) ? payload.designation : str(payload.designation, 40).trim();
    const capacity = Math.max(1, Math.min(500, Math.round(num(payload.capacity, 35))));
    const active = payload.active === false ? 0 : 1;
    if (payload.id) {
      const ex = await one(env, "SELECT * FROM users WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown user.");
      if (!name) throw bad("Enter the person's name.");
      if (user.scope && !(await visibleUsers(env, user)).some((u) => u.id === ex.id)) throw denied("That person is not on your projects.");
      if (ex.role === "admin") { if (!user.is_admin) throw denied("Only an admin can change an admin account."); role = "admin"; }
      // A new email: for someone the roster had no (or a wrong) address for.
      const newEmail = payload.email != null ? mailClean(payload.email) : ex.email;
      if (newEmail !== ex.email) {
        if (!mailOk(newEmail)) throw bad("Enter a valid email address.");
        if (await one(env, "SELECT id FROM users WHERE email = ? AND id <> ?", newEmail, ex.id)) throw bad("That email already has an account.");
        await run(env, "UPDATE users SET email = ?, email_missing = 0 WHERE id = ?", newEmail, ex.id);
      }
      if (payload.emp_id != null) await run(env, "UPDATE users SET emp_id = ? WHERE id = ?", str(payload.emp_id, 20).trim().toUpperCase(), ex.id);
      if (projects) await run(env, "UPDATE users SET projects_json = ? WHERE id = ?", JSON.stringify(projects), ex.id);
      if (reportsTo !== undefined) { const r = reportsTo ? await one(env, "SELECT name FROM users WHERE id = ?", reportsTo) : null; await run(env, "UPDATE users SET reports_to = ?, reports_to_name = ? WHERE id = ?", reportsTo, r ? r.name : "", ex.id); }
      if (ex.id === user.id && (!active || role !== "supervisor")) throw bad("You can't deactivate or demote your own account.");
      if (ex.role === "supervisor" && (role !== "supervisor" || !active)) {
        const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role IN ('supervisor','admin') AND active = 1 AND id <> ?", ex.id);
        if (!n.n) throw bad("Keep at least one active team lead.");
      }
      await run(env, "UPDATE users SET name = ?, first_name = ?, last_name = ?, designation = ?, role = ?, capacity = ?, active = ? WHERE id = ?", name, first, last, designation, role, capacity, active, ex.id);
      if (!active) await run(env, "DELETE FROM sessions WHERE user_id = ?", ex.id);
      if (projects || reportsTo !== undefined || role !== ex.role || active !== ex.active) { await recomputeScopes(env); await syncTeams(env); }
      return { user: publicUser(await one(env, "SELECT * FROM users WHERE id = ?", ex.id)) };
    }
    const email = mailClean(payload.email);
    if (!mailOk(email)) throw bad("Enter a valid email address.");
    if (!domainOk(env, email)) throw bad("Accounts are limited to: " + allowedDomains(env).join(", "));
    if (!first || !last) throw bad("Enter the person's first and last name.");
    const dup = await one(env, "SELECT id FROM users WHERE email = ?", email);
    if (dup) throw bad("That email already has an account.");
    const id = uuid(), salt = randomHex(16);
    const hash = isHash(payload.passHash) ? await makeHash(env, salt, payload.passHash) : "";
    await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, email, name, first, last, designation, role, salt, hash, hash ? 1 : 0, active, capacity, now);
    if (projects) await run(env, "UPDATE users SET projects_json = ? WHERE id = ?", JSON.stringify(projects), id);
    if (reportsTo) { const r = await one(env, "SELECT name FROM users WHERE id = ?", reportsTo); await run(env, "UPDATE users SET reports_to = ?, reports_to_name = ? WHERE id = ?", reportsTo, r.name, id); }
    if (projects || reportsTo) { await recomputeScopes(env); await syncTeams(env); }
    return { user: publicUser(await one(env, "SELECT * FROM users WHERE id = ?", id)) };
  },
  /* A team lead can fetch a sign-in code for someone whose email has not arrived (or when email is not set up). */
  "users.loginCode": async ({ env, user, payload }) => {
    const ex = await one(env, "SELECT id, email, active, name FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (user.scope && !(await visibleUsers(env, user)).some((u) => u.id === ex.id)) throw denied("That person is not on your projects.");
    if (!ex.active) throw bad("This account is switched off.");
    const code = await issueOtp(env, ex.email, "login", {}, { byTeamLead: true });
    return { email: ex.email, code, expires_in_min: OTP_TTL_MS / 60000 };
  },
  "users.resetPassword": async ({ env, user, payload }) => {
    if (!isHash(payload.passHash)) throw bad("Set a temporary password.");
    const ex = await one(env, "SELECT id FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (user.scope && !(await visibleUsers(env, user)).some((u) => u.id === ex.id)) throw denied("That person is not on your projects.");
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.passHash);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 1 WHERE id = ?").bind(salt, hash, ex.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(ex.id),
    ]);
    return { ok: true };
  },

  "users.delete": async ({ env, user, payload }) => {
    const ex = await one(env, "SELECT * FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (user.scope && !(await visibleUsers(env, user)).some((u) => u.id === ex.id)) throw denied("That person is not on your projects.");
    if (ex.id === user.id) throw bad("To delete your own account, use Delete my account in the menu.");
    if (ex.role === "supervisor" && ex.active) {
      const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role IN ('supervisor','admin') AND active = 1 AND id <> ?", ex.id);
      if (!n.n) throw bad("Keep at least one active team lead.");
    }
    await removeUser(env, ex.id);
    return { ok: true, name: ex.name };
  },

  /* ---- clients & locations ---- */
  "clients.list": async ({ env, user }) => {
    const clients = (await all(env, "SELECT * FROM clients ORDER BY active DESC, name")).filter((c) => inScope(user, c.id));
    const locs = await all(env, "SELECT * FROM locations ORDER BY active DESC, name");
    const shape = (r) => { const { team_json, roster_names_json, caps_json, ...rest } = r; return { ...rest, active: !!r.active, auto_allocate: r.auto_allocate == null ? true : !!r.auto_allocate, team: parseTeam(team_json),
      ...(roster_names_json !== undefined ? { roster_names: jsonList(roster_names_json), caps: jsonObj(caps_json) } : {}) }; };
    return { clients: clients.map((c) => ({ ...shape(c), locations: locs.filter((l) => l.client_id === c.id).map(shape) })) };
  },
  /* Billers mapped to a client (used when a location has no team of its own) or to a location. */
  "clients.saveTeam": async ({ env, user, payload }) => {
    const table = payload.location_id ? "locations" : "clients";
    const id = str(payload.location_id || payload.client_id, 60);
    const ex = await one(env, `SELECT id, ${payload.location_id ? "client_id" : "id AS client_id"} FROM ${table} WHERE id = ?`, id);
    if (!ex) throw bad("Unknown " + (payload.location_id ? "location" : "client") + ".");
    if (!inScope(user, ex.client_id)) throw outOfScope();
    const ids = [...new Set((Array.isArray(payload.team) ? payload.team : []).map((x) => str(x, 60)).filter(Boolean))].slice(0, 100);
    const valid = ids.length ? (await all(env, `SELECT id FROM users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((u) => u.id) : [];
    const team = ids.filter((x) => valid.includes(x));
    const auto = payload.auto_allocate === false ? 0 : 1;
    await run(env, `UPDATE ${table} SET team_json = ?, auto_allocate = ? WHERE id = ?`, JSON.stringify(team), auto, ex.id);
    return { team, auto_allocate: !!auto };
  },
  "clients.save": async ({ env, user, payload }) => {
    const name = str(payload.name, 160).trim();
    if (!name) throw bad("Give the client a name.");
    const code = str(payload.code, 20).trim().toUpperCase();
    const fu = Math.max(1, Math.min(365, Math.round(num(payload.follow_up_days, 30))));
    const active = payload.active === false ? 0 : 1;
    const link = workbookLinkOf(payload.workbook_link);
    if (payload.id) {
      const ex = await one(env, "SELECT id FROM clients WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown client.");
      if (!inScope(user, ex.id)) throw outOfScope();
      await run(env, "UPDATE clients SET name = ?, code = ?, follow_up_days = ?, active = ?, workbook_link = CASE WHEN ? IS NULL THEN workbook_link ELSE ? END WHERE id = ?", name, code, fu, active, link, link, ex.id);
      return { client: { id: ex.id, name, code, follow_up_days: fu, active: !!active, workbook_link: link } };
    }
    if (user.scope) throw denied("Only a manager with every project, or an admin, can add a client. Ask them to add it.");
    const id = uuid(), now = Date.now();
    await run(env, "INSERT INTO clients (id, name, code, active, follow_up_days, created_by, created_at, workbook_link) VALUES (?,?,?,?,?,?,?,?)", id, name, code, active, fu, user.id, now, link || "");
    await autoMapProjects(env);
    return { client: { id, name, code, follow_up_days: fu, active: !!active, created_at: now, team: [], auto_allocate: true, locations: [], workbook_link: link || "" } };
  },
  /* Delete a client with everything under it: locations, uploads, claims, notes, allocation history. Confirmed by name on the screen. */
  "clients.delete": async ({ env, user, payload }) => {
    const ex = await one(env, "SELECT id, name FROM clients WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown client.");
    if (user.scope) throw denied("Only a manager with every project, or an admin, can delete a client.");
    if (str(payload.confirm, 200).trim().toLowerCase() !== String(ex.name).trim().toLowerCase()) throw bad("Type the client's name exactly to confirm.");
    const n = await one(env, "SELECT COUNT(*) AS n FROM claims WHERE client_id = ?", ex.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM notes WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM attachment_parts WHERE attachment_id IN (SELECT a.id FROM attachments a JOIN claims c ON c.id = a.claim_id WHERE c.client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM attachments WHERE claim_id IN (SELECT id FROM claims WHERE client_id = ?)").bind(ex.id),
      env.DB.prepare("DELETE FROM claims WHERE client_id = ?").bind(ex.id),
      env.DB.prepare("DELETE FROM batches WHERE client_id = ?").bind(ex.id),
      env.DB.prepare("DELETE FROM allocations WHERE client_id = ?").bind(ex.id),
      env.DB.prepare("DELETE FROM locations WHERE client_id = ?").bind(ex.id),
      env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(ex.id),
    ]);
    return { ok: true, name: ex.name, claims: n ? n.n : 0 };
  },
  "locations.save": async ({ env, user, payload }) => {
    const name = str(payload.name, 160).trim();
    if (!name) throw bad("Give the location a name.");
    const active = payload.active === false ? 0 : 1;
    const link = workbookLinkOf(payload.workbook_link);
    if (payload.id) {
      const ex = await one(env, "SELECT id, client_id FROM locations WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown location.");
      if (!inScope(user, ex.client_id)) throw outOfScope();
      await run(env, "UPDATE locations SET name = ?, active = ?, workbook_link = CASE WHEN ? IS NULL THEN workbook_link ELSE ? END WHERE id = ?", name, active, link, link, ex.id);
      return { location: { id: ex.id, client_id: ex.client_id, name, active: !!active, workbook_link: link } };
    }
    const client = await one(env, "SELECT id FROM clients WHERE id = ?", payload.client_id);
    if (!client) throw bad("Unknown client.");
    const dup = await one(env, "SELECT id FROM locations WHERE client_id = ? AND lower(name) = lower(?)", client.id, name);
    if (dup) throw bad("That location already exists for this client.");
    const id = uuid(), now = Date.now();
    await run(env, "INSERT INTO locations (id, client_id, name, active, created_at) VALUES (?,?,?,?,?)", id, client.id, name, active, now);
    return { location: { id, client_id: client.id, name, active: !!active, created_at: now, team: [], auto_allocate: true } };
  },

  /* ---- settings ---- */
  "settings.get": async ({ env }) => {
    const rows = await all(env, "SELECT * FROM settings");
    const out = {};
    rows.forEach((r) => { try { out[r.key] = JSON.parse(r.value_json); } catch { out[r.key] = null; } });
    return { settings: out };
  },
  "settings.save": async ({ env, user, payload }) => {
    const s = { ...(payload.settings || {}) };
    // Sign-in and roster settings belong to the admin (Roster screen).
    for (const k of ["extra_emails", "roster_meta"]) delete s[k];
    const stmts = Object.keys(s).slice(0, 50).map((k) => env.DB.prepare("INSERT INTO settings (key, value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").bind(str(k, 60), JSON.stringify(s[k])));
    if (stmts.length) await batchAll(env, stmts);
    return OPS["settings.get"]({ env });
  },

  /* ---- inventory ---- */
  "inventory.upload": async ({ env, user, payload }) => {
    const { client_id, location_id, kind, file_name, batch_id, final, rows_read, summary } = payload;
    const claims = Array.isArray(payload.claims) ? payload.claims : [];
    if (kind !== "fresh" && kind !== "worked") throw bad("kind must be fresh or worked.");
    const client = await one(env, "SELECT id, follow_up_days FROM clients WHERE id = ?", client_id);
    if (!client) throw bad("Unknown client.");
    if (location_id) { const l = await one(env, "SELECT id FROM locations WHERE id = ? AND client_id = ?", location_id, client.id); if (!l) throw bad("Unknown location."); }
    const now = Date.now();
    let bid = batch_id;
    if (!bid) {
      bid = uuid();
      await run(env, "INSERT INTO batches (id, client_id, location_id, kind, file_name, uploaded_by, uploaded_at, rows_read, source, web_url) VALUES (?,?,?,?,?,?,?,?,?,?)",
        bid, client.id, location_id || null, kind, str(file_name, 200), user.id, now, Math.round(num(rows_read, 0)), payload.source === "onedrive" ? "onedrive" : "file", str(payload.web_url, 1000));
    } else {
      const b = await one(env, "SELECT id, client_id FROM batches WHERE id = ?", bid);
      if (!b || b.client_id !== client.id) throw bad("Unknown batch.");
    }
    const counts = { inserted: 0, updated: 0, reopened: 0, closed: 0, excluded: 0, skipped: 0 };
    const seen = new Set();
    const rows = claims.filter((c) => { const k = str(c.match_key, 300); if (!k || seen.has(k)) { counts.skipped++; return false; } seen.add(k); return true; });
    // Keys for recognising a claim already on file: exact key, normalised claim number, patient + DOS.
    rows.forEach((c) => {
      c._fp = fpKeyOf(c.patient, c.dos);
      if (!str(c.claim_no, 80).trim() && c._fp) c.claim_no = generatedClaimNo(c._fp);
      c._alt = altKeyOf(c.claim_no);
    });
    const byMatch = new Map(), byAlt = new Map(), byFp = new Map();
    const SEL = "SELECT id, match_key, alt_key, fp_key, state, touches, assigned_to, worked_before, follow_up_on, inventory_kind FROM claims WHERE client_id = ? AND ";
    for (const chunk of chunks(rows.map((c) => str(c.match_key, 300)), 80)) (await all(env, SEL + `match_key IN (${chunk.map(() => "?").join(",")})`, client.id, ...chunk)).forEach((r) => byMatch.set(r.match_key, r));
    for (const chunk of chunks([...new Set(rows.map((c) => c._alt).filter(Boolean))], 80)) (await all(env, SEL + `alt_key IN (${chunk.map(() => "?").join(",")})`, client.id, ...chunk)).forEach((r) => { if (!byAlt.has(r.alt_key)) byAlt.set(r.alt_key, r); });
    for (const chunk of chunks([...new Set(rows.map((c) => c._fp).filter(Boolean))], 80)) (await all(env, SEL + `fp_key IN (${chunk.map(() => "?").join(",")})`, client.id, ...chunk)).forEach((r) => { if (!byFp.has(r.fp_key)) byFp.set(r.fp_key, r); });
    const stmts = [];
    const taken = new Set();
    for (const c of rows) {
      const key = str(c.match_key, 300);
      let ex = byMatch.get(key) || (c._alt && byAlt.get(c._alt)) || null;
      // Patient + DOS only when neither side has a (different) claim number.
      if (!ex && c._fp) { const f = byFp.get(c._fp); if (f && (!f.alt_key || !c._alt || f.alt_key === c._alt)) ex = f; }
      if (ex && taken.has(ex.id)) ex = null; // two rows of one file cannot both refresh the same claim
      if (ex) taken.add(ex.id);
      const exclude = str(c.exclude_reason, 80);
      const closedInFile = exclude === "closed";
      const vals = {
        location_id: location_id || (ex ? undefined : null),
        claim_no: str(c.claim_no, 80), account_no: str(c.account_no, 80), patient: str(c.patient, 160), payer: str(c.payer, 160),
        dos: isoDate(c.dos), cpt: str(c.cpt, 200), provider: str(c.provider, 160), billed: c.billed == null ? null : num(c.billed, 0),
        balance: num(c.balance, 0), lines: Math.max(1, Math.round(num(c.lines, 1))), lines_json: str(JSON.stringify(c.lines_json || []), 20000),
        age_days: c.age_days == null ? null : Math.round(num(c.age_days, 0)), bucket: str(c.bucket, 20), tier: str(c.tier, 10),
        status_class: str(c.status_class, 20) || "unknown", file_status: str(c.file_status, 200), file_sub_status: str(c.file_sub_status, 200),
        file_action: str(c.file_action, 400), file_comments: str(c.file_comments, 4000), file_bucket: str(c.file_bucket, 80),
        priority: num(c.priority, 0), priority_reason: str(c.priority_reason, 300), raw_json: str(JSON.stringify(c.raw || {}), 20000),
      };
      const lastWorked = kind === "worked" ? isoDate(c.last_worked_on) : "";
      const followUp = kind === "worked" ? (isoDate(c.follow_up_on) || (lastWorked ? addDays(lastWorked, client.follow_up_days || 30) : "")) : "";
      if (!ex) {
        const state = !exclude ? "open" : closedInFile ? "closed" : "excluded";
        const reason = !exclude ? "" : closedInFile ? "Closed in " + kind + " file" + (vals.file_status ? ": " + vals.file_status : "") : exclude;
        if (state === "open") counts.inserted++; else if (state === "closed") counts.closed++; else counts.excluded++;
        stmts.push(env.DB.prepare(`INSERT INTO claims (id, client_id, location_id, batch_id, first_batch_id, match_key, claim_no, account_no, patient, payer, dos, cpt, provider,
            billed, balance, lines, lines_json, age_days, bucket, tier, status_class, file_status, file_sub_status, file_action, file_comments, file_bucket,
            inventory_kind, worked_before, last_worked_on, follow_up_on, priority, priority_reason, state, state_reason, raw_json, created_at, updated_at, alt_key, fp_key)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          uuid(), client.id, location_id || null, bid, bid, key, vals.claim_no, vals.account_no, vals.patient, vals.payer, vals.dos, vals.cpt, vals.provider,
          vals.billed, vals.balance, vals.lines, vals.lines_json, vals.age_days, vals.bucket, vals.tier, vals.status_class, vals.file_status, vals.file_sub_status,
          vals.file_action, vals.file_comments, vals.file_bucket, kind, kind === "worked" ? 1 : 0, lastWorked, followUp, vals.priority, vals.priority_reason,
          state, reason, vals.raw_json, now, now, c._alt, c._fp));
        continue;
      }
      // existing claim: refresh the file facts, then decide what happens to its state
      let newState = ex.state, reason = null, clearAssign = 0;
      if (exclude) {
        if (closedInFile && ex.state !== "in_progress") { newState = "closed"; reason = "Closed in " + kind + " file" + (vals.file_status ? ": " + vals.file_status : ""); counts.closed++; }
        else if (ex.state === "open" || ex.state === "assigned") { newState = "excluded"; reason = exclude; counts.excluded++; }
        else counts.updated++;
      } else if (ex.state === "closed" || ex.state === "excluded") { newState = "open"; reason = "Reopened by " + kind + " upload"; clearAssign = 1; counts.reopened++; }
      else counts.updated++;
      stmts.push(claimEvent(env, ex.id, user, "refreshed", str(file_name, 200), { kind, file_status: [vals.file_status, vals.file_sub_status].filter(Boolean).join(" · "), balance: vals.balance, ...(newState !== ex.state ? { changes: { state: [ex.state, newState] } } : {}) }));
      stmts.push(env.DB.prepare(`UPDATE claims SET location_id = COALESCE(?, location_id), batch_id = ?, claim_no = CASE WHEN ? <> '' THEN ? ELSE claim_no END,
          account_no = CASE WHEN ? <> '' THEN ? ELSE account_no END, patient = CASE WHEN ? <> '' THEN ? ELSE patient END, payer = CASE WHEN ? <> '' THEN ? ELSE payer END,
          dos = CASE WHEN ? <> '' THEN ? ELSE dos END, cpt = CASE WHEN ? <> '' THEN ? ELSE cpt END, provider = CASE WHEN ? <> '' THEN ? ELSE provider END,
          billed = COALESCE(?, billed), balance = ?, lines = ?, lines_json = ?, age_days = ?, bucket = ?, tier = ?, status_class = ?,
          file_status = ?, file_sub_status = ?, file_action = ?, file_comments = CASE WHEN ? <> '' THEN ? ELSE file_comments END, file_bucket = ?,
          inventory_kind = CASE WHEN ? = 'worked' THEN 'worked' ELSE inventory_kind END, worked_before = CASE WHEN ? = 'worked' THEN 1 ELSE worked_before END,
          last_worked_on = CASE WHEN ? <> '' THEN ? ELSE last_worked_on END, follow_up_on = CASE WHEN ? <> '' THEN ? ELSE follow_up_on END,
          priority = ?, priority_reason = ?, state = ?, state_reason = COALESCE(?, state_reason),
          assigned_to = CASE WHEN ? = 1 THEN NULL ELSE assigned_to END, assigned_at = CASE WHEN ? = 1 THEN NULL ELSE assigned_at END,
          skipped_at = CASE WHEN ? = 1 THEN NULL ELSE skipped_at END, raw_json = ?, updated_at = ?,
          alt_key = CASE WHEN alt_key = '' THEN ? ELSE alt_key END, fp_key = CASE WHEN fp_key = '' THEN ? ELSE fp_key END WHERE id = ?`).bind(
          location_id || null, bid, vals.claim_no, vals.claim_no, vals.account_no, vals.account_no, vals.patient, vals.patient, vals.payer, vals.payer,
          vals.dos, vals.dos, vals.cpt, vals.cpt, vals.provider, vals.provider, vals.billed, vals.balance, vals.lines, vals.lines_json, vals.age_days, vals.bucket, vals.tier, vals.status_class,
          vals.file_status, vals.file_sub_status, vals.file_action, vals.file_comments, vals.file_comments, vals.file_bucket,
          kind, kind, lastWorked, lastWorked, followUp, followUp, vals.priority, vals.priority_reason, newState, reason,
          clearAssign, clearAssign, clearAssign, vals.raw_json, now, c._alt, c._fp, ex.id));
    }
    if (stmts.length) await batchAll(env, stmts, 40);
    await run(env, `UPDATE batches SET inserted = inserted + ?, updated = updated + ?, reopened = reopened + ?, closed = closed + ?, excluded = excluded + ?, skipped = skipped + ?,
        rows_read = CASE WHEN ? > 0 THEN ? ELSE rows_read END, summary_json = CASE WHEN ? = 1 THEN ? ELSE summary_json END WHERE id = ?`,
      counts.inserted, counts.updated, counts.reopened, counts.closed, counts.excluded, counts.skipped,
      Math.round(num(rows_read, 0)), Math.round(num(rows_read, 0)), final ? 1 : 0, str(JSON.stringify(summary || {}), 20000), bid);
    return { batch_id: bid, ...counts };
  },
  "inventory.batches": async ({ env, user, payload }) => {
    const range = payload.from_ms != null || payload.to_ms != null ? [num(payload.from_ms, 0), num(payload.to_ms, Date.now())] : [];
    const tail = range.length ? " AND b.uploaded_at BETWEEN ? AND ?" : "";
    const rows = payload.client_id
      ? await all(env, "SELECT b.*, u.name AS uploaded_by_name, l.name AS location_name FROM batches b LEFT JOIN users u ON u.id = b.uploaded_by LEFT JOIN locations l ON l.id = b.location_id WHERE b.client_id = ?" + tail + " ORDER BY b.uploaded_at DESC LIMIT 100", payload.client_id, ...range)
      : await all(env, `SELECT b.*, u.name AS uploaded_by_name, l.name AS location_name, c.name AS client_name FROM batches b LEFT JOIN users u ON u.id = b.uploaded_by LEFT JOIN locations l ON l.id = b.location_id LEFT JOIN clients c ON c.id = b.client_id WHERE 1 = 1${scopeSql(user, "b.client_id")}${tail} ORDER BY b.uploaded_at DESC LIMIT 100`, ...scopeArgs(user), ...range);
    return { batches: rows.map((b) => { let s = {}; try { s = JSON.parse(b.summary_json); } catch {} return { ...b, summary: s, summary_json: undefined }; }) };
  },
  /* Merge claims that are really the same claim (same normalised claim number, or same patient + DOS with no
     conflicting claim number). The oldest row is kept; notes, work history and the biller move onto it. */
  "inventory.dedupe": async ({ env, payload }) => {
    const client = await one(env, "SELECT id FROM clients WHERE id = ?", payload.client_id);
    if (!client) throw bad("Pick a client.");
    await backfillKeys(env);
    const rows = await all(env, `SELECT id, claim_no, alt_key, fp_key, created_at, state, assigned_to, assigned_at, touches, worked_before, inventory_kind, last_worked_on, follow_up_on,
        last_status_code, last_action_code, last_sub_status, last_bucket, last_effective, last_note_action, last_note, last_worked_by FROM claims WHERE client_id = ? ORDER BY created_at`, client.id);
    const groups = new Map();
    for (const r of rows) { const k = r.alt_key ? "a:" + r.alt_key : r.fp_key ? "f:" + r.fp_key : ""; if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    // Rows with a claim number also join a patient+DOS group only when no other member has a different number.
    const fpGroups = new Map();
    for (const r of rows) if (r.fp_key) { if (!fpGroups.has(r.fp_key)) fpGroups.set(r.fp_key, []); fpGroups.get(r.fp_key).push(r); }
    const merged = []; const seen = new Set();
    const consider = (list) => {
      const alts = new Set(list.map((r) => r.alt_key).filter(Boolean));
      if (list.length < 2 || alts.size > 1) return;
      const fresh = list.filter((r) => !seen.has(r.id)); if (fresh.length < 2) return;
      fresh.forEach((r) => seen.add(r.id));
      const keep = [...fresh].sort((a, b) => (b.touches - a.touches) || (a.created_at - b.created_at))[0];
      merged.push({ keep, others: fresh.filter((r) => r.id !== keep.id) });
    };
    groups.forEach(consider); fpGroups.forEach(consider);
    const total = merged.reduce((n, g) => n + g.others.length, 0);
    if (payload.dry_run) return { groups: merged.length, duplicates: total };
    const stmts = [];
    for (const g of merged) {
      const k = g.keep;
      for (const o of g.others) {
        stmts.push(env.DB.prepare("UPDATE notes SET claim_id = ? WHERE claim_id = ?").bind(k.id, o.id));
        stmts.push(env.DB.prepare("UPDATE attachments SET claim_id = ? WHERE claim_id = ?").bind(k.id, o.id));
        const newer = o.last_worked_on && o.last_worked_on > (k.last_worked_on || "");
        stmts.push(env.DB.prepare(`UPDATE claims SET touches = touches + ?, worked_before = CASE WHEN ? = 1 THEN 1 ELSE worked_before END,
            inventory_kind = CASE WHEN ? = 'worked' THEN 'worked' ELSE inventory_kind END,
            last_worked_on = CASE WHEN ? = 1 THEN ? ELSE last_worked_on END, follow_up_on = CASE WHEN ? = 1 THEN ? ELSE follow_up_on END,
            last_status_code = CASE WHEN ? = 1 THEN ? ELSE last_status_code END, last_action_code = CASE WHEN ? = 1 THEN ? ELSE last_action_code END,
            last_sub_status = CASE WHEN ? = 1 THEN ? ELSE last_sub_status END, last_bucket = CASE WHEN ? = 1 THEN ? ELSE last_bucket END,
            last_effective = CASE WHEN ? = 1 THEN ? ELSE last_effective END, last_note_action = CASE WHEN ? = 1 THEN ? ELSE last_note_action END,
            last_note = CASE WHEN ? = 1 THEN ? ELSE last_note END, last_worked_by = CASE WHEN ? = 1 THEN ? ELSE last_worked_by END,
            assigned_to = CASE WHEN assigned_to IS NULL AND ? IS NOT NULL AND state IN ('open','assigned') THEN ? ELSE assigned_to END,
            assigned_at = CASE WHEN assigned_to IS NULL AND ? IS NOT NULL AND state IN ('open','assigned') THEN ? ELSE assigned_at END,
            state = CASE WHEN assigned_to IS NULL AND ? IS NOT NULL AND state = 'open' THEN 'assigned' ELSE state END,
            updated_at = ? WHERE id = ?`).bind(
          o.touches, o.worked_before ? 1 : 0, o.inventory_kind, newer ? 1 : 0, o.last_worked_on, newer ? 1 : 0, o.follow_up_on,
          newer ? 1 : 0, o.last_status_code, newer ? 1 : 0, o.last_action_code, newer ? 1 : 0, o.last_sub_status, newer ? 1 : 0, o.last_bucket,
          newer ? 1 : 0, o.last_effective, newer ? 1 : 0, o.last_note_action, newer ? 1 : 0, o.last_note, newer ? 1 : 0, o.last_worked_by,
          o.assigned_to, o.assigned_to, o.assigned_to, o.assigned_at, o.assigned_to, Date.now(), k.id));
        stmts.push(env.DB.prepare("DELETE FROM claims WHERE id = ?").bind(o.id));
      }
    }
    if (stmts.length) await batchAll(env, stmts, 40);
    return { groups: merged.length, duplicates: total };
  },
  "inventory.undoBatch": async ({ env, user, payload }) => {
    const b = await one(env, "SELECT * FROM batches WHERE id = ?", payload.batch_id);
    if (!b) throw bad("Unknown batch.");
    if (!inScope(user, b.client_id)) throw outOfScope();
    if (b.undone_at) throw bad("This batch was already undone.");
    const r = await run(env, "DELETE FROM claims WHERE first_batch_id = ? AND touches = 0 AND state <> 'in_progress' AND id NOT IN (SELECT claim_id FROM attachments)", b.id);
    await run(env, "UPDATE batches SET undone_at = ? WHERE id = ?", Date.now(), b.id);
    return { removed: changesOf(r) };
  },

  /* ---- claims (supervisor views) ---- */
  "claims.list": async ({ env, user, payload }) => {
    const where = [], params = [];
    if (user.scope) { where.push(`c.client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); params.push(...user.scope); }
    if (payload.client_id) { where.push("c.client_id = ?"); params.push(payload.client_id); }
    if (payload.location_id) { where.push("c.location_id = ?"); params.push(payload.location_id); }
    if (payload.state === "workable") where.push(`c.state IN ${WORKABLE}`);
    else if (payload.state) { where.push("c.state = ?"); params.push(str(payload.state, 20)); }
    for (const f of ["tier", "bucket", "status_class", "payer", "inventory_kind"]) if (payload[f]) { where.push(`c.${f} = ?`); params.push(str(payload[f], 200)); }
    if (payload.assigned_to === "__none") where.push("c.assigned_to IS NULL");
    else if (payload.assigned_to) { where.push("c.assigned_to = ?"); params.push(str(payload.assigned_to, 60)); }
    if (payload.worked_before === true) where.push("c.worked_before = 1");
    if (payload.worked_before === false) where.push("c.worked_before = 0");
    if (payload.escalated) where.push("c.escalated = 1");
    if (payload.provider) { where.push("c.provider LIKE ?"); params.push("%" + str(payload.provider, 80).trim() + "%"); }
    if (payload.cpt) { where.push("c.cpt LIKE ?"); params.push("%" + str(payload.cpt, 40).trim() + "%"); }
    if (payload.payer_like) { where.push("c.payer LIKE ?"); params.push("%" + str(payload.payer_like, 80).trim() + "%"); }
    if (payload.min_balance != null && payload.min_balance !== "") { where.push("c.balance >= ?"); params.push(num(payload.min_balance, 0)); }
    if (payload.max_balance != null && payload.max_balance !== "") { where.push("c.balance <= ?"); params.push(num(payload.max_balance, 0)); }
    if (payload.saag_status) { where.push("c.last_status_code = ?"); params.push(str(payload.saag_status, 60)); }
    if (payload.saag_bucket) { where.push("c.last_bucket = ?"); params.push(str(payload.saag_bucket, 20)); }
    if (payload.worked === "yes") where.push("c.last_status_code <> ''");
    if (payload.worked === "no") where.push("c.last_status_code = ''");
    if (payload.follow_up_due) { where.push("c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on <= ?"); params.push(isoDate(payload.today) || isoToday()); }
    if (payload.overdue) { where.push("c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on < ?"); params.push(isoDate(payload.today) || isoToday()); }
    if (payload.q) { const q = "%" + str(payload.q, 80).trim() + "%"; where.push("(c.claim_no LIKE ? OR c.patient LIKE ? OR c.account_no LIKE ? OR c.payer LIKE ?)"); params.push(q, q, q, q); }
    const SORTS = { priority: "c.priority", balance: "c.balance", age_days: "c.age_days", patient: "c.patient", payer: "c.payer", dos: "c.dos", updated_at: "c.updated_at", state: "c.state", assigned: "u.name", follow_up_on: "c.follow_up_on",
      claim_no: "c.claim_no", tier: "c.tier", status_class: "c.status_class", inventory_kind: "c.inventory_kind", provider: "c.provider", cpt: "c.cpt" };
    const sort = SORTS[payload.sort] || "c.priority";
    const dir = payload.dir === "asc" ? "ASC" : "DESC";
    const size = Math.max(10, Math.min(500, Math.round(num(payload.page_size, 50))));
    const page = Math.max(1, Math.round(num(payload.page, 1)));
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt FROM claims c ${w}`, ...params)) || { n: 0, amt: 0 };
    const rows = await all(env, `SELECT c.id, c.client_id, c.location_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.cpt, c.provider, c.balance, c.billed, c.lines, c.age_days, c.bucket, c.tier,
        c.status_class, c.file_status, c.file_sub_status, c.inventory_kind, c.worked_before, c.last_worked_on, c.follow_up_on, c.priority, c.priority_reason, c.state, c.state_reason,
        c.assigned_to, c.assigned_at, c.completed_at, c.skips, c.escalated, c.touches, c.last_status_code, c.last_action_code, c.last_sub_status, c.last_bucket, c.last_effective, c.last_note_action,
        c.last_note, c.updated_at, u.name AS assigned_name, l.name AS location_name
      FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN locations l ON l.id = c.location_id ${w} ORDER BY ${sort} ${dir}, c.balance DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
    return { rows, total: total.n, amount: total.amt, page, page_size: size };
  },
  /* Suggestions under the search boxes: distinct values matching the typed letters, most used first.
     Billers get values from their own claims only; scoped leads from their projects. */
  "claims.suggest": async ({ env, user, payload }) => {
    const q = str(payload.q, 80).trim();
    const where = ["state <> 'excluded'"], params = [];
    if (user.scope) { where.push(`client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); params.push(...user.scope); }
    if (user.role !== "supervisor") { where.push("(assigned_to = ? OR last_worked_by = ?)"); params.push(user.id, user.id); }
    if (payload.client_id) { where.push("client_id = ?"); params.push(str(payload.client_id, 60)); }
    if (payload.location_id) { where.push("location_id = ?"); params.push(str(payload.location_id, 60)); }
    const w = where.join(" AND ");
    const like = "%" + q.replace(/[%_]/g, " ") + "%";
    const col = { payer: "payer", provider: "provider", cpt: "cpt" }[String(payload.field || "")];
    if (col) {
      const rows = await all(env, `SELECT ${col} AS v, COUNT(*) AS n FROM claims WHERE ${w} AND ${col} <> ''${q ? ` AND ${col} LIKE ?` : ""} GROUP BY ${col} ORDER BY n DESC LIMIT 12`, ...params, ...(q ? [like] : []));
      return { values: rows.map((r) => r.v) };
    }
    if (q.length < 2) return { values: [] };
    const [pt, cn, ac] = await Promise.all([
      all(env, `SELECT DISTINCT patient AS v FROM claims WHERE ${w} AND patient LIKE ? LIMIT 6`, ...params, like),
      all(env, `SELECT DISTINCT claim_no AS v FROM claims WHERE ${w} AND claim_no LIKE ? LIMIT 4`, ...params, like),
      all(env, `SELECT DISTINCT account_no AS v FROM claims WHERE ${w} AND account_no <> '' AND account_no LIKE ? LIMIT 4`, ...params, like),
    ]);
    return { values: [...new Set([...pt, ...cn, ...ac].map((r) => r.v).filter(Boolean))].slice(0, 12) };
  },
  "claims.stats": async ({ env, user, payload }) => {
    const where = [], params = [];
    if (user.scope) { where.push(`client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); params.push(...user.scope); }
    // Dashboard date range: only claims with activity in the window (loaded, refreshed, worked or closed then).
    if (payload.from_ms != null || payload.to_ms != null) { where.push("updated_at BETWEEN ? AND ?"); params.push(num(payload.from_ms, 0), num(payload.to_ms, Date.now())); }
    if (payload.client_id) { where.push("client_id = ?"); params.push(payload.client_id); }
    if (payload.location_id) { where.push("location_id = ?"); params.push(payload.location_id); }
    // Dashboard cross-filters: click a bar and every other number is recomputed for that slice.
    for (const f of ["tier", "bucket", "status_class", "payer", "inventory_kind", "assigned_to"]) if (payload[f]) { where.push(`${f} = ?`); params.push(str(payload[f], 200)); }
    if (payload.saag_status) { where.push("last_status_code = ?"); params.push(str(payload.saag_status, 60)); }
    if (payload.saag_bucket) { where.push("last_bucket = ?"); params.push(str(payload.saag_bucket, 20)); }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const ww = (where.length ? w + " AND " : "WHERE ") + `state IN ${WORKABLE}`;
    const today = isoDate(payload.today) || isoToday();
    const [states, tiers, buckets, classes, payers, kinds, users, due, escalated] = await Promise.all([
      all(env, `SELECT state, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${w} GROUP BY state`, ...params),
      all(env, `SELECT tier, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY tier`, ...params),
      all(env, `SELECT bucket, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY bucket`, ...params),
      all(env, `SELECT status_class, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY status_class`, ...params),
      all(env, `SELECT payer, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY payer ORDER BY amt DESC LIMIT 12`, ...params),
      all(env, `SELECT inventory_kind, worked_before, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${ww} GROUP BY inventory_kind, worked_before`, ...params),
      all(env, `SELECT c.assigned_to AS user_id, u.name, u.email, SUM(c.state = 'assigned') AS assigned, SUM(c.state = 'in_progress') AS in_progress,
          SUM(c.state = 'completed') AS completed, SUM(c.state = 'closed') AS closed,
          COALESCE(SUM(CASE WHEN c.state IN ('assigned','in_progress') THEN c.balance END),0) AS amt
        FROM claims c LEFT JOIN users u ON u.id = c.assigned_to ${(where.length ? "WHERE " + where.map((x) => "c." + x).join(" AND ") + " AND " : "WHERE ")} c.assigned_to IS NOT NULL GROUP BY c.assigned_to`, ...params),
      one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?`, ...params, today),
      one(env, `SELECT COUNT(*) AS n FROM claims ${(where.length ? w + " AND " : "WHERE ")} escalated = 1 AND state IN ${WORKABLE}`, ...params),
    ]);
    // Follow-up date passed and nobody has touched the claim since: these need a biller again.
    const overdue = await one(env, `SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} state = 'completed' AND follow_up_on <> '' AND follow_up_on < ?`, ...params, today);
    const [workBuckets, saagStatuses, byLocation] = await Promise.all([
      all(env, `SELECT last_bucket AS bucket, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} last_bucket <> '' GROUP BY last_bucket`, ...params),
      all(env, `SELECT last_status_code AS status, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} last_status_code <> '' GROUP BY last_status_code ORDER BY n DESC`, ...params),
      all(env, `SELECT c.client_id, cl.name AS client_name, c.location_id, l.name AS location_name,
          SUM(c.state = 'open') AS open_n, COALESCE(SUM(CASE WHEN c.state = 'open' THEN c.balance END),0) AS open_amt,
          SUM(c.state IN ('assigned','in_progress')) AS desk_n, COALESCE(SUM(CASE WHEN c.state IN ('assigned','in_progress') THEN c.balance END),0) AS desk_amt,
          SUM(c.state = 'completed') AS worked_n, COALESCE(SUM(CASE WHEN c.state = 'completed' THEN c.balance END),0) AS worked_amt,
          SUM(c.state = 'closed') AS closed_n, COALESCE(SUM(CASE WHEN c.state = 'closed' THEN c.balance END),0) AS closed_amt,
          SUM(c.state = 'completed' AND c.follow_up_on <> '' AND c.follow_up_on < ?) AS overdue_n,
          COUNT(*) AS n, COALESCE(SUM(CASE WHEN c.state IN ${WORKABLE} THEN c.balance END),0) AS amt
        FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id ${(where.length ? "WHERE " + where.map((x) => "c." + x).join(" AND ") : "")}
        GROUP BY c.client_id, c.location_id ORDER BY cl.name, l.name`, today, ...params),
    ]);
    return { states, tiers, buckets, classes, payers, kinds, users, follow_ups_due: due, overdue, escalated: escalated ? escalated.n : 0, work_buckets: workBuckets, saag_statuses: saagStatuses, by_location: byLocation };
  },
  /* Every claim of one patient (same account number, or same patient name) at a client, with the last entry on each: one call covers them all. */
  "claims.byPatient": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, account_no, patient FROM claims WHERE id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (user.role === "supervisor" && !inScope(user, c.client_id)) throw outOfScope();
    const rows = await all(env, `SELECT c.id, c.claim_no, c.account_no, c.patient, c.dos, c.cpt, c.payer, c.provider, c.balance, c.age_days, c.tier, c.state, c.assigned_to, u.name AS assigned_name, c.priority, c.follow_up_on,
        c.last_status_code, c.last_sub_status, c.last_action_code, c.last_bucket, c.last_note, c.last_worked_on, c.file_status, c.file_sub_status, l.name AS location_name
      FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN locations l ON l.id = c.location_id
      WHERE c.client_id = ? AND ((c.account_no <> '' AND c.account_no = ?) OR (c.patient <> '' AND c.patient = ?)) ORDER BY c.state IN ('open','assigned','in_progress','completed') DESC, c.priority DESC LIMIT 200`,
      c.client_id, c.account_no || "\u0000", c.patient || "\u0000");
    return { patient: c.patient, account_no: c.account_no, rows: rows.map((r) => ({ ...r, mine: r.assigned_to === user.id })) };
  },
  "claims.eligible": async ({ env, payload }) => {
    if (!payload.client_id) throw bad("Pick a client.");
    const where = ["client_id = ?"], params = [payload.client_id];
    if (payload.location_id) { where.push("location_id = ?"); params.push(payload.location_id); }
    const today = isoDate(payload.today) || isoToday();
    where.push("((state = 'open') OR (state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?))"); params.push(today);
    const rows = await all(env, `SELECT id, location_id, claim_no, account_no, patient, payer, dos, cpt, balance, age_days, bucket, tier, status_class, inventory_kind, worked_before,
        last_worked_on, follow_up_on, priority, priority_reason, state, skips, escalated, touches FROM claims WHERE ${where.join(" AND ")} ORDER BY priority DESC LIMIT 20000`, ...params);
    return { claims: rows };
  },
  "claims.get": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT c.*, u.name AS assigned_name, l.name AS location_name, cl.name AS client_name FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (!leadFor(user, c.client_id) && c.assigned_to !== user.id && c.last_worked_by !== user.id) throw denied("This claim is not in your queue.");
    return claimBundle(env, user, c);
  },
  /* Everything that happened to one claim, newest first: loads and refreshes, assignments, openings, work entries
     (SAAG, the note fields and what changed), notes, escalations and answers, skips, files and state changes. */
  "claims.timeline": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT c.*, u.name AS assigned_name FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (!leadFor(user, c.client_id) && c.assigned_to !== user.id && c.last_worked_by !== user.id) throw denied("This claim is not in your queue.");
    const [notes, files, events] = await Promise.all([
      all(env, "SELECT * FROM notes WHERE claim_id = ? ORDER BY created_at DESC LIMIT 300", c.id),
      all(env, "SELECT id, user_name, name, type, size, created_at FROM attachments WHERE claim_id = ? ORDER BY created_at DESC LIMIT 200", c.id),
      all(env, "SELECT * FROM claim_events WHERE claim_id = ? ORDER BY at DESC LIMIT 500", c.id),
    ]);
    const out = [];
    const workEv = events.filter((e) => e.kind === "worked");
    for (const n of notes) {
      const f = noteFields(n);
      if (n.kind === "work") {
        const ev = workEv.find((e) => e.user_id === n.user_id && Math.abs(e.at - n.created_at) < 5000);
        const d = ev ? jsonObj(ev.data_json) : {};
        out.push({ at: n.created_at, kind: "work", id: n.id, editable: Date.now() - n.created_at <= EDIT_WINDOW_MS && (n.user_id === user.id || leadFor(user, c.client_id)), who: n.user_name, saag: { status: n.status || n.status_code, sub_status: n.sub_status, action: n.action || n.action_code, bucket: n.bucket, effective: n.effective },
          follow_up_on: n.follow_up_on, fields: f, comment: n.comment, changes: d.changes || {}, escalated: !!d.escalated, edited_at: n.edited_at });
      } else if (n.kind === "skip") out.push({ at: n.created_at, kind: "skip", who: n.user_name, text: n.comment });
      else if (/^Escalation answered:/.test(n.comment || "")) out.push({ at: n.created_at, kind: "answer", who: n.user_name, text: n.comment.replace(/^Escalation answered:\s*/, "") });
      else out.push({ at: n.created_at, kind: "note", who: n.user_name, fields: f && f.findings != null ? f : null, text: n.comment });
    }
    for (const a of files) out.push({ at: a.created_at, kind: "file", who: a.user_name, file: { id: a.id, name: a.name, size: a.size, type: a.type } });
    for (const e of events) if (e.kind !== "worked" && e.kind !== "edited") { const d = jsonObj(e.data_json); out.push({ at: e.at, kind: e.kind, who: e.user_name, text: e.text, changes: d.changes || {}, data: d }); }
    // Claims from before the event log: the first upload and the current assignment still show.
    const batch = c.first_batch_id ? await one(env, "SELECT b.file_name, b.kind, u.name AS by_name FROM batches b LEFT JOIN users u ON u.id = b.uploaded_by WHERE b.id = ?", c.first_batch_id) : null;
    out.push({ at: c.created_at, kind: "loaded", who: batch ? batch.by_name || "" : "", text: batch ? batch.file_name : "", data: { kind: c.inventory_kind, file_status: [c.file_status, c.file_sub_status].filter(Boolean).join(" · ") } });
    if (c.assigned_at && !events.some((e) => e.kind === "assigned")) out.push({ at: c.assigned_at, kind: "assigned", who: "", text: c.assigned_name || "", data: {}, changes: {} });
    if (c.escalated && c.escalated_at && !notes.some((n) => n.kind === "work" && Math.abs(n.created_at - c.escalated_at) < 5000)) out.push({ at: c.escalated_at, kind: "escalated", who: "", text: "" });
    out.sort((a, b) => b.at - a.at);
    return { claim: { id: c.id, claim_no: c.claim_no, patient: c.patient, payer: c.payer }, items: out };
  },
  "claims.setState": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const state = ["open", "excluded", "closed"].includes(payload.state) ? payload.state : null;
    if (!ids.length || !state) throw bad("Pick claims and a state.");
    const reason = str(payload.reason, 200) || (state === "open" ? "Reopened by supervisor" : (state === "closed" ? "Closed by supervisor" : "Excluded by supervisor"));
    const now = Date.now();
    let changed = 0;
    for (const part of chunks(ids, 80)) { const rows = await all(env, `SELECT id, state FROM claims WHERE id IN (${part.map(() => "?").join(",")})${scopeSql(user, "client_id")}`, ...part, ...scopeArgs(user));
      const evs = rows.filter((r) => r.state !== state).map((r) => claimEvent(env, r.id, user, "state", reason, { changes: { state: [r.state, state] } })); if (evs.length) await batchAll(env, evs, 50); }
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET state = ?, state_reason = ?, assigned_to = CASE WHEN ? = 'open' THEN NULL ELSE assigned_to END, assigned_at = CASE WHEN ? = 'open' THEN NULL ELSE assigned_at END,
        skipped_at = NULL, escalated = CASE WHEN ? = 'open' THEN escalated ELSE 0 END, updated_at = ? WHERE id IN (${chunk.map(() => "?").join(",")})${scopeSql(user, "client_id")}`, state, reason, state, state, state, now, ...chunk, ...scopeArgs(user));
      changed += changesOf(r);
    }
    return { changed };
  },

  /* ---- allocation ---- */
  "alloc.apply": async ({ env, user, payload }) => {
    const { client_id, location_id, strategy } = payload;
    const items = Array.isArray(payload.assignments) ? payload.assignments : [];
    if (!client_id) throw bad("Pick a client.");
    if (!items.length) throw bad("Nothing to assign.");
    const userIds = [...new Set(items.map((a) => str(a.user_id, 60)))];
    const users = await all(env, `SELECT id FROM users WHERE active = 1 AND id IN (${userIds.map(() => "?").join(",")})`, ...userIds);
    const ok = new Set(users.map((u) => u.id));
    const today = isoDate(payload.today) || isoToday();
    const now = Date.now();
    const names = new Map((await all(env, `SELECT id, name FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`, ...userIds)).map((u) => [u.id, u.name]));
    const before = new Map();
    for (const part of chunks(items.map((a) => str(a.id, 60)), 80)) (await all(env, `SELECT id, assigned_to, state, follow_up_on FROM claims WHERE id IN (${part.map(() => "?").join(",")}) AND client_id = ?`, ...part, client_id)).forEach((r) => before.set(r.id, r));
    const eligible = (a) => { const b = before.get(str(a.id, 60)); return b && (b.state === "open" || (b.state === "completed" && b.follow_up_on && b.follow_up_on <= today)); };
    const prevNames = new Map((await all(env, `SELECT id, name FROM users WHERE id IN (${[...new Set([...before.values()].map((b) => b.assigned_to).filter(Boolean)), ""].map(() => "?").join(",")})`, ...[...new Set([...before.values()].map((b) => b.assigned_to).filter(Boolean)), ""])).map((u) => [u.id, u.name]));
    const evs = items.filter((a) => ok.has(str(a.user_id, 60)) && eligible(a)).map((a) => { const b = before.get(str(a.id, 60)); return claimEvent(env, b.id, user, "assigned", names.get(str(a.user_id, 60)) || "", { from: b.assigned_to ? prevNames.get(b.assigned_to) || "" : "", via: str(strategy, 40) || "allocate" }); });
    const stmts = items.filter((a) => ok.has(str(a.user_id, 60))).map((a) =>
      env.DB.prepare(`UPDATE claims SET assigned_to = ?, assigned_at = ?, state = 'assigned', state_reason = '', priority = ?, priority_reason = ?, tier = CASE WHEN ? <> '' THEN ? ELSE tier END,
          age_days = COALESCE(?, age_days), bucket = CASE WHEN ? <> '' THEN ? ELSE bucket END, skipped_at = NULL, skips = 0, updated_at = ?
        WHERE id = ? AND client_id = ? AND (state = 'open' OR (state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?))`)
        .bind(str(a.user_id, 60), now, num(a.priority, 0), str(a.priority_reason, 300), str(a.tier, 10), str(a.tier, 10), a.age_days == null ? null : Math.round(num(a.age_days, 0)),
          str(a.bucket, 20), str(a.bucket, 20), now, str(a.id, 60), client_id, today));
    const results = await batchAll(env, stmts, 50);
    const applied = results.reduce((s, r) => s + changesOf(r), 0);
    if (evs.length) await batchAll(env, evs, 50);
    const id = uuid();
    await run(env, "INSERT INTO allocations (id, client_id, location_id, by_user, at, strategy, count, summary_json) VALUES (?,?,?,?,?,?,?,?)",
      id, client_id, location_id || null, user.id, now, str(strategy, 40), applied, str(JSON.stringify(payload.summary || {}), 20000));
    return { applied, allocation_id: id, skipped: items.length - applied };
  },
  "alloc.reassign": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const u = await one(env, "SELECT id, name FROM users WHERE id = ? AND active = 1", payload.user_id);
    if (!ids.length || !u) throw bad("Pick claims and an active team member.");
    const now = Date.now();
    let changed = 0;
    const evs = [];
    for (const part of chunks(ids, 80)) for (const r of await all(env, `SELECT c.id, u.name AS prev FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id IN (${part.map(() => "?").join(",")}) AND c.state IN ${WORKABLE}${scopeSql(user, "c.client_id")}`, ...part, ...scopeArgs(user)))
      evs.push(claimEvent(env, r.id, user, "assigned", u.name, { from: r.prev || "", via: "reassign" }));
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET assigned_to = ?, assigned_at = ?, state = CASE WHEN state IN ('open','completed','in_progress') THEN 'assigned' ELSE state END, skipped_at = NULL, updated_at = ?
        WHERE id IN (${chunk.map(() => "?").join(",")}) AND state IN ${WORKABLE}${scopeSql(user, "client_id")}`, u.id, now, now, ...chunk, ...scopeArgs(user));
      changed += changesOf(r);
    }
    if (evs.length) await batchAll(env, evs, 50);
    return { changed };
  },
  "alloc.unassign": async ({ env, user, payload }) => {
    const now = Date.now();
    const logOff = async (where, args) => { const rows = await all(env, `SELECT c.id, u.name AS prev FROM claims c LEFT JOIN users u ON u.id = c.assigned_to WHERE ${where}${scopeSql(user, "c.client_id")}`, ...args, ...scopeArgs(user)); if (rows.length) await batchAll(env, rows.map((r) => claimEvent(env, r.id, user, "unassigned", r.prev || "")), 50); };
    if (payload.user_id) {
      const where = ["assigned_to = ?", "state IN ('assigned','in_progress')"], params = [str(payload.user_id, 60)];
      if (payload.client_id) { where.push("client_id = ?"); params.push(payload.client_id); }
      await logOff(where.map((w) => "c." + w).join(" AND "), params);
      const r = await run(env, `UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', skipped_at = NULL, updated_at = ? WHERE ${where.join(" AND ")}${scopeSql(user, "client_id")}`, now, ...params, ...scopeArgs(user));
      return { changed: changesOf(r) };
    }
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    if (!ids.length) throw bad("Pick claims to unassign.");
    let changed = 0;
    for (const part of chunks(ids, 80)) await logOff(`c.id IN (${part.map(() => "?").join(",")}) AND c.state IN ('assigned','in_progress')`, part);
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', skipped_at = NULL, updated_at = ? WHERE id IN (${chunk.map(() => "?").join(",")}) AND state IN ('assigned','in_progress')${scopeSql(user, "client_id")}`, now, ...chunk, ...scopeArgs(user));
      changed += changesOf(r);
    }
    return { changed };
  },

  /* ---- the user's queue ---- */
  "queue.summary": async ({ env, user, payload }) => {
    const today = isoDate(payload.today) || isoToday();
    const from = num(payload.day_from_ms, 0), to = num(payload.day_to_ms, Date.now());
    const [ready, waiting, current, done, skipped, byClient] = await Promise.all([
      one(env, "SELECT COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims WHERE assigned_to = ? AND state = 'assigned' AND (follow_up_on = '' OR follow_up_on <= ?)", user.id, today),
      one(env, "SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'assigned' AND follow_up_on > ?", user.id, today),
      one(env, "SELECT id FROM claims WHERE assigned_to = ? AND state = 'in_progress' LIMIT 1", user.id),
      one(env, "SELECT COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.user_id = ? AND nt.kind = 'work' AND nt.created_at BETWEEN ? AND ?", user.id, from, to),
      one(env, "SELECT COUNT(*) AS n FROM claims WHERE assigned_to = ? AND state = 'assigned' AND skipped_at IS NOT NULL", user.id),
      all(env, "SELECT cl.name AS client_name, l.name AS location_name, COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt FROM claims c JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE c.assigned_to = ? AND c.state = 'assigned' GROUP BY c.client_id, c.location_id ORDER BY n DESC", user.id),
    ]);
    return { ready, waiting: waiting ? waiting.n : 0, in_progress_id: current ? current.id : null, done_today: done, skipped: skipped ? skipped.n : 0, by_client: byClient };
  },
  "queue.next": async ({ env, user, payload }) => {
    const today = isoDate(payload.today) || isoToday();
    const now = Date.now();
    // "Next" while a claim is open: that claim goes back to the list (nothing saved) and the following one opens.
    const skipId = str(payload.skip_id, 60);
    if (skipId) await run(env, "UPDATE claims SET state = 'assigned', started_at = NULL, updated_at = ? WHERE id = ? AND assigned_to = ? AND state = 'in_progress'", now, skipId, user.id);
    let c = await one(env, "SELECT * FROM claims WHERE assigned_to = ? AND state = 'in_progress' LIMIT 1", user.id);
    // Pick the top claim in two plain steps (no RETURNING / subquery update), retrying once if it was taken meanwhile.
    for (let attempt = 0; !c && attempt < 2; attempt++) {
      const cand = await one(env, `SELECT id FROM claims WHERE assigned_to = ? AND state = 'assigned' AND (follow_up_on = '' OR follow_up_on IS NULL OR follow_up_on <= ?)
          ORDER BY CASE WHEN id = ? THEN 1 ELSE 0 END, CASE WHEN skipped_at IS NULL THEN 0 ELSE 1 END, priority DESC, balance DESC, age_days DESC LIMIT 1`, user.id, today, skipId || "");
      if (!cand) break;
      const r = await run(env, "UPDATE claims SET state = 'in_progress', started_at = ?, updated_at = ? WHERE id = ? AND state = 'assigned'", now, now, cand.id);
      if (changesOf(r)) { c = await one(env, "SELECT * FROM claims WHERE id = ?", cand.id); await claimEvent(env, c.id, user, "opened", "Next claim").run(); }
    }
    if (!c) return { claim: null };
    const full = await one(env, "SELECT c.*, u.name AS assigned_name, l.name AS location_name, cl.name AS client_name, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", c.id);
    return claimBundle(env, user, full);
  },
  "queue.skip": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT * FROM claims WHERE id = ?", payload.id);
    if (!c || c.assigned_to !== user.id) throw denied("This claim is not in your queue.");
    if (c.state !== "in_progress") throw bad("This claim is not open on your desk.");
    const now = Date.now();
    const reason = str(payload.reason, 500).trim();
    const count = payload.count === false ? 0 : 1;
    const stmts = [env.DB.prepare("UPDATE claims SET state = 'assigned', started_at = NULL, skipped_at = CASE WHEN ? = 1 THEN ? ELSE skipped_at END, skips = skips + ?, updated_at = ? WHERE id = ?").bind(count, now, count, now, c.id)];
    if (reason) stmts.push(env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'skip',?,?)").bind(uuid(), c.id, user.id, user.name, reason, now));
    else stmts.push(claimEvent(env, c.id, user, count ? "skipped" : "returned", ""));
    await env.DB.batch(stmts);
    return { ok: true };
  },
  "queue.complete": async ({ env, user, payload, ctx }) => {
    const c = await one(env, "SELECT c.*, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (c.assigned_to !== user.id && !leadFor(user, c.client_id)) throw denied("This claim is not on your desk.");
    if (!["in_progress", "assigned", "completed"].includes(c.state)) throw bad("This claim is not open for work (it is " + c.state + ").");
    const saag = validateWork(payload);
    const fields = cleanNoteFields(payload.note, c);
    const lastWork = await one(env, "SELECT MAX(created_at) AS at FROM notes WHERE claim_id = ? AND kind = 'work'", c.id);
    await requireAttachment(env, c.id, saag, fields, lastWork && lastWork.at);
    const today = isoDate(payload.today) || isoToday();
    const closed = isClosedWork(saag, fields);
    // A follow-up date in the past would make the claim "overdue" the moment it is saved; the earliest is today.
    const wanted = isoDate(payload.follow_up_on);
    const followUp = closed ? "" : ((wanted && wanted >= today ? wanted : "") || addDays(today, followUpDays(saag.effective, c.client_follow_up_days)));
    const comment = composeNote(fields, saag, followUp);
    const escalate = payload.escalate ? 1 : 0;
    const now = Date.now();
    const targets = [c];
    const sibIds = (Array.isArray(payload.sibling_ids) ? payload.sibling_ids : []).map((x) => str(x, 60)).filter((x) => x && x !== c.id).slice(0, 50);
    if (sibIds.length) {
      const sibs = await all(env, `SELECT * FROM claims WHERE id IN (${sibIds.map(() => "?").join(",")}) AND client_id = ? AND assigned_to = ? AND state IN ('assigned','in_progress','completed')`, ...sibIds, c.client_id, user.id);
      targets.push(...sibs);
    }
    const newState = closed ? "closed" : "completed";
    const reason = closed ? "Closed: " + saag.effective + (saag.bucket === "Closed" ? "" : " (bucket " + saag.bucket + ")") : "";
    const stmts = [];
    for (const t of targets) {
      const ch = {}; const diff = (k, a, b) => { if (String(a || "") !== String(b || "")) ch[k] = [a || "", b || ""]; };
      diff("state", t.state === "in_progress" ? "assigned" : t.state, newState); diff("bucket", t.last_bucket, saag.bucket); diff("follow_up", t.follow_up_on, followUp); diff("status", t.last_status_code, saag.status);
      stmts.push(claimEvent(env, t.id, user, "worked", "", { changes: ch, escalated: !!escalate, siblings: t.id === c.id ? targets.length - 1 : 0 }));
      const f = t.id === c.id ? fields : { ...fields, dos: mmdd(t.dos) || fields.dos, clm: t.claim_no || fields.clm, findings: fields.findings + " (applied with claim " + (c.claim_no || c.id.slice(0, 8)) + ")" };
      const text = t.id === c.id ? comment : composeNote(f, saag, followUp);
      stmts.push(env.DB.prepare(`INSERT INTO notes (id, claim_id, user_id, user_name, kind, status_code, action_code, comment, follow_up_on, created_at, status, sub_status, action, bucket, effective, note_action, fields_json)
          VALUES (?,?,?,?,'work',?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(uuid(), t.id, user.id, user.name, saag.status, saag.action, text, followUp, now, saag.status, saag.sub_status, saag.action, saag.bucket, saag.effective, f.action, JSON.stringify(f)));
      stmts.push(env.DB.prepare(`UPDATE claims SET state = ?, state_reason = ?, started_at = NULL, completed_at = ?, last_status_code = ?, last_action_code = ?, last_sub_status = ?, last_bucket = ?, last_effective = ?, last_note_action = ?,
          last_note = ?, last_worked_by = ?, last_worked_on = ?, follow_up_on = ?, touches = touches + 1, worked_before = 1, escalated = ?, skipped_at = NULL, updated_at = ?,
          escalated_at = CASE WHEN ? = 1 AND (escalated = 0 OR escalated_at IS NULL) THEN ? WHEN ? = 1 THEN escalated_at ELSE NULL END, escalated_by = CASE WHEN ? = 1 THEN ? ELSE NULL END WHERE id = ?`)
        .bind(newState, reason, now, saag.status, saag.action, saag.sub_status, saag.bucket, saag.effective, f.action, text.slice(0, 600), user.id, today, followUp, escalate, now, escalate, now, escalate, escalate, user.id, t.id));
    }
    await batchAll(env, stmts);
    // Copy the entry into the client's / location's OneDrive workbook in the background (when a link is set and Microsoft 365 is configured).
    if (!env.DEMO && env.MS_CLIENT_SECRET) { for (const t of targets) { const p = syncEntryToWorkbook(env, t.id, user, { started_at: t.started_at, ended_at: now }); if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p; } }
    return { completed: targets.length, closed, follow_up_on: followUp, state: newState, comment };
  },
  /* Open a specific claim from the day list (instead of "next"). Any other claim open on the desk goes back to assigned. */
  "queue.open": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT * FROM claims WHERE id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (c.assigned_to !== user.id && !leadFor(user, c.client_id)) throw denied("This claim is not on your desk.");
    if (!["assigned", "in_progress", "completed"].includes(c.state)) throw bad("This claim is " + c.state + " and cannot be opened for work.");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE claims SET state = 'assigned', started_at = NULL, updated_at = ? WHERE assigned_to = ? AND state = 'in_progress' AND id <> ?").bind(now, user.id, c.id),
      env.DB.prepare("UPDATE claims SET state = 'in_progress', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").bind(now, now, c.id),
      ...(c.state !== "in_progress" ? [claimEvent(env, c.id, user, "opened", "From the day list")] : []),
    ]);
    const full = await one(env, "SELECT c.*, u.name AS assigned_name, l.name AS location_name, cl.name AS client_name, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", c.id);
    return claimBundle(env, user, full);
  },
  /* The biller's day: everything on the desk plus what was worked since the start of the day, with filters. */
  "queue.list": async ({ env, user, payload }) => {
    const from = num(payload.day_from_ms, 0);
    const where = ["c.assigned_to = ?", "(c.state IN ('assigned','in_progress') OR (c.state IN ('completed','closed') AND c.completed_at >= ?))"];
    const params = [user.id, from];
    if (payload.q) { const q = "%" + str(payload.q, 80).trim() + "%"; where.push("(c.claim_no LIKE ? OR c.patient LIKE ? OR c.account_no LIKE ?)"); params.push(q, q, q); }
    if (payload.payer) { where.push("c.payer LIKE ?"); params.push("%" + str(payload.payer, 80).trim() + "%"); }
    if (payload.provider) { where.push("c.provider LIKE ?"); params.push("%" + str(payload.provider, 80).trim() + "%"); }
    if (payload.cpt) { where.push("c.cpt LIKE ?"); params.push("%" + str(payload.cpt, 40).trim() + "%"); }
    if (payload.min_balance != null && payload.min_balance !== "") { where.push("c.balance >= ?"); params.push(num(payload.min_balance, 0)); }
    if (payload.max_balance != null && payload.max_balance !== "") { where.push("c.balance <= ?"); params.push(num(payload.max_balance, 0)); }
    if (payload.saag_status) { where.push("c.last_status_code = ?"); params.push(str(payload.saag_status, 60)); }
    if (payload.saag_bucket) { where.push("c.last_bucket = ?"); params.push(str(payload.saag_bucket, 20)); }
    if (payload.state) { where.push("c.state = ?"); params.push(str(payload.state, 20)); }
    if (payload.client_id) { where.push("c.client_id = ?"); params.push(str(payload.client_id, 60)); }
    if (payload.location_id) { where.push("c.location_id = ?"); params.push(str(payload.location_id, 60)); }
    const rows = await all(env, `SELECT c.id, c.client_id, c.location_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.cpt, c.provider, c.balance, c.age_days, c.bucket, c.tier, c.status_class,
        c.file_status, c.file_sub_status, c.inventory_kind, c.worked_before, c.follow_up_on, c.priority, c.priority_reason, c.state, c.assigned_at, c.started_at, c.completed_at, c.skips, c.escalated,
        c.last_status_code, c.last_action_code, c.last_sub_status, c.last_bucket, c.last_effective, c.last_note_action, c.last_worked_on, cl.name AS client_name, l.name AS location_name
      FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE ${where.join(" AND ")}
      ORDER BY CASE c.state WHEN 'in_progress' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, CASE WHEN c.skipped_at IS NULL THEN 0 ELSE 1 END, c.priority DESC, c.balance DESC LIMIT 1000`, ...params);
    return { rows };
  },
  /* Edit a work note within 24 hours of writing it (author or team lead). After that it is read-only. */
  "notes.update": async ({ env, user, payload }) => {
    const n = await one(env, "SELECT * FROM notes WHERE id = ?", payload.id);
    if (!n || n.kind !== "work") throw bad("Note not found.");
    if (Date.now() - n.created_at > EDIT_WINDOW_MS) throw new ApiError(403, "Notes can be edited for 24 hours after they are written. This one is now read-only.");
    const c = await one(env, "SELECT c.*, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", n.claim_id);
    if (n.user_id !== user.id && !(c && leadFor(user, c.client_id))) throw denied("Only the author or a team lead can edit this note.");
    if (!c) throw bad("Claim not found.");
    const saag = validateWork(payload);
    const fields = cleanNoteFields(payload.note, c);
    if (!attachNeeded({ sub_status: n.sub_status, action: n.action }, { action: n.note_action })) {
      const prev = await one(env, "SELECT MAX(created_at) AS at FROM notes WHERE claim_id = ? AND kind = 'work' AND created_at < ?", c.id, n.created_at);
      await requireAttachment(env, c.id, saag, fields, prev && prev.at);
    }
    const today = isoDate(payload.today) || isoToday();
    const closed = isClosedWork(saag, fields);
    const wantedFu = isoDate(payload.follow_up_on);
    const followUp = closed ? "" : ((wantedFu && wantedFu >= today ? wantedFu : "") || n.follow_up_on || addDays(today, followUpDays(saag.effective, c.client_follow_up_days)));
    const comment = composeNote(fields, saag, followUp);
    const now = Date.now();
    const stmts = [env.DB.prepare(`UPDATE notes SET status_code = ?, action_code = ?, comment = ?, follow_up_on = ?, status = ?, sub_status = ?, action = ?, bucket = ?, effective = ?, note_action = ?, fields_json = ?, edited_at = ?, edited_by = ? WHERE id = ?`)
      .bind(saag.status, saag.action, comment, followUp, saag.status, saag.sub_status, saag.action, saag.bucket, saag.effective, fields.action, JSON.stringify(fields), now, user.id, n.id)];
    const latest = await one(env, "SELECT id FROM notes WHERE claim_id = ? AND kind = 'work' ORDER BY created_at DESC LIMIT 1", c.id);
    if (latest && latest.id === n.id && c.state !== "in_progress" && c.state !== "assigned") {
      const newState = closed ? "closed" : (c.state === "closed" ? "completed" : c.state);
      stmts.push(env.DB.prepare(`UPDATE claims SET state = ?, state_reason = ?, last_status_code = ?, last_action_code = ?, last_sub_status = ?, last_bucket = ?, last_effective = ?, last_note_action = ?, last_note = ?, follow_up_on = ?, updated_at = ? WHERE id = ?`)
        .bind(newState, closed ? "Closed: " + saag.effective : "", saag.status, saag.action, saag.sub_status, saag.bucket, saag.effective, fields.action, comment.slice(0, 600), followUp, now, c.id));
    }
    stmts.push(claimEvent(env, c.id, user, "edited", "", { note_id: n.id }));
    await env.DB.batch(stmts);
    return { ok: true, comment, closed };
  },
  "history.mine": async ({ env, user, payload }) => {
    const from = num(payload.from_ms, 0), to = num(payload.to_ms, Date.now());
    const rows = await all(env, `SELECT nt.id AS note_id, nt.kind, nt.status_code, nt.action_code, nt.comment, nt.follow_up_on, nt.created_at, nt.status, nt.sub_status, nt.action, nt.bucket, nt.effective, nt.note_action, nt.edited_at,
        c.id AS claim_id, c.claim_no, c.account_no, c.patient, c.payer, c.provider, c.cpt, c.dos, c.balance, c.state, c.tier, c.bucket AS age_bucket, cl.name AS client_name, l.name AS location_name
      FROM notes nt JOIN claims c ON c.id = nt.claim_id LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
      WHERE nt.user_id = ? AND nt.created_at BETWEEN ? AND ? ORDER BY nt.created_at DESC LIMIT 1000`, user.id, from, to);
    return { rows };
  },
  "notes.add": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, assigned_to, last_worked_by FROM claims WHERE id = ?", payload.claim_id);
    if (!c) throw bad("Claim not found.");
    if (!leadFor(user, c.client_id) && c.assigned_to !== user.id && c.last_worked_by !== user.id) throw denied("This claim is not in your queue.");
    // A note in the standard format (DOS, CLM#, DENIAL, SOURCE/REF, PRE CALL CHECK, RCA/FINDINGS, ACTION) without a SAAG entry; plain text still works.
    let comment, fields = null;
    if (payload.note) {
      const full = await one(env, "SELECT dos, claim_no FROM claims WHERE id = ?", c.id);
      fields = cleanNoteFields(payload.note, full);
      if (!commentOk(fields.findings)) throw bad("Write what you found (RCA / findings), a few words at least.");
      if (fields.source === "Call" && !fields.ref) throw bad("A call needs its reference number (REF).");
      comment = composeNote(fields, null, "");
    } else {
      comment = str(payload.comment, 4000).trim();
      if (!commentOk(comment)) throw bad("Write a few words.");
    }
    const now = Date.now(), id = uuid();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at, note_action, fields_json) VALUES (?,?,?,?,'note',?,?,?,?)").bind(id, c.id, user.id, user.name, comment, now, fields ? fields.action : "", JSON.stringify(fields || {})),
      env.DB.prepare("UPDATE claims SET updated_at = ? WHERE id = ?").bind(now, c.id),
    ]);
    return { note: { id, claim_id: c.id, user_id: user.id, user_name: user.name, kind: "note", comment, created_at: now, fields } };
  },

  /* ---- attachments: files kept with a claim, next to its notes (EOBs, denial letters, portal screenshots) ---- */
  "attachments.add": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, assigned_to, last_worked_by FROM claims WHERE id = ?", payload.claim_id);
    if (!c) throw bad("Claim not found.");
    if (!leadFor(user, c.client_id) && c.assigned_to !== user.id && c.last_worked_by !== user.id) throw denied("This claim is not in your queue.");
    const name = str(payload.name, 200).replace(/[\\/\u0000-\u001f]/g, "_").trim();
    if (!name) throw bad("The file has no name.");
    const data = String(payload.data || "");
    if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw bad("The file could not be read. Try attaching it again.");
    const size = Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (size > ATTACH_MAX_BYTES) throw bad("Files can be up to " + ATTACH_MAX_BYTES / 1048576 + " MB.");
    const type = str(payload.type, 120);
    const parts = [];
    for (let i = 0; i < data.length; i += ATTACH_PART_CHARS) parts.push(data.slice(i, i + ATTACH_PART_CHARS));
    const now = Date.now(), id = uuid();
    // One part per statement keeps each request to D1 small.
    for (let i = 0; i < parts.length; i++) await run(env, "INSERT INTO attachment_parts (attachment_id, seq, data) VALUES (?,?,?)", id, i, parts[i]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO attachments (id, claim_id, user_id, user_name, name, type, size, parts, created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, c.id, user.id, user.name, name, type, size, parts.length, now),
      env.DB.prepare("UPDATE claims SET updated_at = ? WHERE id = ?").bind(now, c.id),
    ]);
    return { attachment: { id, claim_id: c.id, user_id: user.id, user_name: user.name, name, type, size, created_at: now, deletable: true } };
  },
  "attachments.get": async ({ env, user, payload }) => {
    const a = await one(env, "SELECT * FROM attachments WHERE id = ?", payload.id);
    if (!a) throw bad("This file is no longer attached.");
    const c = await one(env, "SELECT client_id, assigned_to, last_worked_by FROM claims WHERE id = ?", a.claim_id);
    if (!c || (!leadFor(user, c.client_id) && c.assigned_to !== user.id && c.last_worked_by !== user.id)) throw denied("This claim is not in your queue.");
    const parts = await all(env, "SELECT data FROM attachment_parts WHERE attachment_id = ? ORDER BY seq", a.id);
    return { name: a.name, type: a.type, size: a.size, data: parts.map((p) => p.data).join("") };
  },
  /* The person who attached a file can remove it for 24 hours; a team lead can remove it any time. */
  "attachments.delete": async ({ env, user, payload }) => {
    const a = await one(env, "SELECT * FROM attachments WHERE id = ?", payload.id);
    if (!a) throw bad("This file is no longer attached.");
    const ac = await one(env, "SELECT client_id FROM claims WHERE id = ?", a.claim_id);
    if (!(ac && leadFor(user, ac.client_id)) && (a.user_id !== user.id || Date.now() - a.created_at > EDIT_WINDOW_MS)) throw denied("Only the person who attached it (within 24 hours) or a team lead can remove this file.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM attachment_parts WHERE attachment_id = ?").bind(a.id),
      env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(a.id),
    ]);
    return { ok: true };
  },

  /* ---- reports ---- */
  "reports.work": async ({ env, user, payload }) => {
    const where = ["nt.created_at BETWEEN ? AND ?"], params = [num(payload.from_ms, 0), num(payload.to_ms, Date.now())];
    if (user.scope) { where.push(`c.client_id IN (${user.scope.length ? user.scope.map(() => "?").join(",") : "NULL"})`); params.push(...user.scope); }
    if (payload.client_id) { where.push("c.client_id = ?"); params.push(payload.client_id); }
    if (payload.location_id) { where.push("c.location_id = ?"); params.push(payload.location_id); }
    if (payload.user_id) { where.push("nt.user_id = ?"); params.push(payload.user_id); }
    if (payload.kind) { where.push("nt.kind = ?"); params.push(str(payload.kind, 20)); }
    const rows = await all(env, `SELECT nt.created_at, nt.user_name, nt.kind, nt.status_code, nt.action_code, nt.comment, nt.follow_up_on, nt.status, nt.sub_status, nt.action, nt.bucket AS work_bucket, nt.effective, nt.note_action, nt.fields_json, nt.edited_at,
        c.id AS claim_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.cpt, c.provider,
        c.balance, c.billed, c.age_days, c.bucket, c.tier, c.status_class, c.state, c.inventory_kind, c.worked_before, c.file_status, c.file_sub_status, cl.name AS client_name, l.name AS location_name
      FROM notes nt JOIN claims c ON c.id = nt.claim_id LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id WHERE ${where.join(" AND ")} ORDER BY nt.created_at DESC LIMIT 5000`, ...params);
    return { rows };
  },
  "supervisor.productivity": async ({ env, user, payload }) => {
    const off = Math.round(num(payload.tz_offset_min, 0)) * 60;
    const rows = await all(env, `SELECT nt.user_id, nt.user_name, date((nt.created_at / 1000) + ?, 'unixepoch') AS day, COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt,
        SUM(c.state = 'closed') AS resolved FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ?${scopeSql(user, "c.client_id")} GROUP BY nt.user_id, day ORDER BY day DESC, n DESC`,
      off, num(payload.from_ms, 0), num(payload.to_ms, Date.now()), ...scopeArgs(user));
    return { rows };
  },
  "supervisor.allocations": async ({ env, user, payload }) => {
    const range = payload.from_ms != null || payload.to_ms != null ? [num(payload.from_ms, 0), num(payload.to_ms, Date.now())] : [];
    const tail = range.length ? " AND a.at BETWEEN ? AND ?" : "";
    const rows = payload.client_id
      ? await all(env, "SELECT a.*, u.name AS by_name FROM allocations a LEFT JOIN users u ON u.id = a.by_user WHERE a.client_id = ?" + tail + " ORDER BY a.at DESC LIMIT 50", payload.client_id, ...range)
      : await all(env, `SELECT a.*, u.name AS by_name, c.name AS client_name FROM allocations a LEFT JOIN users u ON u.id = a.by_user LEFT JOIN clients c ON c.id = a.client_id WHERE 1 = 1${scopeSql(user, "a.client_id")}${tail} ORDER BY a.at DESC LIMIT 50`, ...scopeArgs(user), ...range);
    return { rows: rows.map((r) => { let s = {}; try { s = JSON.parse(r.summary_json); } catch {} return { ...r, summary: s, summary_json: undefined }; }) };
  },

  /* ---- needs attention: claims a biller escalated to a team lead. 24 hours to answer (TAT); after that they show red. ---- */
  "attention.list": async ({ env, user }) => {
    const rows = await all(env, `SELECT c.id, c.client_id, c.location_id, c.claim_no, c.account_no, c.patient, c.payer, c.dos, c.balance, c.age_days, c.tier, c.state, c.follow_up_on,
        c.last_status_code, c.last_sub_status, c.last_action_code, c.last_note, c.escalated_at, c.assigned_to, u.name AS assigned_name, e.name AS escalated_by_name, cl.name AS client_name, l.name AS location_name
      FROM claims c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN users e ON e.id = c.escalated_by LEFT JOIN clients cl ON cl.id = c.client_id LEFT JOIN locations l ON l.id = c.location_id
      WHERE c.escalated = 1 AND c.state IN ${WORKABLE}${scopeSql(user, "c.client_id")} ORDER BY c.escalated_at ASC LIMIT 500`, ...scopeArgs(user));
    const now = Date.now();
    const out = rows.map((r) => ({ ...r, waiting_ms: r.escalated_at ? now - r.escalated_at : 0, overdue: !!r.escalated_at && now - r.escalated_at > ESCALATION_TAT_MS }));
    return { rows: out, overdue: out.filter((r) => r.overdue).length, tat_hours: ESCALATION_TAT_MS / 3600000 };
  },
  "attention.count": async ({ env, user }) => {
    const r = await one(env, `SELECT COUNT(*) AS n, SUM(CASE WHEN escalated_at IS NOT NULL AND escalated_at < ? THEN 1 ELSE 0 END) AS overdue FROM claims WHERE escalated = 1 AND state IN ${WORKABLE}${scopeSql(user, "client_id")}`, Date.now() - ESCALATION_TAT_MS, ...scopeArgs(user));
    return { n: (r && r.n) || 0, overdue: (r && r.overdue) || 0 };
  },
  /* Answer an escalation: the reply goes into the claim history and the flag comes off. Optionally the claim goes back on the biller's list today. */
  "attention.answer": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, client_id, assigned_to, state, escalated FROM claims WHERE id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (!inScope(user, c.client_id)) throw outOfScope();
    const comment = str(payload.comment, 4000).trim();
    if (!commentOk(comment)) throw bad("Write your answer for the biller, a few words at least.");
    const now = Date.now(), today = isoDate(payload.today) || isoToday();
    const back = payload.send_back && c.assigned_to && ["completed", "assigned"].includes(c.state);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(uuid(), c.id, user.id, user.name, "Escalation answered: " + comment, now),
      env.DB.prepare(`UPDATE claims SET escalated = 0, escalation_answered_at = ?, escalation_answered_by = ?, updated_at = ?,
          state = CASE WHEN ? THEN 'assigned' ELSE state END, follow_up_on = CASE WHEN ? THEN ? ELSE follow_up_on END, skipped_at = NULL WHERE id = ?`).bind(now, user.id, now, back ? 1 : 0, back ? 1 : 0, today, c.id),
    ]);
    return { ok: true, sent_back: !!back };
  },

  /* ---- roster (admin): load the Purview Shastra export. dry_run shows what would change; nothing is written until it is applied. ---- */
  "roster.import": async ({ env, user, payload }) => {
    const raw = Array.isArray(payload.rows) ? payload.rows.slice(0, 5000) : [];
    if (!raw.length) throw bad("The file has no rows.");
    const today = isoDate(payload.today) || isoToday();
    const extra = ((await getSetting(env, "extra_emails", [])) || []).map(mailClean);
    const rows = raw.map(rosterRow).filter((r) => r.name);
    const existing = await all(env, "SELECT * FROM users");
    // On a duplicate key (e.g. an Emp ID put on a hand-made account to merge it), the account with a
    // password or a sign-in wins; the other copy, if it came from the roster, is switched off below.
    const put = (m, k, u) => { const ex = m.get(k); if (!ex || (!(ex.pass_hash || ex.last_login) && (u.pass_hash || u.last_login))) m.set(k, u); };
    const byEmp = new Map(); existing.forEach((u) => { if (u.emp_id) put(byEmp, u.emp_id.toUpperCase(), u); });
    const byEmail = new Map(existing.map((u) => [u.email, u]));
    // Exact full name also matches accounts created by hand before the roster, so they keep their password and get their Emp ID.
    const byName = new Map(); existing.forEach((u) => { if (u.role !== "admin") put(byName, u.name.trim().toLowerCase(), u); });
    const domains = {}; rows.forEach((r) => { if (mailOk(r.email)) { const d = r.email.split("@")[1]; domains[d] = (domains[d] || 0) + 1; } });
    const plan = [], excluded = [], warnings = [], used = new Set(), dropped = new Set();
    for (const row of rows) {
      const cls = rosterClassify(row);
      const match = (row.emp_id && byEmp.get(row.emp_id.toUpperCase())) || (mailOk(row.email) && byEmail.get(row.email)) || byName.get(row.name.trim().toLowerCase()) || byEmail.get(placeholderEmail(row)) || null;
      if (cls.reason && match && match.source === "roster" && match.active) dropped.add(match.id);
      if (cls.reason) { excluded.push({ name: row.name, emp_id: row.emp_id, position: row.position, department: row.department, reason: cls.reason, existing: !!(match && match.source === "roster" && match.active) }); continue; }
      if (match) used.add(match.id);
      const gone = ROSTER_GONE.test(row.status) || (row.exit_date && row.exit_date < today);
      const emailOk = mailOk(row.email) && !/\.(comcom|con)$/.test(row.email);
      const email = emailOk ? row.email : (match && !match.email_missing ? match.email : placeholderEmail(row));
      const issues = [];
      if (!row.email) issues.push("no email");
      else if (!emailOk) issues.push("email looks wrong: " + row.email);
      else {
        const d = row.email.split("@")[1];
        if (!domainOk(env, row.email) && !extra.includes(row.email)) issues.push("not a Purview email, cannot sign in until allowed: " + row.email);
        else if ((domains[d] || 0) < 2) issues.push("check the spelling of the domain: " + row.email);
      }
      // The right email held by an unused copy (a roster duplicate nobody signed in to) is freed and taken over.
      const holder = emailOk && match && match.email !== row.email ? byEmail.get(row.email) : null;
      const freeable = holder && holder.id !== match.id && !holder.pass_hash && !holder.last_login;
      if (holder && holder.id !== match.id && !freeable) issues.push("email already used by another account: " + row.email);
      const role = cls.kind === "agent" ? "user" : "supervisor";
      const next = { emp_id: row.emp_id, name: row.name, email: issues.some((x) => x.startsWith("email already")) && match ? match.email : email, free_email_from: freeable ? holder.id : null, email_missing: emailOk ? 0 : (match && !match.email_missing ? 0 : 1),
        role: match && match.role === "admin" ? "admin" : role, roster_kind: cls.kind, designation: cls.designation, position: row.position, department: row.department, departments_also: row.departments_also,
        roster_status: row.status, exit_date: row.exit_date, reports_to_name: row.reports_to, projects_json: JSON.stringify(cls.projects), access_all: cls.kind === "all" ? 1 : 0, shift: row.shift, city: row.city, active: gone ? 0 : 1 };
      const changes = [];
      if (match) for (const k of ["name", "email", "role", "designation", "department", "roster_status", "exit_date", "reports_to_name", "projects_json", "active"]) if (String(match[k] ?? "") !== String(next[k] ?? "")) changes.push(k === "projects_json" ? "projects" : k);
      if (match && next.free_email_from && !changes.includes("email")) changes.push("email");
      plan.push({ row, cls, match, next, issues, action: !match ? (next.active ? "new" : "skip") : changes.length || match.source !== "roster" ? "update" : "same", changes });
      if (issues.length) warnings.push({ name: row.name, emp_id: row.emp_id, project: row.project, reports_to: row.reports_to, issues });
    }
    const leaving = existing.filter((u) => u.source === "roster" && u.active && !used.has(u.id) && !dropped.has(u.id));
    const clients = await all(env, "SELECT id, name, code, roster_names_json FROM clients");
    const mapped = new Set(clients.flatMap((c) => jsonList(c.roster_names_json).map(projKey)));
    const projNames = new Map(); plan.forEach((p) => p.cls.projects.forEach((x) => projNames.set(projKey(x.name), x.name)));
    const projects = [...projNames.values()].sort().map((name) => { const k = projKey(name); const hits = clients.filter((c) => projKey(c.name) === k || (c.code && projKey(c.code) === k));
      const owner = clients.find((c) => jsonList(c.roster_names_json).some((n) => projKey(n) === k));
      return { name, client: owner ? owner.name : hits.length === 1 ? hits[0].name : "", state: owner ? "matched" : hits.length === 1 ? "auto" : "ask" }; });
    const summary = { rows: rows.length, people: plan.filter((p) => p.action !== "skip").length, new: plan.filter((p) => p.action === "new").length, updated: plan.filter((p) => p.action === "update").length,
      same: plan.filter((p) => p.action === "same").length, deactivated: plan.filter((p) => p.match && p.match.active && !p.next.active).length + leaving.length + excluded.filter((x) => x.existing).length,
      excluded: excluded.length, warnings: warnings.length, leads: plan.filter((p) => p.cls.kind !== "agent" && p.next.active).length, agents: plan.filter((p) => p.cls.kind === "agent" && p.next.active).length };
    const people = plan.filter((p) => p.action !== "skip").map((p) => ({ name: p.row.name, emp_id: p.row.emp_id, action: p.action, changes: p.changes, access: p.cls.kind, position: p.row.position, department: p.row.department,
      projects: p.cls.projects, reports_to: p.row.reports_to, status: p.row.status, active: !!p.next.active, email: p.next.email_missing ? "" : p.next.email, issues: p.issues }));
    const out = { summary, people, excluded, warnings, projects, leaving: leaving.map((u) => ({ name: u.name, emp_id: u.emp_id })) };
    if (payload.dry_run) return out;

    // Apply: people first, then who reports to whom, then project access and teams.
    const now = Date.now();
    for (const p of plan) {
      if (p.action === "skip") continue;
      const n = p.next;
      if (n.free_email_from) await run(env, "UPDATE users SET email = ?, email_missing = 1 WHERE id = ?", "freed-" + String(n.free_email_from).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) + "@no-email.invalid", n.free_email_from);
      let id = p.match && p.match.id;
      if (!id) {
        id = uuid();
        const [first, ...rest] = n.name.split(/\s+/);
        await run(env, `INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at, source)
          VALUES (?,?,?,?,?,?,?,'','',0,?,35,?,'roster')`, id, n.email, n.name, first || "", rest.join(" "), n.designation, n.role, n.active, now);
      } else {
        const [first, ...rest] = n.name.split(/\s+/);
        await run(env, "UPDATE users SET email = ?, name = ?, first_name = ?, last_name = ?, designation = ?, role = ?, active = ?, source = 'roster' WHERE id = ?", n.email, n.name, first || "", rest.join(" "), n.designation, n.role, n.active, id);
      }
      await run(env, `UPDATE users SET emp_id = ?, position = ?, roster_kind = ?, department = ?, departments_also = ?, roster_status = ?, exit_date = ?, reports_to_name = ?, projects_json = ?, access_all = ?, email_missing = ?, shift = ?, city = ? WHERE id = ?`,
        n.emp_id, n.position, n.roster_kind, n.department, n.departments_also, n.roster_status, n.exit_date, n.reports_to_name, n.projects_json, n.access_all, n.email_missing, n.shift, n.city, id);
      p.id = id;
      if (!n.active && p.match && p.match.active) { await unassignOpen(env, id); await run(env, "DELETE FROM sessions WHERE user_id = ?", id); }
    }
    const off = [...leaving.map((u) => u.id), ...dropped];
    for (const id of off) { await run(env, "UPDATE users SET active = 0 WHERE id = ?", id); await unassignOpen(env, id); await run(env, "DELETE FROM sessions WHERE user_id = ?", id); }
    const idByName = new Map(); plan.forEach((p) => { if (p.id) idByName.set(p.row.name.toLowerCase(), p.id); });
    for (const p of plan) if (p.id) await run(env, "UPDATE users SET reports_to = ? WHERE id = ?", idByName.get(String(p.row.reports_to || "").toLowerCase()) || null, p.id);
    await recomputeScopes(env);
    await autoMapProjects(env);
    await syncTeams(env);
    await setSetting(env, "roster_meta", { at: now, by: user.name || user.email, file: str(payload.file_name, 200), summary });
    return { ...out, applied: true };
  },
  "roster.meta": async ({ env }) => {
    const meta = await getSetting(env, "roster_meta", null);
    const extra = (await getSetting(env, "extra_emails", [])) || [];
    const clients = await all(env, "SELECT id, name, roster_names_json FROM clients ORDER BY name");
    const names = await rosterProjectNames(env);
    const projects = names.map((name) => { const c = clients.find((x) => jsonList(x.roster_names_json).some((n) => projKey(n) === projKey(name))); return { name, client_id: c ? c.id : null, client_name: c ? c.name : "" }; });
    return { meta, extra_emails: extra, projects, admins: adminEmails(env) };
  },
  "roster.saveEmails": async ({ env, payload }) => {
    const list = [...new Set((Array.isArray(payload.emails) ? payload.emails : String(payload.emails || "").split(/[\s,;]+/)).map(mailClean).filter(mailOk))].slice(0, 200);
    await setSetting(env, "extra_emails", list);
    return { extra_emails: list };
  },

  /* ---- roster projects ↔ Brahmastra clients ---- */
  "projects.unmapped": async ({ env, user }) => {
    const clients = await all(env, "SELECT id, name, code, roster_names_json FROM clients WHERE active = 1 ORDER BY name");
    const mapped = new Set(clients.flatMap((c) => jsonList(c.roster_names_json).map(projKey)));
    const mine = user.scope ? new Set(user.scope_projects.map(projKey)) : null;
    const names = (await rosterProjectNames(env)).filter((n) => !mapped.has(projKey(n)) && (!mine || mine.has(projKey(n))));
    return { names, clients: clients.map((c) => ({ id: c.id, name: c.name, code: c.code })) };
  },
  "projects.map": async ({ env, user, payload }) => {
    const name = str(payload.name, 80).trim();
    if (!name) throw bad("Which roster project?");
    if (user.scope && !user.scope_projects.some((p) => projKey(p) === projKey(name))) throw outOfScope();
    let clientId = str(payload.client_id, 60);
    if (payload.create) {
      clientId = uuid();
      await run(env, "INSERT INTO clients (id, name, code, active, follow_up_days, created_by, created_at) VALUES (?,?,?,1,30,?,?)", clientId, str(payload.client_name || name, 160).trim() || name, "", user.id, Date.now());
    }
    const c = await one(env, "SELECT id, roster_names_json FROM clients WHERE id = ?", clientId);
    if (!c) throw bad("Pick the client this project is.");
    for (const o of await all(env, "SELECT id, roster_names_json FROM clients")) {
      const list = jsonList(o.roster_names_json).filter((n) => projKey(n) !== projKey(name));
      if (o.id === c.id) list.push(name);
      if (JSON.stringify(list) !== o.roster_names_json) await run(env, "UPDATE clients SET roster_names_json = ? WHERE id = ?", JSON.stringify(list), o.id);
    }
    await syncTeams(env);
    return { ok: true, client_id: c.id };
  },

  /* ---- the day's team for a project: who receives claims today, and how many each ---- */
  "team.today": async ({ env, payload }) => {
    const c = await one(env, "SELECT id, name, team_json, caps_json, roster_names_json FROM clients WHERE id = ?", payload.client_id);
    if (!c) throw bad("Unknown client.");
    const day = isoDate(payload.day) || isoToday();
    const ids = parseTeam(c.team_json);
    const users = ids.length ? await all(env, `SELECT * FROM users WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")}) ORDER BY name`, ...ids) : [];
    const caps = jsonObj(c.caps_json);
    const saved = await one(env, "SELECT a.on_json, a.at, u.name AS by_name FROM availability a LEFT JOIN users u ON u.id = a.by_user WHERE a.client_id = ? AND a.day = ?", c.id, day);
    const on = saved ? jsonList(saved.on_json) : null;
    const names = new Set(jsonList(c.roster_names_json).map(projKey));
    const members = users.map((u) => { const p = jsonList(u.projects_json).find((x) => names.has(projKey(x.name)));
      return { id: u.id, name: u.name, designation: u.designation || "", status: u.roster_status || "", exit_date: u.exit_date || "", share: p ? p.share : null, primary: !!(p && p.share == null),
        cap: caps[u.id] != null ? caps[u.id] : u.capacity, cap_set: caps[u.id] != null, on: on ? on.includes(u.id) : true }; });
    return { client: { id: c.id, name: c.name }, day, members, saved: saved ? { at: saved.at, by_name: saved.by_name || "" } : null };
  },
  "team.saveToday": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT id, team_json, caps_json FROM clients WHERE id = ?", payload.client_id);
    if (!c) throw bad("Unknown client.");
    const day = isoDate(payload.day) || isoToday();
    const team = new Set(parseTeam(c.team_json));
    const on = [...new Set((Array.isArray(payload.on) ? payload.on : []).map((x) => str(x, 60)))].filter((x) => team.has(x));
    const caps = jsonObj(c.caps_json);
    for (const [id, v] of Object.entries(payload.caps || {})) if (team.has(id)) caps[id] = Math.max(0, Math.min(500, Math.round(num(v, 35))));
    await env.DB.batch([
      env.DB.prepare("INSERT INTO availability (client_id, day, on_json, by_user, at) VALUES (?,?,?,?,?) ON CONFLICT(client_id, day) DO UPDATE SET on_json = excluded.on_json, by_user = excluded.by_user, at = excluded.at").bind(c.id, day, JSON.stringify(on), user.id, Date.now()),
      env.DB.prepare("UPDATE clients SET caps_json = ? WHERE id = ?").bind(JSON.stringify(caps), c.id),
    ]);
    return { ok: true, on: on.length };
  },
  /* Projects a TL or SME still has to set the day's team for (the pop-up after sign-in). */
  "team.pending": async ({ env, user, payload }) => {
    if (user.roster_kind !== "lead" || !isAR(user) || !user.scope || !user.scope.length) return { clients: [] };
    const day = isoDate(payload.day) || isoToday();
    const rows = await all(env, `SELECT c.id, c.name, c.team_json FROM clients c LEFT JOIN availability a ON a.client_id = c.id AND a.day = ? WHERE c.active = 1 AND a.client_id IS NULL AND c.id IN (${user.scope.map(() => "?").join(",")}) ORDER BY c.name`, day, ...user.scope);
    return { clients: rows.filter((r) => parseTeam(r.team_json).length).map((r) => ({ id: r.id, name: r.name })) };
  },

  /* ---- demo only (env.DEMO is set by index.html when it runs the Worker in the browser) ---- */
  "demo.seed": async ({ env, user }) => {
    if (!env.DEMO) throw denied("Sample data is only available in demo mode.");
    const now = Date.now();
    const passHash = await sha256Hex("brahmastra-demo");
    const people = [["aisha@purview-healthcare.com", "Aisha Verma"], ["rohan@purview-healthcare.com", "Rohan Mehta"], ["priya@purview-healthcare.com", "Priya Nair"]];
    const users = [];
    for (const [email, name] of people) {
      let u = await one(env, "SELECT * FROM users WHERE email = ?", email);
      if (!u) {
        const id = uuid(), salt = randomHex(16);
        const [first, ...rest] = name.split(" ");
        await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,1,35,?)", id, email, name, first, rest.join(" "), "SME", "user", salt, await makeHash(env, salt, passHash), now);
        u = { id, email, name };
      }
      users.push(publicUser({ ...u, active: 1, role: "user" }));
    }
    const mk = async (name, code, locs) => {
      let c = await one(env, "SELECT * FROM clients WHERE name = ?", name);
      if (!c) { c = { id: uuid(), name, code }; await run(env, "INSERT INTO clients (id, name, code, active, follow_up_days, created_by, created_at) VALUES (?,?,?,1,30,?,?)", c.id, name, code, user.id, now); }
      const out = [];
      for (const ln of locs) {
        let l = await one(env, "SELECT * FROM locations WHERE client_id = ? AND name = ?", c.id, ln);
        if (!l) { l = { id: uuid(), client_id: c.id, name: ln }; await run(env, "INSERT INTO locations (id, client_id, name, active, created_at) VALUES (?,?,?,1,?)", l.id, c.id, ln, now); }
        out.push(l);
      }
      return { id: c.id, name: c.name, locations: out };
    };
    const clients = [await mk("Sunrise Eye Care", "SEC", ["Downtown", "Westside"]), await mk("Lakeview Dental Group", "LDG", ["Main Street"])];
    return { users, clients };
  },
};

async function claimBundle(env, user, c) {
  const notes = await all(env, "SELECT * FROM notes WHERE claim_id = ? ORDER BY created_at DESC LIMIT 200", c.id);
  const files = await all(env, "SELECT id, claim_id, user_id, user_name, name, type, size, created_at FROM attachments WHERE claim_id = ? ORDER BY created_at DESC LIMIT 200", c.id);
  const key = c.account_no || c.patient;
  const siblings = key ? await all(env, `SELECT id, claim_no, account_no, patient, dos, cpt, payer, balance, state, assigned_to, priority, follow_up_on, last_status_code FROM claims
      WHERE client_id = ? AND id <> ? AND state IN ${WORKABLE} AND ((account_no <> '' AND account_no = ?) OR (patient <> '' AND patient = ?)) ORDER BY priority DESC LIMIT 50`, c.client_id, c.id, c.account_no || "\u0000", c.patient || "\u0000") : [];
  let lines = []; try { lines = JSON.parse(c.lines_json || "[]"); } catch {}
  let raw = {}; try { raw = JSON.parse(c.raw_json || "{}"); } catch {}
  const { raw_json, lines_json, ...rest } = c;
  const now = Date.now();
  const shaped = notes.map((n) => { const { fields_json, ...nn } = n; return { ...nn, fields: noteFields(n), editable: n.kind === "work" && now - n.created_at <= EDIT_WINDOW_MS && (n.user_id === user.id || leadFor(user, c.client_id)), edit_until: n.created_at + EDIT_WINDOW_MS }; });
  const attachments = files.map((a) => ({ ...a, deletable: leadFor(user, c.client_id) || (a.user_id === user.id && now - a.created_at <= EDIT_WINDOW_MS) }));
  return { claim: { ...rest, lines, raw, mine: c.assigned_to === user.id }, notes: shaped, attachments, siblings };
}

/* ------------------------------------------------------------ fetch */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (!env.DB) throw new ApiError(500, "No D1 database is bound as DB. Add the binding in the Worker settings.");
      await ensureReady(env);
      if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, app: "brahmastra-api", version: VERSION });
      if (url.pathname === "/api" && request.method === "POST") {
        let body;
        try { body = await request.json(); } catch { throw bad("Send a JSON body like {op, payload}."); }
        const op = String(body && body.op || "");
        const payload = (body && body.payload) || {};
        const auth = request.headers.get("Authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        const handler = OPS[op];
        if (!handler) throw new ApiError(404, "Unknown operation: " + op);
        const user = await userFromToken(env, token);
        if (!PUBLIC_OPS.has(op) && !user) throw new ApiError(401, "Please sign in.");
        if (user && user.must_change && !["auth.changePassword", "auth.me", "auth.logout", "auth.deleteMyAccount", "meta.info"].includes(op)) throw new ApiError(403, "Please set a new password first.");
        if (SUPERVISOR_OPS.test(op) && (!user || user.role !== "supervisor")) throw denied("Supervisor access is needed for this.");
        if (ADMIN_OPS.test(op) && (!user || !user.is_admin)) throw denied("Admin access is needed for this.");
        if (user) {
          user.scope = await scopeOf(env, user);
          // Matching a roster project to a client is how a client comes into scope, so that one call is exempt.
          if (user.scope && payload.client_id && op !== "projects.map" && !user.scope.includes(String(payload.client_id))) throw outOfScope();
        }
        const result = await handler({ env, user, token, payload, ctx });
        return json(result || { ok: true });
      }
      throw new ApiError(404, "Not found.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      // A table that vanished (database replaced or emptied) means the schema must be made again on the next request.
      if (/no such table/i.test(String(e && e.message))) READY = null;
      if (status >= 500) console.error("brahmastra-api", e);
      return json({ error: (e && e.message) || "Server error." }, status);
    }
  },
};
