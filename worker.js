/* =====================================================================
   Purview Brahmastra API  —  Cloudflare Worker on D1 (SQLite)
   ---------------------------------------------------------------------
   One file, no imports. Deploy it as a Worker named brahmastra-api with:
     • a D1 database bound as   DB
     • (optional) secrets       PEPPER               extra salt for password hashes
                                BOOTSTRAP_EMAIL      first supervisor login
                                BOOTSTRAP_PASSWORD   first supervisor password
                                ALLOWED_DOMAINS      comma list, e.g. purview-healthcare.com,purviewservices.com
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

const VERSION = "2.0.0";
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
  `CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, kind TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
     resolves INTEGER NOT NULL DEFAULT 0, follow_up_days INTEGER, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, UNIQUE (kind, code))`,
  `CREATE TABLE IF NOT EXISTS allocations (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, location_id TEXT, by_user TEXT NOT NULL, at INTEGER NOT NULL,
     strategy TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0, summary_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS otps (id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'login', data_json TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_otps_email ON otps (email, created_at)`,
];

/* Columns added after the first release. ensureReady() adds any that an
   existing database is missing, so upgrades need no manual migration. */
const EXTRA_COLUMNS = {
  notes: [["status", "TEXT NOT NULL DEFAULT ''"], ["sub_status", "TEXT NOT NULL DEFAULT ''"], ["action", "TEXT NOT NULL DEFAULT ''"], ["bucket", "TEXT NOT NULL DEFAULT ''"],
    ["effective", "TEXT NOT NULL DEFAULT ''"], ["note_action", "TEXT NOT NULL DEFAULT ''"], ["fields_json", "TEXT NOT NULL DEFAULT '{}'"], ["edited_at", "INTEGER"], ["edited_by", "TEXT"]],
  claims: [["last_sub_status", "TEXT NOT NULL DEFAULT ''"], ["last_bucket", "TEXT NOT NULL DEFAULT ''"], ["last_effective", "TEXT NOT NULL DEFAULT ''"], ["last_note_action", "TEXT NOT NULL DEFAULT ''"]],
  locations: [["team_json", "TEXT NOT NULL DEFAULT '[]'"], ["auto_allocate", "INTEGER NOT NULL DEFAULT 1"]],
  clients: [["team_json", "TEXT NOT NULL DEFAULT '[]'"], ["auto_allocate", "INTEGER NOT NULL DEFAULT 1"]],
  batches: [["source", "TEXT NOT NULL DEFAULT 'file'"], ["web_url", "TEXT NOT NULL DEFAULT ''"]],
  users: [["first_name", "TEXT NOT NULL DEFAULT ''"], ["last_name", "TEXT NOT NULL DEFAULT ''"], ["designation", "TEXT NOT NULL DEFAULT ''"]],
  sessions: [["via", "TEXT NOT NULL DEFAULT 'password'"]],
};
const DESIGNATIONS = ["SME", "TL", "Sr TL", "Assistant Manager", "Manager", "Sr Manager"];
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_TRIES = 5;

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
const otpCode = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };
const otpHash = (env, email, code) => sha256Hex(`otp:${email}:${code}:${env.PEPPER || DEFAULT_PEPPER}`);
async function issueOtp(env, email, purpose, data) {
  const now = Date.now();
  const recent = await one(env, "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM otps WHERE email = ? AND created_at > ?", email, now - 3600000);
  if (recent && recent.last && now - recent.last < 45000) throw new ApiError(429, "A code was sent less than a minute ago. Check your inbox (and spam), then try again.");
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
    precheck: pre, precheck_text: t(f.precheck_text, 300), findings: t(f.findings, 2000), action: NOTE_ACTIONS.includes(action) ? action : "",
  };
}
function composeNote(fields, saag, followUp) {
  const parts = [
    `DOS: ${fields.dos || "-"}`, `CLM#: ${fields.clm || "-"}`, `DENIAL: ${fields.denial || "-"}`,
    `SOURCE: ${fields.source || "-"}${fields.ref ? ", REF: " + fields.ref : (fields.source === "Call" ? ", REF: none" : "")}`,
    `PRE CALL CHECK: ${[...(fields.precheck || []), fields.precheck_text].filter(Boolean).join("; ") || "-"}`,
    `RCA/FINDINGS: ${fields.findings || "-"}`, `ACTION: ${fields.action || "-"}`,
    `SAAG: ${saag.status} > ${saag.sub_status} > ${saag.action}`, `BUCKET: ${saag.bucket}`, `EFFECTIVE: ${saag.effective || "-"}`,
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
  if (!NOTE_ACTIONS.includes(String(f.action || "").toLowerCase().trim())) throw bad("Pick the note ACTION from the list.");
  if (f.source === "Call" && !String(f.ref || "").trim()) throw bad("A call needs its reference number (REF).");
  return saag;
}
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
async function makeHash(env, salt, passHash) { return sha256Hex(`${salt}:${String(passHash).toLowerCase()}:${env.PEPPER || DEFAULT_PEPPER}`); }
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
const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, first_name: u.first_name || "", last_name: u.last_name || "", designation: u.designation || "", role: u.role, active: !!u.active, capacity: u.capacity,
  must_change: !!u.must_change, has_password: !!u.pass_hash, via: u.via || undefined, created_at: u.created_at, last_login: u.last_login });

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
let READY = null;
function ensureReady(env) {
  if (READY) return READY;
  READY = (async () => {
    await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
    const users = await one(env, "SELECT COUNT(*) AS n FROM users");
    if (!users || !users.n) {
      const email = mailClean(env.BOOTSTRAP_EMAIL || DEFAULT_BOOTSTRAP_EMAIL);
      const password = env.BOOTSTRAP_PASSWORD || DEFAULT_BOOTSTRAP_PASSWORD;
      const salt = randomHex(16);
      const hash = await makeHash(env, salt, await sha256Hex(password));
      await run(env, "INSERT INTO users (id, email, name, first_name, last_name, designation, role, pass_salt, pass_hash, must_change, active, capacity, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        uuid(), email, "Supervisor", "Supervisor", "", "TL", "supervisor", salt, hash, env.BOOTSTRAP_PASSWORD ? 0 : 1, 1, 35, Date.now());
    }
    for (const table of Object.keys(EXTRA_COLUMNS)) {
      const have = new Set((await all(env, `PRAGMA table_info(${table})`)).map((r) => r.name));
      for (const [name, def] of EXTRA_COLUMNS[table]) if (!have.has(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`).run();
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

/* --------------------------------------------------------- the ops */
const PUBLIC_OPS = new Set(["auth.login", "auth.sendOtp", "auth.verifyOtp", "auth.signup", "meta.info"]);
const SUPERVISOR_OPS = /^(users\.|clients\.save|clients\.saveTeam|locations\.|settings\.save|inventory\.|claims\.(list|stats|eligible|setState)|alloc\.|reports\.|supervisor\.|demo\.)/;

const OPS = {
  "meta.info": async ({ env }) => ({ app: "brahmastra-api", version: VERSION, demo: !!env.DEMO, domains: allowedDomains(env), email: !!env.EMAIL_PROVIDER, designations: DESIGNATIONS }),

  /* ---- auth: password, or a one-time code sent by email ---- */
  "auth.login": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email) || !isHash(payload.passHash)) throw bad("Enter your email and password.");
    const u = await one(env, "SELECT * FROM users WHERE email = ?", email);
    const fail = () => new ApiError(401, "That email or password doesn't match.");
    if (!u || !u.active) throw fail();
    if (!u.pass_hash) throw new ApiError(401, "This account has no password yet. Sign in with a code sent to your email, then set a password from the menu if you want one.");
    const h = await makeHash(env, u.pass_salt, payload.passHash);
    if (!sameHash(h, u.pass_hash)) throw fail();
    return openSession(env, u, "password");
  },
  "auth.sendOtp": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email)) throw bad("Enter your email address.");
    const u = await one(env, "SELECT id, active FROM users WHERE email = ?", email);
    if (!u) throw new ApiError(404, "No Brahmastra account uses that email. Ask your team lead to add you, or create a team lead account.");
    if (!u.active) throw new ApiError(403, "This account is switched off. Ask your team lead.");
    const code = await issueOtp(env, email, "login", {});
    return { email, ...(await deliverOtp(env, email, code, "login")) };
  },
  "auth.signup": async ({ env, payload }) => {
    const email = mailClean(payload.email);
    if (!mailOk(email)) throw bad("Enter a valid email address.");
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
    if (u.must_change && !u.pass_hash) await run(env, "UPDATE users SET must_change = 0 WHERE id = ?", u.id);
    return openSession(env, u, "otp");
  },
  "auth.logout": async ({ env, token }) => { if (token) await run(env, "DELETE FROM sessions WHERE token = ?", token); return { ok: true }; },
  "auth.me": async ({ user }) => ({ user }),
  "auth.changePassword": async ({ env, user, token, payload }) => {
    if (!isHash(payload.newHash)) throw bad("Enter the new password.");
    const u = await one(env, "SELECT * FROM users WHERE id = ?", user.id);
    const needOld = !!u.pass_hash && user.via !== "otp";
    if (needOld) {
      if (!isHash(payload.oldHash)) throw bad("Enter your current password.");
      if (String(payload.oldHash).toLowerCase() === String(payload.newHash).toLowerCase()) throw bad("Choose a different password.");
      const h = await makeHash(env, u.pass_salt, payload.oldHash);
      if (!sameHash(h, u.pass_hash)) throw bad("Your current password doesn't match.");
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
  "users.list": async ({ env }) => {
    const users = await all(env, "SELECT * FROM users ORDER BY role DESC, name, email");
    return { users: users.map(publicUser) };
  },
  "users.save": async ({ env, user, payload }) => {
    const now = Date.now();
    const role = payload.role === "supervisor" ? "supervisor" : "user";
    const first = str(payload.first_name, 60).trim(), last = str(payload.last_name, 60).trim();
    const name = fullName(first, last, str(payload.name, 120).trim());
    const designation = DESIGNATIONS.includes(payload.designation) ? payload.designation : str(payload.designation, 40).trim();
    const capacity = Math.max(1, Math.min(500, Math.round(num(payload.capacity, 35))));
    const active = payload.active === false ? 0 : 1;
    if (payload.id) {
      const ex = await one(env, "SELECT * FROM users WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown user.");
      if (!name) throw bad("Enter the person's name.");
      if (ex.id === user.id && (!active || role !== "supervisor")) throw bad("You can't deactivate or demote your own account.");
      if (ex.role === "supervisor" && (role !== "supervisor" || !active)) {
        const n = await one(env, "SELECT COUNT(*) AS n FROM users WHERE role = 'supervisor' AND active = 1 AND id <> ?", ex.id);
        if (!n.n) throw bad("Keep at least one active team lead.");
      }
      await run(env, "UPDATE users SET name = ?, first_name = ?, last_name = ?, designation = ?, role = ?, capacity = ?, active = ? WHERE id = ?", name, first, last, designation, role, capacity, active, ex.id);
      if (!active) await run(env, "DELETE FROM sessions WHERE user_id = ?", ex.id);
      return { user: publicUser({ ...ex, name, first_name: first, last_name: last, designation, role, capacity, active }) };
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
    return { user: publicUser({ id, email, name, first_name: first, last_name: last, designation, role, active, capacity, must_change: hash ? 1 : 0, pass_hash: hash, created_at: now }) };
  },
  /* A team lead can fetch a sign-in code for someone whose email has not arrived (or when email is not set up). */
  "users.loginCode": async ({ env, payload }) => {
    const ex = await one(env, "SELECT id, email, active, name FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    if (!ex.active) throw bad("This account is switched off.");
    const code = await issueOtp(env, ex.email, "login", {});
    return { email: ex.email, code, expires_in_min: OTP_TTL_MS / 60000 };
  },
  "users.resetPassword": async ({ env, payload }) => {
    if (!isHash(payload.passHash)) throw bad("Set a temporary password.");
    const ex = await one(env, "SELECT id FROM users WHERE id = ?", payload.id);
    if (!ex) throw bad("Unknown user.");
    const salt = randomHex(16);
    const hash = await makeHash(env, salt, payload.passHash);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_salt = ?, pass_hash = ?, must_change = 1 WHERE id = ?").bind(salt, hash, ex.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(ex.id),
    ]);
    return { ok: true };
  },

  /* ---- clients & locations ---- */
  "clients.list": async ({ env }) => {
    const clients = await all(env, "SELECT * FROM clients ORDER BY active DESC, name");
    const locs = await all(env, "SELECT * FROM locations ORDER BY active DESC, name");
    const shape = (r) => { const { team_json, ...rest } = r; return { ...rest, active: !!r.active, auto_allocate: r.auto_allocate == null ? true : !!r.auto_allocate, team: parseTeam(team_json) }; };
    return { clients: clients.map((c) => ({ ...shape(c), locations: locs.filter((l) => l.client_id === c.id).map(shape) })) };
  },
  /* Billers mapped to a client (used when a location has no team of its own) or to a location. */
  "clients.saveTeam": async ({ env, payload }) => {
    const table = payload.location_id ? "locations" : "clients";
    const id = str(payload.location_id || payload.client_id, 60);
    const ex = await one(env, `SELECT id FROM ${table} WHERE id = ?`, id);
    if (!ex) throw bad("Unknown " + (payload.location_id ? "location" : "client") + ".");
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
    if (payload.id) {
      const ex = await one(env, "SELECT id FROM clients WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown client.");
      await run(env, "UPDATE clients SET name = ?, code = ?, follow_up_days = ?, active = ? WHERE id = ?", name, code, fu, active, ex.id);
      return { client: { id: ex.id, name, code, follow_up_days: fu, active: !!active } };
    }
    const id = uuid(), now = Date.now();
    await run(env, "INSERT INTO clients (id, name, code, active, follow_up_days, created_by, created_at) VALUES (?,?,?,?,?,?,?)", id, name, code, active, fu, user.id, now);
    return { client: { id, name, code, follow_up_days: fu, active: !!active, created_at: now, team: [], auto_allocate: true, locations: [] } };
  },
  "locations.save": async ({ env, payload }) => {
    const name = str(payload.name, 160).trim();
    if (!name) throw bad("Give the location a name.");
    const active = payload.active === false ? 0 : 1;
    if (payload.id) {
      const ex = await one(env, "SELECT id, client_id FROM locations WHERE id = ?", payload.id);
      if (!ex) throw bad("Unknown location.");
      await run(env, "UPDATE locations SET name = ?, active = ? WHERE id = ?", name, active, ex.id);
      return { location: { id: ex.id, client_id: ex.client_id, name, active: !!active } };
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
  "settings.save": async ({ env, payload }) => {
    const s = payload.settings || {};
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
    const existing = new Map();
    for (const chunk of chunks(rows.map((c) => str(c.match_key, 300)), 80)) {
      const ex = await all(env, `SELECT id, match_key, state, touches, assigned_to, worked_before, follow_up_on, inventory_kind FROM claims WHERE client_id = ? AND match_key IN (${chunk.map(() => "?").join(",")})`, client.id, ...chunk);
      ex.forEach((r) => existing.set(r.match_key, r));
    }
    const stmts = [];
    for (const c of rows) {
      const key = str(c.match_key, 300);
      const ex = existing.get(key);
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
            inventory_kind, worked_before, last_worked_on, follow_up_on, priority, priority_reason, state, state_reason, raw_json, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          uuid(), client.id, location_id || null, bid, bid, key, vals.claim_no, vals.account_no, vals.patient, vals.payer, vals.dos, vals.cpt, vals.provider,
          vals.billed, vals.balance, vals.lines, vals.lines_json, vals.age_days, vals.bucket, vals.tier, vals.status_class, vals.file_status, vals.file_sub_status,
          vals.file_action, vals.file_comments, vals.file_bucket, kind, kind === "worked" ? 1 : 0, lastWorked, followUp, vals.priority, vals.priority_reason,
          state, reason, vals.raw_json, now, now));
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
      stmts.push(env.DB.prepare(`UPDATE claims SET location_id = COALESCE(?, location_id), batch_id = ?, claim_no = CASE WHEN ? <> '' THEN ? ELSE claim_no END,
          account_no = CASE WHEN ? <> '' THEN ? ELSE account_no END, patient = CASE WHEN ? <> '' THEN ? ELSE patient END, payer = CASE WHEN ? <> '' THEN ? ELSE payer END,
          dos = CASE WHEN ? <> '' THEN ? ELSE dos END, cpt = CASE WHEN ? <> '' THEN ? ELSE cpt END, provider = CASE WHEN ? <> '' THEN ? ELSE provider END,
          billed = COALESCE(?, billed), balance = ?, lines = ?, lines_json = ?, age_days = ?, bucket = ?, tier = ?, status_class = ?,
          file_status = ?, file_sub_status = ?, file_action = ?, file_comments = CASE WHEN ? <> '' THEN ? ELSE file_comments END, file_bucket = ?,
          inventory_kind = CASE WHEN ? = 'worked' THEN 'worked' ELSE inventory_kind END, worked_before = CASE WHEN ? = 'worked' THEN 1 ELSE worked_before END,
          last_worked_on = CASE WHEN ? <> '' THEN ? ELSE last_worked_on END, follow_up_on = CASE WHEN ? <> '' THEN ? ELSE follow_up_on END,
          priority = ?, priority_reason = ?, state = ?, state_reason = COALESCE(?, state_reason),
          assigned_to = CASE WHEN ? = 1 THEN NULL ELSE assigned_to END, assigned_at = CASE WHEN ? = 1 THEN NULL ELSE assigned_at END,
          skipped_at = CASE WHEN ? = 1 THEN NULL ELSE skipped_at END, raw_json = ?, updated_at = ? WHERE id = ?`).bind(
          location_id || null, bid, vals.claim_no, vals.claim_no, vals.account_no, vals.account_no, vals.patient, vals.patient, vals.payer, vals.payer,
          vals.dos, vals.dos, vals.cpt, vals.cpt, vals.provider, vals.provider, vals.billed, vals.balance, vals.lines, vals.lines_json, vals.age_days, vals.bucket, vals.tier, vals.status_class,
          vals.file_status, vals.file_sub_status, vals.file_action, vals.file_comments, vals.file_comments, vals.file_bucket,
          kind, kind, lastWorked, lastWorked, followUp, followUp, vals.priority, vals.priority_reason, newState, reason,
          clearAssign, clearAssign, clearAssign, vals.raw_json, now, ex.id));
    }
    if (stmts.length) await batchAll(env, stmts, 40);
    await run(env, `UPDATE batches SET inserted = inserted + ?, updated = updated + ?, reopened = reopened + ?, closed = closed + ?, excluded = excluded + ?, skipped = skipped + ?,
        rows_read = CASE WHEN ? > 0 THEN ? ELSE rows_read END, summary_json = CASE WHEN ? = 1 THEN ? ELSE summary_json END WHERE id = ?`,
      counts.inserted, counts.updated, counts.reopened, counts.closed, counts.excluded, counts.skipped,
      Math.round(num(rows_read, 0)), Math.round(num(rows_read, 0)), final ? 1 : 0, str(JSON.stringify(summary || {}), 20000), bid);
    return { batch_id: bid, ...counts };
  },
  "inventory.batches": async ({ env, payload }) => {
    const rows = payload.client_id
      ? await all(env, "SELECT b.*, u.name AS uploaded_by_name, l.name AS location_name FROM batches b LEFT JOIN users u ON u.id = b.uploaded_by LEFT JOIN locations l ON l.id = b.location_id WHERE b.client_id = ? ORDER BY b.uploaded_at DESC LIMIT 100", payload.client_id)
      : await all(env, "SELECT b.*, u.name AS uploaded_by_name, l.name AS location_name, c.name AS client_name FROM batches b LEFT JOIN users u ON u.id = b.uploaded_by LEFT JOIN locations l ON l.id = b.location_id LEFT JOIN clients c ON c.id = b.client_id ORDER BY b.uploaded_at DESC LIMIT 100");
    return { batches: rows.map((b) => { let s = {}; try { s = JSON.parse(b.summary_json); } catch {} return { ...b, summary: s, summary_json: undefined }; }) };
  },
  "inventory.undoBatch": async ({ env, payload }) => {
    const b = await one(env, "SELECT * FROM batches WHERE id = ?", payload.batch_id);
    if (!b) throw bad("Unknown batch.");
    if (b.undone_at) throw bad("This batch was already undone.");
    const r = await run(env, "DELETE FROM claims WHERE first_batch_id = ? AND touches = 0 AND state <> 'in_progress'", b.id);
    await run(env, "UPDATE batches SET undone_at = ? WHERE id = ?", Date.now(), b.id);
    return { removed: changesOf(r) };
  },

  /* ---- claims (supervisor views) ---- */
  "claims.list": async ({ env, payload }) => {
    const where = [], params = [];
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
    if (payload.q) { const q = "%" + str(payload.q, 80).trim() + "%"; where.push("(c.claim_no LIKE ? OR c.patient LIKE ? OR c.account_no LIKE ? OR c.payer LIKE ?)"); params.push(q, q, q, q); }
    const SORTS = { priority: "c.priority", balance: "c.balance", age_days: "c.age_days", patient: "c.patient", payer: "c.payer", dos: "c.dos", updated_at: "c.updated_at", state: "c.state", assigned: "u.name", follow_up_on: "c.follow_up_on" };
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
  "claims.stats": async ({ env, payload }) => {
    const where = [], params = [];
    if (payload.client_id) { where.push("client_id = ?"); params.push(payload.client_id); }
    if (payload.location_id) { where.push("location_id = ?"); params.push(payload.location_id); }
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
    const [workBuckets, saagStatuses] = await Promise.all([
      all(env, `SELECT last_bucket AS bucket, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} last_bucket <> '' GROUP BY last_bucket`, ...params),
      all(env, `SELECT last_status_code AS status, COUNT(*) AS n, COALESCE(SUM(balance),0) AS amt FROM claims ${(where.length ? w + " AND " : "WHERE ")} last_status_code <> '' GROUP BY last_status_code ORDER BY n DESC`, ...params),
    ]);
    return { states, tiers, buckets, classes, payers, kinds, users, follow_ups_due: due, escalated: escalated ? escalated.n : 0, work_buckets: workBuckets, saag_statuses: saagStatuses };
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
    if (user.role !== "supervisor" && c.assigned_to !== user.id && c.last_worked_by !== user.id) throw denied("This claim is not in your queue.");
    return claimBundle(env, user, c);
  },
  "claims.setState": async ({ env, user, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const state = ["open", "excluded", "closed"].includes(payload.state) ? payload.state : null;
    if (!ids.length || !state) throw bad("Pick claims and a state.");
    const reason = str(payload.reason, 200) || (state === "open" ? "Reopened by supervisor" : (state === "closed" ? "Closed by supervisor" : "Excluded by supervisor"));
    const now = Date.now();
    let changed = 0;
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET state = ?, state_reason = ?, assigned_to = CASE WHEN ? = 'open' THEN NULL ELSE assigned_to END, assigned_at = CASE WHEN ? = 'open' THEN NULL ELSE assigned_at END,
        skipped_at = NULL, escalated = CASE WHEN ? = 'open' THEN escalated ELSE 0 END, updated_at = ? WHERE id IN (${chunk.map(() => "?").join(",")})`, state, reason, state, state, state, now, ...chunk);
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
    const stmts = items.filter((a) => ok.has(str(a.user_id, 60))).map((a) =>
      env.DB.prepare(`UPDATE claims SET assigned_to = ?, assigned_at = ?, state = 'assigned', state_reason = '', priority = ?, priority_reason = ?, tier = CASE WHEN ? <> '' THEN ? ELSE tier END,
          age_days = COALESCE(?, age_days), bucket = CASE WHEN ? <> '' THEN ? ELSE bucket END, skipped_at = NULL, skips = 0, updated_at = ?
        WHERE id = ? AND client_id = ? AND (state = 'open' OR (state = 'completed' AND follow_up_on <> '' AND follow_up_on <= ?))`)
        .bind(str(a.user_id, 60), now, num(a.priority, 0), str(a.priority_reason, 300), str(a.tier, 10), str(a.tier, 10), a.age_days == null ? null : Math.round(num(a.age_days, 0)),
          str(a.bucket, 20), str(a.bucket, 20), now, str(a.id, 60), client_id, today));
    const results = await batchAll(env, stmts, 50);
    const applied = results.reduce((s, r) => s + changesOf(r), 0);
    const id = uuid();
    await run(env, "INSERT INTO allocations (id, client_id, location_id, by_user, at, strategy, count, summary_json) VALUES (?,?,?,?,?,?,?,?)",
      id, client_id, location_id || null, user.id, now, str(strategy, 40), applied, str(JSON.stringify(payload.summary || {}), 20000));
    return { applied, allocation_id: id, skipped: items.length - applied };
  },
  "alloc.reassign": async ({ env, payload }) => {
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    const u = await one(env, "SELECT id FROM users WHERE id = ? AND active = 1", payload.user_id);
    if (!ids.length || !u) throw bad("Pick claims and an active team member.");
    const now = Date.now();
    let changed = 0;
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET assigned_to = ?, assigned_at = ?, state = CASE WHEN state IN ('open','completed','in_progress') THEN 'assigned' ELSE state END, skipped_at = NULL, updated_at = ?
        WHERE id IN (${chunk.map(() => "?").join(",")}) AND state IN ${WORKABLE}`, u.id, now, now, ...chunk);
      changed += changesOf(r);
    }
    return { changed };
  },
  "alloc.unassign": async ({ env, payload }) => {
    const now = Date.now();
    if (payload.user_id) {
      const where = ["assigned_to = ?", "state IN ('assigned','in_progress')"], params = [str(payload.user_id, 60)];
      if (payload.client_id) { where.push("client_id = ?"); params.push(payload.client_id); }
      const r = await run(env, `UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', skipped_at = NULL, updated_at = ? WHERE ${where.join(" AND ")}`, now, ...params);
      return { changed: changesOf(r) };
    }
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 2000);
    if (!ids.length) throw bad("Pick claims to unassign.");
    let changed = 0;
    for (const chunk of chunks(ids, 60)) {
      const r = await run(env, `UPDATE claims SET assigned_to = NULL, assigned_at = NULL, started_at = NULL, state = 'open', skipped_at = NULL, updated_at = ? WHERE id IN (${chunk.map(() => "?").join(",")}) AND state IN ('assigned','in_progress')`, now, ...chunk);
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
    let c = await one(env, "SELECT * FROM claims WHERE assigned_to = ? AND state = 'in_progress' LIMIT 1", user.id);
    if (!c) {
      const r = await env.DB.prepare(`UPDATE claims SET state = 'in_progress', started_at = ?, updated_at = ? WHERE id = (
          SELECT id FROM claims WHERE assigned_to = ? AND state = 'assigned' AND (follow_up_on = '' OR follow_up_on <= ?)
          ORDER BY CASE WHEN skipped_at IS NULL THEN 0 ELSE 1 END, priority DESC, balance DESC, age_days DESC LIMIT 1) AND state = 'assigned' RETURNING *`).bind(now, now, user.id, today).first();
      c = r || null;
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
    await env.DB.batch(stmts);
    return { ok: true };
  },
  "queue.complete": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT c.*, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (c.assigned_to !== user.id && user.role !== "supervisor") throw denied("This claim is not on your desk.");
    if (!["in_progress", "assigned", "completed"].includes(c.state)) throw bad("This claim is not open for work (it is " + c.state + ").");
    const saag = validateWork(payload);
    const fields = cleanNoteFields(payload.note, c);
    const today = isoDate(payload.today) || isoToday();
    const closed = isClosedWork(saag, fields);
    const followUp = closed ? "" : (isoDate(payload.follow_up_on) || addDays(today, followUpDays(saag.effective, c.client_follow_up_days)));
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
      const f = t.id === c.id ? fields : { ...fields, dos: mmdd(t.dos) || fields.dos, clm: t.claim_no || fields.clm, findings: fields.findings + " (applied with claim " + (c.claim_no || c.id.slice(0, 8)) + ")" };
      const text = t.id === c.id ? comment : composeNote(f, saag, followUp);
      stmts.push(env.DB.prepare(`INSERT INTO notes (id, claim_id, user_id, user_name, kind, status_code, action_code, comment, follow_up_on, created_at, status, sub_status, action, bucket, effective, note_action, fields_json)
          VALUES (?,?,?,?,'work',?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(uuid(), t.id, user.id, user.name, saag.status, saag.action, text, followUp, now, saag.status, saag.sub_status, saag.action, saag.bucket, saag.effective, f.action, JSON.stringify(f)));
      stmts.push(env.DB.prepare(`UPDATE claims SET state = ?, state_reason = ?, started_at = NULL, completed_at = ?, last_status_code = ?, last_action_code = ?, last_sub_status = ?, last_bucket = ?, last_effective = ?, last_note_action = ?,
          last_note = ?, last_worked_by = ?, last_worked_on = ?, follow_up_on = ?, touches = touches + 1, worked_before = 1, escalated = ?, skipped_at = NULL, updated_at = ? WHERE id = ?`)
        .bind(newState, reason, now, saag.status, saag.action, saag.sub_status, saag.bucket, saag.effective, f.action, text.slice(0, 600), user.id, today, followUp, escalate, now, t.id));
    }
    await batchAll(env, stmts);
    return { completed: targets.length, closed, follow_up_on: followUp, state: newState, comment };
  },
  /* Open a specific claim from the day list (instead of "next"). Any other claim open on the desk goes back to assigned. */
  "queue.open": async ({ env, user, payload }) => {
    const c = await one(env, "SELECT * FROM claims WHERE id = ?", payload.id);
    if (!c) throw bad("Claim not found.");
    if (c.assigned_to !== user.id && user.role !== "supervisor") throw denied("This claim is not on your desk.");
    if (!["assigned", "in_progress", "completed"].includes(c.state)) throw bad("This claim is " + c.state + " and cannot be opened for work.");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("UPDATE claims SET state = 'assigned', started_at = NULL, updated_at = ? WHERE assigned_to = ? AND state = 'in_progress' AND id <> ?").bind(now, user.id, c.id),
      env.DB.prepare("UPDATE claims SET state = 'in_progress', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").bind(now, now, c.id),
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
    if (n.user_id !== user.id && user.role !== "supervisor") throw denied("Only the author or a team lead can edit this note.");
    if (Date.now() - n.created_at > EDIT_WINDOW_MS) throw new ApiError(403, "Notes can be edited for 24 hours after they are written. This one is now read-only.");
    const c = await one(env, "SELECT c.*, cl.follow_up_days AS client_follow_up_days FROM claims c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?", n.claim_id);
    if (!c) throw bad("Claim not found.");
    const saag = validateWork(payload);
    const fields = cleanNoteFields(payload.note, c);
    const today = isoDate(payload.today) || isoToday();
    const closed = isClosedWork(saag, fields);
    const followUp = closed ? "" : (isoDate(payload.follow_up_on) || n.follow_up_on || addDays(today, followUpDays(saag.effective, c.client_follow_up_days)));
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
    const c = await one(env, "SELECT id, assigned_to, last_worked_by FROM claims WHERE id = ?", payload.claim_id);
    if (!c) throw bad("Claim not found.");
    if (user.role !== "supervisor" && c.assigned_to !== user.id && c.last_worked_by !== user.id) throw denied("This claim is not in your queue.");
    const comment = str(payload.comment, 4000).trim();
    if (!commentOk(comment)) throw bad("Write a few words.");
    const now = Date.now(), id = uuid();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notes (id, claim_id, user_id, user_name, kind, comment, created_at) VALUES (?,?,?,?,'note',?,?)").bind(id, c.id, user.id, user.name, comment, now),
      env.DB.prepare("UPDATE claims SET updated_at = ? WHERE id = ?").bind(now, c.id),
    ]);
    return { note: { id, claim_id: c.id, user_id: user.id, user_name: user.name, kind: "note", comment, created_at: now } };
  },

  /* ---- reports ---- */
  "reports.work": async ({ env, payload }) => {
    const where = ["nt.created_at BETWEEN ? AND ?"], params = [num(payload.from_ms, 0), num(payload.to_ms, Date.now())];
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
  "supervisor.productivity": async ({ env, payload }) => {
    const off = Math.round(num(payload.tz_offset_min, 0)) * 60;
    const rows = await all(env, `SELECT nt.user_id, nt.user_name, date((nt.created_at / 1000) + ?, 'unixepoch') AS day, COUNT(*) AS n, COALESCE(SUM(c.balance),0) AS amt,
        SUM(c.state = 'closed') AS resolved FROM notes nt JOIN claims c ON c.id = nt.claim_id WHERE nt.kind = 'work' AND nt.created_at BETWEEN ? AND ? GROUP BY nt.user_id, day ORDER BY day DESC, n DESC`,
      off, num(payload.from_ms, 0), num(payload.to_ms, Date.now()));
    return { rows };
  },
  "supervisor.allocations": async ({ env, payload }) => {
    const rows = payload.client_id
      ? await all(env, "SELECT a.*, u.name AS by_name FROM allocations a LEFT JOIN users u ON u.id = a.by_user WHERE a.client_id = ? ORDER BY a.at DESC LIMIT 50", payload.client_id)
      : await all(env, "SELECT a.*, u.name AS by_name, c.name AS client_name FROM allocations a LEFT JOIN users u ON u.id = a.by_user LEFT JOIN clients c ON c.id = a.client_id ORDER BY a.at DESC LIMIT 50");
    return { rows: rows.map((r) => { let s = {}; try { s = JSON.parse(r.summary_json); } catch {} return { ...r, summary: s, summary_json: undefined }; }) };
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
  const key = c.account_no || c.patient;
  const siblings = key ? await all(env, `SELECT id, claim_no, account_no, patient, dos, cpt, payer, balance, state, assigned_to, priority, follow_up_on, last_status_code FROM claims
      WHERE client_id = ? AND id <> ? AND state IN ${WORKABLE} AND ((account_no <> '' AND account_no = ?) OR (patient <> '' AND patient = ?)) ORDER BY priority DESC LIMIT 50`, c.client_id, c.id, c.account_no || "\u0000", c.patient || "\u0000") : [];
  let lines = []; try { lines = JSON.parse(c.lines_json || "[]"); } catch {}
  let raw = {}; try { raw = JSON.parse(c.raw_json || "{}"); } catch {}
  const { raw_json, lines_json, ...rest } = c;
  const now = Date.now();
  const shaped = notes.map((n) => { const { fields_json, ...nn } = n; return { ...nn, fields: noteFields(n), editable: n.kind === "work" && now - n.created_at <= EDIT_WINDOW_MS && (n.user_id === user.id || user.role === "supervisor"), edit_until: n.created_at + EDIT_WINDOW_MS }; });
  return { claim: { ...rest, lines, raw, mine: c.assigned_to === user.id }, notes: shaped, siblings };
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
        if (user && user.must_change && !["auth.changePassword", "auth.me", "auth.logout", "meta.info"].includes(op)) throw new ApiError(403, "Please set a new password first.");
        if (SUPERVISOR_OPS.test(op) && (!user || user.role !== "supervisor")) throw denied("Supervisor access is needed for this.");
        const result = await handler({ env, user, token, payload, ctx });
        return json(result || { ok: true });
      }
      throw new ApiError(404, "Not found.");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status >= 500) console.error("brahmastra-api", e);
      return json({ error: (e && e.message) || "Server error." }, status);
    }
  },
};
